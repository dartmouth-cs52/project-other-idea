import type { Snapshot } from "../../src/shared/types.ts";

// Runs inside the page under test, beside the widget. It is bundled on its own
// and handed to the page as text (see session.ts), so it carries no build
// helpers from this project.
//
// It reads the page and never changes it: no attributes are set and no events
// are sent. Elements are handed to the runner as numbers, so that the same
// element can be named across calls.

interface Probe {
  takeSnapshot(ignore: Element, question: string): { snapshot: Snapshot; elements: Map<string, Element> };
}

declare global {
  interface Window {
    /** The widget's own reading of the page, from the checkout under test. */
    __hapticProbe?: Probe;
    /** The same reading with its length limits lifted, to tell "cut by the limit" from "never read". */
    __hapticProbeAll?: Probe;
    __hapticToolkit?: typeof toolkit;
  }
}

const handles = new Map<Element, number>();
const elements: Element[] = [];
let container: Element | undefined;

function reg(el: Element): number {
  let handle = handles.get(el);
  if (handle === undefined) {
    handle = elements.length;
    elements.push(el);
    handles.set(el, handle);
  }
  return handle;
}

const at = (handle: number): Element | undefined => elements[handle];

/** Whether `inner` is inside `outer`, through any shadow roots between them. */
function within(outer: Element, inner: Node | null): boolean {
  for (let node: Node | null = inner; node; node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)) {
    if (node === outer) return true;
  }
  return false;
}

/** Haptic's own element. It moves into an open dialog, which may be inside a shadow root. */
function host(): Element | undefined {
  const found = document.querySelector("haptic-root");
  if (found) return found;
  const search = (root: Document | ShadowRoot): Element | undefined => {
    for (const el of root.querySelectorAll("*")) {
      if (el.tagName === "HAPTIC-ROOT") return el;
      if (el.shadowRoot) {
        const inner = search(el.shadowRoot);
        if (inner) return inner;
      }
    }
    return undefined;
  };
  return search(document);
}

const isHaptic = (node: Node | null) => {
  const h = host();
  return !!h && !!node && within(h, node);
};

/** The element really under a point, through open shadow roots. Haptic's own parts count. */
function deepHit(x: number, y: number): Element | null {
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

/** Whether a box is where descendants with this position are laid out from, which is what makes it clip them. */
function holds(box: CSSStyleDeclaration, position: string): boolean {
  const makesBlock = box.transform !== "none" || box.filter !== "none" || /paint|layout|strict|content/.test(box.contain) || box.willChange.includes("transform");
  if (position === "fixed") return makesBlock;
  if (position === "absolute") return box.position !== "static" || makesBlock;
  return true;
}

/**
 * The part of an element's box that is not clipped away by a scrolling or
 * clipping box around it. A box positioned out of the flow is clipped only by
 * the boxes it is laid out from, so a popup put in a box of no height at the
 * end of the page is still seen.
 */
function visibleRect(el: Element): DOMRect | undefined {
  const rect = el.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top;
  let right = rect.right;
  let bottom = rect.bottom;
  let position = getComputedStyle(el).position;
  let node: Element | null = el.parentElement;
  for (let depth = 0; node && depth < 60; depth++, node = node.parentElement) {
    const style = getComputedStyle(node);
    if (!holds(style, position)) continue;
    if (style.position !== "static" || position === "fixed") position = style.position === "static" ? "relative" : style.position;
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const clip = node.getBoundingClientRect();
    if (style.overflowX !== "visible") {
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
    }
    if (style.overflowY !== "visible") {
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
    }
  }
  if (right - left <= 0 || bottom - top <= 0) return undefined;
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Whether a person could see the control or the label that stands for it. */
function shown(el: Element): boolean {
  if (!el.isConnected) return false;
  const rendered = typeof el.checkVisibility === "function" ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0;
  if (!rendered) return false;
  const box = visibleRect(el);
  // A box of a pixel is there for screen readers only, like a focus trap's sentinel. A real input
  // clipped away inside a visible thumb or tick box keeps its full box, and counts.
  const hiddenForEyes = !!box && box.width <= 1.5 && box.height <= 1.5;
  if (box && !hiddenForEyes) return true;
  // A box drawn in place of a hidden real input: the visitor uses its label.
  const labels = (el as HTMLInputElement).labels;
  return !!labels && Array.from(labels).some((label) => !!visibleRect(label));
}

function markup(el: Element | undefined, max = 360): string {
  if (!el) return "";
  const open = el.outerHTML.slice(0, el.outerHTML.indexOf(">") + 1).replace(/\s(style)="[^"]*"/g, "");
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const inner = el.children.length ? `${text ? `${text.slice(0, 60)} ` : ""}[${el.children.length} children]` : text.slice(0, 80);
  const whole = `${open.length > max ? open.slice(0, max) + "…>" : open}${inner}</${tag}>`;
  // A control is often only understood with the box it sits in.
  const parent = el.parentElement;
  if (!parent || whole.length > max) return whole;
  const parentOpen = parent.outerHTML.slice(0, parent.outerHTML.indexOf(">") + 1).replace(/\s(style)="[^"]*"/g, "");
  return `${parentOpen.slice(0, 160)}${whole}…`;
}

/** Nodes put into the page since the demo was first read. Only observed: nothing on the page is changed. */
const added = new WeakSet<Node>();
/** The same, in order, kept only to tell whether anything new is on screen. */
let addedList: Element[] = [];
let watching: MutationObserver | undefined;

const toolkit = {
  /** Starts noting what the page adds from now on, so that what a control opens can be told from what was there. */
  watchAdded() {
    watching?.disconnect();
    addedList = [];
    watching = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          added.add(node);
          if (node instanceof Element && addedList.length < 5000) addedList.push(node);
        }
      }
    });
    watching.observe(document.documentElement, { subtree: true, childList: true });
  },

  /** How many boxes put into the page since the watch began are on screen now, Haptic's own aside. */
  addedShown() {
    return addedList.filter((el) => el.isConnected && !isHaptic(el) && el.getClientRects().length > 0 && !!visibleRect(el)).length;
  },

  /** Whether the element, or a box around it, was put into the page since the watch began. */
  isAdded(handle: number) {
    for (let node: Node | null = at(handle) ?? null; node; node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)) {
      if (added.has(node)) return true;
    }
    return false;
  },

  /** Gives an element a number, the same one each time it is asked about. */
  reg,

  setContainer(handle: number) {
    container = at(handle);
  },

  hasProbe: () => !!window.__hapticProbe && !!host(),

  /** The widget's reading of the page as it is now, with a number for each listed element. */
  snap(all: boolean) {
    const probe = all ? window.__hapticProbeAll : window.__hapticProbe;
    const ignore = host();
    if (!probe || !ignore) throw new Error("The widget is not on the page.");
    // No question is asked here, so nothing on the page is the visitor's own words.
    const { snapshot, elements: listed } = probe.takeSnapshot(ignore, "");
    const ids: Record<string, number> = {};
    const inDemo: Record<string, boolean> = {};
    for (const [id, el] of listed) {
      ids[id] = reg(el);
      inDemo[id] = !!container && within(container, el);
    }
    return { snapshot, ids, inDemo };
  },

  /** For each element: whether a person could see it, and whether it is in the demo. */
  where(list: number[], roles: string[] = []) {
    return list.map((handle, i) => {
      const el = at(handle);
      // A cell or a column header that holds a control is only where the control sits.
      const holdsControl = !!el && (roles[i] === "gridcell" || roles[i] === "columnheader") && list.some((other) => other !== handle && within(el, at(other) ?? null));
      return {
        shown: !!el && shown(el),
        inDemo: !!el && !!container && within(container, el),
        haptic: !!el && isHaptic(el),
        tag: el?.tagName.toLowerCase() ?? "",
        selectable: !!el?.hasAttribute("aria-selected"),
        sortable: !!el?.hasAttribute("aria-sort"),
        holdsControl,
      };
    });
  },

  /** Whether the element is inside any of these. */
  insideAny(handle: number, list: number[]) {
    const el = at(handle);
    return !!el && list.some((other) => other !== handle && within(at(other) ?? document.createElement("i"), el));
  },

  /** The element's box, to tell when the page has stopped scrolling it. */
  boxOf(handle: number) {
    const r = at(handle)?.getBoundingClientRect();
    return r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : "";
  },

  /**
   * For each control the accessibility tree has, which listed element stands
   * for it. A list may name the control itself, the real input inside a box
   * that has the role, or a box around the control with nothing else in it.
   */
  relate(expected: number[], listed: Record<string, number>) {
    const wanted = expected.map(at);
    const entries = Object.entries(listed).map(([id, handle]) => ({ id, el: at(handle) }));
    const found = wanted.map((el) => {
      if (!el) return undefined;
      const same = entries.find((entry) => entry.el === el);
      if (same) return same.id;
      // The tree's control is a box, and the list names what is inside it. Only if no other control of the tree is nearer.
      const inner = entries.find(
        (entry) => entry.el && entry.el !== el && within(el, entry.el) && !wanted.some((other) => other && other !== el && within(el, other) && within(other, entry.el!)),
      );
      if (inner) return inner.id;
      // The list names a box around the control, and that box holds no other control of the tree.
      const outer = entries.find((entry) => entry.el && within(entry.el, el) && !wanted.some((other) => other && other !== el && within(entry.el!, other)));
      if (outer) return outer.id;
      // The list names the label that stands for a hidden input.
      const labels = (el as HTMLInputElement).labels;
      const label = labels && entries.find((entry) => entry.el && Array.from(labels).includes(entry.el as HTMLLabelElement));
      if (label) return label.id;
      // A native choice is listed as one of its select's options.
      const select = el instanceof HTMLOptionElement ? el.closest("select") : null;
      return select ? entries.find((entry) => entry.el === select)?.id : undefined;
    });
    // A box the tree calls a control around exactly one other control, like a menu item around its link, is that control.
    return found.map((id, i) => {
      const el = wanted[i];
      if (id || !el) return id;
      const inner = wanted.flatMap((other, j) => (other && other !== el && within(el, other) ? [j] : []));
      return inner.length === 1 ? found[inner[0]!] : undefined;
    });
  },

  markup: (handle: number) => markup(at(handle)),

  /** The element the widget's pointer is on, as a number, or -1. */
  pointed(): number {
    const el = (host() as (Element & { pointedAt?: Element }) | undefined)?.pointedAt;
    return el ? reg(el) : -1;
  },

  /** Whether the pointer is on this element, or on a box that holds it or that it holds. */
  pointedNear(handle: number): boolean {
    const el = at(handle);
    const pointedAt = (host() as (Element & { pointedAt?: Element }) | undefined)?.pointedAt;
    return !!el && !!pointedAt && (pointedAt === el || within(pointedAt, el) || within(el, pointedAt));
  },

  /**
   * Where a person would click the element: its middle if nothing is in front
   * of it there, or else the first point of its box that is the element's own.
   * Says when Haptic's own caption or button was what stood in front.
   */
  aim(handle: number) {
    const el = at(handle);
    if (!el) return undefined;
    const box = visibleRect(el) ?? el.getBoundingClientRect();
    const labels = Array.from((el as HTMLInputElement).labels ?? []);
    const own = (hit: Element | null) => {
      if (!hit) return false;
      if (hit === el || within(el, hit) || labels.some((label) => label === hit || within(label, hit))) return true;
      // A small box drawn over a hidden input, which holds the input.
      if (!within(hit, el)) return false;
      const r = hit.getBoundingClientRect();
      return r.width * r.height <= Math.max(4 * box.width * box.height, 2500);
    };
    const points: [number, number][] = [[0.5, 0.5]];
    for (const fx of [0.3, 0.7, 0.15, 0.85]) for (const fy of [0.5, 0.3, 0.7]) points.push([fx, fy]);
    // A hidden input drawn as a box beside its words: the words are the place to click.
    for (const label of labels) {
      const r = visibleRect(label);
      if (r) points.push([(r.left + r.width / 2 - box.left) / Math.max(box.width, 1), (r.top + r.height / 2 - box.top) / Math.max(box.height, 1)]);
    }
    let coveredByHaptic = false;
    let blocker = "";
    for (const [fx, fy] of points) {
      const x = box.left + box.width * fx;
      const y = box.top + box.height * fy;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
      const hit = deepHit(x, y);
      if (isHaptic(hit)) {
        coveredByHaptic = true;
        continue;
      }
      if (own(hit)) return { x, y, coveredByHaptic, blocker: "" };
      blocker ||= markup(hit ?? undefined, 160);
    }
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, coveredByHaptic, blocker: blocker || "nothing of the element is inside the window" };
  },

  /** Which of these elements have Haptic's own caption or button on top of their middle. */
  underHaptic(list: number[]) {
    return list.map((handle) => {
      const el = at(handle);
      const box = el && visibleRect(el);
      return !!box && isHaptic(deepHit(box.left + box.width / 2, box.top + box.height / 2));
    });
  },

  /** Where Haptic's launcher is, whether its box is open, and what is typed in it. */
  haptic() {
    const h = host();
    const root = h?.shadowRoot;
    const launcher = root?.querySelector(".launcher")?.getBoundingClientRect();
    const panel = root?.querySelector(".panel") as HTMLElement | null | undefined;
    const input = root?.querySelector(".ask input") as HTMLInputElement | null | undefined;
    return {
      there: !!h,
      launcher: launcher ? { x: launcher.left + launcher.width / 2, y: launcher.top + launcher.height / 2 } : undefined,
      open: !!panel && !panel.hidden,
      // Haptic's own box, read to know whether the visitor's keys reached it. Never a field of the page.
      typed: input?.value ?? "",
      focused: !!input && root?.activeElement === input,
      input: input ? (() => {
        const r = input.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })() : undefined,
    };
  },

  /** Brings the demo into the middle of the window, as a visitor scrolling to it would. */
  showDemo() {
    if (!container) return false;
    const tall = container.getBoundingClientRect().height > window.innerHeight * 0.8;
    container.scrollIntoView({ block: tall ? "start" : "center", inline: "nearest" });
    return true;
  },

  /** What a control is, for a report: its tag and the start of its markup. */
  describe: (handle: number) => {
    const el = at(handle);
    return el ? { tag: el.tagName.toLowerCase(), markup: markup(el) } : undefined;
  },
};

window.__hapticToolkit = toolkit;
