import {
  describeChange,
  describeElement,
  elementKey,
  normalizePath,
  stripTags,
  type ContinueEvent,
  type HistoryTurn,
  type PageSnapshot,
  type RepeatNudge,
  type SnapshotElement,
  type TurnRequest,
} from "@haptic/protocol";
import { ApiError, type ApiClient } from "../net/api.ts";
import { takeSnapshot, type Registry } from "../snapshot/index.ts";
import type { Overlay } from "../ui/overlay.ts";
import type { Store } from "../ui/store.ts";
import type { Speaker, VoiceController } from "../voice/controller.ts";
import { onNavigate } from "./navigation.ts";
import { clearGuide, loadGuide, saveGuide } from "./persist.ts";
import { waitForSettle } from "./settle.ts";

// Runs a guide: ask, point, wait for the user's click, let the page settle,
// ask for the next step, until the model says the goal is done.

const MAX_STEPS = 12;
const MAX_HISTORY = 12;
const INTERACTIVE_SELECTOR = "a, button, input, select, textarea, summary, label, [role], [tabindex], [onclick]";
/** A field counts as filled in once typing pauses this long. */
const TYPING_PAUSE_MS = 1200;
const MAX_PAST_POINTS = 6;
const NOT_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "image"]);
const GAVE_UP = "That step didn't change anything I can see, so I've stopped here. Ask again if there's more to do.";

export type GuideEventName = "step" | "done" | "error" | "stop";
export type GuideListener = (detail: Record<string, unknown>) => void;

export interface GuideDeps {
  api: ApiClient;
  overlay: Overlay;
  store: Store;
  /** Haptic's own host element, excluded from snapshots and settle checks. */
  host: Element;
  context: () => TurnRequest["context"];
  voice?: VoiceController;
  emit: (name: GuideEventName, detail: Record<string, unknown>) => void;
}

export class GuideController {
  private abort?: AbortController;
  private stopWatching?: () => void;
  private history: HistoryTurn[] = [];
  private goal = "";
  private step = 0;
  private visited: string[] = [];
  private registry?: Registry;
  /** The page as the model last saw it, to tell it what the user's action changed. */
  private previous?: PageSnapshot;
  /** Recent steps' targets, newest last, and how many steps in a row pointed at the newest. */
  private points: PastPoint[] = [];
  private repeats = 0;
  /** Raw text of the step being streamed, tags included. */
  private lastAnswer = "";
  /** Guides started by voice answer out loud. */
  private speaking = false;
  private speaker?: Speaker;

  constructor(private readonly deps: GuideDeps) {}

  get active(): boolean {
    const phase = this.deps.store.phase.value;
    return phase === "thinking" || phase === "responding" || phase === "waiting" || phase === "settling";
  }

  /** Latest snapshot registry, for the debug API. */
  get lastRegistry(): Registry | undefined {
    return this.registry;
  }

  /** Plain text of the last answer, for copying. */
  get answerText(): string {
    return stripTags(this.lastAnswer);
  }

  async ask(question: string, options: { speak?: boolean } = {}) {
    const trimmed = question.trim();
    if (!trimmed) return;
    this.cancel();
    this.speaking = Boolean(options.speak && this.deps.voice);
    this.deps.store.question.value = trimmed;
    this.goal = trimmed;
    this.step = 0;
    this.visited = [];
    this.forgetPoints();
    this.deps.overlay.follow();
    await this.runTurn({ kind: "ask", question: trimmed });
  }

  /** Stop the guide and clear everything on screen. */
  stop() {
    const wasActive = this.active;
    this.cancel();
    clearGuide();
    this.deps.overlay.hide();
    const { store } = this.deps;
    store.phase.value = "idle";
    store.text.value = "";
    store.error.value = "";
    store.question.value = "";
    this.deps.voice?.stopAll();
    if (wasActive) this.deps.emit("stop", { goal: this.goal });
  }

  /** Pick up a guide that was interrupted by a full page load. */
  async resume(): Promise<boolean> {
    const saved = loadGuide();
    if (!saved) return false;
    this.goal = saved.goal;
    this.history = saved.history;
    this.step = saved.step;
    this.visited = saved.visited ?? [];
    // The old page is gone, so there's nothing to compare with.
    this.forgetPoints();
    const { store, overlay, host } = this.deps;
    store.phase.value = "settling";
    store.step.value = this.step;
    overlay.follow();
    const abort = new AbortController();
    this.abort = abort;
    await waitForSettle({ quietMs: 500, ignore: host, signal: abort.signal });
    if (abort.signal.aborted) return true;
    const to = location.pathname;
    const event: ContinueEvent =
      saved.path !== to ? { type: "navigated", from: normalizePath(saved.path), to: normalizePath(to) } : { type: "changed" };
    await this.runTurn({ kind: "continue", event });
    return true;
  }

  private cancel() {
    this.abort?.abort();
    this.abort = undefined;
    this.speaker?.cancel();
    this.speaker = undefined;
    this.stopWatching?.();
    this.stopWatching = undefined;
  }

  private forgetPoints() {
    this.previous = undefined;
    this.points = [];
    this.repeats = 0;
  }

  private async runTurn(partial: Pick<TurnRequest, "kind" | "question" | "event">, nudge?: RepeatNudge): Promise<void> {
    const { api, overlay, store, host } = this.deps;
    const abort = new AbortController();
    this.abort = abort;

    store.phase.value = "thinking";
    store.text.value = "";
    store.error.value = "";
    store.step.value = this.step;

    const snap = takeSnapshot(host);
    this.registry = snap.registry;
    if (this.visited[this.visited.length - 1] !== snap.snapshot.path) this.visited.push(snap.snapshot.path);
    const change = partial.kind === "continue" && this.previous ? describeChange(this.previous, snap.snapshot) : undefined;
    const action = partial.event;
    const last = this.points[this.points.length - 1];
    if (last && ((action?.type === "clicked" && action.id) || action?.type === "filled")) last.used = true;
    const request: TurnRequest = {
      ...partial,
      ...(change ? { change } : {}),
      ...(nudge ? { nudge } : {}),
      goal: this.goal,
      step: this.step,
      visited: this.visited.slice(-12),
      snapshot: snap.snapshot,
      history: this.history.slice(-MAX_HISTORY),
    };
    const context = this.deps.context();
    if (context && Object.keys(context).length) request.context = context;

    // A new step talks over nothing: stop the previous step's audio first.
    this.speaker?.cancel();
    const speaker = this.speaking ? this.deps.voice?.speaker() : undefined;
    this.speaker = speaker;
    let raw = "";
    let firstPoint: string | undefined;
    let samePoint = false;
    let held: RepeatNudge | undefined;
    let waiting = false;
    let done = false;
    // Its own signal, so a held-back step can end the stream without cancelling the guide.
    const stream = new AbortController();
    abort.signal.addEventListener("abort", () => stream.abort());
    // A route can finish loading while the model answers, like Flasht's set
    // page arriving after the user clicked View. The answer is about the old
    // page by then, so drop it and start over from the new one.
    let moved: ContinueEvent | undefined;
    const offMoved = onNavigate((from, to) => {
      if (pathOf(from) === pathOf(to)) return;
      moved = { type: "navigated", from: normalizePath(from), to: normalizePath(to) };
      stream.abort();
    });

    try {
      reading: for await (const event of api.turn(request, stream.signal)) {
        if (abort.signal.aborted) return;
        switch (event.type) {
          case "text":
            raw += event.text;
            speaker?.push(event.text);
            store.text.value = cleanForDisplay(stripTags(raw));
            store.phase.value = "responding";
            break;
          case "point": {
            raw += `<point id="${event.id}"/>`;
            const el = this.resolve(event.id);
            const element = snap.registry.element(event.id);
            if (el && element && !firstPoint) {
              samePoint = this.isLastPoint(el, element);
              held = this.repeatNudge(el, element, samePoint, snap.snapshot, nudge);
              if (held) {
                speaker?.cancel();
                stream.abort();
                break reading;
              }
            }
            if (el) {
              firstPoint ??= event.id;
              void overlay.pointAt(el);
            }
            store.phase.value = "responding";
            break;
          }
          case "wait":
            waiting = true;
            break;
          case "done":
            done = true;
            break;
          case "error":
            throw new Error(event.message);
          case "end":
            break;
        }
      }
    } catch (error) {
      offMoved();
      if (abort.signal.aborted) return;
      speaker?.cancel();
      if (moved) return this.continueAfter(moved);
      this.fail(error);
      return;
    }
    offMoved();
    if (abort.signal.aborted) return;
    if (moved) {
      speaker?.cancel();
      return this.continueAfter(moved);
    }
    if (held) {
      // Ask once more with a note about the repeat. If it repeats anyway, stop
      // rather than send the user around the same loop.
      if (!nudge) return this.runTurn(partial, held);
      this.giveUp();
      return;
    }
    speaker?.end();

    this.lastAnswer = raw;
    if (partial.kind === "ask" && partial.question) this.history.push({ role: "user", text: partial.question });
    // Record what the user did between steps, so the model sees alternating
    // turns instead of its own instructions back to back, which made it repeat them.
    else if (partial.kind === "continue") this.history.push({ role: "user", text: describeAction(partial.event) });
    // Plain text only. A marker like "[pointed at X]" got copied into replies
    // in place of a real point tag, and the user's next turn names what they clicked.
    const said = stripTags(raw);
    if (said) this.history.push({ role: "assistant", text: said });
    this.history = this.history.slice(-MAX_HISTORY);

    this.deps.emit("step", { step: this.step, text: store.text.value, goal: this.goal });

    if (done) {
      store.phase.value = "done";
      clearGuide();
      // Leave the last highlight up briefly so the user sees where they ended.
      setTimeout(() => {
        if (store.phase.value === "done") overlay.hide();
      }, 1500);
      this.deps.emit("done", { goal: this.goal, steps: this.step + 1 });
      return;
    }

    this.previous = snap.snapshot;
    const target = firstPoint ? this.resolve(firstPoint) : undefined;
    const pointed = firstPoint ? snap.registry.element(firstPoint) : undefined;
    if (target && pointed) {
      this.repeats = samePoint ? this.repeats + 1 : 0;
      this.points = [...this.points.slice(-(MAX_PAST_POINTS - 1)), { el: target, key: elementKey(pointed), snapshot: snap.snapshot, used: false }];
    }
    // Partway through a guide, a step that points somewhere is something to
    // click, even when the model leaves off <wait/>.
    if (target && partial.kind === "continue") waiting = true;
    if (waiting && target) {
      store.phase.value = "waiting";
      this.persist();
      this.watch(target, firstPoint!);
      return;
    }

    store.phase.value = "answered";
    clearGuide();
    // An explanation keeps pointing at what it explained; one without a point
    // doesn't need the pointer at all.
    if (!target) overlay.hide();
    // If the user clicks what it pointed at, carry on as a guide so the model
    // can confirm where they ended up. Anything else clears the pointer.
    else this.watch(target, firstPoint!, { dismissOtherwise: true });
  }

  /** Wait for the user to act, then continue once the page settles. */
  private watch(target: Element, targetId: string, { dismissOtherwise = false } = {}) {
    const { host } = this.deps;
    const targetLabel = this.registry?.element(targetId)?.label ?? "";
    // Clicking into a field isn't the step. Typing or picking a value is.
    const fillable = isFillable(target);
    let typingTimer: ReturnType<typeof setTimeout> | undefined;

    const onClick = (event: MouseEvent) => {
      const path = event.composedPath();
      if (path.includes(host)) return;
      const origin = path[0];
      const clicked = origin instanceof Element ? origin.closest(INTERACTIVE_SELECTOR) : null;
      if (path.includes(target) || (clicked?.tagName === "LABEL" && (clicked as HTMLLabelElement).control === target)) {
        if (!fillable) progress({ type: "clicked", id: targetId, label: targetLabel });
        return;
      }
      if (!clicked) return;
      if (dismissOtherwise) dismiss();
      // The user clicked something else. Keep going from wherever they are.
      else progress({ type: "clicked", id: "", label: (clicked.textContent ?? "").trim().slice(0, 60) });
    };
    const filled = () => progress({ type: "filled", id: targetId, label: targetLabel });
    const onInput = (event: Event) => {
      if (!event.composedPath().includes(target)) return;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(filled, TYPING_PAUSE_MS);
    };
    // Fires when a select or file picker gets a value, or a text field loses focus after an edit.
    const onChange = (event: Event) => {
      if (event.composedPath().includes(target)) filled();
    };
    const offNavigate = onNavigate((from, to) =>
      dismissOtherwise ? dismiss() : progress({ type: "navigated", from: normalizePath(from), to: normalizePath(to) }),
    );

    let fired = false;
    const progress = (event: ContinueEvent) => {
      if (fired) return;
      fired = true;
      cleanup();
      void this.continueAfter(event);
    };
    const dismiss = () => {
      if (fired) return;
      fired = true;
      cleanup();
      this.stop();
    };
    const cleanup = () => {
      clearTimeout(typingTimer);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onChange, true);
      offNavigate();
    };

    document.addEventListener("click", onClick, true);
    if (fillable) {
      document.addEventListener("input", onInput, true);
      document.addEventListener("change", onChange, true);
    }
    this.stopWatching = cleanup;
  }

  /** Whether the model is pointing at the same control as last step. */
  private isLastPoint(el: Element, element: SnapshotElement): boolean {
    const last = this.points[this.points.length - 1];
    return Boolean(last && isSame(last, el, element));
  }

  /** Why a step that points somewhere it already pointed should be held back, if it should. */
  private repeatNudge(el: Element, element: SnapshotElement, samePoint: boolean, page: PageSnapshot, nudge: RepeatNudge | undefined): RepeatNudge | undefined {
    const label = describeElement(element);
    // The user already used it and the page looks the same as it did then, so
    // the guide is going in circles: the same button twice, or two fields in turn.
    // Clicking something else and coming back to the same step is fine.
    if (this.points.some((past) => past.used && isSame(past, el, element) && describeChange(past.snapshot, page).none)) {
      return { reason: "unchanged", label };
    }
    // Next on a multi-page form is a real repeat, so a third time only gets a second look.
    if (samePoint && this.repeats >= 2 && nudge?.reason !== "repeated") return { reason: "repeated", label };
    return undefined;
  }

  private giveUp() {
    const { store, overlay } = this.deps;
    store.phase.value = "answered";
    store.text.value = GAVE_UP;
    clearGuide();
    overlay.hide();
    this.deps.emit("step", { step: this.step, text: GAVE_UP, goal: this.goal });
  }

  private async continueAfter(event: ContinueEvent) {
    const { store, overlay, host } = this.deps;
    this.step += 1;
    store.phase.value = "settling";
    overlay.follow();
    // Saved before waiting, so a full page load can pick the guide back up.
    this.persist();

    if (this.step >= MAX_STEPS) {
      store.phase.value = "answered";
      store.text.value = "That's as far as I can guide in one go. Ask again if you need the next part.";
      clearGuide();
      return;
    }

    const abort = new AbortController();
    this.abort = abort;
    await waitForSettle({ quietMs: event.type === "navigated" ? 500 : 300, ignore: host, signal: abort.signal });
    if (abort.signal.aborted) return;
    await this.runTurn({ kind: "continue", event });
  }

  private resolve(id: string): Element | undefined {
    const registry = this.registry;
    if (!registry) return undefined;
    const live = registry.resolve(id);
    if (live) return live;
    // React may have replaced the node since the snapshot. Find its twin.
    const fingerprint = registry.fingerprint(id);
    if (!fingerprint) return undefined;
    return takeSnapshot(this.deps.host).registry.find(fingerprint)?.el;
  }

  private persist() {
    saveGuide({
      goal: this.goal,
      history: this.history,
      step: this.step,
      visited: this.visited,
      path: location.pathname,
    });
  }

  private fail(error: unknown) {
    const { store, overlay } = this.deps;
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[Haptic] turn failed:", message);
    overlay.hide();
    store.phase.value = "error";
    // Rate limits and blocked sites carry a message meant for the user.
    store.error.value = error instanceof ApiError && error.status < 500 && error.status !== 401 ? error.message : "Couldn't reach Haptic. Try again.";
    clearGuide();
    this.deps.emit("error", { message });
  }
}

/** The prompt asks for plain text, but strip stray markdown just in case. */
export function cleanForDisplay(text: string): string {
  return text
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^#+\s*/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    // "Click <point/> View" leaves two spaces once the tag is gone.
    .replace(/ {2,}/g, " ")
    .trimStart();
}

interface PastPoint {
  el: Element;
  key: string;
  /** The page when the step pointed here. */
  snapshot: PageSnapshot;
  /** The user clicked it or filled it in. */
  used: boolean;
}

function isSame(past: PastPoint, el: Element, element: SnapshotElement): boolean {
  return past.el === el || past.key === elementKey(element);
}

/** The path part of "/set/abc?tab=1". */
function pathOf(path: string): string {
  return path.split(/[?#]/)[0] ?? path;
}

/** Text fields, selects and other inputs that take a value rather than a click. */
function isFillable(el: Element): boolean {
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName === "INPUT") return !NOT_TEXT_INPUTS.has((el as HTMLInputElement).type);
  return (el as HTMLElement).isContentEditable;
}

function describeAction(event: TurnRequest["event"]): string {
  switch (event?.type) {
    case "clicked":
      return event.label ? `I clicked "${event.label}".` : "I clicked it.";
    case "filled":
      return event.label ? `I filled in "${event.label}".` : "I filled it in.";
    case "navigated":
      return `I went to ${event.to}.`;
    default:
      return "The page changed.";
  }
}
