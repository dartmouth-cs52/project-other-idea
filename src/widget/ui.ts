import type { Appearance, Source, TurnReply } from "../shared/types.ts";

// Everything Haptic draws: the launcher, the chat with its ask box, the
// pointer, the mark around its target and the caption. It all lives in one
// shadow root on one host element, so the customer's CSS can't reach it and
// ours can't leak out. Model text is only ever set as textContent.

// Colours, radii and motion come from DESIGN.md, and the chat is the one on
// the website's home page (web/components/demo/kit.tsx). The accent colours
// the pointer, its mark and the start of the thinking glow. Everything else is
// ink on white. The pointer shape is assets/pointer.svg, with its tip at POINTER_TIP.
//
// The thinking glow is the one thing drawn over the page itself. It has an
// element of its own, under ours, so it can be blended into the page while the
// chat and the pointer stay as they are.
const POINTER_PATH =
  "M3.271 4.871A1.678 1.678 0 0 1 5.604 2.907L19.822 9.597A1.678 1.678 0 0 1 19.705 12.684L13.956 14.875A.622.622 0 0 0 13.643 15.139L10.506 20.431A1.678 1.678 0 0 1 7.444 20.021Z";
const POINTER_TIP = { x: 3.81, y: 3.14 };

/** How far the mark stands off its control, so it never reads as the control's own focus ring. */
const MARK_GAP = 5;
/** How close the chat may come to a marked control before it steps aside. */
const CLEAR_OF_MARK = MARK_GAP + 4;
/** A click is acknowledged like a pressed button: the mark and the pointer dip and come back. */
const PRESS_MS = 240;
/** How long the mark, the caption and the pointer take to fade when they go. */
const LEAVE_MS = 150;

// The thinking glow. It is on the page only while Haptic waits for the model.
// A soft band the width of the page comes in at the top edge and falls to the
// bottom, one pass after another for as long as the wait lasts. The moment the
// reply arrives it fades, so by the time the pointer lands the page is clear.
/** How long one pass from the top of the page to the bottom takes. A typical wait is about one pass. */
const FALL_MS = 1600;
/** How long the glow takes to come in, and to fade once the reply has arrived. */
const GLOW_IN_MS = 300;
const GLOW_OUT_MS = 350;

// The band's strength across its thickness: a bell with no flat top and no
// edge, which is what makes it read as light and not as a stripe. A gradient
// only joins its stops with straight lines, so the curve is spelled out.
const BELL = [0.62, 0.605, 0.56, 0.49, 0.405, 0.31, 0.215, 0.13, 0.06, 0.015, 0].map((alpha, i) => `rgba(0,0,0,${alpha}) ${i * 10}%`).join(", ");

// The glow's own element. It covers the page under the chat and the pointer,
// takes no clicks, and is not displayed at all unless a glow is on. How it is
// blended into the page is set when a glow starts (see Ui.glowOn).
//
// The band is one element, as tall as the page. Its colour runs from the
// trailing edge to the leading one in a single gradient, mixed in OKLCH so
// the hues melt into each other, and a mask gives it the bell: an ellipse far
// wider than the page, so it is a touch thicker in the middle. Only its
// transform and the opacity of what holds it are animated.
const VEIL_CSS = `
:host { all: initial; display: none; position: fixed; inset: 0; z-index: 2147483646; overflow: hidden; pointer-events: none;
  --glow-a: #77d0fe; --glow-b: #5294ff; --glow-c: #8460ee; }
/* The glow is the site's accent with its neighbours on either side, so it suits whatever colour the pointer is. */
@supports (color: oklch(from red l c h)) {
  :host { --glow-a: oklch(from var(--accent) .82 calc(c * .5) calc(h - 28)); --glow-b: oklch(from var(--accent) .68 calc(c * .85) h);
    --glow-c: oklch(from var(--accent) .6 calc(c * .95) calc(h + 30)); }
}
.glow { position: absolute; inset: 0; animation: arrive ${GLOW_IN_MS}ms ease-out; transition: opacity ${GLOW_OUT_MS}ms ease-out; }
.glow.fade { opacity: 0; }
/* Without a mask the band would be a hard block of colour, so a browser with none shows no glow. */
.glow i { display: none; }
@supports (mask-image: linear-gradient(#000, #000)) or (-webkit-mask-image: linear-gradient(#000, #000)) {
  .glow i { display: block; position: absolute; inset: 0; transform: translateY(-90%); animation: fall ${FALL_MS}ms linear infinite;
    background: linear-gradient(to bottom, var(--glow-a), var(--glow-b) 50%, var(--glow-c));
    background: linear-gradient(to bottom in oklch, var(--glow-a), var(--glow-b) 50%, var(--glow-c));
    -webkit-mask-image: radial-gradient(200% 50% at 50% 50%, ${BELL}); mask-image: radial-gradient(200% 50% at 50% 50%, ${BELL}); }
}
@keyframes fall { from { transform: translateY(-90%); } to { transform: translateY(100%); } }
@keyframes arrive { from { opacity: 0; } }
`;

const CSS = `
:host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
  font: 14px/20px system-ui, -apple-system, "Segoe UI", sans-serif; color: #1c1917; --glide: cubic-bezier(.2,.8,.2,1); }
* { box-sizing: border-box; }
button { font: inherit; cursor: pointer; }
[hidden] { display: none !important; }
.dock { position: fixed; bottom: 20px; display: flex; flex-direction: column; gap: 10px; pointer-events: auto; }
.dock.right { right: 20px; align-items: flex-end; }
.dock.left { left: 20px; align-items: flex-start; }
.launch { position: relative; display: inline-flex; align-items: flex-end; justify-content: flex-end; }
/* Minimized, the area that answers the mouse is a still 32px square around the dot. The dot grows inside it and
   never moves it, so a pointer resting on the dot's edge can't make it grow and shrink in turn. */
.launch.mini { width: 32px; height: 32px; }
.launcher { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; min-width: 40px; border: 0; border-radius: 999px;
  padding: 0 16px 0 14px; background: #1c1917; color: #fafaf9; font-weight: 500;
  /* The faint light edge is lost on a light page and keeps it in sight on a dark one. */
  box-shadow: 0 0 0 1px rgba(250,250,249,.16), 0 4px 14px rgba(0,0,0,.22);
  transition: height .3s var(--glide), min-width .3s var(--glide), padding .3s var(--glide), gap .3s var(--glide),
    box-shadow .3s var(--glide), transform .2s var(--glide); }
.launcher svg { width: 16px; height: 16px; flex: none; transition: width .3s var(--glide), height .3s var(--glide), opacity .2s ease-out; }
.launcher path { fill: currentColor; }
.launcher span { display: inline-block; max-width: 180px; overflow: hidden; white-space: nowrap;
  transition: max-width .3s var(--glide), opacity .2s ease-out .1s; }
/* Minimized: a small dot in the same corner. Hovered or focused, it opens up a little to show the pointer. */
.launcher.mini { height: 14px; min-width: 14px; padding: 0; gap: 0; box-shadow: 0 0 0 1px rgba(250,250,249,.28), 0 2px 8px rgba(0,0,0,.2); }
.launcher.mini span { max-width: 0; opacity: 0; transition: max-width .3s var(--glide), opacity .12s ease-out; }
.launcher.mini svg { width: 0; height: 0; opacity: 0; }
.launch.mini:not(.fresh):hover .launcher, .launcher.mini:focus-visible { height: 32px; min-width: 32px; box-shadow: 0 0 0 1px rgba(250,250,249,.2), 0 6px 16px rgba(0,0,0,.24); }
.launch.mini:not(.fresh):hover .launcher svg, .launcher.mini:focus-visible svg { width: 14px; height: 14px; opacity: 1; }
.launcher:active { transform: scale(.97); }
/* The way to minimize, on the launcher's outer bottom corner while the pointer is over it or it has focus. */
.hide { position: absolute; bottom: -6px; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0;
  border: 1px solid #e7e5e4; border-radius: 999px; background: #fff; color: #57534e; box-shadow: 0 2px 6px rgba(0,0,0,.16);
  opacity: 0; transform: scale(.92) translateY(2px); pointer-events: none; transition: opacity .18s ease-out, transform .18s var(--glide); }
.dock.right .hide { right: -6px; }
.dock.left .hide { left: -6px; }
.hide svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; }
.hide:hover { color: #1c1917; background: #fafaf9; }
.launch:hover .hide, .launch:focus-within .hide { opacity: 1; transform: none; pointer-events: auto; }
.launch.mini .hide { display: none; }

/* The chat. It stays open from the question to the last step. */
.panel { width: min(320px, calc(100vw - 40px)); background: #fff; border: 1px solid #e7e5e4; border-radius: 14px;
  padding: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.16); animation: arrive .2s ease-out; }
.panel ::placeholder { color: #78716c; opacity: 1; }
.thread { display: flex; flex-direction: column; gap: 8px; max-height: min(360px, calc(100vh - 260px)); overflow-y: auto; padding: 4px 4px 0; margin-bottom: 12px; }
.thread p { margin: 0; overflow-wrap: anywhere; }
.asked { align-self: flex-end; max-width: 80%; background: #1c1917; color: #fafaf9; border-radius: 14px; padding: 8px 12px; line-height: 22px; }
.reply { align-self: flex-start; max-width: 100%; background: #f5f5f4; border-radius: 14px; padding: 8px 12px; line-height: 22px; animation: arrive .2s ease-out; }
.sources { margin: 8px 0 0; padding: 8px 0 0; border-top: 1px solid #e7e5e4; list-style: none; font-size: 12px; line-height: 16px; color: #78716c; }
.sources li + li { margin-top: 6px; }
.sources .from { margin-bottom: 4px; }
.reply .missing { margin-top: 8px; font-size: 12px; line-height: 16px; color: #78716c; }
.sources .title { display: block; color: #1c1917; font-weight: 500; text-decoration: none; }
.sources a.title:hover, .sources a.title:focus-visible { text-decoration: underline; text-underline-offset: 2px; }
/* One line under the bubbles: Thinking, Showing you how, or Done. */
.state { display: flex; align-items: center; gap: 8px; min-height: 20px; color: #78716c; }
.state .arrow, .state .tick { display: none; flex: none; width: 16px; height: 16px; }
.state .arrow path { fill: var(--accent); }
.state .tick { align-items: center; justify-content: center; border-radius: 999px; background: #008932; color: #fff; }
.state .tick svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.state.pointing .arrow { display: block; }
.state.done { color: #1c1917; font-weight: 500; }
.state.done .tick { display: inline-flex; }
/* A lighter shade sweeps across the word while Haptic works. */
.state.thinking span { color: transparent; background: linear-gradient(110deg, #78716c 35%, #d6d3d1 50%, #78716c 65%) 100% 0 / 300% 100% no-repeat;
  -webkit-background-clip: text; background-clip: text; animation: shimmer 2s linear infinite; }
.helped, .handoff .row { display: flex; align-items: center; gap: 8px; min-height: 32px; }
.helped { padding: 0 2px 0 4px; margin-bottom: 12px; }
.helped span, .handoff .row span { margin-right: auto; color: #78716c; }
.helped button, .handoff button { display: inline-flex; align-items: center; justify-content: center; height: 32px; border: 0; border-radius: 999px; padding: 0 14px;
  background: #e7e5e4; color: #1c1917; font-weight: 500; }
.helped button:hover, .handoff button:hover { background: #d6d3d1; }
.handoff { display: flex; flex-direction: column; gap: 8px; padding: 0 2px 0 4px; margin-bottom: 12px; }
.handoff .row { justify-content: flex-end; }
.handoff button.go { background: #1c1917; color: #fafaf9; }
.handoff button:disabled { opacity: .5; cursor: default; }
.person { display: flex; flex-direction: column; gap: 8px; margin-left: -2px; }
.person input, .person textarea { width: 100%; font: inherit; color: inherit; padding: 8px 12px; border: 1px solid #e7e5e4; border-radius: 10px; background: #fff; outline: none; resize: none; }
.person input:focus, .person textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); }
.ask { display: flex; flex-direction: column; border: 1px solid transparent; border-radius: 10px; background: #f5f5f4; transition: border-color .15s ease-out, box-shadow .15s ease-out; }
.ask:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); }
.ask input { width: 100%; height: 40px; font: inherit; color: inherit; padding: 4px 12px 0; border: 0; background: transparent; outline: none; }
/* Send, and while Haptic is guiding, stop. */
.send { display: inline-flex; align-items: center; justify-content: center; align-self: flex-end; width: 32px; height: 32px; margin: 6px 10px 8px; padding: 0; border: 0;
  border-radius: 999px; background: #1c1917; color: #fafaf9; transition: opacity .15s ease-out, transform .15s var(--glide); }
.send:active { transform: scale(.94); }
.send:disabled { opacity: .5; cursor: default; }
.send svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.send .square { display: none; width: 12px; height: 12px; fill: currentColor; stroke: none; }
.ask.working .send .up { display: none; }
.ask.working .send .square { display: block; }
.note { margin: 0; padding: 8px 12px 4px; font-size: 12px; line-height: 16px; color: #78716c; }
.note a { color: inherit; text-decoration: none; }
.note a:hover, .note a:focus-visible { text-decoration: underline; text-underline-offset: 2px; }

@keyframes shimmer { to { background-position: 0 0; } }
@keyframes arrive { from { opacity: 0; transform: translateY(6px); } }

/* The mark around the control: the accent with a white edge on both sides and a soft shadow, like the pointer. */
.mark { position: fixed; left: 0; top: 0; animation: land .2s var(--glide); }
.mark div { width: 100%; height: 100%; border: 2px solid var(--accent); border-radius: inherit; box-shadow: 0 0 0 1.5px #fff, inset 0 0 0 1.5px #fff, 0 3px 10px rgba(0,0,0,.14); }
.mark.press div { animation: dip-mark ${PRESS_MS}ms ease-out; }
.cursor { position: fixed; left: 0; top: 0; width: 24px; height: 24px; transition: transform .55s var(--glide); animation: appear .15s ease-out;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,.3)) drop-shadow(0 5px 9px rgba(0,0,0,.26)); will-change: transform; }
.cursor svg { display: block; overflow: visible; transform-origin: 16% 13%; }
.cursor path { fill: var(--accent); stroke: #fff; stroke-width: 3; stroke-linejoin: round; paint-order: stroke; }
.cursor.press svg { animation: dip-pointer ${PRESS_MS}ms ease-out; }
/* The caption says one thing and carries no buttons. The way out is the stop button in the chat. */
.caption { position: fixed; max-width: min(288px, calc(100vw - 16px)); background: #1c1917; color: #fafaf9; border-radius: 14px; padding: 8px 12px;
  box-shadow: 0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1), 0 8px 24px rgba(0,0,0,.14); overflow-wrap: anywhere; animation: say .18s ease-out; }
.caption .close { display: none; align-items: center; justify-content: center; flex: none; width: 24px; height: 24px; padding: 0; border: 0;
  border-radius: 999px; background: rgba(250,250,249,.15); color: #fafaf9; }
.caption .close:hover { background: rgba(250,250,249,.25); }
.caption .close svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; }
/* With the chat closed, the caption carries the way out. */
.caption.exit { display: flex; align-items: flex-start; gap: 8px; padding: 6px 6px 6px 12px; pointer-events: auto; }
.caption.exit span { padding: 2px 0; }
.caption.exit .close { display: inline-flex; }
@keyframes land { from { opacity: 0; transform: scale(1.06); } }
@keyframes say { from { opacity: 0; transform: translateY(4px); } }
@keyframes appear { from { opacity: 0; } }
@keyframes dip-mark { 40% { transform: scale(.97); } }
@keyframes dip-pointer { 40% { transform: scale(.9); } }
@media (prefers-reduced-motion: reduce) {
  .cursor, .launcher, .launcher svg, .launcher span, .hide, .ask, .send { transition: none; }
  .panel, .reply, .mark, .mark div, .cursor, .cursor svg, .caption { animation: none !important; }
  .state.thinking span { color: inherit; background: none; animation: none; }
}
`;

// A visitor is told they are dealing with an AI before they ask it anything,
// which the EU's AI Act has required since August 2026. It is one line under
// the ask box, there whenever the ask box is. It is not a setting: a customer
// can change the launcher's word, and cannot take this away. The link goes to
// the page that says what Haptic reads and keeps.
const ABOUT_URL = "https://joinhaptic.com/privacy/";

// A visitor who minimizes the launcher keeps it minimized on the next page of
// the site. It is only a convenience, so storage that is blocked or full just
// means it starts as the full launcher again.
const MINIMIZED_KEY = "haptic.minimized";

function minimizedBefore(): boolean {
  try {
    return localStorage.getItem(MINIMIZED_KEY) === "1";
  } catch {
    return false;
  }
}

function remember(mini: boolean) {
  try {
    if (mini) localStorage.setItem(MINIMIZED_KEY, "1");
    else localStorage.removeItem(MINIMIZED_KEY);
  } catch {
    // Not kept. It is minimized on this page only.
  }
}

export interface UiHandlers {
  onAsk: (question: string) => void;
  onStop: () => void;
}

/** What the line under the bubbles says: nothing, the thinking word, "Showing you how", or the green tick and "Done". */
type State = "idle" | "thinking" | "pointing" | "done";

interface Point {
  x: number;
  y: number;
}

export class Ui {
  readonly host: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly send: HTMLButtonElement;
  private readonly state: HTMLElement;
  private readonly stateText: HTMLElement;
  /** The glow's element. It sits in the page beside ours and under it, and is blended into the page. */
  private readonly veil: HTMLElement;
  /** Where the glows are drawn, inside it. */
  private readonly glass: ShadowRoot;
  /** Its second stylesheet, which shows it and says how it is blended while a glow is on, and is empty otherwise. */
  private readonly veilMode: HTMLStyleElement;
  private readonly mark: HTMLElement;
  private readonly cursor: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly captionText: HTMLElement;
  private readonly helped: HTMLElement;
  private readonly thread: HTMLElement;
  private readonly asked: HTMLElement;
  private readonly reply: HTMLElement;
  private readonly handoff: HTMLElement;
  private readonly side: "left" | "right";
  private onHelped?: (helped: boolean) => void;
  private now: State = "idle";
  private target?: Element;
  private frame = 0;
  /** Where the pointer last was, so each move starts from there. */
  private at: Point = { x: 0, y: 0 };
  /** The pointer has reached its target, so the mark and the caption can show. */
  private landed = false;
  private landing?: ReturnType<typeof setTimeout>;
  private pressing?: ReturnType<typeof setTimeout>;
  /** The corner radius of the mark around the current target. */
  private radius = 0;
  /** Where the chat was when it closed to uncover the target. It comes back when the pointer leaves, or moves on to somewhere clear of it. */
  private aside?: Box;
  /** The target the chat last stepped aside for. It steps aside once, so a visitor who opens it again keeps it. */
  private asideFor?: Element;
  /** The visitor closed the chat themselves. It stays closed until there is something to read in it. */
  private shut = false;
  /** The glow that is on the page while Haptic thinks. */
  private glow?: HTMLElement;
  private readonly fading = new Map<HTMLElement, Animation>();

  constructor(appearance: Appearance, handlers: UiHandlers) {
    this.host = document.createElement("haptic-root");
    this.host.style.setProperty("--accent", appearance.accent);
    // Nothing in the glow's element is for the page's scripts, a screen reader or Haptic's own reading of the page.
    this.veil = document.createElement("haptic-veil");
    this.veil.style.setProperty("--accent", appearance.accent);
    this.veil.setAttribute("aria-hidden", "true");
    this.veil.setAttribute("data-haptic-ignore", "");
    this.veil.setAttribute("popover", "manual");
    this.glass = this.veil.attachShadow({ mode: "open" });
    this.glass.innerHTML = `<style>${VEIL_CSS}</style><style></style>`;
    this.veilMode = this.glass.lastElementChild as HTMLStyleElement;
    const root = this.host.attachShadow({ mode: "open" });
    this.side = appearance.position === "bottom-left" ? "left" : "right";
    // The dock comes first, so the pointer, its mark and the caption are drawn over the chat.
    root.innerHTML = `<style>${CSS}</style>
      <div class="dock ${this.side}">
        <div class="panel" hidden>
          <div class="thread" hidden>
            <p class="asked"></p>
            <div class="reply" hidden><p></p><ul class="sources" hidden></ul><p class="missing" hidden></p></div>
            <div class="state" role="status" hidden>
              <svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="${POINTER_PATH}"/></svg>
              <i class="tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></i>
              <span></span>
            </div>
          </div>
          <div class="helped" hidden></div>
          <div class="handoff" hidden>
            <div class="row offer"><span></span><button type="button" class="open"></button></div>
            <form class="person" hidden>
              <input type="email" required maxlength="200" placeholder="Your email" aria-label="Your email">
              <textarea rows="2" maxlength="1000" placeholder="Anything to add" aria-label="Anything to add"></textarea>
              <div class="row"><span></span><button type="button" class="cancel">Cancel</button><button type="submit" class="go">Send</button></div>
            </form>
          </div>
          <form class="ask"><input type="text" placeholder="What do you want to do" aria-label="Ask a question" maxlength="300" autocomplete="off"><button class="send" type="button" aria-label="Send" disabled><svg class="up" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg><svg class="square" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/></svg></button></form>
          <p class="note">Haptic <a href="${ABOUT_URL}" target="_blank" rel="noopener noreferrer">is an AI guide and can be wrong.</a></p>
        </div>
        <div class="launch">
          <button class="launcher" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${POINTER_PATH}"/></svg><span></span></button>
          <button class="hide" type="button" aria-label="Minimize Haptic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        </div>
      </div>
      <div class="mark" hidden><div></div></div>
      <div class="caption" hidden><span></span><button class="close" type="button" aria-label="Stop guide"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <div class="cursor" hidden><svg viewBox="0 0 24 24" width="24" height="24"><path d="${POINTER_PATH}"/></svg></div>`;
    const pick = <T extends Element>(selector: string) => root.querySelector(selector) as T;
    this.panel = pick(".panel");
    this.form = pick(".ask");
    this.input = pick(".ask input");
    this.send = pick(".send");
    this.handoff = pick(".handoff");
    this.state = pick(".state");
    this.stateText = pick(".state span");
    this.mark = pick(".mark");
    this.cursor = pick(".cursor");
    this.caption = pick(".caption");
    this.captionText = pick(".caption span");
    this.thread = pick(".thread");
    this.asked = pick(".asked");
    this.reply = pick(".reply");
    this.helped = pick(".helped");
    this.helped.addEventListener("click", (event) => {
      const answer = (event.target as Element).closest("button")?.dataset.helped;
      if (!answer || !this.onHelped) return;
      this.onHelped(answer === "yes");
      this.onHelped = undefined;
      // Thanks takes the question's place for a moment, then the ask box is all that is left.
      this.helped.replaceChildren(Object.assign(document.createElement("span"), { textContent: "Thanks." }));
      const shown = this.helped.firstChild;
      setTimeout(() => this.helped.firstChild === shown && this.hideHelped(), 1500);
    });
    const launcher = pick<HTMLButtonElement>(".launcher");
    pick(".launcher span").textContent = appearance.launcherLabel;

    const launch = pick<HTMLElement>(".launch");
    const minimize = (mini: boolean) => {
      launch.classList.toggle("mini", mini);
      if (!mini) launch.classList.remove("fresh");
      launcher.classList.toggle("mini", mini);
      // Its word is hidden while it is a dot, so the dot needs a name of its own.
      if (mini) launcher.setAttribute("aria-label", `Show ${appearance.launcherLabel}`);
      else launcher.removeAttribute("aria-label");
      remember(mini);
    };
    if (minimizedBefore()) minimize(true);
    launcher.addEventListener("click", () => {
      if (launcher.classList.contains("mini")) return minimize(false);
      this.panel.hidden = !this.panel.hidden;
      this.shut = this.panel.hidden;
      if (!this.panel.hidden) this.input.focus();
    });
    // Just minimized, the pointer is still where the button was. The dot stays small until it leaves and comes back.
    launch.addEventListener("pointerleave", () => launch.classList.remove("fresh"));
    pick(".hide").addEventListener("click", () => {
      this.panel.hidden = this.shut = true;
      if (launch.matches(":hover")) launch.classList.add("fresh");
      minimize(true);
      launcher.focus({ preventScroll: true });
    });
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const question = this.input.value.trim();
      if (!question) return;
      this.input.value = "";
      // The focus ring is for typing. Once the question is sent, the glow is what shows Haptic is working.
      this.input.blur();
      handlers.onAsk(question);
    });
    this.input.addEventListener("input", () => this.syncSend());
    // One button: it sends the question, and while Haptic is guiding it stops the guide.
    this.send.addEventListener("click", () => {
      if (this.working) handlers.onStop();
      else if (typeof this.form.requestSubmit === "function") this.form.requestSubmit();
      else this.form.dispatchEvent(new Event("submit", { cancelable: true }));
    });
    pick(".close").addEventListener("click", handlers.onStop);

    // Typing in the ask box mustn't trigger the page's keyboard shortcuts or focus traps.
    for (const type of ["keydown", "keyup", "keypress", "focusin"]) {
      this.host.addEventListener(type, (event) => {
        if (type === "keydown" && (event as KeyboardEvent).key === "Escape" && !this.panel.hidden) {
          this.panel.hidden = this.shut = true;
          // Inside a page's modal <dialog>, Escape would also close the dialog. It was meant for our panel only.
          event.preventDefault();
        }
        event.stopPropagation();
      });
    }
    this.host.setAttribute("popover", "manual");
    this.watchTopLayer();
    this.place();
    // A backstop for anything the watchers miss, like a framework removing the dialog we were in.
    setInterval(this.place, 500);
  }

  /**
   * Keeps our element on top and usable. A page's modal <dialog> sits in the
   * browser's top layer and makes everything outside it inert, so while one is
   * open we move inside it, and move back out when it closes. With `raise`,
   * we are shown again even where we are, so that something the page has just
   * put in the top layer, like a popover, does not cover the pointer.
   */
  place = (raise?: unknown) => {
    let modal: Element | undefined;
    try {
      modal = Array.from(document.querySelectorAll("dialog:modal")).pop();
    } catch {
      // :modal unsupported, so there's no top layer to compete with.
    }
    const home = modal ?? document.documentElement;
    if (this.host.parentNode === home && this.veil.parentNode === home && raise !== true) return;
    // The glow's element goes wherever ours does, just before it.
    if (this.host.parentNode !== home || this.veil.parentNode !== home) home.append(this.veil, this.host);
    try {
      // Being a popover puts us in the top layer too, above anything the page stacks with z-index.
      // The last element shown is the one on top, so a popover that is already showing is shown again:
      // the glow first, then ours over it.
      for (const part of [this.veil, this.host]) {
        if (part.matches(":popover-open")) part.hidePopover();
        part.showPopover();
      }
    } catch {
      // No popover support. The fixed position and z-index still apply.
    }
  };

  /**
   * Moves us the moment a page's dialog opens or closes, rather than on the
   * next check. Until then we would be inert behind the dialog, or hidden
   * inside a dialog that has closed.
   */
  private watchTopLayer() {
    // showModal() and close() both set or remove the dialog's open attribute,
    // which is seen before the next frame, in every browser.
    new MutationObserver((records) => {
      if (records.some((record) => record.target instanceof HTMLDialogElement)) this.place();
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["open"] });
    // Some pages swap out the whole document's children. Put ourselves back.
    new MutationObserver(() => {
      if (!this.host.isConnected || !this.veil.isConnected) this.place();
    }).observe(document.documentElement, { childList: true });
    // A popover or dialog the page opens goes on top of us. Go back on top.
    document.addEventListener(
      "toggle",
      (event) => {
        const ours = event.target === this.host || event.target === this.veil;
        const opened = event.target instanceof Element && !ours && (event as ToggleEvent).newState === "open";
        // <details> fires the same event, and is not in the top layer.
        if (opened && (event.target as Element).matches("[popover], dialog")) this.place(true);
      },
      true,
    );
  }

  /** Haptic is thinking or pointing, so the ask box's button stops the guide. */
  private get working(): boolean {
    return this.now === "thinking" || this.now === "pointing";
  }

  private get still(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /**
   * Opens the chat for something new to read in it. Not while it has stepped
   * aside to uncover the control being pointed at: it comes back when the
   * pointer leaves. With `quietly`, as for the word that says Haptic is
   * thinking, a chat the visitor closed themselves stays closed.
   */
  private open(quietly = false) {
    if (this.aside || (quietly && this.shut)) return;
    this.shut = false;
    this.panel.hidden = false;
  }

  private setState(state: State, text = "") {
    this.now = state;
    this.state.className = `state ${state}`;
    this.state.hidden = state === "idle";
    const says = state === "pointing" ? "Showing you how" : state === "done" ? "Done" : text;
    // Said again only when it changes, so a screen reader isn't told "Thinking" twice.
    if (this.stateText.textContent !== says) this.stateText.textContent = says;
    this.form.classList.toggle("working", this.working);
    this.send.setAttribute("aria-label", this.working ? "Stop" : "Send");
    this.syncSend();
  }

  /** With nothing typed there is nothing to send. While Haptic is guiding, the button is the way to stop. */
  private syncSend() {
    this.send.disabled = !this.working && this.input.value.trim() === "";
  }

  /** Starts a question: it shows as a bubble at the top of the chat, and whatever the last question left is cleared. */
  ask(question: string) {
    this.clear();
    this.asked.textContent = question;
    this.asked.hidden = false;
    this.reply.hidden = true;
    this.thread.hidden = false;
    this.hideHelped();
    this.hideHandoff();
    this.open();
  }

  /** Shows Haptic thinking, with a word for what it is doing. With no text, it goes back to waiting for a question. */
  setBusy(text: string) {
    if (!text) {
      this.glowOff();
      return this.setState("idle");
    }
    this.setState("thinking", text);
    this.glowOn();
    this.hideHelped();
    this.hideHandoff();
    this.open(true);
  }

  /** The guide is finished: the green tick and "Done". */
  showDone() {
    this.glowOff();
    this.setState("done");
    this.open();
  }

  /** Back to the plain ask box, with nothing of the last question left. */
  reset() {
    this.clear();
    this.thread.hidden = true;
    this.hideHandoff();
    this.setBusy("");
  }

  /**
   * Shows a reply in the chat, under the question: an answer from the help
   * docs with the articles it rests on, or the sentence that says Haptic can't
   * help. Every word is set as text, and a link is only made for an http or
   * https address.
   */
  showAnswer(reply: Pick<TurnReply, "say" | "sources" | "missing">) {
    const [text, list, missing] = ["p", ".sources", ".missing"].map((selector) => this.reply.querySelector(selector) as HTMLElement);
    text!.textContent = reply.say;
    const sources = reply.sources ?? [];
    // Says where the words came from, then each article.
    list!.replaceChildren(Object.assign(document.createElement("li"), { className: "from", textContent: "From the help docs" }), ...sources.map(sourceRow));
    list!.hidden = sources.length === 0;
    // A control the article names that isn't in the product any more, as far as Haptic can see. Better said than left for the visitor to hunt for.
    const gone = (reply.missing ?? []).slice(0, 2).map((label) => `"${label}"`);
    missing!.textContent = gone.length ? `I can't see ${gone.join(" or ")} on this page or the others I know, so this may no longer be right.` : "";
    missing!.hidden = gone.length === 0;
    // The thinking is over.
    this.glowOff();
    this.asked.hidden = this.asked.textContent === "";
    this.reply.hidden = false;
    this.thread.hidden = false;
    this.open();
    this.thread.scrollTop = 0;
  }

  /** Says one sentence in the chat, as a reply to the question. */
  say(text: string) {
    this.showAnswer({ say: text });
  }

  clearAnswer() {
    this.reply.hidden = true;
    this.hideHandoff();
  }

  /**
   * Offers the way to a person, as one button under the reply. `open` is
   * called when it is pressed. With `form`, pressing it shows a short form
   * instead, and `send` is called with what the visitor typed: it resolves to
   * true when the company got it.
   */
  offerHandoff(label: string, open: () => void, send?: (email: string, note: string) => Promise<boolean>) {
    const pick = <T extends HTMLElement>(selector: string) => this.handoff.querySelector(selector) as T;
    const [offer, form] = [pick(".offer"), pick<HTMLFormElement>(".person")];
    const [button, said, email, note, go, formSaid] = [pick<HTMLButtonElement>(".open"), pick(".offer span"), pick<HTMLInputElement>(".person input"), pick<HTMLTextAreaElement>("textarea"), pick<HTMLButtonElement>(".go"), pick(".person .row span")];
    const show = (which: "offer" | "form") => {
      offer.hidden = which !== "offer";
      form.hidden = which !== "form";
    };
    button.textContent = label;
    button.hidden = false;
    said.textContent = "";
    formSaid.textContent = "";
    show("offer");
    button.onclick = () => {
      if (!send) return open();
      show("form");
      email.focus();
    };
    pick<HTMLButtonElement>(".cancel").onclick = () => show("offer");
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!send || !email.reportValidity()) return;
      go.disabled = true;
      formSaid.textContent = "Sending…";
      const sent = await send(email.value.trim(), note.value.trim());
      go.disabled = false;
      if (!sent) return void (formSaid.textContent = "That didn't send. Try again.");
      // It is with a person now, and the widget says so: from here on they are not talking to the AI about this.
      email.value = note.value = "";
      show("offer");
      button.hidden = true;
      said.textContent = "Sent to the team. A person will reply by email.";
    };
    this.handoff.hidden = false;
    this.open();
  }

  hideHandoff() {
    this.handoff.hidden = true;
  }

  /**
   * Moves the pointer to an element. It glides there from where it was, or
   * from the chat if it was out of sight, and the mark and the caption show
   * once it lands. With no text yet, the pointer and the mark go alone.
   */
  pointAt(el: Element, text: string) {
    const fresh = el !== this.target;
    this.target = el;
    this.captionText.textContent = text;
    // The reply has arrived. The glow fades as the pointer sets off, so the page is clear when it lands.
    this.glowOff();
    this.setState("pointing");
    if (fresh) {
      clearTimeout(this.landing);
      this.settlePress();
      this.landed = false;
      this.hide(this.mark);
      this.hide(this.caption);
      this.radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8;
      const rect = el.getBoundingClientRect();
      // The chat stepped aside for the last control. It comes back if this one is clear of where it sits.
      if (this.aside && !overlaps(this.aside, rect, CLEAR_OF_MARK)) this.comeBack();
      this.asideFor = undefined;
      const from = this.cursor.hidden ? this.home() : this.at;
      const to = tipOn(rect);
      // Longer trips take longer, within limits, so the pointer never teleports and never dawdles.
      const ms = this.still ? 0 : Math.min(700, Math.max(400, 300 + Math.hypot(to.x - from.x, to.y - from.y) * 0.5));
      this.at = from;
      this.cursor.style.transitionDuration = `${ms}ms`;
      // Paint once at the old spot so the transition has somewhere to start from.
      this.cursor.style.transform = translate(from);
      this.show(this.cursor);
      this.landing = setTimeout(() => (this.landed = true), ms);
    }
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.track);
  }

  /**
   * The visitor clicked what the pointer was on. The mark and the pointer dip
   * like a pressed button and come back, where they are, even if the click
   * took the control off the page. Then the mark and caption go, and with
   * "clear" the pointer goes too.
   */
  press(then: "rest" | "clear") {
    const settle = () => (then === "clear" ? this.clear() : this.rest());
    this.stopTracking();
    this.settlePress();
    if (this.cursor.hidden || this.still) return settle();
    for (const part of [this.cursor, this.mark]) {
      part.classList.remove("press");
      // Read back so the dip plays again if it has only just played.
      void part.offsetWidth;
      part.classList.add("press");
    }
    this.pressing = setTimeout(() => {
      this.pressing = undefined;
      settle();
    }, PRESS_MS);
  }

  /** Ends a press that is still playing. */
  private settlePress() {
    clearTimeout(this.pressing);
    this.pressing = undefined;
    this.cursor.classList.remove("press");
    this.mark.classList.remove("press");
  }

  /** The step is over. The mark and the caption go, and the pointer waits where it is for the next one. */
  rest() {
    this.stopTracking();
    this.settlePress();
    this.leave(this.mark);
    this.leave(this.caption);
    this.asideFor = undefined;
    this.comeBack();
  }

  /** Takes the pointer, its mark and the caption off the page. */
  clear() {
    this.rest();
    this.leave(this.cursor);
  }

  private stopTracking() {
    this.target = undefined;
    cancelAnimationFrame(this.frame);
    clearTimeout(this.landing);
  }

  /** Where the pointer sets off from when it was out of sight: beside the ask box, or the launcher when the chat is closed. */
  private home(): Point {
    if (!this.panel.hidden) {
      const box = this.panel.getBoundingClientRect();
      return { x: box.right - Math.min(64, box.width / 2), y: box.bottom - 20 };
    }
    return { x: this.side === "left" ? 60 : window.innerWidth - 60, y: window.innerHeight - 40 };
  }

  /**
   * Closes the chat when it would cover the control being pointed at, or its
   * caption. It happens once for a control, so a visitor who opens the chat
   * again keeps it open.
   */
  private makeRoom(el: Element, chat: Box | undefined, box: Box, margin: number) {
    if (!chat || this.panel.hidden || this.asideFor === el) return;
    if (!overlaps(chat, box, margin)) return;
    this.asideFor = el;
    this.aside = { left: chat.left, top: chat.top, right: chat.right, bottom: chat.bottom };
    this.panel.hidden = true;
  }

  private comeBack() {
    if (!this.aside) return;
    this.aside = undefined;
    this.panel.hidden = false;
  }

  private show(part: HTMLElement) {
    this.fading.get(part)?.cancel();
    this.fading.delete(part);
    part.hidden = false;
  }

  private hide(part: HTMLElement) {
    this.fading.get(part)?.cancel();
    this.fading.delete(part);
    part.hidden = true;
  }

  /** Fades a part out, then hides it. */
  private leave(part: HTMLElement) {
    if (part.hidden || this.fading.has(part)) return;
    if (this.still || typeof part.animate !== "function") return this.hide(part);
    const fade = part.animate({ opacity: [1, 0] }, { duration: LEAVE_MS, easing: "ease-out" });
    this.fading.set(part, fade);
    fade.onfinish = () => this.fading.get(part) === fade && this.hide(part);
  }

  /**
   * Starts the glow: a band of colour comes in at the top of the page and
   * falls to the bottom, again and again while Haptic thinks. With reduced
   * motion on there is no glow at all.
   */
  private glowOn() {
    if (this.glow || this.still) return;
    const el = document.createElement("div");
    el.className = "glow";
    el.append(document.createElement("i"));
    // One fading and one new is the most there is to see at once.
    const glows = this.glass.querySelectorAll(".glow");
    for (let i = 0; i < glows.length - 1; i++) glows[i]?.remove();
    this.glass.append(el);
    // The glow is multiplied into a light page, so the page's words stay dark and sharp through it, and screened into
    // a dark one, where multiplying would lose the colour. Set in the element's own stylesheet and not on the element,
    // so the page sees nothing change.
    this.veilMode.textContent = `:host { display: block; mix-blend-mode: ${pageIsDark() ? "screen" : "multiply"}; }`;
    this.glow = el;
  }

  /**
   * Ends the glow, the moment the thinking is over, however it ended. It fades
   * where it is, still falling, and is then off the page altogether.
   */
  private glowOff() {
    const el = this.glow;
    if (!el) return;
    this.glow = undefined;
    el.classList.add("fade");
    setTimeout(() => {
      el.remove();
      // With no glow left, the element is not displayed, and the page is not blended with anything.
      if (!this.glass.querySelector(".glow")) this.veilMode.textContent = "";
    }, GLOW_OUT_MS);
  }

  /**
   * Shows "Did this help?" above the ask box. The caption keeps to one
   * sentence and no buttons, so the question lives in the chat.
   * `answer` is called once, if they tap Yes or No.
   */
  askIfHelped(answer: (helped: boolean) => void) {
    this.onHelped = answer;
    this.helped.replaceChildren(...this.helpedRow());
    this.helped.hidden = false;
    this.open();
  }

  private helpedRow(): Node[] {
    const span = Object.assign(document.createElement("span"), { textContent: "Did this help?" });
    const yes = Object.assign(document.createElement("button"), { type: "button", textContent: "Yes" });
    const no = Object.assign(document.createElement("button"), { type: "button", textContent: "No" });
    yes.dataset.helped = "yes";
    no.dataset.helped = "no";
    return [span, yes, no];
  }

  private hideHelped() {
    this.helped.hidden = true;
    this.onHelped = undefined;
  }

  /** Follows the target every frame, so scrolling and layout shifts don't strand the pointer. */
  private track = () => {
    const el = this.target;
    if (!el) return;
    this.frame = requestAnimationFrame(this.track);
    if (!el.isConnected) return this.hide(this.mark);
    const rect = el.getBoundingClientRect();
    const onScreen = rect.bottom > 0 && rect.top < window.innerHeight && rect.width + rect.height > 0;
    if (!onScreen) return this.hide(this.mark);

    // The chat stays open through a guide, but never on top of the control the visitor has to use.
    // Where it is, is read once, before anything is moved.
    const chat = this.panel.hidden ? undefined : this.panel.getBoundingClientRect();
    this.makeRoom(el, chat, rect, CLEAR_OF_MARK);

    // The tip sits in the element's lower right corner, so the pointer hangs off it and never covers the label.
    this.at = tipOn(rect);
    this.cursor.style.transform = translate(this.at);
    if (!this.landed) return;

    const height = rect.height + MARK_GAP * 2;
    this.mark.style.left = `${rect.left - MARK_GAP}px`;
    this.mark.style.top = `${rect.top - MARK_GAP}px`;
    this.mark.style.width = `${rect.width + MARK_GAP * 2}px`;
    this.mark.style.height = `${height}px`;
    this.mark.style.borderRadius = `${Math.min(this.radius + MARK_GAP, height / 2)}px`;
    if (this.mark.hidden) this.show(this.mark);

    if (this.captionText.textContent === "") return this.hide(this.caption);
    // With the chat closed, by stepping aside or by the visitor, the caption carries the way to stop.
    this.caption.classList.toggle("exit", this.panel.hidden !== false);
    if (this.caption.hidden) this.show(this.caption);
    // Under the control, or above it when there is no room, on the side of the screen the control is on.
    const box = this.caption.getBoundingClientRect();
    const below = rect.bottom + 14 + box.height <= window.innerHeight - 8;
    const top = below ? rect.bottom + 14 : Math.max(8, rect.top - box.height - 14);
    const onRight = rect.left + rect.width / 2 > window.innerWidth / 2;
    const left = Math.min(Math.max(8, onRight ? rect.right - box.width : rect.left), window.innerWidth - box.width - 8);
    this.caption.style.left = `${left}px`;
    this.caption.style.top = `${top}px`;
    // The caption is part of the step, so the chat must not sit on it either.
    this.makeRoom(el, chat, { left, top, right: left + box.width, bottom: top + box.height }, 4);
  };
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** True when two boxes overlap, or come within `margin` of each other. */
function overlaps(a: Box, b: Box, margin: number): boolean {
  return a.left < b.right + margin && b.left - margin < a.right && a.top < b.bottom + margin && b.top - margin < a.bottom;
}

/** Where the pointer's tip goes on a control: inside its lower right corner. */
function tipOn(rect: DOMRect): Point {
  return { x: rect.right - Math.min(10, rect.width * 0.2), y: rect.bottom - Math.min(7, rect.height * 0.25) };
}

function translate(tip: Point): string {
  return `translate(${tip.x - POINTER_TIP.x}px, ${tip.y - POINTER_TIP.y}px)`;
}

/**
 * Whether the page is dark where the glow will fall, going by the first
 * background that is not see-through behind three spots on it. A page that
 * gives nothing to go on is taken to be light.
 */
function pageIsDark(): boolean {
  const spots: [number, number][] = [[0.5, 0.12], [0.5, 0.5], [0.2, 0.8]];
  let dark = 0;
  let known = 0;
  for (const [x, y] of spots) {
    let el: Element | null = document.elementFromPoint(window.innerWidth * x, window.innerHeight * y);
    for (let depth = 0; el && depth < 16; el = el.parentElement, depth++) {
      const colour = /^rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor);
      const [r = 0, g = 0, b = 0, alpha = 1] = (colour?.[1] ?? "").split(/[\s,/]+/).filter(Boolean).map(Number);
      if (!colour || alpha < 0.5) continue;
      known++;
      if (0.2126 * r + 0.7152 * g + 0.0722 * b < 110) dark++;
      break;
    }
  }
  return known > 0 && dark * 2 > known;
}

/** One article under an answer: its title, linked when it has an address, and when it was last changed. */
function sourceRow(source: Source): HTMLElement {
  const row = document.createElement("li");
  const title = document.createElement(webAddress(source.url) ? "a" : "span");
  title.className = "title";
  title.textContent = source.title;
  if (title instanceof HTMLAnchorElement) Object.assign(title, { href: source.url, target: "_blank", rel: "noopener noreferrer" });
  row.append(title);
  const changed = source.updated ? new Date(`${source.updated}T00:00:00`) : undefined;
  if (changed && !Number.isNaN(changed.getTime())) {
    const day = changed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    row.append(source.stale ? `Updated ${day}. It may be out of date.` : `Updated ${day}`);
  }
  return row;
}

function webAddress(url: string | undefined): boolean {
  try {
    return /^https?:$/.test(new URL(url ?? "").protocol);
  } catch {
    return false;
  }
}
