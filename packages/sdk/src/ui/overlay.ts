import { signal } from "@preact/signals";
import { backgroundAt, isDark } from "./tone.ts";

// The pointer and highlight are driven directly rather than through Preact,
// because they update every animation frame while tracking a target.

const POINTER_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 2.5 L19.5 11 L12.2 12.6 L8.6 19.5 Z" fill="var(--pointer-fill)" stroke="var(--pointer-edge)" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
/** Where the arrow's tip sits inside its 24px box. */
const TIP = { x: 3.5, y: 2.5 };
const MOUSE_OFFSET = { x: 16, y: 18 };
const FLIGHT_MS = 420;
/** Minimum time a point stays put before the next queued point moves it. */
const DWELL_MS = 1300;
/** How often the pointer re-checks the color under it while it moves with the page. */
const TONE_EVERY_MS = 400;

type Mode = "hidden" | "follow" | "flying" | "target";

export class Overlay {
  /** The element currently pointed at, for caption placement. */
  readonly target = signal<Element | null>(null);

  private readonly pointerEl: HTMLDivElement;
  private readonly highlightEl: HTMLDivElement;
  private mode: Mode = "hidden";
  private mouse = { x: window.innerWidth - 140, y: window.innerHeight - 120 };
  private pos = { x: 0, y: 0 };
  private frame = 0;
  private queue: Promise<void> = Promise.resolve();
  private lastArrival = 0;
  private generation = 0;
  private flight?: Animation;
  /** A customer accent color, or undefined for black and white. */
  private accent?: string;
  private toneCheckedAt = 0;
  private readonly ignore: Element;

  constructor(layer: HTMLElement, ignore: Element) {
    this.ignore = ignore;
    this.highlightEl = document.createElement("div");
    this.highlightEl.className = "highlight";
    this.pointerEl = document.createElement("div");
    this.pointerEl.className = "pointer";
    this.pointerEl.innerHTML = POINTER_SVG;
    layer.append(this.highlightEl, this.pointerEl);
    this.applyInk(false);
    window.addEventListener("pointermove", this.onPointerMove, { capture: true, passive: true });
  }

  /** "auto" (the default) keeps the pointer black and white. A hex color colors it instead. */
  setAccent(accent: string) {
    this.accent = /^#[0-9a-f]{6}$/i.test(accent) ? accent : undefined;
    this.applyInk(false);
  }

  /** Black on light backgrounds, white on dark ones, judged at the given point. */
  private updateInk(x: number, y: number) {
    this.toneCheckedAt = performance.now();
    if (this.accent) return;
    try {
      this.applyInk(isDark(backgroundAt(x, y, this.ignore)));
    } catch {
      // Keep the current color.
    }
  }

  private applyInk(onDark: boolean) {
    const fill = this.accent ?? (onDark ? "#ffffff" : "#0a0a0a");
    const edge = this.accent ? "#ffffff" : onDark ? "#0a0a0a" : "#ffffff";
    for (const el of [this.pointerEl, this.highlightEl]) {
      el.style.setProperty("--pointer-fill", fill);
      el.style.setProperty("--pointer-edge", edge);
    }
  }

  destroy() {
    window.removeEventListener("pointermove", this.onPointerMove, { capture: true });
    cancelAnimationFrame(this.frame);
    this.pointerEl.remove();
    this.highlightEl.remove();
  }

  /** Show the pointer next to the user's mouse. */
  follow() {
    this.generation++;
    this.stopTracking();
    this.flight?.cancel();
    this.target.value = null;
    this.highlightEl.classList.remove("visible");
    this.mode = "follow";
    this.glideToMouse();
    this.updateInk(this.pos.x, this.pos.y);
    this.pointerEl.classList.add("visible");
  }

  hide() {
    this.generation++;
    this.stopTracking();
    this.flight?.cancel();
    this.mode = "hidden";
    this.target.value = null;
    this.pointerEl.classList.remove("visible");
    this.highlightEl.classList.remove("visible");
  }

  /** Fly to an element. Calls queue up so several points play in order. */
  pointAt(el: Element): Promise<void> {
    const generation = this.generation;
    this.queue = this.queue.then(() => (generation === this.generation ? this.fly(el, generation) : undefined));
    return this.queue;
  }

  private async fly(el: Element, generation: number) {
    const wait = DWELL_MS - (performance.now() - this.lastArrival);
    if (this.target.value && wait > 0) await sleep(wait);
    if (generation !== this.generation || !el.isConnected) return;

    await scrollIntoViewIfNeeded(el);
    if (generation !== this.generation || !el.isConnected) return;

    this.stopTracking();
    const from = this.mode === "hidden" ? { x: this.mouse.x + MOUSE_OFFSET.x, y: this.mouse.y + MOUSE_OFFSET.y } : { ...this.pos };
    const to = tipFor(el.getBoundingClientRect());
    this.updateInk(to.x, to.y);
    this.mode = "flying";
    this.pointerEl.classList.add("visible");
    this.target.value = el;
    this.placeHighlight(el.getBoundingClientRect());
    this.highlightEl.classList.add("visible");

    if (prefersReducedMotion()) {
      this.setPos(to.x, to.y);
    } else {
      this.flight = this.pointerEl.animate(arcKeyframes(from, to), {
        duration: FLIGHT_MS,
        easing: "cubic-bezier(0.45, 0, 0.2, 1)",
        fill: "forwards",
      });
      try {
        await this.flight.finished;
      } catch {
        return; // Cancelled by a newer move.
      }
      this.flight.cancel();
      this.setPos(to.x, to.y);
    }
    if (generation !== this.generation) return;

    this.mode = "target";
    this.lastArrival = performance.now();
    this.highlightEl.classList.remove("pulse");
    void this.highlightEl.offsetWidth;
    this.highlightEl.classList.add("pulse");
    this.track();
  }

  private track = () => {
    const el = this.target.value;
    if (this.mode !== "target" || !el) return;
    if (!el.isConnected) {
      this.highlightEl.classList.remove("visible");
    } else {
      const rect = el.getBoundingClientRect();
      this.placeHighlight(rect);
      const tip = tipFor(rect);
      this.setPos(tip.x, tip.y);
      if (performance.now() - this.toneCheckedAt > TONE_EVERY_MS) this.updateInk(tip.x, tip.y);
    }
    this.frame = requestAnimationFrame(this.track);
  };

  private stopTracking() {
    cancelAnimationFrame(this.frame);
  }

  private glideToMouse() {
    this.setPos(this.mouse.x + MOUSE_OFFSET.x, this.mouse.y + MOUSE_OFFSET.y);
  }

  private onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    this.mouse = { x: event.clientX, y: event.clientY };
    if (this.mode === "follow") {
      this.glideToMouse();
      if (performance.now() - this.toneCheckedAt > TONE_EVERY_MS / 2) this.updateInk(this.pos.x, this.pos.y);
    }
  };

  private setPos(x: number, y: number) {
    this.pos = { x, y };
    this.pointerEl.style.transform = `translate3d(${x - TIP.x}px, ${y - TIP.y}px, 0)`;
  }

  private placeHighlight(rect: DOMRect) {
    const pad = 4;
    const style = this.highlightEl.style;
    style.transform = `translate3d(${rect.left - pad}px, ${rect.top - pad}px, 0)`;
    style.width = `${rect.width + pad * 2}px`;
    style.height = `${rect.height + pad * 2}px`;
  }
}

/** Put the arrow tip in the lower right of the element so its label stays readable. */
function tipFor(rect: DOMRect): { x: number; y: number } {
  return {
    x: rect.left + Math.min(rect.width * 0.65, Math.max(rect.width - 10, rect.width / 2)),
    y: rect.top + rect.height * 0.7,
  };
}

function arcKeyframes(from: { x: number; y: number }, to: { x: number; y: number }): Keyframe[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const lift = Math.min(120, distance * 0.22);
  // Control point off to one side of the straight line gives a gentle arc.
  const cx = (from.x + to.x) / 2 - (dy / distance) * lift;
  const cy = (from.y + to.y) / 2 + (dx / distance) * lift * -1;
  const frames: Keyframe[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * cx + t * t * to.x;
    const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * cy + t * t * to.y;
    frames.push({ transform: `translate3d(${x - TIP.x}px, ${y - TIP.y}px, 0)`, offset: t });
  }
  return frames;
}

async function scrollIntoViewIfNeeded(el: Element) {
  const rect = el.getBoundingClientRect();
  const margin = 40;
  const offscreen = rect.bottom < margin || rect.top > window.innerHeight - margin || rect.right < 0 || rect.left > window.innerWidth;
  if (!offscreen) return;
  const smooth = !prefersReducedMotion();
  el.scrollIntoView({ block: "center", inline: "nearest", behavior: smooth ? "smooth" : "auto" });
  if (smooth) await waitForScrollEnd(700);
}

function waitForScrollEnd(maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      document.removeEventListener("scrollend", done, true);
      resolve();
    };
    const timer = setTimeout(done, maxMs);
    document.addEventListener("scrollend", done, { capture: true, once: true });
  });
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
