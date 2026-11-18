import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { reportUsage } from "../shared/billing.ts";
import { BLOCKED_SAY } from "../shared/corrections.ts";
import { mappingAllowed } from "../shared/mapping.ts";
import {
  cleanText,
  normalizePath,
  NO_MODEL,
  questionKey,
  REASONS,
  routeKey,
  ROUTES_MODES,
  type GuideOutcome,
  type GuideReport,
  type PageNode,
  type PageOutline,
  type RoutesMode,
  type SiteContext,
  type TurnReply,
  type TurnRequest,
} from "../shared/types.ts";
import { mergeMapped } from "./mapped.ts";
import { MAX_VISITORS, openingRows, outlineRows, visitorHash, withLearned, type LearnedLabel, type LearnedOpening } from "./learned.ts";
import type { TurnMeasure } from "./model.ts";
import { contextOf, storable, type RouteLookup, type RouteResult, type StoredRoute } from "./routes.ts";

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
  routes_mode?: string;
}

/** A site as the server answers with it. The columns win over the copy inside `context`, because the dashboard edits them. */
export function siteFromRow(row: SiteRow): SiteContext {
  const site: SiteContext = { ...row.context, id: row.id, name: row.name, origin: row.origin, allowedOrigins: row.allowed_origins };
  if (ROUTES_MODES.includes(row.routes_mode as RoutesMode)) site.routes = row.routes_mode as RoutesMode;
  return site;
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
/**
 * The most learned labels read with a site, and as many items behind
 * controls, the most widely seen first. Each query that ranks them writes the
 * same order out: by how many networks and then how many visitors have seen
 * them, the counts that are hard to make up, each up to ten. Then whether they
 * were seen in the last 30 days, then the longest known first, then the row's
 * own key, so the order is the same every time. Never by how many times a
 * label was sent, which anyone can raise as fast as they can post: ranked by
 * that, labels sent from ten networks over and over took every place in every
 * visitor's prompt, and the ones real visitors saw were dropped. Now a label
 * first sent today cannot outrank one real visitors keep seeing with the same counts.
 */
const LABELS_READ = 1500;
/**
 * How many rows of each kind one network may be counted on for the first time
 * on one site in a day (db/migrations/0019). A row it is already counted on
 * costs nothing, so the people behind one address using a product all day stay
 * well under it, while callers on a few networks can no longer put themselves
 * on thousands of rows at once.
 */
const NETWORK_ROWS_A_DAY = 500;

/** How long a report waits before each look for its guide's row. A Worker may keep working this long after it has answered. */
const REPORT_RETRIES_MS = [0, 1000, 3000, 6000];

/** The step a guide's ending rests on, as this server recorded it when it answered. Nothing in it is the widget's word. */
export interface LastStep {
  n: number;
  status: TurnReply["status"];
  /** The reply pointed at a control on the page. */
  pointed: boolean;
  /** The model that answered. `NO_MODEL` when the server answered by itself, without asking one: a step past the cap on acting. */
  model: string;
  /** On a site with Answers on: the kind of reply, and why Haptic could not help (db/migrations/0005). Null on any other step, or while still being written. */
  mode?: string | null;
  reason?: string | null;
  /** The model named a control the site's owner ruled out, so the visitor read the fixed sentence instead. */
  blocked?: boolean;
}

/**
 * How a guide the widget reports as finished is recorded. Only "finished" is
 * billed, and the report is the widget's word, which anything that can send a
 * request can give. So it is kept only when the server's own record of the
 * guide bears it out: the newest step it recorded was answered by the model,
 * and it either said the guide was done or pointed at a control the visitor
 * could then have used. That is every ending the widget calls finished (see
 * `GUIDE_OUTCOMES`): the visitor arrived, or used the control the last answer
 * pointed at, which in Do it with me is the click that commits, pointed at by
 * a reply that may still say "continue". That the control was used is the
 * widget's word and stays so: the server sees no clicks.
 *
 * A step that ended the guide some other way does not bear it out: the model
 * was stuck, the control was one the site's owner ruled out, the reply was an
 * answer in words or said Haptic can't help, the server stopped acting at its
 * cap, or a first answer only needed words. That ending is kept instead, as
 * the widget would have reported it, and none of them is billed. When the
 * record shows no ending at all, nothing is kept (undefined), and the guide
 * stays one that never reported one.
 */
export function endingFor(last: LastStep | undefined): GuideOutcome | undefined {
  // No step was answered: the question was only asked, or was refused by the off switch or the budget.
  if (!last) return undefined;
  // The server ended acting at its cap, without asking the model. The guide ran out of steps.
  if (last.model === NO_MODEL) return "step_limit";
  // The model found no way forward, which is free.
  if (last.status === "stuck") return "nothing_to_point_at";
  // The site's owner ruled the control out, and Haptic said it can't help with that here.
  if (last.blocked) return "blocked";
  // On a site with Answers on: an answer in words, or Haptic saying it can't help, ends a guide as that, and neither is billed.
  // An answer that points and says "continue" goes on as a guide, and is finished, if ever, on a later step.
  if (last.mode === "cannot_help") return (REASONS as readonly string[]).includes(last.reason ?? "") ? (last.reason as GuideOutcome) : "not_covered";
  if (last.mode === "answer" && last.status === "done") return "answered";
  // A step with no pointer that the visitor was still to do, like pressing a key. Nothing ended there.
  if (last.status === "continue" && !last.pointed) return undefined;
  // A first answer that only needed words was shown, and is free.
  if (last.n === 0 && !last.pointed) return "shown";
  return "finished";
}

/** A trusted route whose change a finished guide has just used, by its key, and whether the change now has networks enough. */
interface RouteChange {
  goal_key: string;
  path: string;
  dialog: string;
  after_key: string;
  ready: boolean;
}

export class Store {
  private readonly sql: NeonQueryFunction<false, false>;
  private readonly seen = new Map<string, number>();
  /** Refused origins this process has noted for each site, so made-up ones past the limit cost no trip to the database. */
  private readonly refused = new Map<string, Set<string>>();
  /** Each guide's step write still under way in this process, so a report about it can wait for it. */
  private readonly writing = new Map<string, Promise<void>>();

  /** How many different networks a learned label's visitors must have called from before the prompt gets it. */
  private readonly labelNetworks: number;
  /** How many different networks finished guides that used a route must have come from before it is trusted, or before a change to a trusted one is. */
  private readonly routeNetworks: number;
  /** How long a report waits before each look at its guide. */
  private readonly reportWaitsMs: readonly number[];
  /** How many learned labels a site keeps, and as many items behind controls. */
  private readonly maxLabels: number;
  /** How many learned labels are read with a site, and as many items behind controls. */
  private readonly labelsRead: number;
  /** How many rows of each kind one network may be counted on for the first time on one site in a day. */
  private readonly networkRowsADay: number;
  /** The day this process last cleared the days before from outline_network_days. */
  private clearedDay = "";
  /** Stripe's secret key. With it, a guide kept as finished is sent to Stripe as usage straight away. */
  private readonly stripeKey: string | undefined;

  /**
   * `connection` is Neon's connection string. A test hands in a stand-in for
   * the query function instead. `labelThreshold` is how many different
   * visitors must have seen a learned label before the prompt gets it, and
   * `labelNetworks` how many different networks they must have called from,
   * the same number unless given. `routeNetworks` is how many networks
   * finished guides must have come from to trust a verified route, as many as
   * a label needs unless given. A test makes `reportWaitsMs`, `maxLabels`,
   * `labelsRead` and `networkRowsADay` small. `stripeKey` turns on sending
   * finished guides to Stripe.
   */
  constructor(
    connection: string | NeonQueryFunction<false, false>,
    private readonly labelThreshold = 3,
    options: {
      labelNetworks?: number;
      routeNetworks?: number;
      reportWaitsMs?: readonly number[];
      maxLabels?: number;
      labelsRead?: number;
      networkRowsADay?: number;
      stripeKey?: string;
    } = {},
  ) {
    this.sql = typeof connection === "string" ? neon(connection) : connection;
    this.labelNetworks = options.labelNetworks ?? labelThreshold;
    this.routeNetworks = options.routeNetworks ?? this.labelNetworks;
    this.reportWaitsMs = options.reportWaitsMs ?? REPORT_RETRIES_MS;
    this.maxLabels = options.maxLabels ?? MAX_LABELS;
    this.labelsRead = options.labelsRead ?? LABELS_READ;
    this.networkRowsADay = options.networkRowsADay ?? NETWORK_ROWS_A_DAY;
    this.stripeKey = options.stripeKey || undefined;
  }

  /**
   * A site, with what traffic has taught Haptic about its pages merged into
   * the crawl's. Callers keep it in memory (src/server/site-cache.ts), so a
   * step never waits on this.
   */
  async loadSite(id: string): Promise<SiteContext | undefined> {
    const [rows, labels, openings] = await Promise.all([
      this.sql`select id, name, origin, allowed_origins, context, routes_mode from sites where id = ${id}` as unknown as Promise<SiteRow[]>,
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
        order by network_count desc, visitor_count desc, last_seen_at > now() - interval '30 days' desc, first_seen_at, route, control, label, href
        limit ${this.labelsRead}`;
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
        order by network_count desc, visitor_count desc, last_seen_at > now() - interval '30 days' desc, first_seen_at, route, kind, label, href
        limit ${this.labelsRead}`;
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
   *
   * A network that has already been counted on its day's share of new rows
   * on this site (`networkRowsADay`) teaches it nothing more that day.
   */
  recordOutline(site: SiteContext, visitor: string, outline: PageOutline, network = ""): Promise<void> {
    const rows = outlineRows(outline);
    // In a statement of their own, so a database without 0012 still learns the page's labels.
    const opened = this.recordOpenings(site, visitor, openingRows(outline), network);
    if (!rows.length) return opened;
    return this.quietly("learn from a page (have db/migrations/0009, 0014 and 0019 been applied?)", async () => {
      if (network) {
        // The rows this outline would count the network on for the first time, added to what it has been counted on today.
        const [day] = (await this.sql`
          insert into outline_network_days (site_id, network, day, labels)
          select ${site.id}, ${network}, current_date, count(*)::int
          from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(route text, kind text, label text, href text)
          left join outline_labels o on o.site_id = ${site.id} and o.route = r.route and o.kind = r.kind and o.label = r.label and o.href = r.href
          where o.site_id is null or (not (${network} = any(o.networks)) and cardinality(o.networks) < ${MAX_VISITORS})
          on conflict (site_id, network, day) do update set labels = outline_network_days.labels + excluded.labels
          returning labels`) as { labels: number }[];
        if (!(await this.withinDay(site, day?.labels ?? 0, rows.length, "labels"))) return;
      }
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
                order by (visitor_count >= ${this.labelThreshold} and network_count >= ${this.labelNetworks}) desc, network_count desc, visitor_count desc,
                  last_seen_at > now() - interval '30 days' desc, first_seen_at, route, kind, label, href
              ) <= ${this.labelsRead} as read
            from outline_labels where site_id = ${site.id}
          ) ranked
          order by read desc, last_seen_at desc, seen_count desc, route, kind, label, href
          offset ${this.maxLabels}
        ) least
        where o.site_id = ${site.id} and o.route = least.route and o.kind = least.kind and o.label = least.label and o.href = least.href`;
    });
  }

  /** Counts what a visitor saw behind each control, the same way as a page's labels, and makes room and keeps each network to its day's share the same way. */
  private recordOpenings(site: SiteContext, visitor: string, rows: ReturnType<typeof openingRows>, network: string): Promise<void> {
    if (!rows.length) return Promise.resolve();
    return this.quietly("learn what a menu shows (have db/migrations/0012, 0014 and 0019 been applied?)", async () => {
      if (network) {
        const [day] = (await this.sql`
          insert into outline_network_days (site_id, network, day, openings)
          select ${site.id}, ${network}, current_date, count(*)::int
          from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(route text, control text, label text, href text)
          left join outline_openings o on o.site_id = ${site.id} and o.route = r.route and o.control = r.control and o.label = r.label and o.href = r.href
          where o.site_id is null or (not (${network} = any(o.networks)) and cardinality(o.networks) < ${MAX_VISITORS})
          on conflict (site_id, network, day) do update set openings = outline_network_days.openings + excluded.openings
          returning openings`) as { openings: number }[];
        if (!(await this.withinDay(site, day?.openings ?? 0, rows.length, "items behind controls"))) return;
      }
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
                order by (visitor_count >= ${this.labelThreshold} and network_count >= ${this.labelNetworks}) desc, network_count desc, visitor_count desc,
                  last_seen_at > now() - interval '30 days' desc, first_seen_at, route, control, label, href
              ) <= ${this.labelsRead} as read
            from outline_openings where site_id = ${site.id}
          ) ranked
          order by read desc, last_seen_at desc, seen_count desc, route, control, label, href
          offset ${this.maxLabels}
        ) least
        where o.site_id = ${site.id} and o.route = least.route and o.control = least.control and o.label = least.label and o.href = least.href`;
    });
  }

  /** Whether `pass` lets its holder map this site right now. Read from the database each time: the pass may be seconds old. */
  async mappingAllowed(site: string, pass: string): Promise<boolean> {
    const rows = (await this.sql`select context->'mapping' as mapping from sites where id = ${site}`) as { mapping: SiteContext["mapping"] | null }[];
    return mappingAllowed(site, rows[0]?.mapping ?? undefined, pass);
  }

  /**
   * Puts one mapped page into a site's pages. The widget sends one page at a
   * time and waits for each, so reading the pages and writing them back is
   * not raced by another page from the same tab.
   */
  async saveMappedPage(site: string, page: PageNode): Promise<void> {
    const rows = (await this.sql`select context->'pages' as pages from sites where id = ${site}`) as { pages: PageNode[] | null }[];
    if (!rows[0]) return;
    const pages = rows[0].pages ?? [];
    const merged = mergeMapped(pages, page);
    if (merged === pages) return;
    await this.sql`
      update sites set context = jsonb_set(jsonb_set(context, '{pages}', ${JSON.stringify(merged)}::jsonb), '{updatedAt}', to_jsonb(now()::text)), updated_at = now()
      where id = ${site}`;
  }

  /**
   * Saves a site built by `npm run tag`. A site the team made by hand has no company until one claims it.
   * Corrections, controls never to point at and taught routes are made in the dashboard, so a publish keeps them unless it brings its own.
   */
  async saveSite(site: SiteContext): Promise<void> {
    await this.sql`
      insert into sites (id, name, origin, allowed_origins, context)
      values (${site.id}, ${site.name}, ${site.origin}, ${site.allowedOrigins}, ${JSON.stringify(site)}::jsonb)
      on conflict (id) do update set name = excluded.name, origin = excluded.origin, allowed_origins = excluded.allowed_origins,
        context = jsonb_strip_nulls(jsonb_build_object('corrections', sites.context->'corrections', 'blocked', sites.context->'blocked', 'taught', sites.context->'taught')) || excluded.context,
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
  recordStep(request: TurnRequest, measure: TurnMeasure, origin: string | undefined, route?: RouteResult): Promise<void> | undefined {
    const guide = request.guide;
    if (!guide) return undefined;
    const { reply } = measure;
    const target = reply.target ? request.snapshot.elements.find((element) => element.id === reply.target) : undefined;
    const path = normalizePath(request.snapshot.path || "/");
    const targetKey = target ? routeKey(target) : null;
    // The model's answer becomes the stored route for this question on this screen (routes.ts). Only a guide's step is
    // kept: an answer in words is shown in the panel, and a route's reply is shown beside the pointer.
    //
    // Anything that can send a request can have the model answer from a page of its own making, so an answer alone
    // never changes what a trusted route serves. What a route serves is its control, its sentence and its status
    // together, so the networks that confirm it vouch for all three: a finished guide counts only for the answer its
    // own step was given (`trustRoutes`). On a route not yet trusted, an answer that differs in any of them takes its
    // place and starts again from no networks. Were the networks kept when only the words changed, the last caller to
    // finish on a control others had confirmed would choose what every visitor reads beside it, and whether the guide
    // ends there. A trusted route keeps all three, and a different answer is kept beside it as the change it may make
    // (next_*): the change takes its place once finished guides from as many networks as trust takes have used it. The
    // same change asked for again keeps the networks that used it, and any other starts again from none. Only a
    // different control counts as a repair.
    const learn =
      route && route.outcome !== "served" && target && targetKey && reply.status !== "stuck" && (!reply.mode || reply.mode === "guide") && storable(route.lookup, targetKey)
        ? this.sql`
          insert into routes (site_id, goal_key, path, dialog, after_key, target_key, target_context, target_role, target_label, say, status)
          values (${request.site}, ${route.lookup.goalKey}, ${route.lookup.path}, ${route.lookup.dialog}, ${route.lookup.afterKey},
            ${targetKey}, ${contextOf(target)}, ${target.role}, ${cleanText(target.label, 80)}, ${cleanText(reply.say, 600)}, ${reply.status})
          on conflict (site_id, goal_key, path, dialog, after_key) do update set
            (target_key, target_context, target_role, target_label, say, status, networks, repairs,
              next_target_key, next_target_context, next_target_role, next_target_label, next_say, next_status, next_networks, updated_at) = (
            select
              case when routes.confirmed then routes.target_key else excluded.target_key end,
              case when routes.confirmed then routes.target_context else excluded.target_context end,
              case when routes.confirmed then routes.target_role else excluded.target_role end,
              case when routes.confirmed then routes.target_label else excluded.target_label end,
              case when routes.confirmed then routes.say else excluded.say end,
              case when routes.confirmed then routes.status else excluded.status end,
              case when routes.confirmed or same then routes.networks else '{}' end,
              routes.repairs + case when routes.confirmed or control then 0 else 1 end,
              case when not routes.confirmed then null when same then routes.next_target_key else excluded.target_key end,
              case when not routes.confirmed then null when same then routes.next_target_context else excluded.target_context end,
              case when not routes.confirmed then null when same then routes.next_target_role else excluded.target_role end,
              case when not routes.confirmed then null when same then routes.next_target_label else excluded.target_label end,
              case when not routes.confirmed then null when same then routes.next_say else excluded.say end,
              case when not routes.confirmed then null when same then routes.next_status else excluded.status end,
              case when routes.confirmed and (same or again) then routes.next_networks else '{}' end,
              now()
            from (
              select (routes.target_key, routes.target_context) = (excluded.target_key, excluded.target_context) as control,
                (routes.target_key, routes.target_context, routes.say, routes.status) = (excluded.target_key, excluded.target_context, excluded.say, excluded.status) as same,
                (routes.next_target_key, routes.next_target_context, routes.next_say, routes.next_status)
                  is not distinct from (excluded.target_key, excluded.target_context, excluded.say, excluded.status) as again
            ) answer
          )`
        : undefined;
    // A step the server answered by itself cost nothing to ask for, and the widget chooses the guide's id and the
    // question. So it is added to a guide already on record and never starts one: otherwise anything that can send
    // a request could put questions of its choosing on a site's dashboard without the model ever being called.
    const guideRow =
      measure.model === NO_MODEL
        ? this.sql`
          update guides set last_step_at = now(), step_count = greatest(step_count, ${request.step + 1})
          where id = ${guide} and site_id = ${request.site}`
        : this.sql`
          insert into guides (id, site_id, question, question_key, started_path, origin, last_step_at, step_count)
          values (${guide}, ${request.site}, ${cleanText(request.goal, 300)}, ${questionKey(request.goal)}, ${path}, ${origin ?? null}, now(), ${request.step + 1})
          on conflict (id) do update set last_step_at = now(), step_count = greatest(guides.step_count, excluded.step_count)
          where guides.site_id = excluded.site_id`;
    const write = this.quietly("record a step", async () => {
      await this.sql.transaction([
        guideRow,
        this.sql`
          insert into steps (guide_id, n, path, target_role, target_label, target_context, said, status, event, strayed, ms, ms_to_target, model,
            target_key, after_key, dialog, route)
          select ${guide}, ${request.step}, ${path}, ${target?.role ?? null}, ${target ? cleanText(target.label, 80) : null},
            ${target?.context ? cleanText(target.context, 120) : null}, ${cleanText(reply.say, 600)}, ${reply.status},
            ${request.event ? cleanText(request.event, 600) : null}, ${request.offTrack === true}, ${measure.ms}, ${measure.msToTarget}, ${measure.model},
            ${targetKey}, ${route?.lookup.afterKey ?? null}, ${route?.lookup.dialog ?? null}, ${route?.outcome ?? null}
          where exists (select 1 from guides where id = ${guide} and site_id = ${request.site})
          on conflict (guide_id, n) do update set path = excluded.path, target_role = excluded.target_role, target_label = excluded.target_label,
            target_context = excluded.target_context, said = excluded.said, status = excluded.status, event = excluded.event,
            strayed = steps.strayed or excluded.strayed, ms = excluded.ms, ms_to_target = excluded.ms_to_target, model = excluded.model,
            target_key = excluded.target_key, after_key = excluded.after_key, dialog = excluded.dialog, route = excluded.route, created_at = now()`,
      ]);
      // In a statement of its own, after the step is safely written, so a database without db/migrations/0018 still
      // records every step and only stops learning routes. It is part of this write, so a report waits for it too.
      if (learn)
        await this.quietly("learn a route from a step (has db/migrations/0018 been applied?)", async () => {
          await learn;
        });
    });
    this.track(guide, write);
    return write
      .then(() => (request.step === 0 ? undefined : this.recordVisitor(request)))
      .then(() => this.recordCost(request.site, guide, request.step, measure))
      .then(() => this.recordKind(request.site, guide, request.step, measure))
      .then(() => this.recordUnseen(request.site, guide, request.step, measure));
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
   *
   * Like the other additions below, it is written only to a guide of the
   * step's own site. The widget chooses the guide's id, so a step for one site
   * can name a guide of another, and must not rewrite that guide's steps.
   */
  private recordUnseen(site: string, guide: string, step: number, measure: TurnMeasure): Promise<void> {
    const unseen = measure.unseen?.length ? measure.unseen : null;
    if (!unseen && (!measure.reply.mode || measure.reply.mode === "act")) return Promise.resolve();
    return this.quietly("record controls an answer named that aren't in the product (has db/migrations/0007 been applied?)", async () => {
      await this.sql`
        update steps set unseen = ${unseen}
        where guide_id = ${guide} and n = ${step} and exists (select 1 from guides where id = ${guide} and site_id = ${site})`;
    });
  }

  /**
   * On a site with Answers on, adds what kind of reply the step was and the
   * help docs it rested on. Like the cost, it is a statement of its own for
   * columns that came later (db/migrations/0005). A site without Answers
   * sends nothing here.
   */
  private recordKind(site: string, guide: string, step: number, measure: TurnMeasure): Promise<void> {
    const { mode, reason } = measure.reply;
    // An act step's mode is "act", which the column does not take: it says what kind of reply a guide's step was, on a
    // site with Answers on. How acting went is in the server's log of counts (turnCounts in app.ts).
    if (!mode || mode === "act") return Promise.resolve();
    return this.quietly("record what kind of reply a step was (has db/migrations/0005 been applied?)", async () => {
      await this.sql`
        update steps set mode = ${mode}, reason = ${reason ?? null}, sources = ${measure.cited}, overruled = ${measure.overruled ?? null}
        where guide_id = ${guide} and n = ${step} and exists (select 1 from guides where id = ${guide} and site_id = ${site})`;
    });
  }

  /**
   * Adds what the step cost to its row. It is a statement of its own, sent
   * after the step is safely written, because these columns came later
   * (db/migrations/0004): on a database that does not have them yet this
   * fails, says so, and the step itself is still there.
   */
  private recordCost(site: string, guide: string, step: number, measure: TurnMeasure): Promise<void> {
    const { tokens } = measure;
    if (!tokens && !measure.broke.length) return Promise.resolve();
    return this.quietly("record what a step cost (has db/migrations/0004 been applied?)", async () => {
      await this.sql`
        update steps set input_tokens = ${tokens?.input ?? null}, cache_read_tokens = ${tokens?.cacheRead ?? null},
          cache_write_tokens = ${tokens?.cacheWrite ?? null}, output_tokens = ${tokens?.output ?? null},
          usd = ${tokens ? measure.usd : null}, broke = ${measure.broke}
        where guide_id = ${guide} and n = ${step} and exists (select 1 from guides where id = ${guide} and site_id = ${site})`;
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
   * "finished" is the outcome that is billed, so it is kept only when the
   * steps this server recorded bear it out (`endingFor`). When they show
   * another ending, that one is kept instead, and when they show none, nothing
   * is kept. Every other outcome is free, and is kept as the widget reports it.
   *
   * The step checked is the one the report names: the step whose reply the
   * ending rests on (`GuideReport.step`). A step asked after it, like the look
   * at what using the last control did, can be written before a report that
   * was held up, and must not change how the guide ended. A report from a
   * widget too old to name one is checked against the newest step on record,
   * and so is one whose step never appears.
   *
   * A guide's last step is written after its reply has gone out, and the
   * widget reports the ending straight after that reply, as the page may be
   * about to go. So the report can arrive before the guide's row exists, or
   * before the row of the step that bears out "finished" does. It waits for
   * this process's own writes for that guide, then looks a few more times in
   * case the step was answered by another process.
   *
   * `network` is the network the report came from, hashed with the site's id
   * (`networkHash` in learned.ts), or empty when it is not known. A guide kept
   * as finished counts it for the routes its steps used (`trustRoutes`).
   */
  report(site: SiteContext, guide: string, report: GuideReport, network = ""): Promise<void> {
    return this.quietly("record how a guide ended", async () => {
      await this.writing.get(guide);
      const waits = this.reportWaitsMs;
      for (const [look, wait] of waits.entries()) {
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        // The step the report names when it is on record, and otherwise the newest (`named` says which it is). The kind
        // of reply is read through to_jsonb, so a database without its column (db/migrations/0005) still answers.
        const named = report.step ?? null;
        const [found] = await this.sql`
          select g.outcome is null as open, step.n, step.status, step.pointed, step.model, step.mode, step.reason, step.blocked, step.named
          from guides g
          left join lateral (
            select s.n, s.status, s.target_role is not null as pointed, s.model, to_jsonb(s)->>'mode' as mode, to_jsonb(s)->>'reason' as reason,
              s.target_role is null and s.said = ${BLOCKED_SAY} as blocked, s.n = ${named} as named
            from steps s where s.guide_id = g.id order by s.n = ${named} desc nulls last, s.n desc limit 1
          ) step on true
          where g.id = ${guide} and g.site_id = ${site.id}`;
        if (!found) continue;
        let outcome = report.outcome;
        if (outcome === "finished" && found.open) {
          const { n, status, pointed, model, mode, reason, blocked } = found;
          outcome = endingFor(n === null ? undefined : { n, status, pointed: pointed === true, model, mode, reason, blocked: blocked === true });
          // The step the report names is not on record yet, or nothing on record settles it: the step that would may
          // still be on its way here. At the last look, what is on record is what is kept.
          const waiting = named !== null && found.named !== true;
          if ((waiting || !outcome) && look < waits.length - 1) continue;
          if (outcome !== "finished") {
            const which = n === null ? "it has no step on record" : `${found.named === true ? "" : "the newest "}step ${n} on record does not bear it out`;
            console.warn(`Guide ${guide} on ${site.id} was reported finished, but ${which}, so ${outcome ? `it is kept as ${outcome}` : "no ending is kept"}.`);
          }
        }
        if (outcome && found.open) {
          // Only the report whose write ends the guide goes on. Reports of one guide sent together, from as many
          // networks, all find it open, and each would count its own network for the routes of one guide.
          const ended = (await this.sql`
            update guides set outcome = ${outcome}, ended_at = now() where id = ${guide} and site_id = ${site.id} and outcome is null returning id`) as unknown[];
          // Only an ending the record bears out confirms the routes behind its steps.
          if (ended.length && outcome === "finished")
            await this.quietly("trust a finished guide's routes (has db/migrations/0018 been applied?)", () => this.trustRoutes(site.id, guide, network));
          // A finished guide is billed. It goes to Stripe now if its company pays by usage, and only if the database kept it as finished.
          // The site's hourly sweep catches any that don't get through.
          if (ended.length && outcome === "finished" && this.stripeKey) await reportUsage(this.sql, this.stripeKey, { guide });
        }
        if (report.helped !== undefined) {
          await this.sql`update guides set helped = ${report.helped} where id = ${guide} and site_id = ${site.id}`;
          // A person saying it did not help is doubt enough: none of this guide's routes is served again until another guide confirms it.
          if (report.helped === false) await this.quietly("take a guide's routes out of use", () => this.distrustRoutes(site.id, guide));
        }
        // Last, because the column came later (db/migrations/0006): if it is missing, what is above is already written.
        if (report.handoff) {
          await this.sql`update guides set handed_off = true where id = ${guide} and site_id = ${site.id}`;
        }
        return;
      }
      // Its first question was refused by the off switch or the budget, which records nothing, or it was never asked here.
      console.warn(`A report for guide ${guide} on ${site.id} came for a guide that is not on record.`);
    });
  }

  /** The route stored for a question on a screen, if any. */
  async findRoute(siteId: string, lookup: RouteLookup): Promise<StoredRoute | undefined> {
    const rows = (await this.sql`
      select target_key, target_context, say, status, confirmed from routes
      where site_id = ${siteId} and goal_key = ${lookup.goalKey} and path = ${lookup.path} and dialog = ${lookup.dialog} and after_key = ${lookup.afterKey}`) as {
      target_key: string;
      target_context: string;
      say: string;
      status: "continue" | "done";
      confirmed: boolean;
    }[];
    const row = rows[0];
    return row ? { targetKey: row.target_key, targetContext: row.target_context, say: row.say, status: row.status, confirmed: row.confirmed } : undefined;
  }

  /**
   * A finished guide vouches for the route behind each of its steps that the
   * visitor followed: every step whose next step was not a wrong click, and
   * its last step. Only steps that were looked up count.
   *
   * What is counted is the network the report came from (`network`), as a
   * learned label counts its visitors' networks: a route is trusted once
   * finished guides from `routeNetworks` different networks have used it, so
   * one caller cannot trust a route of its own making however many guides it
   * finishes. A step that used the change a trusted route holds beside it
   * (next_*, see `recordStep`) vouches for the change instead, and the change
   * takes the route's place once it has as many networks.
   *
   * A step vouches only for what it was given: the same control, the same
   * sentence and the same status, since all three are served. A step whose
   * answer was replaced before its guide finished vouches for neither.
   */
  private async trustRoutes(siteId: string, guide: string, network: string): Promise<void> {
    await this.sql`
      update routes r set (networks, confirmed, confirmed_at, uses, updated_at) = (
        select vouched, r.confirmed or cardinality(vouched) >= ${this.routeNetworks},
          coalesce(r.confirmed_at, case when cardinality(vouched) >= ${this.routeNetworks} then now() end), r.uses + 1, now()
        from (
          select case when ${network} = '' or ${network} = any(r.networks) or cardinality(r.networks) >= ${MAX_VISITORS}
            then r.networks else r.networks || ${network}::text end as vouched
        ) counted
      )
      from steps s
      join guides g on g.id = s.guide_id
      left join steps next on next.guide_id = s.guide_id and next.n = s.n + 1
      where g.id = ${guide} and g.site_id = ${siteId} and s.route is not null and s.target_key is not null and s.status <> 'stuck'
        and (next.n is null or not next.strayed)
        and r.site_id = g.site_id and r.goal_key = g.question_key and r.path = s.path and r.dialog = coalesce(s.dialog, '')
        and r.after_key = coalesce(s.after_key, '') and r.target_key = s.target_key and r.target_context = coalesce(s.target_context, '')
        and r.say = s.said and r.status = s.status`;
    const changes = (await this.sql`
      update routes r set next_networks = case when ${network} = '' or ${network} = any(r.next_networks) or cardinality(r.next_networks) >= ${MAX_VISITORS}
          then r.next_networks else r.next_networks || ${network}::text end,
        updated_at = now()
      from steps s
      join guides g on g.id = s.guide_id
      left join steps next on next.guide_id = s.guide_id and next.n = s.n + 1
      where g.id = ${guide} and g.site_id = ${siteId} and s.route is not null and s.target_key is not null and s.status <> 'stuck'
        and (next.n is null or not next.strayed)
        and r.site_id = g.site_id and r.goal_key = g.question_key and r.path = s.path and r.dialog = coalesce(s.dialog, '')
        and r.after_key = coalesce(s.after_key, '') and r.confirmed and r.next_target_key = s.target_key and r.next_target_context = coalesce(s.target_context, '')
        and r.next_say = s.said and r.next_status = s.status
      returning r.goal_key, r.path, r.dialog, r.after_key, cardinality(r.next_networks) >= ${this.routeNetworks} as ready`) as RouteChange[];
    for (const change of changes.filter((row) => row.ready)) {
      // The change has been confirmed as the route itself once was, and now it is the route. Only a new control is a repair.
      await this.sql`
        update routes set target_key = next_target_key, target_context = next_target_context, target_role = next_target_role,
          target_label = next_target_label, say = next_say, status = next_status, networks = next_networks, confirmed_at = now(),
          repairs = repairs + case when (target_key, target_context) = (next_target_key, next_target_context) then 0 else 1 end,
          next_target_key = null, next_target_context = null, next_target_role = null, next_target_label = null, next_say = null, next_status = null,
          next_networks = '{}', updated_at = now()
        where site_id = ${siteId} and goal_key = ${change.goal_key} and path = ${change.path} and dialog = ${change.dialog} and after_key = ${change.after_key}
          and confirmed and next_target_key is not null and cardinality(next_networks) >= ${this.routeNetworks}`;
    }
  }

  /**
   * A guide someone said did not help takes the trust of the routes its steps
   * used, and what had confirmed them: to be served again, a route has to be
   * confirmed from as many networks as at first. A change a trusted route held
   * that the guide used loses the networks that had confirmed it.
   */
  private async distrustRoutes(siteId: string, guide: string): Promise<void> {
    await this.sql`
      update routes r set confirmed = false, confirmed_at = null, networks = '{}', next_target_key = null, next_target_context = null,
        next_target_role = null, next_target_label = null, next_say = null, next_status = null, next_networks = '{}', updated_at = now()
      from steps s join guides g on g.id = s.guide_id
      where g.id = ${guide} and g.site_id = ${siteId} and s.route is not null and s.target_key is not null
        and r.site_id = g.site_id and r.goal_key = g.question_key and r.path = s.path and r.dialog = coalesce(s.dialog, '')
        and r.after_key = coalesce(s.after_key, '') and r.target_key = s.target_key`;
    await this.sql`
      update routes r set next_networks = '{}', updated_at = now()
      from steps s join guides g on g.id = s.guide_id
      where g.id = ${guide} and g.site_id = ${siteId} and s.route is not null and s.target_key is not null
        and r.site_id = g.site_id and r.goal_key = g.question_key and r.path = s.path and r.dialog = coalesce(s.dialog, '')
        and r.after_key = coalesce(s.after_key, '') and r.next_target_key = s.target_key`;
  }

  /**
   * Whether a network is still within its day's share of new rows on a site,
   * now that `total` is how many it has been counted on today, this outline's
   * `rows` included. The first outline past the share says so in the log.
   * Once a day this process also deletes the counts of earlier days, which
   * nothing reads.
   */
  private async withinDay(site: SiteContext, total: number, rows: number, what: string): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.clearedDay !== today) {
      this.clearedDay = today;
      await this.sql`delete from outline_network_days where day < current_date`;
    }
    if (total <= this.networkRowsADay) return true;
    if (total - rows <= this.networkRowsADay) console.warn(`A network has taught ${site.id} ${this.networkRowsADay} new ${what} today, so it teaches it nothing more until tomorrow.`);
    return false;
  }

  private async quietly(what: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      console.error(`Couldn't ${what}:`, error instanceof Error ? error.message : error);
    }
  }
}
