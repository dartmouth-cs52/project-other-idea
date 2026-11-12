"use client";

import { useRef } from "react";
import { FileTextIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AppHeader,
  Caret,
  DemoFrame,
  LANDING_MS,
  Field,
  MockButton,
  MockWindow,
  NOT_POINTING,
  Stage,
  usePlayback,
  useScript,
  type Pointing,
  type ScriptIO,
} from "./kit";

// The three small demos in the features section. Each one makes a single
// point, and each is true of the product as it works today.

// 1. Any question ------------------------------------------------------------

const QUESTIONS = [
  { ask: "Add someone to my team", target: "invite", say: "Click Invite teammate." },
  { ask: "Download this list", target: "export", say: "Click Export." },
  { ask: "Change what Lena can do", target: "manage", say: "Open Manage next to Lena." },
] as const;

interface AskScene extends Pointing {
  question: number;
  typed: number;
  thinking: boolean;
}

const ASK_START: AskScene = { ...NOT_POINTING, question: 0, typed: 0, thinking: false };
const ASK_REST: AskScene = {
  ...ASK_START,
  typed: QUESTIONS[0].ask.length,
  target: QUESTIONS[0].target,
  marked: true,
  caption: QUESTIONS[0].say,
};

async function askScript({ wait, set, update, alive }: ScriptIO<AskScene>) {
  for (let q = 0; q < QUESTIONS.length && alive(); q++) {
    const { ask, target, say } = QUESTIONS[q]!;
    set({ question: q, typed: 0, thinking: false, target: null, marked: false, caption: null });
    await wait(700);
    for (let i = 1; i <= ask.length && alive(); i++) {
      set({ typed: i });
      await wait(42);
    }
    await wait(350);
    set({ thinking: true });
    await wait(900);
    set({ thinking: false, target });
    await wait(LANDING_MS);
    set({ marked: true, caption: say });
    await wait(2100);
    update((scene) => ({ ...scene, pulse: scene.pulse + 1 }));
    await wait(380);
  }
}

const TEAM = [
  { name: "Maya Chen", role: "Owner", initials: "MC" },
  { name: "Sam Okafor", role: "Editor", initials: "SO" },
  { name: "Lena Fischer", role: "Viewer", initials: "LF", target: "manage" },
];

/** Three different questions on one page, each answered by pointing at a different control. */
export function AnyQuestionDemo() {
  const frame = useRef<HTMLDivElement>(null);
  const scene = useScript(usePlayback(frame), ASK_START, ASK_REST, askScript);
  const ask = QUESTIONS[scene.question]!.ask;

  return (
    <DemoFrame
      ref={frame}
      label="Three different questions asked on the same page. Haptic points to a different control for each one."
      className="text-sm leading-5"
    >
      <div className="flex flex-col gap-4">
        <div className="flex h-11 w-72 max-w-full items-center gap-2.5 rounded-full border bg-card px-4 shadow-sm">
          {scene.thinking ? (
            <span className="shimmer text-muted-foreground">Thinking</span>
          ) : (
            <span className={cn("truncate", scene.typed === 0 && "text-muted-foreground")}>
              {scene.typed === 0 ? "What do you want to do" : ask.slice(0, scene.typed)}
              {scene.typed > 0 && scene.typed < ask.length && <Caret />}
            </span>
          )}
        </div>
        <MockWindow compact address="app.acme.com/team">
          <Stage pointing={scene} layoutKey="team" className="h-[356px]">
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
                <div key={person.name} className="flex h-14 items-center gap-3 rounded-xl border px-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{person.initials}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{person.name}</div>
                    <div className="truncate text-[13px] text-muted-foreground">{person.role}</div>
                  </div>
                  <MockButton target={person.target}>Manage</MockButton>
                </div>
              ))}
            </div>
          </Stage>
        </MockWindow>
      </div>
    </DemoFrame>
  );
}

// 2. Knows the product ---------------------------------------------------------

interface DocsScene extends Pointing {
  /** The sentence in the help doc that the answer came from is lit. */
  cited: boolean;
}

const DOCS_START: DocsScene = { ...NOT_POINTING, cited: false };
const DOCS_SAY = "Press Send invite. The link works for 7 days.";
const DOCS_REST: DocsScene = { target: "send", marked: true, caption: DOCS_SAY, pulse: 0, cited: true };

async function docsScript({ wait, set, update }: ScriptIO<DocsScene>) {
  await wait(900);
  set({ target: "send" });
  await wait(LANDING_MS);
  set({ marked: true, caption: DOCS_SAY });
  await wait(500);
  set({ cited: true });
  await wait(3200);
  update((scene) => ({ ...scene, pulse: scene.pulse + 1 }));
  await wait(500);
  set({ target: null, marked: false, caption: null, cited: false });
  await wait(500);
}

/** A help doc above the app. Haptic's caption carries a detail that only the doc mentions. */
export function DocsDemo() {
  const frame = useRef<HTMLDivElement>(null);
  const scene = useScript(usePlayback(frame), DOCS_START, DOCS_REST, docsScript);

  return (
    <DemoFrame
      ref={frame}
      label="A help doc about inviting teammates, and Haptic pointing at the Send invite button with a detail taken from that doc."
      className="text-sm leading-5"
    >
      <div className="flex flex-col gap-4">
        <div className="max-w-sm rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
            <FileTextIcon className="size-3.5" />
            From your help docs
          </div>
          <div className="mt-2 font-medium">Inviting teammates</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Go to Team, type the person&apos;s email address and press Send invite. They get an email with a{" "}
            <span
              className={cn(
                "rounded-sm box-decoration-clone px-0.5 transition-colors duration-300",
                scene.cited ? "bg-pointer/15 text-foreground" : "bg-transparent",
              )}
            >
              link that works for 7 days
            </span>
            .
          </p>
        </div>
        <MockWindow compact address="app.acme.com/team">
          <Stage pointing={scene} layoutKey="invite" className="h-[244px]">
            <AppHeader compact active="Team" />
            <div className="flex flex-col gap-3 p-4">
              <h4 className="flex h-6 items-center text-base font-medium tracking-tight">Invite a teammate</h4>
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field label="Email address" value="sam@acme.co" placeholder="name@company.com" />
                </div>
                <MockButton target="send" primary className="h-9">
                  Send invite
                </MockButton>
              </div>
            </div>
          </Stage>
        </MockWindow>
      </div>
    </DemoFrame>
  );
}

// 3. Private ------------------------------------------------------------------

const FORM = [
  { label: "Name on card", value: "Maya Chen", placeholder: "Full name" },
  { label: "Email", value: "maya@acme.co", placeholder: "you@company.com" },
  { label: "Card number", value: "4242 4242 4242 4242", placeholder: "1234 1234 1234 1234" },
];

/** What the widget sends for this page: roles and labels, with typed values left out and emails masked. */
const SEEN = [
  ["heading", "Payment details"],
  ["textbox", "Name on card"],
  ["textbox", "Email"],
  ["textbox", "Card number"],
  ["text", "Receipts go to [email]"],
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
        <MockWindow compact address="app.acme.com/billing">
          <div className="flex h-[316px] flex-col gap-3 p-4">
            <h4 className="flex h-6 items-center text-base font-medium tracking-tight">Payment details</h4>
            {FORM.map((field, index) => (
              <Field key={field.label} label={field.label} value={field.value.slice(0, scene.typed[index])} placeholder={field.placeholder} />
            ))}
            <p className="truncate text-[13px] text-muted-foreground">Receipts go to maya@acme.co</p>
            <MockButton primary className="self-start">
              Save card
            </MockButton>
          </div>
        </MockWindow>
        <div className="flex flex-col rounded-2xl border bg-card shadow-sm">
          <div className="flex h-9 items-center border-b px-4 text-xs font-medium text-muted-foreground">What Haptic reads</div>
          <ul className="flex flex-1 flex-col gap-1 p-2 font-mono text-xs leading-5">
            {SEEN.map(([role, label], index) => (
              <li
                key={label}
                className={cn("flex h-8 items-center gap-2 rounded-lg px-2 transition-colors duration-300", scene.lit === index && "bg-pointer/10")}
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
