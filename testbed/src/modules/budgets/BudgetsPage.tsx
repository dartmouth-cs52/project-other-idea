import { AlertTriangle, ChevronDown, ChevronRight, PiggyBank, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useCollection, useIndex } from "@/data/store";
import type { Budget } from "@/data/types";
import { cn } from "@/lib/cn";
import { money, pct } from "@/lib/format";
import { Button } from "@/ui/button";
import { Avatar, Badge, EmptyState, PageHeader, Progress, Stat } from "@/ui/display";
import { Loader, PlanGate, RoleGate } from "@/ui/flow";
import { Input, Select } from "@/ui/form";
import { inPeriod, PERIOD_LABELS, rootOf, tone, useBudgetUi, type Period } from "./state";

type Status = "all" | "over" | "near" | "ok";

export function BudgetsPage() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Budgets"
        description="Monthly, quarterly and yearly limits for each team, tracked against card spend as it happens."
        actions={
          <RoleGate action="accounting.manage">
            {(ok) => (
              <Button variant="primary" disabled={!ok} onClick={() => navigate("/budgets/new")}>
                <Plus /> New budget
              </Button>
            )}
          </RoleGate>
        }
      />
      <PlanGate feature="budgets" title="Budgets">
        <Loader loadKey="budgets" rows={8}>
          {() => <BudgetsBody />}
        </Loader>
      </PlanGate>
    </>
  );
}

function BudgetsBody() {
  const budgets = useCollection("budgets");
  const deps = useIndex("departments");
  const { period, setPeriod, collapsed, toggle } = useBudgetUi();
  const [dept, setDept] = useState("all");
  const [status, setStatus] = useState<Status>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      budgets.map((b) => {
        const v = inPeriod(b, period);
        const p = (v.spent / v.amount) * 100;
        return { b, ...v, p, status: (p > 100 ? "over" : p >= b.alertAt ? "near" : "ok") as Exclude<Status, "all">, root: rootOf(b.departmentId, deps) };
      }),
    [budgets, period, deps],
  );
  const filtered = rows.filter(
    (r) =>
      (dept === "all" || r.b.departmentId === dept || r.root?.id === dept) &&
      (status === "all" || r.status === status) &&
      r.b.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const groups = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    for (const r of filtered) {
      const k = r.root?.id ?? "none";
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort((a, b) => (deps.get(a[0])?.name ?? "").localeCompare(deps.get(b[0])?.name ?? ""));
  }, [filtered, deps]);

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const spent = rows.reduce((s, r) => s + r.spent, 0);
  const over = rows.filter((r) => r.status === "over");
  const near = rows.filter((r) => r.status === "near");
  const topDeps = [...deps.values()].filter((d) => !d.parentId);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={`Budgeted, ${PERIOD_LABELS[period].toLowerCase()}`} value={money(total, "USD", { compact: true })} hint={`${budgets.length} budgets`} />
        <Stat label="Spent" value={money(spent, "USD", { compact: true })} hint={`${pct((spent / total) * 100)} of budget`} />
        <Stat label="Over budget" value={over.length} hint={over.length ? over.map((r) => r.b.name).slice(0, 2).join(", ") : "None"} />
        <Stat label="Near their limit" value={near.length} hint="past their alert threshold" />
      </div>

      {over.length ? (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 text-danger" />
          <span>
            <span className="font-medium">{over.length === 1 ? "1 budget is" : `${over.length} budgets are`} over for {PERIOD_LABELS[period].toLowerCase()}.</span>{" "}
            <span className="text-ink-2">Owners were emailed when they crossed 100%.</span>
          </span>
          <Button size="sm" variant="link" className="ml-auto" onClick={() => setStatus("over")}>
            Show only these
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Period" className="inline-flex rounded-md bg-sunken p-0.5">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={cn("cursor-pointer rounded-[5px] px-3 py-1 text-[12.5px] font-medium text-ink-3", period === p && "bg-panel text-ink shadow-xs")}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        <Select
          aria-label="Department"
          className="w-52"
          value={dept}
          onValueChange={setDept}
          options={[{ value: "all", label: "All departments" }, ...topDeps.map((d) => ({ value: d.id, label: d.name }))]}
        />
        <Select
          aria-label="Status"
          className="w-40"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: "all", label: "Any status" },
            { value: "over", label: "Over budget" },
            { value: "near", label: "Near limit" },
            { value: "ok", label: "On track" },
          ]}
        />
        <Input aria-label="Search budgets" placeholder="Search budgets" value={query} onChange={(e) => setQuery(e.target.value)} className="w-52" />
        {dept !== "all" || status !== "all" || query ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDept("all");
              setStatus("all");
              setQuery("");
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-line bg-panel">
          <EmptyState icon={<PiggyBank />} title="No budgets match" description="Try another department or status, or clear the filters." />
        </div>
      ) : (
        groups.map(([rootId, items]) => {
          const name = deps.get(rootId)?.name ?? "Other";
          const open = !collapsed.includes(rootId);
          const gAmount = items.reduce((s, r) => s + r.amount, 0);
          const gSpent = items.reduce((s, r) => s + r.spent, 0);
          return (
            <section key={rootId} className="flex flex-col gap-3">
              <button type="button" aria-expanded={open} onClick={() => toggle(rootId)} className="flex cursor-pointer items-center gap-2 text-left">
                {open ? <ChevronDown className="size-4 text-ink-3" /> : <ChevronRight className="size-4 text-ink-3" />}
                <h2 className="text-[14px] font-semibold">{name}</h2>
                <span className="text-[12.5px] text-ink-3">
                  {items.length} {items.length === 1 ? "budget" : "budgets"} · {money(gSpent, "USD", { compact: true })} of {money(gAmount, "USD", { compact: true })}
                </span>
              </button>
              {open ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((r) => (
                    <BudgetCard key={r.b.id} budget={r.b} amount={r.amount} spent={r.spent} />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })
      )}
    </div>
  );
}

function BudgetCard({ budget, amount, spent }: { budget: Budget; amount: number; spent: number }) {
  const navigate = useNavigate();
  const deps = useIndex("departments");
  const people = useIndex("employees");
  const owner = people.get(budget.ownerId);
  const p = (spent / amount) * 100;
  const t = tone(spent, amount, budget.alertAt);
  return (
    // A clickable div, not a link: no role, no href, just a pointer cursor. On purpose.
    <div onClick={() => navigate(`/budgets/${budget.id}`)} className="flex cursor-pointer flex-col gap-3 rounded-lg border border-line bg-panel p-4 shadow-xs transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13.5px] font-semibold">{budget.name}</span>
          <span className="text-xs text-ink-3">
            {deps.get(budget.departmentId)?.name} · {budget.period}
          </span>
        </div>
        {t === "danger" ? (
          <Badge tone="danger">
            <AlertTriangle className="size-3" /> Over by {money(spent - amount, "USD", { compact: true })}
          </Badge>
        ) : t === "warn" ? (
          <Badge tone="warn">{pct(p)} used</Badge>
        ) : (
          <Badge tone="ok">On track</Badge>
        )}
      </div>
      <Progress value={p} tone={t} />
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="tabular">
          <span className="font-medium">{money(spent, "USD", { compact: true })}</span> <span className="text-ink-3">of {money(amount, "USD", { compact: true })}</span>
        </span>
        <span className="flex items-center gap-1.5 text-ink-3">
          <Avatar person={owner} size={18} />
          {owner ? `${owner.firstName} ${owner.lastName[0]}.` : "No owner"}
        </span>
      </div>
    </div>
  );
}
