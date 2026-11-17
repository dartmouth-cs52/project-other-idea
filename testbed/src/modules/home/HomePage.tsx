import { format, parseISO, startOfMonth, subDays } from "date-fns";
import { ArrowRight, CheckCircle2, Circle, CreditCard, Receipt, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
import { useEntityFilter } from "@/app/session";
import { ME_ID, patch, useCollection, useIndex, useRow } from "@/data/store";
import type { Transaction } from "@/data/types";
import { cn } from "@/lib/cn";
import { ago, money, shortDate } from "@/lib/format";
import { useLab } from "@/lab/lab";
import { Button } from "@/ui/button";
import { Avatar, Badge, Callout, Card, PageHeader, Progress, Stat, StatusBadge } from "@/ui/display";
import { Loader } from "@/ui/flow";

const PALETTE = ["#17633a", "#3fae6c", "#8fd1a8", "#2456b8", "#7aa5f5", "#a15c00", "#f0a637", "#7d8781"];

export function HomePage() {
  const me = useRow("employees", ME_ID);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("northpine-home-callout") === "1";
    } catch {
      return false;
    }
  });
  return (
    <>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${me?.firstName ?? ""}`}
        description="Here's where spending stands this month."
        actions={
          <>
            <Button asChild>
              <Link to="/reports">View reports</Link>
            </Button>
            <Button variant="primary" asChild>
              <Link to="/cards/new">
                <CreditCard /> Issue card
              </Link>
            </Button>
          </>
        }
      />
      {dismissed ? null : (
        <div className="mb-5">
          <Callout
            tone="info"
            title="Per diem rates for 2027 are live"
            action={
              <button
                type="button"
                aria-label="Dismiss"
                className="cursor-pointer text-ink-3 hover:text-ink"
                onClick={() => {
                  setDismissed(true);
                  try {
                    localStorage.setItem("northpine-home-callout", "1");
                  } catch {
                    // ignore
                  }
                }}
              >
                <X className="size-4" />
              </button>
            }
          >
            Travelers now get the new rates automatically. <Link to="/policies" className="font-medium text-brand hover:underline">Review your travel policy</Link>
          </Callout>
        </div>
      )}
      <Loader loadKey="home" rows={10}>
        {() => <HomeBody />}
      </Loader>
    </>
  );
}

function HomeBody() {
  const filter = useEntityFilter();
  const allTx = useCollection("transactions");
  const tx = useMemo(() => filter(allTx), [allTx, filter]);
  const approvals = useCollection("approvals");
  const bills = useCollection("bills");
  const cards = useCollection("cards");
  const monthStart = startOfMonth(new Date()).toISOString();
  const thisMonth = useMemo(() => tx.filter((t) => t.date >= monthStart && t.status !== "declined"), [tx, monthStart]);
  const spend = thisMonth.reduce((s, t) => s + (t.status === "refunded" ? -t.amount : t.amount), 0);
  const missing = tx.slice(0, 2000).filter((t) => t.receipt === "missing").length;
  const pending = approvals.filter((a) => a.status === "pending").length;
  const activeCards = cards.filter((c) => c.status === "active");
  const available = activeCards.reduce((s, c) => s + Math.max(0, c.limitAmount - c.spentThisPeriod), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Spent this month" value={money(spend, "USD", { compact: true })} delta={{ value: "+8.2%", good: false }} hint="vs last month" />
        <Stat label="Available on cards" value={money(available, "USD", { compact: true })} hint={`${activeCards.length} active cards`} />
        <Link to="/approvals" className="block rounded-lg hover:ring-2 hover:ring-brand/20">
          <Stat label="Waiting for approval" value={pending} hint="across all stages" />
        </Link>
        <Link to="/expenses?receipt=missing" className="block rounded-lg hover:ring-2 hover:ring-brand/20">
          <Stat label="Missing receipts" value={missing} hint="last 60 days" delta={{ value: "12 new", good: false }} />
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Spend over time" description="Cleared and pending card spend" className="lg:col-span-2" actions={null}>
          <SpendChart transactions={tx} />
        </Card>
        <Card title="By category" description="This month">
          <CategoryDonut transactions={thisMonth} />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <SetupChecklist />
        <RecentActivity transactions={tx.slice(0, 8)} />
        <UpcomingBills bills={bills} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <BudgetWatch />
        <LiveFeed />
      </div>
    </div>
  );
}

/** Drawn on a canvas, so none of its points exist in the DOM. */
function SpendChart({ transactions }: { transactions: Transaction[] }) {
  const [range, setRange] = useState<30 | 90 | 365>(30);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; label: string; value: number } | null>(null);
  const theme = useLab((s) => s.theme);

  const series = useMemo(() => {
    const days = new Map<string, number>();
    const since = subDays(new Date(), range).toISOString();
    for (const t of transactions) {
      if (t.date < since) break;
      if (t.status === "declined") continue;
      const key = range === 365 ? t.date.slice(0, 7) : t.date.slice(0, 10);
      days.set(key, (days.get(key) ?? 0) + t.amount);
    }
    return [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [transactions, range]);

  useEffect(() => {
    const c = canvas.current;
    const w = wrap.current;
    if (!c || !w) return;
    const draw = () => {
      const dpr = devicePixelRatio || 1;
      const width = w.clientWidth;
      const height = 240;
      c.width = width * dpr;
      c.height = height * dpr;
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
      const ctx = c.getContext("2d")!;
      ctx.scale(dpr, dpr);
      const styles = getComputedStyle(document.documentElement);
      const brand = styles.getPropertyValue("--np-brand").trim();
      const line = styles.getPropertyValue("--np-line").trim();
      const ink3 = styles.getPropertyValue("--np-ink-3").trim();
      const pad = { l: 48, r: 8, t: 10, b: 24 };
      const max = Math.max(1, ...series.map(([, v]) => v));
      const x = (i: number) => pad.l + (i / Math.max(1, series.length - 1)) * (width - pad.l - pad.r);
      const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.fillStyle = ink3;
      ctx.strokeStyle = line;
      for (let i = 0; i <= 4; i++) {
        const v = (max / 4) * i;
        ctx.beginPath();
        ctx.moveTo(pad.l, y(v));
        ctx.lineTo(width - pad.r, y(v));
        ctx.stroke();
        ctx.fillText(money(v, "USD", { compact: true }), 4, y(v) + 4);
      }
      if (series.length < 2) return;
      const grad = ctx.createLinearGradient(0, pad.t, 0, height - pad.b);
      grad.addColorStop(0, `${brand}55`);
      grad.addColorStop(1, `${brand}00`);
      ctx.beginPath();
      series.forEach(([, v], i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
      ctx.lineTo(x(series.length - 1), height - pad.b);
      ctx.lineTo(x(0), height - pad.b);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      series.forEach(([, v], i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
      ctx.strokeStyle = brand;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = ink3;
      const step = Math.ceil(series.length / 6);
      series.forEach(([k], i) => {
        if (i % step) return;
        ctx.fillText(range === 365 ? format(parseISO(`${k}-01`), "MMM") : format(parseISO(k), "MMM d"), x(i) - 14, height - 6);
      });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(w);
    return () => ro.disconnect();
  }, [series, range, theme]);

  return (
    <div>
      <div role="radiogroup" aria-label="Time range" className="mb-3 inline-flex rounded-md bg-sunken p-0.5">
        {([30, 90, 365] as const).map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={range === r}
            onClick={() => setRange(r)}
            className={cn("cursor-pointer rounded-[5px] px-2.5 py-1 text-[12px] font-medium text-ink-3", range === r && "bg-panel text-ink shadow-xs")}
          >
            {r === 365 ? "12 months" : `${r} days`}
          </button>
        ))}
      </div>
      <div ref={wrap} className="relative">
        <canvas
          ref={canvas}
          role="img"
          aria-label="Spend over time"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const i = Math.round(((e.clientX - rect.left - 48) / (rect.width - 56)) * (series.length - 1));
            const point = series[Math.max(0, Math.min(series.length - 1, i))];
            if (point) setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, label: point[0], value: point[1] });
          }}
          onMouseLeave={() => setHover(null)}
        />
        {hover ? (
          <div className="pointer-events-none absolute rounded-md bg-ink px-2 py-1 text-xs text-bg shadow-lg" style={{ left: hover.x + 12, top: hover.y - 10 }}>
            {hover.label}: {money(hover.value)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** An SVG chart, so its slices are in the DOM but have no labels. */
function CategoryDonut({ transactions }: { transactions: Transaction[] }) {
  const cats = useIndex("categories");
  const data = useMemo(() => {
    const sums = new Map<string, number>();
    for (const t of transactions) {
      const name = (t.categoryId && cats.get(t.categoryId)?.name) || "Uncategorized";
      sums.set(name, (sums.get(name) ?? 0) + t.amount);
    }
    const sorted = [...sums.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6).reduce((s, [, v]) => s + v, 0);
    return [...top, ...(rest ? [["Other", rest] as [string, number]] : [])].map(([name, value]) => ({ name, value }));
  }, [transactions, cats]);
  return (
    <div className="flex flex-col gap-3">
      <div className="h-44">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={1} stroke="none">
              {data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <RTooltip formatter={(v) => money(Number(v))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-col gap-1.5">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2 text-[12.5px]">
            <span className="size-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="flex-1 text-ink-2">{d.name}</span>
            <span className="tabular">{money(d.value, "USD", { compact: true })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SetupChecklist() {
  const tasks = useCollection("tasks");
  const done = tasks.filter((t) => t.done).length;
  return (
    <Card title="Finish setting up" description={`${done} of ${tasks.length} done`}>
      <Progress value={(done / tasks.length) * 100} className="mb-3" />
      <ul className="flex flex-col">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-2 border-b border-line py-2 last:border-0">
            <button
              type="button"
              aria-label={t.done ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`}
              onClick={() => patch("tasks", t.id, { done: !t.done })}
              className="cursor-pointer text-ink-3 hover:text-brand"
            >
              {t.done ? <CheckCircle2 className="size-4 text-brand" /> : <Circle className="size-4" />}
            </button>
            <Link to={t.href} className={cn("flex-1 text-[13px] hover:underline", t.done && "text-ink-3 line-through")}>
              {t.title}
            </Link>
            <ArrowRight className="size-3.5 text-ink-3" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RecentActivity({ transactions }: { transactions: Transaction[] }) {
  const people = useIndex("employees");
  return (
    <Card
      title="Latest card spend"
      actions={
        <Button variant="link" size="sm" asChild>
          <Link to="/expenses">See all</Link>
        </Button>
      }
      bodyClassName="p-0"
    >
      <ul>
        {transactions.map((t) => (
          <li key={t.id}>
            <Link to={`/expenses/${t.id}`} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0 hover:bg-sunken/60">
              <Avatar person={people.get(t.employeeId)} size={26} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px]">{t.merchant}</span>
                <span className="text-xs text-ink-3">{ago(t.date)}</span>
              </span>
              <span className="flex flex-col items-end gap-0.5">
                <span className="tabular text-[13px]">{money(t.amount, t.currency)}</span>
                {t.receipt === "missing" ? (
                  <Badge tone="warn">
                    <Receipt className="size-3" /> Receipt
                  </Badge>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function UpcomingBills({ bills }: { bills: ReturnType<typeof useCollection<"bills">> }) {
  const vendors = useIndex("vendors");
  const upcoming = useMemo(() => bills.filter((b) => b.status === "scheduled" || b.status === "awaiting_approval" || b.status === "overdue").sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6), [bills]);
  return (
    <Card
      title="Bills due"
      actions={
        <Button variant="link" size="sm" asChild>
          <Link to="/bills">All bills</Link>
        </Button>
      }
      bodyClassName="p-0"
    >
      <ul>
        {upcoming.map((b) => {
          const total = b.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
          return (
            <li key={b.id}>
              <Link to={`/bills/${b.id}`} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0 hover:bg-sunken/60">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px]">{vendors.get(b.vendorId)?.name}</span>
                  <span className="text-xs text-ink-3">Due {shortDate(b.dueDate)}</span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="tabular text-[13px]">{money(total)}</span>
                  <StatusBadge status={b.status} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function BudgetWatch() {
  const budgets = useCollection("budgets");
  const deps = useIndex("departments");
  const top = useMemo(() => [...budgets].sort((a, b) => b.spent / b.amount - a.spent / a.amount).slice(0, 5), [budgets]);
  return (
    <Card
      title="Budgets to watch"
      actions={
        <Button variant="link" size="sm" asChild>
          <Link to="/budgets">Budgets</Link>
        </Button>
      }
    >
      <ul className="flex flex-col gap-4">
        {top.map((b) => {
          const p = (b.spent / b.amount) * 100;
          return (
            <li key={b.id}>
              <Link to={`/budgets/${b.id}`} className="flex flex-col gap-1.5 hover:opacity-80">
                <span className="flex justify-between text-[13px]">
                  <span>
                    {b.name} <span className="text-ink-3">· {deps.get(b.departmentId)?.name}</span>
                  </span>
                  <span className="tabular text-ink-2">
                    {money(b.spent, "USD", { compact: true })} of {money(b.amount, "USD", { compact: true })}
                  </span>
                </span>
                <Progress value={p} tone={p > 100 ? "danger" : p > b.alertAt ? "warn" : "brand"} />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const FEED_MERCHANTS = ["Evergreen Coffee", "Metro Rideshare", "CloudStack Hosting", "Basil Street Bistro", "Skyline Air", "Parcelpoint Shipping"];

/**
 * When the test panel turns it on, a new line arrives every 2.5 seconds and the
 * relative times tick. A page that never stops changing is hard to "settle" on.
 */
function LiveFeed() {
  const on = useLab((s) => s.liveFeed);
  const people = useCollection("employees");
  const [events, setEvents] = useState<{ id: number; who: string; what: string; at: number }[]>([]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    let n = 0;
    const add = setInterval(() => {
      const p = people[Math.floor(Math.random() * 60)];
      const m = FEED_MERCHANTS[Math.floor(Math.random() * FEED_MERCHANTS.length)];
      setEvents((e) => [{ id: n++, who: `${p.firstName} ${p.lastName}`, what: `spent ${money(Math.round(Math.random() * 40000) / 100)} at ${m}`, at: Date.now() }, ...e].slice(0, 8));
    }, 2500);
    const clock = setInterval(() => tick((x) => x + 1), 1000);
    return () => {
      clearInterval(add);
      clearInterval(clock);
    };
  }, [on, people]);
  return (
    <Card title="Live activity" description={on ? "Updating as cards are used" : "Paused"} actions={on ? <Badge tone="ok" dot>Live</Badge> : <Badge>Paused</Badge>}>
      {events.length === 0 ? (
        <p className="text-[13px] text-ink-3">{on ? "Waiting for the next charge…" : "Turn on the live feed in the test panel to watch charges arrive."}</p>
      ) : (
        <ul aria-live="polite" className="flex flex-col gap-2">
          {events.map((e) => (
            <li key={e.id} className="flex animate-in items-center justify-between gap-3 text-[13px]">
              <span>
                <span className="font-medium">{e.who}</span> <span className="text-ink-2">{e.what}</span>
              </span>
              <span className="tabular text-xs whitespace-nowrap text-ink-3">{Math.round((Date.now() - e.at) / 1000)}s ago</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
