import {
  GUIDE_ID,
  GUIDE_OUTCOMES,
  STREAM_TYPE,
  type GuideOutcome,
  type GuideReport,
  type PublicSiteConfig,
  type SiteContext,
  type SnapElement,
  type Snapshot,
  type TurnReply,
  type TurnRequest,
} from "../shared/types.ts";
import type { Alert, Budget, Gate } from "./budget.ts";
import { ceilingFor, measureTurn, TurnError } from "./model.ts";
import type { TurnMeasure } from "./model.ts";

// What the Haptic server answers: the widget file, each site's public
// settings, and the one endpoint the widget calls for every step of a guide.
// It is written against the web's own Request and Response, so the same code
// runs on Node (src/server/index.ts) and on a Cloudflare Worker (worker/index.ts).
// Each of those supplies the parts that differ: where sites are kept, where
// the widget file comes from, and how callers are slowed down.

export interface AppParts {
  /**
   * The site with this id. `hurry` is true when a visitor is waiting on a
   * step, so a host that keeps sites in memory should answer from what it
   * holds and bring it up to date afterwards.
   */
  loadSite(id: string, hurry?: boolean): Promise<SiteContext | undefined>;
  /** The widget bundle, as the text of one script. */
  widget(): Promise<string>;
  /** How long browsers may keep the widget before asking again, in seconds. 0 for never. */
  widgetMaxAge: number;
  /** True when this caller has asked for too many steps lately. */
  overLimit(key: string): boolean | Promise<boolean>;
  /**
   * Told when a guide's first question arrives, before the model is asked.
   * Recording it here means a guide whose first step fails, or whose visitor
   * leaves before the answer, is still on record. Must not throw.
   */
  onAsk?(request: TurnRequest, site: SiteContext, origin: string | undefined): void;
  /** The off switch, as this host keeps it: true stops every model call for the site. A site's own `off` is checked as well. */
  isOff?(site: SiteContext): boolean | Promise<boolean>;
  /** Keeps what each site has spent on the model, so a site can be stopped at its limit. Without one, nothing is capped. */
  budget?: Budget;
  /** Told when a site passes half, four fifths or all of a limit. Must not throw. */
  onAlert?(site: SiteContext, alert: Alert): void;
  /** Work to finish after the reply has gone, like adding a step's cost to the budget. A Worker has to be told about it, or it is cut short. */
  background?(work: Promise<unknown>): void;
  /** Told about each finished step, for logging. Must not throw. */
  onTurn?(request: TurnRequest, measure: TurnMeasure, site: SiteContext, origin: string | undefined): void;
  /**
   * Told each time the script calls from a page, allowed or not. This is how
   * an install is seen to be live, and why it looks dead when the origin is not
   * on the list. Must not throw.
   */
  onSeen?(site: SiteContext, origin: string, allowed: boolean): void;
  /** Told how a guide ended, or whether it helped. Must not throw. */
  onReport?(site: SiteContext, guide: string, report: GuideReport): void;
}

const MAX_BODY_BYTES = 512 * 1024;

/**
 * What a visitor reads when the server answers without asking the model. The
 * words are fixed, so nothing typed into the ask box or planted on a page can
 * change them. They go out as an ordinary reply, which every copy of the
 * widget already knows how to show, marked `paused` so the widget does not
 * take it for a guide that finished.
 */
export const FIXED_SAY = {
  off: "The guide is switched off for now.",
  /** The site has spent its budget for the hour or the day. */
  resting: "The guide is resting for now. Try again in a little while.",
  /** One visitor has used their steps for the day. */
  visitorLimit: "That's as much as the guide can do for you today. Try again tomorrow.",
} as const;

const fixedReply = (say: string): TurnReply => ({ target: null, status: "done", say, paused: true });

/** Returns the handler. It answers `undefined` for addresses that are not its own, so a host can serve other things. */
export function createApp(parts: AppParts) {
  return async function handle(request: Request, caller: string): Promise<Response | undefined> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? undefined;
    // Which origins may read a response is decided per site below. This only says the API speaks CORS.
    const cors: Record<string, string> = origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type, Accept", "Access-Control-Max-Age": "86400" },
      });
    }

    if (request.method === "GET" && url.pathname === "/widget.js") {
      const cache = parts.widgetMaxAge > 0 ? `public, max-age=${parts.widgetMaxAge}` : "no-store";
      return new Response(await parts.widget(), { headers: { ...cors, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": cache } });
    }

    const siteMatch = /^\/v1\/sites\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && siteMatch) {
      const site = await parts.loadSite(decodeURIComponent(siteMatch[1] ?? ""));
      if (!site) return json(404, { error: "No site with that id. Check the data-site attribute on the script tag." });
      const allowed = originAllowed(site, origin);
      if (origin) parts.onSeen?.(site, origin, allowed);
      if (!allowed) return json(403, { error: `${origin} isn't an allowed origin for this site.` });
      const config: PublicSiteConfig = { name: site.name, appearance: site.appearance };
      if (await switchedOff(parts, site)) config.off = true;
      return json(200, config);
    }

    if (request.method === "POST" && url.pathname === "/v1/turn") {
      const turn = parseTurn(await readJson(request));
      if (!turn) return json(400, { error: "That isn't a valid turn request." });
      const site = await parts.loadSite(turn.site, true);
      if (!site) return json(404, { error: "No site with that id." });
      if (!originAllowed(site, origin)) return json(403, { error: `${origin} isn't an allowed origin for this site.` });
      if (await parts.overLimit(`${site.id} ${caller}`)) return json(429, { error: "Too many requests. Try again in a minute." });
      if (turn.step === 0 && turn.guide) parts.onAsk?.(turn, site, origin);

      const streamed = (request.headers.get("Accept") ?? "").includes(STREAM_TYPE);
      // A page that was open before the switch was thrown still has its launcher, so a step can arrive.
      if (await switchedOff(parts, site)) {
        const reply = fixedReply(FIXED_SAY.off);
        return streamed ? lines(cors, async (line) => line(reply)) : json(200, reply);
      }

      const admitted = await askBudget(parts, site, caller, turn);
      if (!admitted.gate.open) {
        const reply = fixedReply(admitted.gate.why === "caller" ? FIXED_SAY.visitorLimit : FIXED_SAY.resting);
        return streamed ? lines(cors, async (line) => line(reply)) : json(200, reply);
      }

      // A widget that asks for it gets the step as it forms: the control to point at first, then the whole reply.
      if (streamed) return streamTurn(parts, site, turn, caller, admitted, cors, origin);

      try {
        const measure = await measureTurn(site, turn);
        charge(parts, site, caller, admitted, measure.usd, 1);
        parts.onTurn?.(turn, measure, site, origin);
        return json(200, measure.reply);
      } catch (error) {
        charge(parts, site, caller, admitted, paidFor(error), 0);
        if (!(error instanceof TurnError)) throw error;
        console.error(`turn ${site.id}: ${error.message}`);
        return json(error.status, { error: error.message });
      }
    }

    // How a guide ended, and later whether it helped. The widget sends it as
    // text/plain, which needs no preflight, so it still arrives when the page
    // is being left.
    const reportMatch = /^\/v1\/guides\/([^/]+)\/report$/.exec(url.pathname);
    if (request.method === "POST" && reportMatch) {
      const guide = reportMatch[1] ?? "";
      const report = parseReport(await readJson(request));
      if (!GUIDE_ID.test(guide) || !report) return json(400, { error: "That isn't a valid report." });
      const site = await parts.loadSite(report.site, true);
      if (!site) return json(404, { error: "No site with that id." });
      if (!originAllowed(site, origin)) return json(403, { error: `${origin} isn't an allowed origin for this site.` });
      if (await parts.overLimit(`${site.id} ${caller}`)) return json(429, { error: "Too many requests. Try again in a minute." });
      parts.onReport?.(site, guide, report);
      return json(200, { ok: true });
    }

    return undefined;
  };
}

function parseReport(body: unknown): GuideReport | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw = body as Record<string, unknown>;
  if (typeof raw.site !== "string") return undefined;
  const report: GuideReport = { site: raw.site };
  if (GUIDE_OUTCOMES.includes(raw.outcome as GuideOutcome)) report.outcome = raw.outcome as GuideOutcome;
  if (typeof raw.helped === "boolean") report.helped = raw.helped;
  return report.outcome || report.helped !== undefined ? report : undefined;
}

/**
 * One JSON value per line. `{"target":"e12"}` goes out the moment the model has
 * named the control, and the full reply follows as the last line. The status
 * line is already sent by then, so a failure arrives as `{"error":…,"code":…}`.
 */
function streamTurn(
  parts: AppParts,
  site: SiteContext,
  turn: TurnRequest,
  caller: string,
  admitted: Admitted,
  cors: Record<string, string>,
  origin: string | undefined,
): Response {
  return lines(cors, async (line) => {
    try {
      const measure = await measureTurn(site, turn, undefined, (id) => line({ target: id }));
      charge(parts, site, caller, admitted, measure.usd, 1);
      parts.onTurn?.(turn, measure, site, origin);
      line(measure.reply);
    } catch (error) {
      charge(parts, site, caller, admitted, paidFor(error), 0);
      const known = error instanceof TurnError;
      console.error(`turn ${site.id}:`, known ? error.message : error);
      line({ error: known ? error.message : "Something went wrong.", code: known ? error.status : 500 });
    }
  });
}

/** A response in the streamed format. `write` is handed the function that sends one line. */
function lines(cors: Record<string, string>, write: (line: (value: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await write((value) => controller.enqueue(encoder.encode(JSON.stringify(value) + "\n")));
      controller.close();
    },
  });
  return new Response(body, { headers: { ...cors, "Content-Type": STREAM_TYPE, "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

/** How long a step waits to hear whether it may go ahead. A budget that is slow is treated like one that cannot be reached. */
const BUDGET_WAIT_MS = 400;

/** What the budget said about a step, and what it set aside for it. */
interface Admitted {
  gate: Gate;
  /** Names what was set aside. It can come after the step has gone ahead, when the budget was slow to answer. */
  hold: Promise<number | undefined>;
}

/**
 * Whether the site may make another model call. When it may, the most the
 * step could cost is set aside until `charge` settles it. If the budget cannot
 * be reached, or takes too long, the step goes ahead: the spend limit at the
 * model provider is what holds when this fails, and a visitor should not lose
 * their guide to it.
 */
async function askBudget(parts: AppParts, site: SiteContext, caller: string, turn: TurnRequest): Promise<Admitted> {
  const budget = parts.budget;
  if (!budget) return { gate: { open: true }, hold: Promise.resolve(undefined) };
  const asked = Promise.resolve()
    .then(() => budget.admit(site, caller, ceilingFor(site, turn)))
    .catch((error) => {
      console.error(`budget ${site.id}: couldn't be reached, so the step went ahead.`, error);
      return undefined;
    });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), BUDGET_WAIT_MS);
  });
  const first = await Promise.race([asked, late]);
  clearTimeout(timer);
  if (first === "late") console.error(`budget ${site.id}: no answer in ${BUDGET_WAIT_MS} ms, so the step went ahead.`);
  return { gate: first === "late" || !first ? { open: true } : first.gate, hold: asked.then((admission) => admission?.hold) };
}

/**
 * Settles a step with the site's budget, after the reply has gone: adds what
 * it cost, gives back what was set aside for it, and passes on any alert that
 * sets off. A step that failed is settled as well, with `steps` 0.
 */
function charge(parts: AppParts, site: SiteContext, caller: string, admitted: Admitted, usd: number, steps: number) {
  const budget = parts.budget;
  if (!budget) return;
  const work = admitted.hold
    .then((hold) => budget.settle(site, caller, hold, usd, steps))
    .then((report) => {
      for (const alert of report.alerts) parts.onAlert?.(site, alert);
    })
    .catch((error) => console.error(`budget ${site.id}: a step's cost couldn't be added.`, error));
  parts.background?.(work);
}

/** What a model call that failed still cost. The provider counts a reply that was cut short or could not be read. */
const paidFor = (error: unknown): number => (error instanceof TurnError ? error.usd : 0);

/** Off for this site, by the site's own setting or by the host's switch. */
async function switchedOff(parts: AppParts, site: SiteContext): Promise<boolean> {
  return site.off === true || (await parts.isOff?.(site)) === true;
}

/** The widget only works on origins the site lists. Requests with no Origin header (same-origin GETs, curl) pass. */
function originAllowed(site: SiteContext, origin: string | undefined): boolean {
  return !origin || site.allowedOrigins.includes(origin);
}

/** The body as JSON, or undefined when it is too big or isn't JSON. */
async function readJson(request: Request): Promise<unknown> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

// Customers' pages are untrusted input: everything is checked and capped before it reaches a prompt.

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
const texts = (value: unknown, count: number, max: number): string[] =>
  Array.isArray(value) ? value.slice(0, count).map((item) => text(item, max)).filter(Boolean) : [];

export function parseTurn(body: unknown): TurnRequest | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw = body as Record<string, unknown>;
  const snap = raw.snapshot as Record<string, unknown> | undefined;
  const goal = text(raw.goal, 300).trim();
  if (!goal || typeof raw.site !== "string" || !snap || !Array.isArray(snap.elements)) return undefined;

  const elements: SnapElement[] = [];
  for (const item of snap.elements.slice(0, 400) as Record<string, unknown>[]) {
    if (!item || !/^e\d{1,4}$/.test(text(item.id, 6))) continue;
    const element: SnapElement = { id: text(item.id, 6), role: text(item.role, 24), label: text(item.label, 80) };
    if (item.icon) element.icon = text(item.icon, 40);
    if (item.href) element.href = text(item.href, 200);
    if (item.context) element.context = text(item.context, 120);
    const state = texts(item.state, 6, 16);
    if (state.length) element.state = state;
    if (item.offscreen === "above" || item.offscreen === "below") element.offscreen = item.offscreen;
    elements.push(element);
  }
  const snapshot: Snapshot = {
    path: text(snap.path, 200),
    title: text(snap.title, 80),
    headings: texts(snap.headings, 12, 80),
    text: texts(snap.text, 300, 160),
    elements,
    truncated: snap.truncated === true,
  };
  if (typeof snap.dialog === "string") snapshot.dialog = text(snap.dialog, 60);

  const history = (Array.isArray(raw.history) ? raw.history.slice(-12) : [])
    .map((turn: Record<string, unknown>) => ({ role: turn?.role === "assistant" ? ("assistant" as const) : ("user" as const), text: text(turn?.text, 600) }))
    .filter((turn) => turn.text);

  const request: TurnRequest = { site: raw.site, goal, step: Math.min(Math.max(Number(raw.step) || 0, 0), 100), history, snapshot };
  if (typeof raw.guide === "string" && GUIDE_ID.test(raw.guide)) request.guide = raw.guide;
  if (raw.event) request.event = text(raw.event, 600);
  if (raw.change) request.change = text(raw.change, 2000);
  if (raw.offTrack === true) request.offTrack = true;
  return request;
}
