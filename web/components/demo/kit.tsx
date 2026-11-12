"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { Pointer, POINTER_TIP } from "@/components/pointer";
import { cn } from "@/lib/utils";

// Shared pieces for the scripted demos: a script runner, the stage that draws
// Haptic's pointer, target mark and caption over a mock app, and the mock
// controls themselves.

/** The pointer's one signature movement: quick to leave, slow to land, so the eye arrives with it. */
export const GLIDE_EASE = [0.2, 0.8, 0.2, 1] as const;

/** Longer trips take longer, within limits, so the pointer never teleports and never dawdles. */
function glideSeconds(distance: number): number {
  return Math.min(0.7, Math.max(0.4, 0.3 + distance * 0.0005));
}

/** How long a script should wait for the pointer to land before the mark and caption appear. */
export const LANDING_MS = 750;

/** A demo plays only while it is on screen, and holds a still frame if motion is reduced. */
export function usePlayback(frame: RefObject<HTMLElement | null>): boolean {
  const reduce = useReducedMotion() ?? false;
  const inView = useInView(frame, { amount: 0.35 });
  return inView && !reduce;
}

export interface ScriptIO<S> {
  wait: (ms: number) => Promise<void>;
  set: (patch: Partial<S>) => void;
  update: (change: (scene: S) => S) => void;
  alive: () => boolean;
}

/**
 * Runs `run` on a loop while `playing`, and returns the current scene. When
 * not playing it returns `rest`, a still frame that explains the demo by itself.
 */
export function useScript<S>(playing: boolean, start: S, rest: S, run: (io: ScriptIO<S>) => Promise<void>): S {
  const [live, setLive] = useState<S>(start);
  useEffect(() => {
    if (!playing) return;
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const io: ScriptIO<S> = {
      wait: (ms) => new Promise<void>((resolve) => timers.push(setTimeout(resolve, ms))),
      set: (patch) => {
        if (alive) setLive((scene) => ({ ...scene, ...patch }));
      },
      update: (change) => {
        if (alive) setLive(change);
      },
      alive: () => alive,
    };
    (async () => {
      while (alive) {
        setLive(start);
        await run(io);
      }
    })();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [playing, start, run]);
  return playing ? live : rest;
}

/** What Haptic is pointing at, at one moment of a script. */
export interface Pointing {
  /** Matches a `data-target` inside the stage. Null parks the pointer out of sight. */
  target: string | null;
  /** The outline around the target has landed. */
  marked: boolean;
  caption: string | null;
  /** Goes up by one on each click, to replay the pulse. */
  pulse: number;
}

export const NOT_POINTING: Pointing = { target: null, marked: false, caption: null, pulse: 0 };

interface Geometry {
  tip: { x: number; y: number };
  /** Seconds the pointer takes to reach `tip` from where it was. */
  glide: number;
  mark: { x: number; y: number; w: number; h: number; r: number } | null;
  caption: { top?: number; bottom?: number; left?: number; right?: number } | null;
}

// Blue with a white edge on both sides and a soft shadow, the same recipe as
// the pointer. It stands off the control by a few pixels, so it never reads as
// the control's own keyboard focus ring.
const MARK_GAP = 5;
const MARK_SHADOW = "0 0 0 1.5px var(--pointer-border), inset 0 0 0 1.5px var(--pointer-border), 0 3px 10px rgb(0 0 0 / 0.14)";

/**
 * A mock app with Haptic drawn on top. Positions are measured from the real
 * layout, so the pointer always lands on the control it names.
 */
export function Stage({
  pointing,
  layoutKey,
  className,
  children,
}: {
  pointing: Pointing;
  /** Changes whenever the mock's layout changes, so positions are measured again. */
  layoutKey: string | number;
  className?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() ?? false;
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [resized, setResized] = useState(0);
  const lastTip = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(() => setResized((n) => n + 1));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const stage = root.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    const el = pointing.target ? stage.querySelector<HTMLElement>(`[data-target="${pointing.target}"]`) : null;
    const travel = (tip: { x: number; y: number }) => {
      const from = lastTip.current;
      lastTip.current = tip;
      return glideSeconds(from ? Math.hypot(tip.x - from.x, tip.y - from.y) : 0);
    };
    if (!el) {
      // Nothing to point at, so the pointer waits by the ask box.
      const home = stage.querySelector<HTMLElement>("[data-home]")?.getBoundingClientRect();
      const tip = home
        ? { x: home.right - bounds.left - Math.min(64, home.width / 2), y: home.bottom - bounds.top - 20 }
        : { x: bounds.width - 80, y: bounds.height - 44 };
      setGeometry({ tip, glide: travel(tip), mark: null, caption: null });
      return;
    }
    const rect = el.getBoundingClientRect();
    const x = rect.left - bounds.left;
    const y = rect.top - bounds.top;
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8;
    const onRight = x + rect.width / 2 > bounds.width / 2;
    // A caption goes under its target unless the target asks otherwise or there is no room.
    const below = el.dataset.caption !== "above" && y + rect.height + 14 + 44 <= bounds.height;
    // The tip sits in the lower right corner, so the pointer hangs off the control and never covers its label.
    const tip = { x: x + rect.width - Math.min(10, rect.width * 0.2), y: y + rect.height - Math.min(7, rect.height * 0.25) };
    setGeometry({
      tip,
      glide: travel(tip),
      mark: {
        x: x - MARK_GAP,
        y: y - MARK_GAP,
        w: rect.width + MARK_GAP * 2,
        h: rect.height + MARK_GAP * 2,
        r: Math.min(radius + MARK_GAP, (rect.height + MARK_GAP * 2) / 2),
      },
      caption: {
        ...(onRight ? { right: Math.max(8, bounds.width - (x + rect.width)) } : { left: Math.max(8, x) }),
        ...(below ? { top: y + rect.height + 14 } : { bottom: bounds.height - y + 14 }),
      },
    });
  }, [pointing.target, layoutKey, resized]);

  const mark = pointing.marked ? geometry?.mark : null;

  return (
    <div ref={root} className={cn("relative overflow-hidden", className)}>
      {children}

      {/* Everything below is Haptic, drawn on top of the customer's app. */}
      {mark && (
        <motion.div
          key={`mark-${pointing.target}`}
          className="pointer-events-none absolute top-0 left-0 z-20 border-2 border-pointer"
          style={{ x: mark.x, y: mark.y, width: mark.w, height: mark.h, borderRadius: mark.r, boxShadow: MARK_SHADOW }}
          // It draws in from slightly larger, like a lens finding focus, then holds still.
          initial={{ opacity: 0, scale: 1.12 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.28, ease: GLIDE_EASE }}
        />
      )}
      {mark && pointing.pulse > 0 && (
        <motion.div
          key={`pulse-${pointing.pulse}`}
          className="pointer-events-none absolute top-0 left-0 z-20 border-2 border-pointer"
          style={{ x: mark.x, y: mark.y, width: mark.w, height: mark.h, borderRadius: mark.r }}
          initial={{ opacity: 0.7, scale: 1 }}
          animate={{ opacity: 0, scale: 1.16 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      )}

      <AnimatePresence>
        {pointing.caption && geometry?.caption && (
          <motion.div
            key={pointing.caption}
            className="pointer-events-none absolute z-20 max-w-[min(18rem,calc(100%-1rem))] rounded-xl bg-primary px-3 py-2 text-sm leading-5 text-primary-foreground shadow-lg"
            style={geometry.caption}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {pointing.caption}
          </motion.div>
        )}
      </AnimatePresence>

      {geometry && (
        <motion.div
          className="pointer-events-none absolute top-0 left-0 z-30"
          initial={false}
          animate={{
            x: geometry.tip.x - POINTER_TIP.x,
            y: geometry.tip.y - POINTER_TIP.y,
            opacity: pointing.target !== null ? 1 : 0,
          }}
          transition={
            reduce
              ? { duration: 0 }
              : {
                  x: { duration: geometry.glide, ease: GLIDE_EASE },
                  y: { duration: geometry.glide, ease: GLIDE_EASE },
                  opacity: { duration: 0.15 },
                }
          }
        >
          <Pointer bordered className="pointer-shadow text-pointer" />
        </motion.div>
      )}
    </div>
  );
}

/** The frame every demo sits in. It is a picture, so nothing inside can take focus. */
export function DemoFrame({
  ref,
  label,
  className,
  children,
}: {
  ref: RefObject<HTMLDivElement | null>;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div ref={ref} role="img" aria-label={label} className={cn("select-none", className)}>
      <div aria-hidden="true" inert>
        {children}
      </div>
    </div>
  );
}

/** A browser window around a mock app. */
export function MockWindow({
  address,
  compact,
  className,
  children,
}: {
  address: string;
  /** The smaller window used inside feature cards. */
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("overflow-hidden border bg-card shadow-sm", compact ? "rounded-2xl" : "rounded-3xl", className)}>
      <div className={cn("flex items-center gap-3 border-b", compact ? "h-9 px-3" : "h-11 px-4")}>
        <div className={cn("flex", compact ? "w-[42px] gap-1.5" : "w-[52px] gap-2")}>
          {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
            <span
              key={color}
              className={cn("rounded-full shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.2)]", compact ? "size-2.5" : "size-3")}
              style={{ background: color }}
            />
          ))}
        </div>
        <div
          className={cn(
            "mx-auto flex w-full max-w-sm items-center justify-center rounded-full bg-muted px-3 text-xs text-muted-foreground",
            compact ? "h-6" : "h-7",
          )}
        >
          <span className="truncate">{address}</span>
        </div>
        <div className={compact ? "w-[42px]" : "w-[52px]"} />
      </div>
      {children}
    </div>
  );
}

/** The top bar of the sample app. */
export function AppHeader({ active, compact, children }: { active?: "Projects" | "Team" | "Reports"; compact?: boolean; children?: ReactNode }) {
  return (
    <div className={cn("flex items-center gap-6 border-b", compact ? "h-12 px-4" : "h-14 px-6")}>
      <div className="flex items-center gap-2 font-medium">
        <span className="size-5 rounded-md bg-foreground" />
        Acme
      </div>
      <div className="hidden items-center gap-5 text-muted-foreground sm:flex">
        {(["Projects", "Team", "Reports"] as const).map((item) => (
          <span key={item} className={cn(item === active && "text-foreground")}>
            {item}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

export function MockButton({
  children,
  primary,
  target,
  caption,
  className,
}: {
  children: ReactNode;
  primary?: boolean;
  target?: string;
  /** Put Haptic's caption above this control when the space under it is busy. */
  caption?: "above";
  className?: string;
}) {
  return (
    <span
      data-target={target}
      data-caption={caption}
      className={cn(
        "flex h-8 shrink-0 items-center rounded-full border px-3 text-[13px] font-medium whitespace-nowrap",
        primary ? "border-transparent bg-primary text-primary-foreground" : "bg-card",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Field({ label, value, placeholder, target }: { label: string; value: string; placeholder: string; target?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="truncate text-xs leading-4 text-muted-foreground">{label}</span>
      <div data-target={target} className="flex h-9 items-center rounded-lg border bg-background px-3 tabular-nums">
        <span className={cn("truncate", !value && "text-muted-foreground/60")}>{value || placeholder}</span>
      </div>
    </div>
  );
}

export function Row({ title, meta, action }: { title: string; meta: string; action: ReactNode }) {
  return (
    <div className="flex h-16 items-center justify-between gap-4 rounded-xl border px-4">
      <div className="min-w-0">
        <div className="truncate font-medium">{title}</div>
        <div className="truncate text-[13px] text-muted-foreground">{meta}</div>
      </div>
      {action}
    </div>
  );
}

/** Three dots in the pointer's blue, shown while Haptic is thinking. */
export function Dots() {
  return (
    <span className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-thinking rounded-full bg-pointer" style={{ animationDelay: `${i * 0.16}s` }} />
      ))}
    </span>
  );
}

export function Caret() {
  return <span className="ml-px inline-block h-4 w-px translate-y-[3px] animate-caret bg-foreground" />;
}
