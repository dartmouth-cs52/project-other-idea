"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Menu } from "@base-ui/react/menu";
import { ChevronDown, Copy } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { AGENTS, type Agent } from "@/lib/agents";
import { copyText, openAppLink } from "@/lib/hand-off";
import { agentPrompt, playbookUrl } from "@/lib/install";
import { installStatus, pillLabel, type SeenOriginLike } from "@/lib/setup";
import { AgentMark, AgentMarks } from "./agent-marks";
import { DoneMark } from "./parts";

/** What the last press did, said under the pill so nothing ever seems to do nothing. */
type Note =
  | { kind: "copied" }
  | { kind: "copy-failed" }
  | { kind: "opening"; agent: Agent; copied: boolean }
  /** Pressed while another was still being tried. It goes next. */
  | { kind: "queued"; agent: Agent; after: Agent }
  | { kind: "opened"; agent: Agent; copied: boolean }
  | { kind: "not-opened"; agent: Agent; copied: boolean }
  | { kind: "blocked"; agent: Agent; copied: boolean };

const noSubscribe = () => () => {};

/**
 * "Onboard your agent": copies one line that points a coding agent at the
 * install steps for this site, the way Vercel's pill does, and offers to open
 * the prompt in Claude Code, Cursor or Codex. Every press copies and then says
 * what happened. With `live`, the site's install check, the pill's words follow
 * the install: waiting, seen on an address not allowed yet, then live.
 */
export function AgentPill({ siteId, live, className }: { siteId: string; live?: { connected: boolean; origins: SeenOriginLike[] }; className?: string }) {
  // The page's own address, so a preview hands out its own steps. Known only in the browser.
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "https://joinhaptic.com");
  const prompt = agentPrompt(origin, siteId);
  const [note, setNote] = useState<Note | null>(null);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // The agent being tried, and one pressed meanwhile, which goes next.
  const busy = useRef<Agent | null>(null);
  const queued = useRef<Agent | null>(null);

  // "Paste to your agent" turns into "Waiting for your agent" a minute after the copy, as Vercel's does.
  useEffect(() => {
    if (copiedAt === null || !live) return;
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [copiedAt, live]);

  const status = live ? installStatus(live, copiedAt, now) : copiedAt === null ? ({ kind: "idle" } as const) : ({ kind: "copied" } as const);
  const label = pillLabel(status);

  async function copy() {
    const result = await copyText(prompt);
    setNote(result.ok ? { kind: "copied" } : { kind: "copy-failed" });
    if (result.ok) {
      setCopiedAt(Date.now());
      setNow(Date.now());
    }
  }

  async function open(agent: Agent): Promise<void> {
    if (busy.current) {
      queued.current = agent;
      setNote({ kind: "queued", agent, after: busy.current });
      return;
    }
    busy.current = agent;
    try {
      // Copied first, while the press still counts as the person's own, so the prompt is there whatever the link does.
      const copied = (await copyText(prompt)).ok;
      if (copied) {
        setCopiedAt(Date.now());
        setNow(Date.now());
      }
      setNote({ kind: "opening", agent, copied });
      const result = await openAppLink(agent.link(prompt));
      setNote({ kind: result === "opened" ? "opened" : result === "blocked" ? "blocked" : "not-opened", agent, copied });
    } finally {
      busy.current = null;
    }
    const next = queued.current;
    queued.current = null;
    if (next) await open(next);
  }

  // The prompt to copy by hand, whenever the browser wouldn't copy it and no app took it.
  const showBox = note && (note.kind === "copy-failed" || ((note.kind === "not-opened" || note.kind === "blocked") && !note.copied));

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)} data-agent-pill>
      <div className="inline-flex h-11 max-w-full min-w-0 items-center self-start rounded-full border bg-card">
        <button
          type="button"
          onClick={copy}
          className="flex h-full min-w-0 items-center gap-2.5 rounded-l-full pr-3 pl-2 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {status.kind === "live" ? <DoneMark className="mx-1" /> : <AgentMarks />}
          <span className="truncate" data-pill-label>
            {label}
          </span>
          <Copy className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
        <Menu.Root>
          <Menu.Trigger
            aria-label="Open the prompt in an agent"
            className="flex h-full shrink-0 items-center rounded-r-full pr-3.5 pl-2.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:bg-muted"
          >
            <ChevronDown className="size-4" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={8} align="end" className="z-50 outline-none">
              <Menu.Popup className="flex min-w-60 origin-[var(--transform-origin)] flex-col rounded-lg border bg-card p-1 text-sm shadow-sm transition-[opacity,scale] duration-150 ease-out outline-none data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none">
                <Menu.Item onClick={copy} className="flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 outline-none select-none data-[highlighted]:bg-muted">
                  <Copy className="size-4 text-muted-foreground" />
                  Copy prompt
                </Menu.Item>
                <div className="my-1 h-px bg-border" role="separator" />
                {AGENTS.map((agent) => (
                  <Menu.Item key={agent.id} onClick={() => void open(agent)} className="flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 outline-none select-none data-[highlighted]:bg-muted">
                    <span className="inline-flex size-4 items-center justify-center">
                      <AgentMark agent={agent.id} className="size-4" />
                    </span>
                    Open in {agent.name}
                  </Menu.Item>
                ))}
                <p className="px-2.5 pt-1.5 pb-1 text-xs leading-4 text-muted-foreground">Each one copies the prompt too.</p>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>

      <p className="min-h-5 max-w-[65ch] text-sm leading-5 text-muted-foreground" role="status" aria-live="polite" data-pill-note>
        {noteText(note, live ? status.kind : "idle")}
        {note && (note.kind === "not-opened" || note.kind === "blocked") && (
          <>
            {" "}
            <a href={note.agent.get} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline-offset-4 hover:underline">
              Get {note.agent.name}
            </a>
          </>
        )}
      </p>

      {showBox && <PromptBox prompt={prompt} />}

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">See what it copies</summary>
        <div className="mt-2 flex flex-col gap-2">
          <code className="block rounded-lg border bg-card px-3.5 py-2.5 text-sm leading-6 break-all select-all">{prompt}</code>
          <a href={playbookUrl(origin, siteId)} target="_blank" rel="noopener noreferrer" className="self-start text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Read the steps your agent follows
          </a>
        </div>
      </details>
    </div>
  );
}

function noteText(note: Note | null, status: string): string {
  if (!note) return status === "idle" ? "Copies a one-line prompt for Claude Code, Cursor or Codex. Paste it in your app's folder." : "";
  switch (note.kind) {
    case "copied":
      return "Copied. Paste it into Claude Code, Cursor or Codex, in your app's folder.";
    case "copy-failed":
      return "Your browser didn't let the page copy. Select the prompt below and copy it.";
    case "opening":
      return `Opening ${note.agent.name}.${note.copied ? " The prompt is copied too." : ""}`;
    case "queued":
      return `${note.agent.name} is next, once ${note.after.name} has been tried.`;
    case "opened":
      return `Opened in ${note.agent.name}${note.agent.id === "claude" ? ", in your home folder, so change to your app's folder before you press Enter" : ""}.${note.copied ? " The prompt is also copied." : ""}`;
    case "not-opened":
      return note.copied
        ? `${note.agent.name} didn't open. The prompt is copied, paste it into your agent.`
        : `${note.agent.name} didn't open, and your browser didn't let the page copy. Select the prompt below and paste it into your agent.`;
    case "blocked":
      return note.copied
        ? `Your browser blocked the link to ${note.agent.name}. The prompt is copied, paste it into your agent.`
        : `Your browser blocked the link to ${note.agent.name} and didn't let the page copy. Select the prompt below.`;
  }
}

/** The prompt to copy by hand, when the browser won't copy it. */
function PromptBox({ prompt }: { prompt: string }) {
  const box = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start" data-prompt-box>
      <textarea
        ref={box}
        readOnly
        value={prompt}
        rows={2}
        aria-label="The prompt"
        onFocus={(event) => event.currentTarget.select()}
        className="min-h-16 w-full resize-none rounded-lg border bg-card px-3.5 py-2.5 text-sm leading-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <Button
        variant="secondary"
        onClick={() => {
          box.current?.focus();
          box.current?.select();
        }}
      >
        Select all
      </Button>
    </div>
  );
}

/** "Copy link for my developer", with the same rule: it says whether it copied, and shows the link when it couldn't. */
export function CopyLink({ link, label = "Copy link for my developer" }: { link: string; label?: string }) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Button
        variant="secondary"
        size="lg"
        className="self-start"
        onClick={async () => {
          const copied = await copyText(link);
          setResult(copied.ok ? "copied" : "failed");
        }}
      >
        <Copy />
        {result === "copied" ? "Copied" : label}
      </Button>
      {result === "failed" && (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground" role="status">
            Your browser didn&apos;t let the page copy. Select the link and copy it.
          </p>
          <code className="block rounded-lg border bg-card px-3.5 py-2 text-sm break-all select-all">{link}</code>
        </div>
      )}
    </div>
  );
}
