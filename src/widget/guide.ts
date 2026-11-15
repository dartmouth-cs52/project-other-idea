import { describeElement, normalizePath, type HistoryTurn, type SnapElement, type Snapshot, type TurnReply, type TurnRequest } from "../shared/types.ts";
import { currentPath, describeChange, elementKey, isField, NOTHING_CHANGED, takeSnapshot } from "./snapshot.ts";
import type { Ui } from "./ui.ts";

// Runs one guide: ask the model for a step, point at it, wait for the visitor
// to act, let the page settle, and go again until the model says it's done.

const MAX_STEPS = 20;
const MAX_HISTORY = 12;
/** A field counts as filled in once typing pauses this long. */
const TYPING_PAUSE_MS = 1200;
const STORAGE_KEY = "haptic.guide";
/** Shown the moment the visitor does something other than the step, while the next step is worked out. */
const OFF_TRACK = "Finding the way from here…";
/** A saved guide older than this isn't picked back up after a page load. */
const RESUME_WINDOW_MS = 3 * 60 * 1000;
const CLICKABLE = 'a[href], button, summary, select, input, textarea, label, [role], [onclick], [tabindex]:not([tabindex="-1"])';
/** A page that is still listing nothing this long after it was first read has nothing to list. */
const EMPTY_PAGE_WAIT_MS = 12_000;
/** A press that no click follows within this long was a pick that removed what was pressed. */
const PRESS_WITHOUT_CLICK_MS = 450;
/** A page load that has not happened this long after it began was a download, or was called off. */
const LEAVING_WAIT_MS = 8000;

/**
 * Whether this page has begun to load another one. A click on an ordinary link
 * starts the load at once, but the page stays up, scripts and all, until the
 * next one begins to arrive, which on a slow site is a second or more. A step
 * asked for in that time would be answered to a page that no longer exists,
 * and its failure would look like an error and end the guide.
 */
let leavingSince = 0;
const noteLeaving = () => {
  leavingSince = Date.now();
};
const isLeaving = () => leavingSince > 0 && Date.now() - leavingSince < LEAVING_WAIT_MS;
/** Runs `then` unless the page goes away first, in which case nothing more should happen on it. */
function onceStaying(then: () => void) {
  if (!isLeaving()) return then();
  const check = setInterval(() => {
    if (isLeaving()) return;
    clearInterval(check);
    then();
  }, 250);
}

/** What the visitor did, in words for the model, and whether it was the step they were shown. */
interface Acted {
  event: string;
  onTarget: boolean;
}

/** A pointer shown before the rest of the reply was in, and what the visitor did with it, if anything yet. */
interface EarlyPointer {
  el: Element;
  stop: () => void;
  acted?: Acted;
}

interface SavedGuide {
  goal: string;
  history: HistoryTurn[];
  step: number;
  path: string;
  /** What the visitor did just before the page unloaded, if we saw it. */
  event?: string;
  /** Set when that was something other than the step they were shown. */
  strayed?: boolean;
  savedAt: number;
}

export class Guide {
  private goal = "";
  private history: HistoryTurn[] = [];
  private step = 0;
  private previous?: Snapshot;
  /**
   * The element the last step pointed at, and whether the visitor used it. The
   * element itself is kept because two controls can share a description: two
   * fields with no label are not the same field.
   */
  private last?: { key: string; used: boolean; el?: WeakRef<Element> };
  /** The visitor's last action was not the step they were shown. Cleared once the next step is given. */
  private strayed = false;
  /** Bumped whenever the guide is stopped or restarted, so stale async work can tell and bail. */
  private run = 0;
  private stopWaiting?: () => void;

  constructor(
    private readonly ui: Ui,
    private readonly sendTurn: (request: Omit<TurnRequest, "site">, onTarget?: (id: string) => void) => Promise<TurnReply>,
  ) {}

  start(goal: string) {
    this.reset();
    this.goal = goal;
    this.watchLeaving(true);
    void this.turn(this.run);
  }

  /** The listener is there only while a guide runs: some browsers keep a page with one out of their back-forward cache. */
  private watchLeaving(on: boolean) {
    leavingSince = 0;
    window.removeEventListener("beforeunload", noteLeaving);
    if (on) window.addEventListener("beforeunload", noteLeaving);
  }

  stop() {
    this.reset();
    this.ui.clear();
    this.ui.setBusy("");
  }

  /** Pick up a guide that a full page load interrupted. */
  resume() {
    const saved = load();
    if (!saved) return;
    this.reset();
    this.goal = saved.goal;
    this.history = saved.history;
    this.step = saved.step;
    this.strayed = saved.strayed === true;
    const here = currentPath();
    const moved = saved.path === here ? "The page reloaded." : `A new page loaded: the user went from ${saved.path} to ${here}.`;
    const run = this.run;
    this.watchLeaving(true);
    this.ui.setBusy(this.strayed ? OFF_TRACK : "Looking at this page…");
    // The script tag can run before the page has finished arriving, let alone drawn itself.
    void loaded()
      .then(() => settle(this.ui.host))
      .then(() => this.turn(run, [saved.event, moved].filter(Boolean).join(" ")));
  }

  private reset() {
    this.run++;
    this.watchLeaving(false);
    this.stopWaiting?.();
    this.stopWaiting = undefined;
    this.history = [];
    this.step = 0;
    this.previous = undefined;
    this.last = undefined;
    this.strayed = false;
    forget();
  }

  private async turn(run: number, event?: string, nudged = false, reread = false): Promise<void> {
    const { ui } = this;
    if (this.step >= MAX_STEPS) return this.finish("That's as far as I can take this one. Ask again to keep going.");
    ui.setBusy(this.step === 0 ? "Finding it…" : this.strayed ? OFF_TRACK : "Next step…");

    ui.place();
    let page = takeSnapshot(ui.host, this.goal);
    // An app that draws itself with JavaScript lists nothing until it has. Asking about an empty page wastes the step.
    for (const began = Date.now(); !page.snapshot.elements.length && Date.now() - began < EMPTY_PAGE_WAIT_MS; ) {
      await settle(ui.host, 300, 1000);
      if (run !== this.run) return;
      page = takeSnapshot(ui.host, this.goal);
    }
    const change = event && this.previous ? describeChange(this.previous, page.snapshot) : undefined;

    // The server names the control before it has finished the sentence about
    // it. The pointer goes there at once. The visitor may act on it straight
    // away, so their action is listened for from that moment and kept until
    // the rest of the reply arrives.
    let early: EarlyPointer | undefined;
    let whenActed: ((what: Acted) => void) | undefined;
    /** Every control that was on the page when it was read. Anything else a visitor clicks appeared since. */
    const known = new Set(page.elements.values());
    const pointEarly = (id: string) => {
      const el = page.elements.get(id);
      if (run !== this.run || early || !el?.isConnected || currentPath() !== page.snapshot.path) return;
      const listed = page.snapshot.elements.find((element) => element.id === id);
      if (listed?.offscreen) el.scrollIntoView({ block: "center", behavior: "smooth" });
      ui.pointAt(el, "");
      const waiting: EarlyPointer = {
        el,
        stop: waitForAction(el, listed, ui.host, known, (what) => {
          waiting.acted = what;
          // If this click loads a new page before the reply is in, the next page still needs to know about it.
          this.strayed = !what.onTarget;
          this.save(what.event);
          whenActed?.(what);
        }),
      };
      early = waiting;
      this.stopWaiting = waiting.stop;
    };
    /** Takes back an early pointer that the full reply did not bear out. */
    const dropEarly = () => {
      if (!early) return;
      early.stop();
      if (this.stopWaiting === early.stop) this.stopWaiting = undefined;
      early = undefined;
      ui.clearPointer();
    };

    let reply: TurnReply;
    try {
      reply = await this.sendTurn(
        {
          goal: this.goal,
          step: this.step,
          history: this.history.slice(-MAX_HISTORY),
          snapshot: page.snapshot,
          ...(event ? { event } : {}),
          ...(change ? { change } : {}),
        },
        pointEarly,
      );
    } catch (error) {
      // The page is on its way out and took the request with it. The next page picks the guide up.
      if (run !== this.run || isLeaving()) return;
      dropEarly();
      console.warn("[Haptic]", error);
      return this.finish("Something went wrong on our side. Try asking again.");
    }
    if (run !== this.run || isLeaving()) return;

    // The answer is about a page the visitor has already left. Start over from where they are now.
    const here = currentPath();
    if (here !== page.snapshot.path) {
      dropEarly();
      await settle(ui.host);
      if (run !== this.run) return;
      return this.turn(run, `${event ?? ""} The user went from ${page.snapshot.path} to ${here}.`.trim());
    }

    const el = reply.target ? page.elements.get(reply.target) : undefined;
    const listed = reply.target ? page.snapshot.elements.find((element) => element.id === reply.target) : undefined;

    // Data that arrives a moment after a click, with no sign that it is on its
    // way, lands while the model is answering. The answer is then about a page
    // that is no longer there: the old list, an empty table, a "nothing found"
    // that was only true for half a second. Look again, and if what can be
    // clicked has changed in a way that matters, ask once more about the page
    // as it is now. Once only, so a page that never stops moving still gets its step.
    if (!reread && !early?.acted && movedOn(page.snapshot, takeSnapshot(ui.host, this.goal).snapshot, listed, el)) {
      dropEarly();
      await settle(ui.host);
      if (run !== this.run) return;
      return this.turn(run, event, nudged, true);
    }

    // Pointing again at what the visitor just used, with the page unchanged,
    // is a loop. Ask once more saying so, then give up rather than repeat.
    const lastEl = this.last?.el?.deref();
    const sameControl = !!listed && this.last?.key === elementKey(listed) && (!lastEl?.isConnected || lastEl === el);
    if (listed && this.last?.used && sameControl && change === NOTHING_CHANGED && reply.status === "continue") {
      dropEarly();
      if (nudged) return this.finish("That step didn't change anything I can see, so I've stopped here. Ask again if there's more to do.");
      const nudge = `You pointed at ${describeElement(listed)} again, but the user already used it and nothing changed. Don't point at it again: move on, or say it's done.`;
      return this.turn(run, `${event} ${nudge}`, true);
    }

    this.history.push({ role: "user", text: this.step === 0 ? this.goal : (event ?? "The page changed.") }, { role: "assistant", text: reply.say });
    this.step++;
    this.previous = page.snapshot;
    this.last = listed ? { key: elementKey(listed), used: false, ...(el ? { el: new WeakRef(el) } : {}) } : undefined;
    this.strayed = false;

    if (!el || !el.isConnected) {
      dropEarly();
      return this.finish(reply.say);
    }
    if (early?.el !== el) {
      dropEarly();
      if (listed?.offscreen) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    // If they have already used it, the caption would only flash.
    if (!early?.acted) ui.pointAt(el, reply.say);

    if (reply.status === "done") {
      // An explanation that points at something. Leave it up until they click anywhere.
      early?.stop();
      ui.setBusy("");
      ui.closePanel();
      forget();
      const dismiss = () => run === this.run && ui.clear();
      document.addEventListener("click", dismiss, { capture: true, once: true });
      this.stopWaiting = () => document.removeEventListener("click", dismiss, true);
      return;
    }

    ui.closePanel();
    this.save();
    const acted = (what: Acted) => {
      this.stopWaiting = undefined;
      if (this.last && what.onTarget) this.last.used = true;
      this.strayed = !what.onTarget;
      // Saved straight away: if this click loads a new page, the next page needs to know about it.
      this.save(what.event);
      ui.clearPointer();
      ui.setBusy(this.strayed ? OFF_TRACK : "Next step…");
      void settle(ui.host).then(() =>
        // If that click is loading a new page, this one has nothing more to ask.
        onceStaying(() => {
          if (run === this.run) void this.turn(run, what.event);
        }),
      );
    };
    // The early pointer is already listening. Hand its result over, now or when it comes.
    if (early?.acted) acted(early.acted);
    else if (early) whenActed = acted;
    else this.stopWaiting = waitForAction(el, listed, ui.host, known, acted);
  }

  private finish(text: string) {
    this.stopWaiting?.();
    this.stopWaiting = undefined;
    this.watchLeaving(false);
    forget();
    this.ui.setBusy("");
    this.ui.closePanel();
    this.ui.say(text);
  }

  private save(event?: string) {
    const saved: SavedGuide = {
      goal: this.goal,
      history: this.history.slice(-MAX_HISTORY),
      step: this.step,
      path: currentPath(),
      savedAt: Date.now(),
      ...(event ? { event } : {}),
      ...(this.strayed ? { strayed: true } : {}),
    };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Storage full or blocked. The guide just won't survive a page load.
    }
  }
}

function load(): SavedGuide | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as SavedGuide | null;
    return saved && Date.now() - saved.savedAt < RESUME_WINDOW_MS ? saved : undefined;
  } catch {
    return undefined;
  }
}

function forget() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Calls `done` once, when the visitor does what the step asked or does
 * something else that moves things along. Returns a function that stops
 * listening.
 *
 * `known` is every control that was on the page when it was read. Real apps
 * make "used the control" less plain than a click on it:
 * - A field can be a button in disguise: a read-only input that opens a list.
 *   Clicking it is the whole action.
 * - A list that opens under a field is part of using the field, so picking
 *   from it is not a wrong click.
 * - A styled checkbox is often an invisible input under a label. The label is
 *   all a visitor can click.
 * - Some lists act when the mouse goes down and are gone before it comes up,
 *   so no click ever happens. The press is all there is to hear.
 */
function waitForAction(
  target: Element,
  listed: SnapElement | undefined,
  host: Element,
  known: Set<Element>,
  done: (what: Acted) => void,
): () => void {
  const name = listed ? describeElement(listed) : "the element you pointed at";
  const field = isField(target);
  // A field nobody can type in is used by clicking it.
  const typedInto = field && !(target instanceof HTMLSelectElement) && !(target as HTMLInputElement).readOnly;
  const ticked = target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio");
  const startUrl = location.href;
  let typing: ReturnType<typeof setTimeout> | undefined;
  let pressed: ReturnType<typeof setTimeout> | undefined;
  /** Where the mouse last went down, until the click that belongs to it has been dealt with. */
  let pressPath: EventTarget[] | undefined;
  /** The visitor has clicked into the field, so what opens next belongs to it. */
  let opened = false;

  const finish = (event: string, onTarget: boolean) => {
    stop();
    done({ event, onTarget });
  };
  const filled = () => finish(`The user filled in ${name}. You can't see what they entered.`, true);
  const labelOfClicked = (el: Element) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
  /** Whether a click that landed on `path` was a click on the target, counting the label that stands in for it. */
  const onTarget = (path: EventTarget[]) =>
    path.includes(target) || path.some((node) => node instanceof HTMLLabelElement && (node.control === target || node.contains(target)));

  const used = (path: EventTarget[]) => {
    if (path.includes(host)) return;
    if (onTarget(path)) {
      // For a field, clicking into it isn't the action. Typing or picking is.
      if (!typedInto && !(target instanceof HTMLSelectElement)) return finish(`The user clicked ${name}.`, true);
      // A dropdown that already shows the right choice gives nothing to hear: the
      // visitor opens it, picks what was there, and no change is reported. The
      // second click, which is the list closing, is the pick.
      if (target instanceof HTMLSelectElement && opened) return filled();
      opened = true;
      return;
    }
    const other = path.find((node): node is Element => node instanceof Element && node.matches(CLICKABLE));
    // A click on blank space or plain text isn't worth a new step.
    if (!other || other.contains(target)) return;
    const label = labelOfClicked(other);
    // Something that was not on the page before the visitor went into the field is the list the field opened.
    if (opened && !known.has(other)) return finish(`The user chose ${label ? `"${label}"` : "an entry"} from the list that ${name} opened.`, true);
    finish(`The user clicked ${label ? `"${label}"` : "something else"} instead of ${name}.`, false);
  };

  const control = (path: EventTarget[]) => path.find((node): node is Element => node instanceof Element && node.matches(CLICKABLE));
  const onClick = (event: MouseEvent) => {
    clearTimeout(pressed);
    const path = event.composedPath();
    const down = pressPath;
    pressPath = undefined;
    // A list that opens as the mouse goes down slides under it, so the click that
    // follows lands on the list's backdrop or on nothing. What was pressed is what was used.
    if (down && !path.includes(host) && control(down) && control(down) !== control(path) && (!control(path) || !path.includes(control(down)!))) return used(down);
    used(path);
  };
  const onPress = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const path = event.composedPath();
    if (path.includes(host)) return;
    pressPath = path;
    clearTimeout(pressed);
    // If a click follows, it is handled there. If none does, because what was pressed has gone, this was the action.
    pressed = setTimeout(() => {
      if (pressPath !== path) return;
      pressPath = undefined;
      const gone = control(path);
      if (gone && !gone.isConnected) used(path);
    }, PRESS_WITHOUT_CLICK_MS);
  };
  const onInput = (event: Event) => {
    if (!event.composedPath().includes(target)) return;
    clearTimeout(typing);
    if (ticked) finish(`The user clicked ${name}.`, true);
    else if (target instanceof HTMLSelectElement) filled();
    else typing = setTimeout(filled, TYPING_PAUSE_MS);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" && field && event.composedPath().includes(target)) filled();
  };
  // Leaving a dropdown after opening it is a pick too, whichever choice it was.
  const onLeave = (event: FocusEvent) => {
    if (opened && target instanceof HTMLSelectElement && event.target === target) filled();
  };
  // Back, forward and anything else that changes the address without a click we saw.
  const poll = setInterval(() => {
    if (location.href !== startUrl && !isLeaving()) finish(`The user went to ${currentPath()} without using ${name}.`, false);
  }, 500);

  const stop = () => {
    clearTimeout(typing);
    clearTimeout(pressed);
    clearInterval(poll);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointerdown", onPress, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onInput, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("focusout", onLeave, true);
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("pointerdown", onPress, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onInput, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("focusout", onLeave, true);
  return stop;
}

/** Resolves once the page itself has finished arriving, or after a few seconds if it never says so. */
function loaded(maxMs = 4000): Promise<void> {
  if (document.readyState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      window.removeEventListener("load", finish);
      clearTimeout(limit);
      resolve();
    };
    const limit = setTimeout(finish, maxMs);
    window.addEventListener("load", finish);
  });
}

/**
 * Whether the page changed, while the model was answering, in a way that
 * makes the answer about a page that is no longer there. `listed` and `el`
 * are what the answer points at, if anything.
 */
function movedOn(asked: Snapshot, now: Snapshot, listed: SnapElement | undefined, el: Element | undefined): boolean {
  const count = (elements: SnapElement[]) => {
    const counts = new Map<string, number>();
    for (const element of elements) counts.set(elementKey(element), (counts.get(elementKey(element)) ?? 0) + 1);
    return counts;
  };
  const before = count(asked.elements);
  const after = count(now.elements);
  let added = 0;
  let removed = 0;
  for (const [key, n] of after) added += Math.max(0, n - (before.get(key) ?? 0));
  for (const [key, n] of before) removed += Math.max(0, n - (after.get(key) ?? 0));
  if (!added && !removed) return false;
  // Pointed at something that has since gone or been renamed: the pointer would land on nothing, or on something else.
  if (listed && (!el?.isConnected || !after.has(elementKey(listed)))) return true;
  // Found nothing to point at, and controls have arrived since: what was wanted may be among them.
  if (!listed) return added > 0;
  // Pointed at something that is still there. Only a page that has largely been redrawn makes that doubtful.
  return added + removed > Math.max(4, asked.elements.length * 0.3);
}

// Common loading markers: ARIA busy regions, progress bars, and the class
// names spinners and skeletons usually carry (Tailwind's included).
const LOADING = '[aria-busy="true"], [role="progressbar"], .animate-spin, .animate-pulse, [class*="skeleton" i], [class*="spinner" i]';

/**
 * Resolves once the page has stopped changing, so the next snapshot shows the
 * result of a click and not a half-rendered page. Waits only as long as the
 * page keeps changing, up to `maxMs`.
 */
export function settle(ignore: Element, quietMs = 300, maxMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout>;
    const finish = () => {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(limit);
      resolve();
    };
    const restart = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        const loading = Array.from(document.querySelectorAll(LOADING)).some((el) => !ignore.contains(el) && el.getClientRects().length > 0);
        if (loading) restart();
        else finish();
      }, quietMs);
    };
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.target !== ignore && !ignore.contains(record.target))) restart();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const limit = setTimeout(finish, maxMs);
    restart();
  });
}
