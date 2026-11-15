import { AlertTriangle, ChevronRight, Inbox, RefreshCw } from "lucide-react";
import { Tabs as RTabs } from "radix-ui";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Employee } from "@/data/types";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import { Button } from "./button";

type Tone = "neutral" | "brand" | "ok" | "warn" | "danger" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2 ring-line",
  brand: "bg-brand-soft text-brand ring-brand/20",
  ok: "bg-ok-soft text-ok ring-ok/20",
  warn: "bg-warn-soft text-warn ring-warn/20",
  danger: "bg-danger-soft text-danger ring-danger/20",
  info: "bg-info-soft text-info ring-info/20",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ring-1 ring-inset", tones[tone], className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/** Maps any status word the app uses to a badge colour. */
export function StatusBadge({ status }: { status: string }) {
  const tone: Tone =
    /^(active|cleared|approved|paid|ok|connected|attached|done|enabled)$/.test(status)
      ? "ok"
      : /^(pending|submitted|awaiting_approval|needs_review|scheduled|syncing|invited|shipping|draft)$/.test(status)
        ? "warn"
        : /^(declined|rejected|overdue|blocked|error|flagged|frozen|suspended|missing|void)$/.test(status)
          ? "danger"
          : /^(exported|refunded|escalated)$/.test(status)
            ? "info"
            : "neutral";
  return (
    <Badge tone={tone} dot>
      {status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
    </Badge>
  );
}

export function Card({ title, description, actions, children, className, bodyClassName, footer }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; bodyClassName?: string; footer?: ReactNode }) {
  return (
    <section className={cn("rounded-lg border border-line bg-panel shadow-xs", className)}>
      {title || actions ? (
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? <h2 className="text-[14px] font-semibold text-ink">{title}</h2> : null}
            {description ? <p className="text-[12.5px] text-ink-3">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
      {footer ? <footer className="border-t border-line px-4 py-3">{footer}</footer> : null}
    </section>
  );
}

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12.5px] text-ink-3">
      {items.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 ? <ChevronRight className="size-3.5" /> : null}
          {c.to ? (
            <Link to={c.to} className="hover:text-ink hover:underline">
              {c.label}
            </Link>
          ) : (
            <span aria-current="page" className="text-ink-2">
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** The top of every page: breadcrumbs, title, a line of context and the page's actions. */
export function PageHeader({ title, description, crumbs, actions, meta, tabs }: { title: ReactNode; description?: ReactNode; crumbs?: Crumb[]; actions?: ReactNode; meta?: ReactNode; tabs?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 pb-5">
      {crumbs ? <Breadcrumbs items={crumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
          {description ? <p className="max-w-2xl text-[13px] text-ink-2">{description}</p> : null}
          {meta ? <div className="mt-1 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {tabs}
    </div>
  );
}

/** Page-level tabs that are links, so each tab has its own address. */
export function LinkTabs({ tabs, active }: { tabs: { to: string; label: string; count?: number }[]; active: string }) {
  return (
    <div role="tablist" className="flex gap-4 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          role="tab"
          aria-selected={active === t.to}
          className={cn(
            "-mb-px flex items-center gap-1.5 border-b-2 border-transparent px-0.5 pb-2 text-[13px] font-medium whitespace-nowrap text-ink-3 hover:text-ink",
            active === t.to && "border-brand text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="rounded-full bg-sunken px-1.5 text-[11px] text-ink-2">{t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}

/** In-page tabs that keep their state, like a form's sections. */
export function Tabs({ value, onValueChange, tabs, children, className }: { value: string; onValueChange: (v: string) => void; tabs: { value: string; label: ReactNode }[]; children: ReactNode; className?: string }) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange} className={className}>
      <RTabs.List className="mb-4 flex gap-1 rounded-md bg-sunken p-1">
        {tabs.map((t) => (
          <RTabs.Trigger key={t.value} value={t.value} className="cursor-pointer rounded-[5px] px-3 py-1 text-[13px] font-medium text-ink-3 data-[state=active]:bg-panel data-[state=active]:text-ink data-[state=active]:shadow-xs">
            {t.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  );
}
export const TabPanel = RTabs.Content;

export function Stat({ label, value, delta, hint, className }: { label: ReactNode; value: ReactNode; delta?: { value: string; good: boolean }; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-lg border border-line bg-panel p-4 shadow-xs", className)}>
      <span className="text-[12.5px] text-ink-3">{label}</span>
      <span className="tabular text-[22px] font-semibold tracking-tight text-ink">{value}</span>
      <span className="flex items-center gap-2 text-xs">
        {delta ? <span className={delta.good ? "text-ok" : "text-danger"}>{delta.value}</span> : null}
        {hint ? <span className="text-ink-3">{hint}</span> : null}
      </span>
    </div>
  );
}

export function Avatar({ person, size = 28, className }: { person: Pick<Employee, "firstName" | "lastName" | "avatarHue"> | undefined; size?: number; className?: string }) {
  if (!person) return <span className={cn("inline-block rounded-full bg-sunken", className)} style={{ width: size, height: size }} />;
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${person.avatarHue} 45% 42%)` }}
    >
      {initials(person.firstName, person.lastName)}
    </span>
  );
}

export function Person({ person, sub }: { person: Pick<Employee, "firstName" | "lastName" | "avatarHue"> | undefined; sub?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar person={person} size={24} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] text-ink">{person ? `${person.firstName} ${person.lastName}` : "Unknown"}</span>
        {sub ? <span className="truncate text-xs text-ink-3">{sub}</span> : null}
      </span>
    </span>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-14 text-center", className)}>
      <span className="mb-1 grid size-10 place-items-center rounded-full bg-sunken text-ink-3 [&_svg]:size-5">{icon ?? <Inbox />}</span>
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {description ? <p className="max-w-sm text-[13px] text-ink-3">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <AlertTriangle className="size-6 text-danger" />
      <p className="text-[14px] font-medium">Something went wrong</p>
      <p className="text-[13px] text-ink-3">{message}</p>
      <Button size="sm" onClick={onRetry} className="mt-2">
        <RefreshCw /> Try again
      </Button>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("block animate-pulse rounded-md bg-sunken", className)} />;
}

/** A placeholder page body while data loads. Marked aria-busy, which is what a page-settling check looks for. */
export function LoadingBlock({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-sunken px-1 font-sans text-[11px] text-ink-2">{children}</kbd>;
}

export function Progress({ value, tone = "brand", className }: { value: number; tone?: "brand" | "warn" | "danger"; className?: string }) {
  const color = tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-brand";
  return (
    <div role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} className={cn("h-1.5 w-full overflow-hidden rounded-full bg-sunken", className)}>
      <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

/** Label and value pairs, for detail pages. */
export function DescriptionList({ items, columns = 2 }: { items: { label: ReactNode; value: ReactNode }[]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4", columns === 1 ? "grid-cols-1" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
      {items.map((it, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-ink-3">{it.label}</dt>
          <dd className="truncate text-[13px] text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Callout({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "danger" | "ok"; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const map = { info: "border-info/30 bg-info-soft", warn: "border-warn/30 bg-warn-soft", danger: "border-danger/30 bg-danger-soft", ok: "border-ok/30 bg-ok-soft" };
  return (
    <div className={cn("flex items-start justify-between gap-4 rounded-lg border px-4 py-3", map[tone])}>
      <div className="flex flex-col gap-0.5 text-[13px]">
        {title ? <p className="font-medium text-ink">{title}</p> : null}
        {children ? <div className="text-ink-2">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
