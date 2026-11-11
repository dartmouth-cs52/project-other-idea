import type { Appearance } from "../shared/types.ts";

// Everything Haptic draws: the launcher, the ask box, the pointer, the
// highlight ring and the caption. It all lives in one shadow root on one host
// element, so the customer's CSS can't reach it and ours can't leak out.
// Model text is only ever set as textContent.

const CSS = `
:host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; }
* { box-sizing: border-box; }
button { font: inherit; cursor: pointer; }
.dock { position: fixed; bottom: 20px; display: flex; flex-direction: column; gap: 10px; pointer-events: auto; }
.dock.right { right: 20px; align-items: flex-end; }
.dock.left { left: 20px; align-items: flex-start; }
.launcher { border: 0; border-radius: 999px; padding: 10px 18px; background: var(--accent); color: var(--on-accent);
  font-weight: 600; box-shadow: 0 4px 14px rgba(0,0,0,.22); }
.panel { width: min(340px, calc(100vw - 40px)); background: #fff; border: 1px solid rgba(0,0,0,.12); border-radius: 12px;
  padding: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.18); }
[hidden] { display: none !important; }
.panel form { display: flex; gap: 8px; }
.panel input { flex: 1; min-width: 0; font: inherit; padding: 8px 10px; border: 1px solid rgba(0,0,0,.2); border-radius: 8px; outline: none; }
.panel input:focus { border-color: var(--accent); }
.panel .send { border: 0; border-radius: 8px; padding: 0 14px; background: var(--accent); color: var(--on-accent); font-weight: 600; }
.status { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.status span { color: #444; }
.stop { border: 1px solid rgba(0,0,0,.2); background: #fff; border-radius: 8px; padding: 5px 10px; }
.ring { position: fixed; border: 2px solid var(--accent); border-radius: 8px; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent);
  transition: opacity .2s; }
.cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; transition: transform .55s cubic-bezier(.2,.8,.2,1);
  filter: drop-shadow(0 2px 4px rgba(0,0,0,.35)); will-change: transform; }
.cursor path { fill: var(--accent); stroke: #fff; stroke-width: 1.5; stroke-linejoin: round; }
.caption { position: fixed; max-width: min(320px, calc(100vw - 24px)); background: #111; color: #fff; border-radius: 10px;
  padding: 9px 30px 9px 12px; box-shadow: 0 8px 24px rgba(0,0,0,.25); pointer-events: auto; }
.caption .close { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border: 0; background: none; color: #bbb; font-size: 16px; line-height: 1; }
@media (prefers-reduced-motion: reduce) { .cursor { transition: none; } }
`;

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
    this.host.style.setProperty("--on-accent", readableOn(appearance.accent));
    const root = this.host.attachShadow({ mode: "open" });
    const side = appearance.position === "bottom-left" ? "left" : "right";
    root.innerHTML = `<style>${CSS}</style>
      <div class="ring" hidden></div>
      <div class="caption" hidden><span></span><button class="close" aria-label="Stop guide">×</button></div>
      <div class="cursor" hidden><svg viewBox="0 0 26 26" width="26" height="26"><path d="M4 2 L4 20 L9 15.5 L12.5 23 L15.5 21.6 L12 14.2 L19 14 Z"/></svg></div>
      <div class="dock ${side}">
        <div class="panel" hidden>
          <form><input type="text" placeholder="What do you want to do?" aria-label="Ask a question" maxlength="300"><button class="send" type="submit">Go</button></form>
          <div class="status" hidden><span></span><button class="stop" type="button">Stop</button></div>
        </div>
        <button class="launcher" type="button"></button>
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
    launcher.textContent = appearance.launcherLabel;
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
    this.place();
    setInterval(this.place, 500);
  }

  /**
   * Keeps our element on top and usable. A page's modal <dialog> sits in the
   * browser's top layer and makes everything outside it inert, so while one is
   * open we move inside it, and move back out when it closes.
   */
  place = () => {
    let modal: Element | undefined;
    try {
      modal = Array.from(document.querySelectorAll("dialog:modal")).pop();
    } catch {
      // :modal unsupported, so there's no top layer to compete with.
    }
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

  /** Move the pointer to an element and show the caption beside it. */
  pointAt(el: Element, text: string) {
    this.target = el;
    this.captionText.textContent = text;
    this.caption.hidden = false;
    this.cursor.hidden = false;
    // Paint once at the old spot so the transition has somewhere to start from.
    this.cursor.style.transform = `translate(${this.at.x}px, ${this.at.y}px)`;
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
    cancelAnimationFrame(this.frame);
    this.ring.hidden = true;
    this.cursor.hidden = true;
  }

  clear() {
    this.clearPointer();
    this.caption.hidden = true;
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

    // The arrow's tip sits a little inside the element, toward its lower right, so it doesn't cover the label.
    this.at = { x: rect.left + Math.min(rect.width * 0.7, rect.width - 6), y: rect.top + Math.min(rect.height * 0.6, rect.height - 4) };
    this.cursor.style.transform = `translate(${this.at.x - 4}px, ${this.at.y - 2}px)`;

    const box = this.caption.getBoundingClientRect();
    const below = rect.bottom + 14 + box.height < window.innerHeight;
    const top = below ? rect.bottom + 14 : Math.max(8, rect.top - box.height - 12);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - box.width - 8);
    this.caption.style.left = `${left}px`;
    this.caption.style.top = `${top}px`;
  };
}

/** Black or white text, whichever reads better on the accent color. */
function readableOn(hex: string): string {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!value) return "#fff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111" : "#fff";
}
