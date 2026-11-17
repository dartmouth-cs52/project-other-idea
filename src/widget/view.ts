// What the visitor can see of the page. On a computer that is the window. On
// a phone it is often less than the window the page is laid out in: the page
// is zoomed in, by a pinch or by the browser itself as a small field takes the
// keyboard; the keyboard is up and covers the foot of the window; or the page
// is wider than the screen, and the browser lays it out at its full width and
// shows part of it. Haptic draws against the window the page is laid out in
// (its elements are position: fixed), so anything it puts in a corner of that
// window, or keeps inside it, can be off the screen or under the keyboard.
//
// So everything Haptic places goes by this instead: the part of the page on
// the screen, measured as the page's boxes are measured. Browsers do not agree
// on where those measurements start. Chrome and Firefox measure from the
// window the page is laid out in, Safari from the part on the screen. Measured
// from where the page itself starts, the answer is right in both.

/** A box measured as getBoundingClientRect measures. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The part of the page the visitor can see, and how far it is zoomed in. */
export interface View extends Box {
  width: number;
  height: number;
  /** 1 when the page is shown at its own size, 2 when zoomed in to twice that. */
  scale: number;
}

/** What the visitor can see now. Reads the page's layout, so it is looked at once for each thing placed, not in a loop. */
export function inSight(): View {
  const whole = (): View => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight, scale: 1 });
  const shown = window.visualViewport;
  if (!shown || !(shown.width > 0) || !(shown.height > 0)) return whole();
  // Where the page starts, as boxes are measured: the top left of <html>, less any margin it has.
  const html = document.documentElement;
  const box = html.getBoundingClientRect();
  const style = getComputedStyle(html);
  const left = box.left - (parseFloat(style.marginLeft) || 0) + shown.pageLeft;
  const top = box.top - (parseFloat(style.marginTop) || 0) + shown.pageTop;
  if (!Number.isFinite(left) || !Number.isFinite(top)) return whole();
  const scale = Number.isFinite(shown.scale) && shown.scale > 0 ? shown.scale : 1;
  return { left, top, right: left + shown.width, bottom: top + shown.height, width: shown.width, height: shown.height, scale };
}

/**
 * How much Haptic's own launcher, chat and sentence are shrunk, or grown, so
 * they look their usual size on a page zoomed in or out: the inverse of the
 * zoom, within reason. A page zoomed to eight times does not get a chat an
 * eighth of the size, which no one could read.
 */
export function counterScale(view: View): number {
  const k = 1 / view.scale;
  return Math.abs(k - 1) < 0.01 ? 1 : Math.min(2, Math.max(0.35, k));
}
