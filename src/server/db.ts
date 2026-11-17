import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { cleanText, normalizePath, questionKey, type GuideReport, type PageOutline, type SiteContext, type TurnRequest } from "../shared/types.ts";
import { MAX_VISITORS, openingRows, outlineRows, visitorHash, withLearned, type LearnedLabel, type LearnedOpening } from "./learned.ts";
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
/**
 * Learned labels kept for one site, and as many items behind controls. Past
 * this, new ones still go in, and room is made by dropping others: never the
 * ones the prompt reads (`LABELS_READ`), and of the rest, those seen longest
 * ago. Anyone can send labels, so a site that is full has to keep learning:
 * a flood of made-up ones is pushed out by the labels real visitors keep seeing.
 */
const MAX_LABELS = 5000;
/** The most learned labels read with a site, the most seen first. */
const LABELS_READ = 1500;

/** How long a report waits before each look for its guide's row. A Worker may keep working this long after it has answered. */
const REPORT_RETRIES_MS = [0, 1000, 3000, 6000];

export class Store {
  private readonly sql: NeonQueryFunction<false, false>;
  private readonly seen = new Map<string, number>();
  /** Refused origins this process has noted for each site, so made-up ones past the limit cost no trip to the database. */
  private readonly refused = new Map<string, Set<string>>();
  /** Each guide's step write still under way in this process, so a report about it can wait for it. */
  private readonly writing = new Map<string, Promise<void>>();

  /**
   * `connection` is Neon's connection string. A test hands in a stand-in for
   * the query function instead. `labelThreshold` is how many different
   * visitors must have seen a learned label before the prompt gets it, and
   * `labelNetworks` how many different networks they must have called from.
   * `maxLabels` is for tests, which would take long to fill the real limit.
   */
  constructor(
    connection: string | NeonQueryFunction<false, false>,
    private readonly labelThreshold = 3,
    private readonly labelNetworks = labelThreshold,
    private readonly maxLabels = MAX_LABELS,
  ) {
    this.sql = typeof connection === "string" ? neon(connection) : connection;
  }

  /**
   * A site, with what traffic has taught Haptic about its pages merged into
   * the crawl's. Callers keep it in memory (src/server/site-cache.ts), so a
   * step never waits on this.
   */
  async loadSite(id: string): Promise<SiteContext | undefined> {
    const [rows, labels, openings] = await Promise.all([
      this.sql`select id, name, origin, allowed_origins, context from sites where id = ${id}` as unknown as Promise<SiteRow[]>,
      this.learnedLabels(id),
      this.learnedOpenings(id),
    ]);
    return rows[0] ? withLearned(siteFromRow(rows[0]), labels, this.labelThreshold, openings) : undefined;
  }

  /**
   * What enough visitors, from enough networks, saw behind a control. None
   * when the table is missing (db/migrations/0012) or has no networks yet (0014):
   * until they are counted, nothing learned is trusted with the prompt.
   */
  private async learnedOpenings(id: string): Promise<LearnedOpening[]> {
    try {
      const rows = await this.sql`
        select route, control, label, href, visitor_count as visitors, network_count as networks, seen_count::int as seen from outline_openings
        where site_id = ${id} and visitor_count >= ${this.labelThreshold} and network_count >= ${this.labelNetworks}
        order by network_count desc, visitor_count desc, seen_count desc limit ${LABELS_READ}`;
      return rows as LearnedOpening[];
    } catch (error) {
      console.error("Couldn't read what menus show (have db/migrations/0012 and 0014 been applied?):", error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * The labels enough visitors, from enough networks, have seen on this site.
   * None, rather than a failed site, when the table is missing
   * (db/migrations/0009) or has no networks yet (0014).
   */
  private async learnedLabels(id: string): Promise<LearnedLabel[]> {
    try {
      const rows = await this.sql`
        select route, kind, label, href, visitor_count as visitors, network_count as networks, seen_count::int as seen from outline_labels
        where site_id = ${id} and visitor_count >= ${this.labelThreshold} and network_count >= ${this.labelNetworks}
        order by network_count desc, visitor_count desc, seen_count desc limit ${LABELS_READ}`;
      return rows as LearnedLabel[];
    } catch (error) {
      console.error("Couldn't read what was learned (have db/migrations/0009 and 0014 been applied?):", error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Counts the labels of a page a visitor saw. `visitor` is already hashed
   * with the site's id, and so is `network`, the network they called from,
   * which is empty when it is not known. Each label keeps up to ten of each,
   * and one already counted for a label isn't counted again.
   *
   * A site at its limit still learns: the new labels go in, and then the
   * labels the prompt does not read that were seen longest ago are dropped
   * to make room.
   */
  recordOutline(site: SiteContext, visitor: string, outline: PageOutline, network = ""): Promise<void> {
    const rows = outlineRows(outline);
    // In a statement of their own, so a database without 0012 still learns the page's labels.
    const opened = this.recordOpenings(site, visitor, openingRows(outline), network);
    if (!rows.length) return opened;
    return this.quietly("learn from a page (have db/migrations/0009 and 0014 been applied?)", async () => {
      const [counted] = (await this.sql`select count(*)::int as count from outline_labels where site_id = ${site.id}`) as { count: number }[];
      await this.sql`
        insert into outline_labels (site_id, route, kind, label, href, visitors, networks)
        select ${site.id}, r.route, r.kind, r.label, r.href, array[${visitor}::text],
          case when ${network} = '' then '{}'::text[] else array[${network}::text] end
        from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(route text, kind text, label text, href text)
        on conflict (site_id, route, kind, label, href) do update set
          seen_count = outline_labels.seen_count + 1, last_seen_at = now(),
          visitors = case when ${visitor} = any(outline_labels.visitors) or cardinality(outline_labels.visitors) >= ${MAX_VISITORS}
            then outline_labels.visitors else outline_labels.visitors || ${visitor}::text end,
          networks = case when ${network} = '' or ${network} = any(outline_labels.networks) or cardinality(outline_labels.networks) >= ${MAX_VISITORS}
            then outline_labels.networks else outline_labels.networks || ${network}::text end`;
      // Only when this outline could have taken the site past its limit, so most outlines cost two statements.
      if ((counted?.count ?? 0) + rows.length <= this.maxLabels) return;
      // The rows the prompt reads are the ones `learnedLabels` picks, in its order. They stay. The rest go least recently seen first.
      await this.sql`
        delete from outline_labels o using (
          select route, kind, label, href from (
            select route, kind, label, href, last_seen_at, seen_count,
              (visitor_count >= ${this.labelThreshold} and network_count >= ${this.labelNetworks}) and row_number() over (
                order by (visitor_count >= ${this.labelThreshold} and network_count >= ${this.labelNetworks}) desc, network_count desc, visitor_count desc, seen_count desc
              ) <= ${LABELS_READ} as read
            from outline_labels where site_id = ${site.id}
          ) ranked
          order by read desc, last_seen_at desc, seen_count desc, route, kind, label, href
          offset ${this.maxLabels}
        ) least
        where o.site_id = ${site.id} and o.route = least.route and o.kind = least.kind and o.label = least.label and o.href = least.href`;
    });
  }

  /** Counts what a visitor saw behind each control, the same way as a page's labels, and makes room the same way. */
  private recordOpenings(site: SiteContext, visitor: string, rows: ReturnType<typeof openingRows>, network: string): Promise<void> {
    if (!rows.length) return Promise.resolve();
    return this.quietly("learn what a menu shows (have db/migrations/0012 and 0014 been applied?)", async () => {
      const [counted] = (await this.sql`select count(*)::int as count from outline_openings where site_id = ${site.id}`) as { count: number }[];
      await this.sql`
        insert into outline_openings (site_id, route, control, label, href, visitors, networks)
        select ${site.id}, r.route, r.control, r.label, r.href, array[${visitor}::text],
          case when ${network} = '' then '{}'::text[] else array[${network}::text] end
        from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(route text, control text, label text, href text)
        on conflict (site_id, route, control, label, href) do update set
          seen_count = outline_openings.seen_count + 1, last_seen_at = now(),
          visitors = case when ${visitor} = any(outline_openings.visitors) or cardinality(outline_openings.visitors) >= ${MAX_VISITORS}
            then outline_openings.visitors else outline_openings.visitors || ${visitor}::text end,
          networks = case when ${network} = '' or ${network} = any(outline_openings.networks) or cardinality(outline_openings.networks) >= ${MAX_VISITORS}
            then outline_openings.networks else outline_openings.networks || ${network}::text end`;
      if ((counted?.count ?? 0) + rows.length <= this.maxLabels) return;
      await this.sql`
        delete from outline_openings o using (
          select route, control, label, href from (
            select route, control, label, href, last_seen_at, seen_count,
              (visitor_count >= ${this.labelThreshold} and network_count >= ${this.labelNetworks}) and row_number() over (
                order by (visitor_count >= ${this.labelThreshold} and network_count >= ${this.labelNetworks}) desc, network_count desc, visitor_count desc, seen_count desc
              ) <= ${LABELS_READ} as read
            from outline_openings where site_id = ${site.id}
          ) ranked
          order by read desc, last_seen_at desc, seen_count desc, route, control, label, href
          offset ${this.maxLabels}
        ) least
        where o.site_id = ${site.id} and o.route = least.route and o.control = least.control and o.label = least.label and o.href = least.href`;
    });
  }

  /**
   * Saves a site built by `npm run tag`. A site the team made by hand has no company until one claims it.
   * Corrections and controls never to point at are made in the dashboard, so a publish keeps them unless it brings its own.
   */
  async saveSite(site: SiteContext): Promise<void> {
    await this.sql`
      insert into sites (id, name, origin, allowed_origins, context)
      values (${site.id}, ${site.name}, ${site.origin}, ${site.allowedOrigins}, ${JSON.stringify(site)}::jsonb)
      on conflict (id) do update set name = excluded.name, origin = excluded.origin, allowed_origins = excluded.allowed_origins,
        context = jsonb_strip_nulls(jsonb_build_object('corrections', sites.context->'corrections', 'blocked', sites.context->'blocked')) || excluded.context,
        updated_at = now()`;
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
    return write.then(() => this.recordVisitor(request));
  }

  /**
   * Adds who asked, as a hash of the widget's random id made with the site's
   * id, so the dashboard counts people and not questions. A statement of its
   * own, because the column came later (db/migrations/0011).
   */
  private recordVisitor(request: TurnRequest): Promise<void> {
    const { guide, visitor } = request;
    if (!guide || !visitor) return Promise.resolve();
    return this.quietly("note who asked (has db/migrations/0011 been applied?)", async () => {
      const hash = await visitorHash(request.site, visitor);
      await this.sql`update guides set visitor = ${hash} where id = ${guide} and site_id = ${request.site} and visitor is null`;
    });
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
    return write
      .then(() => (request.step === 0 ? undefined : this.recordVisitor(request)))
      .then(() => this.recordCost(guide, request.step, measure))
      .then(() => this.recordKind(guide, request.step, measure))
      .then(() => this.recordUnseen(guide, request.step, measure));
  }

  /**
   * Counts a step the widget hung up on, because the page changed while the
   * model was answering. The step is asked again from the new page and
   * recorded then, so only the count is kept. The column is from db/migrations/0008.
   */
  cancelStep(request: TurnRequest): Promise<void> | undefined {
    const guide = request.guide;
    if (!guide) return undefined;
    const write = this.quietly("count a dropped step (has db/migrations/0008 been applied?)", async () => {
      await this.sql`update guides set cancelled_steps = cancelled_steps + 1 where id = ${guide} and site_id = ${request.site}`;
    });
    this.track(guide, write);
    return write;
  }

  /**
   * Adds the controls an answer named that are nowhere Haptic can see. With
   * the step's sources, that says which help articles may be out of date. The
   * column is from db/migrations/0007.
   *
   * Only a site with Answers on can have any, so a site without sends nothing.
   * On one with, every step sends it, as nothing when there are none: a step
   * written again, when the widget asks for it a second time, must not keep
   * the list from the first answer.
   */
  private recordUnseen(guide: string, step: number, measure: TurnMeasure): Promise<void> {
    const unseen = measure.unseen?.length ? measure.unseen : null;
    if (!unseen && (!measure.reply.mode || measure.reply.mode === "act")) return Promise.resolve();
    return this.quietly("record controls an answer named that aren't in the product (has db/migrations/0007 been applied?)", async () => {
      await this.sql`update steps set unseen = ${unseen} where guide_id = ${guide} and n = ${step}`;
    });
  }

  /**
   * On a site with Answers on, adds what kind of reply the step was and the
   * help docs it rested on. Like the cost, it is a statement of its own for
   * columns that came later (db/migrations/0005). A site without Answers
   * sends nothing here.
   */
  private recordKind(guide: string, step: number, measure: TurnMeasure): Promise<void> {
    const { mode, reason } = measure.reply;
    // An act step's mode is "act", which the column does not take: it says what kind of reply a guide's step was, on a
    // site with Answers on. How acting went is in the server's log of counts (turnCounts in app.ts).
    if (!mode || mode === "act") return Promise.resolve();
    return this.quietly("record what kind of reply a step was (has db/migrations/0005 been applied?)", async () => {
      await this.sql`
        update steps set mode = ${mode}, reason = ${reason ?? null}, sources = ${measure.cited}, overruled = ${measure.overruled ?? null}
        where guide_id = ${guide} and n = ${step}`;
    });
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
        // Last, because the column came later (db/migrations/0006): if it is missing, what is above is already written.
        if (report.handoff) {
          await this.sql`update guides set handed_off = true where id = ${guide} and site_id = ${site.id}`;
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
