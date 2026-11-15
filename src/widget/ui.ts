import type { Appearance } from "../shared/types.ts";
import { findOpenModal } from "./snapshot.ts";

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

const CSS = `
:host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
  font: 14px/20px system-ui, -apple-system, "Segoe UI", sans-serif; color: #1c1917; }
* { box-sizing: border-box; }
button { font: inherit; cursor: pointer; }
.dock { position: fixed; bottom: 20px; display: flex; flex-direction: column; gap: 10px; pointer-events: auto; }
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
.panel .send { display: inline-flex; align-items: center; justify-content: center; align-self: flex-end; width: 32px; height: 32px; margin: 6px 10px 8px; border: 0;
  border-radius: 999px; background: #1c1917; color: #fafaf9; }
.panel .send svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.status { display: flex; align-items: center; justify-content: space-between; gap: 10px; height: 36px; padding: 0 2px 0 12px; }
.status span { color: #78716c; }
.stop { height: 28px; border: 1px solid #e7e5e4; background: #fff; color: #78716c; border-radius: 999px; padding: 0 12px; font-size: 13px; }
.ring { position: fixed; border: 2px solid var(--accent); border-radius: 10px; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent);
  transition: opacity .2s; }
.cursor { position: fixed; left: 0; top: 0; width: 24px; height: 24px; transition: transform .55s cubic-bezier(.2,.8,.2,1);
  filter: drop-shadow(0 1px 1px rgba(0,0,0,.3)) drop-shadow(0 5px 9px rgba(0,0,0,.26)); will-change: transform; }
.cursor svg { display: block; overflow: visible; }
.cursor path { fill: var(--accent); stroke: #fff; stroke-width: 3; stroke-linejoin: round; paint-order: stroke; }
.caption { position: fixed; display: flex; align-items: center; gap: 8px; max-width: min(320px, calc(100vw - 24px)); background: #1c1917; color: #fafaf9;
  border-radius: 14px; padding: 6px 6px 6px 12px; box-shadow: 0 8px 24px rgba(0,0,0,.22); pointer-events: auto; }
.caption .close { display: inline-flex; align-items: center; justify-content: center; flex: none; align-self: flex-start; width: 24px; height: 24px; border: 0;
  border-radius: 999px; background: rgba(250,250,249,.15); color: #fafaf9; }
.caption .close:hover { background: rgba(250,250,249,.25); }
.caption .close svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; }
@media (prefers-reduced-motion: reduce) { .cursor { transition: none; } }
`;

/**
 * Where a guide is, for anything outside that needs to know: tests, the
 * benchmark, a customer's own script.
 * - "idle": no guide has run on this page yet.
 * - "asking": a question has been sent and the answer is not yet on show.
 * - "pointing": a pointer is on show and the widget is waiting for the visitor to use it.
 * - "watching": a sentence is on show with no pointer, and the widget is waiting for the visitor to do what it says.
 * - "finished": the guide is over. Its last sentence may still be on show. It stays this way until the next question.
 */
export type GuideState = "idle" | "asking" | "pointing" | "watching" | "finished";

export interface UiHandlers {
  onAsk: (question: string) => void;
  onStop: () => void;
}

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
  private target?: Element;
  private frame = 0;
  /** Where the pointer last was, so each move starts from there. */
  private at: { x: number; y: number };

  constructor(appearance: Appearance, handlers: UiHandlers) {
    this.host = document.createElement("haptic-root");
    this.host.style.setProperty("--accent", appearance.accent);
    const root = this.host.attachShadow({ mode: "open" });
    const side = appearance.position === "bottom-left" ? "left" : "right";
    root.innerHTML = `<style>${CSS}</style>
      <div class="ring" hidden></div>
      <div class="caption" hidden><span></span><button class="close" aria-label="Stop guide"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <div class="cursor" hidden><svg viewBox="0 0 24 24" width="24" height="24"><path d="${POINTER_PATH}"/></svg></div>
      <div class="dock ${side}">
        <div class="panel" hidden>
          <form><input type="text" placeholder="What do you want to do?" aria-label="Ask a question" maxlength="300"><button class="send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></form>
          <div class="status" hidden><span></span><button class="stop" type="button">Stop</button></div>
        </div>
        <button class="launcher" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${POINTER_PATH}"/></svg><span></span></button>
      </div>`;
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
    const launcher = pick<HTMLButtonElement>(".launcher");
    pick(".launcher span").textContent = appearance.launcherLabel;
    this.at = { x: side === "left" ? 60 : window.innerWidth - 60, y: window.innerHeight - 40 };

    launcher.addEventListener("click", () => {
      this.panel.hidden = !this.panel.hidden;
      if (!this.panel.hidden) this.input.focus();
    });
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const question = this.input.value.trim();
      if (question) handlers.onAsk(question);
    });
    pick(".stop").addEventListener("click", handlers.onStop);
    pick(".close").addEventListener("click", handlers.onStop);

    // Typing in the ask box mustn't trigger the page's keyboard shortcuts or focus traps.
    for (const type of ["keydown", "keyup", "keypress", "focusin"]) {
      this.host.addEventListener(type, (event) => {
        if (type === "keydown" && (event as KeyboardEvent).key === "Escape") this.panel.hidden = true;
        event.stopPropagation();
      });
    }
    this.host.setAttribute("popover", "manual");
    this.setState("idle");
    this.place();
    setInterval(this.place, 500);
  }

  /**
   * Keeps our element on top and usable. A dialog shuts out everything
   * outside it: the browser's own <dialog> makes the rest of the page inert,
   * and the ones apps build pull the keyboard back whenever it leaves them,
   * or mark the rest of the page inert themselves. So while a dialog is open
   * we move inside it, where a visitor can still type a question, and move
   * back out when it closes.
   */
  place = () => {
    const modal = findOpenModal(this.host);
    const home = modal ?? document.documentElement;
    if (this.host.parentNode === home) return;
    home.appendChild(this.host);
    try {
      // Being a popover puts us in the top layer too, above anything the page stacks with z-index.
      this.host.showPopover();
    } catch {
      // No popover support. The fixed position and z-index still apply.
    }
  };

  /** Show the ask box busy with a message, or back to the input when `text` is empty. */
  setBusy(text: string) {
    this.form.hidden = text !== "";
    this.status.hidden = text === "";
    this.statusText.textContent = text;
    if (text) this.panel.hidden = false;
    else this.input.value = "";
  }

  closePanel() {
    this.panel.hidden = true;
  }

  /** Move the pointer to an element and show the caption beside it. With no text yet, the pointer goes alone. */
  pointAt(el: Element, text: string) {
    this.target = el;
    this.mark(el);
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
    const box = this.caption.getBoundingClientRect();
    const left = this.host.shadowRoot?.querySelector(".dock.left") ? 20 : window.innerWidth - box.width - 20;
    this.caption.style.left = `${Math.max(12, left)}px`;
    this.caption.style.top = `${Math.max(12, window.innerHeight - box.height - 76)}px`;
  }

  clearPointer() {
    this.target = undefined;
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
  }

  /**
   * Keeps the control the pointer is on readable from outside, as a property
   * of our own element. Nothing on the customer's page is touched. Tests and
   * the benchmark use it to act on what a visitor is being shown.
   */
  private mark(el: Element | undefined) {
    (this.host as HTMLElement & { pointedAt?: Element }).pointedAt = el;
  }

  /** Follows the target every frame, so scrolling and layout shifts don't strand the pointer. */
  private track = () => {
    const el = this.target;
    if (!el) return;
    this.frame = requestAnimationFrame(this.track);
    if (!el.isConnected) {
      this.ring.hidden = true;
      return;
    }
    const rect = el.getBoundingClientRect();
    const onScreen = rect.bottom > 0 && rect.top < window.innerHeight && rect.width + rect.height > 0;
    this.ring.hidden = !onScreen;
    if (!onScreen) return;

    const pad = 4;
    this.ring.style.left = `${rect.left - pad}px`;
    this.ring.style.top = `${rect.top - pad}px`;
    this.ring.style.width = `${rect.width + pad * 2}px`;
    this.ring.style.height = `${rect.height + pad * 2}px`;

    // The tip sits in the element's lower right corner, so the pointer hangs off it and never covers the label.
    this.at = { x: rect.right - Math.min(10, rect.width * 0.2), y: rect.bottom - Math.min(7, rect.height * 0.25) };
    this.cursor.style.transform = `translate(${this.at.x - POINTER_TIP.x}px, ${this.at.y - POINTER_TIP.y}px)`;

    const box = this.caption.getBoundingClientRect();
    const below = rect.bottom + 14 + box.height < window.innerHeight;
    const top = below ? rect.bottom + 14 : Math.max(8, rect.top - box.height - 12);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - box.width - 8);
    this.caption.style.left = `${left}px`;
    this.caption.style.top = `${top}px`;
  };
}
