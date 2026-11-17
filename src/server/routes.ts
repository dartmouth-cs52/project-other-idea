import { correctionsFor, isBlocked, type ControlName } from "../shared/corrections.ts";
import { taughtFor } from "../shared/teach.ts";
import { cleanText, normalizePath, questionKey, routeKey, type SiteContext, type SnapElement, type Snapshot, type TurnReply, type TurnRequest } from "../shared/types.ts";

// Verified routes (issue 13). For a question on a screen, the control that was
// right last time, so the same question on the same screen can be answered
// without asking the model. Pure functions only: the storage is in db.ts, and
// the decision of when to look up, compare or serve is in app.ts.
//
// The rules come from the research report's note on the route store:
// - Match the question exactly, after masking and normalizing. No guessing at meaning.
// - Key on the screen as the visitor sees it: the page, any open dialog, and the control they just used.
// - Never point at a control that is not on the live page, and refuse when more than one could be meant.
// - Serve only a route a finished guide has confirmed. On any doubt, ask the model. A miss costs one call.

/** Where a route is looked up: the question, the screen, and the control the previous step used. */
export interface RouteLookup {
  goalKey: string;
  path: string;
  dialog: string;
  afterKey: string;
}

/** A stored route, as the lookup returns it. */
export interface StoredRoute {
  targetKey: string;
  targetContext: string;
  say: string;
  status: "continue" | "done";
  confirmed: boolean;
}

/** The model on record for a step answered from a verified route. No model was asked, and the step cost nothing. */
export const ROUTE_MODEL = "route";

/** What the lookup found for a step. Kept with the step, so the dashboard can say how well routes would do. */
export type RouteOutcome = "miss" | "unconfirmed" | "unmatched" | "agreed" | "disagreed" | "served";

export interface RouteResult {
  lookup: RouteLookup;
  outcome: RouteOutcome;
}

/**
 * The wording the widget uses when the model has pointed at the same control
 * twice with nothing changing (`hintIfStuck` in src/widget/guide.ts), and the
 * wording widgets used before it. A step asked that way is not a repeat of anything.
 */
const LOOP_NUDGE = /twice from this page and nothing changed|again, but the user already used it/;

/**
 * The key to look a step up under, or undefined when this step should go to
 * the model whatever is stored: after a wrong click, when the widget is
 * correcting a loop, for a later step whose previous control is unknown, or
 * when Haptic is to do the step itself (Do it with me), whose replies say what
 * to do and not only where.
 */
export function routeLookup(turn: TurnRequest): RouteLookup | undefined {
  if (turn.offTrack || turn.mode === "act" || LOOP_NUDGE.test(turn.event ?? "")) return undefined;
  // A guide's first step is the question with nothing done yet. Any later one is keyed on the control just used.
  const first = turn.step === 0 && !turn.event;
  if (!first && !turn.after) return undefined;
  const goalKey = questionKey(turn.goal);
  if (!goalKey) return undefined;
  return {
    goalKey,
    path: normalizePath(turn.snapshot.path || "/"),
    dialog: cleanText(turn.snapshot.dialog ?? "", 60),
    afterKey: first ? "" : (turn.after ?? "").slice(0, 300),
  };
}

/** Where a control sits, masked the way a route stores it. */
export function contextOf(element: Pick<SnapElement, "context">): string {
  return cleanText(element.context ?? "", 120);
}

/**
 * The control on this page a route points at: the id of the one element with
 * the route's key and context. Undefined when none matches, when it is
 * disabled, or when more than one does, such as an Edit button on every row.
 */
export function matchRoute(route: Pick<StoredRoute, "targetKey" | "targetContext">, snapshot: Snapshot): string | undefined {
  const matches = snapshot.elements.filter((element) => routeKey(element) === route.targetKey && contextOf(element) === route.targetContext);
  if (matches.length !== 1) return undefined;
  const [only] = matches;
  return only && !only.state?.includes("disabled") ? only.id : undefined;
}

/**
 * What the lookup found, given the model's answer. A route that is not
 * trusted, or that does not match exactly one control, is not compared:
 * it could not have been served.
 */
export function compareRoute(route: StoredRoute | undefined, reply: TurnReply, snapshot: Snapshot): Exclude<RouteOutcome, "served"> {
  if (!route) return "miss";
  if (!route.confirmed) return "unconfirmed";
  const id = matchRoute(route, snapshot);
  if (!id) return "unmatched";
  return reply.target === id ? "agreed" : "disagreed";
}

/**
 * True for an answer a route may hold. Pointing again at the control just
 * used is how a loop looks, and how each page of a form with the same Next
 * button looks: the key cannot tell those apart, so such an answer is never
 * stored or served, and the model decides each time.
 */
export function storable(lookup: RouteLookup, targetKey: string): boolean {
  return targetKey !== lookup.afterKey;
}

/**
 * The reply a trusted route gives on this page, or undefined when it cannot be
 * served here. Never a control the site's owner ruled out (`blocked`), even
 * one ruled out after the route was learned.
 */
export function servedReply(route: StoredRoute | undefined, snapshot: Snapshot, lookup?: RouteLookup, blocked?: ControlName[]): TurnReply | undefined {
  if (!route?.confirmed) return undefined;
  if (lookup && !storable(lookup, route.targetKey)) return undefined;
  const target = matchRoute(route, snapshot);
  if (!target || isBlocked(snapshot.elements.find((element) => element.id === target), blocked)) return undefined;
  return { target, status: route.status, say: route.say };
}

/**
 * True when the site's owner has said something about this step that a route
 * learned before it would not know: a correction for this question or this
 * page, or a route someone at the company taught for the same task. The model
 * reads those with the question (src/server/prompt.ts), so such a step is
 * answered by the model even in serve mode, and the route is only compared
 * with its answer. A route the model then answers differently loses its trust.
 */
export function ownerSteers(site: Pick<SiteContext, "corrections" | "taught">, turn: TurnRequest): boolean {
  return correctionsFor(site.corrections, turn.snapshot.path, turn.goal).length > 0 || taughtFor(site.taught, turn.goal) !== undefined;
}

// The query behind the dashboard card and `npm run routes:report` lives in
// src/shared/route-metrics.ts, which has no imports, so the website can use it too.
export { ROUTE_METRICS_SQL, type RouteMetrics } from "../shared/route-metrics.ts";
