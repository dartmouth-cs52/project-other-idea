import {
  cleanText,
  MAX_ASKED,
  describeElement,
  normalizePath,
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
import { describeChange, elementKey, isField, NOTHING_CHANGED, takeSnapshot } from "./snapshot.ts";
import type { Ui } from "./ui.ts";

// Runs one guide: ask the model for a step, point at it, wait for the visitor
// to act, let the page settle, and go again until the model says it's done.

const MAX_STEPS = 20;
const MAX_HISTORY = 12;
/** How much of the conversation before this question is sent with it: the last three questions answered in words, and their answers. */
const MAX_THREAD = 6;
/** A field counts as filled in once typing pauses this long. */
const TYPING_PAUSE_MS = 1200;
const STORAGE_KEY = "haptic.guide";
/** Shown the moment the visitor does something other than the step, while the next step is worked out. */
const OFF_TRACK = "Finding the way from here…";
/** A saved guide older than this isn't picked back up after a page load. */
const RESUME_WINDOW_MS = 3 * 60 * 1000;
const CLICKABLE = "a[href], button, summary, select, input, textarea, label, [role], [onclick]";

/** Controls whose own caption says what they are. Anything else that can be clicked may be a region of the page. */
const NAMED_BY_ITS_TEXT =
  'a[href], button, summary, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [role="treeitem"]';

/**
 * A name for something the visitor clicked that was not the step they were
 * shown. It goes to the server, so it follows the same rules as the rest of
 * the page: emails and long numbers are masked, and nothing a person may have
 * written is read. A field, an editor, anything inside an editor, and a
 * region of the page all come back with no name.
 */
export function nameOfClicked(clicked: Element): string {
  const given = clicked.getAttribute("aria-label");
  if (given) return cleanText(given, 60);
  if (!clicked.matches(NAMED_BY_ITS_TEXT)) return "";
  if ((clicked as HTMLElement).isContentEditable) return "";
  if (clicked.querySelector("input, textarea, select, [contenteditable]")) return "";
  return cleanText(clicked.textContent || "", 60);
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
  /** Ties the guide's steps together on the server, across page loads. */
  id?: string;
  goal: string;
  history: HistoryTurn[];
  /** Earlier questions that were answered in words, so a guide that follows from one still knows what it was about. */
  thread?: HistoryTurn[];
  step: number;
  path: string;
  /** What the visitor did just before the page unloaded, if we saw it. */
  event?: string;
  /** Set when that was something other than the step they were shown. */
  strayed?: boolean;
  savedAt: number;
}

/** What the guide is told while a reply is still on its way. */
export interface Watch {
  /** The kind of reply, on a site with Answers on. */
  onMode?(mode: Mode): void;
  /** The control it will point at. */
  onTarget?(id: string): void;
}

/** Says how a guide went. Sent once per ending, and again when the visitor answers "Did this help?". */
export type Reporter = (guide: string, report: Omit<GuideReport, "site">) => void;

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

export class Guide {
  /** Empty when no guide is under way, or once the current one has reported how it ended. */
  private id = "";
  /**
   * Set while a first answer points at something and waits to see whether the
   * visitor uses it. Asking something new, or closing the caption, ends the
   * guide this way and not as stopped.
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
  /** The element the last step pointed at, and whether the visitor used it. */
  private last?: { key: string; used: boolean };
  /** The visitor's last action was not the step they were shown. Cleared once the next step is given. */
  private strayed = false;
  /** Bumped whenever the guide is stopped or restarted, so stale async work can tell and bail. */
  private run = 0;
  private stopWaiting?: () => void;

  constructor(
    private readonly ui: Ui,
    private readonly sendTurn: (request: Omit<TurnRequest, "site">, watch?: Watch) => Promise<TurnReply>,
    private readonly report: Reporter = () => {},
    private readonly handoff?: HandoffWay,
  ) {}

  /**
   * The question as it leaves the browser: with anything that looks like an
   * email address, a phone number or a long number masked, as it is in
   * everything Haptic reads from the page.
   */
  private get asked(): string {
    // Cut to the ask box's 300 characters first: a mask can be longer than what it hides, and the end of a question is usually what it asks.
    return cleanText(this.goal.slice(0, 300), MAX_ASKED);
  }

  start(goal: string) {
    // Asking something new while a guide is under way ends that one.
    this.end(this.unconfirmed ?? "stopped");
    this.reset();
    this.id = newGuideId();
    this.goal = goal;
    void this.turn(this.run);
  }

  stop() {
    this.end(this.unconfirmed ?? "stopped");
    this.reset();
    this.thread = [];
    this.transcript = [];
    this.misses = 0;
    this.ui.clear();
    this.ui.clearAnswer();
    this.ui.setBusy("");
  }

  /** Pick up a guide that a full page load interrupted. */
  resume() {
    const saved = load();
    if (!saved) return;
    this.reset();
    this.id = saved.id ?? newGuideId();
    this.goal = saved.goal;
    this.history = saved.history;
    this.thread = saved.thread ?? [];
    this.step = saved.step;
    this.strayed = saved.strayed === true;
    const here = normalizePath(location.pathname);
    const moved = saved.path === here ? "The page reloaded." : `A new page loaded: the user went from ${saved.path} to ${here}.`;
    const run = this.run;
    this.ui.setBusy(this.strayed ? OFF_TRACK : "Looking at this page…");
    void settle(this.ui.host).then(() => this.turn(run, [saved.event, moved].filter(Boolean).join(" ")));
  }

  private reset() {
    this.run++;
    this.stopWaiting?.();
    this.stopWaiting = undefined;
    this.history = [];
    this.step = 0;
    this.previous = undefined;
    this.last = undefined;
    this.strayed = false;
    this.unconfirmed = undefined;
    forget();
  }

  private async turn(run: number, event?: string, nudged = false): Promise<void> {
    const { ui } = this;
    if (this.step >= MAX_STEPS) return this.finish("That's as far as I can take this one. Ask again to keep going.", "step_limit");
    ui.setBusy(this.step === 0 ? "Finding it…" : this.strayed ? OFF_TRACK : "Next step…");

    ui.place();
    const page = takeSnapshot(ui.host);
    const change = event && this.previous ? describeChange(this.previous, page.snapshot) : undefined;

    // The server names the control before it has finished the sentence about
    // it. The pointer goes there at once. The visitor may act on it straight
    // away, so their action is listened for from that moment and kept until
    // the rest of the reply arrives.
    let early: EarlyPointer | undefined;
    let whenActed: ((what: Acted) => void) | undefined;
    const pointEarly = (id: string) => {
      const el = page.elements.get(id);
      if (run !== this.run || early || !el?.isConnected || normalizePath(location.pathname) !== page.snapshot.path) return;
      const listed = page.snapshot.elements.find((element) => element.id === id);
      if (listed?.offscreen) el.scrollIntoView({ block: "center", behavior: "smooth" });
      ui.pointAt(el, "");
      const waiting: EarlyPointer = {
        el,
        stop: waitForAction(el, listed, ui.host, (what) => {
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
          ...(this.id ? { guide: this.id } : {}),
          goal: this.asked,
          step: this.step,
          history: [...this.thread, ...this.history].slice(-MAX_HISTORY),
          snapshot: page.snapshot,
          ...(event ? { event } : {}),
          ...(change ? { change } : {}),
          ...(this.strayed ? { offTrack: true } : {}),
        },
        {
          onTarget: pointEarly,
          // An answer takes a moment longer than a pointer, so say what the wait is for.
          onMode: (mode) => run === this.run && mode === "answer" && ui.setBusy("Reading the help docs…"),
        },
      );
    } catch (error) {
      if (run !== this.run) return;
      dropEarly();
      console.warn("[Haptic]", error);
      return this.finish("Something went wrong on our side. Try asking again.", "error");
    }
    if (run !== this.run) return;

    // The site is switched off or has spent its budget, and the model was not asked.
    if (reply.paused) {
      dropEarly();
      return this.pause(reply.say);
    }

    // The answer is about a page the visitor has already left. Start over from where they are now.
    const here = normalizePath(location.pathname);
    if (here !== page.snapshot.path) {
      dropEarly();
      await settle(ui.host);
      if (run !== this.run) return;
      return this.turn(run, `${event ?? ""} The user went from ${page.snapshot.path} to ${here}.`.trim());
    }

    const el = reply.target ? page.elements.get(reply.target) : undefined;
    const listed = reply.target ? page.snapshot.elements.find((element) => element.id === reply.target) : undefined;

    // Pointing again at what the visitor just used, with the page unchanged,
    // is a loop. Ask once more saying so, then give up rather than repeat.
    if (listed && this.last?.used && this.last.key === elementKey(listed) && change === NOTHING_CHANGED && reply.status === "continue") {
      dropEarly();
      if (nudged) return this.finish("That step didn't change anything I can see, so I've stopped here. Ask again if there's more to do.", "loop");
      const nudge = `You pointed at ${describeElement(listed)} again, but the user already used it and nothing changed. Don't point at it again: move on, or say it's done.`;
      return this.turn(run, `${event} ${nudge}`, true);
    }

    // The model is sent the question with addresses and numbers masked. The transcript is the visitor's own
    // words, kept in the browser, and only goes anywhere if they ask for a person.
    const did = this.step === 0 ? this.goal : (event ?? "The page changed.");
    this.history.push({ role: "user", text: this.step === 0 ? this.asked : did }, { role: "assistant", text: reply.say });
    this.transcript = [...this.transcript, { role: "user" as const, text: did }, { role: "assistant" as const, text: reply.say, ...(reply.mode ? { kind: reply.mode } : {}) }].slice(-MAX_TRANSCRIPT);
    this.step++;
    this.previous = page.snapshot;
    this.last = listed ? { key: elementKey(listed), used: false } : undefined;
    this.strayed = false;

    // An answer in words, or a fixed sentence saying Haptic can't help, is read
    // in the panel, where there is room for it and for the articles it rests on.
    // A step's sentence stays beside the pointer, in the caption.
    const inPanel = reply.mode === "answer" || reply.mode === "cannot_help";
    if (inPanel) {
      // Earlier questions go to the model with the next one, so they are masked like it.
      this.thread = [...this.thread, { role: "user" as const, text: this.asked }, { role: "assistant" as const, text: reply.say }].slice(-MAX_THREAD);
      ui.showAnswer(this.goal, reply);
    } else ui.clearAnswer();

    if (inPanel && (!el || !el.isConnected)) {
      dropEarly();
      return this.conclude(reply.mode === "answer" ? "answered" : (reply.reason ?? "not_covered"));
    }

    // Only a finished guide is billed. It is finished when the visitor followed the steps and is now
    // where they asked to be, or when they used the control the last answer pointed at. A first answer
    // that the visitor did not act on, or that only needed words, was shown, and is free.
    const arrived = this.step > 1;
    if (reply.status === "stuck") {
      dropEarly();
      return this.finish(reply.say, "nothing_to_point_at");
    }
    if (!el || !el.isConnected) {
      dropEarly();
      if (reply.status === "done") return this.finish(reply.say, arrived ? "finished" : "shown");
      return this.finish(reply.say, "nothing_to_point_at");
    }
    if (early?.el !== el) {
      dropEarly();
      if (listed?.offscreen) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    // If they have already used it, the caption would only flash. An answer's words are in the panel, so its pointer goes alone.
    if (!early?.acted) ui.pointAt(el, inPanel ? "" : reply.say);

    if (reply.status === "done") {
      // The last answer points at something. Leave it up until they click anywhere but on Haptic itself.
      ui.setBusy("");
      if (!inPanel) ui.closePanel();
      forget();
      const dismiss = (event: MouseEvent) => {
        if (event.composedPath().includes(ui.host)) return;
        document.removeEventListener("click", dismiss, true);
        if (run === this.run) ui.clear();
      };
      document.addEventListener("click", dismiss, true);

      // An answer in words that also points ends as answered, whatever the visitor does next. Answers are not billed.
      if (inPanel) {
        early?.stop();
        this.end("answered");
        this.stopWaiting = () => document.removeEventListener("click", dismiss, true);
        return;
      }

      // After following steps, the visitor is on the screen they asked for.
      if (arrived) {
        early?.stop();
        this.end("finished");
        this.stopWaiting = () => document.removeEventListener("click", dismiss, true);
        return;
      }

      // A first answer that points: finished if they use what it points at, shown if they do anything
      // else, close the caption, ask something new, or leave the page.
      this.unconfirmed = "shown";
      let stopUse = () => {};
      const conclude = (used: boolean) => {
        if (run !== this.run || !this.unconfirmed) return;
        this.unconfirmed = undefined;
        window.removeEventListener("pagehide", left);
        stopUse();
        this.end(used ? "finished" : "shown");
      };
      const left = () => conclude(false);
      window.addEventListener("pagehide", left);
      this.stopWaiting = () => {
        window.removeEventListener("pagehide", left);
        stopUse();
        document.removeEventListener("click", dismiss, true);
      };
      if (early?.acted) return conclude(early.acted.onTarget);
      // The early pointer's own listener saves the guide for the next page, which must not happen once
      // it has ended. So it stops, and a plain one takes over.
      early?.stop();
      stopUse = waitForAction(el, listed, ui.host, (what) => conclude(what.onTarget));
      return;
    }

    if (inPanel) ui.setBusy("");
    else ui.closePanel();
    this.save();
    const acted = (what: Acted) => {
      this.stopWaiting = undefined;
      // From here it is a guide. The answer has been read, and the pointer needs the room.
      ui.clearAnswer();
      if (this.last && what.onTarget) this.last.used = true;
      this.strayed = !what.onTarget;
      // Saved straight away: if this click loads a new page, the next page needs to know about it.
      this.save(what.event);
      ui.clearPointer();
      ui.setBusy(this.strayed ? OFF_TRACK : "Next step…");
      void settle(ui.host).then(() => {
        if (run === this.run) void this.turn(run, what.event);
      });
    };
    // The early pointer is already listening. Hand its result over, now or when it comes.
    if (early?.acted) acted(early.acted);
    else if (early) whenActed = acted;
    else this.stopWaiting = waitForAction(el, listed, ui.host, acted);
  }

  /** Ends a question whose reply is in the panel: nothing to wait for, and the ask box comes back under the answer. */
  private conclude(outcome: GuideOutcome) {
    this.stopWaiting?.();
    this.stopWaiting = undefined;
    forget();
    this.ui.clear();
    this.ui.setBusy("");
    this.end(outcome);
  }

  private finish(text: string, outcome: GuideOutcome) {
    this.stopWaiting?.();
    this.stopWaiting = undefined;
    forget();
    this.ui.setBusy("");
    this.ui.closePanel();
    this.ui.say(text);
    this.end(outcome);
  }

  /**
   * Ends a guide the server would not go on with. It did not finish, so it is
   * reported as a step that failed, and "Did this help?" is not asked. The
   * server has the guide on record from its first question, so there is one
   * to report on even when this is the first reply.
   */
  private pause(text: string) {
    this.stopWaiting?.();
    this.stopWaiting = undefined;
    forget();
    this.ui.setBusy("");
    this.ui.closePanel();
    this.ui.say(text);
    this.end("error");
  }

  /**
   * Reports how the guide ended, once. For an ending where the answer is not
   * obvious, the caption then asks whether it helped.
   */
  private end(outcome: GuideOutcome) {
    const id = this.id;
    if (!id) return;
    this.id = "";
    this.report(id, { outcome });
    // A finished guide is one the visitor followed to the end, which says as much as a "Yes".
    if (outcome === "finished") this.misses = 0;
    else if (outcome !== "stopped") this.misses++;
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
    const path = normalizePath(location.pathname);
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

  private save(event?: string) {
    const saved: SavedGuide = {
      ...(this.id ? { id: this.id } : {}),
      goal: this.goal,
      history: this.history.slice(-MAX_HISTORY),
      ...(this.thread.length ? { thread: this.thread } : {}),
      step: this.step,
      path: normalizePath(location.pathname),
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

/**
 * Calls `done` once, when the visitor does what the step asked or does
 * something else that moves things along. Returns a function that stops
 * listening.
 */
function waitForAction(
  target: Element,
  listed: SnapElement | undefined,
  host: Element,
  done: (what: Acted) => void,
): () => void {
  const name = listed ? describeElement(listed) : "the element you pointed at";
  const field = isField(target);
  const startUrl = location.href;
  let typing: ReturnType<typeof setTimeout> | undefined;

  const finish = (event: string, onTarget: boolean) => {
    stop();
    done({ event, onTarget });
  };
  const filled = () => finish(`The user filled in ${name}. You can't see what they entered.`, true);

  const onClick = (event: MouseEvent) => {
    const path = event.composedPath();
    if (path.includes(host)) return;
    if (path.includes(target)) {
      // For a field, clicking into it isn't the action. Typing or picking is.
      if (!field) finish(`The user clicked ${name}.`, true);
      return;
    }
    const other = path.find((node): node is Element => node instanceof Element && node.matches(CLICKABLE));
    // A click on blank space or plain text isn't worth a new step.
    if (!other || other.contains(target)) return;
    const label = nameOfClicked(other);
    finish(`The user clicked ${label ? `"${label}"` : "something else"} instead of ${name}.`, false);
  };
  const onInput = (event: Event) => {
    if (!event.composedPath().includes(target)) return;
    clearTimeout(typing);
    if (target instanceof HTMLSelectElement) filled();
    else typing = setTimeout(filled, TYPING_PAUSE_MS);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" && field && event.composedPath().includes(target)) filled();
  };
  // Back, forward and anything else that changes the address without a click we saw.
  const poll = setInterval(() => {
    if (location.href !== startUrl) finish(`The user went to ${normalizePath(location.pathname)} without using ${name}.`, false);
  }, 500);

  const stop = () => {
    clearTimeout(typing);
    clearInterval(poll);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onInput, true);
    document.removeEventListener("keydown", onKey, true);
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onInput, true);
  document.addEventListener("keydown", onKey, true);
  return stop;
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
