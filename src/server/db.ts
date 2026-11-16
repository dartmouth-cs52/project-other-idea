import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { cleanText, normalizePath, questionKey, type GuideReport, type SiteContext, type TurnRequest } from "../shared/types.ts";
import type { TurnMeasure } from "./model.ts";

// What the widget server keeps in Neon: each site, which origins the script has
// called from, and every guide with its steps. The tables are in db/migrations.
//
// Nothing here may cost a visitor their step. Writes are handed back as
// promises for the host to finish after the response (waitUntil on a Worker),
// and they catch their own errors.
//
// What is kept from a visitor follows the rule the team set: the question, each
// control pointed at, wrong clicks, how the guide ended, and timings, with
// emails and long numbers masked. No page contents, and never what they type.

export interface SiteRow {
  id: string;
  name: string;
  origin: string;
  allowed_origins: string[];
  context: SiteContext;
}

/** A site as the server answers with it. The columns win over the copy inside `context`, because the dashboard edits them. */
export function siteFromRow(row: SiteRow): SiteContext {
  return { ...row.context, id: row.id, name: row.name, origin: row.origin, allowedOrigins: row.allowed_origins };
}

/** The script calls from the same page many times a minute. One write a minute per origin is plenty to know it is live. */
const SEEN_EVERY_MS = 60_000;
/**
 * Anyone can send a request with a made-up Origin header, so origins that are
 * not allowed are kept only up to this many per site per day. Counting by day
 * means a burst of made-up ones cannot stop a real one being noted for good.
 */
const MAX_REFUSED_ORIGINS = 20;
/** How long a report waits before each look for its guide's row. A Worker may keep working this long after it has answered. */
const REPORT_RETRIES_MS = [0, 1000, 3000, 6000];

export class Store {
  private readonly sql: NeonQueryFunction<false, false>;
  private readonly seen = new Map<string, number>();
  /** Refused origins this process has noted for each site, so made-up ones past the limit cost no trip to the database. */
  private readonly refused = new Map<string, Set<string>>();
  /** Each guide's step write still under way in this process, so a report about it can wait for it. */
  private readonly writing = new Map<string, Promise<void>>();

  /** `connection` is Neon's connection string. A test hands in a stand-in for the query function instead. */
  constructor(connection: string | NeonQueryFunction<false, false>) {
    this.sql = typeof connection === "string" ? neon(connection) : connection;
  }

  async loadSite(id: string): Promise<SiteContext | undefined> {
    const rows = (await this.sql`select id, name, origin, allowed_origins, context from sites where id = ${id}`) as SiteRow[];
    return rows[0] ? siteFromRow(rows[0]) : undefined;
  }

  /** Saves a site built by `npm run tag`. A site the team made by hand has no company until one claims it. */
  async saveSite(site: SiteContext): Promise<void> {
    await this.sql`
      insert into sites (id, name, origin, allowed_origins, context)
      values (${site.id}, ${site.name}, ${site.origin}, ${site.allowedOrigins}, ${JSON.stringify(site)}::jsonb)
      on conflict (id) do update set name = excluded.name, origin = excluded.origin,
        allowed_origins = excluded.allowed_origins, context = excluded.context, updated_at = now()`;
  }

  seenAt(site: SiteContext, origin: string, allowed: boolean): Promise<void> | undefined {
    // Allowed or not is part of the key, so an address that has just been allowed is noted again at once.
    const key = `${site.id} ${origin} ${allowed}`;
    const now = Date.now();
    if (now - (this.seen.get(key) ?? 0) < SEEN_EVERY_MS) return undefined;
    if (!allowed) {
      if (this.refused.size > 1000) this.refused.clear();
      const noted = this.refused.get(site.id) ?? new Set<string>();
      this.refused.set(site.id, noted);
      if (!noted.has(origin) && noted.size >= MAX_REFUSED_ORIGINS) return undefined;
      noted.add(origin);
    }
    if (this.seen.size > 5000) this.seen.clear();
    this.seen.set(key, now);
    return this.quietly("note an origin", async () => {
      // A refused origin already on record is always brought up to date. A new one is added only under the day's limit.
      await this.sql`
        insert into site_origins (site_id, origin, allowed)
        select ${site.id}, ${origin.slice(0, 200)}, ${allowed}
        where ${allowed}
          or exists (select 1 from site_origins where site_id = ${site.id} and origin = ${origin.slice(0, 200)})
          or (select count(*) from site_origins where site_id = ${site.id} and not allowed and last_seen_at > now() - interval '1 day') < ${MAX_REFUSED_ORIGINS}
        on conflict (site_id, origin) do update
          set last_seen_at = now(), requests = site_origins.requests + 1, allowed = excluded.allowed`;
    });
  }

  /**
   * Records that a question was asked, before the model has answered. If the
   * answer never comes, because the model failed or the visitor left, the
   * guide is still there for the dashboard, and a report of how it ended has
   * a row to land on.
   */
  startGuide(request: TurnRequest, origin: string | undefined): Promise<void> | undefined {
    const guide = request.guide;
    if (!guide) return undefined;
    const write = this.quietly("record a question", async () => {
      await this.sql`
        insert into guides (id, site_id, question, question_key, started_path, origin, last_step_at, step_count)
        values (${guide}, ${request.site}, ${cleanText(request.goal, 300)}, ${questionKey(request.goal)},
          ${normalizePath(request.snapshot.path || "/")}, ${origin ?? null}, now(), 0)
        on conflict (id) do nothing`;
    });
    this.track(guide, write);
    return write;
  }

  /** Records one step, and the guide it belongs to if this is its first. A step asked again (after a loop or a page change) replaces the earlier try. */
  recordStep(request: TurnRequest, measure: TurnMeasure, origin: string | undefined): Promise<void> | undefined {
    const guide = request.guide;
    if (!guide) return undefined;
    const { reply } = measure;
    const target = reply.target ? request.snapshot.elements.find((element) => element.id === reply.target) : undefined;
    const path = normalizePath(request.snapshot.path || "/");
    const write = this.quietly("record a step", async () => {
      await this.sql.transaction([
        this.sql`
          insert into guides (id, site_id, question, question_key, started_path, origin, last_step_at, step_count)
          values (${guide}, ${request.site}, ${cleanText(request.goal, 300)}, ${questionKey(request.goal)}, ${path}, ${origin ?? null}, now(), ${request.step + 1})
          on conflict (id) do update set last_step_at = now(), step_count = greatest(guides.step_count, excluded.step_count)
          where guides.site_id = excluded.site_id`,
        this.sql`
          insert into steps (guide_id, n, path, target_role, target_label, target_context, said, status, event, strayed, ms, ms_to_target, model)
          select ${guide}, ${request.step}, ${path}, ${target?.role ?? null}, ${target ? cleanText(target.label, 80) : null},
            ${target?.context ? cleanText(target.context, 120) : null}, ${cleanText(reply.say, 600)}, ${reply.status},
            ${request.event ? cleanText(request.event, 600) : null}, ${request.offTrack === true}, ${measure.ms}, ${measure.msToTarget}, ${measure.model}
          where exists (select 1 from guides where id = ${guide} and site_id = ${request.site})
          on conflict (guide_id, n) do update set path = excluded.path, target_role = excluded.target_role, target_label = excluded.target_label,
            target_context = excluded.target_context, said = excluded.said, status = excluded.status, event = excluded.event,
            strayed = steps.strayed or excluded.strayed, ms = excluded.ms, ms_to_target = excluded.ms_to_target, model = excluded.model, created_at = now()`,
      ]);
    });
    this.track(guide, write);
    return write.then(() => this.recordCost(guide, request.step, measure));
  }

  /**
   * Adds what the step cost to its row. It is a statement of its own, sent
   * after the step is safely written, because these columns came later
   * (db/migrations/0004): on a database that does not have them yet this
   * fails, says so, and the step itself is still there.
   */
  private recordCost(guide: string, step: number, measure: TurnMeasure): Promise<void> {
    const { tokens } = measure;
    if (!tokens && !measure.broke.length) return Promise.resolve();
    return this.quietly("record what a step cost (has db/migrations/0004 been applied?)", async () => {
      await this.sql`
        update steps set input_tokens = ${tokens?.input ?? null}, cache_read_tokens = ${tokens?.cacheRead ?? null},
          cache_write_tokens = ${tokens?.cacheWrite ?? null}, output_tokens = ${tokens?.output ?? null},
          usd = ${tokens ? measure.usd : null}, broke = ${measure.broke}
        where guide_id = ${guide} and n = ${step}`;
    });
  }

  /** Notes a write under way for a guide, after any already under way, so a report can wait for all of them. */
  private track(guide: string, write: Promise<void>) {
    const all = Promise.all([this.writing.get(guide), write]).then(() => {});
    this.writing.set(guide, all);
    void all.then(() => this.writing.get(guide) === all && this.writing.delete(guide));
  }

  /**
   * The first outcome reported is the one kept. Whether it helped can be said once the guide has ended.
   *
   * A guide's last step is written after its reply has gone out, and the
   * widget reports the ending straight after that reply, so the report can
   * arrive before the guide's row exists. It waits for this process's own
   * write of that guide, then tries a few more times in case the step was
   * answered by another process.
   */
  report(site: SiteContext, guide: string, report: GuideReport): Promise<void> {
    return this.quietly("record how a guide ended", async () => {
      await this.writing.get(guide);
      for (const wait of REPORT_RETRIES_MS) {
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        const [found] = await this.sql`select outcome is null as open from guides where id = ${guide} and site_id = ${site.id}`;
        if (!found) continue;
        if (report.outcome && found.open) {
          await this.sql`update guides set outcome = ${report.outcome}, ended_at = now() where id = ${guide} and site_id = ${site.id} and outcome is null`;
        }
        if (report.helped !== undefined) {
          await this.sql`update guides set helped = ${report.helped} where id = ${guide} and site_id = ${site.id}`;
        }
        return;
      }
      console.error(`A report for guide ${guide} on ${site.id} came for a guide that was never recorded.`);
    });
  }

  private async quietly(what: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      console.error(`Couldn't ${what}:`, error instanceof Error ? error.message : error);
    }
  }
}
