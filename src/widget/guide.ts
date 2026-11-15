import { cleanText, describeElement, type HistoryTurn, type SnapElement, type Snapshot, type TurnReply, type TurnRequest } from "../shared/types.ts";
import { hear, keyName, keysAsked, nothingHeard, waiting, type Fate, type Heard, type Pointed, type Seen, type Verdict, type Where } from "./observe.ts";
import { currentPath, describeChange, elementKey, findOpenModal, isField, NOTHING_CHANGED, takeSnapshot, type PageSnapshot } from "./snapshot.ts";
import type { Ui } from "./ui.ts";

// Runs one guide: ask the model for a step, point at it, wait for the visitor
// to act, let the page settle, and go again until the model has nothing more
// to show.

const MAX_STEPS = 20;
const MAX_HISTORY = 12;
const STORAGE_KEY = "haptic.guide";
/** Shown the moment the visitor does something other than the step, while the next step is worked out. */
const OFF_TRACK = "Finding the way from here…";
/** A saved guide older than this isn't picked back up after a page load. */
const RESUME_WINDOW_MS = 3 * 60 * 1000;
const CLICKABLE = 'a[href], button, summary, select, input, textarea, label, [role], [onclick], [tabindex]:not([tabindex="-1"])';
/** A page that is still listing nothing, or still says it is loading, this long after it was first read is read as it is. */
const EMPTY_PAGE_WAIT_MS = 12_000;
/** A page load that has not happened this long after it began was a download, or was called off. */
const LEAVING_WAIT_MS = 8000;
/**
 * How many times one guide may look again after what the model called the
 * last step. Each look is a question, and a model that keeps finding one more
 * thing to show has to stop somewhere.
 */
const MAX_CLOSINGS = 3;
/**
 * How long a sentence with no pointer waits for the visitor to do what it
 * says. A person reads two short sentences and finds a key or a menu well
 * inside this. After it the sentence stays up and the listening stops.
 */
const WATCH_MS = 90_000;
/** A sentence with no pointer is asked about again this many times when the page changed under it, and no more. */
const MAX_WATCH_RETRIES = 2;
/** How long a site's data requests take, until it has made a few that say otherwise. */
const DATA_FLOOR_MS = 700;
/** However slow a site's requests, a click is not waited on longer than this for one to come back. */
const MAX_PACE_MS = 2500;

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

/**
 * Wraps a listener or a timer of ours that runs on the customer's page.
 * Whatever goes wrong in it is ours to log and is never thrown into the page.
 */
function safely<A extends unknown[]>(run: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    try {
      run(...args);
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  };
}

/** What the visitor did, in words for the model, and what it means for the guide. */
interface Acted {
  event: string;
  /** They used the control they were shown. */
  onTarget: boolean;
  /** They did something else, which the next reply may need to correct. */
  strayed: boolean;
  how: Verdict["how"];
}

/** How a pointer is listened to. It can be changed while the listening goes on, since a pointer is shown before its reply is whole. */
interface Hearing {
  /** Any click off the control ends the wait, blank space included. For a pointer that may be the last word. */
  anyClick: boolean;
  /** Keys the sentence asks the visitor to press. */
  keys: string[];
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
  /** The pointer on show came with what the model called the last step, so the next question is a closing one. */
  closing?: boolean;
  /** How many closing questions the guide has asked. */
  closings?: number;
  savedAt: number;
}

/** What a question carries besides the page. */
interface Asking {
  /** What the visitor did since the last step. */
  event?: string;
  /** What followed it that the page did not show in its list: a jump within the page, a form the browser would not send. */
  followed?: string;
  /** The page was read again because it changed while the model was answering. */
  reread?: boolean;
  /** The visitor has done what the model called the last step, and this question is the look at what came of it. */
  closing?: boolean;
  /** How many times in a row a sentence with no pointer has been asked about again because the page changed under it. */
  retries?: number;
}

export class Guide {
  private goal = "";
  private history: HistoryTurn[] = [];
  private step = 0;
  private previous?: Snapshot;
  /**
   * The control the last step pointed at, how the list described it then, and
   * whether the visitor used it. The element itself is kept because two
   * controls can share a description: two fields with no label are not the
   * same field. `page` is everything about the page that a click could have
   * changed, as one string.
   */
  private last?: { listed: SnapElement; used: boolean; el?: WeakRef<Element>; page: string };
  /** A control that was used with nothing on the page changing, how many times running, and what was said about it for which step. */
  private stuck?: { el: WeakRef<Element>; page: string; count: number; step: number; said: string };
  /** The visitor's last action was not the step they were shown. Cleared once the next step is given. */
  private strayed = false;
  /** Bumped whenever the guide is stopped or restarted, so stale async work can tell and bail. */
  private run = 0;
  private stopWaiting?: () => void;
  /** The pointer on show came with "done": the model called it the last step. */
  private showingLast = false;
  /** How many closing questions this guide has asked. */
  private closings = 0;
  /** Stops watching a field the visitor typed in and has not yet left. */
  private stopField?: () => void;
  /** That field was left while a question was on its way, so the answer is checked against the page more strictly. */
  private fieldLeft = false;

  constructor(
    private readonly ui: Ui,
    private readonly sendTurn: (request: Omit<TurnRequest, "site">, onTarget?: (id: string) => void) => Promise<TurnReply>,
  ) {}

  start(goal: string) {
    this.reset();
    this.goal = goal;
    this.watchPage(true);
    this.ui.setState("asking");
    this.ui.setBusy("Finding it…");
    // The page is given the same chance to finish drawing before the first reading as before any other.
    const run = this.run;
    void settle(this.ui.host).then(() => {
      if (run === this.run) void this.turn(run);
    });
  }

  /**
   * What is listened to for as long as a guide runs and no longer. Some
   * browsers keep a page with a `beforeunload` listener out of their
   * back-forward cache, and nothing of ours should be left on a customer's
   * page when no guide is running.
   */
  private watchPage(on: boolean) {
    leavingSince = 0;
    window.removeEventListener("beforeunload", noteLeaving);
    if (on) window.addEventListener("beforeunload", noteLeaving);
    requests.watch(on);
  }

  /** The visitor called the guide off. */
  stop() {
    this.reset();
    this.ui.clear();
    this.ui.setBusy("");
    if (this.ui.state !== "idle") this.ui.setState("finished");
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
    this.closings = saved.closings ?? 0;
    // A page that loaded after the last step was used is what that step led to: look at it.
    const closing = saved.closing === true && !this.strayed;
    if (closing) this.closings++;
    const here = currentPath();
    const moved = saved.path === here ? "The page reloaded." : `A new page loaded: the user went from ${saved.path} to ${here}.`;
    const run = this.run;
    this.watchPage(true);
    this.ui.setState("asking");
    this.ui.setBusy(this.strayed ? OFF_TRACK : "Looking at this page…");
    // The script tag can run before the page has finished arriving, let alone drawn itself.
    void loaded()
      .then(() => settle(this.ui.host, { since: performance.now(), fetches: true }))
      .then(() => this.turn(run, { event: [saved.event, moved].filter(Boolean).join(" "), closing }));
  }

  private reset() {
    this.run++;
    this.watchPage(false);
    this.stopWaiting?.();
    this.stopWaiting = undefined;
    this.stopField?.();
    this.fieldLeft = false;
    this.history = [];
    this.step = 0;
    this.previous = undefined;
    this.last = undefined;
    this.stuck = undefined;
    this.strayed = false;
    this.showingLast = false;
    this.closings = 0;
    forget();
  }

  /** Asks for the next step. Whatever goes wrong ends the guide with a sentence, so it is never left asking, and nothing is thrown into the page. */
  private async turn(run: number, asking: Asking = {}): Promise<void> {
    try {
      await this.askFor(run, asking);
    } catch (error) {
      if (run !== this.run) return;
      console.warn("[Haptic]", error);
      this.finish("Something went wrong on our side. Try asking again.");
    }
  }

  private async askFor(run: number, asking: Asking): Promise<void> {
    const { ui } = this;
    const { event, followed, reread = false, closing = false, retries = 0 } = asking;
    if (this.step >= MAX_STEPS) return this.finish("That's as far as I can take this one. Ask again to keep going.");
    ui.setState("asking");
    ui.setBusy(this.step === 0 ? "Finding it…" : this.strayed ? OFF_TRACK : closing ? "Checking…" : "Next step…");

    ui.place();
    let page = takeSnapshot(ui.host, this.goal);
    // An app that draws itself with JavaScript lists nothing until it has, and
    // lists only its frame while its spinner is still up. Asking about a page
    // like that wastes the step, or worse, gets an answer about half a page.
    for (const began = Date.now(); ; ) {
      const mark = loadingMark(ui.host);
      if (page.snapshot.elements.length && !mark) break;
      if (Date.now() - began >= EMPTY_PAGE_WAIT_MS) {
        // A mark that is still there after all this time is part of the page.
        if (mark) stuckMarks.add(mark);
        break;
      }
      await settle(ui.host, { maxMs: 1000, patient: false });
      if (run !== this.run) return;
      page = takeSnapshot(ui.host, this.goal);
    }
    const change = event && this.previous ? describeChange(this.previous, page.snapshot) : undefined;
    // What became of the control just used, read from the control itself, and whether the guide is going round.
    const became = event ? this.fateOfLast(page) : { told: "", kept: "" };
    const hint = event ? this.hintIfStuck(page) : "";
    // What became of the control comes straight after what was done with it, so that "it" can only mean that control.
    const told = [event, became.told, followed, hint].filter(Boolean).join(" ");

    // The server names the control before it has finished the sentence about
    // it. The pointer goes there at once. The visitor may act on it straight
    // away, so their action is listened for from that moment and kept until
    // the rest of the reply arrives.
    let early: EarlyPointer | undefined;
    let whenActed: ((what: Acted) => void) | undefined;
    const how: Hearing = { anyClick: false, keys: [] };
    /** Every control that was on the page when it was read, with how the list named it. */
    const listing = new Map<Element, SnapElement>();
    for (const element of page.snapshot.elements) {
      const node = page.elements.get(element.id);
      if (node) listing.set(node, element);
    }
    const pointEarly = (id: string) => {
      const el = page.elements.get(id);
      if (run !== this.run || early || !el?.isConnected || currentPath() !== page.snapshot.path) return;
      const listed = page.snapshot.elements.find((element) => element.id === id);
      if (listed?.offscreen) el.scrollIntoView({ block: "center", behavior: "smooth" });
      ui.pointAt(el, "");
      const shown: EarlyPointer = {
        el,
        stop: waitForAction(el, listed, ui.host, listing, how, (what) => {
          shown.acted = what;
          // If this click loads a new page before the reply is in, the next page still needs to know about it.
          this.strayed = what.strayed;
          this.save(what.event);
          whenActed?.(what);
        }),
      };
      early = shown;
      this.stopWaiting = shown.stop;
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
          ...(told ? { event: told } : {}),
          ...(change ? { change } : {}),
          ...(closing ? { closing: true as const } : {}),
        },
        pointEarly,
      );
    } catch (error) {
      if (run !== this.run) return;
      // The page is on its way out and took the request with it. The next page picks the guide up.
      if (isLeaving()) return this.askAgainIfStaying(run, asking, dropEarly);
      dropEarly();
      console.warn("[Haptic]", error);
      return this.finish("Something went wrong on our side. Try asking again.");
    }
    if (run !== this.run) return;
    if (isLeaving()) return this.askAgainIfStaying(run, asking, dropEarly);

    // The answer is about a page the visitor has already left. Start over from where they are now.
    const here = currentPath();
    if (here !== page.snapshot.path) {
      dropEarly();
      await settle(ui.host);
      if (run !== this.run) return;
      return this.turn(run, { event: `${event ?? ""} The user went from ${page.snapshot.path} to ${here}.`.trim(), ...(followed ? { followed } : {}), closing });
    }

    let el = reply.target ? page.elements.get(reply.target) : undefined;
    const listed = reply.target ? page.snapshot.elements.find((element) => element.id === reply.target) : undefined;
    const acted = early?.acted;

    // Data that arrives a moment after a click, with no sign that it is on its
    // way, lands while the model is answering. The answer is then about a page
    // that is no longer there: the old list, an empty table, a "nothing found"
    // that was only true for half a second. Look again, and if what can be
    // clicked has changed in a way that matters, ask once more about the page
    // as it is now. Once only, so a page that never stops moving still gets its step.
    const fresh = takeSnapshot(ui.host, this.goal);
    const strict = this.fieldLeft;
    this.fieldLeft = false;
    if (!reread && !acted && movedOn(page.snapshot, fresh.snapshot, listed, strict)) {
      // This site is slower than it looked. The rest of the guide waits longer for it.
      requests.slow = true;
      dropEarly();
      await settle(ui.host);
      if (run !== this.run) return;
      return this.turn(run, { ...asking, reread: true });
    }
    // The page drew the control again while the model was answering: the same
    // control on a new node. It is found by what it is and by its place among
    // those like it, and pointed at with no more questions.
    if (listed && !el?.isConnected) el = sameControl(page.snapshot, listed, fresh);
    if (listed && !el && !reread) {
      dropEarly();
      await settle(ui.host);
      if (run !== this.run) return;
      return this.turn(run, { ...asking, reread: true });
    }

    this.history.push({ role: "user", text: this.step === 0 ? this.goal : [event, became.kept, followed].filter(Boolean).join(" ") || "The page changed." }, { role: "assistant", text: reply.say });
    this.step++;
    this.previous = page.snapshot;
    this.last = listed ? { listed, used: false, page: pageState(page.snapshot), ...(el ? { el: new WeakRef(el) } : {}) } : undefined;
    this.strayed = false;

    if (!el) {
      dropEarly();
      // "continue" with nothing to point at is not an ending: it is a step the visitor does with no pointer, like pressing a key.
      if (reply.status === "continue") return this.watch(run, page, listing, reply.say, retries);
      return this.finish(reply.say);
    }
    const target = el;
    if (early?.el !== target) {
      dropEarly();
      if (listed?.offscreen) target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    // If they have already used it, the caption would only flash.
    if (!acted) ui.pointAt(target, reply.say);

    ui.closePanel();
    // "done" with a pointer is the model calling this the last step. It has
    // not seen what the step does: the click may open a menu, or a field that
    // still needs typing. So it is listened for like any other step, and when
    // the visitor has used it the page is read and the model asked once more.
    const last = reply.status === "done";
    if (last && this.closings >= MAX_CLOSINGS) {
      // It has had its looks. This one is shown and the guide is over. A click anywhere puts it away.
      early?.stop();
      this.endRun();
      ui.setState("finished");
      const ended = this.run;
      const dismiss = () => ended === this.run && ui.clear();
      document.addEventListener("click", dismiss, { capture: true, once: true });
      this.stopWaiting = () => document.removeEventListener("click", dismiss, true);
      return;
    }
    this.showingLast = last;
    how.anyClick = last;
    how.keys = keysAsked(reply.say);
    this.save();
    ui.setState("pointing");
    const hashBefore = location.hash;
    const name = listed ? nameOf(listed) : "the control";

    const onActed = (what: Acted, on: Element) => {
      this.stopWaiting = undefined;
      // Nothing was done: the page drew the control again. Find it and carry on with the same step.
      if (what.how === "redrawn") return findAgain(0);
      if (this.last && what.onTarget) this.last.used = true;
      // The last step was there to be used or left. Doing something else puts it away, with no more questions.
      if (last && !what.onTarget) return this.end();
      this.strayed = what.strayed;
      this.stopField?.();
      // Saved straight away: if this click loads a new page, the next page needs to know about it.
      this.save(what.event);
      // The caption goes with the pointer: what the control opens often opens right where the caption was.
      ui.clear();
      ui.setState("asking");
      ui.setBusy(this.strayed ? OFF_TRACK : last ? "Checking…" : "Next step…");
      const since = performance.now();
      const refused = what.how === "clicked" ? hearInvalid() : undefined;
      // A form that checks a field when it is left has not yet shown what comes next.
      if (what.how === "filled" && isTyped(on) && holdsFocus(on)) this.watchField(run, on, name);
      void settle(ui.host, { since, used: on }).then(() =>
        // If that click is loading a new page, this one has nothing more to ask.
        onceStaying(() => {
          const invalid = refused?.();
          if (run !== this.run) return;
          const field = invalid && listing.get(invalid);
          const sent = invalid ? `The browser would not send the form: ${field ? nameOf(field) : "a field"} is not filled in the way the form needs.` : "";
          const followed = [jumpedTo(hashBefore), sent].filter(Boolean).join(" ");
          // A pointer that came back from a closing question shows where the answer is. Using it earns another look only if it did something.
          if (last && closing && describeChange(page.snapshot, takeSnapshot(ui.host, this.goal).snapshot) === NOTHING_CHANGED && currentPath() === page.snapshot.path) return this.end();
          if (last) this.closings++;
          void this.turn(run, { event: what.event, ...(followed ? { followed } : {}), closing: last });
        }),
      );
    };
    const listen = (on: Element) => waitForAction(on, listed, ui.host, listing, how, (what) => onActed(what, on));
    /** Looks for the control the page drew again, a few times over a few seconds, and asks only if it never comes back. */
    const findAgain = (tries: number) => {
      if (run !== this.run) return;
      const again = listed ? sameControl(page.snapshot, listed, takeSnapshot(ui.host, this.goal)) : undefined;
      if (again) {
        if (this.last) this.last.el = new WeakRef(again);
        ui.pointAt(again, reply.say);
        ui.setState("pointing");
        this.stopWaiting = listen(again);
        return;
      }
      if (tries >= 5) {
        ui.clear();
        return void this.turn(run, { event: `${name} is no longer on the page.`, closing });
      }
      const timer = setTimeout(() => findAgain(tries + 1), 300 * 2 ** tries);
      this.stopWaiting = () => clearTimeout(timer);
    };
    // The early pointer is already listening. Hand its result over, now or when it comes.
    if (acted) onActed(acted, target);
    else if (early) whenActed = (what) => onActed(what, target);
    else this.stopWaiting = listen(target);
  }

  /**
   * A reply of "continue" with nothing to point at: "Press Enter", "Press Tab
   * to leave the field". The sentence stays up and the page is watched. If it
   * changed while the model was answering, the model is asked again, twice at
   * most. Otherwise the wait is for the visitor to do something that the page
   * answers, or to press the key the sentence asks for. After a minute and a
   * half the listening stops and the sentence stays where it can be read.
   */
  private watch(run: number, page: PageSnapshot, listing: Map<Element, SnapElement>, say: string, retries: number) {
    const { ui } = this;
    ui.setBusy("");
    ui.closePanel();
    ui.say(say);
    ui.setState("watching");
    this.save();
    const changed = () => currentPath() !== page.snapshot.path || pageMoved(page.snapshot, takeSnapshot(ui.host, this.goal).snapshot);
    const onHeard = (event: string | undefined) => {
      this.stopWaiting = undefined;
      if (event === undefined) {
        // Nothing came of it. The sentence stays up for as long as the visitor wants it.
        this.endRun();
        ui.setState("finished");
        return;
      }
      this.stopField?.();
      this.save(event);
      ui.clear();
      ui.setState("asking");
      ui.setBusy("Next step…");
      void settle(ui.host, { since: performance.now() }).then(() =>
        onceStaying(() => {
          if (run === this.run) void this.turn(run, { event });
        }),
      );
    };
    // Listening starts at once: a visitor who is quick, or a test, may press the key the moment the sentence shows.
    const watching = watchFor(keysAsked(say), ui.host, listing, changed, onHeard);
    this.stopWaiting = watching.stop;
    void settle(ui.host).then(() => {
      if (run !== this.run || this.stopWaiting !== watching.stop || watching.touched()) return;
      if (retries >= MAX_WATCH_RETRIES || !changed()) return;
      watching.stop();
      this.stopWaiting = undefined;
      ui.clear();
      void this.turn(run, { event: "The page changed while you were answering.", retries: retries + 1 });
    });
  }

  /**
   * After typing paused with the cursor still in the field, the question goes
   * out, but a form that checks a field when it is left has not yet shown its
   * next button. So the field is watched until it is left. If the list of
   * controls is different then, the model is asked again.
   */
  private watchField(run: number, field: Element, name: string) {
    this.stopField?.();
    const onLeave = safely((event: FocusEvent) => {
      if (event.target !== field) return;
      this.stopField?.();
      void settle(this.ui.host).then(() => {
        if (run !== this.run || !this.previous) return;
        // A question is on its way, or the visitor's next action is being dealt with: the reply is checked against the page when it lands.
        if (this.ui.state !== "pointing" && this.ui.state !== "watching") {
          this.fieldLeft = true;
          return;
        }
        const { added, removed } = listDifference(this.previous, takeSnapshot(this.ui.host, this.goal).snapshot);
        if (!added && !removed) return;
        this.stopWaiting?.();
        this.stopWaiting = undefined;
        this.ui.clear();
        void this.turn(run, { event: `The user left ${name}.` });
      });
    });
    document.addEventListener("focusout", onLeave, true);
    this.stopField = () => {
      document.removeEventListener("focusout", onLeave, true);
      this.stopField = undefined;
    };
  }

  /**
   * What became of the control the visitor just used, read from the control
   * itself. The difference between two lists misses it when two controls are
   * listed alike. `told` goes to the model with the control's id in the list
   * it is reading. `kept` goes in the history, where an id would be stale.
   */
  private fateOfLast(page: PageSnapshot): { told: string; kept: string } {
    const last = this.last;
    const el = last?.el?.deref();
    if (!last?.used || !el) return { told: "", kept: "" };
    let id = "";
    for (const [listedId, node] of page.elements) if (node === el) id = listedId;
    const now = page.snapshot.elements.find((element) => element.id === id);
    if (!now) {
      const gone = !isDrawn(el) ? "It is no longer on the page." : "";
      return { told: gone, kept: gone };
    }
    const parts: string[] = [];
    if (now.label && now.label !== last.listed.label) parts.push(`now reads "${now.label}"`);
    const gained = (now.state ?? []).filter((state) => !last.listed.state?.includes(state));
    const lost = (last.listed.state ?? []).filter((state) => !now.state?.includes(state));
    if (gained.length) parts.push(`is now ${gained.join(", ")}`);
    if (lost.length) parts.push(`is no longer ${lost.join(", ")}`);
    // What is in a field is never read, so a field always looks the same.
    const what = parts.join(" and ") || (isField(el) ? "" : "looks unchanged");
    return { told: `It is ${now.id} in the list now${what ? `, and ${what}` : ""}.`, kept: parts.length ? `It ${parts.join(" and ")}.` : "" };
  }

  /**
   * A line for the model when it has pointed at one control twice from the
   * same page and nothing changed either time. The guide goes on: a retry
   * after retyping looks the same from here, because what is typed is never read.
   */
  private hintIfStuck(page: PageSnapshot): string {
    const last = this.last;
    const el = last?.el?.deref();
    // The same question asked again, because the page moved under it, says the same.
    if (this.stuck?.step === this.step) return this.stuck.said;
    if (!last?.used || !el || pageState(page.snapshot) !== last.page) {
      this.stuck = undefined;
      return "";
    }
    const count = this.stuck?.el.deref() === el && this.stuck.page === last.page ? this.stuck.count + 1 : 1;
    const said = count < 2 ? "" : `You have pointed at ${nameOf(last.listed)} twice from this page and nothing changed. Choose something not yet tried, or say what is blocking.`;
    this.stuck = { el: new WeakRef(el), page: last.page, count, step: this.step, said };
    return said;
  }

  /**
   * A reply, or a failure, that came while the page was on its way out. If the
   * page really goes, the next one picks the guide up. If it stays after all,
   * because the click was a download or the leaving was called off, the
   * question is asked again so the guide is not left waiting for ever.
   */
  private askAgainIfStaying(run: number, asking: Asking, dropEarly: () => void) {
    onceStaying(() => {
      if (run !== this.run) return;
      dropEarly();
      void this.turn(run, asking);
    });
  }

  /** Stops everything a running guide keeps going. Whatever is on show stays. */
  private endRun() {
    this.run++;
    this.stopWaiting?.();
    this.stopWaiting = undefined;
    this.stopField?.();
    this.showingLast = false;
    this.watchPage(false);
    forget();
    this.ui.setBusy("");
    this.ui.closePanel();
  }

  /** Ends the guide with nothing more to say. */
  private end() {
    this.endRun();
    this.ui.clear();
    this.ui.setState("finished");
  }

  /** Ends the guide on a sentence, which stays up until the visitor puts it away or asks again. */
  private finish(text: string) {
    this.endRun();
    this.ui.say(text);
    this.ui.setState("finished");
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
      ...(this.showingLast ? { closing: true } : {}),
      ...(this.closings ? { closings: this.closings } : {}),
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

/** How a control is named in an event: the way the list names it, with the row it sits in when the list gave one. */
function nameOf(listed: SnapElement): string {
  const row = /row: (.*)$/.exec(listed.context ?? "")?.[1];
  return describeElement(listed) + (row ? ` [row: ${row}]` : "");
}

/** Everything about a page that using a control could change, as one string: where it is, its dialog, its controls and their states. */
function pageState(snapshot: Snapshot): string {
  return [snapshot.path, snapshot.dialog ?? "", ...snapshot.elements.map((element) => `${elementKey(element)}|${(element.state ?? []).join(",")}`)].join("\n");
}

/** Whether the element is in the page and drawn. */
function isDrawn(el: Element): boolean {
  if (!el.isConnected) return false;
  if (typeof el.checkVisibility === "function") return el.checkVisibility({ visibilityProperty: true });
  return el.getClientRects().length > 0;
}

/** Text is typed into it. A dropdown is picked from, and a field nobody can type in is used by clicking it. */
function isTyped(el: Element): boolean {
  return isField(el) && !(el instanceof HTMLSelectElement) && !(el as HTMLInputElement).readOnly;
}

/** The element the keyboard is in, looking inside shadow roots. */
function activeElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

const holdsFocus = (el: Element) => {
  const active = activeElement();
  return !!active && (active === el || el.contains(active));
};

/** Whether `node` is `el` or inside it, shadow roots included. */
function isWithin(el: Element, node: Node | null): boolean {
  for (let at: Node | null = node; at; at = at.parentNode ?? (at as ShadowRoot).host ?? null) if (at === el) return true;
  return false;
}

/** What a click at this point would land on, looking inside shadow roots. */
function hitAt(x: number, y: number): Element | null {
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

/**
 * The words on a control and the states it reports, as one string. It is
 * compared with itself a moment later and never sent. Nothing is read from a
 * field or from anything a visitor can write in.
 */
function lookOf(el: Element): string {
  const attributes = ["aria-expanded", "aria-checked", "aria-selected", "aria-pressed", "aria-current", "aria-disabled", "aria-label", "title"].map((name) => el.getAttribute(name) ?? "");
  const ticked = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? String(el.checked) : "";
  const words = isField(el) ? "" : (el.textContent ?? "").slice(0, 120);
  return [...attributes, ticked, String((el as HTMLButtonElement).disabled === true), words].join("|");
}

/**
 * Calls `done` once, when the visitor does what the step asked or does
 * something else that moves things along. Returns a function that stops
 * listening.
 *
 * This is the half that touches the page. It turns what happens there into
 * the plain facts that `hear` in observe.ts decides on. Real apps make "used
 * the control" less plain than a click on it:
 * - A field can be a button in disguise: a read-only input that opens a list.
 *   Clicking it is the whole action.
 * - A list or a calendar that a control opens is part of using the control,
 *   so picking from it is not a wrong click.
 * - A styled checkbox is often an invisible input under a label. The label is
 *   all a visitor can click.
 * - Some lists act when the mouse goes down and are gone, hidden or moved
 *   before it comes up, so no click ever happens. The press is all there is.
 * - Some controls say nothing at all, and only what the page did afterwards
 *   shows they were used.
 */
function waitForAction(target: Element, listed: SnapElement | undefined, host: Element, listing: Map<Element, SnapElement>, how: Hearing, done: (what: Acted) => void): () => void {
  const name = listed ? nameOf(listed) : "the element you pointed at";
  const select = target instanceof HTMLSelectElement;
  const typed = isTyped(target);
  const ticked = target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio");
  const pointed = (): Pointed => ({ typed, select, ticked, keys: how.keys, anyClick: how.anyClick });
  // What has come on show since the pointer went up: added to the page, or a
  // box whose hiding was changed. A list or a calendar that the control opens
  // is often in the page all along, hidden, so being in the page is not enough.
  const added = new WeakSet<Node>();
  const restyled = new WeakMap<Node, string>();
  const shown = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") for (const node of record.addedNodes) added.add(node);
      else restyled.set(record.target, record.attributeName ?? "");
    }
  });
  shown.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "open", "aria-hidden", "style", "class"] });
  /** A box drawn over the page, which is what a list or a menu that opens is. */
  const isLayer = (el: Element) => {
    if (el.matches('[role="listbox"], [role="menu"], [role="tree"], [role="grid"], [role="dialog"], [popover]')) return true;
    const position = getComputedStyle(el).position;
    return position === "absolute" || position === "fixed";
  };
  /**
   * Whether `el` has come on show since the pointer went up. Anything the
   * visitor clicks that has not was on the page to be clicked all along. A
   * change of style or class counts only on a box drawn over the page, since
   * pages restyle rows and cards as the mouse moves over them.
   */
  const isNew = (el: Element): boolean => {
    for (const record of shown.takeRecords()) {
      if (record.type === "childList") for (const node of record.addedNodes) added.add(node);
      else restyled.set(record.target, record.attributeName ?? "");
    }
    for (let at: Element | null = el; at && at !== document.body && at !== document.documentElement; at = at.parentElement) {
      if (at.contains(target)) return false;
      if (added.has(at)) return true;
      const how = restyled.get(at);
      if (how !== undefined && (how === "hidden" || how === "open" || how === "aria-hidden" || isLayer(at))) return true;
    }
    return false;
  };
  const startPath = currentPath();
  const startAddress = location.href;
  const startDialog = findOpenModal(host);
  const startLook = lookOf(target);
  const numbers = new WeakMap<Element, number>();
  let numbered = 0;
  const numberOf = (el: Element): number => {
    let number = numbers.get(el);
    if (number === undefined) numbers.set(el, (number = ++numbered));
    return number;
  };
  let heard: Heard = nothingHeard();
  /** What the mouse last went down on, and where. */
  let pressed: { el?: Element; x: number; y: number } | undefined;
  /** What the pointed control opened, once it is known. */
  let popup: Element | undefined;
  let idle = 0;

  /** The snapshot's own test for something a visitor can click: a tag or role that says so, a place in the list, or a pointer cursor that starts here. */
  const isControl = (node: Element) => {
    if (node === document.body || node === document.documentElement) return false;
    if (node.matches(CLICKABLE) || listing.has(node)) return true;
    return getComputedStyle(node).cursor === "pointer" && (!node.parentElement || getComputedStyle(node.parentElement).cursor !== "pointer");
  };
  /** The nearest box drawn over the page that `el` sits in, not counting any that hold the pointed control. */
  const layerOf = (el: Element): Element => {
    let top = el;
    for (let at: Element | null = el; at && at !== document.body && !at.contains(target); at = at.parentElement) {
      top = at;
      const position = getComputedStyle(at).position;
      if (position === "absolute" || position === "fixed") return at;
    }
    return top;
  };
  const says = (attribute: string) => [target, target.closest(`[${attribute}]`), target.querySelector(`[${attribute}]`)].map((el) => el?.getAttribute(attribute) ?? "").find(Boolean) ?? "";
  const isExpanded = () => [target, target.closest("[aria-expanded]"), target.querySelector("[aria-expanded]")].some((el) => el?.getAttribute("aria-expanded") === "true");
  /** What the pointed control says it opens, by id. */
  const popupOf = (): Element | undefined => {
    if (popup?.isConnected) return popup;
    for (const id of `${says("aria-controls")} ${says("aria-owns")}`.split(/\s+/).filter(Boolean)) {
      const el = document.getElementById(id);
      if (el && !el.contains(target)) return (popup = layerOf(el));
    }
    return undefined;
  };
  const insidePopup = (path: EventTarget[], first: Element): boolean => {
    const root = popupOf();
    if (root && path.includes(root)) return true;
    if (!isExpanded() && heard.opened === undefined) return false;
    // New since the pointer went up, and clicked after the visitor went into the control: it is what the control opened.
    if (isNew(first) && !listing.has(first)) {
      popup ??= layerOf(first);
      return true;
    }
    const box = first.closest('[role="listbox"], [role="menu"], [role="tree"], [role="grid"], [role="dialog"]');
    if (!box || box.contains(target) || !isExpanded()) return false;
    popup ??= box;
    return true;
  };
  /**
   * Whether a press at this point, landing on a box wrapped round the target,
   * was on the target: many selects draw the chosen value over a see-through
   * input, so the visitor's click lands on the words, inside the input's box.
   */
  const inTargetBox = (controls: Element[], point?: { x: number; y: number }) => {
    if (!point) return false;
    const box = target.getBoundingClientRect();
    if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) return false;
    return controls.some((node) => node.contains(target));
  };
  const whereOf = (path: EventTarget[], point?: { x: number; y: number }): Where => {
    const controls = path.filter((node): node is Element => node instanceof Element && isControl(node));
    const onTarget =
      path.includes(target) || path.some((node) => node instanceof HTMLLabelElement && (node.control === target || node.contains(target))) || inTargetBox(controls, point);
    const first = controls[0];
    return {
      onTarget,
      controls: controls.map(numberOf),
      name: first ? nameOfClicked(first, listing) : "",
      known: !!first && (listing.has(first) || !isNew(first)),
      inPopup: !onTarget && !!first && insidePopup(path, first),
      aroundTarget: !onTarget && !!first && first.contains(target),
    };
  };
  const fate = (): Fate => {
    const gone = !isDrawn(target);
    const press = pressed;
    return {
      gone,
      changed: !gone && lookOf(target) !== startLook,
      dialog: findOpenModal(host) !== startDialog,
      path: currentPath() !== startPath,
      address: location.href !== startAddress,
      pressGone: !!press?.el && (!isDrawn(press.el) || !isWithin(press.el, hitAt(press.x, press.y))),
      popupOpen: !!popup && isDrawn(popup) && (says("aria-expanded") === "" || isExpanded()),
      listOpen: typed && isExpanded(),
      leaving: isLeaving(),
    };
  };
  const sentence = (verdict: Verdict): string => {
    switch (verdict.how) {
      case "clicked":
        return `The user clicked ${name}.`;
      case "filled":
        return `The user filled in ${name}. You can't see what they entered.`;
      case "opened":
        return `The user clicked into ${name}, and a list of choices opened.`;
      case "key":
        return `The user pressed ${keyName(verdict.key)} in ${name}.`;
      case "chose": {
        const names = verdict.names.filter(Boolean).slice(0, 3).map((picked) => `"${picked}"`);
        return `The user chose ${names.length ? names.join(" and ") : "an entry"} from the list that ${name} opened.`;
      }
      case "other":
        return `The user clicked ${verdict.name ? `"${verdict.name}"` : "something else"} instead of ${name}.`;
      case "elsewhere":
        return "The user clicked somewhere else on the page.";
      case "left":
        return `The user went to ${currentPath()} without using ${name}.`;
      case "unknown":
        return "The page changed after something the user did that could not be identified.";
      case "redrawn":
        return "";
    }
  };

  const feed = (seen: Seen) => {
    heard = hear(heard, seen, pointed());
    const verdict = heard.verdict;
    if (!verdict) return;
    stop();
    done({ event: sentence(verdict), onTarget: verdict.onTarget, strayed: verdict.strayed, how: verdict.how });
  };
  const outside = (event: Event) => {
    const path = event.composedPath();
    return path.includes(host) ? undefined : path;
  };
  const onPress = (event: Event) => {
    const path = outside(event);
    if (!path || (event as PointerEvent).button !== 0) return;
    const where = whereOf(path, { x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY });
    const el = path.find((node): node is Element => node instanceof Element && isControl(node)) ?? (where.onTarget ? target : undefined);
    pressed = { x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY, ...(el ? { el } : {}) };
    feed({ type: "press", at: performance.now(), where });
  };
  const onRelease = () => feed({ type: "release", at: performance.now() });
  const onCancel = () => feed({ type: "cancel", at: performance.now() });
  const onClick = (event: Event) => {
    const path = outside(event);
    if (path) feed({ type: "click", at: performance.now(), where: whereOf(path, { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY }) });
  };
  const onKey = (event: Event) => {
    const path = outside(event);
    if (!path) return;
    const on = path[0];
    feed({ type: "key", at: performance.now(), key: (event as KeyboardEvent).key ?? "", inTarget: path.includes(target), inTyped: on instanceof Element && isTyped(on) });
  };
  const onInput = (event: Event) => {
    const path = outside(event);
    if (path) feed({ type: "input", at: performance.now(), inTarget: path.includes(target) });
  };
  const onLeave = (event: Event) => {
    if (event.target === target) feed({ type: "left", at: performance.now() });
  };
  // A click into a frame never reaches this page. All it shows is the window losing the keyboard to the frame.
  const onBlur = () => {
    setTimeout(safely(() => {
      const active = document.activeElement;
      if (!heard.verdict && active instanceof HTMLIFrameElement && isWithin(target, active)) feed({ type: "frame", at: performance.now() });
    }), 0);
  };
  const timer = setInterval(safely(() => {
    const now = performance.now();
    // With nothing pending, a look twice a second is enough to notice an address that moved by itself.
    if (!waiting(heard, now) && ++idle % 5) return;
    feed({ type: "tick", at: now, fate: fate() });
  }), 100);

  const listeners = ([
    [document, "pointerdown", onPress],
    [document, "pointerup", onRelease],
    [document, "pointercancel", onCancel],
    [document, "click", onClick],
    [document, "keydown", onKey],
    [document, "input", onInput],
    [document, "change", onInput],
    [document, "focusout", onLeave],
    [window, "blur", onBlur],
  ] as [EventTarget, string, (event: Event) => void][]).map(([on, type, listener]) => [on, type, safely(listener)] as const);
  const stop = () => {
    clearInterval(timer);
    shown.disconnect();
    for (const [on, type, listener] of listeners) on.removeEventListener(type, listener, true);
  };
  for (const [on, type, listener] of listeners) on.addEventListener(type, listener, true);
  return stop;
}

/**
 * Waits, with a sentence up and no pointer, for the visitor to do what the
 * sentence says. `done` gets what they did in words, or nothing when the
 * time ran out. A step is heard when the visitor presses a key the sentence
 * asks for, or does anything at all that the page then answers with a change.
 * A page that changes by itself, with nothing done, is not heard. What comes
 * back stops the listening, and says whether the visitor has done anything yet.
 */
function watchFor(
  keys: string[],
  host: Element,
  listing: Map<Element, SnapElement>,
  changed: () => boolean,
  done: (event: string | undefined) => void,
): { stop: () => void; touched: () => boolean } {
  let did = "";
  let checks: ReturnType<typeof setTimeout>[] = [];
  const finish = (event: string | undefined) => {
    stop();
    done(event);
  };
  /** Looks at the page a few times after something was done, since what it sets off may take a moment. */
  const lookSoon = (what: string, delays = [400, 1000, 2000]) => {
    did = what;
    for (const check of checks) clearTimeout(check);
    checks = delays.map((delay) => setTimeout(safely(() => changed() && finish(did)), delay));
  };
  const outside = (event: Event) => {
    const path = event.composedPath();
    return path.includes(host) ? undefined : path;
  };
  const onPress = safely((event: Event) => {
    const path = outside(event);
    if (!path) return;
    const on = path.find((node): node is Element => node instanceof Element && (listing.has(node) || node.matches(CLICKABLE)));
    const listed = on && listing.get(on);
    const said = on ? nameOfClicked(on, listing) : "";
    lookSoon(listed ? `The user clicked ${nameOf(listed)}.` : said ? `The user clicked "${said}".` : "The user did something on the page.");
  });
  const onKey = safely((event: Event) => {
    const path = outside(event);
    if (!path) return;
    const key = ((event as KeyboardEvent).key ?? "").toLowerCase();
    // The key that was asked for is the step, whether or not the page shows anything for it.
    if (keys.includes(key)) return finish(`The user pressed ${keyName(key)}.`);
    const on = path[0];
    if (on instanceof Element && isTyped(on)) return;
    if (["enter", " ", "escape", "tab"].includes(key) || key.startsWith("arrow")) lookSoon(`The user pressed ${keyName(key)}.`);
  });
  const onInput = safely((event: Event) => {
    const path = outside(event);
    if (!path) return;
    const on = path.find((node): node is Element => node instanceof Element && listing.has(node));
    const field = on && listing.get(on);
    // Typing is looked at once it pauses.
    lookSoon(`The user filled in ${field ? nameOf(field) : "a field"}. You can't see what they entered.`, [1200, 2200]);
  });
  const limit = setTimeout(safely(() => finish(undefined)), WATCH_MS);
  const stop = () => {
    clearTimeout(limit);
    for (const check of checks) clearTimeout(check);
    document.removeEventListener("pointerdown", onPress, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onInput, true);
  };
  document.addEventListener("pointerdown", onPress, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onInput, true);
  return { stop, touched: () => did !== "" };
}

/** Controls whose own words are their name. A region of the page that happens to take clicks is not one. */
const NAMED_BY_ITS_TEXT =
  'a[href], button, summary, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [role="treeitem"]';

/**
 * A name for something the visitor clicked, for the sentence that tells the
 * model what happened. It goes to the server, so it follows the same rules as
 * the rest of the page: emails and long numbers are masked, and nothing a
 * person may have written is read. A control the page was read with keeps the
 * name the list gave it. Otherwise an aria-label is used, and failing that
 * the control's own words, when it is a real control, cannot be written in
 * and holds no field. A field, an editor, anything inside an editor and a
 * region of the page all come back with no name.
 */
export function nameOfClicked(clicked: Element, listing: Map<Element, SnapElement> = new Map()): string {
  const listed = listing.get(clicked);
  if (listed?.label) return cleanText(listed.label, 60);
  const given = clicked.getAttribute("aria-label");
  if (given) return cleanText(given, 60);
  if (!clicked.matches(NAMED_BY_ITS_TEXT)) return "";
  if ((clicked as HTMLElement).isContentEditable) return "";
  if (clicked.querySelector("input, textarea, select, [contenteditable]")) return "";
  return cleanText(clicked.textContent || "", 60);
}

/**
 * The first words of a part of the page, masked like all page text. Nothing
 * inside a field or an editor is read: what is written there is the visitor's.
 */
function firstWords(el: Element | null, max = 60): string {
  if (!el || (el as HTMLElement).isContentEditable) return "";
  let text = "";
  const walk = (node: Node) => {
    if (text.length > max * 2) return;
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
    if (!(node instanceof Element) || node.matches("script, style, textarea, select, input, [contenteditable]")) return;
    for (const child of node.childNodes) walk(child);
    text += " ";
  };
  walk(el);
  return cleanText(text, max);
}

/**
 * A sentence for a click that only moved the visitor within the page: the
 * address changed after its "#", and the page has an element by that name.
 * Without it the model sees the same page and the same list, and cannot tell
 * that anything happened.
 */
function jumpedTo(hashBefore: string): string {
  const hash = location.hash;
  if (hash === hashBefore || hash.length < 2 || hash.startsWith("#/")) return "";
  let landed: Element | null = null;
  try {
    landed = document.querySelector(":target");
  } catch {
    // No :target support. Nothing is added.
  }
  if (!landed) return "";
  const words = firstWords(landed) || firstWords(landed.closest("h1, h2, h3, h4, h5, h6, section, article, li, p, dt") ?? landed.parentElement);
  return words ? `The page jumped to "${words}".` : "";
}

/**
 * Listens, from a click until it is asked, for the browser refusing to send a
 * form: it tells each field that is not filled in as required, shows its own
 * bubble on the first, and nothing on the page changes. Returns a function
 * that stops listening and gives the first such field. The browser's own
 * message is never read: it can quote what was typed.
 */
function hearInvalid(): () => Element | undefined {
  let first: Element | undefined;
  const onInvalid = (event: Event) => {
    if (!first && event.target instanceof Element) first = event.target;
  };
  document.addEventListener("invalid", onInvalid, true);
  return () => {
    document.removeEventListener("invalid", onInvalid, true);
    return first;
  };
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

/** How many controls one list has that the other does not, counting controls that are listed alike. `main` is how many of those added are outside the page's furniture. */
function listDifference(asked: Snapshot, now: Snapshot): { added: number; removed: number; main: number; after: Map<string, number> } {
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
  // The added controls that are not in the header, the navigation, a sidebar, a footer, a menu, tabs or a toolbar.
  const furniture = /^(?:header|nav|aside|footer|menu|tabs|toolbar)\b/;
  const unmatched = new Map(before);
  let main = 0;
  for (const element of now.elements) {
    const key = elementKey(element);
    const n = unmatched.get(key) ?? 0;
    if (n) unmatched.set(key, n - 1);
    else if (!furniture.test(element.context ?? "")) main++;
  }
  return { added, removed, main, after };
}

/** Text with its numbers taken out, so that a clock, a counter or a "5 seconds ago" that ticks reads the same from one moment to the next. */
const withoutNumbers = (text: string) => text.replace(/\d+/g, "#");

/** Whether the page says something now that it did not say before: a new heading, or new text of more than a few words. A clock that ticks is not that. */
function saysMore(asked: Snapshot, now: Snapshot): boolean {
  if (now.headings.map(withoutNumbers).join("|") !== asked.headings.map(withoutNumbers).join("|")) return true;
  const had = new Set(asked.text.map(withoutNumbers));
  let fresh = 0;
  for (const text of now.text) if (!had.has(withoutNumbers(text))) fresh += text.length;
  return fresh >= 20;
}

/** The items of `list` that `other` also has, as many times as it has them, in the order of `list`. */
function sharedInOrder(list: string[], other: string[]): string[] {
  const left = new Map<string, number>();
  for (const item of other) left.set(item, (left.get(item) ?? 0) + 1);
  return list.filter((item) => {
    const n = left.get(item) ?? 0;
    if (!n) return false;
    left.set(item, n - 1);
    return true;
  });
}

/** Whether what both readings show is in a different order: a sort, or a filter, that landed. Controls and text both count. */
function reordered(asked: Snapshot, now: Snapshot): boolean {
  const differ = (a: string[], b: string[]) => sharedInOrder(a, b).join("\n") !== sharedInOrder(b, a).join("\n");
  return differ(asked.elements.map(elementKey), now.elements.map(elementKey)) || differ(asked.text.map(withoutNumbers), now.text.map(withoutNumbers));
}

/** Whether the page is different in a way that matters: its controls, their order or their states, its dialog, or what it says. Numbers that tick do not count. */
function pageMoved(asked: Snapshot, now: Snapshot): boolean {
  return pageState(asked) !== pageState(now) || saysMore(asked, now) || reordered(asked, now);
}

/**
 * Whether the page changed, while the model was answering, in a way that
 * makes the answer about a page that is no longer there. `listed` is what the
 * answer points at, if anything. `strict` is set when the visitor has just
 * left a field they typed in: forms show their next control then, and any
 * change to the list matters.
 */
function movedOn(asked: Snapshot, now: Snapshot, listed: SnapElement | undefined, strict: boolean): boolean {
  const { added, removed, main, after } = listDifference(asked, now);
  // Found nothing to point at, and the page has since gained or lost controls, put them in a new order, or says something new: what was wanted may be there now.
  if (!listed) return added > 0 || removed > 0 || saysMore(asked, now) || reordered(asked, now);
  // Pointed at something that has since gone or been renamed: the pointer would land on nothing, or on something else.
  if (!after.has(elementKey(listed))) return true;
  // The same things in a new order: a sort or a filter landed, and the answer was about the page before it.
  if (reordered(asked, now)) return true;
  if (!added && !removed) return false;
  if (strict) return true;
  // Pointed at something that is still there. Results arriving in the main part of the page may be what was wanted. Elsewhere only a page that has largely been redrawn makes the answer doubtful.
  return main >= 2 || added + removed > Math.max(4, asked.elements.length * 0.3);
}

/**
 * The control in a fresh reading of the page that is the one `listed` was in
 * the reading the model answered: listed the same way, and in the same place
 * among those listed the same way. A page that draws itself again puts every
 * control on a new node, and the old node is no use to point at.
 */
function sameControl(asked: Snapshot, listed: SnapElement, fresh: PageSnapshot): Element | undefined {
  const key = elementKey(listed);
  const place = asked.elements.filter((element) => elementKey(element) === key).indexOf(listed);
  const found = fresh.snapshot.elements.filter((element) => elementKey(element) === key)[place];
  const el = found ? fresh.elements.get(found.id) : undefined;
  return el?.isConnected ? el : undefined;
}

/** Where this script came from, which is where our own requests go. Read once, while the script is first running. */
const OWN_ORIGIN = (() => {
  try {
    const src = (document.currentScript as HTMLScriptElement | null)?.src;
    return src ? new URL(src).origin : "";
  } catch {
    return "";
  }
})();

/**
 * The page's own data requests, for as long as a guide runs: when each
 * finished and how long each took. Nothing of the page's is wrapped or
 * replaced: the browser reports each finished request by itself, and only
 * its address and its times are looked at.
 */
const requests = {
  observer: undefined as PerformanceObserver | undefined,
  /** When each of the last few data requests began and ended. */
  ended: [] as { start: number; end: number }[],
  /** How long this page's data requests have taken, newest last. */
  took: [] as number[],
  /** The page has fetched data at least once, so a click may set off another fetch. */
  fetches: false,
  /** An answer in this guide was set aside because the page was still changing, so the page is given longer from now on. */
  slow: false,
  watch(on: boolean) {
    this.observer?.disconnect();
    this.observer = undefined;
    this.ended = [];
    this.took = [];
    this.slow = false;
    if (!on || typeof PerformanceObserver !== "function") return;
    const isData = (entry: PerformanceEntry) => {
      const kind = (entry as PerformanceResourceTiming).initiatorType;
      // Our own requests, for the site's settings and for each step, are not the page's data.
      return (kind === "fetch" || kind === "xmlhttprequest") && !(OWN_ORIGIN && entry.name.startsWith(OWN_ORIGIN + "/")) && !entry.name.endsWith("/v1/turn");
    };
    try {
      // What the page fetched before the guide began says how quick it is too.
      const earlier = performance.getEntriesByType("resource").filter(isData);
      this.fetches = earlier.length > 0;
      this.took = earlier.slice(-20).map((entry) => entry.duration);
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!isData(entry)) continue;
          this.fetches = true;
          this.ended.push({ start: entry.startTime, end: entry.startTime + entry.duration });
          this.took.push(entry.duration);
        }
        this.ended = this.ended.slice(-20);
        this.took = this.took.slice(-20);
      });
      this.observer.observe({ type: "resource", buffered: false });
    } catch {
      // No resource timing here. The page is judged by its own stillness alone.
    }
  },
  /**
   * How long this site's data requests usually take: the time by which
   * three in four of them were back. Longer once an answer has been set
   * aside, and never more than a firm limit.
   */
  pace(): number {
    const sorted = [...this.took].sort((a, b) => a - b);
    const usual = sorted.length ? (sorted[Math.floor((sorted.length - 1) * 0.75)] ?? DATA_FLOOR_MS) + 200 : DATA_FLOOR_MS;
    return Math.min(MAX_PACE_MS, Math.max(400, usual) * (this.slow ? 1.5 : 1));
  },
  /**
   * How much longer to wait before reading the page, given when the visitor
   * acted. Data that has only just arrived has not been drawn yet. And on a
   * page that fetches data, no request having come back since the click most
   * likely means one is still on its way. If nothing on the page has changed
   * yet either, it is waited for about as long as this site's requests
   * take; if the page has already answered the click, a little while, and
   * as long as the requests take once the guide has had an answer set aside.
   */
  stillComing(since: number | undefined, now: number, fetches: boolean, changed: boolean): number {
    if (since === undefined) return 0;
    const after = this.ended.filter((request) => request.start >= since - 20);
    if (after.some((request) => now - request.end < 250)) return 300;
    const wait = changed && !this.slow ? Math.min(this.pace(), DATA_FLOOR_MS) : this.pace();
    if (!after.length && (fetches || this.fetches) && now - since < wait) return wait - (now - since);
    return 0;
  },
};

// Common loading markers: ARIA busy regions, progress bars, and the class
// names spinners and skeletons usually carry (Tailwind's included).
const LOADING = '[aria-busy="true"], [role="progressbar"], .animate-spin, .animate-pulse, [class*="skeleton" i], [class*="spinner" i]';
/** Loading marks that outlasted the longest wait once. They are part of the page, not a sign of anything on its way. */
const stuckMarks = new WeakSet<Element>();

/** Something on the page that says it is still loading, if anything does. */
function loadingMark(ignore: Element): Element | undefined {
  for (const el of document.querySelectorAll(LOADING)) {
    if (ignore.contains(el) || stuckMarks.has(el) || !el.getClientRects().length) continue;
    // A progress bar that gives a value is measuring something. If it is moving, the page is changing and is waited for anyway.
    if (el.getAttribute("role") === "progressbar" && el.hasAttribute("aria-valuenow")) continue;
    return el;
  }
  // A page whose main part says only "Loading" has not drawn itself yet.
  const main = document.querySelector("main, [role='main']");
  if (main && !stuckMarks.has(main) && main.getElementsByTagName("*").length < 60 && /^(?:loading|please wait)\b[\s.…]*$/i.test(((main as HTMLElement).innerText ?? "").trim())) return main;
  return undefined;
}

interface Settling {
  quietMs?: number;
  maxMs?: number;
  /** When the visitor did what the page is settling from, on the clock of `performance.now()`. */
  since?: number;
  /** The control they used. Its own changes, a tick or a class on it or around it, are not the page answering. */
  used?: Element;
  /** The page is taken to fetch its data though no request has been seen yet: a page that has only just loaded. */
  fetches?: boolean;
  /** Wait past `maxMs`, up to the longer limit, for as long as the page says it is loading. */
  patient?: boolean;
}

/**
 * Resolves once the page has stopped changing, so the next snapshot shows the
 * result of a click and not a half-drawn page. Waits only as long as the page
 * keeps changing, up to `maxMs`: longer only while the page itself says it is
 * loading, and a little longer when data the click asked for has not come.
 */
export function settle(ignore: Element, { quietMs = 300, maxMs = 3000, since, used, fetches = false, patient = true }: Settling = {}): Promise<void> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout>;
    let late: ReturnType<typeof setTimeout>;
    let mark: Element | undefined;
    /** Something on the page other than the used control has changed since this began. */
    let answered = false;
    const isUsed = (record: MutationRecord) =>
      !!used && (used.contains(record.target) || (record.type === "attributes" && record.target instanceof Element && record.target.contains(used)));
    const finish = () => {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(limit);
      clearTimeout(late);
      clearTimeout(hard);
      resolve();
    };
    const check = () => {
      mark = loadingMark(ignore);
      if (mark) return restart();
      const more = requests.stillComing(since, performance.now(), fetches, answered);
      if (more > 0) return restart(more);
      finish();
    };
    const restart = (ms = quietMs) => {
      clearTimeout(quiet);
      quiet = setTimeout(check, ms);
    };
    const observer = new MutationObserver((records) => {
      const page = records.filter((record) => record.target !== ignore && !ignore.contains(record.target));
      if (!page.length) return;
      // A data- attribute is the page's own bookkeeping, which a visitor never sees: it is not an answer.
      if (page.some((record) => !isUsed(record) && !(record.type === "attributes" && record.attributeName?.startsWith("data-")))) answered = true;
      restart();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    // Past the usual limit the page is read as soon as nothing on it says it is loading.
    const over = () => {
      if (!patient || !loadingMark(ignore)) return finish();
      late = setTimeout(over, 300);
    };
    const limit = setTimeout(over, maxMs);
    const hard = setTimeout(
      () => {
        if (mark?.isConnected) stuckMarks.add(mark);
        finish();
      },
      Math.max(maxMs, patient ? EMPTY_PAGE_WAIT_MS : 0),
    );
    restart();
  });
}
