"use client";

import { useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpIcon, Check, SquareIcon } from "lucide-react";
import { Pointer } from "@/components/pointer";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent } from "@/components/ui/message";
import { cn } from "@/lib/utils";
import { AppHeader, Caret, DemoFrame, Field, LANDING_MS, MockButton, MockWindow, Row, Stage, usePlayback, useScript, type ScriptIO } from "./kit";

// The hero demo. One scripted task, played on a loop inside a mock customer
// app: a person asks how to update their card, and Haptic points to each
// control in turn.

const QUESTION = "How do I update my card";
const CARD_NUMBER = "•••• •••• •••• 1881";

type Target = "avatar" | "billing" | "update" | "card" | "save";
/** What Haptic is doing. The chat stays open the whole time, like the support chat it stands in for. */
type Composer = "idle" | "typing" | "thinking" | "pointing" | "next" | "done";

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
  target: Target | null;
  marked: boolean;
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
  { target: "card", say: "Enter your card." },
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
  target: null,
  marked: false,
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
  composer: "pointing",
  asked: true,
  target: "update",
  marked: true,
  caption: STEPS[2].say,
};

async function script({ wait, set, update, alive }: ScriptIO<Scene>) {
  await wait(1000);

  // The person types their question and sends it.
  set({ composer: "typing" });
  for (let i = 1; i <= QUESTION.length && alive(); i++) {
    set({ typed: i });
    await wait(48);
  }
  await wait(450);
  set({ asked: true, typed: 0, composer: "thinking" });
  await wait(1400);

  for (let i = 0; i < STEPS.length && alive(); i++) {
    const { target, say } = STEPS[i]!;
    // The pointer glides to the control, then the mark and caption land.
    set({ composer: "pointing", target, marked: false, caption: null });
    await wait(LANDING_MS);
    set({ marked: true, caption: say });
    await wait(1500);

    if (target === "card") {
      for (let n = 1; n <= CARD_NUMBER.length && alive(); n++) {
        set({ cardTyped: n });
        await wait(55);
      }
      await wait(500);
    } else {
      update((scene) => ({ ...scene, pulse: scene.pulse + 1 }));
      await wait(320);
      if (target === "avatar") set({ menu: true });
      if (target === "billing") set({ menu: false, view: "billing" });
      if (target === "update") set({ form: true });
      if (target === "save") set({ form: false, saved: true });
    }

    set({ marked: false, caption: null });
    if (i < STEPS.length - 1) {
      set({ composer: "next" });
      await wait(600);
    }
  }

  set({ composer: "done", target: null, reply: "All set. Your card is updated." });
  await wait(3200);
  set({ fading: true });
  await wait(350);
}

export function HeroDemo() {
  const frame = useRef<HTMLDivElement>(null);
  const scene = useScript(usePlayback(frame), START, REST, script);

  return (
    <section className="mx-auto w-full max-w-5xl px-6">
      <DemoFrame
        ref={frame}
        label="A demo of Haptic inside a sample app. A person asks how to update their card, and Haptic points to each control in turn until the card is saved."
      >
        <MockWindow address={scene.view === "projects" ? "app.acme.com/projects" : "app.acme.com/settings/billing"}>
          <Stage
            pointing={scene}
            layoutKey={`${scene.view}-${scene.menu}-${scene.form}-${scene.saved}`}
            className="h-[660px] text-sm leading-5 lg:h-[576px]"
          >
            <motion.div className="h-full" animate={{ opacity: scene.fading ? 0 : 1 }} transition={{ duration: 0.3 }}>
              <AppHeader active={scene.view === "projects" ? "Projects" : undefined}>
                <div
                  data-target="avatar"
                  className="ml-auto flex size-8 items-center justify-center rounded-full bg-foreground text-[13px] font-medium text-background"
                >
                  A
                </div>
              </AppHeader>
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

              <div className="flex w-full flex-col gap-4 px-6 pt-6 lg:pr-[364px]">
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

            <div data-home className="absolute right-5 bottom-5 z-10 flex w-[19rem] max-w-[calc(100%-2.5rem)] flex-col items-end">
              <Dock scene={scene} />
            </div>
          </Stage>
        </MockWindow>
      </DemoFrame>
    </section>
  );
}

const rise = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2 } };

/** Haptic's chat, in the corner where support chat usually lives. It stays open from the first question to the last step. */
function Dock({ scene }: { scene: Scene }) {
  if (scene.fading) return null;
  const typing = scene.composer === "typing";
  const working = scene.asked && scene.composer !== "done";
  return (
    <motion.div key="chat" {...rise} className="flex w-full flex-col gap-3 rounded-3xl border bg-card p-2 shadow-lg">
      {scene.asked && (
        <div className="flex flex-col gap-2 px-1 pt-1">
          <Message align="end">
            <MessageContent>
              <Bubble align="end">
                <BubbleContent>{QUESTION}</BubbleContent>
              </Bubble>
            </MessageContent>
          </Message>
          {scene.reply && (
            <Message>
              <MessageContent>
                <Bubble variant="muted">
                  <BubbleContent>{scene.reply}</BubbleContent>
                </Bubble>
              </MessageContent>
            </Message>
          )}
          <Status composer={scene.composer} />
        </div>
      )}
      <InputGroup className="rounded-2xl border-transparent bg-muted">
        <div className="flex min-h-10 w-full items-center px-3 pt-1">
          <span className={cn("truncate", !typing && "text-muted-foreground")}>
            {typing ? QUESTION.slice(0, scene.typed) : "What do you want to do"}
            {typing && <Caret />}
          </span>
        </div>
        <InputGroupAddon align="block-end">
          {working ? (
            // While Haptic is guiding, send becomes stop.
            <InputGroupButton variant="default" size="icon-sm" className="ml-auto rounded-full">
              <SquareIcon className="size-3 fill-current" />
            </InputGroupButton>
          ) : (
            <InputGroupButton variant="default" size="icon-sm" className="ml-auto rounded-full" disabled={!typing || scene.typed === 0}>
              <ArrowUpIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </motion.div>
  );
}

/** One line under the conversation that says what Haptic is doing right now. */
function Status({ composer }: { composer: Composer }) {
  if (composer === "done") {
    return (
      <Marker>
        <MarkerIcon>
          <span className="flex size-4 items-center justify-center rounded-full bg-success text-success-foreground">
            <Check className="size-3" strokeWidth={3} />
          </span>
        </MarkerIcon>
        <MarkerContent className="font-medium text-foreground">Done</MarkerContent>
      </Marker>
    );
  }
  if (composer === "pointing") {
    return (
      <Marker>
        <MarkerIcon>
          <Pointer className="size-4 text-pointer" />
        </MarkerIcon>
        <MarkerContent>Showing you how</MarkerContent>
      </Marker>
    );
  }
  // No icon. A lighter shade sweeps across the word while Haptic works.
  return (
    <Marker>
      <MarkerContent className="shimmer">Thinking</MarkerContent>
    </Marker>
  );
}
