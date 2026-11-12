"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { ArrowUp, Check } from "lucide-react";
import { Pointer, POINTER_TIP } from "@/components/pointer";
import { cn } from "@/lib/utils";

// One scripted task, played on a loop inside a mock customer app: a person
// asks how to update their card, and Haptic points to each control in turn.

const QUESTION = "How do I update my card";
const CARD_NUMBER = "•••• •••• •••• 1881";
const GLIDE = { duration: 0.55, ease: [0.2, 0.8, 0.2, 1] as const };

type Target = "avatar" | "billing" | "update" | "card" | "save";
type Composer = "idle" | "typing" | "thinking" | "guiding" | "done";

interface Scene {
  view: "projects" | "billing";
  menu: boolean;
  form: boolean;
  saved: boolean;
  composer: Composer;
  /** Characters of the question typed so far. */
  typed: number;
  /** The question has been sent and shows as a bubble. */
  asked: boolean;
  step: number;
  target: Target | null;
  ring: boolean;
  caption: string | null;
  /** Goes up by one on each click, to replay the pulse. */
  pulse: number;
  cardTyped: number;
  /** What Haptic says once the task is finished. */
  reply: string | null;
  fading: boolean;
}

const STEPS: { target: Target; say: string }[] = [
  { target: "avatar", say: "Open your account menu." },
  { target: "billing", say: "Choose Plan and billing." },
  { target: "update", say: "Click Update payment method." },
  { target: "card", say: "Enter your new card." },
  { target: "save", say: "Then save your card." },
];

const START: Scene = {
  view: "projects",
  menu: false,
  form: false,
  saved: false,
  composer: "idle",
  typed: 0,
  asked: false,
  step: 0,
  target: null,
  ring: false,
  caption: null,
  pulse: 0,
  cardTyped: 0,
  reply: null,
  fading: false,
};

/** The still frame shown before the demo scrolls into view, and when motion is reduced. */
const REST: Scene = {
  ...START,
  view: "billing",
  composer: "guiding",
  asked: true,
  step: 3,
  target: "update",
  ring: true,
  caption: STEPS[2].say,
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

interface Geometry {
  tip: { x: number; y: number };
  ring: Box | null;
  caption: { top: number; left?: number; right?: number } | null;
}

export function Demo() {
  const frame = useRef<HTMLDivElement>(null);
  const app = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);

  const reduce = useReducedMotion() ?? false;
  const inView = useInView(frame, { amount: 0.35 });
  const playing = inView && !reduce;
  const [live, setLive] = useState<Scene>(START);
  const scene = playing ? live : REST;

  useEffect(() => {
    if (!playing) return;
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) => new Promise<void>((resolve) => timers.push(setTimeout(resolve, ms)));
    const set = (patch: Partial<Scene>) => alive && setLive((current) => ({ ...current, ...patch }));

    (async () => {
      while (alive) {
        setLive(START);
        await wait(1000);

        // The person types their question and sends it.
        set({ composer: "typing" });
        for (let i = 1; i <= QUESTION.length && alive; i++) {
          set({ typed: i });
          await wait(48);
        }
        await wait(450);
        set({ asked: true, typed: 0, composer: "thinking" });
        await wait(1400);

        for (let i = 0; i < STEPS.length && alive; i++) {
          const { target, say } = STEPS[i]!;
          // The pointer glides to the control, then the ring and caption land.
          set({ composer: "guiding", step: i + 1, target, ring: false, caption: null });
          await wait(600);
          set({ ring: true, caption: say });
          await wait(1500);

          if (target === "card") {
            for (let n = 1; n <= CARD_NUMBER.length && alive; n++) {
              set({ cardTyped: n });
              await wait(55);
            }
            await wait(500);
          } else {
            setLive((current) => ({ ...current, pulse: current.pulse + 1 }));
            await wait(320);
            if (target === "avatar") set({ menu: true });
            if (target === "billing") set({ menu: false, view: "billing" });
            if (target === "update") set({ form: true });
            if (target === "save") set({ form: false, saved: true });
          }

          set({ ring: false, caption: null });
          if (i < STEPS.length - 1) {
            set({ composer: "thinking" });
            await wait(600);
          }
        }

        set({ composer: "done", target: null, reply: "All set. Your card is updated." });
        await wait(3200);
        set({ fading: true });
        await wait(350);
      }
    })();

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [playing]);

  // Where the pointer, ring and caption go, measured from the real layout.
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [resized, setResized] = useState(0);
  useEffect(() => {
    if (!app.current) return;
    const observer = new ResizeObserver(() => setResized((n) => n + 1));
    observer.observe(app.current);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const root = app.current;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    const el = scene.target ? root.querySelector<HTMLElement>(`[data-target="${scene.target}"]`) : null;
    if (!el) {
      // Nothing to point at, so the pointer waits by the ask box.
      const box = composer.current?.getBoundingClientRect();
      const tip = box
        ? { x: box.left - bounds.left + 24, y: box.top - bounds.top + box.height / 2 }
        : { x: bounds.width - 80, y: bounds.height - 44 };
      setGeometry({ tip, ring: null, caption: null });
      return;
    }
    const rect = el.getBoundingClientRect();
    const x = rect.left - bounds.left;
    const y = rect.top - bounds.top;
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8;
    const onRight = x + rect.width / 2 > bounds.width / 2;
    setGeometry({
      // The tip sits in the lower right corner, so the pointer hangs off the control and never covers its label.
      tip: { x: x + rect.width - Math.min(10, rect.width * 0.2), y: y + rect.height - Math.min(7, rect.height * 0.25) },
      ring: { x: x - 4, y: y - 4, w: rect.width + 8, h: rect.height + 8, r: Math.min(radius + 4, (rect.height + 8) / 2) },
      caption: {
        ...(onRight ? { right: Math.max(8, bounds.width - (x + rect.width)) } : { left: Math.max(8, x) }),
        top: y + rect.height + 14,
      },
    });
  }, [scene.target, scene.view, scene.menu, scene.form, scene.saved, resized]);

  const pointerShown = scene.target !== null && geometry !== null;
  const ring = scene.ring ? geometry?.ring : null;

  return (
    <section className="mx-auto w-full max-w-5xl px-6">
      <div
        ref={frame}
        role="img"
        aria-label="A demo of Haptic inside a sample app. A person asks how to update their card, and Haptic points to each control in turn until the card is saved."
        className="overflow-hidden rounded-3xl border bg-card shadow-sm select-none"
      >
        <div aria-hidden="true">
          <div className="flex h-11 items-center gap-3 border-b px-4">
            <div className="flex w-[42px] gap-1.5">
              <span className="size-2.5 rounded-full bg-border" />
              <span className="size-2.5 rounded-full bg-border" />
              <span className="size-2.5 rounded-full bg-border" />
            </div>
            <div className="mx-auto flex h-7 w-full max-w-sm items-center justify-center rounded-full bg-muted px-3 text-xs text-muted-foreground">
              <span className="truncate">{scene.view === "projects" ? "app.acme.com/projects" : "app.acme.com/settings/billing"}</span>
            </div>
            <div className="w-[42px]" />
          </div>

          <div ref={app} className="relative h-[544px] overflow-hidden text-sm leading-5">
            <motion.div className="h-full" animate={{ opacity: scene.fading ? 0 : 1 }} transition={{ duration: 0.3 }}>
              <div className="flex h-14 items-center gap-6 border-b px-6">
                <div className="flex items-center gap-2 font-medium">
                  <span className="size-5 rounded-md bg-foreground" />
                  Acme
                </div>
                <div className="hidden items-center gap-5 text-muted-foreground sm:flex">
                  <span className={cn(scene.view === "projects" && "text-foreground")}>Projects</span>
                  <span>Team</span>
                  <span>Reports</span>
                </div>
                <div
                  data-target="avatar"
                  className="ml-auto flex size-8 items-center justify-center rounded-full bg-foreground text-[13px] font-medium text-background"
                >
                  A
                </div>
              </div>

              <AnimatePresence>
                {scene.menu && (
                  <motion.div
                    className="absolute top-[52px] right-6 z-10 w-48 origin-top-right rounded-xl border bg-popover p-1 shadow-lg"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <div className="flex h-8 items-center rounded-md px-2">Settings</div>
                    <div data-target="billing" className="flex h-8 items-center rounded-md px-2">
                      Plan and billing
                    </div>
                    <div className="flex h-8 items-center rounded-md px-2 text-muted-foreground">Sign out</div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-6">
                {scene.view === "projects" ? (
                  <>
                    <h3 className="flex h-8 items-center text-lg font-medium tracking-tight">Projects</h3>
                    <Row title="Website relaunch" meta="Updated 2 hours ago" action={<MockButton>Open</MockButton>} />
                    <Row title="Q3 onboarding" meta="Updated yesterday" action={<MockButton>Open</MockButton>} />
                    <Row title="Mobile beta" meta="Updated last week" action={<MockButton>Open</MockButton>} />
                  </>
                ) : (
                  <>
                    <h3 className="flex h-8 items-center text-lg font-medium tracking-tight">Settings</h3>
                    <div className="flex h-9 gap-5 border-b text-muted-foreground">
                      <span className="flex h-9 items-center">General</span>
                      <span className="relative flex h-9 items-center text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-foreground">
                        Plan and billing
                      </span>
                      <span className="flex h-9 items-center">Security</span>
                    </div>
                    <div className="rounded-xl border">
                      <div className="flex min-h-16 flex-col items-start justify-between gap-3 px-4 py-3 sm:flex-row sm:items-center">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{scene.saved ? "Visa ending 1881" : "Visa ending 4242"}</div>
                          <div className="truncate text-[13px] text-muted-foreground">{scene.saved ? "Expires 11/29" : "Expires 08/27"}</div>
                        </div>
                        {scene.saved ? (
                          <span className="flex h-8 items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                            <Check className="size-4" />
                            Saved
                          </span>
                        ) : (
                          !scene.form && <MockButton target="update">Update payment method</MockButton>
                        )}
                      </div>
                      {scene.form && (
                        <div className="flex flex-col gap-4 border-t p-4">
                          <div className="grid grid-cols-[minmax(0,1fr)_5rem_4rem] gap-3">
                            <Field target="card" label="Card number" value={CARD_NUMBER.slice(0, scene.cardTyped)} placeholder="1234 1234 1234 1234" />
                            <Field label="Expiry" value={scene.cardTyped === CARD_NUMBER.length ? "11 / 29" : ""} placeholder="MM / YY" />
                            <Field label="CVC" value={scene.cardTyped === CARD_NUMBER.length ? "•••" : ""} placeholder="123" />
                          </div>
                          <div className="flex justify-end gap-2">
                            <MockButton className="hidden sm:flex">Cancel</MockButton>
                            <MockButton target="save" primary>
                              Save card
                            </MockButton>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </motion.div>

            {/* Everything below is Haptic, drawn on top of the customer's app. */}
            {ring && (
              <motion.div
                key={scene.target}
                className="pointer-events-none absolute top-0 left-0 z-20 border-2 border-pointer"
                style={{
                  x: ring.x,
                  y: ring.y,
                  width: ring.w,
                  height: ring.h,
                  borderRadius: ring.r,
                  boxShadow: "0 0 0 4px color-mix(in srgb, var(--pointer) 25%, transparent)",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              />
            )}
            {ring && scene.pulse > 0 && (
              <motion.div
                key={`pulse-${scene.pulse}`}
                className="pointer-events-none absolute top-0 left-0 z-20 border-2 border-pointer"
                style={{ x: ring.x, y: ring.y, width: ring.w, height: ring.h, borderRadius: ring.r }}
                initial={{ opacity: 0.7, scale: 1 }}
                animate={{ opacity: 0, scale: 1.16 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            )}

            <AnimatePresence>
              {scene.caption && geometry?.caption && (
                <motion.div
                  key={scene.caption}
                  className="pointer-events-none absolute z-20 max-w-[min(16.25rem,calc(100%-1rem))] rounded-xl bg-primary px-3 py-2 text-primary-foreground shadow-lg"
                  style={geometry.caption}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  {scene.caption}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="absolute right-5 bottom-5 z-10 flex max-w-[calc(100%-2.5rem)] flex-col items-end gap-2">
              <AnimatePresence>
                {scene.asked && !scene.fading && (
                  <motion.div
                    className="rounded-2xl bg-secondary px-3 py-2 text-secondary-foreground"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {QUESTION}
                  </motion.div>
                )}
                {scene.reply && !scene.fading && (
                  <motion.div
                    className="self-start rounded-2xl bg-primary px-3 py-2 text-primary-foreground"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {scene.reply}
                  </motion.div>
                )}
              </AnimatePresence>
              <div ref={composer} className="flex h-11 w-[19rem] max-w-full shrink-0 items-center gap-2.5 rounded-full border bg-card pr-2 pl-4 shadow-md">
                <ComposerBody scene={scene} />
              </div>
            </div>

            {geometry && (
              <motion.div
                className="pointer-events-none absolute top-0 left-0 z-30"
                initial={false}
                animate={{ x: geometry.tip.x - POINTER_TIP.x, y: geometry.tip.y - POINTER_TIP.y, opacity: pointerShown ? 1 : 0 }}
                transition={reduce ? { duration: 0 } : { x: GLIDE, y: GLIDE, opacity: { duration: 0.15 } }}
              >
                <Pointer bordered className="pointer-shadow text-pointer" />
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ComposerBody({ scene }: { scene: Scene }) {
  if (scene.composer === "thinking") {
    return (
      <>
        <span className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-thinking rounded-full bg-pointer" style={{ animationDelay: `${i * 0.16}s` }} />
          ))}
        </span>
        <span className="flex-1 text-muted-foreground">{scene.step === 0 ? "Thinking" : "Next step"}</span>
      </>
    );
  }
  if (scene.composer === "guiding") {
    return (
      <>
        <Pointer className="size-4 text-pointer" />
        <span className="flex-1 font-medium">
          Step {scene.step} of {STEPS.length}
        </span>
        <span className="flex h-7 items-center rounded-full border px-3 text-[13px] text-muted-foreground">Stop</span>
      </>
    );
  }
  if (scene.composer === "done") {
    return (
      <>
        <Check className="size-4" />
        <span className="flex-1 font-medium">Done</span>
      </>
    );
  }
  const typing = scene.composer === "typing";
  return (
    <>
      <span className={cn("flex-1 truncate", !typing && "text-muted-foreground")}>
        {typing ? QUESTION.slice(0, scene.typed) : "What do you want to do"}
        {typing && <span className="ml-px inline-block h-4 w-px translate-y-[3px] animate-caret bg-foreground" />}
      </span>
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-full transition-colors",
          typing && scene.typed > 0 ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
        )}
      >
        <ArrowUp className="size-4" />
      </span>
    </>
  );
}

function Row({ title, meta, action }: { title: string; meta: string; action: ReactNode }) {
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

function MockButton({ children, primary, target, className }: { children: ReactNode; primary?: boolean; target?: Target; className?: string }) {
  return (
    <span
      data-target={target}
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

function Field({ label, value, placeholder, target }: { label: string; value: string; placeholder: string; target?: Target }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="truncate text-xs leading-4 text-muted-foreground">{label}</span>
      <div data-target={target} className="flex h-9 items-center rounded-lg border bg-background px-3 tabular-nums">
        <span className={cn("truncate", !value && "text-muted-foreground/60")}>{value || placeholder}</span>
      </div>
    </div>
  );
}
