import { cleanText, describeElement, type Refusal, type SnapElement } from "../shared/types.ts";
import { keyAllowed, openConfirmation, planPick, reachable, SAYS, sentAfter, tripwire, type ActPlan, type GateConfig, type GateSession, type StopPlan, type Tripwire, type VisitorPlan } from "./gate.ts";
import { markOwn, type Verdict } from "./observe.ts";
import { isDrawn, isLayer, POPUP_ROLES, watchPopups, type Popups } from "./popups.ts";
import { findOpenModal } from "./snapshot.ts";

// The acting engine (DESIGN section 3): it does one step the gate allowed,
// with the events a person's mouse and keyboard make, shows each move, and
// checks that the step took before going on. A step it cannot do or check is
// given back to the visitor, so the worst case is the guide Haptic already is.
//
// What it can do in this version: links, buttons, tabs, menu entries and
// submenus that open on a click, text fields and text areas, native selects,
// tick boxes, radios and switches, and custom selects and comboboxes that are
// opened and then picked from (with a search box in the list, and long or
// virtual lists that need scrolling). Date pickers, editors, sliders, uploads
// and menus that open only on hover go to the visitor.
//
// Two rules hold everywhere:
// - Every element that gets a press, the target or an option or a label, has
//   passed the gate right before it (`reachable`, and `planPick` for an
//   option), and every key passed `keyAllowed`. Nothing is clicked that the
//   gate did not see.
// - `alive()` is asked between any two events, so Stop takes effect before
//   the next one.
//
// The engine reads a field's value only to compare it with what it has just
// typed, and the words a select shows only to compare them with the option it
// pressed. Only "it took" or "it did not" is used; nothing read is kept or sent.

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

/**
 * One line of "What I did" at the hand-over, for a control Haptic changed: a
 * control that already showed what was asked for has none. Values are the
 * visitor's own words or the page's option words, never read from the page.
 */
export interface DidLine {
  /** The field or control, which the line points at when clicked. */
  el: Element;
  /** The control's name as the visitor sees it. For a radio, the name of its group, or its own name when the page gives its group none. */
  name: string;
  /** What was typed or chosen, "on" or "off" for a tick box, and for a radio its own name, or "chosen" when that is the line's name. */
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
 *
 * The listening it starts with `ctx.listen` is stopped before it returns,
 * whatever the outcome: a step given to the visitor is listened to afresh by
 * the guide.
 */
export async function perform(step: ActStep, ctx: ActContext): Promise<Outcome> {
  const run = new Run(step, ctx);
  try {
    if (!ctx.alive()) return { kind: "stopped" };
    // The last press let through on its name alone may have started a save that came back since: nothing more is done.
    const last = ctx.session.lastPress;
    ctx.session.lastPress = undefined;
    if (last && sentAfter(last.armed)) return pressSentStop(last.name, last.described);
    return await act(run);
  } catch (error) {
    if (error instanceof Halt) return error.outcome(run);
    console.warn("[Haptic]", error);
    return run.failed();
  } finally {
    run.end();
  }
}

// Timings ------------------------------------------------------------------

/** How long a press is held. React Aria and Radix compare the times of a press's events. */
const HOLD_MS = 60;
/** Points along the pointer's path that are hit-tested, each a move a page can hear. */
const HOVER_POINTS = 5;
/** Time between those points, so a menu that opens on a timer while the pointer rests sees a pointer that moves like a hand. */
const HOVER_GAP_MS = 70;
/** A pause on the target before acting, so the visitor's eye arrives first. */
const EYE_MS = 250;
/** The same before pressing an option in a list that is already open. */
const EYE_IN_LIST_MS = 120;
/** Between typed characters. */
const KEY_GAP_MS = 35;
/** Characters typed one at a time. The rest goes in chunks, so a long text takes about a second and a half. */
const ONE_BY_ONE = 24;
const CHUNK = 8;
/** How long a control scrolled into view is given to hold still. */
const STILL_MS = 800;
/** How long a check waits for its sign. */
const CHECK_MS = 1500;
/** How long a list or a menu is given to open. */
const OPEN_MS = 1500;
/** A list has stopped changing once it has been this long without a change. */
const LIST_QUIET_MS = 200;
/** Pages of a long list scrolled through to find an option. */
const PAGES = 10;
/** How long a pointer rests on something that may open a menu on hover before it is pressed. */
const MENU_HOVER_MS = 300;
/** A press whose events took longer than this to dispatch was held up by a dialog of the browser's own, which the visitor answered. */
const BLOCKED_MS = 300;
/** How long after Haptic set a field a saving request still counts. */
const TRIPWIRE_MS = 1000;

/** Sentences of the engine's own that the gate's table does not have. English in this version. */
const ENGINE_SAYS = {
  twice: (name: string) => `There is more than one match here. Pick the one you mean in ${name} and I'll carry on.`,
  notFound: (name: string) => `I couldn't find that in ${name}. Pick it yourself and I'll carry on.`,
};

// One step ----------------------------------------------------------------

/** Thrown to end a step early with an outcome: Stop, a gate refusal part way, or a page that showed the browser's own dialog. */
class Halt extends Error {
  constructor(
    readonly why: "stopped" | "refused" | "blocked",
    readonly outcome: (run: Run) => Outcome,
    readonly reason?: Refusal | "asked",
  ) {
    super("halt");
  }
}

/** Everything one step keeps while it runs. */
class Run {
  readonly plan: ActPlan;
  readonly listed: SnapElement | undefined;
  /** The control as events name it: 'link "Cards"'. */
  readonly name: string;
  private counted = false;
  private listening: Listening | undefined;
  private heardSoFar: Heard | undefined;
  /** What has been typed so far, for "What I did" when Stop comes part way. */
  partly: DidLine | undefined;
  /** The tripwire on a press, once armed, and when. */
  wire: { wire: Tripwire; at: number } | undefined;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    step: ActStep,
    readonly ctx: ActContext,
  ) {
    this.plan = step.plan;
    this.listed = step.listed ?? ctx.listing.get(step.plan.el);
    this.name = this.listed ? describeElement(this.listed) : `"${cleanText(step.plan.name, 60)}"`;
  }

  get session(): GateSession {
    return this.ctx.session;
  }

  /** Stops here if the visitor pressed Stop or took over. */
  check() {
    if (!this.ctx.alive()) throw new Halt("stopped", (run) => ({ kind: "stopped", ...(run.partly ? { partly: run.partly } : {}) }));
  }

  async pause(ms: number) {
    this.check();
    if (ms > 0) await sleep(ms);
    this.check();
  }

  /** Counts the step as one action, once, right before its first event that does anything. */
  count() {
    if (this.counted) return;
    this.counted = true;
    this.session.actions++;
  }

  /** Starts hearing the control as the guide hears a visitor. */
  listen(target: Element) {
    if (this.listening) return;
    try {
      const listening = this.ctx.listen(target);
      this.listening = listening;
      listening
        .next(15_000)
        .then((heard) => {
          if (heard) this.heardSoFar = heard;
        })
        .catch(() => undefined);
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  }

  /** The hearing's verdict, if it has come within `ms`. */
  async heard(ms = 0): Promise<Heard | undefined> {
    for (const until = Date.now() + ms; !this.heardSoFar && Date.now() < until; ) await sleep(40);
    return this.heardSoFar;
  }

  onEnd(cleanup: () => void) {
    this.cleanups.push(cleanup);
  }

  end() {
    try {
      this.listening?.stop();
    } catch {
      // Already stopped.
    }
    for (const cleanup of this.cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // Nothing to undo.
      }
    }
  }

  done(event: string, extra: { did?: DidLine; nothingChanged?: boolean } = {}): Outcome {
    return { kind: "done", event, ...(this.heardSoFar ? { heard: this.heardSoFar } : {}), ...(extra.did ? { did: extra.did } : {}), ...(extra.nothingChanged ? { nothingChanged: true } : {}) };
  }

  /** The step goes to the visitor: the engine could not do it, or could not see it take. */
  failed(el: Element = this.plan.el, say?: string, what = "use"): Outcome {
    return { kind: "visitor", reason: "failed", el, say: say ?? SAYS.failed(cleanText(this.plan.name, 60) || "it"), event: `You could not ${what} ${this.name}, so the visitor has it.` };
  }
}

/** Ends the step with what a gate refusal says, for an element pressed part way through it. */
function refused(plan: VisitorPlan | StopPlan): Halt {
  return new Halt(
    "refused",
    () =>
      plan.kind === "visitor"
        ? { kind: "visitor", reason: plan.reason === "asked" ? "unknown" : plan.reason, el: plan.el, say: plan.say, event: plan.event }
        : { kind: "stop", reason: plan.reason, say: plan.say, ...(plan.el ? { el: plan.el } : {}), event: plan.event },
    plan.reason,
  );
}

async function act(run: Run): Promise<Outcome> {
  const { plan } = run;
  switch (plan.control) {
    case "link":
      return pressAndLook(run, "link");
    case "button":
      return pressAndLook(run, "button");
    case "option":
      return pressOption(run);
    case "tab":
      return pressTab(run);
    case "tick":
      return setTick(run);
    case "select":
      if (plan.act === "choose" && plan.el instanceof HTMLSelectElement) return chooseNative(run, plan.el);
      break;
    case "text":
      if (plan.act === "type" && isTextField(plan.el)) return typeStep(run, plan.el);
      if (plan.act === "press_enter" && isTextField(plan.el)) return enterStep(run, plan.el);
      if (plan.act === "click") return pressAndLook(run, "button");
      break;
    case "combobox":
      if (plan.act === "choose") return chooseCustom(run);
      if (plan.act === "type" && isTextField(plan.el) && !isReadOnly(plan.el)) return typeStep(run, plan.el);
      if (plan.act === "click") return pressAndLook(run, "button");
      break;
  }
  return { kind: "visitor", reason: "unfit", el: plan.el, say: SAYS.unfit(cleanText(plan.name, 60) || "it"), event: `You did not use ${run.name}: it is not something you can do yet, so the visitor has it.` };
}

// Links, buttons, menu entries --------------------------------------------

/**
 * A link or a button: press it and look for what came of it. A control that
 * says it opens something is first rested on, in case it opens on hover, and
 * whatever it opens becomes the list Haptic opened (`session.opened`). A
 * button the gate let through only because its name says it opens something
 * comes with the tripwire: a press that sends anything to the site, or brings
 * up a status, stops acting at once, and the visitor is told.
 */
async function pressAndLook(run: Run, kind: "link" | "button"): Promise<Outcome> {
  const outcome = await pressAndLookOnce(run, kind);
  const wire = run.wire;
  if (outcome.kind !== "done" || !wire) return outcome;
  const stop = await pressTripped(run, wire.wire, wire.at);
  if (stop) return stop;
  // A save that is slower than the wait is still found before Haptic acts again.
  run.session.lastPress = { armed: wire.wire.armed, name: cleanText(run.plan.name, 60) || "it", described: run.name };
  return outcome;
}

async function pressAndLookOnce(run: Run, kind: "link" | "button"): Promise<Outcome> {
  const el = run.plan.el;
  // What comes on show while the pointer rests on the control, and what comes on show once it is pressed, are watched apart:
  // a banner or a tooltip that appeared while the pointer was on its way is not what the press opened.
  const resting = watchPopups(el);
  let pressing: Popups | undefined;
  run.onEnd(() => {
    resting.stop();
    pressing?.stop();
  });
  run.listen(el);
  const confirmBefore = openConfirmation(run.session.host);
  let before: Signs | undefined;
  const ready = () => {
    before = pageSigns(run, el);
    pressing = watchPopups(el);
    // Armed right before the first event of the press, so that nothing that happened on the way there counts.
    if (run.plan.tripwire && !run.wire) {
      const wire = tripwire(el, run.session.host, { byStart: true });
      run.wire = { wire, at: Date.now() };
      run.onEnd(() => wire.stop());
    }
  };

  if (opener(el) && !expanded(el)) {
    const point = await getThere(run, el, run.plan, EYE_MS);
    await hoverTo(run, point.x, point.y);
    await run.pause(MENU_HOVER_MS);
    const popup = openedBy(run, el, resting, false);
    if (popup) {
      run.session.opened = { from: el, popup };
      return run.done(`You pointed at ${run.name}, and it opened.`);
    }
    await press(run, el, run.plan, 0, ready);
  } else await press(run, el, run.plan, EYE_MS, ready);
  const signs = before ?? pageSigns(run, el);
  const watch = pressing ?? resting;

  const seen = await waitForSign(run, el, signs, watch, kind);
  const confirmation = openConfirmation(run.session.host);
  if (confirmation && confirmation !== confirmBefore) {
    return { kind: "stop", reason: "confirmation", say: SAYS.confirmation, el: confirmation, event: `You clicked ${run.name}, and the page asked to confirm.` };
  }
  const opened = seen.popup && openedBy(run, el, watch, true);
  if (opened) run.session.opened = { from: el, popup: opened };
  if (seen.any) return run.done(`You clicked ${run.name}.`);

  // A control drawn as a button that only listens for keys.
  if (kind === "button" && el.getAttribute("role") === "button" && !(el instanceof HTMLButtonElement) && !(el instanceof HTMLInputElement)) {
    focusOn(el);
    keyPress(run, el, " ");
    keyPress(run, el, "Enter");
    const again = await waitForSign(run, el, signs, watch, kind);
    const openedNow = again.popup && openedBy(run, el, watch, true);
    if (openedNow) run.session.opened = { from: el, popup: openedNow };
    if (again.any) return run.done(`You clicked ${run.name}.`);
  }
  // Nothing visible came of it. A press the hearing heard is reported as such, and the model decides; one nobody heard is the visitor's.
  if (await run.heard(300)) return run.done(`You clicked ${run.name}.`, { nothingChanged: true });
  return run.failed(el, undefined, "click");
}

/** A menu entry that opens a submenu. */
function submenu(el: Element): boolean {
  return /^menuitem/.test(el.getAttribute("role") ?? "") && opener(el);
}

/** Whether what a control opened is a list of choices for a field, whose pick the field then shows, rather than a menu of actions. */
function choosesFor(from: Element, list: Element): boolean {
  if (from.getAttribute("role") === "combobox" || from instanceof HTMLInputElement || from instanceof HTMLSelectElement) return true;
  const popup = from.getAttribute("aria-haspopup");
  if (popup === "listbox" || popup === "tree" || popup === "grid") return true;
  return list.querySelector('[role="option"], [cmdk-item]') !== null || list.matches('[role="listbox"]');
}

/**
 * An option or a menu entry in a list Haptic opened. A pick in a field's list
 * is checked as a pick: the list closed or marks it chosen, and the field
 * shows it. A menu entry is checked as a button. A menu entry that opens a
 * submenu is rested on first, since that is how a submenu opens; pressed only
 * if resting did nothing, and then given the right arrow key.
 */
async function pressOption(run: Run): Promise<Outcome> {
  const el = run.plan.el;
  const from = run.session.opened?.from;
  const list = run.session.opened?.popup;
  const watch = watchPopups(el);
  run.onEnd(() => watch.stop());
  if (submenu(el)) {
    run.listen(el);
    if (expanded(el)) return run.done(`${capital(run.name)} was already open.`);
    const point = await getThere(run, el, run.plan, EYE_IN_LIST_MS);
    await hoverTo(run, point.x, point.y);
    await run.pause(MENU_HOVER_MS);
    let popup = openedBy(run, el, watch, false);
    if (!popup) {
      await press(run, el, run.plan, 0);
      popup = await waitFor(run, () => openedBy(run, el, watch, true), 600);
    }
    if (!popup) {
      focusOn(el);
      keyPress(run, el, "ArrowRight");
      popup = await waitFor(run, () => openedBy(run, el, watch, true), 600);
    }
    if (!popup) return run.failed(el, undefined, "open");
    run.session.opened = { from: el, popup };
    return run.done(`You opened ${run.name}.`);
  }
  run.listen(from ?? el);
  if (from && list && choosesFor(from, list)) {
    const shown = shownOf(from);
    const words = optionWords(el);
    // Read while the list is on show: once it closes, the option's lines may be gone.
    const lead = leadWords(el, words);
    // Named before the pick: after it, a select's words are the choice.
    const [fromName, fromLabel] = [nameOf(run, from), listedName(run, from)];
    await press(run, el, run.plan, EYE_IN_LIST_MS);
    if (!(await waitFor(run, () => picked(el, list, from, shown, words), CHECK_MS))) return run.failed(el, undefined, "choose");
    if (!isDrawn(list) || !expanded(from)) run.session.opened = undefined;
    // A field that shows just what it showed before was not changed, and is not listed in What I did.
    const changed = shownOf(from).all !== shown.all;
    return run.done(`You chose "${cleanText(words, 60)}" from the list that ${fromName} opened.`, changed ? { did: { el: from, name: fromLabel, value: lead, ...(run.plan.mine ? { mine: true } : {}) } } : {});
  }
  let before: Signs | undefined;
  let pressing: Popups | undefined;
  run.onEnd(() => pressing?.stop());
  await press(run, el, run.plan, EYE_IN_LIST_MS, () => {
    before = pageSigns(run, el);
    pressing = watchPopups(el);
  });
  const seen = await waitForSign(run, el, before ?? pageSigns(run, el), pressing ?? watch, "button");
  if (list && !isDrawn(list)) run.session.opened = undefined;
  const opened = seen.popup && openedBy(run, el, pressing ?? watch, true);
  if (opened) run.session.opened = { from: el, popup: opened };
  if (seen.any) return run.done(`You clicked ${run.name}.`);
  if (await run.heard(300)) return run.done(`You clicked ${run.name}.`, { nothingChanged: true });
  return run.failed(el, undefined, "click");
}

/** A tab: pressed, and checked by its own state or by its panel. Keys only if the press did not take. */
async function pressTab(run: Run): Promise<Outcome> {
  const el = run.plan.el;
  if (el.getAttribute("aria-selected") === "true") return run.done(`${capital(run.name)} was already open.`);
  const panel = panelOf(el);
  const panelBefore = panel ? panelLook(panel) : "";
  const wasExpanded = expanded(el);
  const address = location.href;
  // A tab is open when it says it is selected, when its panel changed, or, for the headers of an accordion that some toolkits make tabs, when it says it is expanded.
  // A tab that is a link to its own address took when the address changed: the page draws it again there, so the old node says nothing.
  const selected = () => el.getAttribute("aria-selected") === "true" || (!!panel && panelLook(panel) !== panelBefore) || (!wasExpanded && expanded(el)) || location.href !== address;
  run.listen(el);
  await press(run, el, run.plan);
  if (await waitFor(run, selected, CHECK_MS)) return run.done(`You clicked ${run.name}.`);
  // The keyboard way: Enter on the tab, then the arrow keys from the open one towards it.
  focusOn(el);
  keyPress(run, el, "Enter");
  if (await waitFor(run, selected, 400)) return run.done(`You clicked ${run.name}.`);
  const tabs = Array.from(el.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]') ?? []);
  const from = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
  const to = tabs.indexOf(el);
  if (from >= 0 && to >= 0 && from !== to) {
    const arrow = to > from ? "ArrowRight" : "ArrowLeft";
    focusOn(tabs[from]!);
    for (let i = 0; i < Math.abs(to - from); i++) {
      run.check();
      const on = deepActive() ?? tabs[from]!;
      if (!keyPress(run, on, arrow)) break;
      await sleep(60);
    }
    // Tabs that move the keyboard but wait for a key to switch.
    if (!selected() && deepActive() === el) keyPress(run, el, "Enter");
    if (await waitFor(run, selected, 400)) return run.done(`You clicked ${run.name}.`);
  }
  return run.failed(el, undefined, "open");
}

/** Enter in a search box with no button. A dispatched Enter has no default action, so only the page's own key handler can act on it. */
async function enterStep(run: Run, field: HTMLElement): Promise<Outcome> {
  const watch = watchPopups(field);
  run.onEnd(() => watch.stop());
  run.listen(field);
  if (!holdsFocus(field)) await press(run, field, run.plan);
  if (!holdsFocus(field)) focusOn(field);
  const before = pageSigns(run, field);
  run.count();
  if (!keyPress(run, field, "Enter")) return run.failed(field, undefined, "press Enter in");
  const seen = await waitForSign(run, field, before, watch, "link");
  return run.done(`You pressed Enter in ${run.name}.`, seen.any ? {} : { nothingChanged: true });
}

// Tick boxes, radios, switches ---------------------------------------------

/** Whether a tick box, radio or switch is on, or undefined when it does not say. */
function tickState(el: Element): boolean | undefined {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return el.checked;
  const checked = el.getAttribute("aria-checked");
  if (checked === "true") return true;
  if (checked === "false" || checked === "mixed") return false;
  const pressed = el.getAttribute("aria-pressed");
  if (pressed === "true") return true;
  if (pressed === "false" || pressed === "mixed") return false;
  return undefined;
}

/**
 * Sets a tick box, radio or switch to the state asked for. It is read first,
 * so one already right is left alone; pressed once; and given Space only when
 * the press did not take, never a second press, which would undo the first.
 */
async function setTick(run: Run): Promise<Outcome> {
  const el = run.plan.el;
  const now = tickState(el);
  if (now === undefined) return run.failed(el, undefined, "set");
  const want = run.plan.want ?? (run.plan.act === "uncheck" ? false : run.plan.act === "check" ? true : !now);
  const kind = kindOfTick(el);
  // Left as it was: nothing for What I did.
  if (now === want) return run.done(`${capital(run.name)} was already ${tickWord(kind, want, true)}, so you left it.`);
  const did = tickLine(el, kind, cleanText(run.plan.name, 60), want, !!run.plan.mine);
  const wire = run.plan.tripwire ? tripwire(el, run.session.host) : undefined;
  if (wire) run.onEnd(() => wire.stop());
  const startedAt = Date.now();
  run.listen(el);
  await press(run, el, run.plan);
  let took = await waitFor(run, () => tickState(el) === want, CHECK_MS);
  if (!took && tickState(el) !== want) {
    focusOn(el);
    keyPress(run, el, " ");
    took = await waitFor(run, () => tickState(el) === want, 600);
  }
  if (!took) return run.failed(el, undefined, "set");
  const stop = wire ? await tripped(run, wire, startedAt) : undefined;
  return stop ?? run.done(`You ${tickWord(kind, want, false)} ${run.name}.`, { did });
}

/**
 * The line of What I did for a box Haptic ticked or a radio it chose, without
 * the words that only describe it. A radio is a choice in its group: the
 * group's name with the radio's own, or when the page names no group, the
 * radio's own name with "chosen".
 */
function tickLine(el: Element, kind: "checkbox" | "radio" | "switch", whole: string, on: boolean, mine: boolean): DidLine {
  const own = leadWords(el, whole);
  const group = kind === "radio" ? groupName(el) : "";
  const line: DidLine = kind !== "radio" ? { el, name: own, value: on ? "on" : "off" } : group ? { el, name: group, value: own } : { el, name: own, value: "chosen" };
  return mine ? { ...line, mine: true } : line;
}

/** What the page names a radio's group by: the radio group's own name, or its fieldset's legend. Empty when it names it by nothing. */
function groupName(el: Element): string {
  const group = el.closest('[role="radiogroup"]');
  if (group) return fieldName(group);
  const legend = el.closest("fieldset")?.querySelector(":scope > legend");
  return legend ? cleanText(optionWords(legend), 60) : "";
}

/**
 * The first line of what a control shows, when its words are set out in more
 * than one block: a choice's title above its description, a person's name
 * beside their job. The rest only describes it. What comes out is always the
 * start of `whole`, the name it already has, so nothing new is read out.
 */
function leadWords(el: Element, whole: string): string {
  const source = el.textContent?.trim() ? el : ((el as HTMLInputElement).labels?.[0] ?? el);
  const first = ((source as HTMLElement).innerText ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find(Boolean);
  const lead = cleanText(first ?? "", 60);
  return lead && lead.length < whole.length && squash(whole).startsWith(squash(lead)) ? lead : whole;
}

function kindOfTick(el: Element): "checkbox" | "radio" | "switch" {
  const role = el.getAttribute("role");
  if (role === "switch") return "switch";
  if (role === "radio" || (el instanceof HTMLInputElement && el.type === "radio")) return "radio";
  return "checkbox";
}

/** "ticked", "turned on", "chose"; or as a state, "ticked", "on", "chosen". */
function tickWord(kind: "checkbox" | "radio" | "switch", on: boolean, state: boolean): string {
  if (kind === "switch") return state ? (on ? "on" : "off") : on ? "turned on" : "turned off";
  if (kind === "radio") return state ? (on ? "chosen" : "not chosen") : on ? "chose" : "cleared";
  return state ? (on ? "ticked" : "not ticked") : on ? "ticked" : "unticked";
}

/** After a press the gate let through on its name alone: the tripwire, read once a second has passed since the press. A request or a status that came in that time stops acting. */
async function pressTripped(run: Run, wire: Tripwire, startedAt: number): Promise<Outcome | undefined> {
  const left = TRIPWIRE_MS - (Date.now() - startedAt);
  if (left > 0) await run.pause(left);
  if (!wire.tripped()) return undefined;
  return pressSentStop(cleanText(run.plan.name, 60) || "it", run.name, run.plan.el);
}

/** Acting stops because a press sent something to the site. */
function pressSentStop(name: string, described: string, el?: Element): Outcome {
  return { kind: "stop", reason: "tripwire", say: SAYS.pressSent(name), ...(el?.isConnected ? { el } : {}), event: `You clicked ${described}, and the page sent something to its server at once, so you stopped.` };
}

/** After a field was set: the tripwire, read once a second has passed since the action. A request or a status that came in that time stops acting. */
async function tripped(run: Run, wire: Tripwire, startedAt: number): Promise<Outcome | undefined> {
  const left = TRIPWIRE_MS - (Date.now() - startedAt);
  if (left > 0) await run.pause(left);
  if (!wire.tripped()) return undefined;
  return { kind: "stop", reason: "tripwire", say: SAYS.tripwire, el: run.plan.el, event: `You set ${run.name}, and the page may have saved it straight away.` };
}

// Text ---------------------------------------------------------------------

/** A text field, a text area, or a combobox that is an input. */
function isTextField(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color", "hidden", "date", "time", "datetime-local", "month", "week"].includes(el.type);
}

function isReadOnly(el: Element): boolean {
  return (el as HTMLInputElement).readOnly === true || el.getAttribute("aria-readonly") === "true";
}

/** Types the plan's text into a field and checks it took. */
async function typeStep(run: Run, field: HTMLInputElement | HTMLTextAreaElement): Promise<Outcome> {
  const text = run.plan.value ?? "";
  if (!text) return run.failed(field, undefined, "type in");
  if (isReadOnly(field) || field.disabled) return run.failed(field, undefined, "type in");
  run.listen(field);
  const invalidBefore = field.getAttribute("aria-invalid") === "true";
  // Read only to tell whether the typing changed it, and never kept.
  const before = field.value;
  const typed = await typeInto(run, field, run.plan, text);
  let took = await waitFor(run, () => holdsText(field, typed.text), 600);
  if (!took) {
    // Once more, the whole text at once.
    setValue(field, typed.text, true);
    took = await waitFor(run, () => holdsText(field, typed.text), 600);
  }
  if (!took) return run.failed(field, undefined, "type in");
  const invalid = !invalidBefore && field.getAttribute("aria-invalid") === "true";
  const did: DidLine = { el: field, name: cleanText(run.plan.name, 60), value: typed.text };
  return run.done(`You typed "${cleanText(typed.text, 120)}" in ${run.name}.${invalid ? " The page marks it as not valid." : ""}`, field.value !== before ? { did } : {});
}

/**
 * Types into a field the way a keyboard does: a press to put the cursor in
 * it, everything in it selected so that the text replaces it, then each
 * character through the browser's own editing (`insertText`), which fires the
 * input events every framework listens to and goes on the undo stack. Where
 * the browser will not edit the field, the field's own value setter and an
 * input event stand in, and a change event follows at the end.
 */
async function typeInto(run: Run, field: HTMLInputElement | HTMLTextAreaElement, plan: ActPlan, raw: string, ready?: () => void): Promise<{ text: string; fallback: boolean }> {
  const text = field instanceof HTMLTextAreaElement ? raw : raw.replace(/[\r\n]+/g, " ");
  if (!holdsFocus(field)) await press(run, field, plan, EYE_MS, ready);
  else ready?.();
  if (!holdsFocus(field)) focusOn(field);
  run.check();
  run.count();
  try {
    field.select();
  } catch {
    // Some input types cannot be selected; what is typed then goes where the cursor is.
  }
  let sofar = "";
  let fallback = false;
  // One character at a time, then chunks; a new line always on its own.
  const pieces: string[] = [];
  let count = 0;
  for (const char of text) {
    const last = pieces[pieces.length - 1];
    if (char !== "\n" && last !== undefined && last !== "\n" && count > ONE_BY_ONE && last.length < CHUNK) pieces[pieces.length - 1] = last + char;
    else pieces.push(char);
    count++;
  }
  for (const piece of pieces) {
    run.check();
    const first = piece[0] ?? "";
    // A new line goes in without an Enter key, which a page may take as "send". A key the page answers with a dialog of the browser's own stops acting, as a press does.
    const allowed = piece === "\n" || fire(run, field, keyEvent("keydown", first), true);
    if (allowed) {
      let inserted = false;
      if (holdsFocus(field)) {
        try {
          inserted = piece === "\n" ? document.execCommand("insertLineBreak") : document.execCommand("insertText", false, piece);
        } catch {
          inserted = false;
        }
      }
      if (!inserted) {
        fallback = true;
        setValue(field, sofar + piece, false, piece);
      }
      sofar += piece;
      run.session.typed += piece.length;
      run.partly = { el: field, name: cleanText(plan.name, 60), value: sofar };
    }
    if (piece !== "\n") fire(run, field, keyEvent("keyup", piece[piece.length - 1] ?? first), false);
    await sleep(KEY_GAP_MS);
  }
  if (fallback) fire(run, field, new Event("change", { bubbles: true }), false);
  run.partly = undefined;
  return { text, fallback };
}

/** Sets a field's value through its type's own setter, which React's value tracker does not see, and tells the page as typing would. */
function setValue(field: HTMLInputElement | HTMLTextAreaElement, value: string, whole: boolean, data = value) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
  const init = { bubbles: true, cancelable: false, composed: true, inputType: whole ? "insertReplacementText" : "insertText", data };
  field.dispatchEvent(markOwn(typeof InputEvent === "function" ? new InputEvent("input", init) : new Event("input", init)));
  if (whole) field.dispatchEvent(markOwn(new Event("change", { bubbles: true })));
}

/** Whether the field holds what was typed: the same words, or for a field that masks what is typed, its letters and digits in order. Read here, never kept. */
function holdsText(field: HTMLInputElement | HTMLTextAreaElement, text: string): boolean {
  const value = field.value;
  if (fold(value).includes(fold(text))) return true;
  const bare = (s: string) => fold(s).replace(/[^\p{L}\p{N}]+/gu, "");
  const want = bare(text);
  return want.length > 0 && bare(value).includes(want);
}

// Native selects --------------------------------------------------------------

/** A native select is set without opening the browser's own list, which no page script can open or press. */
async function chooseNative(run: Run, select: HTMLSelectElement): Promise<Outcome> {
  const value = run.plan.value ?? "";
  const options = Array.from(select.options).filter((option) => !option.disabled && !option.hidden && (option.label || option.text).trim());
  const found = matchOne(value, options.map((option) => ({ el: option as Element, text: option.label || option.text })));
  if (found === "none") return { kind: "visitor", reason: "failed", el: select, say: ENGINE_SAYS.notFound(cleanText(run.plan.name, 60)), event: `You could not find "${cleanText(value, 60)}" in ${run.name}, so the visitor has it.` };
  if (found === "twice") return { kind: "visitor", reason: "failed", el: select, say: ENGINE_SAYS.twice(cleanText(run.plan.name, 60)), event: `More than one choice in ${run.name} matches "${cleanText(value, 60)}", so the visitor has it.` };
  const option = found as HTMLOptionElement;
  // The select's own options are the list here: the gate checks the one found as it checks any option.
  const openedBefore = run.session.opened;
  run.session.opened = { from: select, popup: select };
  const pick = planPick(option, run.plan, run.session, run.ctx.config);
  run.session.opened = openedBefore;
  if (pick.kind !== "act") throw refused(pick);
  const words = (option.label || option.text).trim();
  const did: DidLine = { el: select, name: cleanText(run.plan.name, 60), value: words, ...(run.plan.mine ? { mine: true } : {}) };
  if (option.selected) return run.done(`${capital(run.name)} already shows "${cleanText(words, 60)}", so you left it.`);
  const point = await getThere(run, select, run.plan, EYE_MS);
  await hoverTo(run, point.x, point.y);
  run.check();
  const wire = run.plan.tripwire ? tripwire(select, run.session.host) : undefined;
  if (wire) run.onEnd(() => wire.stop());
  const startedAt = Date.now();
  run.listen(select);
  focusOn(select);
  run.count();
  // One pick, as a person makes it: in a list that takes several, the others stay as they were.
  if (select.multiple) option.selected = true;
  else select.selectedIndex = option.index;
  fire(run, select, new Event("input", { bubbles: true, composed: true }), true);
  fire(run, select, new Event("change", { bubbles: true }), true);
  run.ctx.ui.ripple(point.x, point.y);
  if (!(await waitFor(run, () => option.selected, 600))) return run.failed(select, undefined, "set");
  // A page that put the old choice back a moment later did not take it.
  await run.pause(150);
  if (!option.selected) return run.failed(select, undefined, "set");
  if (wire) {
    const stop = await tripped(run, wire, startedAt);
    if (stop) return stop;
  }
  return run.done(`You chose "${cleanText(words, 60)}" in ${run.name}.`, { did });
}

// Custom selects and comboboxes --------------------------------------------------

/**
 * Open, then pick (DESIGN 3.4): the trigger is typed into when it is a text
 * field, else pressed; what it opened is found; a search box in it gets the
 * first word of the choice; the list is waited on until it stops changing,
 * and scrolled a page at a time when the choice is not in it yet; the
 * option found is checked by the gate, glided to and pressed. The pick took
 * when the list closed or marks the option chosen, and the field now shows
 * the option's words.
 */
async function chooseCustom(run: Run): Promise<Outcome> {
  const trigger = run.plan.el;
  const value = (run.plan.value ?? "").trim();
  const label = cleanText(run.plan.name, 60);
  if (!value) return run.failed(trigger, undefined, "choose in");
  let watch = watchPopups(trigger);
  run.onEnd(() => watch.stop());
  // Watched afresh from the press that opens it, so that nothing that came on show while the pointer was on its way is taken for the list.
  const fromHere = () => {
    watch.stop();
    watch = watchPopups(trigger);
  };
  run.listen(trigger);
  // What the field shows before Haptic touches it, to tell whether the pick changed it. Read here, never kept.
  const atStart = shownOf(trigger).all;
  const typable = isTextField(trigger) && !isReadOnly(trigger);
  const words = searchWords(value);
  let searched = "";

  // 1. Open it, unless it is open already from an earlier step.
  const earlier = run.session.opened;
  let popup = earlier?.from === trigger && earlier.popup && isDrawn(earlier.popup) ? earlier.popup : expanded(trigger) ? findOpened(run, trigger, watch, true) : undefined;
  if (!popup && expanded(trigger)) {
    // Open, but what it opened cannot be told: closed first, so that what opens next is seen opening.
    keyPress(run, deepActive() ?? trigger, "Escape");
    await waitFor(run, () => !expanded(trigger), 400);
  }
  if (typable) {
    searched = words[0] ?? value;
    await typeInto(run, trigger, run.plan, searched, popup ? undefined : fromHere);
    popup = await waitFor(run, () => findOpened(run, trigger, watch, true), OPEN_MS);
  } else if (!popup) {
    await press(run, trigger, run.plan, EYE_MS, fromHere);
    popup = await waitFor(run, () => findOpened(run, trigger, watch, true), OPEN_MS);
    if (!popup) popup = await openByKeys(run, trigger, watch);
  }
  if (!popup) return run.failed(trigger, undefined, "open");
  run.session.opened = { from: trigger, popup };

  // 2. Its own search box, if it has one.
  const search = typable ? undefined : searchBoxIn(popup, trigger);
  if (search) {
    searched = words[0] ?? value;
    await typeInto(run, search, { ...run.plan, el: search, control: "text", act: "type", value: searched, tripwire: false, navigates: false }, searched);
  }
  await quiet(run, popup);

  // 3. The option.
  let found = await findOption(run, popup, value);
  if ((found === "none" || found === "twice") && searched && fold(searched) !== fold(value)) {
    // A first word that finds nothing, or too much: the whole of it, once.
    const box = search ?? (typable ? trigger : undefined);
    if (box && isTextField(box)) {
      searched = value;
      await typeInto(run, box, { ...run.plan, el: box, control: "text", act: "type", value, tripwire: false, navigates: false }, value);
      await quiet(run, popup);
      found = await findOption(run, popup, value);
    }
  }
  if (found === "none") return { kind: "visitor", reason: "failed", el: trigger, say: ENGINE_SAYS.notFound(label), event: `You could not find "${cleanText(value, 60)}" in the list that ${run.name} opened, so the visitor has it.` };
  if (found === "twice") return { kind: "visitor", reason: "failed", el: popup, say: ENGINE_SAYS.twice(label), event: `More than one entry in the list that ${run.name} opened matches "${cleanText(value, 60)}", so the visitor has it.` };
  const option = found;
  const pick = planPick(option, run.plan, run.session, run.ctx.config);
  if (pick.kind !== "act") throw refused(pick);

  // 4. Press it.
  const optionText = optionWords(option);
  // Read while the list is on show: once it closes, the option's lines may be gone.
  const lead = leadWords(option, optionText);
  const multiple = popup.querySelector('[aria-multiselectable="true"]') !== null || popup.getAttribute("aria-multiselectable") === "true";
  const wire = run.plan.tripwire ? tripwire(trigger, run.session.host) : undefined;
  if (wire) run.onEnd(() => wire.stop());
  const startedAt = Date.now();
  // What the field shows now, typed search included, so that a pick that changed nothing is not taken for one that took.
  const shownBefore = shownOf(trigger);
  let pressedOk = true;
  try {
    option.scrollIntoView({ block: "nearest" });
    await press(run, option, pick, EYE_IN_LIST_MS);
  } catch (error) {
    // An option that something covers is picked with the keys instead, if the list follows them. Any other refusal stands.
    if (!(error instanceof Halt) || error.why !== "refused" || error.reason !== "covered") throw error;
    pressedOk = false;
    if (!(await pickByKeys(run, popup, option))) throw error;
  }
  let took = await waitFor(run, () => picked(option, popup, trigger, shownBefore, optionText, value), CHECK_MS);
  if (!took && pressedOk && isDrawn(popup) && option.isConnected) {
    await pickByKeys(run, popup, option);
    took = await waitFor(run, () => picked(option, popup, trigger, shownBefore, optionText, value), 800);
  }
  if (!took) return run.failed(trigger, undefined, "choose in");
  // A list that lets several be picked stays open. One pick per step, then it is closed.
  // The field saying it is still open decides, since such a list may have drawn itself again as a new element.
  if ((isDrawn(popup) && multiple) || expanded(trigger)) {
    const on = deepActive() ?? trigger;
    keyPress(run, popup.contains(on) || on === trigger ? on : trigger, "Escape");
    await waitFor(run, () => !isDrawn(popup) || !expanded(trigger), 400);
  }
  if (!isDrawn(popup) || !expanded(trigger)) run.session.opened = undefined;
  const did: DidLine = { el: trigger, name: label, value: lead, ...(run.plan.mine ? { mine: true } : {}) };
  if (wire) {
    const stop = await tripped(run, wire, startedAt);
    if (stop) return stop;
  }
  // A field that shows just what it showed before the pick was not changed, and is not listed in What I did.
  return run.done(`You chose "${cleanText(optionText, 60)}" from the list that ${run.name} opened.`, shownOf(trigger).all !== atStart ? { did } : {});
}

/** Opening a list with the keys a list listens for, when a press opened nothing. */
async function openByKeys(run: Run, trigger: Element, watch: Popups): Promise<Element | undefined> {
  focusOn(trigger);
  for (const key of ["ArrowDown", "Enter", " "]) {
    run.check();
    if (!keyPress(run, trigger, key)) continue;
    const popup = await waitFor(run, () => findOpened(run, trigger, watch, true), 500);
    if (popup) return popup;
  }
  return undefined;
}

/**
 * Picks an option with the keys: down the list until the option is the one
 * highlighted, then Enter, which the gate allows inside a list Haptic opened.
 */
async function pickByKeys(run: Run, popup: Element, option: Element): Promise<boolean> {
  const count = Math.min(60, optionCandidates(popup).length + 2);
  for (let i = 0; i <= count; i++) {
    run.check();
    const on = deepActive();
    const target = on && (popup.contains(on) || on === run.plan.el) ? on : run.plan.el;
    if (highlighted(option, on)) return keyPress(run, target, "Enter");
    if (!keyPress(run, target, "ArrowDown")) return false;
    await sleep(40);
  }
  return false;
}

/** Whether a list shows this option as the one the keys are on. */
function highlighted(option: Element, active: Element | undefined): boolean {
  if (active && (active === option || option.contains(active))) return true;
  const pointedAt = active?.getAttribute("aria-activedescendant");
  if (pointedAt && option.id && pointedAt === option.id) return true;
  if (flagged(option, "data-highlighted") || option.getAttribute("data-selected") === "true" || flagged(option, "data-focus")) return true;
  return Array.from(option.classList).some((token) => /(?:^|[-_])(?:focused|active|highlighted)$/i.test(token));
}

/** A class word that marks an option as the chosen one: "is-selected", "ant-select-item-option-selected", "Mui-selected". Not "active", which most lists use for the one under the pointer. */
const CHOSEN_TOKEN = /(?:^|[-_]|is)(?:selected|checked)$/i;

/** Whether a list marks this option as the chosen one. */
function markedChosen(option: Element): boolean {
  for (let at: Element | null = option, depth = 0; at && depth < 2; at = at.parentElement, depth++) {
    if (at.getAttribute("aria-selected") === "true" || at.getAttribute("aria-checked") === "true" || at.getAttribute("data-state") === "checked") return true;
    if (Array.from(at.classList).some((token) => CHOSEN_TOKEN.test(token))) return true;
  }
  return false;
}

/** What a field shows: everything, its inputs' values included, and its own words alone, which a typed search is not part of. Read here, never kept or sent. */
interface Shown {
  all: string;
  text: string;
}

function shownOf(trigger: Element): Shown {
  const box = fieldBox(trigger);
  const values = Array.from(box.querySelectorAll("input, textarea"))
    .concat(box.matches("input, textarea") ? [box] : [])
    .map((input) => ((input as HTMLInputElement).type === "hidden" ? "" : (input as HTMLInputElement).value));
  const text = ((box as HTMLElement).innerText ?? box.textContent ?? "").replace(/\s+/g, " ").trim();
  return { all: [text, ...values].join(" ").replace(/\s+/g, " ").trim(), text };
}

/**
 * Whether a pick took. Any of:
 * - the list closed or marks the option chosen, and the field shows the
 *   option's words;
 * - the field's own words (not a search typed into it) now hold the
 *   option's words and did not before: its text, or a chip added to it;
 * - the list closed after the press, and the field shows the very words
 *   asked for, for an option that carries words the field never shows (a
 *   row number, a hint).
 */
function picked(option: Element, popup: Element, trigger: Element, before: Shown, optionText: string, value = ""): boolean {
  const want = squash(optionText);
  const now = shownOf(trigger);
  if (want && squash(now.text).includes(want) && !squash(before.text).includes(want)) return true;
  const closed = !isDrawn(popup) || trigger.getAttribute("aria-expanded") === "false";
  // A list that stays open may draw itself again after a pick (a search box cleared): the option is then found again by its words.
  const again = option.isConnected ? option : !closed ? optionCandidates(popup).find((other) => squash(optionWords(other)) === want) : undefined;
  const marked = !!again && markedChosen(again);
  if (!closed && !marked) return false;
  if (shows(now.all, optionText, before.all)) return true;
  return closed && !!squash(value) && squash(now.all).includes(squash(value));
}

/**
 * Whether a field's words show the option's words. An option can carry more
 * than the field shows ("Malika Cummerata Finance", shown as "Malika
 * Cummerata"), so the words that came on show since `before` count too when
 * the option holds them all.
 */
function shows(now: string, optionText: string, before: string): boolean {
  const want = squash(optionText);
  if (!want) return false;
  if (squash(now).includes(want)) return true;
  if (now === before) return false;
  const had = new Set(fold(before).split(/[^\p{L}\p{N}]+/u));
  const added = fold(now)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !had.has(word))
    .join("");
  return added.length >= 2 && want.includes(added);
}

/** The small box a field is drawn in: the field and what shows its value, such as a select's words beside a hidden input, or chips. */
function fieldBox(trigger: Element): Element {
  const own = trigger.getBoundingClientRect();
  let box: Element = trigger;
  let at = trigger.parentElement;
  for (let depth = 0; at && at !== document.body && depth < 4; depth++, at = at.parentElement) {
    const rect = at.getBoundingClientRect();
    // A field's box is about a row high, however wide; a search input in a box of chips can be a few pixels wide.
    if (rect.height > Math.max(own.height * 2.5, own.height + 48)) break;
    const fields = at.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="combobox"]');
    if (Array.from(fields).some((field) => field !== trigger && !trigger.contains(field) && !field.contains(trigger) && isDrawn(field) && field.getBoundingClientRect().width > 4)) break;
    box = at;
  }
  return box;
}

/** A search box inside what was opened, other than the trigger itself. */
function searchBoxIn(popup: Element, trigger: Element): HTMLInputElement | undefined {
  for (const el of popup.querySelectorAll('input, [role="searchbox"]')) {
    if (el === trigger || !(el instanceof HTMLInputElement) || !isTextField(el) || isReadOnly(el) || el.disabled || !isDrawn(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    return el;
  }
  return undefined;
}

// Finding what opened, and the option in it ------------------------------------

/** Roles of an option or an entry, and the marks cmdk gives its items. */
const OPTIONS = '[role="option"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="menuitem"], [role="treeitem"], [role="gridcell"], [cmdk-item]';

/**
 * What `from` opened, if anything is open: what it says it controls; a list,
 * menu, tree, grid or dialog that came on show since the watch began; or any
 * box drawn over the page that came on show. A tooltip or a status message is
 * not a popup, and for a choice (`choices`) what opened must hold something to
 * choose.
 */
function findOpened(run: Run, from: Element, watch: Popups, choices = false): Element | undefined {
  const host = run.session.host;
  const fits = (el: Element) =>
    isDrawn(el) && !el.contains(from) && el !== host && !host.contains(el) && hasBox(el) && !el.closest('[role="tooltip"], [role="status"], [role="alert"], [aria-live]') && (!choices || optionCandidates(el).length > 0);
  const own = watch.popupOf();
  if (own && fits(own)) return own;
  const fresh = watch.fresh();
  for (const el of fresh) {
    const roled = el.matches(POPUP_ROLES) ? [el] : Array.from(el.querySelectorAll(POPUP_ROLES));
    for (const popup of roled) {
      const layer = watch.layerOf(popup);
      if (fits(layer)) return layer;
      if (fits(popup)) return popup;
    }
  }
  for (const el of fresh) {
    const layer = isLayer(el) ? el : firstLayerIn(el);
    if (layer && fits(layer)) return layer;
  }
  return undefined;
}

/**
 * What a control opened, for `session.opened`, which tells the gate where an
 * option may be pressed, so only what the control is tied to: what it says it
 * controls, or what came on show once it says it is expanded. After a press,
 * which is what made it, a new list, menu or dialog counts too. Something
 * that merely came on show while the pointer rested on a control (a tooltip,
 * a banner, the page's own news) is not what the control opened.
 */
function openedBy(run: Run, el: Element, watch: Popups, pressed: boolean): Element | undefined {
  const own = watch.popupOf();
  if (own && isDrawn(own) && hasBox(own)) return own;
  if (expanded(el)) return findOpened(run, el, watch);
  if (!pressed) return undefined;
  const popup = findOpened(run, el, watch);
  return popup && (popup.matches(POPUP_ROLES) || popup.querySelector(`${POPUP_ROLES}, ${OPTIONS}`)) ? popup : undefined;
}

/** The first box drawn over the page inside `el`, looking at a few dozen elements at most. */
function firstLayerIn(el: Element): Element | undefined {
  const all = el.getElementsByTagName("*");
  for (let i = 0; i < all.length && i < 60; i++) if (isLayer(all[i]!)) return all[i]!;
  return undefined;
}

function hasBox(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width >= 4 && rect.height >= 4;
}

/** A class word that marks something as disabled, in the way most toolkits write it: "is-disabled", "Mui-disabled", "option-disabled". */
const DISABLED_TOKEN = /(?:^|[-_]|is)disabled$/i;

/** Whether a data- attribute says yes: present and empty, as Radix writes it, or "true", as cmdk writes it. cmdk writes "false" on every item that is not. */
function flagged(el: Element, name: string): boolean {
  const value = el.getAttribute(name);
  return value !== null && value !== "false";
}

function disabled(el: Element): boolean {
  for (let at: Element | null = el, depth = 0; at && depth < 3; at = at.parentElement, depth++) {
    if (at.getAttribute("aria-disabled") === "true" || flagged(at, "data-disabled") || (at as HTMLButtonElement).disabled === true) return true;
    if (Array.from(at.classList).some((token) => DISABLED_TOKEN.test(token))) return true;
  }
  return false;
}

/**
 * The choices on show in what opened: what the page marks as an option or an
 * entry, or list items; and when it marks none that are drawn, the short
 * leaf texts in it, as a person sees them, preferring those the pointer
 * shows a hand over. Disabled ones are left out.
 */
function optionCandidates(popup: Element): Element[] {
  const drawn = (el: Element) => isDrawn(el) && hasBox(el) && !disabled(el);
  const marked = Array.from(popup.querySelectorAll(`${OPTIONS}, li`)).filter(drawn);
  const inner = (list: Element[]) => list.filter((el) => !list.some((other) => other !== el && el.contains(other) && other.matches(OPTIONS)));
  if (marked.length) return inner(marked);
  const leaves: Element[] = [];
  const all = popup.getElementsByTagName("*");
  for (let i = 0; i < all.length && i < 3000 && leaves.length < 300; i++) {
    const el = all[i]!;
    if (el.matches("input, textarea, select, script, style, svg, svg *")) continue;
    const text = optionWords(el);
    if (!text || text.length > 80) continue;
    if (Array.from(el.children).some((child) => optionWords(child) === text)) continue;
    if (drawn(el)) leaves.push(el);
  }
  const handed = leaves.filter((el) => getComputedStyle(el).cursor === "pointer");
  return handed.length ? handed : leaves;
}

/** An option's words: its aria-label, or its text with a space between its parts. */
function optionWords(el: Element): string {
  const given = el.getAttribute("aria-label");
  if (given?.trim()) return given.replace(/\s+/g, " ").trim();
  let text = "";
  const walk = (node: Node) => {
    if (text.length > 200) return;
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
    else if (node instanceof Element && !node.matches("script, style, svg, input, textarea, select")) {
      for (const child of node.childNodes) walk(child);
      text += " ";
    }
  };
  walk(el);
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The option in what opened that the value names: exactly; else the only one
 * that starts with it; else the only one holding all its words. A list that
 * scrolls is looked through a page at a time, from the top, at most ten
 * pages, which is how a virtual list shows what it holds. "twice": more than
 * one fits as well, and the visitor picks.
 */
async function findOption(run: Run, popup: Element, value: string): Promise<Element | "none" | "twice"> {
  const here = () => matchOne(value, optionCandidates(popup).map((el) => ({ el, text: optionWords(el) })));
  const first = here();
  if (first !== "none") return first;
  // Not among what the list has drawn: a long or virtual list, looked through a page at a time from the top.
  const scroller = scrollerIn(popup);
  if (!scroller) return "none";
  if (scroller.scrollTop > 0) {
    scroller.scrollTop = 0;
    await quiet(run, popup);
  }
  for (let page = 0; page < PAGES; page++) {
    const found = here();
    if (found !== "none") return found;
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) break;
    run.check();
    scroller.scrollTop += Math.max(20, scroller.clientHeight * 0.9);
    await quiet(run, popup);
  }
  return "none";
}

/** What scrolls inside a popup: the popup itself or the first box in it whose content is taller than it. */
function scrollerIn(popup: Element): Element | undefined {
  const scrolls = (el: Element) => el.scrollHeight > el.clientHeight + 4 && /auto|scroll|overlay/.test(getComputedStyle(el).overflowY);
  if (scrolls(popup)) return popup;
  const all = popup.getElementsByTagName("*");
  for (let i = 0; i < all.length && i < 400; i++) if (scrolls(all[i]!)) return all[i]!;
  return undefined;
}

/** Words that say nothing about which option is meant. */
const STOP_WORDS = new Set(["a", "an", "the", "of", "for", "to", "in", "on", "at", "by", "per", "with", "and", "or", "my", "our", "your", "their", "its"]);

/** Lower case, accents off, spaces made one. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Folded, with every space and mark of punctuation taken out: "The God father" and "The Godfather" are the same. */
function squash(text: string): string {
  return fold(text).replace(/[^\p{L}\p{N}]+/gu, "");
}

function wordsOf(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !STOP_WORDS.has(word));
}

/** The words of a value worth typing into a search box, first first. */
function searchWords(value: string): string[] {
  const words = value
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word && !STOP_WORDS.has(word.toLowerCase()));
  return words.length ? words : [value];
}

/** How well an option's words fit a value. */
function fits(value: string, text: string): "exact" | "starts" | "words" | "no" {
  const [v, t] = [squash(value), squash(text)];
  if (!v || !t) return "no";
  if (v === t) return "exact";
  if (t.startsWith(v)) return "starts";
  const mine = wordsOf(value);
  const theirs = wordsOf(text);
  const same = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
  if (mine.length && mine.every((word) => theirs.some((other) => same(word, other)))) return "words";
  return "no";
}

/**
 * The one candidate that fits the value best: an exact match wins; else the
 * only one that starts with it; else the only one holding all its words.
 * Several equally good: "twice".
 */
function matchOne<T extends { el: Element; text: string }>(value: string, candidates: T[]): Element | "none" | "twice" {
  for (const level of ["exact", "starts", "words"] as const) {
    const at = candidates.filter((candidate) => fits(value, candidate.text) === level);
    // The same words twice, as one option drawn in two layers, is still one.
    const distinct = new Set(at.map((candidate) => candidate.el));
    if (distinct.size === 1) return at[0]!.el;
    if (distinct.size > 1) return "twice";
  }
  return "none";
}

/** Waits until a list has stopped changing: quiet for a moment, or at most a second and a half. */
async function quiet(run: Run, el: Element): Promise<void> {
  run.check();
  await new Promise<void>((resolve) => {
    let timer = setTimeout(finish, LIST_QUIET_MS);
    const limit = setTimeout(finish, OPEN_MS);
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(finish, LIST_QUIET_MS);
    });
    function finish() {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(limit);
      resolve();
    }
    try {
      observer.observe(el.isConnected ? el : document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    } catch {
      finish();
    }
  });
  run.check();
}

// What came of a press -----------------------------------------------------

/** How a control and the page stood before a press, to tell afterwards whether anything came of it. */
interface Signs {
  address: string;
  dialog: Element | undefined;
  /** The list or menu Haptic opened, if one was open: one that closes, if only by a class, is something the press did. */
  list: Element | undefined;
  look: string;
  changed: () => boolean;
  leaving: () => boolean;
}

/** Starts watching for what a press does: the address, a page load beginning, a dialog, the control's own look, and anything visible changing elsewhere. */
function pageSigns(run: Run, control: Element): Signs {
  const host = run.session.host;
  let changed = false;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target;
      if (target === host || host.contains(target)) continue;
      if (record.type === "attributes") {
        const name = record.attributeName ?? "";
        if (name.startsWith("data-") || name === "style" || name === "class" || name === "tabindex" || name === "aria-activedescendant") continue;
      } else if (control.contains(target)) continue;
      changed = true;
      return;
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  let leaving = false;
  const onLeave = () => {
    leaving = true;
  };
  // Only to notice that a page load began; nothing is asked of the visitor and it is removed when the step ends.
  window.addEventListener("beforeunload", onLeave);
  run.onEnd(() => {
    observer.disconnect();
    window.removeEventListener("beforeunload", onLeave);
  });
  return {
    address: location.href,
    dialog: findOpenModal(host),
    list: run.session.opened?.popup && isDrawn(run.session.opened.popup) ? run.session.opened.popup : undefined,
    look: lookOf(control),
    changed: () => {
      if (!changed) for (const record of observer.takeRecords()) if (!(record.target === host || host.contains(record.target))) changed = true;
      return changed;
    },
    leaving: () => leaving,
  };
}

/** Waits for a sign that a press did something. A link counts the address and a page load first. */
async function waitForSign(run: Run, control: Element, before: Signs, watch: Popups, kind: "link" | "button"): Promise<{ any: boolean; popup?: Element }> {
  let popup: Element | undefined;
  const any = await waitFor(
    run,
    () => {
      if (before.leaving() || location.href !== before.address) return true;
      popup ??= findOpened(run, control, watch);
      if (popup) return true;
      if (findOpenModal(run.session.host) !== before.dialog) return true;
      if (before.list && !isDrawn(before.list)) return true;
      if (control.isConnected && lookOf(control) !== before.look) return true;
      return before.changed();
    },
    kind === "link" ? CHECK_MS : 900,
  );
  return { any: !!any, ...(popup ? { popup } : {}) };
}

/** The words on a control and the states it reports, as one string, compared with itself a moment later. Nothing is read from a field. */
function lookOf(el: Element): string {
  const attributes = ["aria-expanded", "aria-checked", "aria-selected", "aria-pressed", "aria-current", "aria-disabled", "aria-label", "title"].map((name) => el.getAttribute(name) ?? "");
  const ticked = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? String(el.checked) : "";
  const words = isTextField(el) || el instanceof HTMLSelectElement ? "" : (el.textContent ?? "").slice(0, 120);
  return [...attributes, ticked, String((el as HTMLButtonElement).disabled === true), words].join("|");
}

/** The panel a tab shows, by `aria-controls`. */
function panelOf(tab: Element): Element | undefined {
  const id = tab.getAttribute("aria-controls");
  return (id && document.getElementById(id)) || undefined;
}

function panelLook(panel: Element): string {
  return `${isDrawn(panel)}|${panel.getAttribute("data-state") ?? ""}|${panel.getAttribute("hidden") ?? ""}`;
}

/** It says it opens something: a menu, a list, a dialog. */
function opener(el: Element): boolean {
  const popup = el.getAttribute("aria-haspopup");
  return (!!popup && popup !== "false") || (el.hasAttribute("aria-expanded") && el.getAttribute("role") !== "combobox" && !el.matches("summary"));
}

function expanded(el: Element): boolean {
  return el.getAttribute("aria-expanded") === "true";
}

// Getting there, and the press itself ---------------------------------------

/** Where the visible pointer last was, and what was under it, so the next glide starts there and hover events leave the right element. */
let pointerAt: { x: number; y: number } | undefined;
let under: Element | undefined;

/**
 * Brings a control on screen and holds until it is still, then asks the gate
 * where a press would land (rule 0). Refused or covered: the step ends with
 * what the gate says.
 */
async function getThere(run: Run, el: Element, plan: ActPlan, eyeMs: number): Promise<{ x: number; y: number; hit: Element }> {
  await bringIntoView(run, el);
  let reach = reachable(el, plan, run.session, run.ctx.config);
  if (!reach.ok) throw refused(reach.plan);
  await hoverTo(run, reach.x, reach.y);
  if (eyeMs) await run.pause(eyeMs);
  // Again, right before the press: hovering can open, move or cover things.
  reach = reachable(el, plan, run.session, run.ctx.config);
  if (!reach.ok) throw refused(reach.plan);
  return reach;
}

/**
 * A press on a control as a mouse makes it, after getting there. Returns
 * whether a click followed. `ready` runs right before the first event of the
 * press, once the pointer is there, so that what hovering did is not taken
 * for what the press did.
 */
async function press(run: Run, el: Element, plan: ActPlan, eyeMs = EYE_MS, ready?: () => void): Promise<boolean> {
  const at = await getThere(run, el, plan, eyeMs);
  if (Math.abs((pointerAt?.x ?? -1) - at.x) > 1 || Math.abs((pointerAt?.y ?? -1) - at.y) > 1) await hoverTo(run, at.x, at.y);
  ready?.();
  return pressAt(run, el, at);
}

/**
 * The events of one press (DESIGN 3.3): pointer and mouse down on what is
 * under the point, the keyboard moved as a press moves it, a moment held,
 * then up and a click, but only if what was pressed is still there under the
 * point. A control that acted as the mouse went down and is gone gets no
 * click: a browser would click whatever is there now, which the gate never saw.
 */
async function pressAt(run: Run, control: Element, at: { x: number; y: number; hit: Element }): Promise<boolean> {
  const { x, y, hit } = at;
  run.check();
  run.count();
  const downOk = fire(run, hit, pointerEvent("pointerdown", x, y, { button: 0, buttons: 1, pressure: 0.5 }), true);
  const mouseOk = downOk ? fire(run, hit, mouseEvent("mousedown", x, y, { button: 0, buttons: 1, detail: 1 }), true) : true;
  if (mouseOk) focusFrom(hit, run.session.host);
  run.ctx.ui.ripple(x, y);
  await sleep(HOLD_MS);
  run.check();
  const now = hitAt(x, y, run.session.host);
  let upOn: Element | undefined;
  // Still under the point: the same element, something inside it, or the control around it.
  if (hit.isConnected && now && (isWithin(hit, now) || (isWithin(now, hit) && isWithin(control, now)))) upOn = hit;
  // The page drew the control's inside again under the mouse: the same control, on a new node.
  else if (control.isConnected && !hit.isConnected && now && isWithin(control, now)) upOn = now;
  if (!upOn) {
    if (hit.isConnected) {
      fire(run, hit, pointerEvent("pointerup", x, y, { button: 0, buttons: 0, pressure: 0 }), true);
      if (downOk) fire(run, hit, mouseEvent("mouseup", x, y, { button: 0, buttons: 0, detail: 1 }), true);
    }
    return false;
  }
  fire(run, upOn, pointerEvent("pointerup", x, y, { button: 0, buttons: 0, pressure: 0 }), true);
  if (downOk && upOn.isConnected) fire(run, upOn, mouseEvent("mouseup", x, y, { button: 0, buttons: 0, detail: 1 }), true);
  run.check();
  // A control that acted as the mouse came up and is gone gets no click either.
  if (!upOn.isConnected) return false;
  fire(run, upOn, mouseEvent("click", x, y, { button: 0, buttons: 0, detail: 1 }), true);
  return true;
}

/**
 * Glides the visible pointer to a point while the page hears a mouse move
 * there: a few points along the way are hit-tested, and each new element
 * under the path is left and entered as a mouse leaves and enters it. These
 * are hover events only, with no default action.
 */
async function hoverTo(run: Run, x: number, y: number): Promise<void> {
  run.check();
  const from = pointerAt ?? { x, y };
  const far = Math.hypot(x - from.x, y - from.y) > 2;
  const glide = run.ctx.ui.glideTo(x, y).catch(() => undefined);
  const points = far ? HOVER_POINTS : 1;
  for (let i = 1; i <= points; i++) {
    run.check();
    const px = from.x + ((x - from.x) * i) / points;
    const py = from.y + ((y - from.y) * i) / points;
    moveTo(run, px, py);
    if (i < points) await sleep(HOVER_GAP_MS);
  }
  await glide;
  run.check();
  pointerAt = { x, y };
}

function moveTo(run: Run, x: number, y: number) {
  const host = run.session.host;
  const hit = hitAt(x, y, host) ?? undefined;
  const was = under?.isConnected ? under : undefined;
  if (hit !== was) {
    const [left, entered] = [chainOf(was), chainOf(hit)];
    if (was) {
      fire(run, was, pointerEvent("pointerout", x, y, { relatedTarget: hit ?? null }), false);
      for (const el of left.filter((el) => !entered.includes(el))) fire(run, el, pointerEvent("pointerleave", x, y, { relatedTarget: hit ?? null, bubbles: false, cancelable: false }), false);
      fire(run, was, mouseEvent("mouseout", x, y, { relatedTarget: hit ?? null }), false);
      for (const el of left.filter((el) => !entered.includes(el))) fire(run, el, mouseEvent("mouseleave", x, y, { relatedTarget: hit ?? null, bubbles: false, cancelable: false }), false);
    }
    if (hit) {
      const fresh = entered.filter((el) => !left.includes(el)).reverse();
      fire(run, hit, pointerEvent("pointerover", x, y, { relatedTarget: was ?? null }), false);
      for (const el of fresh) fire(run, el, pointerEvent("pointerenter", x, y, { relatedTarget: was ?? null, bubbles: false, cancelable: false }), false);
      fire(run, hit, mouseEvent("mouseover", x, y, { relatedTarget: was ?? null }), false);
      for (const el of fresh) fire(run, el, mouseEvent("mouseenter", x, y, { relatedTarget: was ?? null, bubbles: false, cancelable: false }), false);
    }
    under = hit;
  }
  if (hit) {
    fire(run, hit, pointerEvent("pointermove", x, y, { buttons: 0 }), false);
    fire(run, hit, mouseEvent("mousemove", x, y, { buttons: 0 }), false);
  }
}

/** An element and its ancestors, innermost first, through the shadow roots it is in. */
function chainOf(el: Element | undefined): Element[] {
  const chain: Element[] = [];
  for (let at: Node | null = el ?? null; at; at = at.parentNode ?? (at as ShadowRoot).host ?? null) if (at instanceof Element) chain.push(at);
  return chain;
}

/** Brings a control wholly on screen, smoothly unless the visitor asked for less motion, and waits until it holds still. */
async function bringIntoView(run: Run, el: Element): Promise<void> {
  const part = shownPart(el);
  if (!onScreen(part)) {
    try {
      part.scrollIntoView({ block: "center", inline: "nearest", behavior: lessMotion() ? "auto" : "smooth" });
    } catch {
      part.scrollIntoView();
    }
  }
  await still(run, part);
  if (!onScreen(part)) {
    try {
      part.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {
      // As far as it goes.
    }
    await still(run, part);
  }
}

/** Waits until the element's box is the same for two frames running, at most `STILL_MS`. */
async function still(run: Run, el: Element): Promise<void> {
  let before = "";
  let same = 0;
  for (const until = Date.now() + STILL_MS; Date.now() < until; ) {
    run.check();
    const rect = el.getBoundingClientRect();
    const now = `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`;
    same = now === before ? same + 1 : 0;
    if (same >= 2) return;
    before = now;
    await nextFrame();
  }
}

/** Whether the whole element is inside the window and inside every box around it that scrolls. */
function onScreen(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  if (rect.top < 0 || rect.left < 0 || rect.bottom > window.innerHeight || rect.right > window.innerWidth) return false;
  for (let at = el.parentElement, depth = 0; at && at !== document.body && depth < 12; at = at.parentElement, depth++) {
    const style = getComputedStyle(at);
    if (!/auto|scroll|hidden|overlay/.test(style.overflowY + style.overflowX)) continue;
    const box = at.getBoundingClientRect();
    if (rect.top < box.top - 1 || rect.bottom > box.bottom + 1 || rect.left < box.left - 1 || rect.right > box.right + 1) return false;
  }
  return true;
}

/** The part of a control a person sees: the control, or for a tick box drawn as a speck under its label, the label. */
function shownPart(el: Element): Element {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  if (rect.width >= 4 && rect.height >= 4 && style.opacity !== "0" && style.visibility !== "hidden") return el;
  const labels = Array.from((el as HTMLInputElement).labels ?? []);
  const named = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => (id ? document.getElementById(id) : null));
  return [...labels, el.closest("label"), ...named].find((part): part is HTMLElement => !!part && hasBox(part)) ?? el.parentElement ?? el;
}

function lessMotion(): boolean {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Events ------------------------------------------------------------------------

/** Dispatches an event. One that activates something and is held up past `BLOCKED_MS` was held by a dialog of the browser's own, which the visitor answered. */
function fire(run: Run, el: Element, event: Event, activation: boolean): boolean {
  const started = performance.now();
  // Marked as Haptic's own, so the guide's hearing, which ignores what a page's script dispatches, hears it while Haptic acts.
  const allowed = el.dispatchEvent(markOwn(event));
  if (activation && performance.now() - started > BLOCKED_MS) {
    throw new Halt("blocked", () => ({ kind: "stop", reason: "confirmation", say: SAYS.answered, el, event: `You used ${run.name}, and the page asked a question of its own, which the visitor answered.` }));
  }
  return allowed;
}

function mouseInit(x: number, y: number, extra: MouseEventInit): MouseEventInit {
  return { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x + (window.screenX || 0), screenY: y + (window.screenY || 0), ...extra };
}

function mouseEvent(type: string, x: number, y: number, extra: MouseEventInit = {}): MouseEvent {
  return new MouseEvent(type, mouseInit(x, y, extra));
}

function pointerEvent(type: string, x: number, y: number, extra: PointerEventInit = {}): Event {
  const init: PointerEventInit = { ...mouseInit(x, y, extra), pointerId: 1, pointerType: "mouse", isPrimary: true, width: 1, height: 1 };
  if (typeof PointerEvent === "function") return new PointerEvent(type, init);
  return new MouseEvent(type, init);
}

const KEY_CODES: Record<string, [string, number]> = {
  Enter: ["Enter", 13],
  " ": ["Space", 32],
  Escape: ["Escape", 27],
  Tab: ["Tab", 9],
  ArrowDown: ["ArrowDown", 40],
  ArrowUp: ["ArrowUp", 38],
  ArrowLeft: ["ArrowLeft", 37],
  ArrowRight: ["ArrowRight", 39],
  Home: ["Home", 36],
  End: ["End", 35],
};

/** A keyboard event with `key` and `code`, and `keyCode` and `which` defined on it for libraries that still read them. */
function keyEvent(type: "keydown" | "keyup", key: string): KeyboardEvent {
  const named = KEY_CODES[key];
  let code = named?.[0] ?? "";
  let keyCode = named?.[1] ?? 0;
  if (!named && key.length === 1) {
    const upper = key.toUpperCase();
    if (/[A-Z]/.test(upper)) [code, keyCode] = [`Key${upper}`, upper.charCodeAt(0)];
    else if (/[0-9]/.test(key)) [code, keyCode] = [`Digit${key}`, key.charCodeAt(0)];
    else keyCode = key.charCodeAt(0);
  }
  const event = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, composed: true, view: window });
  try {
    Object.defineProperty(event, "keyCode", { value: keyCode });
    Object.defineProperty(event, "which", { value: keyCode });
  } catch {
    // The event keeps the browser's own values.
  }
  return event;
}

/** Presses one key on `el`, if the gate allows that key there. */
function keyPress(run: Run, el: Element, key: string): boolean {
  run.check();
  if (!keyAllowed(el, key, run.plan, run.session)) return false;
  run.count();
  fire(run, el, keyEvent("keydown", key), true);
  fire(run, el, keyEvent("keyup", key), true);
  return true;
}

/** What a click at this point would land on, looking through Haptic's own element and into open shadow roots. */
function hitAt(x: number, y: number, host: Element): Element | null {
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null;
  let hit = document.elementsFromPoint(x, y).find((el) => el !== host && !host.contains(el)) ?? null;
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

/** Whether `node` is `el` or inside it, shadow roots included. */
function isWithin(el: Element, node: Node | null): boolean {
  for (let at: Node | null = node; at; at = at.parentNode ?? (at as ShadowRoot).host ?? null) if (at === el) return true;
  return false;
}

const FOCUSABLE = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, iframe, summary, [tabindex], [contenteditable]:not([contenteditable="false"])';

/** Moves the keyboard as a mouse press does: to the nearest element that takes it, or off whatever had it when nothing does. */
function focusFrom(hit: Element, host: Element) {
  for (let at: Node | null = hit; at; at = at.parentNode ?? (at as ShadowRoot).host ?? null) {
    if (!(at instanceof HTMLElement || at instanceof SVGElement)) continue;
    if (at === document.body || at === document.documentElement) break;
    if (at.matches(FOCUSABLE) && !(at as HTMLButtonElement).disabled) {
      if (deepActive() !== at) focusOn(at);
      return;
    }
  }
  const active = deepActive();
  if (active && active !== document.body && active !== host && !isWithin(host, active)) (active as HTMLElement).blur?.();
}

function focusOn(el: Element) {
  try {
    (el as HTMLElement).focus({ preventScroll: true });
  } catch {
    // Not something that takes the keyboard.
  }
}

/** The element the keyboard is in, looking inside shadow roots. */
function deepActive(): Element | undefined {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active ?? undefined;
}

function holdsFocus(el: Element): boolean {
  const active = deepActive();
  return !!active && (active === el || isWithin(el, active));
}

// Small things -------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The next frame, or a moment when frames are not being drawn (a page in the background). */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 50);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Asks `ready` every 50 ms until it gives something, at most `ms`. */
async function waitFor<T>(run: Run, ready: () => T | undefined | false, ms: number): Promise<T | undefined> {
  for (const until = Date.now() + ms; ; ) {
    run.check();
    const got = ready();
    if (got) return got;
    if (Date.now() >= until) return undefined;
    await sleep(50);
  }
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** How events name another control: as the reading listed it, or by its words. */
function nameOf(run: Run, el: Element): string {
  const listed = run.ctx.listing.get(el);
  if (listed) return describeElement(listed);
  const words = fieldName(el);
  return words ? `"${words}"` : "the field";
}

/** A control's name as the visitor sees it, for "What I did". */
function listedName(run: Run, el: Element): string {
  return cleanText(run.ctx.listing.get(el)?.label ?? fieldName(el), 60);
}

/**
 * What names a field that the reading did not list: its aria-label, what its
 * aria-labelledby points at, or its label. Never its own words, which for a
 * select are the choice it shows, not its name.
 */
function fieldName(el: Element): string {
  const given = el.getAttribute("aria-label");
  if (given?.trim()) return cleanText(given, 60);
  const named = (el.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => (id ? document.getElementById(id) : null))
    .filter((part): part is HTMLElement => !!part && part !== el && !part.contains(el))
    .map((part) => optionWords(part))
    .join(" ");
  if (named.trim()) return cleanText(named, 60);
  const label = (el as HTMLInputElement).labels?.[0];
  return label ? cleanText(optionWords(label), 60) : "";
}
