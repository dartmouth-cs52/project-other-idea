// Is an element on screen but buried under something else, like a button
// beneath a stacked card or the page behind a modal backdrop? The browser
// answers this exactly: elementFromPoint returns whatever would take a click
// at that spot. We ask at the element's center and, if that misses, at four
// more points across its visible part.
//
// Only the uncommon path (center miss) reads styles, so the cost for a normal
// page is one hit test per on-screen element.

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type Hit = "self" | "other" | "skip";

export function isCovered(el: Element, rect: DOMRect, ignore: Element): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  const onScreen = intersect({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, { left: 0, top: 0, right: vw, bottom: vh });
  if (!onScreen) return false;

  const root = el.getRootNode();
  const hitter: DocumentOrShadowRoot = root instanceof ShadowRoot ? root : el.ownerDocument;
  let lastOther: Element | undefined;
  const test = (x: number, y: number): Hit => {
    const hit = hitter.elementFromPoint(x, y);
    if (!hit || contains(ignore, hit)) return "skip";
    if (contains(el, hit) || contains(hit, el) || isLabelOf(hit, el)) return "self";
    lastOther = hit;
    return "other";
  };

  if (test(mid(onScreen.left, onScreen.right), mid(onScreen.top, onScreen.bottom)) === "self") return false;

  // The center missed. Maybe the element is scrolled out of its own scroll
  // container, which isn't the same as covered: scrolling it into view works.
  const visible = intersect(onScreen, clipOf(el));
  if (!visible) return false;
  const xs = [0.5, 0.25, 0.75, 0.25, 0.75];
  const ys = [0.5, 0.25, 0.25, 0.75, 0.75];
  let others = 0;
  for (let i = 0; i < xs.length; i++) {
    const result = test(lerp(visible.left, visible.right, xs[i]!), lerp(visible.top, visible.bottom, ys[i]!));
    if (result === "self") return false;
    if (result === "other") others++;
  }
  if (others === 0 || !lastOther) return false;

  // A sticky header or fixed toolbar only covers the element where it sits
  // now. Scrolling the element to the middle of the screen, which pointing
  // does, uncovers it. A full-screen overlay still covers it there.
  const cover = fixedAncestor(lastOther);
  if (cover) {
    const box = cover.getBoundingClientRect();
    const height = Math.min(rect.height, vh);
    const landTop = vh / 2 - height / 2;
    if (box.bottom <= landTop || box.top >= landTop + height) return false;
  }
  return true;
}

function mid(a: number, b: number): number {
  return (a + b) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function intersect(a: Box, b: Box): Box | undefined {
  const box = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
  return box.right - box.left >= 1 && box.bottom - box.top >= 1 ? box : undefined;
}

function parentOf(node: Node): Node | null {
  return node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode;
}

/** Like Node.contains, but crosses shadow roots. */
function contains(ancestor: Node, node: Node): boolean {
  for (let current: Node | null = node; current; current = parentOf(current)) {
    if (current === ancestor) return true;
  }
  return false;
}

/** Custom checkboxes hide the input under a styled box inside its label. */
function isLabelOf(hit: Element, el: Element): boolean {
  const labels = (el as HTMLInputElement).labels;
  if (!labels) return false;
  for (const label of labels) if (contains(label, hit)) return true;
  return false;
}

/** The visible box left after every clipping ancestor, up to the first fixed one. */
function clipOf(el: Element): Box {
  let box: Box = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
  const doc = el.ownerDocument;
  for (let node = parentOf(el); node && node !== doc.body && node !== doc.documentElement; node = parentOf(node)) {
    if (!(node instanceof Element)) continue;
    const style = getComputedStyle(node);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      const rect = node.getBoundingClientRect();
      box = intersect(box, rect) ?? { left: 0, top: 0, right: 0, bottom: 0 };
    }
    if (style.position === "fixed") break;
  }
  return box;
}

function fixedAncestor(el: Element): Element | undefined {
  for (let node: Node | null = el; node; node = parentOf(node)) {
    if (!(node instanceof Element)) continue;
    const position = getComputedStyle(node).position;
    if (position === "fixed" || position === "sticky") return node;
  }
  return undefined;
}
