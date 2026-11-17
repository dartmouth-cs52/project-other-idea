import { BLOCKED_SAY, isBlocked, type ControlName } from "../shared/corrections.ts";
import {
  ACTING_LIMITS,
  cleanText,
  describeElement,
  MAX_ASKED,
  MAX_QUESTION,
  namedIn,
  standingAlone,
  type GuideOutcome,
  type GuideReport,
  type HandoffRequest,
  type HistoryTurn,
  type Mode,
  type PublicHandoff,
  type SnapElement,
  type Snapshot,
  type TranscriptTurn,
  type TurnReply,
  type TurnRequest,
} from "../shared/types.ts";
import type { DidLine, Heard as HeardStep, Listening } from "./act.ts";
import { confirmationAction, perform, planFor, SAYS, type ActPlan, type GateConfig, type GateSession, type Plan, type StopPlan, type VisitorPlan } from "./acting-code.ts";
import { hear, isOwn, keyName, keysAsked, nothingHeard, OUTCOME_WINDOW_MS, OWN_TYPING_PAUSE_MS, waiting, type Fate, type Heard, type Pointed, type Seen, type Verdict, type Where } from "./observe.ts";
import { onAddressChange } from "./navigation.ts";
import { isDrawn, POPUP_ROLES, watchPopups } from "./popups.ts";
import { currentPath, describeChange, elementKey, findOpenModal, isField, nameOfPicked, NOTHING_CHANGED, sameView, statesOf, takeSnapshot, wholePage, type PageSnapshot } from "./snapshot.ts";
import { ACTING_WORDS, bringIn, type DidShown, type Ui, SHOWING } from "./ui.ts";

// Runs one guide: ask the model for a step, point at it, wait for the visitor
// to act, let the page settle, and go again until the model has nothing more
// to show.

const MAX_STEPS = 20;
const MAX_HISTORY = 12;
/** How much of the conversation before this question is sent with it: the last three questions answered in words, and their answers. */
const MAX_THREAD = 6;
const STORAGE_KEY = "haptic.guide";
/** Shown the moment the visitor does something other than the step, while the next step is worked out. */
const OFF_TRACK = "Finding the way from here";
/** What the chat says while the next step is worked out. */
const THINKING = "Thinking";
/** The ask box's line while a pointer is up and Haptic waits for the visitor. */
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
/**
 * While Haptic acts, how many times in a row it asks again because the
 * control a reply named had changed or gone before it could act (the gate's
 * "again"). A page that keeps changing under it has to stop somewhere.
 */
const MAX_AGAIN = 2;
/**
 * How many times a guide asks again because the address changed while the
 * model was answering, within `MOVES_MS`. A page that keeps changing its own
 * address would otherwise be asked about without end, and could spend its
 * site's budget for everyone. Past it, the guide stops with `MOVES_SAY`.
 */
const MAX_MOVES = 3;
const MOVES_MS = 30_000;
const MOVES_SAY = "This page keeps changing its address, so I've stopped for now. Ask again once it settles.";
/**
 * How many times a guide asks again because the control its pointer was on
 * went, or was covered, with nothing done to it, within `MOVES_MS`. A page
 * that keeps replacing what is pointed at was asked about at each
 * replacement, as far as the guide's twenty steps: 32 requests in 40 seconds
 * for one that draws its button under a new name every 900 ms. Past it, the
 * guide stops with `GONE_SAY`. A control the page only drew again is pointed
 * at on its new node with no question, and does not count.
 */
const MAX_GONE = 3;
const GONE_SAY = "This page keeps taking away what I point at, so I've stopped for now. Ask again once it settles.";
/** How long after the visitor's click on a list's control the list is looked for, when it is their turn to pick from it. */
const LIST_OPENS_MS = 200;
/** How the visitor is named to the model while Haptic acts: Haptic's own steps are "You". */
const VISITOR = "The visitor";
/** The widget's own sentences while acting that the gate does not have. English in this version. */
const ACT_SAYS = {
  changing: "The page kept changing under me, so I've stopped. Here's what I did.",
  failing: "You stopped doing it yourself, since several steps could not be done. Show the visitor the way from here.",
  carryOn: "The visitor took over for a moment and then let you carry on. Look at the page as it is now.",
  check: (name: string, commit: string) => (commit ? `This is ${name}. Click ${commit} when it looks right.` : `This is ${name}.`),
} as const;
/** However slow a site's requests, a click is not waited on longer than this for one to come back. */
const MAX_PACE_MS = 2500;
/** How long after a dropped connection the question is asked once more. */
const RETRY_AFTER_MS = 600;

/** Whether a request failed because its connection did, not because the server answered with an error: what `fetch` throws then. */
function droppedConnection(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network|load failed|connection/i.test(error.message);
}

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
  /**
   * When the control went without being used: what became of it, in words for the model ("The user clicked outside the
   * dialog …, which closed it without using …"), and whether what held it, a dialog or a menu, closed with it, so it
   * is not looked for again.
   */
  gone?: { words: string; closed: boolean };
}

/** How a pointer is listened to. It can be changed while the listening goes on, since a pointer is shown before its reply is whole. */
interface Hearing {
  /** Any click off the control ends the wait, blank space included. For a pointer that may be the last word. */
  anyClick: boolean;
  /** Keys the sentence asks the visitor to press. */
  keys: string[];
  /**
   * Who is expected to use the control. "haptic" while Haptic acts on it
   * itself: the events it dispatches are heard then, as a visitor's are, and
   * its own typing is done once it pauses briefly. Anyone else's are not.
   */
  actor?: "visitor" | "haptic";
  /** How the visitor is named in the sentences for the model: "The user" in a guide, "The visitor" while Haptic acts with them. */
  subject?: string;
  /** The open dialog's name as the reading gave it, masked like the rest of it, to say which dialog closed. */
  dialog?: string;
}

/** A pointer shown before the rest of the reply was in, and what the visitor did with it, if anything yet. */
interface EarlyPointer {
  el: Element;
  stop: () => void;
  acted?: Acted;
}

/** One line of "What I did" as it is kept: the words only, since the element is gone after a page load. */
interface DidKept {
  name: string;
  value?: string;
  mine?: boolean;
  partly?: boolean;
}

/**
 * "Do it with me" for one request (DESIGN 3 to 5): what the gate decides
 * with, what Haptic did, the caps, and whether the visitor's own hand has
 * paused it. It lives as long as Haptic acts; the hand-over, Stop, and every
 * way acting ends, end it.
 */
interface ActSession {
  gate: GateSession;
  /** What Haptic did, one line per control, in order. A line's element is gone after a page load. */
  did: (DidKept & { el?: WeakRef<Element> })[];
  /** Questions asked in act mode. */
  turns: number;
  /** "Again" plans in a row. */
  again: number;
  /** The page as it was read before Haptic's last action, to tell whether the next one on the same control comes after a change. */
  before?: string;
  /** The visitor's own hand paused it. */
  paused: boolean;
  /** The question in flight, aborted by Stop and by a pause. */
  abort?: AbortController;
  /** Stops listening for the visitor's own hand, for Escape and for Back. */
  unwatch?: () => void;
}

interface SavedGuide {
  /** Ties the guide's steps together on the server, across page loads. */
  id?: string;
  /** How the guide ended, when that has been reported already and its steps go on: the look after its last control was used. */
  reported?: GuideOutcome;
  goal: string;
  history: HistoryTurn[];
  /** Earlier questions that were answered in words, so a guide that follows from one still knows what it was about. */
  thread?: HistoryTurn[];
  step: number;
  path: string;
  /**
   * Set while Haptic was acting: its counts and what it did. `expectLoadUntil`
   * is set while a page load may follow from Haptic's own press, or from the
   * visitor doing the step acting gave them. A page that loads by then
   * carries on acting; any other ends it.
   */
  acting?: { actions: number; typed: number; failures: number; turns: number; did: DidKept[]; expectLoadUntil?: number };
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

/** Says how a guide went. Sent once per ending, and again when the visitor answers "Did this help?". */
export type Reporter = (guide: string, report: Omit<GuideReport, "site">) => void;

/** What the guide is told while a reply is still on its way. */
export interface Watch {
  /** The kind of reply, on a site with Answers on. */
  onMode?(mode: Mode): void;
  /** The control it will point at. */
  onTarget?(id: string): void;
}

/** The way to a person, when the site has one: what the widget was told about it, and how its form is posted. */
export interface HandoffWay {
  config: PublicHandoff;
  /** Posts the widget's form. Resolves to true when the company got it. */
  send(form: Omit<HandoffRequest, "site">): Promise<boolean>;
}

/** Questions in a row that ended without the visitor saying it helped, after which a person is offered. */
const OFFER_PERSON_AFTER = 3;
/** How much of the conversation goes to a person with a handoff. */
const MAX_TRANSCRIPT = 16;

/** Endings worth asking "Did this help?" about. A stop or a failure already says no. */
const ASK_IF_HELPED: GuideOutcome[] = ["finished", "shown", "nothing_to_point_at", "loop", "step_limit", "answered"];

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
  /** This is the question asked once more because the connection dropped before an answer came. */
  retried?: boolean;
}

export class Guide {
  /** Empty when no guide is under way, or once the current one has ended. */
  private id = "";
  /**
   * How this guide's ending was reported, once it has been. A guide can be
   * reported before it is over: the moment the last pointer of a guide that
   * got there shows, or the visitor uses the last control, the outcome is
   * sent at once, as the page may be about to go. The guide keeps its id for
   * the look that follows, and nothing is reported twice. The server keeps
   * the first outcome it is told.
   */
  private reported?: GuideOutcome;
  /**
   * Set while a pointer the model called the last step is on show, and the
   * visitor has not yet used it: how the guide ended if it ends there. Asking
   * something new, Stop, or closing the caption then ends it this way and not
   * as stopped.
   */
  private unconfirmed?: GuideOutcome;
  private goal = "";
  private history: HistoryTurn[] = [];
  /**
   * Questions answered in words, and their answers. It outlives a question, so
   * "and who can remove them?" is read with what came before. Pressing Stop
   * clears it.
   */
  private thread: HistoryTurn[] = [];
  /** Everything said since the visitor last pressed Stop, for handing to a person. */
  private transcript: TranscriptTurn[] = [];
  /** Questions in a row that ended without a "Yes" to "Did this help?". */
  private misses = 0;
  private step = 0;
  private previous?: Snapshot;
  /** The page as it was last sent to the server, whether or not the answer was used. */
  private lastSent?: Snapshot;
  /**
   * The control the last step pointed at, how the list described it then, and
   * whether the visitor used it. The element itself is kept because two
   * controls can share a description: two fields with no label are not the
   * same field. `page` is everything about the page that a click could have
   * changed, as one string.
   */
  /** The control the last reply named. `set`: Haptic set it itself and checked that it took. */
  private last?: { listed: SnapElement; used: boolean; set?: boolean; el?: WeakRef<Element>; page: string };
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
  /** Set while Haptic acts with the visitor ("Do it"). */
  private acting?: ActSession;
  /** A page load may follow until then, from Haptic's own press or from the visitor doing the step acting gave them. */
  private expectLoadUntil = 0;
  /** The act session whose "What I did" is on show, so a line that comes in late is added to it. */
  private didOnShow?: { session: ActSession; closing: string; commit: string };
  /** When this guide asked again because the address changed under a question, and in which run: see `MAX_MOVES`. */
  private moves: { run: number; at: number }[] = [];
  /** When this guide asked again because the control its pointer was on went or was covered, and in which run: see `MAX_GONE`. */
  private gone: { run: number; at: number }[] = [];

  constructor(
    private readonly ui: Ui,
    private readonly sendTurn: (request: Omit<TurnRequest, "site">, watch?: Watch, signal?: AbortSignal) => Promise<TurnReply>,
    /** The site's acting settings, when it has acting on, and whether the page turned it off. */
    private readonly config: GateConfig = {},
    private readonly report: Reporter = () => {},
    private readonly handoff?: HandoffWay,
    /** Controls the site's owner ruled out. Checked here as well as on the server, so the pointer never goes to one. */
    private readonly blocked: ControlName[] = [],
  ) {}

  /**
   * The question as it leaves the browser: with anything that looks like an
   * email address, a phone number or a long number masked, as it is in
   * everything Haptic reads from the page. The question as typed stays in the
   * browser, where the page is read with it (`takeSnapshot`) and Haptic's own
   * typing is checked against it (the gate's `words`).
   */
  private get asked(): string {
    // Cut to the ask box's 300 characters first: a mask can be longer than what it hides, and the end of a question is usually what it asks.
    return cleanText(this.goal.slice(0, MAX_QUESTION), MAX_ASKED, this.shownOwn);
  }

  /**
   * The emails and long numbers the visitor named that the page being sent
   * also shows. The page reading leaves those readable (`namedIn`), so the
   * question leaves them readable too, or the model could not tell that the
   * account on the page is the one asked about. Anything the visitor named
   * that the page does not show stays masked in the question. The page's
   * repeat of what the visitor typed is not the page showing it: the reading
   * puts "[typed]" there for any email address or number, whether or not the
   * question names it (`readableInQuestion` in snapshot.ts), so it is never
   * found here.
   */
  private shownOwn: ReadonlySet<string> = new Set();
  private noteShownOwn(snapshot: Snapshot) {
    const own = namedIn(this.goal);
    const shown = new Set<string>();
    // Only where it stands on its own on the page, by the page reading's own rule (`standingAlone`): every piece of
    // text the reading sends, and nothing else in the request. A value that is only part of something on the page,
    // or only in its address, is not shown.
    const look = (value: unknown): void => {
      if (typeof value === "string") for (const found of standingAlone(value, own)) shown.add(found);
      else if (Array.isArray(value)) value.forEach(look);
      else if (value && typeof value === "object") Object.values(value).forEach(look);
    };
    if (own.size) look(snapshot);
    this.shownOwn = shown;
  }

  /** A question. `act` is set when the visitor pressed Do it, and Haptic then acts if the site and the page allow it. */
  start(goal: string, act = false) {
    // Asking something new while a guide is under way ends that one.
    this.reportEnding(this.unconfirmed ?? "stopped");
    this.reset();
    this.id = newGuideId();
    this.goal = goal;
    this.ui.showQuestion(goal);
    if (act && this.config.acting && !this.config.pageOff) this.beginActing();
    this.watchPage(true);
    this.ui.setState("asking");
    if (this.acting) {
      this.ui.setBusy(ACTING_WORDS.doing);
      this.ui.setNote(ACTING_WORDS.starting);
    } else this.ui.setBusy(THINKING);
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
    window.removeEventListener("pagehide", this.onPageHide);
    if (on) {
      window.addEventListener("beforeunload", noteLeaving);
      window.addEventListener("pagehide", this.onPageHide);
    }
    requests.watch(on);
  }

  /**
   * The page is going, with the guide's ending not yet reported: the last
   * pointer is on show and the visitor has neither used it nor done anything
   * else. How it would end there is sent now, since nothing will be sent once
   * the page has gone. The report goes with keepalive, so it still arrives.
   */
  private onPageHide = safely(() => {
    if (this.unconfirmed) this.sendOutcome(this.unconfirmed);
  });

  /** Reports how the guide ended before it is over, once: the moment that is known for sure, while the page may yet go. */
  private sendOutcome(outcome: GuideOutcome) {
    if (!this.id || this.reported) return;
    this.reported = outcome;
    this.report(this.id, { outcome });
  }

  /** The visitor called the guide off: Stop, the caption's cross, or Escape while Haptic acts. What Haptic did stays listed. */
  stop() {
    const session = this.acting;
    this.reportEnding(this.unconfirmed ?? "stopped");
    this.reset();
    this.thread = [];
    this.transcript = [];
    this.misses = 0;
    this.ui.clear();
    this.ui.clearAnswer();
    this.ui.showQuestion("");
    this.ui.setBusy("");
    if (session?.did.length) this.showDid(session, ACTING_WORDS.stopped);
    // Typing that Stop cut short is reported by the engine a moment later, and shown then.
    else if (session) this.didOnShow = { session, closing: ACTING_WORDS.stopped, commit: "" };
    if (this.ui.state !== "idle") this.ui.setState("finished");
  }

  /** Start over: the guide, if one runs, is called off as Stop does, and the chat is cleared, "What I did" with it. */
  restart() {
    this.stop();
    this.didOnShow = undefined;
    this.ui.startOver();
    this.ui.setState("idle");
  }

  /** The visitor let Haptic carry on after it paused for their own hand. The page is read afresh. */
  carryOn() {
    const session = this.acting;
    if (!session?.paused) return;
    session.paused = false;
    const run = this.run;
    this.ui.setState("asking");
    this.ui.setBusy(ACTING_WORDS.doing);
    void settle(this.ui.host).then(() => {
      if (run === this.run && this.acting === session) void this.turn(run, { event: ACT_SAYS.carryOn });
    });
  }

  /** Starts acting for this request, afresh or carried over from the page before a load. */
  private beginActing(kept?: NonNullable<SavedGuide["acting"]>) {
    const session: ActSession = {
      gate: { words: this.goal, host: this.ui.host, actions: kept?.actions ?? 0, typed: kept?.typed ?? 0, failures: kept?.failures ?? 0 },
      did: (kept?.did ?? []).map((line) => ({ ...line })),
      turns: kept?.turns ?? 0,
      again: 0,
      paused: false,
    };
    this.acting = session;
    this.ui.hideDid();
    this.ui.setActing(true);
    this.watchHand(session);
  }

  /** Acting is over. Whatever is on show stays; the guide may go on as a guide. */
  private endActing() {
    const session = this.acting;
    if (!session) return;
    session.unwatch?.();
    session.abort?.abort();
    this.acting = undefined;
    this.expectLoadUntil = 0;
    this.ui.setActing(false);
  }

  /**
   * While Haptic acts or waits for its next step, the visitor's own hand wins
   * (DESIGN 4.3): a press or a key of theirs anywhere on the page pauses it,
   * and Escape stops it and still reaches the page, so an open menu closes.
   * Back or Forward ends it. Only events the browser marks as the visitor's
   * own count; what Haptic and the page dispatch does not. These listeners
   * live only as long as acting does.
   */
  private watchHand(session: ActSession) {
    const host = this.ui.host;
    const ours = () => this.acting === session;
    const onHand = safely((event: Event) => {
      if (!event.isTrusted || !ours()) return;
      const state = this.ui.state;
      const key = event.type === "keydown" ? ((event as KeyboardEvent).key ?? "") : "";
      if (key === "Escape" && (state === "asking" || state === "acting" || state === "paused")) return this.stop();
      if (session.paused || (state !== "asking" && state !== "acting") || event.composedPath().includes(host)) return;
      // A modifier on its own, as in Ctrl+Enter on Do it, is not taking over.
      if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"].includes(key)) return;
      this.pause();
    });
    const onHistory = safely(() => {
      // A jump within the page that Haptic's own press made is its step. Anything else is the visitor moving away.
      if (ours() && this.ui.state !== "acting") this.stopActing(SAYS.moved, undefined, "stopped");
    });
    document.addEventListener("pointerdown", onHand, true);
    document.addEventListener("keydown", onHand, true);
    window.addEventListener("popstate", onHistory);
    session.unwatch = () => {
      document.removeEventListener("pointerdown", onHand, true);
      document.removeEventListener("keydown", onHand, true);
      window.removeEventListener("popstate", onHistory);
    };
  }

  /** The visitor touched the page while Haptic acted: nothing more is done or asked until they say so. */
  private pause() {
    const session = this.acting;
    if (!session || session.paused) return;
    session.paused = true;
    // The engine stops before its next event, and the answer on its way is dropped.
    this.run++;
    session.abort?.abort();
    this.stopWaiting?.();
    this.stopWaiting = undefined;
    this.stopField?.();
    this.expectLoadUntil = 0;
    this.ui.rest();
    this.ui.setState("paused");
    this.ui.setBusy(SAYS.tookOver, true);
    this.save();
  }

  /**
   * Ends acting on a sentence, with the pointer on what it is about when there is something, and "What I did".
   * `outcome` is how the guide is reported to have ended: by default, shown when something is pointed at for the
   * visitor to use, and otherwise ended with nothing to point at.
   */
  private stopActing(say: string, el?: Element, outcome: GuideOutcome = el?.isConnected ? "shown" : "nothing_to_point_at") {
    const session = this.acting;
    this.endRun();
    const { ui } = this;
    if (el?.isConnected) {
      ui.pointAt(el, say);
      // Shown until the visitor clicks anywhere, as the last pointer of a guide is.
      this.leavePointerUp();
    } else ui.say(say);
    if (session?.did.length) this.showDid(session, "");
    ui.setState("finished");
    this.reportEnding(outcome);
  }

  /** "What I did" in the panel. A line, clicked, points at its field while it is still on the page. */
  private showDid(session: ActSession, closing: string, commit = "") {
    this.didOnShow = { session, closing, commit };
    const lines: DidShown[] = session.did.map(({ name, value, mine, partly }) => ({ name, ...(value !== undefined ? { value } : {}), ...(mine ? { mine } : {}), ...(partly ? { partly } : {}) }));
    this.ui.showDid(lines, closing, (index) => {
      const line = session.did[index];
      const el = line?.el?.deref();
      if (!line || !el?.isConnected) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      this.ui.pointAt(el, ACT_SAYS.check(line.name, commit));
    });
  }

  /** Adds or updates a line of "What I did": a control set twice keeps its last value, and a radio chosen takes the place of another of its group. */
  private noteDid(session: ActSession, did: DidLine, partly = false) {
    const line = { name: did.name || "Field", ...(did.value !== undefined ? { value: did.value } : {}), ...(did.mine ? { mine: true } : {}), ...(partly ? { partly: true } : {}), el: new WeakRef(did.el) };
    const at = session.did.findIndex((kept) => {
      const el = kept.el?.deref();
      return el === did.el || (!!el && sameRadioGroup(el, did.el));
    });
    if (at >= 0) session.did[at] = line;
    else session.did.push(line);
    const shown = this.didOnShow;
    if (shown?.session === session) this.showDid(session, shown.closing, shown.commit);
  }

  /** A page load may follow from what was just done: kept with the saved guide for a few seconds. */
  private expectLoad() {
    this.expectLoadUntil = Date.now() + LEAVING_WAIT_MS;
  }

  /**
   * Pick up a guide that a full page load interrupted. Acting carries on only
   * when the load was one it expected, from Haptic's own press or the
   * visitor's step, and only within a few seconds of it (DESIGN 4.6). Any
   * other load ends it with a sentence.
   */
  resume() {
    const saved = load();
    if (!saved) return;
    this.reset();
    this.id = saved.id ?? newGuideId();
    if (saved.reported) this.reported = saved.reported;
    this.goal = saved.goal;
    this.ui.showQuestion(saved.goal);
    this.history = saved.history;
    this.thread = saved.thread ?? [];
    this.step = saved.step;
    this.strayed = saved.strayed === true;
    this.closings = saved.closings ?? 0;
    const here = currentPath();
    if (saved.acting) {
      const expected = (saved.acting.expectLoadUntil ?? 0) >= Date.now();
      if (!expected) {
        // The visitor went somewhere, or the page did: acting is over, and says so.
        this.beginActing(saved.acting);
        const session = this.acting!;
        this.endActing();
        forget();
        this.ui.say(SAYS.moved);
        if (session.did.length) this.showDid(session, "");
        this.ui.setState("finished");
        this.reportEnding("stopped");
        return;
      }
      if (this.config.acting && !this.config.pageOff) this.beginActing(saved.acting);
    }
    // A page that loaded after the last step was used is what that step led to: look at it.
    const closing = saved.closing === true && !this.strayed;
    if (closing) this.closings++;
    const moved = saved.path === here ? "The page reloaded." : this.acting ? `A new page loaded: ${here}.` : `A new page loaded: the user went from ${saved.path} to ${here}.`;
    const run = this.run;
    this.watchPage(true);
    this.ui.setState("asking");
    if (this.acting) this.ui.setBusy(ACTING_WORDS.doing);
    else this.ui.setBusy(this.strayed ? OFF_TRACK : "Looking at this page");
    // The script tag can run before the page has finished arriving, let alone drawn itself.
    void loaded()
      .then(() => settle(this.ui.host, { since: performance.now(), fetches: true }))
      .then(() => this.turn(run, { event: [saved.event, moved].filter(Boolean).join(" "), closing }));
  }

  private reset() {
    this.run++;
    this.endActing();
    this.didOnShow = undefined;
    this.ui.hideDid();
    this.watchPage(false);
    this.stopWaiting?.();
    this.stopWaiting = undefined;
    this.stopField?.();
    this.fieldLeft = false;
    this.history = [];
    this.step = 0;
    this.previous = undefined;
    this.lastSent = undefined;
    this.reported = undefined;
    this.last = undefined;
    this.stuck = undefined;
    this.strayed = false;
    this.showingLast = false;
    this.closings = 0;
    this.unconfirmed = undefined;
    forget();
  }

  /**
   * Notes that the control the pointer was on went or was covered with nothing done to it, and that the next step is
   * about to be asked for because of it. True when that is once too often for one guide in so short a time: `MAX_GONE`.
   */
  private goneOnceMore(run: number): boolean {
    const now = Date.now();
    this.gone = [...this.gone.filter((one) => one.run === run && now - one.at < MOVES_MS), { run, at: now }];
    return this.gone.length > MAX_GONE;
  }

  /** Asks for the next step. Whatever goes wrong ends the guide with a sentence, so it is never left asking, and nothing is thrown into the page. */
  private async turn(run: number, asking: Asking = {}): Promise<void> {
    try {
      await this.askFor(run, asking);
    } catch (error) {
      if (run !== this.run) return;
      console.warn("[Haptic]", error);
      this.finish("Something went wrong on our side. Try asking again.", "error");
    }
  }

  private async askFor(run: number, asking: Asking): Promise<void> {
    const { ui } = this;
    const { followed, reread = false, closing = false, retries = 0 } = asking;
    let { event } = asking;
    let acting = this.acting;
    if (acting) {
      if (acting.turns >= ACTING_LIMITS.turns) return this.stopActing(SAYS.cap, undefined, "step_limit");
      // Several steps in a row that could not be done: acting ends, and the guide goes on as a guide (DESIGN 4.2).
      if (acting.gate.failures >= ACTING_LIMITS.failuresInARow) {
        this.endActing();
        acting = undefined;
        event = [event, ACT_SAYS.failing].filter(Boolean).join(" ");
      }
    }
    if (!acting && this.step >= MAX_STEPS) return this.finish("That's as far as I can take this one. Ask again to keep going.", "step_limit");
    // A new question: the pointer the model called the last step is no longer what the guide ends on, unless
    // this is the look at what came of using it.
    if (!closing) this.unconfirmed = undefined;
    ui.setState("asking");
    if (acting) ui.setBusy(ACTING_WORDS.doing);
    else ui.setBusy(this.strayed ? OFF_TRACK : closing ? "Checking" : THINKING);
    // Still on the same page: a load that Haptic's last press might have started did not come.
    if (this.expectLoadUntil) {
      this.expectLoadUntil = 0;
      this.save(event);
    }

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
        if (mark) markStuck(ui.host);
        break;
      }
      await settle(ui.host, { maxMs: 1000, patient: false });
      if (run !== this.run) return;
      page = takeSnapshot(ui.host, this.goal);
    }
    // A single-page app can change the address before it draws the new page. A new address over the same controls as
    // the page last sent hasn't been drawn yet, so the page is given the chance to change before it is read.
    if (this.lastSent && page.snapshot.path !== this.lastSent.path && sameView(this.lastSent, page.snapshot)) {
      await settle(ui.host, { untilChanged: true, patient: false });
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
    const how: Hearing = { anyClick: false, keys: [], ...(page.snapshot.dialog ? { dialog: page.snapshot.dialog } : {}) };
    /** Every control that was on the page when it was read, with how the list named it. */
    const listing = new Map<Element, SnapElement>();
    for (const element of page.snapshot.elements) {
      const node = page.elements.get(element.id);
      if (node) listing.set(node, element);
    }
    // While Haptic acts the pointer goes early too, but nothing is listened for: Haptic is the one about to use it.
    let pointedEarly: Element | undefined;
    const pointEarly = (id: string) => {
      const el = page.elements.get(id);
      if (run !== this.run || early || pointedEarly || !el?.isConnected || currentPath() !== page.snapshot.path) return;
      const listed = page.snapshot.elements.find((element) => element.id === id);
      // A control the site's owner ruled out gets no pointer, not even for a moment.
      if (isBlocked(listed, this.blocked)) return;
      bringIn(el, !!listed?.offscreen);
      ui.pointAt(el, "");
      if (acting) {
        pointedEarly = el;
        return;
      }
      const shown: EarlyPointer = {
        el,
        stop: waitForAction(el, listed, ui.host, listing, how, (what) => {
          shown.acted = what;
          // If this click loads a new page before the reply is in, the next page still needs to know about it.
          this.strayed = what.strayed;
          // The step was shown and acted on, though its sentence is not in yet. Saved as done, so a page this
          // click loads asks the next step and does not ask this one again over the top of it.
          this.save(what.event, {
            user: this.step === 0 ? this.asked : [event, became.kept, followed].filter(Boolean).join(" ") || "The page changed.",
            assistant: listed ? `Pointed at ${describeElement(listed)}.` : "Pointed at a control.",
          });
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

    // While Haptic acts: a page that changed since its last action on a control makes the next action on it a fresh one.
    const pageNow = acting ? pageState(page.snapshot) : "";
    if (acting && acting.before !== pageNow) acting.gate.repeats = undefined;
    const abort = new AbortController();
    if (acting) {
      acting.abort = abort;
      acting.turns++;
    }
    // If the address changes while the model is answering, the answer is about a page the visitor has left, like the
    // page they were on when they clicked a link that took a moment to load. The request is dropped at once, which
    // the server hears as the widget hanging up, and the step is asked again from the new page.
    let moved = false;
    const stopWatching = onAddressChange(() => {
      if (moved || currentPath() === page.snapshot.path) return;
      moved = true;
      abort.abort();
    });
    /** Asks for the step again, from the page the visitor is on now. While Haptic acts, someone else moved the page: acting ends. */
    const startOver = async () => {
      dropEarly();
      if (this.acting) return this.stopActing(SAYS.moved, undefined, "stopped");
      const now = Date.now();
      this.moves = [...this.moves.filter((move) => move.run === run && now - move.at < MOVES_MS), { run, at: now }];
      if (this.moves.length > MAX_MOVES) return this.finish(MOVES_SAY, "loop");
      const here = currentPath();
      ui.setBusy(THINKING);
      await settle(ui.host);
      if (run !== this.run) return;
      return this.turn(run, { event: `${event ?? ""} The user went from ${page.snapshot.path} to ${here}.`.trim(), ...(followed ? { followed } : {}), closing });
    };
    let reply: TurnReply;
    this.noteShownOwn(page.snapshot);
    this.lastSent = page.snapshot;
    try {
      reply = await this.sendTurn(
        {
          ...(this.id ? { guide: this.id } : {}),
          goal: this.asked,
          step: this.step,
          // Earlier questions answered in words come first, so a question that follows from one is read with it.
          history: [...this.thread, ...this.history].slice(-MAX_HISTORY),
          snapshot: page.snapshot,
          ...(told ? { event: told } : {}),
          ...(change ? { change } : {}),
          ...(this.strayed ? { offTrack: true } : {}),
          ...(closing ? { closing: true as const } : {}),
          ...(acting ? { mode: "act" as const } : {}),
        },
        {
          onTarget: pointEarly,
          // An answer takes a moment longer than a pointer, so say what the wait is for.
          onMode: (mode) => {
            if (run === this.run && !acting && mode === "answer") ui.setBusy("Reading the help docs");
          },
        },
        abort.signal,
      );
    } catch (error) {
      stopWatching();
      if (run !== this.run) return;
      // The page is on its way out and took the request with it. The next page picks the guide up.
      if (isLeaving()) return this.askAgainIfStaying(run, asking, dropEarly);
      if (moved) return startOver();
      dropEarly();
      console.warn("[Haptic]", error);
      // The connection dropped with no answer, as a network or a proxy now and then does: asked once more, as the
      // visitor would by asking again, before the guide gives up. An error the server sent is not asked again.
      if (!asking.retried && !abort.signal.aborted && droppedConnection(error)) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
        if (run !== this.run) return;
        return this.turn(run, { ...asking, retried: true });
      }
      return this.finish("Something went wrong on our side. Try asking again.", "error");
    }
    stopWatching();
    if (run !== this.run) return;
    if (isLeaving()) return this.askAgainIfStaying(run, asking, dropEarly);
    // The line that said what Doing it means has been read by now.
    ui.setNote("");

    // The site is switched off or has spent its budget, and the model was not asked. The guide did not finish,
    // so it is reported as a step that failed, and "Did this help?" is not asked. While Haptic acted, what it did stays listed.
    if (reply.paused) {
      dropEarly();
      const session = this.acting;
      this.finish(reply.say, "error");
      if (session?.did.length) this.showDid(session, "");
      return;
    }

    // The answer is about a page the visitor has already left. Start over from where they are now. While Haptic acts,
    // nothing of its own was going on while it waited: someone else moved the page, and acting ends.
    if (moved || currentPath() !== page.snapshot.path) return startOver();

    let el = reply.target ? page.elements.get(reply.target) : undefined;
    const listed = reply.target ? page.snapshot.elements.find((element) => element.id === reply.target) : undefined;
    const acted = early?.acted;

    // A control the site's owner ruled out. The server says so, and the widget checks for itself. Nothing is pointed at or done.
    if (reply.blocked || isBlocked(listed, this.blocked)) {
      dropEarly();
      const say = reply.blocked ? reply.say : BLOCKED_SAY;
      if (this.acting) return this.finishActing(say, "blocked");
      return this.finish(say, "blocked");
    }

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

    // While Haptic acts, the gate decides on the live control what becomes of the reply (DESIGN 4).
    let plan: Plan | undefined;
    if (acting && reply.mode !== "act") {
      // An older server, or a site that turned acting off: the way is shown instead, and that is said once.
      this.endActing();
      acting = undefined;
      reply = { ...reply, say: `${SAYS.actingOff} ${reply.say}`.trim() };
    } else if (acting && reply.target && reply.status !== "stuck") {
      plan = planFor(reply, el, listed, acting.gate, this.config);
      if (plan.kind === "again") {
        // The control changed or went before Haptic could use it: the page is read again and the question asked again, a few times at most.
        if (++acting.again > MAX_AGAIN) return this.stopActing(ACT_SAYS.changing, undefined, "error");
        await settle(ui.host);
        if (run !== this.run) return;
        return this.turn(run, { ...asking, reread: true });
      }
      acting.again = 0;
      if (plan.kind === "visitor" && plan.reason === "acting-off") {
        this.endActing();
        acting = undefined;
        plan = undefined;
        reply = { ...reply, say: `${SAYS.actingOff} ${reply.say}`.trim() };
      }
    }

    // The model is sent the question with addresses and numbers masked. The transcript is the visitor's own words, kept
    // in the browser, and only goes anywhere if they ask for a person.
    const did = this.step === 0 ? this.goal : [event, became.kept, followed].filter(Boolean).join(" ") || "The page changed.";
    this.history.push({ role: "user", text: this.step === 0 ? this.asked : did }, { role: "assistant", text: reply.say });
    const kind = reply.mode && reply.mode !== "act" ? { kind: reply.mode } : {};
    this.transcript = [...this.transcript, { role: "user" as const, text: did }, { role: "assistant" as const, text: reply.say, ...kind }].slice(-MAX_TRANSCRIPT);
    this.step++;
    this.previous = page.snapshot;
    this.last = listed ? { listed, used: false, page: pageState(page.snapshot), ...(el ? { el: new WeakRef(el) } : {}) } : undefined;
    this.strayed = false;

    // Only a finished guide is billed. It is finished when the visitor followed the steps and is now
    // where they asked to be, or when they used the control the last answer pointed at. A first answer
    // that the visitor did not act on, or that only needed words, was shown, and is free.
    const arrived = this.step > 1;

    // An answer in words, or a fixed sentence saying Haptic can't help, is read in the panel, where there is room for it
    // and for the articles it rests on (Answers). A step's sentence stays beside the pointer, in the caption. An act
    // reply is never one.
    const inPanel = !acting && (reply.mode === "answer" || reply.mode === "cannot_help");
    if (inPanel) {
      // Earlier questions go to the model with the next one, so they are masked like it.
      this.thread = [...this.thread, { role: "user" as const, text: this.asked }, { role: "assistant" as const, text: reply.say }].slice(-MAX_THREAD);
      ui.showAnswer(this.goal, reply);
    } else ui.clearAnswer();
    if (inPanel && (!el || !el.isConnected)) {
      dropEarly();
      return this.conclude(reply.mode === "answer" ? "answered" : (reply.reason ?? "not_covered"));
    }

    // No way forward was found. The guide ends on the sentence, whatever it points at, and is free. While Haptic acted, nothing more is done.
    if (reply.status === "stuck") {
      dropEarly();
      if (acting) return this.finishActing(reply.say, "nothing_to_point_at");
      return this.finish(reply.say, "nothing_to_point_at");
    }

    /** The hand-over: the visitor makes the click that commits, with "What I did" on show. Acting ends here, and the click is listened for as a guide's last step. */
    let handover: { session: ActSession; commit: string } | undefined;
    if (acting && plan) {
      if (plan.kind === "act" || plan.kind === "visitor" || plan.kind === "stop") return this.carryOut(run, plan, reply, listing, listed, pageNow);
      if (plan.kind === "handover") {
        handover = { session: acting, commit: (listed?.label || nameOfClicked(plan.el, listing) || "it").slice(0, 60) };
        this.endActing();
        acting = undefined;
        el = plan.el;
        reply = { ...reply, say: plan.say, status: "done" };
      }
    }
    if (acting && !el && reply.status === "done") return this.finishActing(reply.say, arrived ? "finished" : "shown");

    if (!el) {
      dropEarly();
      // "continue" with nothing to point at is not an ending: it is a step the visitor does with no pointer, like pressing a key.
      if (reply.status === "continue") return this.watch(run, page, listing, reply.say, retries);
      return this.finish(reply.say, arrived ? "finished" : "shown");
    }
    const target = el;
    if (early?.el !== target) {
      dropEarly();
      bringIn(target, !!listed?.offscreen);
    }
    // If they have already used it, the caption would only flash. An answer's words are in the panel, so its pointer goes alone.
    if (!acted) ui.pointAt(target, inPanel ? "" : reply.say);

    if (handover) {
      ui.setBusy("");
      this.showDid(handover.session, ACTING_WORDS.nothingSaved(handover.commit), handover.commit);
    } else if (inPanel) ui.setBusy("");
    else this.pointingNow();
    // An answer in words that also points ends as answered, whatever the visitor does next. Answers are not billed.
    // The pointer stays up until the visitor clicks anywhere or goes to another page.
    if (inPanel && reply.status === "done") {
      early?.stop();
      this.endRun(true);
      ui.setState("finished");
      this.reportEnding("answered");
      this.leavePointerUp();
      return;
    }
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
      this.reportEnding(arrived ? "finished" : "shown");
      this.leavePointerUp();
      return;
    }
    this.showingLast = last;
    // A guide that stops on the last pointer ended there. After following steps, the visitor is on the screen
    // they asked for. A first answer, or a hand-over, is finished only once its control is used.
    this.unconfirmed = last ? (arrived && !handover ? "finished" : "shown") : undefined;
    // A guide that got there is reported finished the moment its last pointer shows: the visitor may close the tab
    // with it on show, and the look that follows is the guide's own business. Its steps keep the guide's id.
    if (this.unconfirmed === "finished") this.sendOutcome("finished");
    // At the hand-over the visitor may go back to a field to check it: only the commit, or leaving, ends it.
    how.anyClick = last && !handover;
    how.keys = keysAsked(reply.say);
    this.save();
    ui.setState("pointing");
    const hashBefore = location.hash;
    const name = listed ? nameOf(listed) : "the control";

    const onActed = (what: Acted, on: Element) => {
      this.stopWaiting = undefined;
      // Nothing was done: the page drew the control again, or took it away. Find it and carry on with the same step, or ask.
      if (what.how === "redrawn") return findAgain(what.gone?.words || `${name} is no longer on the page.`, what.gone?.closed === true);
      // A dialog the page opened shuts the control out: the step can't be done as it stands. The page is read again.
      if (what.how === "covered") return lost(what.event);
      if (this.last && what.onTarget) this.last.used = true;
      if (handover && !what.onTarget && what.how !== "left") {
        this.stopWaiting = listen(on);
        return;
      }
      if (handover) {
        this.didOnShow = undefined;
        ui.hideDid();
      }
      // The last step was there to be used or left. Doing something else puts it away, with no more questions.
      if (last && !what.onTarget) return this.end(this.unconfirmed ?? "shown");
      // The control the last answer pointed at was used: finished, and said so at once, before the click can take the page away.
      if (last) {
        this.unconfirmed = "finished";
        this.sendOutcome("finished");
      }
      // From here it is a guide. An answer in the panel has been read, and the pointer needs the room.
      if (inPanel) ui.clearAnswer();
      this.strayed = what.strayed;
      this.stopField?.();
      // Saved straight away: if this click loads a new page, the next page needs to know about it.
      this.save(what.event);
      // The caption goes with the pointer: what the control opens often opens right where the caption was.
      // A click on the control itself is answered first, with a press: the ring and the pointer dip, and then go.
      if (what.how === "clicked" && what.onTarget) ui.press();
      else ui.clear();
      ui.setState("asking");
      ui.setBusy(this.strayed ? OFF_TRACK : last ? "Checking" : THINKING);
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
          if (last && closing && describeChange(page.snapshot, takeSnapshot(ui.host, this.goal).snapshot) === NOTHING_CHANGED && currentPath() === page.snapshot.path) return this.end("finished");
          if (last) this.closings++;
          void this.turn(run, { event: what.event, ...(followed ? { followed } : {}), closing: last });
        }),
      );
    };
    const listen = (on: Element) => waitForAction(on, listed, ui.host, listing, how, (what) => onActed(what, on));
    /** Points at the control again on the node the page drew it on, and listens there. */
    const showAgain = (again: Element) => {
      if (this.last) this.last.el = new WeakRef(again);
      ui.pointAt(again, reply.say);
      this.pointingNow();
      ui.setState("pointing");
      this.stopWaiting = listen(again);
    };
    /**
     * The control went with nothing done. Nothing is left pointing at where it was: the pointer and its sentence go at
     * once, and the page is read again for the next step, told in `gone` what became of it.
     */
    const lost = (gone: string) => {
      ui.clear();
      ui.setState("asking");
      ui.setBusy(THINKING);
      void settle(ui.host, { since: performance.now() }).then(() =>
        onceStaying(() => {
          if (run !== this.run) return;
          if (this.goneOnceMore(run)) return this.finish(GONE_SAY, "loop");
          void this.turn(run, { event: gone });
        }),
      );
    };
    /**
     * Looks for the control the page drew again: at once, since a page that draws a list again does it in one go, and
     * once more when the page has settled, since one that fetches first shows it later. If it never comes back, or the
     * dialog or menu it was in closed, the next step is asked for. The pointer is never left on where it was meanwhile.
     */
    const findAgain = (gone: string, closed: boolean) => {
      if (run !== this.run) return;
      // A control whose dialog closed is not looked for: another control just like it elsewhere on the page is not it.
      const find = () => (listed && !closed ? sameControl(page.snapshot, listed, takeSnapshot(ui.host, this.goal)) : undefined);
      const again = find();
      if (again) return showAgain(again);
      ui.clear();
      ui.setState("asking");
      ui.setBusy(THINKING);
      void settle(ui.host, { since: performance.now() }).then(() =>
        onceStaying(() => {
          if (run !== this.run) return;
          const later = find();
          if (later) return showAgain(later);
          if (this.goneOnceMore(run)) return this.finish(GONE_SAY, "loop");
          void this.turn(run, { event: gone, closing });
        }),
      );
    };
    // The early pointer is already listening. Hand its result over, now or when it comes.
    if (acted) onActed(acted, target);
    else if (early) whenActed = (what) => onActed(what, target);
    else this.stopWaiting = listen(target);
  }

  /** A step while Haptic acts that is not the hand-over: Haptic does it, gives it to the visitor, or stops. */
  private carryOut(run: number, plan: ActPlan | VisitorPlan | StopPlan, reply: TurnReply, listing: Map<Element, SnapElement>, listed: SnapElement | undefined, pageNow: string): Promise<void> | void {
    switch (plan.kind) {
      case "stop":
        return this.stopActing(plan.say, plan.el, plan.reason === "cap" ? "step_limit" : undefined);
      case "visitor":
        return this.visitorTurn(run, plan.el, listing, plan.say, plan.event, reply.do === "choose");
      case "act":
        return this.doStep(run, plan, reply, listing, listed, pageNow);
    }
  }

  /**
   * Haptic does one step itself (DESIGN 3): the pointer on the control with
   * the model's sentence, the engine's events, and a check that it took. Then
   * the page settles and the next step is asked for, told in Haptic's own
   * words what it did. A step the engine could not do or see take goes to the
   * visitor; what it saw that ends acting, ends it.
   */
  private async doStep(run: number, plan: ActPlan, reply: TurnReply, listing: Map<Element, SnapElement>, listed: SnapElement | undefined, pageNow: string): Promise<void> {
    const session = this.acting!;
    const { ui } = this;
    // At most two actions on one control with nothing on the page changing in between (DESIGN 4.2).
    const again = session.gate.repeats?.el === plan.el && session.before === pageNow;
    session.gate.repeats = { el: plan.el, count: again ? session.gate.repeats!.count + 1 : 1 };
    session.before = pageNow;
    ui.setState("acting");
    ui.setBusy(ACTING_WORDS.doing);
    ui.pointAt(plan.el, reply.say);
    // A press that may load another page: the page after it carries on acting, if it comes soon.
    if (plan.navigates) this.expectLoad();
    this.save();
    const since = performance.now();
    const outcome = await perform(
      { plan, ...(listed && listing.get(plan.el) === listed ? { listed } : {}) },
      {
        alive: () => run === this.run,
        session: session.gate,
        config: this.config,
        listing,
        ui: { glideTo: (x, y) => ui.glideTo(x, y), tap: () => ui.tap() },
        listen: (target) => this.hearHaptic(target, listing),
      },
    );
    if (run !== this.run) {
      // Stopped or paused part way. Typing cut short stays as it is, and "What I did" says so.
      if (outcome.kind === "stopped" && outcome.partly) this.noteDid(session, outcome.partly, true);
      return;
    }
    switch (outcome.kind) {
      case "stopped":
        return;
      case "stop": {
        // A confirmation the page opened: the pointer goes to its action, for the visitor to read and choose.
        const action = outcome.reason === "confirmation" && outcome.el?.matches("dialog, [role='dialog'], [role='alertdialog']") ? confirmationAction(outcome.el, ui.host) : undefined;
        return this.stopActing(outcome.say, action ?? outcome.el);
      }
      case "visitor":
        if (outcome.reason === "failed") session.gate.failures++;
        return this.visitorTurn(run, outcome.el, listing, outcome.say, outcome.event, plan.act === "choose");
      case "done": {
        session.gate.failures = 0;
        if (outcome.did) this.noteDid(session, outcome.did);
        if (this.last) {
          this.last.used = true;
          if (outcome.did) this.last.set = true;
        }
        const event = outcome.nothingChanged ? `${outcome.event} ${NOTHING_CHANGED}` : outcome.event;
        // Saved at once: if the press is loading a new page, the next page needs to know what it was.
        this.save(event);
        ui.rest();
        ui.setState("asking");
        void settle(ui.host, { since, used: plan.el }).then(() =>
          onceStaying(() => {
            if (run === this.run) void this.turn(run, { event });
          }),
        );
        return;
      }
    }
  }

  /**
   * One step of an act request that the visitor does: a value they did not
   * give, a control the gate keeps for them, a step the engine could not do.
   * The pointer stays, and acting carries on when the hearing hears them do
   * it. Haptic does not pause for their hand now: it is their turn. For a
   * choice (`picks`), the click that opens the list is not the step: the
   * pick is.
   */
  private visitorTurn(run: number, given: Element, listing: Map<Element, SnapElement>, say: string, event: string, picks = false) {
    const { ui } = this;
    const session = this.acting;
    const listed = listing.get(given);
    // A control the page drew again while Haptic tried it, as a tab does on the route it leads to, is pointed at on its new node.
    const el = !given.isConnected && listed && this.previous ? (sameControl(this.previous, listed, takeSnapshot(ui.host, this.goal)) ?? given) : given;
    ui.setState("pointing");
    ui.setBusy(ACTING_WORDS.yourTurn);
    ui.pointAt(el, say);
    this.save();
    const how: Hearing = { anyClick: false, keys: keysAsked(say), subject: VISITOR, ...(this.previous?.dialog ? { dialog: this.previous.dialog } : {}) };
    const isOpen = (on: Element) => on.isConnected && (on.getAttribute("aria-expanded") === "true" || !!on.querySelector("[aria-expanded='true']"));
    /** Whether that was the click that opens the list the visitor is to pick from. The page opens it after the click is heard, so it is looked at a moment later. */
    let opening = false;
    const onHeard = (what: Acted, on: Element) => {
      this.stopWaiting = undefined;
      if (run !== this.run || this.acting !== session) return;
      if (picks && !opening && what.onTarget && (what.how === "clicked" || what.how === "opened")) {
        opening = true;
        const timer = setTimeout(
          safely(() => {
            this.stopWaiting = undefined;
            if (run !== this.run || this.acting !== session) return;
            // The list is open: the pick is still to come, from the list it opened.
            if (isOpen(on)) this.stopWaiting = waitForAction(on, listed, ui.host, listing, how, (next) => onHeard(next, on));
            else onHeard(what, on);
          }),
          LIST_OPENS_MS,
        );
        this.stopWaiting = () => clearTimeout(timer);
        return;
      }
      if (what.how === "redrawn") {
        // The page drew the control again: the same step, on its new node. One whose dialog or menu closed is not looked for.
        const again = listed && !what.gone?.closed ? sameControl(this.previous ?? takeSnapshot(ui.host, this.goal).snapshot, listed, takeSnapshot(ui.host, this.goal)) : undefined;
        if (again) {
          ui.pointAt(again, say);
          this.stopWaiting = waitForAction(again, listed, ui.host, listing, how, (next) => onHeard(next, again));
          return;
        }
      }
      // They went to another page with nothing done here: acting ends.
      if (what.how === "left") return this.stopActing(SAYS.moved, undefined, "stopped");
      // Their step may load a page, which then carries on acting.
      if (what.onTarget) this.expectLoad();
      if (this.last && what.onTarget) this.last.used = true;
      const told = [event, what.event || what.gone?.words].filter(Boolean).join(" ");
      this.save(told);
      ui.rest();
      ui.setState("asking");
      ui.setBusy(ACTING_WORDS.doing);
      // A field they typed in is not watched until it is left, as in a guide: Haptic's next step moves on from it.
      const since = performance.now();
      void settle(ui.host, { since, used: on }).then(() =>
        onceStaying(() => {
          if (run === this.run && this.acting === session) void this.turn(run, { event: told });
        }),
      );
    };
    this.stopWaiting = waitForAction(el, listed, ui.host, listing, how, (what) => onHeard(what, el));
  }

  /** Hears a control Haptic is acting on, the way a visitor's step is heard, with Haptic as the actor (DESIGN 3.5). */
  private hearHaptic(target: Element, listing: Map<Element, SnapElement>): Listening {
    let heard: HeardStep | undefined;
    let wake: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopHearing = waitForAction(target, listing.get(target), this.ui.host, listing, { anyClick: false, keys: [], actor: "haptic", subject: VISITOR }, (what) => {
      heard = { how: what.how, onTarget: what.onTarget, event: what.event };
      wake?.();
    });
    return {
      next: (ms) =>
        new Promise((resolve) => {
          if (heard) return resolve(heard);
          timer = setTimeout(() => resolve(undefined), ms);
          wake = () => {
            clearTimeout(timer);
            resolve(heard);
          };
        }),
      stop: () => {
        stopHearing();
        // Nothing of ours is left waiting once the step is over.
        clearTimeout(timer);
        wake?.();
      },
    };
  }

  /** Acting ends because the model says it is done, with nothing to point at: its sentence, and "What I did". */
  private finishActing(say: string, outcome: GuideOutcome) {
    const session = this.acting;
    this.finish(say, outcome);
    if (session?.did.length) this.showDid(session, "");
  }

  /** What is kept of an act session across a page load. */
  private kept(session: ActSession): NonNullable<SavedGuide["acting"]> {
    const { gate } = session;
    return {
      actions: gate.actions,
      typed: gate.typed,
      failures: gate.failures,
      turns: session.turns,
      did: session.did.map(({ name, value, mine, partly }) => ({ name, ...(value !== undefined ? { value } : {}), ...(mine ? { mine } : {}), ...(partly ? { partly } : {}) })),
      ...(this.expectLoadUntil > Date.now() ? { expectLoadUntil: this.expectLoadUntil } : {}),
    };
  }

  /**
   * The pointer is up and it is the visitor's turn. The chat stays open, as it does from the question to the last
   * step, and says so: it does not go on saying "Thinking" from the question just answered, which reads as Haptic
   * still working while it waits for them. The way to stop is in its ask box. If it would cover the control or its
   * caption, it moves to the other side of the window while the pointer is there (Ui.keepLauncherOff).
   */
  private pointingNow() {
    this.ui.setBusy(SHOWING);
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
    // While Haptic acts this is the visitor's turn, and Stop stays on show.
    const acting = !!this.acting;
    if (acting) ui.setBusy(ACTING_WORDS.yourTurn);
    else {
      ui.setBusy("");
      ui.closePanel();
    }
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
        this.reportEnding("shown");
        return;
      }
      this.stopField?.();
      this.save(event);
      ui.clear();
      ui.setState("asking");
      ui.setBusy(acting ? ACTING_WORDS.doing : THINKING);
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
    const gained = statesOf(now).filter((state) => !statesOf(last.listed).includes(state));
    const lost = statesOf(last.listed).filter((state) => !statesOf(now).includes(state));
    if (gained.length) parts.push(`is now ${gained.join(", ")}`);
    if (lost.length) parts.push(`is no longer ${lost.join(", ")}`);
    // What is in a field is never read, so a field always looks the same. Nor is the choice a list's field shows: one that
    // Haptic set and saw take is not called unchanged, which told the model its choice had not taken.
    const what = parts.join(" and ") || (isField(el) || last.set ? "" : "looks unchanged");
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
    // A field pointed at because it was invalid is pointed at again until what is typed is accepted: retyping is the step.
    if (!last?.used || !el || pageState(page.snapshot) !== last.page || statesOf(last.listed).includes("invalid")) {
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

  /** Stops everything a running guide keeps going. Whatever is on show stays. `keepPanel` leaves the panel open, with an answer in it. */
  private endRun(keepPanel = false) {
    this.run++;
    this.endActing();
    this.stopWaiting?.();
    this.stopWaiting = undefined;
    this.stopField?.();
    this.showingLast = false;
    this.watchPage(false);
    forget();
    this.ui.setBusy("");
    if (!keepPanel) this.ui.closePanel();
  }

  /**
   * The pointer on show, once its guide is over, stays up until the visitor
   * clicks anywhere or goes to another page some other way, like the back button.
   */
  private leavePointerUp() {
    const ended = this.run;
    const { ui } = this;
    let stopAddress = () => {};
    const unlisten = () => {
      document.removeEventListener("click", dismiss, true);
      stopAddress();
    };
    const dismiss = () => {
      unlisten();
      if (ended === this.run) ui.clear();
    };
    document.addEventListener("click", dismiss, true);
    stopAddress = onAddressChange(dismiss);
    this.stopWaiting = unlisten;
  }

  /** Ends a question whose reply is in the panel (Answers): nothing to wait for, and the ask box comes back under the answer. */
  private conclude(outcome: GuideOutcome) {
    this.endRun(true);
    this.ui.clear();
    this.ui.setState("finished");
    this.reportEnding(outcome);
  }

  /** Ends the guide with nothing more to say. */
  private end(outcome: GuideOutcome) {
    this.endRun();
    this.ui.clear();
    this.ui.setState("finished");
    this.reportEnding(outcome);
  }

  /** Ends the guide on a sentence, which stays up until the visitor puts it away or asks again. */
  private finish(text: string, outcome: GuideOutcome) {
    this.endRun();
    this.ui.say(text);
    this.ui.setState("finished");
    this.reportEnding(outcome);
  }

  /**
   * Reports how the guide ended, once. For an ending where the answer is not
   * obvious, the panel then asks whether it helped.
   */
  private reportEnding(outcome: GuideOutcome) {
    const id = this.id;
    if (!id) return;
    // What the server has: a guide whose ending was sent before it was over keeps that ending.
    const ended = this.reported ?? outcome;
    if (!this.reported) this.report(id, { outcome });
    this.id = "";
    this.reported = undefined;
    this.unconfirmed = undefined;
    // A finished guide is one the visitor followed to the end, which says as much as a "Yes". The chat marks it Done:
    // the same ending that is billed, and no other.
    if (ended === "finished") {
      this.misses = 0;
      this.ui.showDone();
    } else if (outcome !== "stopped") this.misses++;
    if (ASK_IF_HELPED.includes(outcome)) {
      this.ui.askIfHelped((helped) => {
        this.report(id, { helped });
        if (helped) this.misses = 0;
        // "No" is the plainest sign that a person is needed.
        else this.offerPerson(id);
      });
    }
    // A person is offered when Haptic has just said it can't help, and when a few questions in a row have got nowhere.
    // Not after every reply: most questions don't need one. And not for a question that had nothing to do with the site.
    if (outcome === "not_covered" || outcome === "sensitive" || (this.misses >= OFFER_PERSON_AFTER && outcome !== "off_topic")) this.offerPerson(id);
  }

  /**
   * Shows the button that leads to a person, if the site has such a way.
   *
   * The page hears about it first, as a "haptic:handoff" event on the
   * document, with the conversation and the page. A site that cancels the
   * event (preventDefault) has taken over, say by opening its own chat with
   * the conversation filled in, and the widget does nothing more.
   */
  private offerPerson(guide: string) {
    const way = this.handoff;
    if (!way) return;
    const { config } = way;
    const transcript = this.transcript;
    const path = currentPath();
    const took = () => this.report(guide, { handoff: true });
    const open = () => {
      const heard = new CustomEvent("haptic:handoff", { cancelable: true, detail: { question: this.goal, path, transcript } });
      if (!document.dispatchEvent(heard)) return took();
      if (config.url) window.open(config.url, "_blank", "noopener");
      else if (config.email) location.href = mailTo(config.email, transcript, path);
      took();
    };
    // The server records that the form was used when it passes it on, so the widget doesn't report it twice.
    const send = config.form ? (email: string, note: string) => way.send({ guide, email, note, path, transcript }) : undefined;
    this.ui.offerHandoff(config.label, open, send);
  }

  /** Saves the guide for the next page. `shown` is a step pointed at whose reply is still coming, counted as done. */
  private save(event?: string, shown?: { user: string; assistant: string }) {
    const history: HistoryTurn[] = shown ? [...this.history, { role: "user", text: shown.user }, { role: "assistant", text: shown.assistant }] : this.history;
    const saved: SavedGuide = {
      ...(this.id ? { id: this.id } : {}),
      ...(this.reported ? { reported: this.reported } : {}),
      goal: this.goal,
      history: history.slice(-MAX_HISTORY),
      ...(this.thread.length ? { thread: this.thread } : {}),
      step: shown ? this.step + 1 : this.step,
      path: currentPath(),
      savedAt: Date.now(),
      ...(event ? { event } : {}),
      ...(this.strayed ? { strayed: true } : {}),
      ...(this.showingLast ? { closing: true } : {}),
      ...(this.closings ? { closings: this.closings } : {}),
      ...(this.acting ? { acting: this.kept(this.acting) } : {}),
    };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Storage full or blocked. The guide just won't survive a page load.
    }
  }
}

/** A link that opens the visitor's own mail program, with the conversation written into the message. */
function mailTo(address: string, transcript: TranscriptTurn[], path: string): string {
  const lines = transcript.map((turn) => `${turn.role === "user" ? "Me" : "Haptic"}: ${turn.text}`);
  // Mail programs give up on a very long link, so the oldest lines go first.
  let body = "";
  for (const line of lines.reverse()) {
    if (body.length + line.length > 1500) break;
    body = `${line}\n${body}`;
  }
  return `mailto:${address}?subject=${encodeURIComponent("A question Haptic couldn't answer")}&body=${encodeURIComponent(`\n\n---\nI was on ${location.origin}${path} and asked Haptic:\n${body}`)}`;
}

/** A random v4 UUID. crypto.randomUUID exists only on https pages, and some customers test on plain http. */
function newGuideId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
/** The page's address, dialog, and every control on it with its state: not only those listed, which on a long page change with a scroll. */
function pageState(snapshot: Snapshot): string {
  return [snapshot.path, snapshot.dialog ?? "", ...wholePage(snapshot).elements.map((element) => `${elementKey(element)}|${statesOf(element).join(",")}`)].join("\n");
}

/** Text is typed into it. A dropdown is picked from, a slider is dragged, and a field nobody can type in is used by clicking it. */
function isTyped(el: Element): boolean {
  return isField(el) && !(el instanceof HTMLSelectElement) && !(el as HTMLInputElement).readOnly && !(el instanceof HTMLInputElement && el.type === "range");
}

/**
 * Whether the browser itself filled in a field, from what it keeps: Chrome's autofill and the like. The field is then
 * in the `:autofill` state as its input event arrives, and the event is not one of typing. Chrome sends a plain Event,
 * and Firefox an InputEvent that replaces the text. Typing, pasting and dictating are InputEvents of other kinds.
 */
function filledByBrowser(event: Event, field: Element): boolean {
  if (typeof InputEvent === "function" && event instanceof InputEvent && event.inputType !== "insertReplacementText") return false;
  for (const state of [":autofill", ":-webkit-autofill"]) {
    try {
      return field.matches(state);
    } catch {
      // A browser that does not know this name for the state: try the other.
    }
  }
  return false;
}

/** A field a visitor fills in: one text is typed into, or a dropdown. Clicking into one is not yet using it. */
function isFieldToFill(el: Element | null | undefined): boolean {
  return !!el && (isTyped(el) || el instanceof HTMLSelectElement);
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

/**
 * Whether a control can be seen and used where it is: drawn, and not both see-through and closed to the mouse, as a
 * menu that has faded away is. One that is only see-through, like a row's action shown while the mouse is over the
 * row, can still be used.
 */
function usable(el: Element): boolean {
  if (!isDrawn(el)) return false;
  if (typeof el.checkVisibility !== "function" || el.checkVisibility({ opacityProperty: true })) return true;
  return getComputedStyle(el).pointerEvents !== "none";
}

/** What a box drawn over the page is, in a word for the model: a menu, a list, or a popup. */
function layerKind(el: Element): string {
  const role = el.getAttribute("role") ?? "";
  if (role === "menu" || role === "menubar") return "menu";
  if (role === "listbox") return "list";
  if (role === "tree") return "tree";
  return "popup";
}

/** Whether `node` is `el` or inside it, shadow roots included. */
function isWithin(el: Element, node: Node | null): boolean {
  for (let at: Node | null = node; at; at = at.parentNode ?? (at as ShadowRoot).host ?? null) if (at === el) return true;
  return false;
}

/**
 * The box drawn over the page that `el` is in, looking out through shadow
 * roots: a popover or a dialog shown on the top layer, or a list, a menu or a
 * calendar. Nothing that is only part of the page's flow counts.
 */
function overlayOf(el: Element): Element | undefined {
  for (let at: Node | null = el, depth = 0; at && depth < 40; at = at.parentNode ?? (at as ShadowRoot).host ?? null, depth++) {
    if (!(at instanceof Element)) continue;
    let top = false;
    try {
      top = at.matches(":popover-open, dialog[open]");
    } catch {
      // No popovers here.
    }
    if (top || at.matches('[role="listbox"], [role="menu"], [role="dialog"], [role="tree"]')) return at;
  }
  return undefined;
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
  // A slider's value is a number it reports, not something anyone wrote.
  const attributes = ["aria-expanded", "aria-checked", "aria-selected", "aria-pressed", "aria-current", "aria-disabled", "aria-label", "title", "aria-valuenow", "aria-valuetext"].map(
    (name) => el.getAttribute(name) ?? "",
  );
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
  const haptic = () => how.actor === "haptic";
  const pointed = (): Pointed => ({ typed, select, ticked, keys: how.keys, anyClick: how.anyClick, ...(haptic() ? { typingPauseMs: OWN_TYPING_PAUSE_MS } : {}) });
  // What has come on show since the pointer went up, and what the control
  // opened (popups.ts). A list or a calendar that the control opens is often
  // in the page all along, hidden, so being in the page is not enough.
  const watch = watchPopups(target);
  const { isNew, layerOf, says, isExpanded } = watch;
  const startPath = currentPath();
  const startAddress = location.href;
  const startDialog = findOpenModal(host);
  const startLook = lookOf(target);
  /** What holds the control and closes with it: the modal dialog it is in, or else the menu, list or popup it is in. */
  const holder = (startDialog && isWithin(startDialog, target) ? startDialog : undefined) ?? overlayOf(target);
  /**
   * Whether the control could be used when the pointer went up. One shown only while the mouse is over its row was
   * not, so its hiding again when the mouse leaves is not its going. Only leaving the page is.
   */
  const usableAtStart = usable(target);
  const isGone = () => !target.isConnected || (usableAtStart && !usable(target));
  /** The visitor's last press or key, to say how what held the control came to close. */
  let lastGesture: { at: number; kind: "escape" | "outside" | "inside" | "key" } | undefined;
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
  /** When the mouse last came over the pointed control. A menu can open on that alone. */
  let hovered: number | undefined;
  /** When a key that opens things (F4, the down arrow) was last pressed in the pointed control. */
  let keyed: number | undefined;
  let idle = 0;

  /** The snapshot's own test for something a visitor can click: a tag or role that says so, a place in the list, or a pointer cursor that starts here. */
  const isControl = (node: Element) => {
    if (node === document.body || node === document.documentElement) return false;
    if (node.matches(CLICKABLE) || listing.has(node)) return true;
    return getComputedStyle(node).cursor === "pointer" && (!node.parentElement || getComputedStyle(node.parentElement).cursor !== "pointer");
  };
  /** What the pointed control says it opens, by id. */
  const popupOf = () => watch.popupOf();
  const insidePopup = (path: EventTarget[], first: Element): boolean => {
    const root = popupOf();
    if (root && path.includes(root)) return true;
    if (!isExpanded() && heard.opened === undefined && hovered === undefined && keyed === undefined) return false;
    // Inside a shadow root nothing tells what came on show, as the page's changes are watched only outside them. A choice there, not
    // read with the page, inside a box drawn over it that does not hold the control, is in what the control opened.
    const over = !listing.has(first) && first.getRootNode() instanceof ShadowRoot ? overlayOf(first) : undefined;
    if (over && !isWithin(over, target)) {
      watch.popup ??= over;
      return true;
    }
    // New since the pointer went up, and clicked after the visitor went into the control: it is what the control opened.
    if (isNew(first) && !listing.has(first)) {
      watch.popup ??= layerOf(first);
      return true;
    }
    const box = first.closest(POPUP_ROLES);
    if (!box || box.contains(target) || !isExpanded()) return false;
    watch.popup ??= box;
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
  /**
   * Whether a press went to the part of the control the pointer is on, when
   * that is not the control itself: the box a field is drawn in as a speck.
   * Another control inside that box, like a chip's cross, is not the field.
   */
  const onPart = (path: EventTarget[], first: Element | undefined): boolean => {
    const part = (host as HTMLElement & { pointedAt?: Element }).pointedAt;
    if (!part || part === target || !part.contains(target) || !path.includes(part)) return false;
    return !first || first === part || first.contains(target) || !(listing.has(first) || first.matches(CLICKABLE));
  };
  const whereOf = (path: EventTarget[], point?: { x: number; y: number }): Where => {
    const controls = path.filter((node): node is Element => node instanceof Element && isControl(node));
    const first = controls[0];
    // A control inside the pointed one that has come on show since, like an entry of a submenu drawn inside its parent entry, is what it opened.
    const opened = !!first && first !== target && isWithin(target, first) && isNew(first);
    if (opened) watch.popup ??= layerOf(first);
    const onTarget =
      !opened &&
      (path.includes(target) ||
        path.some((node) => node instanceof HTMLLabelElement && (node.control === target || node.contains(target))) ||
        inTargetBox(controls, point) ||
        onPart(path, first));
    return {
      onTarget,
      controls: controls.map(numberOf),
      name: first ? nameOfClicked(first, listing) : "",
      known: !!first && (listing.has(first) || !isNew(first)),
      inPopup: !onTarget && !!first && (opened || insidePopup(path, first)),
      aroundTarget: !onTarget && !opened && !!first && first.contains(target),
      field: !!first && isFieldToFill(first instanceof HTMLLabelElement ? first.control : first),
    };
  };
  const fate = (): Fate => {
    const gone = isGone();
    const press = pressed;
    const modal = findOpenModal(host);
    return {
      gone,
      changed: !gone && lookOf(target) !== startLook,
      dialog: modal !== startDialog,
      covered: !gone && !!modal && modal !== startDialog && !isWithin(modal, target),
      path: currentPath() !== startPath,
      address: location.href !== startAddress,
      pressGone: !!press?.el && (!isDrawn(press.el) || !isWithin(press.el, hitAt(press.x, press.y))),
      popupOpen: !!watch.popup && isDrawn(watch.popup) && (says("aria-expanded") === "" || isExpanded()),
      listOpen: typed && isExpanded(),
      leaving: isLeaving(),
    };
  };
  const sentence = (verdict: Verdict): string => {
    const who = how.subject ?? "The user";
    const whom = who.toLowerCase();
    switch (verdict.how) {
      case "clicked":
        return target.matches('[role="slider"], input[type="range"]') ? `${who} moved ${name}.` : `${who} clicked ${name}.`;
      case "filled": {
        // Autofill fills a whole form, so the model is told to look at the fields around this one before asking for them.
        const how = verdict.autofill ? " with the browser's autofill, which may have filled in other fields of the form too" : "";
        const then = verdict.then === undefined ? "" : `, then clicked ${verdict.then ? `"${verdict.then}"` : "another control"}`;
        return `${who} filled in ${name}${how}${then}. You can't see what they entered.`;
      }
      case "opened":
        return `${who} clicked into ${name}, and a list of choices opened.`;
      case "key":
        return `${who} pressed ${keyName(verdict.key)} in ${name}.`;
      case "chose": {
        const names = verdict.names.filter(Boolean).slice(0, 3).map((picked) => `"${picked}"`);
        return `${who} chose ${names.length ? names.join(" and ") : "an entry"} from the list that ${name} opened.`;
      }
      case "other":
        return `${who} clicked ${verdict.name ? `"${verdict.name}"` : "something else"} instead of ${name}.`;
      case "elsewhere":
        return `${who} clicked somewhere else on the page.`;
      case "left":
        return `${who} went to ${currentPath()} without using ${name}.`;
      case "unknown":
        return `The page changed after something ${whom} did that could not be identified.`;
      case "covered":
        return `A dialog opened over ${name}, so it cannot be used until the dialog is closed.`;
      case "redrawn":
        return "";
    }
  };
  /**
   * What became of the control, which went without being used, in plain words: the dialog or menu it was in closed,
   * and how, or it is simply no longer on the page. Read while what held it can still be looked at.
   */
  const vanished = (): { words: string; closed: boolean } => {
    const who = how.subject ?? "The user";
    const whom = who.toLowerCase();
    const recent = lastGesture && performance.now() - lastGesture.at <= OUTCOME_WINDOW_MS ? lastGesture.kind : undefined;
    if (holder && !isDrawn(holder)) {
      const what = holder === startDialog ? (how.dialog ? `the dialog "${how.dialog}"` : "the dialog") : `the ${layerKind(holder)}`;
      const What = what.charAt(0).toUpperCase() + what.slice(1);
      if (recent === "escape") return { closed: true, words: `${who} pressed Escape, which closed ${what} without using ${name}.` };
      if (recent === "outside") return { closed: true, words: `${who} clicked outside ${what}, which closed it without using ${name}.` };
      if (recent) return { closed: true, words: `${What} closed after something ${whom} did, without ${name} being used.` };
      return { closed: true, words: `${What} closed without ${name} being used.` };
    }
    if (recent) return { closed: false, words: `The page changed after something ${whom} did that could not be identified, and ${name} is no longer on the page.` };
    return { closed: false, words: `${name} is no longer on the page.` };
  };

  const feed = (seen: Seen) => {
    heard = hear(heard, seen, pointed());
    const verdict = heard.verdict;
    if (!verdict) return;
    stop();
    // The control went, and the visitor did not use it: they dismissed what held it, or the page took it away.
    const gone = verdict.how === "redrawn" || (verdict.how === "unknown" && isGone()) ? vanished() : undefined;
    const event = gone && verdict.how === "unknown" ? gone.words : sentence(verdict);
    // Dismissing it is not the step they were shown, and the next reply has to give them the way from where they are now.
    const strayed = verdict.strayed || (verdict.how === "unknown" && !!gone);
    done({ event, onTarget: verdict.onTarget, strayed, how: verdict.how, ...(gone ? { gone } : {}) });
  };
  const outside = (event: Event) => {
    const path = event.composedPath();
    return path.includes(host) ? undefined : path;
  };
  /**
   * A press or a click made by whoever is using the control: the visitor's
   * own, or, while Haptic acts on it, one Haptic dispatched itself. A page's
   * script can click too: Jira, as the mouse goes down in a box of its date
   * filter, clicks the label of the row's radio button. That is the page at
   * work, not the visitor, and was heard as a click on the radio button
   * instead of the box. It is not heard while Haptic acts either.
   */
  const byActor = (event: Event) => event.isTrusted || (haptic() && isOwn(event));
  const visitors = (event: Event) => (byActor(event) ? outside(event) : undefined);
  const onPress = (event: Event) => {
    const path = visitors(event);
    if (!path || (event as PointerEvent).button !== 0) return;
    const point = { x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY };
    const where = whereOf(path, point);
    const el = path.find((node): node is Element => node instanceof Element && isControl(node)) ?? (where.onTarget ? target : undefined);
    // A press on a dialog's backdrop: outside its box, whether the backdrop is a layer of the page's or the browser's own, which is the dialog itself.
    const box = holder?.getBoundingClientRect();
    const outsideHolder =
      !!holder && (!path.includes(holder) || (path[0] === holder && !!box && (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom)));
    lastGesture = { at: performance.now(), kind: outsideHolder ? "outside" : "inside" };
    pressed = { x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY, ...(el ? { el } : {}) };
    feed({ type: "press", at: performance.now(), where });
  };
  const onOver = (event: Event) => {
    const path = outside(event);
    if (path?.includes(target) || (path && onPart(path, undefined))) hovered = performance.now();
  };
  const onRelease = () => feed({ type: "release", at: performance.now() });
  const onCancel = () => feed({ type: "cancel", at: performance.now() });
  const onClick = (event: Event) => {
    const path = visitors(event);
    if (path) feed({ type: "click", at: performance.now(), where: whereOf(path, { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY }) });
  };
  const onKey = (event: Event) => {
    const path = outside(event);
    if (!path) return;
    const on = path[0];
    const key = (event as KeyboardEvent).key ?? "";
    // The keys that open a field's list or calendar, or a menu, from the keyboard.
    if (path.includes(target) && (["F4", "ArrowDown", "ArrowUp", "Enter"].includes(key) || (event as KeyboardEvent).altKey)) keyed = performance.now();
    // Letters typed in a field are no unidentified press: a search box that filters the control away leaves it simply gone.
    // Naming the field in the sentence was tried on Northpine, and the model then left the visitor's search alone and stopped.
    if (key === "Escape") lastGesture = { at: performance.now(), kind: "escape" };
    else if (!(path[0] instanceof Element && isTyped(path[0])) || key === "Enter" || key === "Tab") lastGesture = { at: performance.now(), kind: "key" };
    feed({ type: "key", at: performance.now(), key: (event as KeyboardEvent).key ?? "", inTarget: path.includes(target), inTyped: on instanceof Element && isTyped(on) });
  };
  const onInput = (event: Event) => {
    const path = outside(event);
    if (!path) return;
    const inTarget = path.includes(target);
    // Another field is heard as it is typed in or filled. Its change event, when it is left, says nothing more, and
    // arrives between the browser's autofill of that field and of the pointed one.
    if (!inTarget && event.type !== "input") return;
    const field = inTarget ? target : path[0] instanceof Element ? path[0] : undefined;
    const autofill = event.type === "input" && event.isTrusted && !!field && filledByBrowser(event, field);
    feed({ type: "input", at: performance.now(), inTarget, ...(byActor(event) ? {} : { byPage: true }), ...(autofill ? { autofill } : {}) });
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
  // Back, forward and anything else that changes the address in a single-page app is heard at once, not at the next look.
  const stopAddress = onAddressChange(safely(() => feed({ type: "tick", at: performance.now(), fate: fate() })));

  const listeners = ([
    [document, "pointerdown", onPress],
    [document, "pointerover", onOver],
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
    stopAddress();
    watch.stop();
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
    // Only the visitor's own presses: a page's script pressing something is not the visitor doing what the sentence says.
    const path = event.isTrusted ? outside(event) : undefined;
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
    // A field the page fills in by itself is not the visitor filling it in.
    const path = event.isTrusted ? outside(event) : undefined;
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
 * and holds no field other than a tick box. A field, an editor, anything
 * inside an editor and a region of the page all come back with no name.
 */
export function nameOfClicked(clicked: Element, listing: Map<Element, SnapElement> = new Map()): string {
  const listed = listing.get(clicked);
  if (listed?.label) return cleanText(listed.label, 60);
  const given = clicked.getAttribute("aria-label");
  if (given) return cleanText(given, 60);
  // A day in a calendar that opened after the page was read is named as a reading would name it.
  if (!clicked.matches(NAMED_BY_ITS_TEXT)) return nameOfPicked(clicked);
  if ((clicked as HTMLElement).isContentEditable) return "";
  // A tick box holds nothing anyone wrote. An option drawn with one beside its words is still named by them.
  if (clicked.querySelector('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable]')) return "";
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

/**
 * How many controls one page has that the other does not, counting controls
 * that are listed alike. `main` is how many of those added are outside the
 * page's furniture. The whole of each page is compared, not only what was
 * listed: a long page lists what is on screen first, so a scroll alone would
 * add and remove controls.
 */
function listDifference(asked: Snapshot, now: Snapshot): { added: number; removed: number; main: number; after: Map<string, number> } {
  const count = (elements: SnapElement[]) => {
    const counts = new Map<string, number>();
    for (const element of elements) counts.set(elementKey(element), (counts.get(elementKey(element)) ?? 0) + 1);
    return counts;
  };
  const whole = wholePage(now).elements;
  const before = count(wholePage(asked).elements);
  const after = count(whole);
  let added = 0;
  let removed = 0;
  for (const [key, n] of after) added += Math.max(0, n - (before.get(key) ?? 0));
  for (const [key, n] of before) removed += Math.max(0, n - (after.get(key) ?? 0));
  // The added controls that are not in the header, the navigation, a sidebar, a footer, a menu, tabs or a toolbar.
  const furniture = /^(?:header|nav|aside|footer|menu|tabs|toolbar)\b/;
  const unmatched = new Map(before);
  let main = 0;
  for (const element of whole) {
    const key = elementKey(element);
    const n = unmatched.get(key) ?? 0;
    if (n) unmatched.set(key, n - 1);
    else if (!furniture.test(element.context ?? "")) main++;
  }
  return { added, removed, main, after };
}

/** Text with its numbers taken out, so that a clock, a counter or a "5 seconds ago" that ticks reads the same from one moment to the next. */
const withoutNumbers = (text: string) => text.replace(/\d+/g, "#");

/** Whether the page says something now that it did not say before, anywhere on it: a new heading, or new text of more than a few words. A clock that ticks is not that. */
function saysMore(asked: Snapshot, now: Snapshot): boolean {
  const [was, is] = [wholePage(asked), wholePage(now)];
  if (is.headings.map(withoutNumbers).join("|") !== was.headings.map(withoutNumbers).join("|")) return true;
  const had = new Set(was.text.map(withoutNumbers));
  let fresh = 0;
  for (const text of is.text) if (!had.has(withoutNumbers(text))) fresh += text.length;
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

/** Whether what both readings found on the whole page is in a different order: a sort, or a filter, that landed. Controls and text both count. */
function reordered(asked: Snapshot, now: Snapshot): boolean {
  const [was, is] = [wholePage(asked), wholePage(now)];
  const differ = (a: string[], b: string[]) => sharedInOrder(a, b).join("\n") !== sharedInOrder(b, a).join("\n");
  return differ(was.elements.map(elementKey), is.elements.map(elementKey)) || differ(was.text.map(withoutNumbers), is.text.map(withoutNumbers));
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

/**
 * Takes every loading mark on show now for part of the page, once one of them
 * has outlasted the longest wait. They were all there all along: waiting the
 * whole time again for each in turn would keep the first question back for a
 * minute on a page with a few spinners that never stop.
 */
/** Whether two radios are choices of one group, so that choosing one leaves the other unchosen. */
function sameRadioGroup(a: Element, b: Element): boolean {
  const isRadio = (el: Element) => el.getAttribute("role") === "radio" || (el instanceof HTMLInputElement && el.type === "radio");
  if (a === b || !isRadio(a) || !isRadio(b)) return false;
  const group = a.closest('[role="radiogroup"]');
  if (group) return group === b.closest('[role="radiogroup"]');
  return a instanceof HTMLInputElement && b instanceof HTMLInputElement && !!a.name && a.name === b.name && a.form === b.form;
}

function markStuck(ignore: Element) {
  for (let mark = loadingMark(ignore), count = 0; mark && count < 50; mark = loadingMark(ignore), count++) stuckMarks.add(mark);
}

/** Something on the page that says it is still loading, if anything does. */
function loadingMark(ignore: Element): Element | undefined {
  for (const el of document.querySelectorAll(LOADING)) {
    if (ignore.contains(el) || stuckMarks.has(el) || !el.getClientRects().length) continue;
    // A progress bar that gives a value is measuring something. If it is moving, the page is changing and is waited for anyway.
    if (el.getAttribute("role") === "progressbar" && el.hasAttribute("aria-valuenow")) continue;
    if (!markInView(el)) continue;
    return el;
  }
  // A page whose main part says only "Loading" has not drawn itself yet.
  const main = document.querySelector("main, [role='main']");
  if (main && !stuckMarks.has(main) && main.getElementsByTagName("*").length < 60 && /^(?:loading|please wait)\b[\s.…]*$/i.test(((main as HTMLElement).innerText ?? "").trim())) return main;
  return undefined;
}

/**
 * Whether a loading mark is one the visitor can see, and so a sign of
 * something they are waiting for. Shops keep placeholders in the page where
 * nobody sees them: under the pictures that loaded over them, hidden from
 * screen readers; in the part of a carousel scrolled out of its box; in a
 * part of the page far below the window that loads only when it is
 * scrolled to. IKEA's front page keeps eighteen. None of them goes away
 * while the visitor waits, and none says the page in view is unfinished.
 */
function markInView(el: Element): boolean {
  if (el.closest('[aria-hidden="true"]')) return false;
  const rect = el.getBoundingClientRect();
  if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
  if (typeof el.checkVisibility === "function" && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  // Clipped away: outside a box around it that shows only what is inside its own edges.
  for (let at = el.parentElement; at && at !== document.body && at !== document.documentElement; at = at.parentElement) {
    const style = getComputedStyle(at);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const box = at.getBoundingClientRect();
    if (rect.bottom <= box.top || rect.top >= box.bottom || rect.right <= box.left || rect.left >= box.right) return false;
  }
  return true;
}

/** A transition or animation that ends later than this is part of the page, not something on its way in or out. */
const LONGEST_MOVE_MS = 1000;

/**
 * How long until the page's transitions and animations now running have
 * ended, counting only those that end within a second: a list or a dialog
 * sliding in or fading out. Ours, and those that never end, like a spinner's,
 * do not count.
 */
function stillMoving(ignore: Element): number {
  if (typeof document.getAnimations !== "function") return 0;
  let longest = 0;
  for (const animation of document.getAnimations()) {
    if (animation.playState !== "running") continue;
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (!effect || !target || isWithin(ignore, target)) continue;
    const { endTime, localTime } = effect.getComputedTiming();
    const left = Number(endTime) - Number(localTime ?? 0);
    if (Number.isFinite(left) && left > 0 && left <= LONGEST_MOVE_MS) longest = Math.max(longest, left / Math.abs(animation.playbackRate || 1));
  }
  return longest;
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
  /** A quiet page is not enough: the page has to change at least once first, still no longer than `maxMs`. For an address that changed before its page was drawn. */
  untilChanged?: boolean;
}

/**
 * Resolves once the page has stopped changing, so the next snapshot shows the
 * result of a click and not a half-drawn page. Waits only as long as the page
 * keeps changing, up to `maxMs`: longer only while the page itself says it is
 * loading, and a little longer when data the click asked for has not come.
 */
export function settle(ignore: Element, { quietMs = 300, maxMs = 3000, since, used, fetches = false, patient = true, untilChanged = false }: Settling = {}): Promise<void> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout>;
    /** Anything on the page has changed since this began. */
    let changed = false;
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
      if (untilChanged && !changed) return restart();
      mark = loadingMark(ignore);
      if (mark) return restart();
      const more = requests.stillComing(since, performance.now(), fetches, answered);
      if (more > 0) return restart(more);
      // A box that fades or slides away changes nothing more in the page until it is gone, and is not to be read on its way out.
      const moving = stillMoving(ignore);
      if (moving > 0) return restart(moving + 30);
      finish();
    };
    const restart = (ms = quietMs) => {
      clearTimeout(quiet);
      quiet = setTimeout(check, ms);
    };
    const observer = new MutationObserver((records) => {
      const page = records.filter((record) => record.target !== ignore && !ignore.contains(record.target));
      if (!page.length) return;
      changed = true;
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
        if (mark?.isConnected) markStuck(ignore);
        finish();
      },
      Math.max(maxMs, patient ? EMPTY_PAGE_WAIT_MS : 0),
    );
    restart();
  });
}
