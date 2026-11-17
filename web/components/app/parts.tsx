"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "cn";
import { Pointer } from "@/components/pointer";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth-client";
import { site } from "@/lib/site";

/**
 * Leaves a signed-in page with a full page load. The public pages load Haptic's
 * own guide (components/haptic-tag.tsx), which stays in the page once loaded, so
 * a move that kept the page would let Back bring it to the dashboard with it.
 */
export function leaveFor(path: string) {
  window.location.assign(path);
}

/**
 * The navigation on signed-in pages. The name on the left, who is signed in and Sign out on the right.
 * `who` is the person's first name, or their email when there is no name. Pointing at it shows `email`.
 */
export function AppNav({ who, email }: { who?: string; email?: string }) {
  async function signOut() {
    await auth().signOut();
    leaveFor("/sign-in/");
  }
  return (
    <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-6">
      {/* A plain link, not next/link, for the reason given at leaveFor. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="flex items-center gap-1.5 rounded-md text-lg font-medium tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Pointer className="size-[22px]" />
        {site.name}
      </a>
      {who && (
        <nav className="flex min-w-0 items-center gap-4 text-sm font-medium">
          <span title={email} className="hidden truncate text-muted-foreground sm:block">
            {who}
          </span>
          <Button variant="ghost" size="lg" onClick={signOut}>
            Sign out
          </Button>
        </nav>
      )}
    </header>
  );
}

/** The small round tick that says a task is finished. Done green is for this and nothing else. */
export function DoneMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground", className)} aria-hidden>
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}

/** A step's number in a ring, for a step not done yet. */
export function StepMark({ n }: { n: number }) {
  return (
    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-foreground/30 text-xs font-medium text-muted-foreground" aria-hidden>
      {n}
    </span>
  );
}

export function CopyButton({ text, label = "Copy", variant = "secondary" }: { text: string; label?: string; variant?: "secondary" | "default" | "ghost" }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked. The text is on screen to select by hand.
    }
  }
  return (
    <Button variant={variant} onClick={copy}>
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** Code to copy, on a Card white panel inside a Muted card. */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="relative rounded-lg border bg-card">
      <pre className="overflow-x-auto p-4 pr-28 text-sm leading-6 break-all whitespace-pre-wrap">
        <code>{code}</code>
      </pre>
      <div className="absolute top-2 right-2">
        <CopyButton text={code} label={label} />
      </div>
    </div>
  );
}

/** The surface every block on a page sits in: Muted, 1px border, 14px corners. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("flex flex-col gap-4 rounded-xl border bg-muted p-6", className)}>{children}</section>;
}

/**
 * A page, or part of one, that could not load: a title that says what did not
 * happen, the reason in Muted text, and Try again when trying again could help.
 * Error red is for forms, so there is none here.
 */
export function FailedCard({ title, message, retry, level = 1, className }: { title: string; message: string; retry?: () => void; level?: 1 | 2; className?: string }) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <Card className={className}>
      <Heading className="text-2xl font-medium tracking-[-0.02em]">{title}</Heading>
      <p className="max-w-[65ch] text-base leading-6 text-muted-foreground">{message}</p>
      {retry && (
        <Button variant="secondary" className="self-start" onClick={retry}>
          Try again
        </Button>
      )}
    </Card>
  );
}

export function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-2xl font-medium tracking-[-0.02em]">{children}</h2>
      {aside}
    </div>
  );
}

/** "3 minutes ago", "yesterday", "12 Nov". */
export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function seconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "No data yet";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
