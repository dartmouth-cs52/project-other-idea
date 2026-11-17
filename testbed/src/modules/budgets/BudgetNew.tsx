import { CalendarDays, CalendarRange, Calendar as CalendarIcon, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { newId, upsert, useCollection } from "@/data/store";
import type { Budget } from "@/data/types";
import { useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { Button } from "@/ui/button";
import { Callout, Card, PageHeader } from "@/ui/display";
import { act, PlanGate, UnsavedGuard } from "@/ui/flow";
import { Field, Input, RadioCards, Select, Switch } from "@/ui/form";
import { Combobox, MultiSelect } from "@/ui/inputs";
import { useBudgetUi } from "./state";

const THRESHOLDS = [50, 75, 80, 90, 100];

export function BudgetNewPage() {
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Budgets", to: "/budgets" }, { label: "New budget" }]}
        title="New budget"
        description="Set a spending limit for a team. Card spend in that department counts against it as soon as it posts."
      />
      <PlanGate feature="budgets" title="Budgets">
        <BudgetForm />
      </PlanGate>
    </>
  );
}

interface Draft {
  name: string;
  departmentId: string | null;
  ownerId: string | null;
  amount: string;
  period: Budget["period"];
  thresholds: number[];
  notify: string[];
  rollover: boolean;
  rolloverCap: string;
}

const EMPTY: Draft = { name: "", departmentId: null, ownerId: null, amount: "", period: "monthly", thresholds: [80, 100], notify: [], rollover: false, rolloverCap: "none" };

function BudgetForm() {
  const navigate = useNavigate();
  const deps = useCollection("departments");
  const employees = useCollection("employees");
  const budgets = useCollection("budgets");
  const setExtras = useBudgetUi((s) => s.setExtras);
  const can = useCan("accounting.manage");
  const [d, setD] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [busy, setBusy] = useState(false);
  const [goTo, setGoTo] = useState<string | null>(null);
  const dirty = JSON.stringify(d) !== JSON.stringify(EMPTY) && !goTo;
  useEffect(() => {
    if (goTo) navigate(goTo);
  }, [goTo, navigate]);

  const depOptions = useMemo(() => deps.map((x) => ({ value: x.id, label: x.name, hint: x.parentId ? deps.find((p) => p.id === x.parentId)?.name : undefined })), [deps]);
  const people = useMemo(() => employees.filter((e) => e.status === "active").map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName}`, hint: e.title })), [employees]);
  const existing = d.departmentId ? budgets.filter((b) => b.departmentId === d.departmentId) : [];
  const set = (p: Partial<Draft>) => {
    setD((x) => ({ ...x, ...p }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(p)) delete next[k as keyof Draft];
      return next;
    });
  };

  const submit = async () => {
    const e: typeof errors = {};
    if (!d.name.trim()) e.name = "Name the budget.";
    else if (budgets.some((b) => b.name.toLowerCase() === d.name.trim().toLowerCase())) e.name = "A budget with this name already exists.";
    if (!d.departmentId) e.departmentId = "Pick the department this budget covers.";
    if (!d.ownerId) e.ownerId = "Pick who owns this budget.";
    const amount = Number(d.amount.replace(/[,$\s]/g, ""));
    if (!d.amount.trim()) e.amount = "Enter an amount.";
    else if (!Number.isFinite(amount) || amount <= 0) e.amount = "Enter an amount above zero, like 25000.";
    if (!d.thresholds.length) e.thresholds = "Pick at least one alert threshold.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const budget: Budget = { id: newId("bud"), name: d.name.trim(), departmentId: d.departmentId!, ownerId: d.ownerId!, amount, period: d.period, spent: 0, alertAt: Math.min(...d.thresholds) };
    const ok = await act(
      () => {
        upsert("budgets", budget);
        setExtras(budget.id, { thresholds: d.thresholds, notify: d.notify, rollover: d.rollover, rolloverCap: d.rolloverCap });
        return true;
      },
      { success: `Created "${budget.name}"` },
    );
    setBusy(false);
    if (ok) setGoTo(`/budgets/${budget.id}`);
  };

  return (
    <form
      className="flex max-w-3xl flex-col gap-5 pb-10"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <UnsavedGuard when={dirty} />
      <Card title="Basics">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Budget name" error={errors.name} className="sm:col-span-2">
            {(id) => <Input id={id} value={d.name} aria-invalid={!!errors.name} placeholder="Marketing events, Q1" onChange={(e) => set({ name: e.target.value })} />}
          </Field>
          <Field label="Department" error={errors.departmentId} hint={existing.length ? `${existing.length === 1 ? "1 budget already covers" : `${existing.length} budgets already cover`} this department.` : undefined}>
            {(id) => (
              <Combobox
                id={id}
                aria-label="Department"
                value={d.departmentId}
                onChange={(v) => {
                  const manager = deps.find((x) => x.id === v)?.managerId ?? null;
                  set({ departmentId: v, ownerId: d.ownerId ?? manager });
                }}
                options={depOptions}
                placeholder="Choose a department"
                searchPlaceholder="Search departments…"
              />
            )}
          </Field>
          <Field label="Owner" error={errors.ownerId} hint="Gets every alert and approves overages.">
            {(id) => <Combobox id={id} aria-label="Owner" value={d.ownerId} onChange={(v) => set({ ownerId: v })} options={people} placeholder="Choose a person" searchPlaceholder="Search people…" />}
          </Field>
        </div>
      </Card>

      <Card title="Amount and period">
        <div className="flex flex-col gap-4">
          <Field label="Amount" error={errors.amount} hint={d.amount && !errors.amount && Number(d.amount) > 0 ? `${money(Number(d.amount))} per ${d.period.replace("ly", "")}` : "In US dollars."}>
            {(id) => <Input id={id} inputMode="decimal" value={d.amount} aria-invalid={!!errors.amount} placeholder="25,000" prefix="$" onChange={(e) => set({ amount: e.target.value })} className="max-w-56" />}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Period</span>
            <RadioCards
              name="period"
              columns={3}
              value={d.period}
              onValueChange={(period) => set({ period })}
              options={[
                { value: "monthly", label: "Monthly", description: "Resets on the 1st", icon: <CalendarIcon /> },
                { value: "quarterly", label: "Quarterly", description: "Jan, Apr, Jul, Oct", icon: <CalendarRange /> },
                { value: "yearly", label: "Yearly", description: "Resets Jan 1", icon: <CalendarDays /> },
              ]}
            />
          </div>
          <Switch checked={d.rollover} onCheckedChange={(rollover) => set({ rollover })} label="Roll over unused budget" description="Whatever is left at the end of a period is added to the next one." />
          {/* Appears only when rollover is on, on purpose. */}
          {d.rollover ? (
            <Field label="Rollover cap" className="max-w-xs">
              {(id) => (
                <Select
                  id={id}
                  aria-label="Rollover cap"
                  value={d.rolloverCap}
                  onValueChange={(rolloverCap) => set({ rolloverCap })}
                  options={[
                    { value: "none", label: "No cap" },
                    { value: "25", label: "Up to 25% of the budget" },
                    { value: "50", label: "Up to 50% of the budget" },
                    { value: "100", label: "Up to 100% of the budget" },
                  ]}
                />
              )}
            </Field>
          ) : null}
        </div>
      </Card>

      <Card title="Alerts" description="We email the owner and anyone below when spend crosses each threshold.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span id="thresholds-label" className="text-[13px] font-medium">
              Alert thresholds
            </span>
            <div role="group" aria-labelledby="thresholds-label" className="flex flex-wrap gap-2">
              {THRESHOLDS.map((t) => {
                const on = d.thresholds.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ thresholds: on ? d.thresholds.filter((x) => x !== t) : [...d.thresholds, t].sort((a, b) => a - b) })}
                    className={cn(
                      "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium",
                      on ? "border-brand bg-brand-soft text-brand" : "border-line-strong bg-panel text-ink-2 hover:bg-sunken",
                    )}
                  >
                    {on ? <Check className="size-3.5" /> : null}
                    {t}%
                  </button>
                );
              })}
            </div>
            {errors.thresholds ? <p className="text-xs text-danger">{errors.thresholds}</p> : <p className="text-xs text-ink-3">The lowest one is the warning shown on the budget card.</p>}
          </div>
          <Field label="Also notify" optional>
            {(id) => <MultiSelect id={id} aria-label="Add people to notify" value={d.notify} onChange={(notify) => set({ notify })} options={people} placeholder="Add people…" />}
          </Field>
        </div>
      </Card>

      {!can.allowed ? <Callout tone="warn" title="You can't create budgets">{can.reason}</Callout> : null}

      <div className="flex justify-end gap-2">
        <Button asChild>
          <Link to="/budgets">Cancel</Link>
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!can.allowed}>
          Create budget
        </Button>
      </div>
    </form>
  );
}

