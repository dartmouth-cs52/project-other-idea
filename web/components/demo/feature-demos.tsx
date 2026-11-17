"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import {
  APP_DOMAIN,
  AppHeader,
  Chat,
  DemoFrame,
  Field,
  LANDING_MS,
  MockButton,
  MockWindow,
  NOT_POINTING,
  Stage,
  usePlayback,
  useScript,
  type ChatView,
  type Pointing,
  type ScriptIO,
} from "./kit";

// The three small demos in the features section. Each one makes a single
// point, and each is true of the product as it works today. Wherever Haptic
// appears, its chat sits in the bottom right of the app, as it does everywhere.

/** A scene with Haptic's chat in it, shared by the first two demos. */
interface ChatScene extends Pointing {
  question: number;
  typed: number;
  sent: boolean;
  status: ChatView["status"];
  reply: string | null;
}

const CHAT_START: ChatScene = { ...NOT_POINTING, question: 0, typed: 0, sent: false, status: "idle", reply: null };

function chatView(scene: ChatScene, ask: string, source?: string): ChatView {
  return {
    typing: !scene.sent && scene.typed > 0 ? ask.slice(0, scene.typed) : null,
    question: scene.sent ? ask : null,
    status: scene.status,
    reply: scene.reply,
    source: scene.reply ? source : null,
  };
}

/** The person types a question and sends it, and Haptic thinks. */
async function ask({ wait, set, alive }: ScriptIO<ChatScene>, text: string) {
  await wait(700);
  for (let i = 1; i <= text.length && alive(); i++) {
    set({ typed: i });
    await wait(42);
  }
  await wait(350);
  set({ sent: true, status: "thinking" });
  // As long as the hero's first think, so the glow crosses the mock page before the pointer comes.
  await wait(1700);
}

// 1. Any question ------------------------------------------------------------

const QUESTIONS = [
  { ask: "Add someone to my team", target: "invite", say: "Click Invite teammate." },
  { ask: "Download this list", target: "export", say: "Click Export." },
  { ask: "Change what Sam can do", target: "manage", say: "Open Manage next to Sam." },
] as const;

const ASK_REST: ChatScene = {
  ...CHAT_START,
  sent: true,
  status: "pointing",
  target: QUESTIONS[0].target,
  marked: true,
  caption: QUESTIONS[0].say,
};

async function askScript(io: ScriptIO<ChatScene>) {
  const { wait, set, update, alive } = io;
  for (let q = 0; q < QUESTIONS.length && alive(); q++) {
    const { ask: text, target, say } = QUESTIONS[q]!;
    set({ ...CHAT_START, question: q });
    await ask(io, text);
    set({ status: "pointing", target });
    await wait(LANDING_MS);
    set({ marked: true, caption: say });
    await wait(2100);
    update((scene) => ({ ...scene, pulse: scene.pulse + 1 }));
    await wait(380);
    set({ target: null, marked: false, caption: null });
    await wait(300);
  }
}

const TEAM = [
  { name: "Maya Chen", role: "Owner", initials: "MC" },
  { name: "Sam Okafor", role: "Editor", initials: "SO", target: "manage" },
];

/** Three different questions on one page, each answered by pointing at a different control. */
export function AnyQuestionDemo() {
  const frame = useRef<HTMLDivElement>(null);
  const scene = useScript(usePlayback(frame), CHAT_START, ASK_REST, askScript);

  return (
    <DemoFrame
      ref={frame}
      label="Three different questions asked on the same page. Haptic points to a different control for each one."
      className="text-sm leading-5"
    >
      <MockWindow compact address={`${APP_DOMAIN}/team`}>
        <Stage pointing={scene} status={scene.status} layoutKey="team" className="h-[464px]">
          <AppHeader compact active="Team" />
          <div className="flex flex-col gap-2 p-4">
            <div className="mb-1 flex h-8 items-center justify-between gap-2">
              <h4 className="text-base font-medium tracking-tight">Team</h4>
              <div className="flex gap-2">
                <MockButton target="export" caption="above">
                  Export
                </MockButton>
                <MockButton target="invite" caption="above" primary>
                  Invite teammate
                </MockButton>
              </div>
            </div>
            {TEAM.map((person) => (
              <div key={person.name} className="flex h-14 items-center gap-3 rounded-lg border px-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{person.initials}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{person.name}</div>
                  <div className="truncate text-[13px] text-muted-foreground">{person.role}</div>
                </div>
                <MockButton target={person.target}>Manage</MockButton>
              </div>
            ))}
          </div>
          <div className="absolute right-3 bottom-3 z-15 w-60 max-w-[calc(100%-1.5rem)]">
            <Chat compact view={chatView(scene, QUESTIONS[scene.question]!.ask)} />
          </div>
        </Stage>
      </MockWindow>
    </DemoFrame>
  );
}

// 2. Knows the product ---------------------------------------------------------

const DOCS_ASK = "How do I invite Sam";
const DOCS_REPLY = "Press Send invite. Sam gets a link that works for 7 days.";
const DOCS_SOURCE = "From your help docs";

const DOCS_REST: ChatScene = {
  ...CHAT_START,
  sent: true,
  status: "pointing",
  target: "send",
  marked: true,
  caption: "Press Send invite.",
  reply: DOCS_REPLY,
};

async function docsScript(io: ScriptIO<ChatScene>) {
  const { wait, set, update } = io;
  await ask(io, DOCS_ASK);
  set({ status: "pointing", target: "send" });
  await wait(LANDING_MS);
  // The caption says what to do. The chat adds the detail that only the help doc mentions.
  set({ marked: true, caption: "Press Send invite.", reply: DOCS_REPLY });
  await wait(3600);
  update((scene) => ({ ...scene, pulse: scene.pulse + 1 }));
  await wait(380);
  set({ target: null, marked: false, caption: null, status: "done" });
  await wait(1600);
}

/** Haptic answers with a detail that is in the company's help doc and nowhere on the page. */
export function DocsDemo() {
  const frame = useRef<HTMLDivElement>(null);
  const scene = useScript(usePlayback(frame), CHAT_START, DOCS_REST, docsScript);

  return (
    <DemoFrame
      ref={frame}
      label="A person asks how to invite a teammate. Haptic points at the Send invite button and adds a detail taken from the company's help doc."
      className="text-sm leading-5"
    >
      <MockWindow compact address={`${APP_DOMAIN}/team`}>
        <Stage pointing={scene} status={scene.status} layoutKey="invite" className="h-[464px]">
          <AppHeader compact active="Team" />
          <div className="flex flex-col gap-3 p-4">
            <h4 className="flex h-6 items-center text-base font-medium tracking-tight">Invite</h4>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label="Email address" value={`sam@${APP_DOMAIN}`} placeholder="name@company.com" />
              </div>
              <MockButton target="send" caption="above" primary className="h-9">
                Send invite
              </MockButton>
            </div>
          </div>
          <div className="absolute right-3 bottom-3 z-15 w-60 max-w-[calc(100%-1.5rem)]">
            <Chat compact view={chatView(scene, DOCS_ASK, DOCS_SOURCE)} />
          </div>
        </Stage>
      </MockWindow>
    </DemoFrame>
  );
}

// 3. Private ------------------------------------------------------------------

const FORM = [
  { label: "Name on card", value: "Maya Chen", placeholder: "Full name" },
  { label: "Email", value: `maya@${APP_DOMAIN}`, placeholder: "you@company.com" },
  { label: "Card number", value: "4242 4242 4242 4242", placeholder: "1234 1234 1234 1234" },
];

/** What the widget sends for this page: roles and labels, with typed values left out and emails masked. */
const SEEN = [
  ["heading", "Payment details"],
  ["textbox", "Name on card"],
  ["textbox", "Email"],
  ["textbox", "Card number"],
  ["text", "Receipts to [email]"],
  ["button", "Save card"],
] as const;

interface PrivacyScene {
  /** How many characters of each field have been typed. */
  typed: [number, number, number];
  /** Which row of the right-hand list is lit, or -1 for none. */
  lit: number;
}

const PRIVACY_START: PrivacyScene = { typed: [0, 0, 0], lit: -1 };
const PRIVACY_REST: PrivacyScene = { typed: [FORM[0]!.value.length, FORM[1]!.value.length, FORM[2]!.value.length], lit: 4 };

async function privacyScript({ wait, set, update, alive }: ScriptIO<PrivacyScene>) {
  await wait(800);
  for (let field = 0; field < FORM.length && alive(); field++) {
    set({ lit: field + 1 });
    for (let n = 1; n <= FORM[field]!.value.length && alive(); n++) {
      update((scene) => {
        const typed = [...scene.typed] as PrivacyScene["typed"];
        typed[field] = n;
        return { ...scene, typed };
      });
      await wait(60);
    }
    await wait(500);
  }
  set({ lit: 4 });
  await wait(2600);
  set({ lit: -1 });
  await wait(700);
}

/** The page as the person sees it, next to the list of what Haptic reads from it. */
export function PrivacyDemo() {
  const frame = useRef<HTMLDivElement>(null);
  const scene = useScript(usePlayback(frame), PRIVACY_START, PRIVACY_REST, privacyScript);

  return (
    <DemoFrame
      ref={frame}
      label="A payment form being filled in, beside the list of what Haptic reads. The list shows field names only, never the typed values, and the email address is masked."
      className="text-sm leading-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <MockWindow compact address={`${APP_DOMAIN}/billing`}>
          <div className="flex h-[316px] flex-col gap-3 p-4">
            <h4 className="flex h-6 items-center text-base font-medium tracking-tight">Payment details</h4>
            {FORM.map((field, index) => (
              <Field key={field.label} label={field.label} value={field.value.slice(0, scene.typed[index])} placeholder={field.placeholder} />
            ))}
            <p className="truncate text-[13px] text-muted-foreground">Receipts to maya@{APP_DOMAIN}</p>
            <MockButton primary className="self-start">
              Save card
            </MockButton>
          </div>
        </MockWindow>
        <div className="flex flex-col rounded-xl border bg-card shadow-sm">
          <div className="flex h-9 items-center border-b px-4 text-xs font-medium text-muted-foreground">What Haptic reads</div>
          <ul className="flex flex-1 flex-col gap-1 p-2 font-mono text-xs leading-5">
            {SEEN.map(([role, label], index) => (
              <li
                key={label}
                className={cn("flex h-8 items-center gap-2 rounded-md px-2 transition-colors duration-300", scene.lit === index && "bg-pointer/10")}
              >
                <span className="text-muted-foreground">{role}</span>
                <span className="truncate">&quot;{label}&quot;</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </DemoFrame>
  );
}
