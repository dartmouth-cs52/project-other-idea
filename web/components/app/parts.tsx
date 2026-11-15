"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { cn } from "cn";
import { Pointer } from "@/components/pointer";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth-client";
import { site } from "@/lib/site";

/** The navigation on signed-in pages. The name on the left, who is signed in and Sign out on the right. */
export function AppNav({ who }: { who?: string }) {
  const router = useRouter();
  async function signOut() {
    await auth().signOut();
    router.push("/sign-in/");
  }
  return (
    <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-6">
      <Link href="/" className="flex items-center gap-1.5 rounded-md text-lg font-medium tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Pointer className="size-[22px]" />
        {site.name}
      </Link>
      {who && (
        <nav className="flex min-w-0 items-center gap-4 text-sm font-medium">
          <span className="hidden truncate text-muted-foreground sm:block">{who}</span>
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
      <pre className="overflow-x-auto p-4 pr-28 text-sm leading-6">
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
