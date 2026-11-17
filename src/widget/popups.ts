// What a control opened: its list, its menu, its calendar, its dialog.
//
// This is the popup-finding code of the guide's hearing (`waitForAction` in
// guide.ts), moved out so that the acting engine and the hearing can share it.
// Until the guide is switched over, guide.ts keeps its own copy; the two must
// say the same thing about the same page.
//
// A list or a menu that a control opens is rarely inside the control. It is
// put at the end of the page, drawn over everything, and tied to the control
// only by an id, if at all. So what a control opened is found three ways: by
// what the control says it controls, by a list or menu that has just come on
// show, and by any box drawn over the page that has just come on show.

/** The roles of what a control opens. */
export const POPUP_ROLES = '[role="listbox"], [role="menu"], [role="tree"], [role="grid"], [role="dialog"]';

/** A box drawn over the page, which is what a list or a menu that opens is. */
export function isLayer(el: Element): boolean {
  if (el.matches(`${POPUP_ROLES}, [popover]`)) return true;
  const position = getComputedStyle(el).position;
  return position === "absolute" || position === "fixed";
}

/** Whether the element is in the page and drawn. */
export function isDrawn(el: Element): boolean {
  if (!el.isConnected) return false;
  if (typeof el.checkVisibility === "function") return el.checkVisibility({ visibilityProperty: true });
  return el.getClientRects().length > 0;
}

/** What one control has opened, watched from a moment before it is used. */
export interface Popups {
  /**
   * Whether `el` has come on show since the watch began. Anything clicked that
   * has not was on the page to be clicked all along. A change of style or
   * class counts only on a box drawn over the page, since pages restyle rows
   * and cards as the mouse moves over them.
   */
  isNew(el: Element): boolean;
  /** The nearest box drawn over the page that `el` sits in, not counting any that hold the control. */
  layerOf(el: Element): Element;
  /** What the control says it opens, by id (`aria-controls`, `aria-owns`), once it is in the page. */
  popupOf(): Element | undefined;
  /** The control, something inside it, or a box around it says it is expanded. */
  isExpanded(): boolean;
  /** The first value of this attribute on the control, a box around it, or something inside it. */
  says(attribute: string): string;
  /**
   * Whether a click whose path is `path`, landing first on the control
   * `first`, was inside what the control opened. `opened` is set once the
   * control has been clicked into; `listed` says whether an element is one of
   * the page's listed controls. The popup found is remembered.
   */
  insidePopup(path: EventTarget[], first: Element, opened: boolean, listed: (el: Element) => boolean): boolean;
  /** The popup found so far, by `popupOf` or `insidePopup`, or set by the caller. */
  popup: Element | undefined;
  /**
   * The top elements that have come on show since the watch began: added to
   * the page, or a box whose hiding was changed. Newest last. Some may have
   * gone again; the caller checks what it needs.
   */
  fresh(): Element[];
  stop(): void;
}

/** Starts watching the page for what `target` opens. Stop it when done with: it observes the whole page. */
export function watchPopups(target: Element): Popups {
  const added = new WeakSet<Node>();
  const restyled = new WeakMap<Node, string>();
  /** What came on show, in order, kept to the most recent few hundred. */
  const order: Element[] = [];
  const note = (records: MutationRecord[]) => {
    for (const record of records) {
      if (record.type === "childList") {
        for (const node of record.addedNodes) {
          added.add(node);
          if (node instanceof Element) order.push(node);
        }
      } else {
        restyled.set(record.target, record.attributeName ?? "");
        if (record.target instanceof Element) order.push(record.target);
      }
    }
    if (order.length > 400) order.splice(0, order.length - 400);
  };
  const shown = new MutationObserver(note);
  shown.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "open", "aria-hidden", "style", "class"] });
  const flush = () => note(shown.takeRecords());

  const isNew = (el: Element): boolean => {
    flush();
    for (let at: Element | null = el; at && at !== document.body && at !== document.documentElement; at = at.parentElement) {
      if (at.contains(target)) return false;
      if (added.has(at)) return true;
      const how = restyled.get(at);
      if (how !== undefined && (how === "hidden" || how === "open" || how === "aria-hidden" || isLayer(at))) return true;
    }
    return false;
  };
  const layerOf = (el: Element): Element => {
    let top = el;
    for (let at: Element | null = el; at && at !== document.body && !at.contains(target); at = at.parentElement) {
      top = at;
      const position = getComputedStyle(at).position;
      if (position === "absolute" || position === "fixed") return at;
    }
    return top;
  };
  const says = (attribute: string) => [target, target.closest(`[${attribute}]`), target.querySelector(`[${attribute}]`)].map((el) => el?.getAttribute(attribute) ?? "").find(Boolean) ?? "";
  const isExpanded = () => [target, target.closest("[aria-expanded]"), target.querySelector("[aria-expanded]")].some((el) => el?.getAttribute("aria-expanded") === "true");

  const watch: Popups = {
    popup: undefined,
    isNew,
    layerOf,
    says,
    isExpanded,
    popupOf() {
      if (watch.popup?.isConnected) return watch.popup;
      for (const id of `${says("aria-controls")} ${says("aria-owns")}`.split(/\s+/).filter(Boolean)) {
        const el = document.getElementById(id);
        if (el && !el.contains(target)) return (watch.popup = layerOf(el));
      }
      return undefined;
    },
    insidePopup(path, first, opened, listed) {
      const root = watch.popupOf();
      if (root && path.includes(root)) return true;
      if (!isExpanded() && !opened) return false;
      // New since the watch began, and clicked after the control was clicked into: it is what the control opened.
      if (isNew(first) && !listed(first)) {
        watch.popup ??= layerOf(first);
        return true;
      }
      const box = first.closest(POPUP_ROLES);
      if (!box || box.contains(target) || !isExpanded()) return false;
      watch.popup ??= box;
      return true;
    },
    fresh() {
      flush();
      const seen = new Set<Element>();
      const tops: Element[] = [];
      for (const el of order) {
        if (seen.has(el) || !el.isConnected || el === document.body || el === document.documentElement) continue;
        seen.add(el);
        // A class changed on a row or a card is the page restyling itself, not something coming on show.
        if (isNew(el)) tops.push(el);
      }
      // Only the outermost of what came on show: a list added with its options is one thing.
      return tops.filter((el) => !tops.some((other) => other !== el && other.contains(el)));
    },
    stop() {
      shown.disconnect();
    },
  };
  return watch;
}
