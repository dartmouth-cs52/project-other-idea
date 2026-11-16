import type { ActPlan, GateSession, Reach, StopPlan, Tripwire, VisitorPlan } from "../../../src/widget/gate.ts";

// A gate that allows everything, put in place of src/widget/gate.ts when the
// engine is built for its tests (DESIGN 8.2, track C). The engine is tested
// here for what it does with a step it was allowed; the gate's own rules are
// tested on their own. What a press would really reach is still worked out
// (a person's press spot, the "findSpot" rule), since the engine needs a
// point, and a test can mark an element as covered.
//
// Every call is written down in `window.__gate.calls`, so a test can check
// that each element pressed was asked about first.

// The guide plans with the real gate; these tests run the engine alone, never the guide's planning.
export { confirmationAction, planFor, SAYS } from "../../../src/widget/gate.ts";

interface Stub {
  calls: { fn: string; el: Element; key?: string }[];
  /** Elements a press may not reach: `reachable` gives "covered" for them. */
  covered: Element[];
  /** Options `planPick` refuses as not grounded. */
  ungrounded: Element[];
  /** Keys `keyAllowed` refuses. */
  keysRefused: string[];
  /** What the tripwire says once asked. */
  tripped: boolean;
}

function stub(): Stub {
  const win = window as unknown as { __gate?: Stub };
  return (win.__gate ??= { calls: [], covered: [], ungrounded: [], keysRefused: [], tripped: false });
}

const OWN =
  'label, [role="option"], [role="row"], tr, li, [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="listitem"], [role="treeitem"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"]';

function hitAt(x: number, y: number, host: Element): Element | null {
  let hit = document.elementsFromPoint(x, y).find((el) => el !== host && !host.contains(el)) ?? null;
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

export function reachable(el: Element, plan: ActPlan, session: GateSession): Reach {
  const gate = stub();
  gate.calls.push({ fn: "reachable", el });
  const covered: VisitorPlan = { kind: "visitor", reason: "covered", el, say: "Something is in the way.", event: "covered" };
  if (gate.covered.includes(el)) return { ok: false, plan: covered };
  let box = el.getBoundingClientRect();
  const tick = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
  const label = el instanceof HTMLInputElement ? (el.labels?.[0] ?? el.closest("label")) : null;
  const style = getComputedStyle(el);
  if (label && (box.width < 8 || box.height < 8 || (tick && (style.opacity === "0" || style.visibility === "hidden")))) box = label.getBoundingClientRect();
  if (box.width <= 0 && box.height <= 0) return { ok: false, plan: covered };
  const frame = el.closest(OWN) ?? label;
  const own = (hit: Element | null) => !!hit && (el.contains(hit) || hit.contains(el) || !!frame?.contains(hit) || !!label?.contains(hit));
  const inWindow = (x: number, y: number) => x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight;
  const spots = [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.2], [0.5, 0.8], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]] as const;
  for (const [fx, fy] of spots) {
    const x = box.left + box.width * fx;
    const y = box.top + box.height * fy;
    if (!inWindow(x, y)) continue;
    const hit = hitAt(x, y, session.host);
    if (hit && own(hit)) return { ok: true, x, y, hit };
  }
  return { ok: false, plan: covered };
}

export function planPick(option: Element, plan: ActPlan): ActPlan | VisitorPlan | StopPlan {
  const gate = stub();
  gate.calls.push({ fn: "planPick", el: option });
  if (gate.ungrounded.includes(option)) return { kind: "visitor", reason: "ungrounded", el: option, say: "You'll need to pick this one.", event: "ungrounded" };
  const name = (option.getAttribute("aria-label") || option.textContent || "").replace(/\s+/g, " ").trim();
  return { kind: "act", act: plan.act, el: option, control: "option", name, tripwire: false, navigates: false };
}

export function keyAllowed(el: Element, key: string): boolean {
  const gate = stub();
  gate.calls.push({ fn: "keyAllowed", el, key });
  return !gate.keysRefused.includes(key);
}

export function tripwire(el: Element): Tripwire {
  stub().calls.push({ fn: "tripwire", el });
  return { tripped: () => stub().tripped, stop: () => undefined, armed: performance.now() };
}

/** No slow save is ever found here: a test that wants one sets the tripwire instead. */
export function sentAfter(): boolean {
  return false;
}

export function openConfirmation(): Element | undefined {
  return undefined;
}
