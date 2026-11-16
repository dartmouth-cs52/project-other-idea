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
/** The pointer's glide in presentation mode: a little slower than usual, so the eye can follow it across a large screen. */
const PRESENT_GLIDE_MS = 800;
/** How many times larger the pointer is drawn in presentation mode. */
const PRESENT_SCALE = 2;
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
.did ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: fit-content(50%) minmax(0, 1fr); column-gap: 12px; }
.did li, .did .line { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); grid-template-columns: subgrid; }
.did .line { width: 100%; align-items: baseline; border: 0; border-radius: 8px; padding: 4px 8px; background: transparent; color: #1c1917;
  font-size: 13px; line-height: 18px; text-align: left; }
.did .line:hover { background: #f5f5f4; }
.did .name { color: #78716c; overflow-wrap: anywhere; }
.did .value { font-weight: 500; overflow-wrap: anywhere; }
.did .mine { grid-column: 2; color: #78716c; font-style: italic; }
.unseen { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
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
.helped { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 2px 8px 12px; }
.helped span { margin-right: auto; color: #78716c; }
.helped button { display: inline-flex; align-items: center; justify-content: center; height: 32px; border: 0; border-radius: 999px; padding: 0 14px;
  background: #e7e5e4; color: #1c1917; font-weight: 500; }
.helped button:hover { background: #d6d3d1; }
.about { margin: 0; padding: 8px 12px 4px; font-size: 12px; line-height: 16px; color: #78716c; }
.about a { color: inherit; text-decoration: none; }
.about a:hover, .about a:focus-visible { text-decoration: underline; text-underline-offset: 2px; }
.asked { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); max-width: min(760px, calc(100vw - 300px)); min-width: 0;
  background: #fff; color: #1c1917; border: 2px solid #1c1917; border-radius: 999px; padding: 8px 22px; font-size: 22px; line-height: 30px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 8px 24px rgba(0,0,0,.22); pointer-events: none; }
.asked.top { bottom: auto; top: 16px; }
@media (prefers-reduced-motion: reduce) { .cursor { transition: none; } .ring.turn { animation: none; } .ripple { display: none; } }
`;

// A visitor is told they are dealing with an AI before they ask it anything,
// which the EU's AI Act has required since August 2026. It is one line under
// the ask box, there whenever the ask box is. It is not a setting: a customer
// can change the launcher's word, and cannot take this away. The link goes to
// the page that says what Haptic reads and keeps.
const ABOUT_URL = "https://joinhaptic.com/privacy/";

/**
 * Presentation mode, for a demo on a projector or a shared screen, where the
 * audience sits far from the screen: a pointer twice the size, a caption in
 * large type and wider, a thick ring with a strong halo in an accent dark
 * enough to stand out, a slower glide, and the question kept on show. Only a
 * page that asks for it, with data-present on the script tag, gets it.
 */
const PRESENT_CSS = `
.cursor { width: 48px; height: 48px; transition-duration: ${PRESENT_GLIDE_MS / 1000}s;
  filter: drop-shadow(0 2px 2px rgba(0,0,0,.45)) drop-shadow(0 8px 14px rgba(0,0,0,.35)); }
.cursor svg { width: 48px; height: 48px; }
.cursor path { stroke-width: 2.5; }
.ring { border-width: 6px; border-radius: 14px;
  box-shadow: 0 0 0 3px #fff, 0 0 0 14px color-mix(in srgb, var(--accent) 40%, transparent), 0 0 32px 16px rgba(0,0,0,.2); }
.ring.turn { animation-name: breathe-present; }
@keyframes breathe-present { 50% { box-shadow: 0 0 0 3px #fff, 0 0 0 22px color-mix(in srgb, var(--accent) 24%, transparent), 0 0 32px 16px rgba(0,0,0,.2); } }
.ripple { width: 56px; height: 56px; margin: -28px 0 0 -28px; border-width: 5px; }
.caption { max-width: min(780px, calc(100vw - 32px)); gap: 14px; border-radius: 20px; padding: 14px 14px 14px 24px; font-size: 27px; line-height: 36px;
  box-shadow: 0 0 0 3px var(--accent), 0 14px 40px rgba(0,0,0,.4); }
.caption .close { width: 36px; height: 36px; }
.caption .close svg { width: 16px; height: 16px; }
.panel:has(.did:not([hidden])) { width: min(380px, calc(100vw - 40px)); }
.did h2 { font-size: 18px; line-height: 24px; }
.did .line { font-size: 17px; line-height: 24px; padding: 5px 8px; }
.did p { font-size: 15px; line-height: 21px; }
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
  private readonly helped: HTMLElement;
  private onHelped?: (helped: boolean) => void;
  private readonly dock: HTMLElement;
  /** The side the site put the launcher on. */
  private readonly side: "left" | "right";
  /**
   * Where the launcher sits: the site's corner, or the nearest place to it
   * that covers none of the page's own controls for good (see `findHome`).
   * `away` is the nearest such place on the other side, where it goes only
   * while it would cover what is pointed at.
   */
  private home: Spot;
  private away: Spot;
  /** A look for the launcher's place, waiting for the next frame after the window was resized. */
  private homeFrame = 0;
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
  /** What lay under the caption once it was placed, at each place looked at, and whether the caption has moved for this control yet. */
  private under?: { els: (Element | null)[]; moved: boolean };
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
  /** Presentation mode: switched on by the page, with data-present on the script tag. */
  private readonly present: boolean;
  /** Where the pointer's tip is in its own box, at the size it is drawn. */
  private readonly tipIn: { x: number; y: number };
  /** How long the pointer's glide takes, as its transition sets it. */
  private readonly glideMs: number;
  /** The visitor's question, kept on show in presentation mode while its guide runs. */
  private readonly asked: HTMLElement;
  private question = "";
  /** In presentation mode, places the caption has been moved off because something opened there. */
  private captionAvoid: Box[] = [];
  /** Where the pointed control was last seen, to know it again when the page draws it anew. */
  private pointedBox?: Box;

  constructor(appearance: Appearance, handlers: UiHandlers, acting?: UiActing, options: { present?: boolean } = {}) {
    this.present = options.present === true;
    this.tipIn = this.present ? { x: POINTER_TIP.x * PRESENT_SCALE, y: POINTER_TIP.y * PRESENT_SCALE } : POINTER_TIP;
    this.glideMs = this.present ? PRESENT_GLIDE_MS : GLIDE_MS;
    this.host = document.createElement("haptic-root");
    this.host.style.setProperty("--accent", this.present ? strongAccent(appearance.accent) : appearance.accent);
    const root = this.host.attachShadow({ mode: "open" });
    const side = appearance.position === "bottom-left" ? "left" : "right";
    // Built from elements and a stylesheet object, never from text: a page whose
    // policy forbids inline style, or requires Trusted Types, refuses a <style>
    // element and markup set as a string, and would leave the widget unstyled or not there at all.
    adoptStyles(root, this.present ? CSS + PRESENT_CSS : CSS);
    const hidden = { hidden: "" };
    root.append(
      make("div", { class: "ring", ...hidden }),
      make("div", { class: "caption", ...hidden }, make("span"), make("button", { class: "close", "aria-label": "Stop guide" }, icon(CROSS_PATH, { "aria-hidden": "true" }))),
      make("div", { class: "cursor", ...hidden }, icon(POINTER_PATH, { width: "24", height: "24" })),
      make("div", { class: "asked", ...hidden }),
      make(
        "div",
        { class: `dock ${side}` },
        make(
          "div",
          { class: "panel", ...hidden },
          make("div", { class: "helped", ...hidden }),
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
          make("p", { class: "about" }, "Haptic ", make("a", { href: ABOUT_URL, target: "_blank", rel: "noopener noreferrer" }, "is an AI guide and can be wrong.")),
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
    this.helped = pick(".helped");
    this.dock = pick(".dock");
    this.first = pick(".first");
    this.note = pick(".note");
    this.did = pick(".did");
    this.asked = pick(".asked");
    this.side = side;
    this.home = corner(side);
    this.away = corner(side === "left" ? "right" : "left");
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
    // What of ours listens on the page while nothing is in use: a dialog opening on the top layer (`onToggle`), and the
    // window changing size, which can bring a control of the page's into the launcher's corner (`onResize`).
    document.addEventListener("toggle", this.onToggle, true);
    window.addEventListener("resize", this.onResize, { passive: true });
    this.setState("idle");
    this.place();
    this.findHome();
    // A page still loading may put its own buttons in the corner yet. It is looked at once more when it has loaded.
    if (document.readyState !== "complete") window.addEventListener("load", this.onLoad);
  }

  /** The page has loaded: the one look at the launcher's corner that waited for it. Nothing stays listening. */
  private onLoad = () => {
    window.removeEventListener("load", this.onLoad);
    this.findHome();
  };

  /** The window was resized: the launcher's corner is looked at again, once, in the next frame. */
  private onResize = () => {
    if (this.homeFrame) return;
    this.homeFrame = requestAnimationFrame(() => {
      this.homeFrame = 0;
      this.findHome();
    });
  };

  /**
   * Finds where the launcher sits: in the site's own corner, unless a control
   * of the page's is there for good. A control is there for good when it
   * stays put as the page scrolls, like a chat button or a Feedback tab, or
   * when it is at the foot of the page, where no scrolling brings it out from
   * under the launcher. Then the launcher goes to the nearest place that is
   * free, up its side of the window or along the bottom, and to the other
   * side only when its own has no free place. Looked at when the widget
   * starts, when the page has loaded, when the window is resized, and when a
   * guide is put away: never on a timer, and never while the visitor is using
   * the widget, so it does not move under their hand.
   */
  findHome = () => {
    try {
      const launcher = this.dock.querySelector(".launcher")?.getBoundingClientRect();
      if (!launcher?.width || !launcher.height) return;
      const size = { w: launcher.width, h: launcher.height };
      const blocked = lastingControls(this.host, size);
      const other = this.side === "left" ? "right" : "left";
      const own = nearestFree(this.side, size, blocked);
      const theirs = nearestFree(other, size, blocked);
      this.home = own ?? theirs ?? corner(this.side);
      this.away = this.home.side === this.side ? (theirs ?? corner(other)) : (own ?? corner(this.side));
      if (this.inUse()) return;
      this.dockAt(this.home);
      if (this.cursor.hidden) {
        const box = this.dock.getBoundingClientRect();
        this.at = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
      }
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  };

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
      // The page may have put a control of its own in the launcher's corner while the widget was in use.
      this.findHome();
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
      if (button.dataset.helped) return this.answerHelped(button.dataset.helped === "yes");
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
    if (text) {
      this.panel.hidden = false;
      this.hideHelped();
    } else {
      this.input.value = "";
      this.panel.classList.remove("nudged");
      this.setNote("");
      this.showActs();
    }
    this.keepPlaced();
    // The ask box opening or closing changes what the question must keep off.
    this.showAsked();
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
   * Names and values sit in two columns, so each line reads as the field and
   * then what it holds. Between them is a colon no one sees, so the line
   * reads the same way to a screen reader and as text.
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
      button.append(name, unseen(/[?:]$/.test(line.name) ? " " : ": "), value);
      const aside = line.partly ? ACTING_WORDS.partly : line.mine ? ACTING_WORDS.mine : "";
      if (aside) {
        const note = document.createElement("span");
        note.className = "mine";
        note.textContent = aside;
        button.append(unseen(" ("), note, unseen(")"));
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
    this.cursor.style.transform = `translate(${x - this.tipIn.x}px, ${y - this.tipIn.y}px)`;
    if (lessMotion() || far < 2) return Promise.resolve();
    // The glide's own length, a little less for a short way.
    return new Promise((resolve) => setTimeout(resolve, far < 80 ? 250 : this.glideMs));
  }

  /** Between two of Haptic's steps: the caption and the ring go, and the pointer rests where it is, so the next glide starts there. */
  rest() {
    this.pointed = undefined;
    this.pointedBox = undefined;
    this.captionAvoid = [];
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
      // A control the page drew again, in the same place, is the same control: the caption stays off what it opened.
      const same = !!this.pointedBox && sameBox(this.pointedBox, el.getBoundingClientRect());
      this.pointed = el;
      this.held = undefined;
      this.tip = undefined;
      if (!same) {
        this.captionAbove = false;
        this.under = undefined;
        this.captionAvoid = [];
      }
      this.aim(el);
    }
    this.captionText.textContent = text;
    this.caption.hidden = text === "";
    this.cursor.hidden = false;
    // Paint once at the old spot so the transition has somewhere to start from.
    this.cursor.style.transform = `translate(${this.at.x - this.tipIn.x}px, ${this.at.y - this.tipIn.y}px)`;
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
    this.showAsked();
  }

  /**
   * Reopens the ask box with "Did this help?" above it. The caption keeps to
   * one sentence and no buttons, so the question lives in the panel.
   * `answer` is called once, if they tap Yes or No.
   */
  askIfHelped(answer: (helped: boolean) => void) {
    this.onHelped = answer;
    this.helped.replaceChildren(...this.helpedRow());
    this.helped.hidden = false;
    this.form.hidden = false;
    this.status.hidden = true;
    this.panel.hidden = false;
    this.showActs();
    this.keepPlaced();
    // The dock grew. A caption with no target sits above it, so it moves up too.
    this.placeSaid();
  }

  private helpedRow(): Node[] {
    const yes = make("button", { type: "button" }, "Yes");
    const no = make("button", { type: "button" }, "No");
    yes.dataset.helped = "yes";
    no.dataset.helped = "no";
    return [make("span", {}, "Did this help?"), yes, no];
  }

  /** Yes or No, pressed. Thanks takes the question's place for a moment, then the ask box is all that is left. */
  private answerHelped(helped: boolean) {
    if (!this.onHelped) return;
    this.onHelped(helped);
    this.onHelped = undefined;
    const thanks = make("span", {}, "Thanks.");
    this.helped.replaceChildren(thanks);
    setTimeout(() => this.helped.firstChild === thanks && this.hideHelped(), 1500);
  }

  private hideHelped() {
    this.helped.hidden = true;
    this.onHelped = undefined;
  }

  /** Places a caption with nothing to point at above the launcher, and above the panel when it is open. */
  private placeSaid() {
    if (!this.saying || this.caption.hidden) return;
    const box = this.caption.getBoundingClientRect();
    const dock = this.dock.getBoundingClientRect();
    const left = this.dock.classList.contains("left") ? dock.left : dock.right - box.width;
    this.caption.style.left = `${Math.max(12, left)}px`;
    this.caption.style.top = `${Math.max(12, Math.min(window.innerHeight - box.height - 76, dock.top - box.height - 16))}px`;
  }

  clearPointer() {
    this.saying = false;
    this.pointed = undefined;
    this.pointedBox = undefined;
    this.captionAvoid = [];
    this.held = undefined;
    this.target = undefined;
    this.tip = undefined;
    this.under = undefined;
    this.captionAbove = false;
    this.dockAt(this.home);
    this.mark(undefined);
    cancelAnimationFrame(this.frame);
    this.ring.hidden = true;
    this.cursor.hidden = true;
  }

  clear() {
    this.clearPointer();
    this.caption.hidden = true;
    this.showAsked();
  }

  /**
   * The visitor's question, for presentation mode, where it stays on show
   * while its guide runs and while its last sentence is up, so an audience
   * that came in late can read what was asked. Nothing is shown otherwise.
   */
  showQuestion(question: string) {
    this.question = question;
    this.asked.textContent = question ? `\u201c${question}\u201d` : "";
    this.showAsked();
  }

  /** Shows the question, or hides it, as the guide stands, and keeps it off what is pointed at and its caption. */
  private showAsked(avoid: Box[] = []) {
    const state = this.state;
    const running = state === "asking" || state === "pointing" || state === "watching" || state === "acting" || state === "paused";
    const show = this.present && this.question !== "" && (running || (state === "finished" && !this.caption.hidden));
    if (this.asked.hidden === show) this.asked.hidden = !show;
    if (!show) return;
    // At the foot of the window unless that covers what the visitor is shown, the launcher or the ask box. Then at the top.
    this.asked.classList.remove("top");
    const box = this.asked.getBoundingClientRect();
    const covered = [...avoid, this.dock.getBoundingClientRect(), ...(this.caption.hidden ? [] : [this.caption.getBoundingClientRect()])];
    if (covered.some((other) => overlaps(box, other, 8))) this.asked.classList.add("top");
  }

  /** Where the guide is. Kept as a property of our own element, beside `pointedAt`, and nowhere on the customer's page. */
  get state(): GuideState {
    return (this.host as HTMLElement & { guideState?: GuideState }).guideState ?? "idle";
  }

  setState(state: GuideState) {
    (this.host as HTMLElement & { guideState?: GuideState }).guideState = state;
    this.keepPlaced();
    this.showAsked();
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

    // In presentation mode the ring is thicker, and stands further out so it does not cover the control's edge.
    const pad = this.present ? 10 : 4;
    this.pointedBox = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    this.ring.style.left = `${rect.left - pad}px`;
    this.ring.style.top = `${rect.top - pad}px`;
    this.ring.style.width = `${rect.width + pad * 2}px`;
    this.ring.style.height = `${rect.height + pad * 2}px`;

    this.at = this.held ?? this.tipOn(el, rect);
    this.cursor.style.transform = `translate(${this.at.x - this.tipIn.x}px, ${this.at.y - this.tipIn.y}px)`;

    // The caption goes below the control, or above it when there is no room below or when something opened below.
    // In presentation mode it looks for its place another way: see `presentedCaption`.
    const box = this.caption.getBoundingClientRect();
    let left: number;
    let top: number;
    if (this.present) ({ left, top } = this.presentedCaption(rect, pad, box));
    else {
      const fitsBelow = rect.bottom + 14 + box.height < window.innerHeight;
      const fitsAbove = rect.top - box.height - 12 >= 8;
      const above = this.captionAbove ? fitsAbove || !fitsBelow : !fitsBelow;
      top = above ? Math.max(8, rect.top - box.height - 12) : rect.bottom + 14;
      left = Math.min(Math.max(8, rect.left), window.innerWidth - box.width - 8);
    }
    this.caption.style.left = `${left}px`;
    this.caption.style.top = `${top}px`;

    const now = performance.now();
    if (now - this.looked < 200) return;
    this.looked = now;
    const caption = this.caption.hidden ? undefined : { left, top, right: left + box.width, bottom: top + box.height };
    this.keepLauncherOff(rect, caption);
    if (caption) this.keepCaptionOff(el, caption);
    if (this.present) this.showAsked([this.ring.getBoundingClientRect(), this.pointerBox()]);
  }

  /** The box the pointer is drawn in, round its tip, at the size it is drawn. */
  private pointerBox(): Box {
    const scale = this.present ? PRESENT_SCALE : 1;
    return { left: this.at.x - 4, top: this.at.y - 4, right: this.at.x + 18 * scale, bottom: this.at.y + 20 * scale };
  }

  /**
   * Where the caption goes in presentation mode, where it is large: above the
   * control first, then to its left, to its right, and below it last, the
   * first place that fits in the window and keeps off the control, the
   * pointer that hangs from it, every list, menu or calendar open over the
   * page (the whole of one the control is in, so a choice's caption does not
   * hide the other choices), and every place something opened over since.
   * Above comes first because what a control opens, a list, a menu or a
   * calendar, opens below it, and in a form the next field is below it too.
   */
  private presentedCaption(rect: DOMRect, pad: number, box: DOMRect): { left: number; top: number } {
    const gap = 14;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ring = { left: rect.left - pad - 6, top: rect.top - pad - 6, right: rect.right + pad + 6, bottom: rect.bottom + pad + 6 };
    const pointer = this.pointerBox();
    const open = openLayers(this.host, this.target);
    // Round the control, its pointer, and the list it is a choice in, if it is in one.
    const near = [ring, pointer, ...(open.around ? [open.around] : [])];
    const all = { left: Math.min(...near.map((b) => b.left)), top: Math.min(...near.map((b) => b.top)), right: Math.max(...near.map((b) => b.right)), bottom: Math.max(...near.map((b) => b.bottom)) };
    const clampX = (x: number) => Math.min(Math.max(12, x), width - box.width - 12);
    const clampY = (y: number) => Math.min(Math.max(12, y), height - box.height - 12);
    const middle = clampY(rect.top + rect.height / 2 - box.height / 2);
    const places: { left: number; top: number }[] = [];
    for (const round of open.around ? [ring, all] : [ring]) {
      const bottom = Math.max(round.bottom, pointer.bottom);
      const right = Math.max(round.right, pointer.right);
      places.push(
        { left: clampX(rect.left), top: round.top - gap - box.height },
        { left: clampX(rect.right - box.width), top: round.top - gap - box.height },
        { left: round.left - gap - box.width, top: middle },
        { left: right + gap, top: middle },
        { left: clampX(rect.left), top: bottom + gap },
        { left: clampX(rect.right - box.width), top: bottom + gap },
      );
    }
    const fits = (place: { left: number; top: number }) => place.left >= 12 && place.top >= 12 && place.left + box.width <= width - 12 && place.top + box.height <= height - 12;
    const avoid = [ring, pointer, ...this.captionAvoid, ...open.boxes];
    const free = (place: { left: number; top: number }) =>
      !avoid.some((other) => overlaps({ left: place.left, top: place.top, right: place.left + box.width, bottom: place.top + box.height }, other, 0));
    return places.find((place) => fits(place) && free(place)) ?? places.find(fits) ?? { left: clampX(rect.left), top: clampY(ring.bottom + gap) };
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
   * In presentation mode the caption is large, and what lies under it is
   * looked at in six places across it rather than at its middle; what opened
   * is kept clear from then on, and the caption looks for its place again, a
   * few times at most.
   */
  private keepCaptionOff(el: Element, caption: Box) {
    const across = this.present ? [0.15, 0.5, 0.85] : [0.5];
    const down = this.present ? [0.25, 0.75] : [0.5];
    const hits: (Element | null)[] = [];
    for (const fy of down) {
      for (const fx of across) {
        const x = caption.left + (caption.right - caption.left) * fx;
        const y = caption.top + (caption.bottom - caption.top) * fy;
        const hit = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight ? document.elementFromPoint(x, y) : null;
        hits.push(hit && hit !== this.host ? hit : null);
      }
    }
    if (!this.under) {
      this.under = { els: hits, moved: false };
      return;
    }
    if (this.under.moved) return;
    const under = this.under;
    const now = hits.find((hit, index) => cameUp(hit, under.els[index] ?? null, el));
    if (!now) return;
    if (this.present) {
      this.captionAvoid.push(layerOf(now).getBoundingClientRect(), caption);
      this.under = this.captionAvoid.length >= 6 ? { els: [], moved: true } : undefined;
      return;
    }
    this.captionAbove = !this.captionAbove;
    this.under = { els: [], moved: true };
  }

  /** Keeps the launcher off the control being pointed at and off its caption, by moving it to the other side while it would cover them. */
  private keepLauncherOff(rect: DOMRect, caption?: { left: number; top: number; right: number; bottom: number }) {
    const box = this.dock.getBoundingClientRect();
    const size = { w: box.width, h: box.height };
    const covers = (spot: Spot) => overlaps(boxAt(spot, size), rect, 8) || (!!caption && overlaps(boxAt(spot, size), caption, 4));
    this.dockAt(covers(this.home) && !covers(this.away) ? this.away : this.home);
  }

  /** Puts the launcher, and the ask box above it, at a place. */
  private dockAt(spot: Spot) {
    const other = spot.side === "left" ? "right" : "left";
    if (!this.dock.classList.contains(spot.side)) {
      this.dock.classList.remove(other);
      this.dock.classList.add(spot.side);
    }
    // Set through the element's style object, which a page's policy on inline style does not reach.
    this.dock.style.setProperty(spot.side, `${spot.x}px`);
    this.dock.style.setProperty(other, "auto");
    this.dock.style.setProperty("bottom", `${spot.y}px`);
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

/** Words that are read as text and by screen readers, and not drawn. */
function unseen(text: string): HTMLSpanElement {
  return make("span", { class: "unseen" }, text);
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

/**
 * Whether `now`, under a part of the caption where `was` lay before, is
 * something that came up there: not the control `el` or what holds it, not
 * what was there, and, inside what was there, only a box drawn over it. Text
 * that scrolls under the caption is not.
 */
function cameUp(now: Element | null, was: Element | null, el: Element): boolean {
  if (!now || now === was || now.contains(el) || el.contains(now) || (was && now.contains(was))) return false;
  return !(was?.contains(now) && !drawnOver(now, was));
}

/** The box drawn over the page that `el` sits in: a list, a menu, or anything positioned on its own. `el` itself when there is none. */
function layerOf(el: Element): Element {
  for (let at: Element | null = el; at && at !== document.body; at = at.parentElement) {
    if (at.matches('[role="listbox"], [role="menu"], [role="tree"], [role="grid"], [role="dialog"], [role="tooltip"], [popover]')) return at;
    const position = getComputedStyle(at).position;
    if (position === "absolute" || position === "fixed") return at;
  }
  return el;
}

/** What a control opens, by its role: a list, a menu, a tree, a grid of days, or a dialog. */
const OPENS = '[role="listbox"], [role="menu"], [role="tree"], [role="grid"], [role="dialog"], [popover]';

/**
 * The boxes of the lists, menus and calendars open over the page now: each
 * one's box drawn over the page, when it is shown, and `around`, the one the
 * control is in, if it is in one. A dialog the control is in is where the
 * caption has to go, and is not one of them.
 */
function openLayers(ignore: Element, target: Element | undefined): { boxes: Box[]; around?: Box } {
  const found: Box[] = [];
  let around: Box | undefined;
  const seenLayers = new Set<Element>();
  for (const el of document.querySelectorAll(OPENS)) {
    if (ignore.contains(el) || el === ignore || seenLayers.size > 20) continue;
    let layer: Element | null = el;
    while (layer && layer !== document.body && !isLayer(layer)) layer = layer.parentElement;
    if (!layer || layer === document.body || seenLayers.has(layer)) continue;
    seenLayers.add(layer);
    if (typeof layer.checkVisibility === "function" ? !layer.checkVisibility({ visibilityProperty: true }) : !layer.getClientRects().length) continue;
    const box = layer.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const share = (box.width * box.height) / (window.innerWidth * window.innerHeight);
    // A dialog, or anything as big, with the control in it: the caption goes inside it.
    if (target && layer.contains(target) && (layer.matches('[role="dialog"], dialog') || share > 0.4)) continue;
    // A dialog that shuts out the page, or fills a good part of it, is where the visitor is working, not something a control opened.
    if (el.matches('[role="dialog"], dialog') && (el.getAttribute("aria-modal") === "true" || share > 0.25 || isModal(el))) continue;
    found.push(box);
    if (target && layer.contains(target)) around = box;
  }
  return { boxes: found, ...(around ? { around } : {}) };
}

/** Whether an element is the browser's own modal dialog. */
function isModal(el: Element): boolean {
  try {
    return el.matches("dialog:modal");
  } catch {
    return false;
  }
}

/** Whether an element is drawn over the page on its own: positioned against the window or a box, or on the top layer. */
function isLayer(el: Element): boolean {
  if (el.hasAttribute("popover")) {
    try {
      return el.matches(":popover-open");
    } catch {
      // No popovers in this browser: it is drawn where its position puts it.
    }
  }
  const position = getComputedStyle(el).position;
  return position === "absolute" || position === "fixed";
}

/** Whether two boxes are the same, to the pixel. */
function sameBox(a: Box, b: Box): boolean {
  return Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.right - b.right) < 1 && Math.abs(a.bottom - b.bottom) < 1;
}

/**
 * The site's accent for presentation mode: dark enough to stand out from far
 * away on a light page, at least 6 to 1 against white, darkened in small
 * steps with its hue kept. An accent that is not a six-digit hex colour is
 * used as it is.
 */
function strongAccent(accent: string): string {
  const hex = /^#?([0-9a-f]{6})$/i.exec(accent.trim())?.[1];
  if (!hex) return accent;
  let [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
  const light = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const contrast = () => 1.05 / (0.2126 * light(r) + 0.7152 * light(g) + 0.0722 * light(b) + 0.05);
  for (let step = 0; step < 40 && contrast() < 6; step++) [r, g, b] = [r * 0.95, g * 0.95, b * 0.95];
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
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

/** Where the launcher sits: on which side of the window, how far in from that side, and how far up from the bottom. */
interface Spot {
  side: "left" | "right";
  x: number;
  y: number;
}

/** The launcher's own distance from the window's edges, in its corner. */
const EDGE = 20;
/** The room kept between the launcher and a control of the page's it moved off. */
const CLEAR = 12;
/** The room kept above the launcher for the ask box, which opens above it. */
const BOX_ROOM = 220;

const corner = (side: "left" | "right"): Spot => ({ side, x: EDGE, y: EDGE });

/** The box the launcher would take at a place, for a launcher of this size. */
function boxAt(spot: Spot, size: { w: number; h: number }): Box {
  const left = spot.side === "left" ? spot.x : window.innerWidth - spot.x - size.w;
  const bottom = window.innerHeight - spot.y;
  return { left, right: left + size.w, top: bottom - size.h, bottom };
}

/** The highest the launcher goes up its side, so the ask box above it still fits in the window. */
const highest = (size: { h: number }) => window.innerHeight - size.h - BOX_ROOM;

/**
 * The free place on one side nearest that side's corner: the corner itself,
 * or, step by step, just above or just beside each control in the way. Not
 * past the middle of the window, and not so high that the ask box would not
 * fit above it. None when that side has no free place.
 */
function nearestFree(side: "left" | "right", size: { w: number; h: number }, blocked: Box[]): Spot | undefined {
  const top = highest(size);
  const across = window.innerWidth / 2 - size.w;
  const queue: Spot[] = [corner(side)];
  const seen = new Set<string>();
  for (let tries = 0; queue.length && tries < 40; tries++) {
    queue.sort((a, b) => a.x + a.y - (b.x + b.y));
    const spot = queue.shift()!;
    const key = `${Math.round(spot.x)},${Math.round(spot.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const box = boxAt(spot, size);
    const inWay = blocked.filter((control) => overlaps(box, control, 4));
    if (!inWay.length) return spot;
    for (const control of inWay) {
      const up = Math.ceil(window.innerHeight - control.top + CLEAR);
      if (up <= top) queue.push({ side, x: spot.x, y: up });
      const beside = Math.ceil(side === "right" ? window.innerWidth - control.left + CLEAR : control.right + CLEAR);
      if (beside <= across) queue.push({ side, x: beside, y: spot.y });
    }
  }
  return undefined;
}

/** The most controls read when the launcher's place is looked for: a few milliseconds' work on the longest pages. */
const MAX_READ = 3000;

/** What a visitor can use on a page, as far as the launcher's place goes. */
const USABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"], [role="radio"], [role="menuitem"], [role="combobox"], [tabindex]:not([tabindex="-1"])';

/**
 * The boxes of the page's controls that the launcher would cover for good
 * in the lower part of the window where it can go: those that stay put as
 * the page scrolls, where they are now, and the others where they will be
 * once the part they scroll in is at its end. A control that scrolling
 * takes out from under the launcher is not in the way. Read once, when the
 * place is looked for, and never watched.
 */
function lastingControls(ignore: Element, size: { w: number; h: number }): Box[] {
  const height = window.innerHeight;
  const from = height - highest(size) - size.h - CLEAR;
  const page = document.scrollingElement ?? document.documentElement;
  const pageLeft = Math.max(0, page.scrollHeight - page.clientHeight - page.scrollTop);
  const inBand = (top: number, bottom: number) => bottom > from && top < height;
  const found: Box[] = [];
  const all = document.querySelectorAll(USABLE);
  // On a very long page only the last controls are read: the foot of the page, and what scripts add at its end, like a chat button.
  for (let index = all.length - 1; index >= Math.max(0, all.length - MAX_READ); index--) {
    const el = all[index]!;
    if (ignore.contains(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2 || rect.right <= 0 || rect.left >= window.innerWidth) continue;
    const now = inBand(rect.top, rect.bottom);
    if (!now && !inBand(rect.top - pageLeft, rect.bottom - pageLeft)) continue;
    // A box as big as a good part of the window holds controls rather than being one: covering a corner of it hides nothing.
    if (rect.width * rect.height > (window.innerWidth * height) / 3) continue;
    if (!seen(el)) continue;
    if (pinned(el)) {
      if (now) found.push(rect);
      continue;
    }
    const left = scrollLeftUnder(el, page, pageLeft);
    if (inBand(rect.top - left, rect.bottom - left)) found.push({ left: rect.left, right: rect.right, top: rect.top - left, bottom: rect.bottom - left });
  }
  return found;
}

/** Whether an element can be seen: drawn, not see-through, not hidden. */
function seen(el: Element): boolean {
  if (typeof el.checkVisibility === "function") return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  return el.getClientRects().length > 0;
}

/** The parent of a node, or the element that holds its shadow root. */
const up = (node: Node): Node | null => node.parentNode ?? (node as ShadowRoot).host ?? null;

/** Whether an element, or a box it sits in, stays put on screen when the page scrolls. */
function pinned(el: Element): boolean {
  for (let at: Node | null = el; at; at = up(at)) {
    if (!(at instanceof Element)) continue;
    const position = getComputedStyle(at).position;
    if (position === "fixed" || position === "sticky") return true;
  }
  return false;
}

/**
 * How much further up an element goes once the part it scrolls in is
 * scrolled to its end: the nearest box around it that scrolls, or the page.
 */
function scrollLeftUnder(el: Element, page: Element, pageLeft: number): number {
  for (let at = el.parentElement; at && at !== page && at !== document.body; at = at.parentElement) {
    if (at.scrollHeight <= at.clientHeight + 1) continue;
    const overflow = getComputedStyle(at).overflowY;
    if (overflow === "auto" || overflow === "scroll") return Math.max(0, at.scrollHeight - at.clientHeight - at.scrollTop);
  }
  return pageLeft;
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
