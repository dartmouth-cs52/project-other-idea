import type { Appearance } from "../shared/types.ts";

// Everything Haptic draws: the launcher, the ask box, the pointer, the
// highlight ring and the caption. It all lives in one shadow root on one host
// element, so the customer's CSS can't reach it and ours can't leak out.
// Model text is only ever set as textContent.

// Colours, radii and motion come from DESIGN.md. The accent colours the
// pointer and its highlight only. Everything else is ink on white.
// The pointer shape is assets/pointer.svg, with its tip at POINTER_TIP.
const POINTER_PATH =
  "M3.271 4.871A1.678 1.678 0 0 1 5.604 2.907L19.822 9.597A1.678 1.678 0 0 1 19.705 12.684L13.956 14.875A.622.622 0 0 0 13.643 15.139L10.506 20.431A1.678 1.678 0 0 1 7.444 20.021Z";
const POINTER_TIP = { x: 3.81, y: 3.14 };
/** The cross on the caption's close button, and the arrow on the send button. */
const CROSS_PATH = "M18 6 6 18M6 6l12 12";
const ARROW_PATH = "M12 19V5M5 12l7-7 7 7";

const CSS = `
:host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
  font: 14px/20px system-ui, -apple-system, "Segoe UI", sans-serif; color: #1c1917; }
* { box-sizing: border-box; }
button { font: inherit; cursor: pointer; }
.dock { position: fixed; bottom: 20px; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
.dock > * { pointer-events: auto; }
.dock.right { right: 20px; align-items: flex-end; }
.dock.left { left: 20px; align-items: flex-start; }
.launcher { display: inline-flex; align-items: center; gap: 8px; height: 40px; border: 0; border-radius: 999px; padding: 0 16px 0 14px;
  background: #1c1917; color: #fafaf9; font-weight: 500; box-shadow: 0 4px 14px rgba(0,0,0,.22); }
.launcher svg { width: 16px; height: 16px; flex: none; }
.launcher path { fill: currentColor; }
.panel { width: min(320px, calc(100vw - 40px)); background: #fff; border: 1px solid #e7e5e4; border-radius: 14px;
  padding: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.16); }
[hidden] { display: none !important; }
.panel form { display: flex; flex-direction: column; border: 1px solid transparent; border-radius: 10px; background: #f5f5f4; }
.panel form:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); }
.panel input { width: 100%; height: 40px; font: inherit; color: inherit; padding: 4px 12px 0; border: 0; background: transparent; outline: none; }
.panel input::placeholder { color: #78716c; }
.panel .row { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin: 6px 10px 8px; }
.panel .send { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 0;
  border-radius: 999px; background: #1c1917; color: #fafaf9; }
.panel .send svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.panel .doit { display: none; height: 32px; border: 1px solid #e7e5e4; border-radius: 999px; padding: 0 14px; background: #fff; color: #1c1917; font-size: 13px; font-weight: 500;
  transition: background-color .2s, border-color .2s, color .2s; }
.panel.acts .doit { display: inline-flex; align-items: center; }
.panel.nudged .doit { background: var(--accent); border-color: var(--accent); color: #fff; }
.first { display: flex; align-items: center; gap: 10px; padding: 8px 4px 4px 12px; color: #44403c; font-size: 13px; line-height: 18px; }
.first .go { flex: none; height: 28px; border: 0; border-radius: 999px; padding: 0 14px; background: #1c1917; color: #fafaf9; font-size: 13px; }
.status { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 2px 0 12px; }
.status span { flex: 1; color: #78716c; }
.stop, .resume { flex: none; height: 28px; border: 1px solid #e7e5e4; background: #fff; color: #78716c; border-radius: 999px; padding: 0 12px; font-size: 13px; }
.resume { border-color: #1c1917; background: #1c1917; color: #fafaf9; }
.status:not(.paused) .resume { display: none; }
.note { padding: 0 12px 6px; color: #78716c; font-size: 13px; line-height: 18px; }
.did { padding: 4px 4px 2px; }
.did h2 { margin: 4px 8px 6px; font-size: 13px; line-height: 18px; font-weight: 600; color: #1c1917; }
.did ul { list-style: none; margin: 0; padding: 0; }
.did .line { display: flex; width: 100%; gap: 10px; align-items: baseline; border: 0; border-radius: 8px; padding: 4px 8px; background: transparent; color: #44403c;
  font-size: 13px; line-height: 18px; text-align: left; }
.did .line:hover { background: #f5f5f4; }
.did .name { flex: none; max-width: 45%; color: #78716c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.did .value { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.did .mine { flex: none; color: #78716c; font-style: italic; }
.did p { margin: 6px 8px 4px; color: #78716c; font-size: 13px; line-height: 18px; }
.ring { position: fixed; border: 2px solid var(--accent); border-radius: 10px; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent);
  transition: opacity .2s; }
.ring.turn { animation: breathe 1.6s ease-in-out infinite; }
@keyframes breathe { 50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--accent) 12%, transparent); } }
.ripple { position: fixed; width: 28px; height: 28px; margin: -14px 0 0 -14px; border: 2px solid var(--accent); border-radius: 999px; pointer-events: none;
  animation: ripple .25s ease-out forwards; }
@keyframes ripple { from { transform: scale(.35); opacity: .9; } to { transform: scale(1.3); opacity: 0; } }
.cursor { position: fixed; left: 0; top: 0; width: 24px; height: 24px; transition: transform .55s cubic-bezier(.2,.8,.2,1);
  filter: drop-shadow(0 1px 1px rgba(0,0,0,.3)) drop-shadow(0 5px 9px rgba(0,0,0,.26)); will-change: transform; }
.cursor svg { display: block; overflow: visible; }
.cursor path { fill: var(--accent); stroke: #fff; stroke-width: 3; stroke-linejoin: round; paint-order: stroke; }
.caption { position: fixed; display: flex; align-items: center; gap: 8px; max-width: min(320px, calc(100vw - 24px)); background: #1c1917; color: #fafaf9;
  border-radius: 14px; padding: 6px 6px 6px 12px; box-shadow: 0 8px 24px rgba(0,0,0,.22); }
.caption .close { display: inline-flex; align-items: center; justify-content: center; flex: none; align-self: flex-start; width: 24px; height: 24px; border: 0;
  border-radius: 999px; background: rgba(250,250,249,.15); color: #fafaf9; pointer-events: auto; }
.caption .close:hover { background: rgba(250,250,249,.25); }
.caption .close svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; }
@media (prefers-reduced-motion: reduce) { .cursor { transition: none; } .ring.turn { animation: none; } .ripple { display: none; } }
`;

/**
 * Where a guide is, for anything outside that needs to know: tests, the
 * benchmark, a customer's own script.
 * - "idle": no guide has run on this page yet.
 * - "asking": a question has been sent and the answer is not yet on show.
 * - "pointing": a pointer is on show and the widget is waiting for the visitor to use it.
 * - "watching": a sentence is on show with no pointer, and the widget is waiting for the visitor to do what it says.
 * - "acting": Haptic is using a control itself ("Do it"). The visitor watches, and can stop it.
 * - "paused": the visitor touched the page while Haptic was acting. Nothing more is done until they carry on or stop.
 * - "finished": the guide is over. Its last sentence may still be on show. It stays this way until the next question.
 * While Haptic acts, a step it gives the visitor, and the hand-over at the end, are "pointing".
 */
export type GuideState = "idle" | "asking" | "pointing" | "watching" | "acting" | "paused" | "finished";

export interface UiHandlers {
  /** A question, with `act` set when the visitor pressed Do it (and, the first time, Go). */
  onAsk: (question: string, act: boolean) => void;
  onStop: () => void;
  /** The visitor let Haptic carry on after it paused for them. */
  onCarryOn?: () => void;
}

/** What the widget knows of the site's acting, when the site has it on and the page allows it. */
export interface UiActing {
  /** The site's id, for remembering that the visitor has seen the first-use line. */
  site: string;
  /** Show the one-line explanation the first time a visitor uses Do it. */
  confirmFirst: boolean;
  /** Whether the site allows acting on the page the visitor is on now. Do it shows only where it does. */
  allowedHere: () => boolean;
}

/** One line of "What I did", as the panel shows it. */
export interface DidShown {
  name: string;
  value?: string;
  /** Haptic set it though the visitor did not say so. */
  mine?: boolean;
  /** Typing that Stop or the visitor's own hand cut short. */
  partly?: boolean;
}

/** The first-use line, and what the status says while Haptic acts. English in this version, like the gate's sentences. */
export const ACTING_WORDS = {
  first: "I'll click and type on this page while you watch, and stop before anything is saved. Stop at any time.",
  doing: "Doing it",
  starting: "I'll do this with you and stop before anything is saved.",
  yourTurn: "Your turn",
  ready: "Ready for you",
  stopped: "Stopped",
  did: "What I did",
  mine: "my choice, check it",
  partly: "stopped part way",
  nothingSaved: (name: string) => `Nothing is saved until you click ${name}.`,
} as const;

/**
 * Whether a question reads as a request to do something rather than to be
 * shown how: "can you…", "please…", "do it for me", in the languages the
 * act rules ship. It only colours the Do it button. Words never start
 * acting by themselves: "give Maya a card" is as often typed meaning "how do I".
 */
export function asksToDo(question: string): boolean {
  const text = ` ${question.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").replace(/\s+/g, " ").trim()} `;
  return DO_IT_WORDS.test(text) || DO_IT_SCRIPT.test(question);
}

const DO_IT_WORDS = new RegExp(
  [
    // English
    "can you", "could you", "would you", "will you", "please", "pls", "for me", "do it", "do this", "do that",
    // Spanish
    "puedes", "podrias", "podria", "puede usted", "por favor", "hazlo", "hazme", "por mi",
    // French
    "peux-tu", "peux tu", "pouvez-vous", "pouvez vous", "pourrais-tu", "pourriez-vous", "s'il te plait", "s'il vous plait", "stp", "svp", "fais-le", "faites-le", "pour moi",
    // German
    "kannst du", "konnen sie", "konntest du", "konnten sie", "bitte", "fur mich", "mach das", "mach es", "erledige",
    // Portuguese
    "pode ", "podes", "poderia", "voce pode", "faz isso", "faca isso", "para mim",
    // Italian
    "puoi", "potresti", "per favore", "fallo", "per me",
    // Dutch
    "kun je", "kunt u", "kan je", "zou je", "alsjeblieft", "alstublieft", "voor mij", "doe het",
  ]
    .map((phrase) => `(?:^|[^\\p{L}])${phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}(?=$|[^\\p{L}])`)
    .join("|"),
  "u",
);
/** Japanese and Chinese, which are written without spaces between words. */
const DO_IT_SCRIPT = /ください|してくれ|やって|お願い|帮我|替我|请你|請你|你能|你可以|能不能/;

export class Ui {
  readonly host: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly cursor: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly captionText: HTMLElement;
  private readonly dock: HTMLElement;
  /** The side the site put the launcher on. It moves to the other side only while it would cover what is pointed at. */
  private readonly side: "left" | "right";
  /** The control the guide pointed at. */
  private pointed?: Element;
  /** What the pointer is on: the control, or the part of it that takes a click. */
  private target?: Element;
  /** Whether `target` has been chosen with the control on screen, where what lies at its middle can be seen. */
  private aimed = false;
  /** Where in the target's box the tip went, for the box it was found for, so the page is looked at only when the box moves. */
  private tip?: { box: string; dx: number; dy: number };
  /** The caption is above the control rather than below it, because something opened where it was. */
  private captionAbove = false;
  /** What lay under the caption once it was placed, and whether the caption has moved for this control yet. */
  private under?: { el: Element | null; moved: boolean };
  private looked = 0;
  /**
   * Something on the page that took the keyboard from the ask box the moment
   * it had it: a menu or a list that keeps the keyboard to itself and is not
   * a dialog. While it is open the widget sits inside it, as it does in a dialog.
   */
  private captor?: Element;
  private frame = 0;
  /** What each of our buttons does, by its class. */
  private buttons!: Record<"launcher" | "send" | "stop" | "close" | "doit" | "go" | "resume", () => void>;
  private readonly first: HTMLElement;
  private readonly note: HTMLElement;
  private readonly did: HTMLElement;
  /** Set when the site has acting on and the page allows it: the Do it button shows. */
  private readonly acting?: UiActing;
  /** Haptic is acting: the keyboard moving into the page is its own doing, not a menu taking it. */
  private actingNow = false;
  /** What a click on a line of "What I did" does. */
  private onLine?: (index: number) => void;
  /** A point the pointer was sent to by `glideTo`, held until it is sent to a control again. */
  private held?: { x: number; y: number };
  /** The caption is on show with nothing to point at (`say`). */
  private saying = false;
  /** The timer that keeps our element placed, while it is in use. */
  private placing?: ReturnType<typeof setInterval>;
  /** Watches what our element is inside, when that is something of the page's. */
  private homeWatch?: MutationObserver;
  /** When the ask box last lost the keyboard to nothing: our element was moved, or taken away with what it was in. */
  private lostAt = -Infinity;
  /** Where the pointer last was, so each move starts from there. */
  private at: { x: number; y: number };

  constructor(appearance: Appearance, handlers: UiHandlers, acting?: UiActing) {
    this.host = document.createElement("haptic-root");
    this.host.style.setProperty("--accent", appearance.accent);
    const root = this.host.attachShadow({ mode: "open" });
    const side = appearance.position === "bottom-left" ? "left" : "right";
    // Built from elements and a stylesheet object, never from text: a page whose
    // policy forbids inline style, or requires Trusted Types, refuses a <style>
    // element and markup set as a string, and would leave the widget unstyled or not there at all.
    adoptStyles(root, CSS);
    const hidden = { hidden: "" };
    root.append(
      make("div", { class: "ring", ...hidden }),
      make("div", { class: "caption", ...hidden }, make("span"), make("button", { class: "close", "aria-label": "Stop guide" }, icon(CROSS_PATH, { "aria-hidden": "true" }))),
      make("div", { class: "cursor", ...hidden }, icon(POINTER_PATH, { width: "24", height: "24" })),
      make(
        "div",
        { class: `dock ${side}` },
        make(
          "div",
          { class: "panel", ...hidden },
          make(
            "form",
            {},
            make("input", { type: "text", placeholder: "What do you want to do?", "aria-label": "Ask a question", maxlength: "300" }),
            make(
              "div",
              { class: "row" },
              make("button", { class: "doit", type: "button", title: "Do it with me (Ctrl+Enter)" }, "Do it"),
              make("button", { class: "send", type: "button", "aria-label": "Send" }, icon(ARROW_PATH, { "aria-hidden": "true" })),
            ),
          ),
          make("div", { class: "first", ...hidden }, make("span"), make("button", { class: "go", type: "button" }, "Go")),
          make("div", { class: "status", ...hidden }, make("span"), make("button", { class: "resume", type: "button" }, "Carry on"), make("button", { class: "stop", type: "button" }, "Stop")),
          make("div", { class: "note", ...hidden }),
          make("div", { class: "did", ...hidden }, make("h2"), make("ul"), make("p")),
        ),
        make("button", { class: "launcher", type: "button" }, icon(POINTER_PATH, { "aria-hidden": "true" }), make("span")),
      ),
    );
    const pick = <T extends Element>(selector: string) => root.querySelector(selector) as T;
    this.panel = pick(".panel");
    this.form = pick("form");
    this.input = pick("input");
    this.status = pick(".status");
    this.statusText = pick(".status span");
    this.ring = pick(".ring");
    this.cursor = pick(".cursor");
    this.caption = pick(".caption");
    this.captionText = pick(".caption span");
    this.dock = pick(".dock");
    this.first = pick(".first");
    this.note = pick(".note");
    this.did = pick(".did");
    this.side = side;
    this.acting = acting;
    pick(".first span").textContent = ACTING_WORDS.first;
    pick(".did h2").textContent = ACTING_WORDS.did;
    if (acting) {
      this.showActs();
      // Enter shows the way; Do it is beside it.
      pick(".send").setAttribute("aria-label", "Show me");
      pick(".send").setAttribute("title", "Show me (Enter)");
    }
    pick(".launcher span").textContent = appearance.launcherLabel;
    this.at = { x: side === "left" ? 60 : window.innerWidth - 60, y: window.innerHeight - 40 };

    // What each of our buttons does. A press on one is acted on in keepPressesOurs.
    this.buttons = {
      launcher: () => {
        this.panel.hidden = !this.panel.hidden;
        this.showActs();
        this.keepPlaced();
        // Nothing kept our element in place while it was not in use. A dialog may have opened since.
        this.place();
        if (!this.panel.hidden) this.input.focus();
      },
      send: () => this.form.requestSubmit(),
      stop: handlers.onStop,
      close: handlers.onStop,
      doit: () => this.doIt(handlers),
      go: () => {
        const question = this.input.value.trim();
        this.first.hidden = true;
        remember(this.acting);
        if (question) handlers.onAsk(question, true);
      },
      resume: () => handlers.onCarryOn?.(),
    };
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const question = this.input.value.trim();
      this.first.hidden = true;
      if (question) handlers.onAsk(question, false);
    });
    // Ctrl or Cmd and Enter is Do it. The visitor's own words only colour the button.
    this.input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || !this.panel.classList.contains("acts")) return;
      event.preventDefault();
      this.doIt(handlers);
    });
    this.input.addEventListener("input", () => {
      this.panel.classList.toggle("nudged", !!this.acting && asksToDo(this.input.value));
      this.first.hidden = true;
    });

    // Typing in the ask box mustn't trigger the page's keyboard shortcuts or
    // focus traps. Escape is the page's, though, unless it is closing our own
    // ask box: an open menu or dialog closes on it.
    for (const type of ["keydown", "keyup", "keypress", "focusin"]) {
      this.host.addEventListener(type, (event) => {
        if ((event as KeyboardEvent).key === "Escape") {
          const fromPanel = this.panel.contains(event.composedPath()[0] as Node);
          if (!fromPanel || (type === "keydown" && this.panel.hidden)) return;
          if (type === "keydown") {
            this.panel.hidden = true;
            this.keepPlaced();
          }
        }
        event.stopPropagation();
      });
    }
    this.keepPressesOurs();
    this.watchKeyboard();
    this.host.setAttribute("popover", "manual");
    // The one thing of ours that listens on the page while nothing is in use: see `onToggle`.
    document.addEventListener("toggle", this.onToggle, true);
    this.setState("idle");
    this.place();
  }

  /**
   * A popover or a dialog the page opens goes into the top layer above our
   * element, and would cover the launcher: a UI5 dialog with the layer it
   * puts over the page, or the browser's own modal <dialog>, which also makes
   * everything outside it inert. The browser says so with a "toggle" event on
   * the element, when it opens and when it closes, and this is heard in the
   * capture phase, since the event does not bubble. It is the only listener of
   * ours left on the page while no guide runs, and it does nothing but place
   * our element again. Our own showing and hiding, and a <details> opening,
   * which is not in the top layer, are not its business.
   */
  private onToggle = (event: Event) => {
    try {
      const toggled = event.target;
      if (!(toggled instanceof Element) || toggled === this.host || this.host.contains(toggled) || !toggled.matches("[popover], dialog")) return;
      this.place(true);
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  };

  /**
   * Keeps our element placed while the visitor is using it: while the ask box
   * is open, and while a guide runs. Nothing of ours runs on a page where
   * neither is the case, so the timer stops then.
   */
  private keepPlaced() {
    this.placeSaid();
    const inUse = this.inUse();
    if (inUse && this.placing === undefined) this.placing = setInterval(this.place, 500);
    else if (!inUse && this.placing !== undefined) {
      clearInterval(this.placing);
      this.placing = undefined;
      // Back to its own place, out of anything of the page's that could be taken away with it while nothing watches.
      this.place();
    }
  }

  /** The visitor is using the widget: the ask box is open, or a guide runs. */
  private inUse(): boolean {
    return !this.panel.hidden || this.state === "asking" || this.state === "pointing" || this.state === "watching" || this.state === "acting" || this.state === "paused";
  }

  /**
   * Keeps our element on top and usable. A dialog that shuts out the rest of
   * the page does so in one of two ways: the browser's own modal <dialog>
   * makes the rest of the page inert, and the ones apps build pull the
   * keyboard back whenever it leaves them. So while the widget is in use and
   * such a dialog is open, or something has pulled the keyboard from the ask
   * box, we move inside it, where a visitor can still type a question, and
   * move back out when it closes. A box that shuts nothing out, like a
   * calendar drawn as a dialog over part of the page, is left alone. And
   * something the page shows in the top layer after us is not left on top of
   * us.
   */
  place = (raise?: boolean) => {
    if (this.captor && !shown(this.captor)) this.captor = undefined;
    // Not in use, our element goes inside nothing of the page's but the browser's own modal dialog, outside which it would
    // be inert: the toggle listener hears that dialog close, and nothing else could be heard taking our element away with it.
    let home = (this.inUse() ? (this.captor ?? blockingDialog(this.host)) : topModal()) || document.documentElement;
    if (this.host.parentNode === home) this.raise(raise === true);
    else {
      // Moving takes the keyboard from whatever of ours had it, so it is given back. So does the page taking away what we were in.
      const focused = (this.host.shadowRoot?.activeElement as HTMLElement | null) ?? (performance.now() - this.lostAt < 100 ? this.input : null);
      home.appendChild(this.host);
      this.show();
      if (home !== document.documentElement && !this.host.getClientRects().length) {
        // Not drawn there: an element of a toolkit that shows only its own parts, not what is put inside it.
        this.captor = undefined;
        home = document.documentElement;
        home.appendChild(this.host);
        this.show();
      }
      focused?.focus();
    }
    // While nothing is in use, nothing watches.
    this.watchHome(this.inUse() ? home : document.documentElement);
  };

  private show() {
    try {
      // Being a popover puts us in the top layer too, above anything the page stacks with z-index.
      this.host.showPopover();
    } catch {
      // No popover support, or shown already. The fixed position and z-index still apply.
    }
  }

  /**
   * Shows our element again if something the page put in the top layer after
   * it lies on the launcher: a dialog drawn as a popover with a layer that
   * blocks the page behind it. Shown again, ours is the latest, and on top.
   * While nothing is in use this is done only when the page has just opened
   * something (`always`), never on a timer.
   */
  private raise(always = false) {
    const launcher = this.dock.querySelector(".launcher");
    if ((!this.inUse() && !always) || !this.host.isConnected || !launcher) return;
    const box = launcher.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    if (!(x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight)) return;
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit === this.host) return;
    const focused = this.host.shadowRoot?.activeElement as HTMLElement | null;
    try {
      this.host.hidePopover();
    } catch {
      return;
    }
    this.show();
    focused?.focus();
  }

  /**
   * While our element is inside something of the page's, watches that
   * something and everything around it: the page can take it away, or hide
   * it, at any moment, and would take a half-typed question with it. Our
   * element is put back at once, before the next key arrives.
   */
  private watchHome(home: Element) {
    this.homeWatch?.disconnect();
    this.homeWatch = undefined;
    if (home === document.documentElement) return;
    this.homeWatch = new MutationObserver(() => {
      const at = this.host.parentElement;
      if (!this.host.isConnected || !at || !shown(at)) this.place();
    });
    for (let at: Element | null = home; at; at = at.parentElement) {
      this.homeWatch.observe(at, { childList: true, attributes: true, attributeFilter: ["hidden", "style", "class", "open", "popover"] });
    }
  }

  /**
   * A press on anything of ours is not a press outside the page's open list,
   * menu or calendar, and must not close it. Pages hear such a press on the
   * document or the window, as the mouse goes down or as a click, and often
   * in the capture phase, which runs before anything here can stop it.
   *
   * So the press is cancelled: the browser then fires none of the mouse
   * events that follow it. A press on one of our buttons also puts a fresh
   * copy of the button in its place: the browser fires no click for a press
   * whose element has left the page, so the button is acted on here, when the
   * press ends on it. A click that comes without a press, from the keyboard or
   * from assistive technology, is acted on as usual.
   *
   * A cancelled press puts the keyboard nowhere, so a press into the ask box
   * gives the box the keyboard here. Once the box has it, a press in it is left
   * alone, for placing the cursor and selecting. Everything a press sends is
   * stopped at our element, out of reach of the page's listeners that come
   * after it.
   */
  private keepPressesOurs() {
    const root = this.host.shadowRoot!;
    const buttonOf = (event: Event) => event.composedPath().find((node): node is HTMLButtonElement => node instanceof HTMLButtonElement);
    const act = (button: HTMLButtonElement) => {
      if (button.classList.contains("line")) return this.onLine?.(Number(button.dataset.index));
      const name = (["launcher", "send", "stop", "close", "doit", "go", "resume"] as const).find((name) => button.classList.contains(name));
      if (name) this.buttons[name]();
    };
    let pressed: HTMLButtonElement | undefined;
    let actedAt = -Infinity;
    this.host.addEventListener("pointerdown", (event) => {
      pressed = undefined;
      const into = event.composedPath()[0];
      if (into === this.input && root.activeElement === this.input) return;
      event.preventDefault();
      if (into === this.input) this.input.focus();
      const button = buttonOf(event);
      if (!button || event.button !== 0) return;
      const copy = button.cloneNode(true) as HTMLButtonElement;
      button.replaceWith(copy);
      pressed = copy;
    });
    this.host.addEventListener("pointerup", (event) => {
      const was = pressed;
      pressed = undefined;
      if (!was || buttonOf(event) !== was) return;
      actedAt = performance.now();
      act(was);
    });
    this.host.addEventListener("pointercancel", () => (pressed = undefined));
    root.addEventListener("click", (event) => {
      const button = buttonOf(event);
      // A browser that fires the click all the same has had it acted on already.
      if (button && performance.now() - actedAt > 500) act(button);
    });
    for (const type of ["pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "touchstart", "touchend", "focusout"]) {
      this.host.addEventListener(type, (event) => event.stopPropagation());
    }
  }

  /**
   * Notices the page pulling the keyboard out of the ask box the moment the
   * visitor put it there, which is what a menu that keeps the keyboard to
   * itself does, or while they are typing in it, which is what a submenu
   * does that opens a moment after the mouse crossed its entry. The widget
   * moves into whatever took the keyboard and takes it back. A visitor who
   * moves the keyboard themselves, by clicking what took it or with Tab, is
   * left alone. Nothing is listened to outside our own element.
   */
  private watchKeyboard() {
    let wanted = 0;
    let tabbed = 0;
    let typed = -Infinity;
    this.host.addEventListener("pointerdown", () => (wanted = performance.now()));
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Tab") tabbed = performance.now();
      else typed = performance.now();
    });
    this.input.addEventListener("blur", (event) => {
      if (!event.relatedTarget) this.lostAt = performance.now();
    });
    this.input.addEventListener("focusout", (event) => {
      // While Haptic acts it moves the keyboard into the page itself.
      if (this.actingNow) return;
      const to = event.relatedTarget;
      const now = performance.now();
      if (!(to instanceof Element) || to === this.captor || to.contains(this.host) || (now - wanted > 500 && now - typed > 1500) || now - tabbed < 500) return;
      // What the visitor clicked has the mouse over it. A list that takes the keyboard back does not.
      if (to.matches(":hover")) return;
      // A field or a button holds nothing drawn: the widget goes beside it.
      this.captor = to.matches("input, textarea, select, button, img, iframe, object, embed, video, audio, canvas") ? (to.parentElement ?? to) : to;
      this.place();
      this.input.focus();
    });
  }

  /** Show the ask box busy with a message, or back to the input when `text` is empty. `paused` adds Carry on beside Stop. */
  setBusy(text: string, paused = false) {
    this.form.hidden = text !== "";
    this.status.hidden = text === "";
    this.statusText.textContent = text;
    this.status.classList.toggle("paused", paused && text !== "");
    this.first.hidden = true;
    if (text) this.panel.hidden = false;
    else {
      this.input.value = "";
      this.panel.classList.remove("nudged");
      this.setNote("");
      this.showActs();
    }
    this.keepPlaced();
  }

  /** A line under the status, in the widget's own words. */
  setNote(text: string) {
    this.note.textContent = text;
    this.note.hidden = text === "";
  }

  /**
   * Haptic is acting, or has stopped. While it acts the panel stays open with
   * Stop, and the keyboard moving into the page is not taken for the page
   * taking it from the ask box.
   */
  setActing(on: boolean) {
    this.actingNow = on;
    if (on) this.panel.hidden = false;
    this.keepPlaced();
  }

  /** Do it shows when the site has acting on and allows it on this page. Looked at whenever the ask box comes back. */
  private showActs() {
    let allowed = false;
    try {
      allowed = !!this.acting && this.acting.allowedHere();
    } catch {
      allowed = false;
    }
    this.panel.classList.toggle("acts", allowed);
  }

  /** The pointer's ring breathes slowly: it is the visitor's turn. */
  yourTurn(on: boolean) {
    this.ring.classList.toggle("turn", on);
  }

  /**
   * "What I did", in the panel: one line per field Haptic set, written from
   * what it did, and a closing line. A click on a line calls `onLine` with
   * its index. Nothing here is read from the page. An empty list hides it.
   */
  showDid(lines: DidShown[], closing: string, onLine?: (index: number) => void) {
    const list = this.did.querySelector("ul")!;
    list.replaceChildren();
    this.onLine = onLine;
    for (const [index, line] of lines.entries()) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "line";
      button.dataset.index = String(index);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = line.name;
      const value = document.createElement("span");
      value.className = "value";
      value.textContent = line.value ?? "";
      button.append(name, value);
      const aside = line.partly ? ACTING_WORDS.partly : line.mine ? ACTING_WORDS.mine : "";
      if (aside) {
        const note = document.createElement("span");
        note.className = "mine";
        note.textContent = aside;
        button.append(note);
      }
      item.append(button);
      list.append(item);
    }
    this.did.querySelector("p")!.textContent = closing;
    this.did.hidden = lines.length === 0 && closing === "";
    if (!this.did.hidden) this.panel.hidden = false;
    this.keepPlaced();
  }

  hideDid() {
    this.did.hidden = true;
    this.onLine = undefined;
    this.placeSaid();
  }

  /**
   * Draws a press: an accent ring that grows from the point and fades in a
   * quarter of a second. Nothing under reduced motion.
   */
  ripple(x: number, y: number) {
    if (lessMotion()) return;
    const ring = document.createElement("div");
    ring.className = "ripple";
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    this.host.shadowRoot!.append(ring);
    setTimeout(() => ring.remove(), 300);
  }

  /**
   * Glides the pointer to a point of the page, where Haptic is about to press,
   * and resolves once it is there: at once under reduced motion. The ring
   * stays on the control; the pointer stays at the point until it is sent to
   * a control again.
   */
  glideTo(x: number, y: number): Promise<void> {
    const far = Math.hypot(x - this.at.x, y - this.at.y);
    this.held = { x, y };
    this.at = { x, y };
    this.cursor.hidden = false;
    this.cursor.style.transform = `translate(${x - POINTER_TIP.x}px, ${y - POINTER_TIP.y}px)`;
    if (lessMotion() || far < 2) return Promise.resolve();
    // The glide's own length, a little less for a short way.
    return new Promise((resolve) => setTimeout(resolve, far < 80 ? 250 : GLIDE_MS));
  }

  /** Between two of Haptic's steps: the caption and the ring go, and the pointer rests where it is, so the next glide starts there. */
  rest() {
    this.pointed = undefined;
    this.target = undefined;
    this.tip = undefined;
    this.under = undefined;
    this.mark(undefined);
    cancelAnimationFrame(this.frame);
    this.ring.hidden = true;
    this.caption.hidden = true;
  }

  /**
   * Do it: the question goes with acting asked for. The first time on a site,
   * unless the site turned it off, a line says what will happen, and Go
   * starts it.
   */
  private doIt(handlers: UiHandlers) {
    const question = this.input.value.trim();
    if (!this.acting || !this.panel.classList.contains("acts")) return;
    if (!question) return this.input.focus();
    if (this.acting.confirmFirst && !remembered(this.acting)) {
      this.first.hidden = false;
      this.keepPlaced();
      return;
    }
    handlers.onAsk(question, true);
  }

  closePanel() {
    this.panel.hidden = true;
    this.keepPlaced();
  }

  /** Move the pointer to an element and show the caption beside it. With no text yet, the pointer goes alone. */
  pointAt(el: Element, text: string) {
    this.saying = false;
    if (el !== this.pointed) {
      this.pointed = el;
      this.held = undefined;
      this.tip = undefined;
      this.captionAbove = false;
      this.under = undefined;
      this.aim(el);
    }
    this.captionText.textContent = text;
    this.caption.hidden = text === "";
    this.cursor.hidden = false;
    // Paint once at the old spot so the transition has somewhere to start from.
    this.cursor.style.transform = `translate(${this.at.x - POINTER_TIP.x}px, ${this.at.y - POINTER_TIP.y}px)`;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.track);
  }

  /** Show text with nothing to point at, above the launcher. */
  say(text: string) {
    this.clearPointer();
    this.captionText.textContent = text;
    this.caption.hidden = false;
    this.saying = true;
    this.placeSaid();
  }

  /** Places a caption with nothing to point at above the launcher, and above the panel when it is open. */
  private placeSaid() {
    if (!this.saying || this.caption.hidden) return;
    const box = this.caption.getBoundingClientRect();
    const dock = this.dock.getBoundingClientRect();
    const left = this.host.shadowRoot?.querySelector(".dock.left") ? 20 : window.innerWidth - box.width - 20;
    this.caption.style.left = `${Math.max(12, left)}px`;
    this.caption.style.top = `${Math.max(12, Math.min(window.innerHeight - box.height - 76, dock.top - box.height - 16))}px`;
  }

  clearPointer() {
    this.saying = false;
    this.pointed = undefined;
    this.held = undefined;
    this.target = undefined;
    this.tip = undefined;
    this.under = undefined;
    this.captionAbove = false;
    this.dockOn(this.side);
    this.mark(undefined);
    cancelAnimationFrame(this.frame);
    this.ring.hidden = true;
    this.cursor.hidden = true;
  }

  clear() {
    this.clearPointer();
    this.caption.hidden = true;
  }

  /** Where the guide is. Kept as a property of our own element, beside `pointedAt`, and nowhere on the customer's page. */
  get state(): GuideState {
    return (this.host as HTMLElement & { guideState?: GuideState }).guideState ?? "idle";
  }

  setState(state: GuideState) {
    (this.host as HTMLElement & { guideState?: GuideState }).guideState = state;
    this.keepPlaced();
  }

  /**
   * Keeps the control the pointer is on readable from outside, as a property
   * of our own element. Nothing on the customer's page is touched. Tests and
   * the benchmark use it to act on what a visitor is being shown.
   */
  private mark(el: Element | undefined) {
    (this.host as HTMLElement & { pointedAt?: Element }).pointedAt = el;
  }

  /** Chooses what the pointer goes on for the control `el`, and says so in `pointedAt`. */
  private aim(el: Element) {
    const rect = el.getBoundingClientRect();
    this.aimed = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    this.target = partToClick(el, this.aimed);
    this.mark(this.target);
  }

  /** Follows the target every frame, so scrolling and layout shifts don't strand the pointer. */
  private track = () => {
    const el = this.target;
    if (!el) return;
    this.frame = requestAnimationFrame(this.track);
    try {
      this.follow(el);
    } catch (error) {
      // Something about the page we did not expect. The pointer stays where it was, and nothing is thrown into the page.
      console.warn("[Haptic]", error);
    }
  };

  private follow(el: Element) {
    if (!el.isConnected) {
      this.ring.hidden = true;
      return;
    }
    let rect = el.getBoundingClientRect();
    const onScreen = rect.bottom > 0 && rect.top < window.innerHeight && rect.width + rect.height > 0;
    this.ring.hidden = !onScreen;
    if (!onScreen) return;
    // A control pointed at while it was scrolled out of view is looked at again once it is in view.
    if (!this.aimed && this.pointed) {
      this.aim(this.pointed);
      if (this.target !== el) return;
      rect = el.getBoundingClientRect();
    }

    const pad = 4;
    this.ring.style.left = `${rect.left - pad}px`;
    this.ring.style.top = `${rect.top - pad}px`;
    this.ring.style.width = `${rect.width + pad * 2}px`;
    this.ring.style.height = `${rect.height + pad * 2}px`;

    this.at = this.held ?? this.tipOn(el, rect);
    this.cursor.style.transform = `translate(${this.at.x - POINTER_TIP.x}px, ${this.at.y - POINTER_TIP.y}px)`;

    // The caption goes below the control, or above it when there is no room below or when something opened below.
    const box = this.caption.getBoundingClientRect();
    const fitsBelow = rect.bottom + 14 + box.height < window.innerHeight;
    const fitsAbove = rect.top - box.height - 12 >= 8;
    const above = this.captionAbove ? fitsAbove || !fitsBelow : !fitsBelow;
    const top = above ? Math.max(8, rect.top - box.height - 12) : rect.bottom + 14;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - box.width - 8);
    this.caption.style.left = `${left}px`;
    this.caption.style.top = `${top}px`;

    const now = performance.now();
    if (now - this.looked < 200) return;
    this.looked = now;
    const caption = this.caption.hidden ? undefined : { left, top, right: left + box.width, bottom: top + box.height };
    this.keepLauncherOff(rect, caption);
    if (caption) this.keepCaptionOff(el, caption);
  }

  /**
   * Where the tip goes: in the control's lower right corner, so the pointer
   * hangs off it and never covers its label. Something else can lie on that
   * corner, like a panel's resize handle, so the tip moves in until it is on
   * the control itself.
   */
  private tipOn(el: Element, rect: DOMRect): { x: number; y: number } {
    const box = `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`;
    if (this.tip?.box !== box) {
      const right = rect.width - Math.min(10, rect.width * 0.2);
      const spots = [
        [right, rect.height - Math.min(7, rect.height * 0.25)],
        [right, rect.height / 2],
        [rect.width / 2, rect.height / 2],
      ] as const;
      const [dx, dy] = spots.find(([x, y]) => onIt(el, rect.left + x, rect.top + y)) ?? spots[2];
      this.tip = { box, dx, dy };
    }
    return { x: rect.left + this.tip.dx, y: rect.top + this.tip.dy };
  }

  /**
   * Keeps the caption off what the control opens. A list, a menu or a
   * calendar opens beside the control, usually right where the caption is. If
   * something new comes up under the caption, it moves to the other side, once.
   */
  private keepCaptionOff(el: Element, caption: { left: number; top: number; right: number; bottom: number }) {
    const x = (caption.left + caption.right) / 2;
    const y = (caption.top + caption.bottom) / 2;
    const hit = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight ? document.elementFromPoint(x, y) : null;
    const now = hit && hit !== this.host ? hit : null;
    if (!this.under) {
      this.under = { el: now, moved: false };
      return;
    }
    const was = this.under.el;
    if (this.under.moved || !now || now === was || now.contains(el) || el.contains(now) || (was && now.contains(was))) return;
    // Inside what was there before, only a box drawn over it is new. Text that scrolls under the caption is not.
    if (was?.contains(now) && !drawnOver(now, was)) return;
    this.captionAbove = !this.captionAbove;
    this.under = { el: null, moved: true };
  }

  /** Keeps the launcher off the control being pointed at and off its caption, by moving it to the other corner while it would cover them. */
  private keepLauncherOff(rect: DOMRect, caption?: { left: number; top: number; right: number; bottom: number }) {
    const box = this.dock.getBoundingClientRect();
    const at = (side: "left" | "right") => {
      const left = side === "left" ? 20 : window.innerWidth - 20 - box.width;
      return { left, right: left + box.width, top: box.top, bottom: box.bottom };
    };
    const covers = (side: "left" | "right") => overlaps(at(side), rect, 8) || (!!caption && overlaps(at(side), caption, 4));
    const other = this.side === "left" ? "right" : "left";
    this.dockOn(covers(this.side) && !covers(other) ? other : this.side);
  }

  private dockOn(side: "left" | "right") {
    if (this.dock.classList.contains(side)) return;
    this.dock.classList.remove("left", "right");
    this.dock.classList.add(side);
  }
}

/** The pointer's glide, as `.cursor`'s transition sets it. */
const GLIDE_MS = 550;

function lessMotion(): boolean {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Gives our shadow root its styles as a stylesheet object, which a page's
 * policy on inline style does not reach. A browser without stylesheet objects
 * gets a <style> element instead, which works wherever the page allows inline style.
 */
function adoptStyles(root: ShadowRoot, css: string) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
    return;
  } catch {
    // No stylesheet objects in this browser.
  }
  const style = document.createElement("style");
  style.textContent = css;
  root.append(style);
}

/** One of our elements, with its attributes and what goes in it. Text goes in as text, never as markup. */
function make<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  el.append(...children);
  return el;
}

/** One of our icons: a single path on a 24 by 24 grid. */
function icon(path: string, attributes: Record<string, string> = {}): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  svg.append(shape);
  return svg;
}

/** Where the visitor's "I've seen the first-use line" is kept: this browser only, for this site. */
const seenKey = (acting: UiActing) => `haptic.acting.seen.${acting.site}`;

/** Whether this visitor has pressed Go on this site before. Storage that fails counts as no: the line simply shows again. */
function remembered(acting: UiActing): boolean {
  try {
    return localStorage.getItem(seenKey(acting)) === "1";
  } catch {
    return false;
  }
}

function remember(acting: UiActing | undefined) {
  if (!acting) return;
  try {
    localStorage.setItem(seenKey(acting), "1");
  } catch {
    // Not kept. The line shows again next time.
  }
}

/** Whether an element is in the page and drawn. */
function shown(el: Element): boolean {
  if (!el.isConnected || !el.getClientRects().length) return false;
  return typeof el.checkVisibility !== "function" || el.checkVisibility({ visibilityProperty: true });
}

/** The browser's own modal dialog that is open on top, if any. Everything outside it is inert. */
function topModal(): Element | undefined {
  let found: Element | undefined;
  try {
    document.querySelectorAll("dialog:modal").forEach((el) => (found = el));
  } catch {
    // :modal unsupported. Then there is no such dialog to be in.
  }
  return found;
}

/**
 * The open dialog that shuts out the rest of the page, if there is one: the
 * browser's own modal dialog, a dialog that says it is modal, or one drawn
 * with a backdrop over the whole window. The innermost of several wins.
 */
function blockingDialog(ignore: Element): Element | undefined {
  let native: Element | undefined;
  try {
    document.querySelectorAll("dialog:modal").forEach((el) => (native = el));
  } catch {
    // :modal unsupported. ARIA modals below still work.
  }
  let found = native;
  document.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach((el) => {
    // Outside the browser's own modal dialog, everything is inert anyway.
    if (ignore.contains(el) || !shown(el) || (native && !native.contains(el))) return;
    if (el.getAttribute("aria-modal") === "true" || hasBackdrop(el, ignore)) found = el;
  });
  return found;
}

/** Whether a dialog is drawn over a backdrop that covers the window: what lies at its middle, if not the dialog, is a layer as big as the window, beside the dialog or pinned round it. */
function hasBackdrop(dialog: Element, ignore: Element): boolean {
  const top = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2).find((el) => !ignore.contains(el) && el !== ignore);
  if (!top || dialog.contains(top) || top === document.body || top === document.documentElement) return false;
  const cover = top.getBoundingClientRect();
  if (cover.width < window.innerWidth * 0.95 || cover.height < window.innerHeight * 0.95) return false;
  return !top.contains(dialog) || getComputedStyle(top).position === "fixed";
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Whether `el` sits in a box drawn over the page, inside `within`: a list, a menu, or anything positioned on its own. */
function drawnOver(el: Element, within: Element): boolean {
  for (let at: Element | null = el; at && at !== within; at = at.parentElement) {
    if (at.matches('[role="listbox"], [role="menu"], [role="tree"], [role="grid"], [role="dialog"], [role="tooltip"], [popover]')) return true;
    const position = getComputedStyle(at).position;
    if (position === "absolute" || position === "fixed") return true;
  }
  return false;
}

function overlaps(a: Box, b: Box, margin: number): boolean {
  return a.left < b.right + margin && a.right > b.left - margin && a.top < b.bottom + margin && a.bottom > b.top - margin;
}

/** Whether a click at this point would land on `el`. A point off the screen cannot be tested and counts. */
function onIt(el: Element, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return true;
  const hit = document.elementFromPoint(x, y);
  if (!hit || el.contains(hit)) return true;
  // A control inside a shadow root is hit as the element that hosts it.
  for (let at: Node | null = el; at; at = at.parentNode ?? (at as ShadowRoot).host ?? null) if (at === hit) return true;
  return false;
}

const FRAMES = "iframe, frame, object, embed";

/**
 * The part of a control the pointer should go on. Usually the control
 * itself. Two kinds are not:
 * - A field drawn as a speck under its label, as styled tick boxes and some
 *   pickers are. The label is what shows and what takes the click, and
 *   pointing at the speck would cover the row instead. A see-through field
 *   of full size, like a select's input under the words of its value, is
 *   where the visitor clicks, and stays the target.
 * - A large box whose middle is a frame. A click there goes into the frame,
 *   and the page never hears it. What names the box, or its first part that
 *   is not a frame, takes the click instead. This needs the box on screen,
 *   where what lies at its middle can be seen: `canLook`.
 */
function partToClick(el: Element, canLook: boolean): Element {
  const rect = el.getBoundingClientRect();
  const typed = takesText(el);
  if (rect.width < 4 || rect.height < 4 || (typed && rect.width < 8)) {
    // Clicking the label of a field that is typed into only puts the cursor in
    // it. Its list, if it has one, opens on a press on the box it is drawn in.
    const part = (typed ? frameOf(el) : undefined) ?? shownLabelOf(el);
    if (part) return part;
  }
  if (!canLook || rect.width < 120 || rect.height < 80 || el.matches(FRAMES)) return el;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const middle = document.elementFromPoint(Math.min(x, window.innerWidth - 1), Math.min(Math.max(y, 0), window.innerHeight - 1));
  if (!middle?.matches(FRAMES) || !el.contains(middle)) return el;
  const named = (el.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => (id ? document.getElementById(id) : null))
    .find((part): part is HTMLElement => !!part && el.contains(part) && hasBox(part));
  if (named) return named;
  return Array.from(el.children).find((part) => !part.matches(FRAMES) && !part.contains(middle) && hasBox(part)) ?? el;
}

function hasBox(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width >= 8 && rect.height >= 8;
}

/** A field text is typed into, or a combobox: clicking its label puts the cursor in it and does nothing more. */
function takesText(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color", "hidden"].includes(el.type);
  return el.matches('[role="combobox"], [role="searchbox"], [role="textbox"], [contenteditable]:not([contenteditable="false"])');
}

/**
 * The box a field is drawn in, when the field itself is a speck inside it: a
 * search input between the chips of a multiple select is a few pixels wide,
 * and the box round the chips is what a visitor sees and presses. It is the
 * nearest box around the field with a border, a shadow or a background of its
 * own, holding no other field and not the field's label.
 */
function frameOf(el: Element): Element | undefined {
  const labels = [...Array.from((el as HTMLInputElement).labels ?? []), ...(el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => (id ? document.getElementById(id) : null))].filter(
    (label): label is HTMLElement => !!label,
  );
  let around = el.parentElement;
  for (let depth = 0; around && around !== document.body && depth < 5; depth++, around = around.parentElement) {
    const box = around;
    if (labels.some((label) => box.contains(label))) return undefined;
    if (Array.from(box.querySelectorAll('input:not([type="hidden"]), select, textarea')).some((field) => field !== el)) return undefined;
    const rect = box.getBoundingClientRect();
    if (rect.width * rect.height >= 60_000) return undefined;
    if (hasBox(box) && drawsBox(box)) return box;
  }
  return undefined;
}

/** Whether an element draws a box of its own: a border, a shadow, or a background that can be seen. */
function drawsBox(el: Element): boolean {
  const style = getComputedStyle(el);
  const seen = (color: string) => !/^(?:transparent|rgba\(.*,\s*0\))$/.test(color.trim());
  const border = ["top", "right", "bottom", "left"].some((side) => {
    const kind = style.getPropertyValue(`border-${side}-style`);
    return (parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0) > 0 && kind !== "none" && kind !== "hidden" && seen(style.getPropertyValue(`border-${side}-color`));
  });
  return border || style.boxShadow !== "none" || seen(style.backgroundColor);
}

/** The label a visitor sees for a field that is itself hidden or tiny: its own label, what names it, or a small box around it. */
function shownLabelOf(el: Element): Element | undefined {
  const labels = Array.from((el as HTMLInputElement).labels ?? []);
  const named = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => (id ? document.getElementById(id) : null));
  const found = [...labels, el.closest("label"), ...named].find((part): part is HTMLElement => !!part && hasBox(part));
  if (found) return found;
  let around = el.parentElement;
  for (let depth = 0; around && around !== document.body && depth < 3; depth++, around = around.parentElement) {
    const rect = around.getBoundingClientRect();
    if (hasBox(around) && rect.width * rect.height < 60_000) return around;
  }
  return undefined;
}
