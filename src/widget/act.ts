import type { Refusal, SnapElement } from "../shared/types.ts";
import type { ActPlan, GateConfig, GateSession } from "./gate.ts";
import type { Verdict } from "./observe.ts";

// The acting engine (DESIGN section 3): it does one step the gate allowed,
// with the events a person's mouse and keyboard make, shows each move, and
// checks that the step took before going on. A step it cannot do or check is
// given back to the visitor, so the worst case is the guide Haptic already is.
//
// CONTRACT ONLY. The body below gives every step back to the visitor, so code
// written against this file is safe before the engine is in.

/** What the visitor sees the engine do. Supplied by the guide from ui.ts. */
export interface ActUi {
  /** Glides the pointer to this point of the page (client coordinates) and resolves when it is there; at once under reduced motion. */
  glideTo(x: number, y: number): Promise<void>;
  /** Draws a press's ripple at this point. Nothing under reduced motion. */
  ripple(x: number, y: number): void;
}

/** What the guide's hearing made of what happened at a control: the same verdict it gives for a visitor's step. */
export interface Heard {
  how: Verdict["how"];
  onTarget: boolean;
  /** The hearing's own sentence for it. The engine writes the event the model reads from what it did instead. */
  event: string;
}

/** A hearing started on one control, as the guide's `waitForAction` with the actor "haptic". */
export interface Listening {
  /** The first verdict, or undefined if none came within `ms`. Asked once per listening. */
  next(ms: number): Promise<Heard | undefined>;
  stop(): void;
}

export interface ActContext {
  /** False once the visitor pressed Stop, took over, or the guide moved on. No event is dispatched after it turns false. */
  alive(): boolean;
  /** The session the gate decides with. The engine sets `opened` after a press that opened a list, and counts `actions` and `typed`. */
  session: GateSession;
  config: GateConfig;
  /** Every listed control of the reading the reply answered, by its live element. */
  listing: Map<Element, SnapElement>;
  ui: ActUi;
  /** Starts hearing `target` the way a visitor's step is heard, with Haptic as the actor and its own typing heard 300 ms after it ends. */
  listen(target: Element): Listening;
}

/** One step for the engine: a plan the gate gave, and the control's entry in the reading. */
export interface ActStep {
  plan: ActPlan;
  listed?: SnapElement;
}

/** One line of "What I did" at the hand-over. Values are the visitor's own words or the page's option words, never read from the page. */
export interface DidLine {
  /** The field or control, which the line points at when clicked. */
  el: Element;
  /** The control's name as the visitor sees it. */
  name: string;
  /** What was typed or chosen, or "on" or "off" for a tick box. */
  value?: string;
  /** Set by Haptic though the visitor did not say it: "my choice, check it". */
  mine?: boolean;
}

/**
 * How a step ended.
 * - "done": it took, and was checked. `event` is the sentence for the model,
 *   written from what the engine did: 'You clicked link "Cards".'
 *   `nothingChanged` is set when a press was heard but nothing visible came of
 *   it; the guide then tells the model `NOTHING_CHANGED` and lets it decide.
 * - "visitor": the engine could not do it or could not see it take, after one
 *   fallback. The pointer stays on `el` and the visitor does it.
 * - "stop": something the engine saw ends acting: a native dialog was answered
 *   (a click that took over 300 ms), the tripwire, a confirmation opened.
 * - "stopped": `alive()` turned false part way. `partly` is set when some of a
 *   text was typed, so "What I did" can say so.
 */
export type Outcome =
  | { kind: "done"; event: string; heard?: Heard; did?: DidLine; nothingChanged?: boolean }
  | { kind: "visitor"; reason: Refusal; el: Element; say: string; event: string }
  | { kind: "stop"; reason: Refusal; say: string; el?: Element; event: string }
  | { kind: "stopped"; partly?: DidLine };

/**
 * Does one step. Every element it presses, the target or an option or a
 * label, has passed the gate (`reachable`, and `planPick` for an option)
 * right before the press. Never throws: whatever goes wrong becomes a visitor
 * step with reason "failed".
 */
export async function perform(step: ActStep, ctx: ActContext): Promise<Outcome> {
  void ctx;
  return { kind: "visitor", reason: "failed", el: step.plan.el, say: "", event: "" };
}
