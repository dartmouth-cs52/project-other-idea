"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from "motion/react";
import { ArrowUpIcon, Check, FileTextIcon, SquareIcon } from "lucide-react";
import { Pointer, POINTER_TIP } from "@/components/pointer";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent } from "@/components/ui/message";
import { cn } from "@/lib/utils";

// Shared pieces for the scripted demos: a script runner, the stage that draws
// Haptic's pointer, target mark and caption over a mock app, and the mock
// controls themselves.

/**
 * Where the sample app in the demos lives. It has no brand name on purpose: Haptic runs inside
 * the visitor's own product, so the address is the standard placeholder domain and the app's
 * header carries a plain mark with no name beside it. Change it here and every demo follows.
 */
export const APP_DOMAIN = "example.com";

/** The pointer's one signature movement: quick to leave, slow to land, so the eye arrives with it. */
export const GLIDE_EASE = [0.2, 0.8, 0.2, 1] as const;

/** Longer trips take longer, within limits, so the pointer never teleports and never dawdles. */
function glideSeconds(distance: number): number {
  return Math.min(0.7, Math.max(0.4, 0.3 + distance * 0.0005));
}

/** How long a script should wait for the pointer to land before the mark and caption appear. */
export const LANDING_MS = 750;

/** What a demo is doing: running its script, waiting on its first frame, or holding its still frame. */
export type Playback = "playing" | "waiting" | "still";

/** How much of a demo has to be on screen before it starts. */
const START_AT = 0.35;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function watchReducedMotion(notify: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

/**
 * Whether the visitor has asked for reduced motion. The server cannot know, so the page is first
 * drawn as if they have not, and switches once it is running in the browser. Reading the setting
 * during that first draw would make the page disagree with what the server sent.
 */
function useWantsStill(): boolean {
  return useSyncExternalStore(
    watchReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/**
 * A demo starts once enough of it is on screen, then keeps going until it has left the screen
 * completely. It never changes state while any of it can be seen, so scrolling past a demo never
 * makes it jump. If motion is reduced it holds a still frame instead.
 */
export function usePlayback(frame: RefObject<HTMLElement | null>): Playback {
  const reduce = useWantsStill();
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        // Enough on screen starts it. Partly on screen changes nothing. Gone stops it.
        setRunning((was) => (entry.intersectionRatio >= START_AT ? true : entry.isIntersecting ? was : false));
      },
      { threshold: [0, START_AT] },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [frame]);
  return reduce ? "still" : running ? "playing" : "waiting";
}

export interface ScriptIO<S> {
  wait: (ms: number) => Promise<void>;
  set: (patch: Partial<S>) => void;
  update: (change: (scene: S) => S) => void;
  alive: () => boolean;
}

/**
 * Runs `run` on a loop while the demo is playing, and returns the current scene. While it waits
 * to come on screen it shows `start`, the frame the script begins from, so starting is not a
 * jump. `rest` is the still frame for reduced motion, which explains the demo by itself.
 */
export function useScript<S>(playback: Playback, start: S, rest: S, run: (io: ScriptIO<S>) => Promise<void>): S {
  const [live, setLive] = useState<S>(start);
  const playing = playback === "playing";
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
      // It only stops once it is off screen, so going back to the first frame is never seen.
      setLive(start);
    };
  }, [playing, start, run]);
  return playback === "still" ? rest : live;
}

/** What Haptic is pointing at, at one moment of a script. */
export interface Pointing {
  /** Matches a `data-target` inside the stage. Null parks the pointer out of sight. */
  target: string | null;
  /** The outline around the target has landed. */
  marked: boolean;
  caption: string | null;
  /** Goes up by one on each click, to replay the press. */
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

// A click is acknowledged the way a pressed button is: the mark and the
// pointer dip slightly and come back, in under a quarter of a second.
const PRESS = { duration: 0.24, times: [0, 0.4, 1], ease: "easeOut" as const };

/**
 * A mock app with Haptic drawn on top. Positions are measured from the real
 * layout, so the pointer always lands on the control it names.
 */
export function Stage({
  pointing,
  status,
  layoutKey,
  className,
  children,
}: {
  pointing: Pointing;
  /** What the chat says Haptic is doing. The glow over the page follows it. */
  status?: ChatView["status"];
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
  const press = useAnimationControls();
  // Each spell of thinking starts the glow's band again from the top of the page.
  const thinking = status === "thinking";
  const [wasThinking, setWasThinking] = useState(thinking);
  const [spell, setSpell] = useState(0);
  if (thinking !== wasThinking) {
    setWasThinking(thinking);
    if (thinking) setSpell(spell + 1);
  }

  useEffect(() => {
    if (pointing.pulse > 0) void press.start("press");
  }, [pointing.pulse, press]);

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
    // isolate keeps the glow's blending inside the mock page.
    <div ref={root} className={cn("relative isolate overflow-hidden", className)}>
      {children}

      {/* Everything below is Haptic, drawn on top of the customer's app. */}
      {/* The thinking glow. It is on the page only while Haptic thinks: a soft band comes in at the top and falls towards
          the bottom, slower the longer the wait, and goes the rest of the way and off the page the moment the reply
          arrives. It is the widget's own glow (src/widget/ui.ts), with its timings, styled in globals.css. It is over
          the page and under the chat, which sits at z-15. */}
      <div className="thinking-glow" data-on={thinking}>
        {spell > 0 && (
          <motion.i
            key={spell}
            initial={{ y: "-90%" }}
            animate={{ y: thinking ? "40%" : "100%" }}
            transition={thinking ? { duration: 8, ease: [0.14, 1, 0.3, 1] } : { duration: 0.45, ease: "easeIn" }}
          />
        )}
      </div>

      <AnimatePresence>
        {mark && (
          <motion.div
            key={`mark-${pointing.target}`}
            className="pointer-events-none absolute top-0 left-0 z-20"
            style={{ x: mark.x, y: mark.y, width: mark.w, height: mark.h }}
            // It settles in from slightly larger, quickly, then holds still. It never grows from nothing.
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15, ease: "easeOut" } }}
            transition={{ duration: 0.2, ease: GLIDE_EASE }}
          >
            <motion.div
              className="size-full border-2 border-pointer"
              style={{ borderRadius: mark.r, boxShadow: MARK_SHADOW }}
              animate={press}
              variants={{ press: { scale: [1, 0.97, 1], transition: PRESS } }}
            />
          </motion.div>
        )}
      </AnimatePresence>

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
          <motion.div animate={press} variants={{ press: { scale: [1, 0.9, 1], transition: PRESS } }} style={{ transformOrigin: "16% 13%" }}>
            <Pointer bordered className="pointer-shadow text-pointer" />
          </motion.div>
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
    <div
      className={cn(
        // Every window is the same surface: Card white, hairline border, 14px corners, one faint shadow.
        "overflow-hidden rounded-xl border bg-card shadow-sm",
        className,
      )}
    >
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
      <span className="size-5 shrink-0 rounded-md bg-foreground" />
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
    <div className="flex h-16 items-center justify-between gap-4 rounded-lg border px-4">
      <div className="min-w-0">
        <div className="truncate font-medium">{title}</div>
        <div className="truncate text-[13px] text-muted-foreground">{meta}</div>
      </div>
      {action}
    </div>
  );
}

/** What Haptic's chat is showing at one moment of a script. */
export interface ChatView {
  /** The text being typed into the ask box, or null when it is empty. */
  typing: string | null;
  /** The question, once it has been sent. */
  question: string | null;
  status: "idle" | "thinking" | "pointing" | "done";
  /** What Haptic says back. */
  reply?: string | null;
  /** Where the detail in the reply came from. */
  source?: string | null;
}

/**
 * Haptic's chat. It lives in the bottom right corner of the customer's app,
 * where support chat usually sits, and stays open from the first question to
 * the last step.
 */
export function Chat({ view, compact, className }: { view: ChatView; compact?: boolean; className?: string }) {
  const working = view.status === "thinking" || view.status === "pointing";
  const send = working ? (
    // While Haptic is guiding, send becomes stop.
    <InputGroupButton variant="default" size={compact ? "icon-xs" : "icon-sm"} className="ml-auto rounded-full">
      <SquareIcon className={cn("fill-current", compact ? "size-2.5" : "size-3")} />
    </InputGroupButton>
  ) : (
    <InputGroupButton variant="default" size={compact ? "icon-xs" : "icon-sm"} className="ml-auto rounded-full" disabled={!view.typing}>
      <ArrowUpIcon />
    </InputGroupButton>
  );
  const text = (
    <span className={cn("truncate", view.typing === null && "text-muted-foreground")}>
      {view.typing ?? "What do you want to do"}
      {view.typing !== null && <Caret />}
    </span>
  );

  return (
    <motion.div
      data-home
      className={cn("flex w-full flex-col rounded-xl border bg-card shadow-lg", compact ? "gap-2 p-1.5" : "gap-3 p-2", className)}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {view.question && (
        <div className="flex flex-col gap-2 px-1 pt-1">
          <Message align="end">
            <MessageContent>
              <Bubble align="end">
                <BubbleContent>{view.question}</BubbleContent>
              </Bubble>
            </MessageContent>
          </Message>
          {view.reply && (
            <Message>
              <MessageContent>
                <Bubble variant="muted" className={compact ? "max-w-[92%]" : undefined}>
                  <BubbleContent>{view.reply}</BubbleContent>
                </Bubble>
              </MessageContent>
            </Message>
          )}
          {view.source && (
            <Marker className="text-xs">
              <MarkerIcon className="size-3.5">
                <FileTextIcon className="size-3.5" />
              </MarkerIcon>
              <MarkerContent>{view.source}</MarkerContent>
            </Marker>
          )}
          {view.status === "thinking" && (
            // No icon. A lighter shade sweeps across the word while Haptic works, and the glow falls down the page.
            <Marker>
              <MarkerContent className="shimmer">Thinking</MarkerContent>
            </Marker>
          )}
          {view.status === "pointing" && (
            <Marker>
              <MarkerIcon>
                <Pointer className="size-4 text-pointer" />
              </MarkerIcon>
              <MarkerContent>Showing you how</MarkerContent>
            </Marker>
          )}
          {view.status === "done" && (
            <Marker>
              <MarkerIcon>
                <span className="flex size-4 items-center justify-center rounded-full bg-success text-success-foreground">
                  <Check className="size-3" strokeWidth={3} />
                </span>
              </MarkerIcon>
              <MarkerContent className="font-medium text-foreground">Done</MarkerContent>
            </Marker>
          )}
        </div>
      )}
      {compact ? (
        <InputGroup className="h-10 rounded-lg border-transparent bg-muted">
          <div className="flex min-w-0 flex-1 items-center pl-3">{text}</div>
          <InputGroupAddon align="inline-end">{send}</InputGroupAddon>
        </InputGroup>
      ) : (
        <InputGroup className="rounded-lg border-transparent bg-muted">
          <div className="flex min-h-10 w-full items-center px-3 pt-1">{text}</div>
          <InputGroupAddon align="block-end">{send}</InputGroupAddon>
        </InputGroup>
      )}
    </motion.div>
  );
}

export function Caret() {
  return <span className="ml-px inline-block h-4 w-px translate-y-[3px] animate-caret bg-foreground" />;
}
