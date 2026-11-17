import { endOfMonth, format, getDaysInMonth, parseISO, startOfMonth } from "date-fns";
import { Archive, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { patch, remove, upsert, useCollection, useIndex, useRow } from "@/data/store";
import type { Budget, Transaction } from "@/data/types";
import { money, masked, pct, shortDate } from "@/lib/format";
import { Button } from "@/ui/button";
import { Badge, Card, DescriptionList, EmptyState, PageHeader, Person, Progress, Stat, StatusBadge } from "@/ui/display";
import { DataTable, type ColumnDef } from "@/ui/data-table";
import { act, Loader, PlanGate, RoleGate } from "@/ui/flow";
import { Field, Input, Select } from "@/ui/form";
import { Combobox, MultiSelect } from "@/ui/inputs";
import { ConfirmDialog, Sheet } from "@/ui/overlay";
import { tone, useBudgetUi } from "./state";

export function BudgetDetailPage() {
  const { id } = useParams();
  const budget = useRow("budgets", id);
  if (!budget)
    return (
      <>
        <PageHeader title="Budget not found" crumbs={[{ label: "Budgets", to: "/budgets" }, { label: "Not found" }]} />
        <EmptyState
          title="This budget doesn't exist"
          description="It may have been archived."
          action={
            <Button asChild>
              <Link to="/budgets">Back to budgets</Link>
            </Button>
          }
        />
      </>
    );
  return (
    <PlanGate feature="budgets" title="Budgets">
      <Loader loadKey={["budget", id]} rows={10}>
        {() => <BudgetDetail budget={budget} />}
      </Loader>
    </PlanGate>
  );
}

function BudgetDetail({ budget }: { budget: Budget }) {
  const navigate = useNavigate();
  const deps = useIndex("departments");
  const people = useIndex("employees");
  const cards = useIndex("cards");
  const allTx = useCollection("transactions");
  const extras = useBudgetUi((s) => s.extras[budget.id]);
  const [editing, setEditing] = useState(false);
  // Bumped on every open, so the sheet starts from the saved budget each time.
  const [editKey, setEditKey] = useState(0);
  const [archiving, setArchiving] = useState(false);
  const dep = deps.get(budget.departmentId);
  const owner = people.get(budget.ownerId);
  const p = (budget.spent / budget.amount) * 100;
  const t = tone(budget.spent, budget.amount, budget.alertAt);

  const monthStart = startOfMonth(new Date()).toISOString();
  const tx = useMemo(() => allTx.filter((x) => x.departmentId === budget.departmentId && x.date >= monthStart && x.status !== "declined"), [allTx, budget.departmentId, monthStart]);

  // Daily running total for this month, scaled so it ends at the budget's spend.
  const series = useMemo(() => {
    const now = new Date();
    const days = getDaysInMonth(now);
    const today = now.getDate();
    const raw = Array.from({ length: days }, () => 0);
    for (const x of tx) raw[parseISO(x.date).getDate() - 1] += x.status === "refunded" ? -x.amount : x.amount;
    const actual = raw.slice(0, today).reduce((s, v) => s + v, 0) || 1;
    const scale = budget.spent / actual;
    let run = 0;
    const perDay = budget.spent / today;
    const monthly = budget.period === "monthly" ? budget.amount : budget.period === "quarterly" ? budget.amount / 3 : budget.amount / 12;
    return raw.map((v, i) => {
      if (i < today) run += v * scale;
      return {
        day: format(new Date(now.getFullYear(), now.getMonth(), i + 1), "MMM d"),
        spent: i < today ? Math.round(run) : null,
        forecast: i >= today - 1 ? Math.round(budget.spent + perDay * (i + 1 - today)) : null,
        pace: Math.round((monthly / days) * (i + 1)),
      };
    });
  }, [tx, budget]);
  const forecast = series[series.length - 1]?.forecast ?? budget.spent;
  const monthlyAmount = budget.period === "monthly" ? budget.amount : budget.period === "quarterly" ? budget.amount / 3 : budget.amount / 12;

  const columns = useMemo<ColumnDef<Transaction, unknown>[]>(
    () => [
      { id: "date", header: "Date", accessorFn: (r) => r.date, size: 90, cell: ({ row }) => <span className="text-ink-2">{shortDate(row.original.date)}</span> },
      {
        id: "merchant",
        header: "Merchant",
        accessorFn: (r) => r.merchant,
        cell: ({ row }) => (
          <Link to={`/expenses/${row.original.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {row.original.merchant}
          </Link>
        ),
      },
      {
        id: "person",
        header: "Person",
        accessorFn: (r) => people.get(r.employeeId)?.lastName ?? "",
        cell: ({ row }) => (
          <Link to={`/people/${row.original.employeeId}`} className="hover:underline">
            <Person person={people.get(row.original.employeeId)} />
          </Link>
        ),
      },
      {
        id: "card",
        header: "Card",
        size: 130,
        enableSorting: false,
        cell: ({ row }) => {
          const c = cards.get(row.original.cardId);
          return c ? (
            <Link to={`/cards/${c.id}`} className="font-mono text-[12.5px] text-ink-2 hover:underline">
              {masked(c.last4)}
            </Link>
          ) : null;
        },
      },
      { id: "status", header: "Status", size: 110, accessorFn: (r) => r.status, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { id: "amount", header: "Amount", size: 120, accessorFn: (r) => r.amount, cell: ({ row }) => <span className="tabular block text-right">{money(row.original.amount, row.original.currency)}</span> },
    ],
    [people, cards],
  );

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Budgets", to: "/budgets" }, { label: budget.name }]}
        title={budget.name}
        description={`${dep?.name ?? "Unknown"} department, ${budget.period}. ${format(startOfMonth(new Date()), "MMM d")} to ${format(endOfMonth(new Date()), "MMM d")}.`}
        meta={
          t === "danger" ? (
            <Badge tone="danger">Over budget by {money(budget.spent - budget.amount)}</Badge>
          ) : t === "warn" ? (
            <Badge tone="warn">Past the {budget.alertAt}% alert</Badge>
          ) : (
            <Badge tone="ok">On track</Badge>
          )
        }
        actions={
          <RoleGate action="accounting.manage">
            {(ok) => (
              <>
                <Button disabled={!ok} onClick={() => setArchiving(true)}>
                  <Archive /> Archive budget
                </Button>
                <Button variant="primary" disabled={!ok} onClick={() => (setEditKey((k) => k + 1), setEditing(true))}>
                  <Pencil /> Edit budget
                </Button>
              </>
            )}
          </RoleGate>
        }
      />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Budget" value={money(budget.amount, "USD", { compact: true })} hint={`per ${budget.period.replace("ly", "")}`} />
          <Stat label="Spent" value={money(budget.spent, "USD", { compact: true })} hint={`${pct(p)} used`} />
          <Stat label="Remaining" value={money(Math.max(0, budget.amount - budget.spent), "USD", { compact: true })} hint={budget.spent > budget.amount ? "Nothing left" : undefined} />
          <Stat label="Forecast, end of month" value={money(forecast, "USD", { compact: true })} delta={forecast > monthlyAmount ? { value: `${money(forecast - monthlyAmount, "USD", { compact: true })} over`, good: false } : { value: "Under budget", good: true }} />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card title="Spend vs budget" description="Running total this month against an even pace" className="lg:col-span-2">
            <Progress value={p} tone={t} className="mb-4" />
            <div className="h-64">
              <ResponsiveContainer>
                <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <defs>
                    <linearGradient id="budget-spent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#17633a" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#17633a" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--np-line)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--np-ink-3)" }} tickLine={false} axisLine={{ stroke: "var(--np-line)" }} interval={6} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--np-ink-3)" }} tickLine={false} axisLine={false} width={60} tickFormatter={(v) => money(Number(v), "USD", { compact: true })} />
                  <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                  <ReferenceLine y={monthlyAmount} stroke="#c42b2b" strokeDasharray="4 4" label={{ value: "Budget", position: "insideTopRight", fontSize: 11, fill: "#c42b2b" }} />
                  <Line dataKey="pace" name="Even pace" stroke="#7d8781" strokeDasharray="2 4" dot={false} strokeWidth={1.5} />
                  <Area dataKey="spent" name="Spent" stroke="#17633a" strokeWidth={2} fill="url(#budget-spent)" connectNulls={false} />
                  <Line dataKey="forecast" name="Forecast" stroke="#17633a" strokeDasharray="5 4" dot={false} strokeWidth={1.5} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Details">
            <DescriptionList
              columns={1}
              items={[
                {
                  label: "Owner",
                  value: owner ? (
                    <Link to={`/people/${owner.id}`} className="hover:underline">
                      <Person person={owner} sub={owner.title} />
                    </Link>
                  ) : (
                    "None"
                  ),
                },
                { label: "Department", value: <Link to="/people/departments" className="text-brand hover:underline">{dep?.name}</Link> },
                { label: "Alert thresholds", value: (extras?.thresholds ?? [budget.alertAt, 100]).map((x) => `${x}%`).join(", ") },
                { label: "Also notified", value: extras?.notify.length ? extras.notify.map((n) => people.get(n)?.firstName).join(", ") : "Only the owner" },
                { label: "Rollover", value: extras?.rollover ? `On${extras.rolloverCap !== "none" ? `, capped at ${extras.rolloverCap}%` : ""}` : "Off" },
              ]}
            />
          </Card>
        </div>

        <DataTable
          label={`${dep?.name} transactions this month`}
          data={tx}
          columns={columns}
          getRowId={(r) => r.id}
          height={440}
          initialSort={[{ id: "date", desc: true }]}
          toolbar={
            <span className="text-[13px] font-medium">
              {dep?.name} card spend this month <span className="font-normal text-ink-3">· {tx.length} transactions</span>
            </span>
          }
          empty={<EmptyState title="No spend yet this month" description="Card charges in this department will show up here." />}
        />
      </div>

      <EditSheet key={editKey} budget={budget} open={editing} onOpenChange={setEditing} />
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Archive "${budget.name}"?`}
        description="Spend stops counting against it and alerts stop. You can undo this right after."
        confirmLabel="Archive budget"
        danger
        onConfirm={async () => {
          const ok = await act(
            () => {
              remove("budgets", budget.id);
              return true;
            },
            { success: `Archived "${budget.name}"`, undo: () => upsert("budgets", budget) },
          );
          if (ok) navigate("/budgets");
        }}
      />
    </>
  );
}

function EditSheet({ budget, open, onOpenChange }: { budget: Budget; open: boolean; onOpenChange: (v: boolean) => void }) {
  const employees = useCollection("employees");
  const people = useMemo(() => employees.filter((e) => e.status === "active").map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName}`, hint: e.title })), [employees]);
  const extras = useBudgetUi((s) => s.extras[budget.id]);
  const setExtras = useBudgetUi((s) => s.setExtras);
  const [name, setName] = useState(budget.name);
  const [amount, setAmount] = useState(String(budget.amount));
  const [period, setPeriod] = useState(budget.period);
  const [ownerId, setOwnerId] = useState(budget.ownerId);
  const [alertAt, setAlertAt] = useState(budget.alertAt);
  const [notify, setNotify] = useState<string[]>(extras?.notify ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const n = Number(amount.replace(/[,$\s]/g, ""));
    if (!name.trim()) return setError("Name the budget.");
    if (!Number.isFinite(n) || n <= 0) return setError("Enter an amount above zero.");
    setBusy(true);
    const ok = await act(
      () => {
        patch("budgets", budget.id, { name: name.trim(), amount: n, period, ownerId, alertAt });
        setExtras(budget.id, { rollover: extras?.rollover ?? false, rolloverCap: extras?.rolloverCap ?? "none", thresholds: [alertAt, ...(extras?.thresholds ?? [100]).filter((x) => x > alertAt)], notify });
        return true;
      },
      { success: "Budget updated" },
    );
    setBusy(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit budget"
      description={budget.name}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save budget
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <p className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p> : null}
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Amount">{(id) => <Input id={id} inputMode="decimal" prefix="$" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Period">
          {(id) => (
            <Select
              id={id}
              aria-label="Period"
              value={period}
              onValueChange={setPeriod}
              options={[
                { value: "monthly", label: "Monthly" },
                { value: "quarterly", label: "Quarterly" },
                { value: "yearly", label: "Yearly" },
              ]}
            />
          )}
        </Field>
        <Field label="Owner">{(id) => <Combobox id={id} aria-label="Owner" value={ownerId} onChange={setOwnerId} options={people} searchPlaceholder="Search people…" />}</Field>
        <Field label={`Warn at ${alertAt}% used`} hint="The card turns amber and the owner is emailed.">
          {(id) => <input id={id} type="range" min={50} max={100} step={5} value={alertAt} onChange={(e) => setAlertAt(Number(e.target.value))} className="w-full accent-[var(--np-brand)]" />}
        </Field>
        <Field label="Also notify" optional>
          {(id) => <MultiSelect id={id} aria-label="Add people to notify" value={notify} onChange={setNotify} options={people} placeholder="Add people…" />}
        </Field>
      </div>
    </Sheet>
  );
}
