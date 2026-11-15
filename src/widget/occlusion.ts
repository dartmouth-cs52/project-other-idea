// Whether a control on screen is buried under something else, like a button
// beneath a stack of cards or the page behind a full-screen overlay. A visitor
// can't click it, so the model mustn't be shown it.
//
// The browser knows exactly: elementFromPoint returns whatever would take a
// click at a spot. We ask at the control's middle and, if something else is
// there, at four more spots across the part of it that can be seen. Styles are
// only read when the middle misses, so a normal page costs one hit test per
// control on screen.

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type Hit = "self" | "other" | "skip";

/**
 * True when the control is on screen and something else takes every click on
 * it. `ignore` is Haptic's own element, which never counts as covering
 * anything. A control only scrolled out of its own scroll box isn't covered,
 * and neither is one under a sticky header or a fixed toolbar that would show
 * once it is scrolled to the middle of the screen, which is what pointing does.
 */
export function isCovered(el: Element, rect: DOMRect, ignore: Element): boolean {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const onScreen = intersect(rect, { left: 0, top: 0, right: vw, bottom: vh });
  if (!onScreen) return false;

  const root = el.getRootNode();
  const hitter: DocumentOrShadowRoot = root instanceof ShadowRoot ? root : document;
  let lastOther: Element | undefined;
  const test = (x: number, y: number): Hit => {
    const hit = hitter.elementFromPoint(x, y);
    if (!hit || contains(ignore, hit)) return "skip";
    if (contains(el, hit) || contains(hit, el) || isLabelOf(hit, el)) return "self";
    lastOther = hit;
    return "other";
  };

  if (test(mid(onScreen.left, onScreen.right), mid(onScreen.top, onScreen.bottom)) === "self") return false;
  // A click goes straight through a control that takes none, so the test above can't find it. It isn't covered, just inert.
  if (getComputedStyle(el).pointerEvents === "none") return false;

  // The middle missed. A control scrolled out of its own scroll box isn't
  // covered: scrolling brings it back. Only the part left inside every box is tested.
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

  // A sticky header or fixed toolbar only covers the control where it is now.
  // Pointing scrolls the control to the middle of the screen, which uncovers
  // it. A full-screen overlay still covers it there.
  const cover = fixedAncestor(lastOther);
  if (cover) {
    const box = cover.getBoundingClientRect();
    const height = Math.min(rect.height, vh);
    const landTop = vh / 2 - height / 2;
    if (box.bottom <= landTop || box.top >= landTop + height) return false;
  }
  return true;
}

const mid = (a: number, b: number) => (a + b) / 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function intersect(a: Box, b: Box): Box | undefined {
  const box = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
  return box.right - box.left >= 1 && box.bottom - box.top >= 1 ? box : undefined;
}

function parentOf(node: Node): Node | null {
  return node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode;
}

/** Like Node.contains, but across shadow roots. */
function contains(ancestor: Node, node: Node): boolean {
  for (let current: Node | null = node; current; current = parentOf(current)) {
    if (current === ancestor) return true;
  }
  return false;
}

/** A styled checkbox often hides the real input under a box drawn inside its label. A click on the label still reaches it. */
function isLabelOf(hit: Element, el: Element): boolean {
  const labels = (el as HTMLInputElement).labels;
  if (!labels) return false;
  for (const label of labels) if (contains(label, hit)) return true;
  return false;
}

/** What is left of the screen after every box that clips the control, up to the first fixed one. */
function clipOf(el: Element): Box {
  let box: Box = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
  for (let node = parentOf(el); node && node !== document.body && node !== document.documentElement; node = parentOf(node)) {
    if (!(node instanceof Element)) continue;
    const style = getComputedStyle(node);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") box = intersect(box, node.getBoundingClientRect()) ?? { left: 0, top: 0, right: 0, bottom: 0 };
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
