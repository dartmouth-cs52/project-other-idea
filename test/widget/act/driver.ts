import type { Act, SnapElement } from "../../../src/shared/types.ts";
import { perform, type ActContext, type Heard, type Listening, type Outcome } from "../../../src/widget/act.ts";
import type { ActPlan, ControlKind, GateSession } from "../../../src/widget/gate.ts";
import * as guide from "../../../src/widget/guide.ts";

// Runs in the test page, built with the engine (see harness.ts). A test names
// a control and a step; this makes the plan the gate would have made for it,
// hears the control with the guide's own hearing, and runs the engine.
// Nothing here is the product: it stands in for the guide until the guide
// runs the engine itself.

/** One step as a test writes it. */
export interface Spec {
  /** A selector for the control. */
  target: string;
  act: Act;
  control: ControlKind;
  value?: string;
  want?: boolean;
  mine?: boolean;
  /** The control's name, as the reading would list it. Its aria-label or text when left out. */
  name?: string;
  role?: string;
  tripwire?: boolean;
  /** Stop is pressed this long after the step starts. */
  stopAfterMs?: number;
}

/** What a test reads back. Elements are named by their id, or their tag. */
export interface Summary {
  kind: Outcome["kind"];
  reason?: string;
  event?: string;
  say?: string;
  el?: string;
  did?: { name: string; value?: string; mine?: boolean };
  partly?: { value?: string };
  nothingChanged?: boolean;
  heard?: { how: string; onTarget: boolean };
  ms: number;
  actions: number;
  typed: number;
  opened: boolean;
}

type Hearing = (
  target: Element,
  listed: SnapElement | undefined,
  host: Element,
  listing: Map<Element, SnapElement>,
  how: { anyClick: boolean; keys: string[] },
  done: (acted: { event: string; onTarget: boolean; strayed: boolean; how: Heard["how"] }) => void,
) => () => void;

/** The guide's hearing, which the test build exposes. Without it a step is still checked by the engine alone. */
const waitForAction = (guide as unknown as { waitForAction?: Hearing }).waitForAction;

const host = document.createElement("haptic-test-host");
host.setAttribute("style", "position:fixed;inset:0;pointer-events:none;z-index:2147483647");
document.documentElement.append(host);

const session: GateSession = { words: "", host, actions: 0, typed: 0, failures: 0 };
let stopped = false;
const glides: [number, number][] = [];
const ripples: [number, number][] = [];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const idOf = (el: Element | undefined) => (el ? el.id || el.tagName.toLowerCase() : undefined);

function listen(target: Element, listing: Map<Element, SnapElement>): Listening {
  if (!waitForAction) return { next: (ms) => sleep(ms).then(() => undefined), stop: () => undefined };
  let heard: Heard | undefined;
  let wake: (() => void) | undefined;
  const stop = waitForAction(target, listing.get(target), host, listing, { anyClick: false, keys: [] }, (acted) => {
    heard = { how: acted.how, onTarget: acted.onTarget, event: acted.event };
    wake?.();
  });
  return {
    next: (ms) =>
      new Promise((resolve) => {
        if (heard) return resolve(heard);
        const timer = setTimeout(() => resolve(undefined), ms);
        wake = () => {
          clearTimeout(timer);
          resolve(heard);
        };
      }),
    stop,
  };
}

function nameOf(el: Element): string {
  const named = el.getAttribute("aria-label") ?? (el.getAttribute("aria-labelledby") ? document.getElementById(el.getAttribute("aria-labelledby")!)?.textContent : null);
  const label = el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement ? el.labels?.[0]?.textContent : null;
  return (named ?? label ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
}

async function run(spec: Spec): Promise<Summary> {
  const el = document.querySelector(spec.target);
  if (!el) throw new Error(`Nothing on the page matches ${spec.target}.`);
  const name = spec.name ?? nameOf(el);
  const listed: SnapElement = { id: "e1", role: spec.role ?? el.getAttribute("role") ?? el.tagName.toLowerCase(), label: name };
  const listing = new Map<Element, SnapElement>([[el, listed]]);
  const plan: ActPlan = {
    kind: "act",
    act: spec.act,
    el,
    control: spec.control,
    name,
    ...(spec.value !== undefined ? { value: spec.value } : {}),
    ...(spec.want !== undefined ? { want: spec.want } : {}),
    ...(spec.mine ? { mine: true } : {}),
    tripwire: !!spec.tripwire,
    navigates: false,
  };
  stopped = false;
  if (spec.stopAfterMs !== undefined) setTimeout(() => (stopped = true), spec.stopAfterMs);
  const ctx: ActContext = {
    alive: () => !stopped,
    session,
    config: { acting: {} },
    listing,
    ui: {
      glideTo: (x, y) => {
        glides.push([x, y]);
        return sleep(30);
      },
      ripple: (x, y) => void ripples.push([x, y]),
    },
    listen: (target) => listen(target, listing),
  };
  const started = performance.now();
  const outcome = await perform({ plan, listed }, ctx);
  const summary: Summary = { kind: outcome.kind, ms: Math.round(performance.now() - started), actions: session.actions, typed: session.typed, opened: !!session.opened };
  if (outcome.kind === "done") {
    summary.event = outcome.event;
    if (outcome.did) summary.did = { name: outcome.did.name, ...(outcome.did.value !== undefined ? { value: outcome.did.value } : {}), ...(outcome.did.mine ? { mine: true } : {}) };
    if (outcome.nothingChanged) summary.nothingChanged = true;
    if (outcome.heard) summary.heard = { how: outcome.heard.how, onTarget: outcome.heard.onTarget };
  } else if (outcome.kind === "visitor" || outcome.kind === "stop") {
    Object.assign(summary, { reason: outcome.reason, event: outcome.event, say: outcome.say, el: idOf(outcome.el) });
  } else if (outcome.partly) summary.partly = { ...(outcome.partly.value !== undefined ? { value: outcome.partly.value } : {}) };
  return summary;
}

/**
 * Counts the events that could make a control act (presses, clicks, keys,
 * input) that reach anything inside the elements matched, from now on.
 */
function count(selector: string): () => Record<string, number> {
  const seen: Record<string, number> = {};
  const onEvent = (event: Event) => {
    const path = event.composedPath();
    if (Array.from(document.querySelectorAll(selector)).some((el) => path.includes(el))) seen[event.type] = (seen[event.type] ?? 0) + 1;
  };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "keydown", "input", "change"]) document.addEventListener(type, onEvent, true);
  return () => ({ ...seen });
}

const counters = new Map<string, () => Record<string, number>>();

(window as unknown as { __act: unknown }).__act = {
  run,
  session,
  glides,
  ripples,
  hears: !!waitForAction,
  watch: (selector: string) => void counters.set(selector, count(selector)),
  counted: (selector: string) => counters.get(selector)?.() ?? {},
  stop: () => void (stopped = true),
};
