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
  border-radius: 14px; padding: 6px 6px 6px 12px; box-shadow: 0 8px 24px rgba(0,0,0,.22); }
.caption .close { display: inline-flex; align-items: center; justify-content: center; flex: none; align-self: flex-start; width: 24px; height: 24px; border: 0;
  border-radius: 999px; background: rgba(250,250,249,.15); color: #fafaf9; pointer-events: auto; }
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
  /** The timer that keeps our element placed, while it is in use. */
  private placing?: ReturnType<typeof setInterval>;
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
    this.dock = pick(".dock");
    this.side = side;
    const launcher = pick<HTMLButtonElement>(".launcher");
    pick(".launcher span").textContent = appearance.launcherLabel;
    this.at = { x: side === "left" ? 60 : window.innerWidth - 60, y: window.innerHeight - 40 };

    launcher.addEventListener("click", () => {
      // Nothing kept our element in place while it was not in use. A dialog may have opened since.
      this.place();
      this.panel.hidden = !this.panel.hidden;
      this.keepPlaced();
      if (!this.panel.hidden) this.input.focus();
    });
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const question = this.input.value.trim();
      if (question) handlers.onAsk(question);
    });
    pick(".stop").addEventListener("click", handlers.onStop);
    pick(".close").addEventListener("click", handlers.onStop);

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
    this.setState("idle");
    this.place();
  }

  /**
   * Keeps our element placed while the visitor is using it: while the ask box
   * is open, and while a guide runs. Nothing of ours runs on a page where
   * neither is the case, so the timer stops then.
   */
  private keepPlaced() {
    const inUse = !this.panel.hidden || this.state === "asking" || this.state === "pointing" || this.state === "watching";
    if (inUse && this.placing === undefined) this.placing = setInterval(this.place, 500);
    else if (!inUse && this.placing !== undefined) {
      clearInterval(this.placing);
      this.placing = undefined;
    }
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
    if (this.captor && !(this.captor.isConnected && this.captor.getClientRects().length > 0)) this.captor = undefined;
    const home = this.captor ?? findOpenModal(this.host) ?? document.documentElement;
    if (this.host.parentNode === home) return;
    // Moving takes the keyboard from whatever of ours had it, so it is given back.
    const focused = this.host.shadowRoot?.activeElement as HTMLElement | null | undefined;
    home.appendChild(this.host);
    try {
      // Being a popover puts us in the top layer too, above anything the page stacks with z-index.
      this.host.showPopover();
    } catch {
      // No popover support. The fixed position and z-index still apply.
    }
    focused?.focus();
  };

  /**
   * A press on anything of ours is not a press outside the page's open list,
   * menu or calendar, and must not close it. Pages hear such a press on the
   * document or the window, for the most part as the mouse goes down, and
   * often in the capture phase, which runs before anything here can stop it.
   * So the press is cancelled: the browser then fires none of the mouse
   * events that follow it, though the click still comes. A cancelled press
   * also puts the keyboard nowhere, so a press into the ask box gives the box
   * the keyboard here. Once the box has it, a press in it is left alone, for
   * placing the cursor and selecting. Everything else a press sends is
   * stopped at our element, out of reach of the page's listeners.
   */
  private keepPressesOurs() {
    this.host.addEventListener("pointerdown", (event) => {
      const into = event.composedPath()[0];
      if (into === this.input && this.host.shadowRoot?.activeElement === this.input) return;
      event.preventDefault();
      if (into === this.input) this.input.focus();
    });
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "touchstart", "touchend", "focusout"]) {
      this.host.addEventListener(type, (event) => event.stopPropagation());
    }
  }

  /**
   * Notices the page pulling the keyboard out of the ask box the moment the
   * visitor put it there, which is what a menu that keeps the keyboard to
   * itself does, and moves the widget into whatever took it. A visitor who
   * moves the keyboard themselves, by clicking what took it or with Tab, is
   * left alone. Nothing is listened to outside our own element.
   */
  private watchKeyboard() {
    let wanted = 0;
    let tabbed = 0;
    this.host.addEventListener("pointerdown", () => (wanted = performance.now()));
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Tab") tabbed = performance.now();
    });
    this.input.addEventListener("focusout", (event) => {
      const to = event.relatedTarget;
      const now = performance.now();
      if (!(to instanceof Element) || to === this.captor || to.contains(this.host) || now - wanted > 500 || now - tabbed < 500) return;
      // What the visitor clicked has the mouse over it. A list that takes the keyboard back does not.
      if (to.matches(":hover")) return;
      this.captor = to;
      this.place();
      this.input.focus();
    });
  }

  /** Show the ask box busy with a message, or back to the input when `text` is empty. */
  setBusy(text: string) {
    this.form.hidden = text !== "";
    this.status.hidden = text === "";
    this.statusText.textContent = text;
    if (text) this.panel.hidden = false;
    else this.input.value = "";
    this.keepPlaced();
  }

  closePanel() {
    this.panel.hidden = true;
    this.keepPlaced();
  }

  /** Move the pointer to an element and show the caption beside it. With no text yet, the pointer goes alone. */
  pointAt(el: Element, text: string) {
    if (el !== this.pointed) {
      this.pointed = el;
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
    const box = this.caption.getBoundingClientRect();
    const left = this.host.shadowRoot?.querySelector(".dock.left") ? 20 : window.innerWidth - box.width - 20;
    this.caption.style.left = `${Math.max(12, left)}px`;
    this.caption.style.top = `${Math.max(12, window.innerHeight - box.height - 76)}px`;
  }

  clearPointer() {
    this.pointed = undefined;
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

    this.at = this.tipOn(el, rect);
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
