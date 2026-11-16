import type { CommitClass } from "../shared/act-rules.ts";
import type { Act, ActingSettings, Refusal, SnapElement, TurnReply } from "../shared/types.ts";

// The DOM half of acting's safety gate (DESIGN section 4). It decides, on the
// live element at the moment of acting, whether Haptic may do a step itself,
// must give that one step to the visitor, has reached the hand-over, or must
// stop. It never trusts the model: the reply can only make it more careful.
// It refuses whatever it cannot classify, and never throws into the page.
//
// CONTRACT ONLY. The bodies below refuse everything, so that code written
// against this file is safe before the rules are in. The rules come next.

/** What the gate knows of the acting request it decides for. The guide keeps it; the engine adds to it as it acts. */
export interface GateSession {
  /** The visitor's question, as they wrote it. Every value typed or chosen must be grounded in it. */
  words: string;
  /** Haptic's own element. Hit tests look through it, and nothing in it is ever a target. */
  host: Element;
  /**
   * The control Haptic last opened a list, menu or popup from, and what it
   * opened when that is known. An option, menu entry or day inside it may be
   * pressed, Enter may be pressed in it, and a search box in it may be typed
   * in. The engine sets it after a press that opened something and clears it
   * when that closes.
   */
  opened?: { from: Element; popup?: Element };
  /** Actions taken in this request so far. */
  actions: number;
  /** Characters typed in this request so far. */
  typed: number;
  /** The control last acted on, and how many actions in a row it has had with no change to the page in between. */
  repeats?: { el: Element; count: number };
  /** "I couldn't do this one" hand-backs in a row. */
  failures: number;
}

/** The site's settings as the widget has them, and what the page itself says. */
export interface GateConfig {
  /** `PublicSiteConfig.acting`: present only when the site has acting on. Absent: nothing is acted on. */
  acting?: Omit<ActingSettings, "enabled">;
  /** `data-acting="off"` on the script tag. */
  pageOff?: boolean;
}

/**
 * How the engine should treat a control it may act on:
 * - "link": a same-origin link, pressed to navigate.
 * - "button": a button or menu entry, pressed.
 * - "tab": a tab, pressed.
 * - "option": an option, menu entry or tree item in a list Haptic opened, pressed.
 * - "text": a text field or text area, typed into.
 * - "select": a native `<select>`, set without opening it.
 * - "combobox": a custom select or combobox, opened and then picked from.
 * - "tick": a checkbox, radio or switch, set to `want`.
 */
export type ControlKind = "link" | "button" | "tab" | "option" | "text" | "select" | "combobox" | "tick";

/** Haptic does the step. */
export interface ActPlan {
  kind: "act";
  act: Act;
  /** What the act is aimed at: the listed target, or for a tick box hidden under its label, still the input (the engine presses `reachable`'s point). */
  el: Element;
  control: ControlKind;
  /** The control's name as the visitor sees it, for sentences and "What I did". */
  name: string;
  /** For "type": the exact text, already grounded. For "choose": the choice to look for; the option found must pass `planPick`. */
  value?: string;
  /** For "check", "uncheck" and a radio: the state to reach. */
  want?: boolean;
  /** A tick box or radio set by Haptic whose words the visitor did not write: listed at the hand-over as "my choice, check it". */
  mine?: boolean;
  /** Arm `tripwire` on `el` just before acting: setting a tick box, switch, radio or native select. */
  tripwire: boolean;
  /** The press may load another page: the guide records the load it expects (DESIGN 4.6) before the press. */
  navigates: boolean;
}

/** The visitor does this one step, with the pointer on it. Acting resumes when the hearing hears them do it. */
export interface VisitorPlan {
  kind: "visitor";
  /** "asked": the model gave no `do` and asked the visitor. Anything else: the rule that declined the step. */
  reason: Refusal | "asked";
  /** Where the pointer goes. */
  el: Element;
  /** The sentence to show: the model's own when it asked, the gate's otherwise (`SAYS`). */
  say: string;
  /** For the next request's event, when Haptic declined: what it did not do and why. "" when the model asked. */
  event: string;
}

/** The final step: the visitor makes the click that commits. */
export interface HandoverPlan {
  kind: "handover";
  el: Element;
  /** The commit's class by its words, when it has one. */
  commit?: CommitClass;
  /** The model's sentence, with "Click {name} when it looks right." added when it does not name the control. */
  say: string;
}

/** Acting ends here. */
export interface StopPlan {
  kind: "stop";
  reason: Refusal;
  say: string;
  /** What to point at, if anything: a confirmation's action button, or the commit refused by its class. */
  el?: Element;
  /** For the history, when there is a next request: what Haptic did not do and why. */
  event: string;
}

/** The control is gone or is no longer the one the reply named: read the page again and ask again. */
export interface AgainPlan {
  kind: "again";
  reason: "changed";
}

export type Plan = ActPlan | VisitorPlan | HandoverPlan | StopPlan | AgainPlan;

/** Where to press, after the engine has brought the control on screen. */
export type Reach = { ok: true; x: number; y: number; hit: Element } | { ok: false; plan: VisitorPlan | StopPlan };

/** Watches for a sign that a field Haptic just set was saved at once. */
export interface Tripwire {
  /** True once a data request finished, or a status or alert region appeared, since it was armed. */
  tripped(): boolean;
  stop(): void;
}

/**
 * Decides one act-mode reply that names a control, on the live element, at
 * the moment of acting. `el` is the live element for `reply.target` and
 * `listed` its entry in the reading the reply answered; a missing or
 * disconnected `el` gives "again". The reply is checked with `checkAction`
 * first, whatever the server did. A reply without `mode: "act"` gives a
 * visitor step with reason "acting-off". A reply with no `do` gives a visitor
 * step ("asked"), or at `commits: true` the hand-over once 4.5 passes.
 */
export function planFor(reply: TurnReply, el: Element | undefined, listed: SnapElement | undefined, session: GateSession, config: GateConfig): Plan {
  void reply;
  void listed;
  void session;
  void config;
  if (!el?.isConnected) return { kind: "again", reason: "changed" };
  return { kind: "visitor", reason: "unknown", el, say: "", event: "" };
}

/**
 * Rule 0, run by the engine right before each press, once the control is on
 * screen and still: the point a person would press (the middle, or another of
 * eight spots), and the element a press there would really reach. That
 * element and every ancestor up to the body (the activation chain) pass the
 * gate's rules again: a span inside a submit button is that button, a label
 * is its control. Covered, or refused on the chain: a visitor step.
 */
export function reachable(el: Element, plan: ActPlan, session: GateSession, config: GateConfig): Reach {
  void plan;
  void session;
  void config;
  return { ok: false, plan: { kind: "visitor", reason: "covered", el, say: "", event: "" } };
}

/**
 * Whether the engine may press an option it found in a list it opened for a
 * "choose": inside what Haptic opened, not disabled, its own words grounded in
 * the visitor's, and no commit words of a class that stops a link. The engine
 * then calls `reachable` on it as for any press.
 */
export function planPick(option: Element, plan: ActPlan, session: GateSession, config: GateConfig): ActPlan | VisitorPlan | StopPlan {
  void plan;
  void session;
  void config;
  return { kind: "visitor", reason: "ungrounded", el: option, say: "", event: "" };
}

/**
 * Whether the engine may dispatch this key on `el`. Escape, Tab and the arrow
 * keys: yes. Space and Enter: only on the control the plan acts on, which has
 * passed the gate, or Enter in a search box or inside a list Haptic opened.
 */
export function keyAllowed(el: Element, key: string, plan: ActPlan, session: GateSession): boolean {
  void el;
  void key;
  void plan;
  void session;
  return false;
}

/** Arms the tripwire for a field Haptic is about to set. Stop it once the step is checked. */
export function tripwire(el: Element, host: Element): Tripwire {
  void el;
  void host;
  return { tripped: () => true, stop: () => undefined };
}

/** The confirmation dialog open on the page, if one is (rule 5): the guide stops acting while one is up. */
export function openConfirmation(host: Element): Element | undefined {
  void host;
  return undefined;
}

/** The widget's own sentences while acting. English in this version. `name` is the control as the visitor sees it. */
export const SAYS = {
  secret: "I don't type passwords, payment details or confirmations. Fill this in and I'll carry on.",
  leaves: (name: string) => `This opens somewhere else, so I'll leave it to you. Click ${name} and I'll carry on.`,
  unknown: (name: string) => `This could save something, so I'll leave it to you. Click ${name} and I'll carry on.`,
  live: (name: string) => `This may save as soon as it changes, so I'll leave it to you. Set ${name} and I'll carry on.`,
  ungrounded: "You'll need to fill this one in: I only enter what you told me.",
  covered: (name: string) => `Something is in the way, so I'll leave this one to you. Click ${name} and I'll carry on.`,
  off: (name: string) => `I'll leave this one to you. Use ${name} and I'll carry on.`,
  unfit: (name: string) => `I can't do this one myself. Use ${name} and I'll carry on.`,
  confirmation: "The page is asking you to confirm. Read it and choose.",
  class: (name: string, does: string) => `I stopped before ${name}: it ${does}, and you didn't ask for that.`,
  cap: "That's as far as I'll go on my own. Here's what I did.",
  tripwire: "That may have been saved straight away. Check it before going on.",
  failed: (name: string) => `I couldn't do this one. Click ${name} yourself and I'll carry on.`,
  handover: (name: string) => `Click ${name} when it looks right.`,
  actingOff: "I'll show you the way instead.",
  moved: "You moved to another page, so I stopped doing it. Ask again to carry on.",
  tookOver: "You took over, so I've paused.",
  answered: "You answered the page's question, so I've stopped.",
} as const;
