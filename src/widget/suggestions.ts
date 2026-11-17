import { usableSuggestions } from "../shared/suggestions.ts";
import type { Suggestion } from "../shared/types.ts";
import type { AskBox, Ui } from "./ui.ts";

// Suggested questions: up to three short questions the company chose, as
// pills above the ask box, so a visitor who doesn't know what to ask has
// something to press. A press asks the question exactly as if it had been
// typed and sent, or, for one the company marked as Haptic's to do, presses
// Do it, where Do it is on show, with its first-use line and its gate as they
// always are. Everywhere else such a one is an ordinary question.
//
// They show while the panel is open on an empty ask box with nothing else of
// Haptic's going on (`AskBox.waiting`), and go the moment the visitor types,
// a guide starts or the panel closes. They are the company's own words, sent
// with the site's settings. A site with none gets nothing of this: no element,
// no style and no listener.
//
// They never stand in the visitor's way. Only the pills themselves take a
// press, never the space around and between them. They never lie over a
// control the page keeps in place as it scrolls, like the buttons of a top
// bar, the rule the launcher's own place follows: one that would, or that
// would reach into the top of the window, is left out, the last first, so a
// short window shows fewer or none. A control that scrolls can be scrolled
// out from under them, as from under the panel. And a press anywhere on the
// page puts them away until the visitor comes back to the ask box or opens
// the panel again. While they are away nothing of theirs listens on the page.

const CSS = `
.panel { position: relative; }
/* Above the panel, lined up with its edge on the launcher's side, one pill a line. The column takes no press itself. */
.suggest { position: absolute; bottom: calc(100% + 13px); right: -1px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  width: max-content; pointer-events: none; animation: suggest-in .2s var(--glide); }
.dock.left .suggest { right: auto; left: -1px; align-items: flex-start; }
.suggest .pill { display: block; max-width: 100%; pointer-events: auto; border: 1px solid rgba(28,25,23,.1); border-radius: 999px; padding: 9px 16px;
  background: #fff; color: #1c1917; font-weight: 500; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 6px 20px rgba(28,25,23,.12), 0 1px 3px rgba(28,25,23,.08); transition: background-color .15s ease-out, border-color .15s ease-out, color .15s ease-out; }
/* Pressable: dark, in the launcher's colour where the site chose one. */
.suggest .pill:hover, .suggest .pill:focus-visible { background: var(--launcher, #1c1917); border-color: var(--launcher, #1c1917); color: var(--launcher-ink, #fafaf9); }
.suggest .pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@keyframes suggest-in { from { opacity: 0; transform: translateY(4px); } }
@media (prefers-reduced-motion: reduce) { .suggest { animation: none; } .suggest .pill { transition: none; } }
`;

/** Presentation mode: larger type, as the caption and "What I did" are, so the room can read them. */
const PRESENT_CSS = `
.suggest { bottom: calc(100% + 17px); gap: 12px; }
.suggest .pill { padding: 12px 22px; font-size: 20px; line-height: 28px; box-shadow: 0 10px 28px rgba(28,25,23,.16), 0 2px 4px rgba(28,25,23,.1); }
.suggest .pill:focus-visible { outline-width: 3px; outline-offset: 3px; }
`;

/** The top of the window a pill may not reach into, in pixels. */
const TOP_ROOM = 12;
/** The least space kept between a pill and the window's far side. */
const SIDE_ROOM = 12;
/** How far apart the points are that a pill's box is looked at the page through, across it. Less than the smallest icon button. */
const LOOK_EVERY = 14;
/** What a visitor can press or type in, as the launcher's place reads it (`USABLE` in ui.ts). */
const CONTROL =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"], [role="radio"], [role="menuitem"], [role="combobox"], [tabindex]:not([tabindex="-1"])';

/** Puts the site's suggested questions above the ask box. Nothing at all happens for a site with none. */
export function showSuggestions(ui: Ui, given: unknown): void {
  const list = usableSuggestions(given);
  if (!list.length) return;
  try {
    new Suggestions(ui, list);
  } catch (error) {
    console.warn("[Haptic]", error);
  }
}

class Suggestions {
  private readonly group: HTMLElement;
  private readonly box: AskBox;
  /** The ask box is open and empty, so the pills are on show if there is room for them, and what changes the room is listened for. */
  private wanted = false;
  /** A press on the page put them away, until the visitor comes back to the ask box or opens the panel again. */
  private away = false;
  private resized?: ResizeObserver;

  constructor(
    private readonly ui: Ui,
    private readonly list: Suggestion[],
  ) {
    this.group = document.createElement("div");
    this.group.className = "suggest";
    this.group.setAttribute("role", "group");
    this.group.setAttribute("aria-label", "Suggested questions");
    this.group.hidden = true;
    list.forEach((one, index) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "pill";
      pill.dataset.index = String(index);
      pill.textContent = one.text;
      this.group.append(pill);
    });
    this.box = ui.lend({ el: this.group, changed: this.look, press: this.press });
    adopt(this.box.root, this.box.present ? CSS + PRESENT_CSS : CSS);
    // Back in the ask box: put away by a press on the page, they come back.
    this.box.field.addEventListener("focus", () => {
      if (!this.away) return;
      this.away = false;
      this.look();
    });
    this.look();
  }

  /** Shows the pills that fit, or puts them away, as the ask box stands now. */
  private look = () => {
    try {
      if (!this.box.open()) this.away = false;
      const wanted = !this.away && this.box.waiting();
      this.listen(wanted);
      this.group.hidden = !(wanted && this.fit());
    } catch (error) {
      // Part way through being laid out, they are put away rather than left as they were.
      this.group.hidden = true;
      console.warn("[Haptic]", error);
    }
  };

  /**
   * Shows the pills, the first ones the company listed, as many as fit above
   * the panel without reaching into the top of the window or lying over a
   * control the page keeps in place. False when none fit.
   */
  private fit(): boolean {
    const pills = Array.from(this.group.querySelectorAll<HTMLButtonElement>(".pill"));
    this.group.hidden = false;
    const panel = this.group.parentElement?.getBoundingClientRect();
    if (panel) {
      // As wide as the room between the panel's far edge and the other side of the window, so a long one is cut, not pushed off.
      const right = !this.group.matches(".dock.left .suggest");
      this.group.style.maxWidth = `${Math.max(0, right ? panel.right - SIDE_ROOM : window.innerWidth - panel.left - SIDE_ROOM)}px`;
    }
    const pinned = new Map<Element, boolean>();
    for (let count = pills.length; count > 0; count--) {
      // The stack keeps to the panel, so with one fewer the others move down: each count is laid out and looked at afresh.
      pills.forEach((pill, index) => (pill.hidden = index >= count));
      if (pills.slice(0, count).every((pill) => this.clear(pill.getBoundingClientRect(), pinned))) return true;
    }
    return false;
  }

  /** Whether a pill here keeps out of the top of the window and off every control of the page's that stays put as it scrolls. */
  private clear(box: DOMRect, pinned: Map<Element, boolean>): boolean {
    if (box.top < TOP_ROOM) return false;
    const huge = (window.innerWidth * window.innerHeight) / 3;
    for (let x = box.left + 4; x < box.right; x += LOOK_EVERY) {
      for (const y of [box.top + box.height * 0.15, box.top + box.height / 2, box.top + box.height * 0.85]) {
        const under = document.elementsFromPoint(x, y).find((el) => el !== this.ui.host);
        const control = under?.closest(CONTROL);
        if (!control) continue;
        // A box as big as a good part of the window holds controls rather than being one, as for the launcher.
        const rect = control.getBoundingClientRect();
        if (rect.width * rect.height > huge) continue;
        if (!pinned.has(control)) pinned.set(control, staysPut(control));
        if (pinned.get(control)) return false;
      }
    }
    return true;
  }

  /** What is listened for only while the pills are wanted: a press on the page, and the window or the panel changing size. */
  private listen(on: boolean) {
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) {
      document.addEventListener("pointerdown", this.pressedPage, { capture: true, passive: true });
      window.addEventListener("resize", this.look, { passive: true });
      if (typeof ResizeObserver === "function" && this.group.parentElement) {
        this.resized = new ResizeObserver(this.look);
        this.resized.observe(this.group.parentElement);
      }
    } else {
      document.removeEventListener("pointerdown", this.pressedPage, { capture: true });
      window.removeEventListener("resize", this.look);
      this.resized?.disconnect();
      this.resized = undefined;
    }
  }

  /** A press anywhere on the page but on Haptic: the visitor has turned to the page, and the pills go. */
  private pressedPage = (event: PointerEvent) => {
    if (event.composedPath().includes(this.ui.host)) return;
    this.away = true;
    this.look();
  };

  /** A pill was pressed: its question is asked, as if typed and sent, or with Do it for one the company marked so. */
  private press = (button: HTMLButtonElement) => {
    try {
      const one = this.list[Number(button.dataset.index)];
      if (!one || this.group.hidden || !this.box.waiting()) return;
      this.box.ask(one.text, one.act === true);
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  };
}

/** Whether an element, or a box it sits in, stays put on screen when the page scrolls, as `pinned` in ui.ts reads it. */
function staysPut(el: Element): boolean {
  for (let at: Node | null = el; at; at = at.parentNode ?? (at as ShadowRoot).host ?? null) {
    if (!(at instanceof Element)) continue;
    const position = getComputedStyle(at).position;
    if (position === "fixed" || position === "sticky") return true;
  }
  return false;
}

/** Adds the pills' styles to the widget's own, from a stylesheet object where the browser has them, as ui.ts does. */
function adopt(root: ShadowRoot, css: string) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return;
  } catch {
    // No stylesheet objects in this browser.
  }
  const style = document.createElement("style");
  style.textContent = css;
  root.append(style);
}
