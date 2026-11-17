import {
  ACT_VERSION,
  GUIDE_ID,
  GUIDE_OUTCOMES,
  MAX_ASKED,
  STREAM_TYPE,
  type GuideOutcome,
  type GuideReport,
  type PageOutline,
  type PublicSiteConfig,
  type SiteContext,
  type SnapElement,
  type Snapshot,
  type TurnReply,
  type TurnRequest,
} from "../shared/types.ts";
import { publicActing } from "./acting.ts";
import type { Alert, Budget, Gate } from "./budget.ts";
import { parseHandoff, publicHandoff, sendHandoff } from "./handoff.ts";
import { parseOutlineReport, visitorHash } from "./learned.ts";
import { ceilingFor, measureTurn, TurnCancelled, TurnError } from "./model.ts";
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
  /** The code that acts, widget-act.js, which the widget loads from beside itself on a site with acting on. Without it, such a site is guided by pointer. */
  widgetActing?(): Promise<string>;
  /** How long browsers may keep the widget before asking again, in seconds. 0 for never. */
  widgetMaxAge: number;
  /** True when this caller has asked for too many steps lately. */
  overLimit(key: string): boolean | Promise<boolean>;
  /**
   * Told when a guide's first question is about to be put to the model.
   * Recording it here means a guide whose first step fails, or whose visitor
   * leaves before the answer, is still on record. It is not told of a
   * question the off switch or the budget refused: the model is never asked
   * that one, so recording it would let anything that can send a request put
   * questions on a site's dashboard for nothing. Must not throw.
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
   * Told when the widget hung up before a step was ready, because the page
   * changed while the model was answering. The widget asks for the step again
   * from the new page, so the dropped one is only counted. Must not throw.
   */
  onCancel?(request: TurnRequest, site: SiteContext): void;
  /**
   * Told each time the script calls from a page, allowed or not. This is how
   * an install is seen to be live, and why it looks dead when the origin is not
   * on the list. Must not throw.
   */
  onSeen?(site: SiteContext, origin: string, allowed: boolean): void;
  /**
   * Told about an outline of a page a visitor saw, for learning the site.
   * `visitor` is already hashed with the site's id. Must not throw.
   */
  onOutline?(site: SiteContext, visitor: string, outline: PageOutline): void;
  /** Told how a guide ended, whether it helped, or that the visitor asked for a person. Must not throw. */
  onReport?(site: SiteContext, guide: string, report: GuideReport): void;
  /** How the handoff form is posted to a company's webhook. The web's own fetch unless a test says otherwise. */
  fetch?: typeof fetch;
  /** True on a developer's machine, where a webhook may be on the same machine. */
  localWebhooks?: boolean;
}

const MAX_BODY_BYTES = 512 * 1024;

/**
 * What a visitor reads when the server answers without asking the model. The
 * words are fixed, so nothing typed into the ask box or planted on a page can
 * change them. They go out as an ordinary reply, which every copy of the
 * widget already knows how to show, marked `paused` so the widget does not
 * take it for a guide that finished. Its status is "stuck", so a widget from
 * before the mark existed, still cached in a visitor's browser, ends the
 * guide as one that found no way forward, which is not billed, and not as one
 * that arrived.
 */
export const FIXED_SAY = {
  off: "The guide is switched off for now.",
  /** The site has spent its budget for the hour or the day. */
  resting: "The guide is resting for now. Try again in a little while.",
  /** One visitor has used their steps for the day. */
  visitorLimit: "That's as much as the guide can do for you today. Try again tomorrow.",
} as const;

const fixedReply = (say: string): TurnReply => ({ target: null, status: "stuck", say, paused: true });

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

    if (request.method === "GET" && (url.pathname === "/widget.js" || (url.pathname === "/widget-act.js" && parts.widgetActing))) {
      const cache = parts.widgetMaxAge > 0 ? `public, max-age=${parts.widgetMaxAge}` : "no-store";
      const script = url.pathname === "/widget.js" ? await parts.widget() : await parts.widgetActing!();
      return new Response(script, { headers: { ...cors, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": cache } });
    }

    const siteMatch = /^\/v1\/sites\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && siteMatch) {
      const site = await parts.loadSite(decodeURIComponent(siteMatch[1] ?? ""));
      if (!site) return json(404, { error: "No site with that id. Check the data-site attribute on the script tag." });
      const allowed = mayRead(site, origin);
      if (origin) parts.onSeen?.(site, origin, allowed);
      if (!allowed) return json(403, { error: refusal(origin) });
      const config: PublicSiteConfig = { name: site.name, appearance: site.appearance };
      if (await switchedOff(parts, site)) config.off = true;
      else {
        // Only a site with acting on says anything about it, so every other site's settings read as they always have.
        const acting = publicActing(site);
        if (acting) config.acting = acting;
      }
      if (site.learn === false) config.learn = false;
      if (site.blocked?.length) config.blocked = site.blocked;
      const handoff = publicHandoff(site.handoff);
      if (handoff) config.handoff = handoff;
      return json(200, config);
    }

    if (request.method === "POST" && url.pathname === "/v1/turn") {
      const turn = parseTurn(await readJson(request));
      if (!turn) return json(400, { error: "That isn't a valid turn request." });
      const site = await parts.loadSite(turn.site, true);
      if (!site) return json(404, { error: "No site with that id." });
      if (!mayWrite(site, origin)) return json(403, { error: refusal(origin) });
      if (await parts.overLimit(`${site.id} ${caller}`)) return json(429, { error: "Too many requests. Try again in a minute." });

      const streamed = (request.headers.get("Accept") ?? "").includes(STREAM_TYPE);
      // A page that was open before the switch was thrown still has its launcher, so a step can arrive.
      if (await switchedOff(parts, site)) {
        const reply = fixedReply(FIXED_SAY.off);
        return streamed ? lines(cors, undefined, async (line) => line(reply)) : json(200, reply);
      }

      const admitted = await askBudget(parts, site, caller, turn);
      if (!admitted.gate.open) {
        const reply = fixedReply(admitted.gate.why === "caller" ? FIXED_SAY.visitorLimit : FIXED_SAY.resting);
        return streamed ? lines(cors, undefined, async (line) => line(reply)) : json(200, reply);
      }

      // The question goes on record now that the model is about to be asked, and not before: one refused above is not recorded.
      if (turn.step === 0 && turn.guide) parts.onAsk?.(turn, site, origin);

      // A widget that asks for it gets the step as it forms: the control to point at first, then the whole reply.
      if (streamed) return streamTurn(parts, site, turn, caller, admitted, cors, origin, request.signal);

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
    // is being left. It is the widget's word: whoever keeps it decides what
    // of it to believe (`Store.report` keeps "finished", which is billed, only
    // when the steps this server recorded bear it out).
    const reportMatch = /^\/v1\/guides\/([^/]+)\/report$/.exec(url.pathname);
    if (request.method === "POST" && reportMatch) {
      const guide = reportMatch[1] ?? "";
      const report = parseReport(await readJson(request));
      if (!GUIDE_ID.test(guide) || !report) return json(400, { error: "That isn't a valid report." });
      const site = await parts.loadSite(report.site, true);
      if (!site) return json(404, { error: "No site with that id." });
      if (!mayWrite(site, origin)) return json(403, { error: refusal(origin) });
      if (await parts.overLimit(`${site.id} ${caller}`)) return json(429, { error: "Too many requests. Try again in a minute." });
      parts.onReport?.(site, guide, report);
      return json(200, { ok: true });
    }

    // An outline of a page a visitor saw, for learning the site. Sent as
    // text/plain, which needs no preflight. Answered at once: what is learned
    // is written after the response, and never on a step's path.
    if (request.method === "POST" && url.pathname === "/v1/outline") {
      const report = parseOutlineReport(await readJson(request));
      if (!report) return json(400, { error: "That isn't a valid outline." });
      const site = await parts.loadSite(report.site, true);
      if (!site) return json(404, { error: "No site with that id." });
      if (!mayWrite(site, origin)) return json(403, { error: refusal(origin) });
      if (await parts.overLimit(`${site.id} outline ${caller}`)) return json(429, { error: "Too many requests. Try again in a minute." });
      // Without the widget's random id there is no way to count this visitor once, so the outline isn't used.
      if (site.learn === false || !report.visitor) return json(200, { ok: false });
      parts.onOutline?.(site, await visitorHash(site.id, report.visitor), report.outline);
      return json(200, { ok: true });
    }

    // The widget's handoff form: an email address and a note, with the
    // conversation so far. It is passed on to the company's webhook and not kept.
    if (request.method === "POST" && url.pathname === "/v1/handoff") {
      const form = parseHandoff(await readJson(request));
      if (!form) return json(400, { error: "That isn't a valid handoff. It needs an email address." });
      const site = await parts.loadSite(form.site);
      if (!site) return json(404, { error: "No site with that id." });
      if (!mayWrite(site, origin)) return json(403, { error: refusal(origin) });
      // Its own allowance, so a burst of steps doesn't cost someone their way to a person, and the reverse.
      if (await parts.overLimit(`${site.id} handoff ${caller}`)) return json(429, { error: "Too many requests. Try again in a minute." });
      if (!site.handoff?.webhook) return json(404, { error: "This site has nowhere to send that." });
      const sent = await sendHandoff(site, form, origin, parts.fetch ?? fetch, parts.localWebhooks === true);
      if (!sent) return json(502, { error: "That couldn't be passed on." });
      if (form.guide) parts.onReport?.(site, form.guide, { site: site.id, handoff: true });
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
  if (raw.handoff === true) report.handoff = true;
  return report.outcome || report.helped !== undefined || report.handoff ? report : undefined;
}

/**
 * One JSON value per line. `{"target":"e12"}` goes out the moment the model has
 * named the control, and the full reply follows as the last line. On a site
 * with Answers on, `{"mode":"answer"}` goes out before either, so the widget
 * knows what kind of reply is coming. The status line is already sent by
 * then, so a failure arrives as `{"error":…,"code":…}`.
 */
function streamTurn(
  parts: AppParts,
  site: SiteContext,
  turn: TurnRequest,
  caller: string,
  admitted: Admitted,
  cors: Record<string, string>,
  origin: string | undefined,
  /** The request's own signal. A Worker aborts it when the caller goes away. */
  gone?: AbortSignal,
): Response {
  return lines(cors, gone, async (line, signal) => {
    try {
      const measure = await measureTurn(site, turn, undefined, { onMode: (mode) => line({ mode }), onTarget: (id) => line({ target: id }) }, signal);
      charge(parts, site, caller, admitted, measure.usd, 1);
      parts.onTurn?.(turn, measure, site, origin);
      line(measure.reply);
    } catch (error) {
      charge(parts, site, caller, admitted, paidFor(error), 0);
      if (error instanceof TurnCancelled) {
        console.log(`turn ${site.id} step ${turn.step}: dropped, the widget hung up.`);
        return parts.onCancel?.(turn, site);
      }
      const known = error instanceof TurnError;
      console.error(`turn ${site.id}:`, known ? error.message : error);
      line({ error: known ? error.message : "Something went wrong.", code: known ? error.status : 500 });
    }
  });
}

/**
 * A response in the streamed format. `write` is handed the function that
 * sends one line, and a signal that is aborted if the caller hangs up first.
 * After that, lines go nowhere.
 */
function lines(cors: Record<string, string>, gone: AbortSignal | undefined, write: (line: (value: unknown) => void, signal: AbortSignal) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const hungUp = new AbortController();
  // Node cancels the response when the caller goes away. A Worker aborts the request's signal instead.
  gone?.addEventListener("abort", () => hungUp.abort());
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await write((value) => {
        if (!hungUp.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      }, hungUp.signal);
      if (!hungUp.signal.aborted) controller.close();
    },
    cancel() {
      hungUp.abort();
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

/** One step in the server's log. Every value is a number, a yes or no, or a name from Haptic's own code. */
export type TurnCounts = Record<string, string | number | boolean>;

/** The roles the widget's reading gives a control. Any other text in a request's role is logged as "other", so nothing a page wrote reaches the log. */
const LISTED_ROLES = new Set([
  "button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "checkbox", "radio", "switch",
  "combobox", "treeitem", "textbox", "searchbox", "slider", "spinbutton", "select", "clickable", "gridcell",
]);

/**
 * One step as counts, for the server's log: nothing the visitor wrote and
 * nothing from their page, not even its address. The fields on acting are
 * there only when the widget asked to act: whether it was answered in act
 * mode (or why not), what the model said to do, whether the server took
 * over a click the model had left to the visitor, what the server's check
 * left and why it removed the rest, and whether the step was the hand-over.
 */
export function turnCounts(request: TurnRequest, measure: TurnMeasure): TurnCounts {
  const { reply } = measure;
  const counts: TurnCounts = {
    haptic: "turn",
    site: request.site,
    version: request.version ?? 1,
    step: request.step,
    closing: request.closing === true,
    model: measure.model,
    ms: measure.ms,
    msToTarget: measure.msToTarget,
    status: reply.status,
    pointed: reply.target !== null,
    // "pointed": the server pointed at the control the sentence named. "asked": the model was asked again. "logged": neither.
    recheck: measure.recheck ? (measure.recheck.pointed ? "pointed" : measure.recheck.asked ? "asked" : "logged") : "none",
  };
  if (!measure.acting) return counts;
  counts.acting = reply.mode === "act" ? "on" : (measure.acting.refused ?? "off");
  if (reply.mode !== "act") return counts;
  counts.capped = measure.acting.capped === true;
  counts.modelDo = measure.acting.modelDo ?? "none";
  // The model left a click on a control Haptic could press to the visitor, and the server made it Haptic's.
  counts.converted = measure.acting.converted === true;
  counts.do = reply.do ?? "none";
  counts.withheld = reply.withheld ?? "none";
  // Which act the check took away, and the kind of control it was on: "choose" on a "radio", "unfit".
  counts.removed = reply.removed ?? "none";
  const role = request.snapshot.elements.find((element) => element.id === reply.target)?.role;
  counts.role = !role ? "none" : LISTED_ROLES.has(role) ? role : "other";
  counts.commits = reply.commits === true;
  counts.handover = reply.status === "done" && reply.target !== null && reply.commits === true && !reply.do;
  return counts;
}

/**
 * Who may read a site's public settings: a page on an origin the site lists,
 * or a request that names no origin, as a browser's GET to its own origin and
 * a command line do. The settings are public, and nothing is written.
 */
function mayRead(site: SiteContext, origin: string | undefined): boolean {
  return !origin || site.allowedOrigins.includes(origin);
}

/**
 * Who may ask for a step, report on a guide, send an outline or post the
 * handoff form: only a request that names an origin the site lists. A browser
 * names the page's origin on every POST and a page cannot change it, so this
 * is what keeps one site's id from being used by another site's pages. A
 * request with no Origin header is never the widget, and is refused.
 *
 * It does not tell the widget from a program: anything that is not a browser
 * can write whatever Origin it likes. So nothing that matters rests on this
 * check alone. What a request may cost is bounded by the site's budget and
 * the caller's limit, and what is billed by what this server recorded itself
 * (`endingFor` in db.ts).
 */
function mayWrite(site: SiteContext, origin: string | undefined): boolean {
  return origin !== undefined && site.allowedOrigins.includes(origin);
}

/** What a refused caller is told. */
const refusal = (origin: string | undefined): string =>
  origin ? `${origin} isn't an allowed origin for this site.` : "This needs an Origin header naming one of the site's allowed origins.";

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

/**
 * The visitor's date, if it is one and could be today somewhere. By time zone
 * alone their date is the server's, the day before or the day after. Anything
 * further off is a clock set wrong, and the server's own date is the better guess.
 */
function plausibleToday(value: unknown, now: Date): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const days = (Date.parse(`${value}T00:00:00Z`) - Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000;
  return Math.abs(days) <= 1 ? value : undefined;
}

export function parseTurn(body: unknown, now: Date = new Date()): TurnRequest | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw = body as Record<string, unknown>;
  const snap = raw.snapshot as Record<string, unknown> | undefined;
  const goal = text(raw.goal, MAX_ASKED).trim();
  if (!goal || typeof raw.site !== "string" || !snap || !Array.isArray(snap.elements)) return undefined;

  const elements: SnapElement[] = [];
  for (const item of snap.elements.slice(0, 400) as Record<string, unknown>[]) {
    if (!item || !/^e\d{1,4}$/.test(text(item.id, 6))) continue;
    const element: SnapElement = { id: text(item.id, 6), role: text(item.role, 24), label: text(item.label, 80) };
    if (item.icon) element.icon = text(item.icon, 40);
    if (item.href) element.href = text(item.href, 200);
    if (item.context) element.context = text(item.context, 120);
    // Room for a state that takes a few words, like one saying a control only shows while the mouse is over its box.
    const state = texts(item.state, 8, 40);
    if (state.length) element.state = state;
    if (item.offscreen === "above" || item.offscreen === "below") element.offscreen = item.offscreen;
    const options = texts(item.options, 12, 30);
    if (options.length) element.options = options;
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
  if (typeof raw.visitor === "string" && /^[0-9a-f-]{36}$/.test(raw.visitor)) request.visitor = raw.visitor;
  if (raw.event) request.event = text(raw.event, 600);
  if (raw.change) request.change = text(raw.change, 2000);
  if (raw.offTrack === true) request.offTrack = true;
  if (raw.closing === true) request.closing = true;
  // A widget from before the version number sends none. That is version 1, and is left unset.
  if (Number.isInteger(raw.version) && (raw.version as number) >= 1 && (raw.version as number) <= 9999) request.version = raw.version as number;
  // Acting is asked for only in these exact words, and only by a widget that understands act replies. Whether the site allows it is decided for each step (acting.ts).
  if (raw.mode === "act" && (request.version ?? 1) >= ACT_VERSION) request.mode = "act";
  const today = plausibleToday(raw.today, now);
  if (today) request.today = today;
  return request;
}
