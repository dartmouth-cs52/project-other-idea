"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "cn";
import { Pointer } from "@/components/pointer";
import { Button } from "@/components/ui/button";
import { api, OUTCOME_LABEL, type Brand, type Outcome } from "@/lib/app-api";

/**
 * Whether these parts are inside the dashboard. There a card is Card white on
 * Paper with a 16px title, as DESIGN.md sets out under Dashboard. On the pages
 * that stand alone, such as the install page, a card is Muted with a 24px title.
 */
const InDashboard = createContext(false);

export function DashboardSurface({ children }: { children: ReactNode }) {
  return <InDashboard.Provider value={true}>{children}</InDashboard.Provider>;
}

/**
 * Leaves a signed-in page with a full page load. The public pages load Haptic's
 * own guide (components/haptic-tag.tsx), which stays in the page once loaded, so
 * a move that kept the page would let Back bring it to the dashboard with it.
 */
export function leaveFor(path: string) {
  window.location.assign(path);
}

/**
 * For an xl button or link whose words can be wider than a phone, such as one that names a site's address or a
 * person's email. A button's words never wrap, so it would run off the screen. With this they go on to more lines
 * inside it, which keeps its 44px height for one, and an address or an email, one long word to the browser, may
 * break anywhere.
 */
export const WRAPS = "h-auto min-h-11 max-w-full py-2 whitespace-normal [overflow-wrap:anywhere]";

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

/** The surface every block on a page sits in: a 1px border and 14px corners. Muted on a page that stands alone, Card white in the dashboard. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  const dashboard = useContext(InDashboard);
  return <section className={cn("flex flex-col gap-4 rounded-xl border", dashboard ? "bg-card p-5" : "bg-muted p-6", className)}>{children}</section>;
}

const TITLE = "text-2xl font-medium tracking-[-0.02em]";
const DASHBOARD_TITLE = "text-base font-medium";

/** A step's title during setup, with its number or tick beside it. */
export function StepTitle({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  const dashboard = useContext(InDashboard);
  return (
    <div className="flex items-center gap-3">
      {mark}
      <h2 className={dashboard ? DASHBOARD_TITLE : TITLE}>{children}</h2>
    </div>
  );
}

/**
 * A page, or part of one, that could not load: a title that says what did not
 * happen, the reason in Muted text, and Try again when trying again could help.
 * Error red is for forms, so there is none here.
 */
export function FailedCard({ title, message, retry, level = 1, className }: { title: string; message: string; retry?: () => void; level?: 1 | 2; className?: string }) {
  const Heading = level === 1 ? "h1" : "h2";
  const dashboard = useContext(InDashboard);
  return (
    <Card className={className}>
      <Heading className={dashboard ? DASHBOARD_TITLE : TITLE}>{title}</Heading>
      <p className={cn("max-w-[65ch] text-muted-foreground", dashboard ? "text-sm leading-5" : "text-base leading-6")}>{message}</p>
      {retry && (
        <Button variant="secondary" className="self-start" onClick={retry}>
          Try again
        </Button>
      )}
    </Card>
  );
}

export function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const dashboard = useContext(InDashboard);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className={dashboard ? DASHBOARD_TITLE : TITLE}>{children}</h2>
      {aside}
    </div>
  );
}

/** Where a site's icon was found, kept in this browser so it is looked for once. An empty answer means the site has none. */
const iconKey = (id: string) => `haptic.icon.${id}`;

function remembered(id: string): string | null {
  try {
    return window.localStorage.getItem(iconKey(id));
  } catch {
    return null;
  }
}

function remember(id: string, address: string) {
  try {
    window.localStorage.setItem(iconKey(id), address);
  } catch {
    // Storage is off. The icon is looked for again next time.
  }
}

/**
 * A site's own icon, in a small tile. It is tried at /favicon.ico first, where
 * most sites keep one. If nothing is there, the Worker is asked once what the
 * site's first page declares. A site with no icon gets the first letter of its
 * name, as every site does while its icon loads.
 */
export function SiteIcon({ site, small = false, className }: { site: { id: string; name: string; origin: string }; small?: boolean; className?: string }) {
  const usual = `${site.origin.replace(/\/+$/, "")}/favicon.ico`;
  const [address, setAddress] = useState<string | null>(() => {
    const kept = typeof window === "undefined" ? null : remembered(site.id);
    return kept === "" ? null : (kept ?? usual);
  });
  const [shown, setShown] = useState(false);
  const [asked, setAsked] = useState(false);

  function failed() {
    setShown(false);
    if (asked || address !== usual) {
      // The declared one failed too, or a remembered one has gone: fall back to the letter, and look again another day.
      setAddress(null);
      remember(site.id, "");
      return;
    }
    setAsked(true);
    api<Brand>(`/sites/${site.id}/brand`).then(
      (brand) => {
        if (brand.icon && brand.icon !== usual) return setAddress(brand.icon);
        setAddress(null);
        remember(site.id, "");
      },
      () => setAddress(null),
    );
  }

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden font-medium uppercase",
        small ? "size-5 rounded-sm text-[11px]" : "size-9 rounded-lg text-sm",
        shown ? "border bg-card" : "bg-secondary",
        className,
      )}
      aria-hidden
    >
      {!shown && site.name.slice(0, 1)}
      {address && (
        // A plain img: the icon is on the customer's own site, at whatever size it has.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={address}
          src={address}
          alt=""
          referrerPolicy="no-referrer"
          className={cn("absolute object-contain", small ? "size-3.5" : "size-5", !shown && "opacity-0")}
          onLoad={(event) => {
            // Some servers answer a missing icon with a 1px image.
            if (event.currentTarget.naturalWidth < 8) return failed();
            setShown(true);
            remember(site.id, address);
          }}
          onError={failed}
        />
      )}
    </span>
  );
}

/** The top of a dashboard page: its name, a line under it, and its controls on the right. */
export function PageHeader({ title, note, children }: { title: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-medium tracking-[-0.02em]">{title}</h1>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}

/**
 * A dashboard card that holds records: a title row, then rows that run edge to
 * edge with hairlines between them. Text and forms go in Card.
 */
export function Panel({ title, aside, children, foot, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; foot?: ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border bg-card", className)}>
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-5 py-3">
        <h2 className={DASHBOARD_TITLE}>{title}</h2>
        {aside}
      </div>
      {children}
      {foot && <div className="border-t px-5 py-3 text-xs leading-5 text-muted-foreground">{foot}</div>}
    </section>
  );
}

/** What a panel says when it has nothing to list. */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="max-w-[65ch] px-5 pb-5 text-sm leading-5 text-muted-foreground">{children}</p>;
}

/** A few choices side by side, one of them on: a time range, a filter, the tabs of a page. */
export function Segmented<Value extends string | number>({
  label,
  value,
  options,
  onChange,
  tabs = false,
}: {
  label: string;
  value: Value;
  options: readonly { value: Value; name: string; count?: number }[];
  onChange: (value: Value) => void;
  /** True when each choice shows a different part of the page. */
  tabs?: boolean;
}) {
  return (
    <div role={tabs ? "tablist" : "group"} aria-label={label} className="flex flex-wrap gap-1">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={tabs ? "tab" : undefined}
            aria-selected={tabs ? on : undefined}
            aria-pressed={tabs ? undefined : on}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {option.name}
            {option.count !== undefined && <span className={cn("tabular-nums", on ? "text-primary-foreground/70" : "text-muted-foreground")}>{option.count.toLocaleString()}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** How a guide stands, as one of four. Each has a colour of its own in the dashboard. */
export type Tone = "good" | "bad" | "quiet" | "live";

/**
 * Which of the four a guide is. Good and bad follow the Worker's own rules for
 * a guide that succeeded and one Haptic couldn't guide (worker/health.ts and
 * worker/insights.ts), so a red mark here is a guide the top row counts. What
 * the person said outweighs how the guide ended. Quiet is the rest: stopped by
 * the visitor, left for a person, off topic, a control the company ruled out,
 * or one under way that has gone quiet and is shown as paused.
 */
export function toneOf(outcome: Outcome, helped?: boolean | null, paused?: boolean): Tone {
  if (outcome === "under_way") return paused ? "quiet" : "live";
  if (helped === true) return "good";
  if (helped === false) return "bad";
  if (outcome === "finished" || outcome === "answered" || outcome === "shown") return "good";
  if (["nothing_to_point_at", "loop", "step_limit", "error", "not_covered", "abandoned"].includes(outcome)) return "bad";
  return "quiet";
}

const DOT: Record<Exclude<Tone, "live">, string> = { good: "bg-success", bad: "bg-destructive", quiet: "bg-muted-foreground/50" };

/**
 * The 16px mark before a guide's status. A guide under way is the pointer
 * itself, in Pointer blue, because that is what is moving on someone's screen.
 * A finished one is the green tick. Anything else is a dot: green when Haptic
 * got the person there another way, red when it couldn't, grey when it was
 * never Haptic's to answer.
 */
export function StatusMark({ outcome, helped, paused, className }: { outcome: Outcome; helped?: boolean | null; paused?: boolean; className?: string }) {
  const tone = toneOf(outcome, helped, paused);
  if (tone === "live") return <Pointer bordered className={cn("pointer-shadow size-4 text-pointer", className)} />;
  if (tone === "good" && outcome === "finished") return <DoneMark className={cn("size-4", className)} />;
  return (
    <span className={cn("inline-flex size-4 shrink-0 items-center justify-center", className)} aria-hidden>
      <span className={cn("size-2 rounded-full", DOT[tone])} />
    </span>
  );
}

/**
 * How a guide stands: its mark, then a few words. One under way reads as the
 * widget's own status line does, with the shimmer. One that has had no new
 * step for two minutes reads "Paused at step 2", still and grey, because
 * nobody can say the person is still there. The words stay in the text
 * colour, so the mark is the only thing that carries the colour.
 */
export function GuideStatus({ outcome, step, helped, paused, className }: { outcome: Outcome; step?: number | null; helped?: boolean | null; paused?: boolean; className?: string }) {
  const first = step === null || step === undefined;
  let words: ReactNode = OUTCOME_LABEL[outcome];
  if (outcome === "under_way") words = paused ? (first ? "Paused before the first step" : `Paused at step ${step + 1}`) : <span className="shimmer">{first ? "Thinking" : `Showing step ${step + 1}`}</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <StatusMark outcome={outcome} helped={helped} paused={paused} />
      {words}
    </span>
  );
}

/** The current time, read again every few seconds, so "2 minutes ago" keeps up while the page stays open. */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
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
