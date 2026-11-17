import { Command } from "cmdk";
import { AlertTriangle, ArrowUpRight, Check, ChevronDown, Download, FileSpreadsheet, Flag, ListFilter, Paperclip, Search, Send, Tags, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useEntityFilter, useSession } from "@/app/session";
import { ME_ID, all, upsert, useCollection, useIndex } from "@/data/store";
import type { Employee, Transaction } from "@/data/types";
import { useLab, lab } from "@/lab/lab";
import { cn } from "@/lib/cn";
import { masked, money, shortDate } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { DataTable, type ColumnDef } from "@/ui/data-table";
import { Avatar, Badge, EmptyState, LinkTabs, PageHeader } from "@/ui/display";
import { act, Loader, RoleGate, toast } from "@/ui/flow";
import { Checkbox, Input, Switch } from "@/ui/form";
import { Combobox, DateRangePicker, MultiSelect } from "@/ui/inputs";
import { Menu, Popover } from "@/ui/overlay";
import { ExpenseSheet } from "./ExpenseSheet";
import { AttachReceiptModal } from "./receipts";
import {
  applyFilters,
  countFilters,
  datePresets,
  downloadCsv,
  fmtAmount,
  readFilters,
  RECEIPT_LABELS,
  ReceiptBadge,
  REVIEW_LABELS,
  ReviewBadge,
  STATUS_LABELS,
  useActivity,
  useCategoryOptions,
  useDepartmentOptions,
  usePeopleOptions,
  type ExpenseFilters,
} from "./shared";

// The full list of card charges: 10,000 rows in a virtualized table, so most
// rows aren't in the DOM until scrolled to. Every filter is in the URL.

const VIEWS = [
  { label: "All", query: "" },
  { label: "Needs review", query: "review=needs_review" },
  { label: "Missing receipts", query: "receipt=missing" },
  { label: "Flagged", query: "review=flagged" },
  { label: "Exported", query: "review=exported" },
];

/** Which rows this person may see: everyone's for reviewers, only their own for employees. */
function useVisibleRows() {
  const role = useLab((s) => s.role);
  const filter = useEntityFilter();
  const txs = useCollection("transactions");
  return useMemo(() => {
    const rows = filter(txs);
    return role === "employee" ? rows.filter((t) => t.employeeId === ME_ID) : rows;
  }, [txs, filter, role]);
}

/** The same rows, read outside React, for the export menu. */
function currentRows(): Transaction[] {
  const entity = useSession.getState().entity;
  let rows = all("transactions");
  if (entity !== "all") rows = rows.filter((t) => t.entityId === entity);
  if (lab().role === "employee") rows = rows.filter((t) => t.employeeId === ME_ID);
  const people = new Map(all("employees").map((e) => [e.id, e]));
  return applyFilters(rows, readFilters(new URLSearchParams(location.search)), people);
}

function lookups() {
  return { people: new Map(all("employees").map((e) => [e.id, e])), categories: new Map(all("categories").map((c) => [c.id, c])) };
}

export function ExpensesPage() {
  const role = useLab((s) => s.role);
  const [params] = useSearchParams();
  const rows = useVisibleRows();
  const counts = useMemo(() => {
    let review = 0;
    let missing = 0;
    let flagged = 0;
    for (const t of rows) {
      if (t.reviewStatus === "needs_review") review++;
      else if (t.reviewStatus === "flagged") flagged++;
      if (t.receipt === "missing") missing++;
    }
    return { review, missing, flagged };
  }, [rows]);
  const viewKey = new URLSearchParams([...params].filter(([k]) => k === "review" || k === "receipt")).toString();
  const tabs = VIEWS.map((v) => ({
    to: v.query ? `/expenses?${v.query}` : "/expenses",
    label: v.label,
    count: v.label === "Needs review" ? counts.review : v.label === "Missing receipts" ? counts.missing : v.label === "Flagged" ? counts.flagged : undefined,
  }));
  const active = tabs.find((t, i) => VIEWS[i].query === viewKey)?.to ?? "";

  return (
    <>
      <PageHeader
        title={role === "employee" ? "My expenses" : "Expenses"}
        description={role === "employee" ? "Charges on your Northpine cards. Add receipts and memos so finance can close the month." : "Every card charge across Northpine. Review, code and export them."}
        actions={<ExportMenu />}
        tabs={<LinkTabs tabs={tabs} active={active} />}
      />
      <Loader loadKey={["expenses", viewKey]} rows={12}>
        {() => <ExpensesBody rows={rows} />}
      </Loader>
    </>
  );
}

function ExportMenu() {
  const integrations = useCollection("integrations");
  const erps = integrations.filter((i) => i.kind === "erp");
  const excel = () => {
    const rows = currentRows();
    const id = toast.loading(`Building Excel file for ${rows.length.toLocaleString()} expenses… 0%`);
    let p = 0;
    const timer = setInterval(() => {
      p = Math.min(100, p + 20 + Math.round(Math.random() * 15));
      if (p < 100) {
        toast.loading(`Building Excel file for ${rows.length.toLocaleString()} expenses… ${p}%`, { id });
        return;
      }
      clearInterval(timer);
      toast.success("Excel file ready", { id, action: { label: "Download", onClick: () => downloadCsv(rows, "northpine-expenses.xls", lookups()) } });
    }, 450);
  };
  const send = async (name: string) => {
    const ready = currentRows().filter((t) => t.reviewStatus === "approved");
    if (!ready.length) {
      toast.info("Nothing to send. Only approved expenses go to accounting.");
      return;
    }
    await act(() => upsert("transactions", ...ready.map((t) => ({ ...t, reviewStatus: "exported" as const }))), {
      success: `Sent ${ready.length.toLocaleString()} approved expenses to ${name}`,
    });
  };
  return (
    <RoleGate action="expenses.export">
      {(allowed) =>
        allowed ? (
          <Menu
            trigger={
              <Button>
                <Download /> Export <ChevronDown className="text-ink-3" />
              </Button>
            }
            items={[
              { label: "", heading: "Expenses in this view" },
              {
                label: "Download CSV",
                icon: <Download />,
                onSelect: () => {
                  const rows = currentRows();
                  downloadCsv(rows, "northpine-expenses.csv", lookups());
                  toast.success(`Downloaded ${rows.length.toLocaleString()} expenses as CSV`);
                },
              },
              { label: "Download Excel", icon: <FileSpreadsheet />, onSelect: excel },
              { label: "", separator: true },
              {
                label: "Send to accounting",
                icon: <Send />,
                items: erps.map((e) => ({ label: e.connected ? e.name : `${e.name} (not connected)`, disabled: !e.connected, onSelect: () => send(e.name) })),
              },
            ]}
          />
        ) : (
          <Button disabled>
            <Download /> Export <ChevronDown />
          </Button>
        )
      }
    </RoleGate>
  );
}

function useFilterParams(): [ExpenseFilters, (patch: Record<string, string | null>) => void] {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === "") next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  return [filters, update];
}

function ExpensesBody({ rows }: { rows: Transaction[] }) {
  const navigate = useNavigate();
  const people = useIndex("employees");
  const cats = useIndex("categories");
  const cards = useIndex("cards");
  const deps = useIndex("departments");
  const entities = useIndex("entities");
  const gl = useIndex("glAccounts");
  const [filters, update] = useFilterParams();
  const filtered = useMemo(() => applyFilters(rows, filters, people), [rows, filters, people]);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [attach, setAttach] = useState<Transaction | null>(null);
  useEffect(() => setSelection({}), [filters]);

  const columns = useMemo<ColumnDef<Transaction, unknown>[]>(
    () => [
      { id: "date", accessorKey: "date", header: "Date", size: 96, cell: ({ row }) => <span className="tabular text-ink-2">{shortDate(row.original.date)}</span> },
      {
        id: "merchant",
        accessorKey: "merchant",
        header: "Merchant",
        cell: ({ row }) => {
          const t = row.original;
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium text-ink">{t.merchant}</span>
              {t.splitFrom ? <Badge>Split</Badge> : null}
              {t.violations.length ? <AlertTriangle aria-label={`${t.violations.length} policy issues`} className="size-3.5 shrink-0 text-warn" /> : null}
            </span>
          );
        },
      },
      {
        id: "amount",
        accessorKey: "amount",
        header: "Amount",
        size: 120,
        cell: ({ row }) => <span className={cn("tabular", row.original.status === "declined" && "text-ink-3 line-through")}>{fmtAmount(row.original)}</span>,
      },
      {
        id: "holder",
        header: "Card holder",
        accessorFn: (t) => {
          const p = people.get(t.employeeId);
          return p ? `${p.firstName} ${p.lastName}` : "";
        },
        cell: ({ row }) => {
          const p = people.get(row.original.employeeId);
          return (
            <span className="flex min-w-0 items-center gap-2">
              <Avatar person={p} size={20} />
              <span className="truncate">{p ? `${p.firstName} ${p.lastName}` : "Unknown"}</span>
            </span>
          );
        },
      },
      {
        id: "category",
        header: "Category",
        accessorFn: (t) => (t.categoryId && cats.get(t.categoryId)?.name) || "",
        cell: ({ getValue }) => (getValue() ? <span className="truncate">{getValue() as string}</span> : <span className="text-warn">Uncategorized</span>),
      },
      { id: "receipt", accessorKey: "receipt", header: "Receipt", size: 130, cell: ({ row }) => <ReceiptBadge receipt={row.original.receipt} /> },
      { id: "review", accessorKey: "reviewStatus", header: "Review", size: 130, cell: ({ row }) => <ReviewBadge status={row.original.reviewStatus} /> },
      {
        id: "card",
        header: "Card",
        accessorFn: (t) => cards.get(t.cardId)?.last4 ?? "",
        cell: ({ row }) => {
          const c = cards.get(row.original.cardId);
          return c ? (
            <span className="truncate">
              <span className="tabular">{masked(c.last4)}</span> <span className="text-ink-3">{c.nickname}</span>
            </span>
          ) : null;
        },
      },
      { id: "department", header: "Department", accessorFn: (t) => deps.get(t.departmentId)?.name ?? "" },
      { id: "entity", header: "Entity", accessorFn: (t) => entities.get(t.entityId)?.name ?? "" },
      { id: "status", accessorKey: "status", header: "Status", size: 110, cell: ({ row }) => STATUS_LABELS[row.original.status] },
      { id: "memo", accessorKey: "memo", header: "Memo", cell: ({ row }) => row.original.memo || <span className="text-ink-3">None</span> },
      { id: "tags", header: "Tags", accessorFn: (t) => t.tags.join(", "), cell: ({ row }) => <span className="flex gap-1">{row.original.tags.map((g) => <Badge key={g}>{g}</Badge>)}</span> },
      { id: "violations", header: "Policy issues", accessorFn: (t) => t.violations.length, cell: ({ row }) => row.original.violations.join(", ") || <span className="text-ink-3">None</span> },
      { id: "mcc", accessorKey: "merchantCategory", header: "Merchant category" },
      {
        id: "gl",
        header: "GL account",
        accessorFn: (t) => {
          const c = t.categoryId ? cats.get(t.categoryId) : undefined;
          const a = c ? gl.get(c.glAccountId) : undefined;
          return a ? `${a.code} ${a.name}` : "";
        },
      },
      { id: "currency", accessorKey: "currency", header: "Currency", size: 90 },
      { id: "id", accessorKey: "id", header: "Transaction ID", cell: ({ row }) => <span className="font-mono text-xs text-ink-3">{row.original.id}</span> },
    ],
    [people, cats, cards, deps, entities, gl],
  );

  const totals = useMemo(() => {
    let sum = 0;
    let missing = 0;
    let issues = 0;
    for (const t of filtered) {
      if (t.status !== "declined") sum += t.status === "refunded" ? -t.amount : t.amount;
      if (t.receipt === "missing") missing++;
      if (t.violations.length) issues++;
    }
    return { sum, missing, issues };
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Spend in view" value={money(totals.sum, "USD", { compact: true })} />
        <MiniStat label="Expenses" value={filtered.length.toLocaleString()} />
        <MiniStat label="Missing receipts" value={totals.missing.toLocaleString()} tone={totals.missing ? "warn" : undefined} />
        <MiniStat label="With policy issues" value={totals.issues.toLocaleString()} tone={totals.issues ? "warn" : undefined} />
      </div>

      <DataTable
        label="Expenses"
        data={filtered}
        columns={columns}
        getRowId={(t) => t.id}
        virtual
        height="max(420px, calc(100vh - 380px))"
        selectable
        selection={selection}
        onSelectionChange={setSelection}
        columnPicker
        initialHidden={["card", "department", "entity", "status", "memo", "tags", "violations", "mcc", "gl", "currency", "id"]}
        initialSort={[{ id: "date", desc: true }]}
        onRowClick={(t) => setOpenId(t.id)}
        rowActions={(t) => (
          <>
            {t.receipt !== "attached" && t.receipt !== "lost_affidavit" ? (
              // Icon-only with no accessible name, on purpose. Only the tooltip says "Attach receipt".
              <IconButton named={false} label="Attach receipt" size="icon-sm" icon={<Paperclip />} onClick={() => setAttach(t)} />
            ) : null}
            <RoleGate action="expenses.review">
              {(allowed) => (
                <IconButton
                  label={t.reviewStatus === "flagged" ? "Unflag" : "Flag"}
                  size="icon-sm"
                  disabled={!allowed}
                  icon={<Flag className={t.reviewStatus === "flagged" ? "fill-current text-danger" : undefined} />}
                  onClick={() =>
                    act(() => upsert("transactions", { ...t, reviewStatus: t.reviewStatus === "flagged" ? "needs_review" : "flagged" }), {
                      success: t.reviewStatus === "flagged" ? "Flag removed" : `Flagged ${t.merchant}`,
                      undo: () => upsert("transactions", t),
                    })
                  }
                />
              )}
            </RoleGate>
            <IconButton label="Open expense" size="icon-sm" icon={<ArrowUpRight />} onClick={() => navigate(`/expenses/${t.id}`)} />
          </>
        )}
        bulkActions={(ids, clear) => <BulkActions ids={ids} clear={clear} />}
        toolbar={<Toolbar filters={filters} update={update} people={people} />}
        empty={
          <EmptyState
            title="No expenses match"
            description="Try a wider date range or remove a filter."
            action={
              <Button size="sm" asChild>
                <Link to="/expenses">Clear filters</Link>
              </Button>
            }
          />
        }
      />

      <ExpenseSheet txId={openId} onClose={() => setOpenId(null)} />
      <AttachReceiptModal tx={attach} onOpenChange={(v) => !v && setAttach(null)} />
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" }) {
  return (
    // The number goes under its label when the two don't fit side by side, as on the narrowest phones.
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-line bg-panel px-4 py-3 shadow-xs">
      <span className="min-w-0 text-[12.5px] text-ink-3">{label}</span>
      <span className={cn("tabular text-[17px] font-semibold", tone === "warn" && "text-warn")}>{value}</span>
    </div>
  );
}

function Toolbar({ filters, update, people }: { filters: ExpenseFilters; update: (p: Record<string, string | null>) => void; people: Map<string, Employee> }) {
  const [q, setQ] = useState(filters.q);
  useEffect(() => {
    if (q === filters.q) return;
    const t = setTimeout(() => update({ q }), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const cats = useIndex("categories");
  const deps = useIndex("departments");
  const chips: { key: string; label: string; clear: Record<string, null> }[] = [];
  const names = (ids: string[], map: Record<string, string> | Map<string, { name: string }>) =>
    ids.map((id) => (map instanceof Map ? (map.get(id)?.name ?? (id === "none" ? "Uncategorized" : id)) : (map[id] ?? id))).join(", ");
  if (filters.status.length) chips.push({ key: "status", label: `Status: ${names(filters.status, STATUS_LABELS)}`, clear: { status: null } });
  if (filters.review.length) chips.push({ key: "review", label: `Review: ${names(filters.review, REVIEW_LABELS)}`, clear: { review: null } });
  if (filters.receipt.length) chips.push({ key: "receipt", label: `Receipt: ${names(filters.receipt, RECEIPT_LABELS)}`, clear: { receipt: null } });
  if (filters.category.length) chips.push({ key: "category", label: `Category: ${names(filters.category, cats)}`, clear: { category: null } });
  if (filters.dept.length) chips.push({ key: "dept", label: `Department: ${names(filters.dept, deps)}`, clear: { dept: null } });
  if (filters.holder) {
    const p = people.get(filters.holder);
    chips.push({ key: "holder", label: `Card holder: ${p ? `${p.firstName} ${p.lastName}` : "Unknown"}`, clear: { holder: null } });
  }
  if (filters.min !== null || filters.max !== null)
    chips.push({
      key: "amount",
      label: `Amount: ${filters.min !== null ? money(filters.min) : "any"} to ${filters.max !== null ? money(filters.max) : "any"}`,
      clear: { min: null, max: null },
    });
  if (filters.violations) chips.push({ key: "violations", label: "Has policy issues", clear: { violations: null } });

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input aria-label="Search expenses" placeholder="Search merchant, memo, person…" value={q} onChange={(e) => setQ(e.target.value)} className="h-7 pl-8" />
        </div>
        <DateRangePicker value={{ from: filters.from, to: filters.to }} onChange={(r) => update({ from: r.from, to: r.to })} presets={datePresets()} />
        <FiltersPopover filters={filters} update={update} />
      </div>
      {chips.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-sunken py-0.5 pr-1 pl-2.5 text-[12px]">
              {c.label}
              <button type="button" aria-label={`Remove ${c.label.split(":")[0]} filter`} onClick={() => update(c.clear)} className="grid size-4 cursor-pointer place-items-center rounded-full text-ink-3 hover:bg-line hover:text-ink">
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Button
            variant="link"
            size="sm"
            className="ml-1 text-[12px]"
            onClick={() => update({ status: null, review: null, receipt: null, category: null, dept: null, holder: null, min: null, max: null, violations: null })}
          >
            Clear all
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CheckGroup({ title, options, value, onChange }: { title: string; options: Record<string, string>; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{title}</legend>
      {Object.entries(options).map(([k, label]) => (
        <Checkbox key={k} checked={value.includes(k)} onCheckedChange={(on) => onChange(on ? [...value, k] : value.filter((x) => x !== k))} label={label} />
      ))}
    </fieldset>
  );
}

function FiltersPopover({ filters, update }: { filters: ExpenseFilters; update: (p: Record<string, string | null>) => void }) {
  const categories = useCategoryOptions();
  const departments = useDepartmentOptions();
  const people = usePeopleOptions();
  const count = countFilters(filters);
  const join = (v: string[]) => (v.length ? v.join(",") : null);
  return (
    <Popover
      className="w-[min(560px,calc(100vw-2rem))] p-0"
      trigger={
        <Button size="sm">
          <ListFilter /> Filters
          {count ? <span className="rounded-full bg-brand px-1.5 text-[11px] text-brand-ink">{count}</span> : null}
        </Button>
      }
    >
      <div className="grid grid-cols-3 gap-5 border-b border-line p-4">
        <CheckGroup title="Status" options={STATUS_LABELS} value={filters.status} onChange={(v) => update({ status: join(v) })} />
        <CheckGroup title="Review" options={REVIEW_LABELS} value={filters.review} onChange={(v) => update({ review: join(v) })} />
        <CheckGroup title="Receipt" options={RECEIPT_LABELS} value={filters.receipt} onChange={(v) => update({ receipt: join(v) })} />
      </div>
      <div className="grid grid-cols-2 gap-4 border-b border-line p-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Category</span>
          <MultiSelect aria-label="Add category filter" value={filters.category} onChange={(v) => update({ category: join(v) })} options={[{ value: "none", label: "Uncategorized" }, ...categories]} placeholder="Add category" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Department</span>
          <MultiSelect aria-label="Add department filter" value={filters.dept} onChange={(v) => update({ dept: join(v) })} options={departments} placeholder="Add department" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Card holder</span>
          <Combobox aria-label="Card holder" value={filters.holder} onChange={(v) => update({ holder: v })} options={people} placeholder="Anyone" searchPlaceholder="Search people…" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Amount</span>
          <div className="flex items-center gap-2">
            <Input key={`min-${filters.min}`} aria-label="Minimum amount" type="number" inputMode="decimal" prefix="$" placeholder="Min" defaultValue={filters.min ?? ""} onBlur={(e) => update({ min: e.target.value || null })} />
            <span className="text-ink-3">to</span>
            <Input key={`max-${filters.max}`} aria-label="Maximum amount" type="number" inputMode="decimal" prefix="$" placeholder="Max" defaultValue={filters.max ?? ""} onBlur={(e) => update({ max: e.target.value || null })} />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 p-4">
        <Switch checked={filters.violations} onCheckedChange={(v) => update({ violations: v ? "1" : null })} label="Has policy issues" />
        <Button size="sm" variant="ghost" onClick={() => update({ status: null, review: null, receipt: null, category: null, dept: null, holder: null, min: null, max: null, violations: null })}>
          Reset filters
        </Button>
      </div>
    </Popover>
  );
}

function BulkActions({ ids, clear }: { ids: string[]; clear: () => void }) {
  const categories = useCategoryOptions();
  const [catOpen, setCatOpen] = useState(false);
  const log = useActivity((s) => s.log);
  const rowsFor = () => {
    const set = new Set(ids);
    return all("transactions").filter((t) => set.has(t.id));
  };
  const bulk = async (change: (t: Transaction) => Transaction, success: string, note: string) => {
    const before = rowsFor();
    await act(() => upsert("transactions", ...before.map(change)), { success, undo: () => upsert("transactions", ...before) });
    before.slice(0, 200).forEach((t) => log(t.id, note));
    clear();
  };
  const n = ids.length.toLocaleString();
  return (
    <>
      <RoleGate action="expenses.review">
        {(allowed) => (
          <Button size="sm" disabled={!allowed} onClick={() => bulk((t) => ({ ...t, reviewStatus: "approved" }), `Approved ${n} expenses`, "approved this expense")}>
            <Check /> Approve
          </Button>
        )}
      </RoleGate>
      <RoleGate action="expenses.review">
        {(allowed) => (
          <Button size="sm" disabled={!allowed} onClick={() => bulk((t) => ({ ...t, reviewStatus: "flagged" }), `Flagged ${n} expenses`, "flagged this expense")}>
            <Flag /> Flag
          </Button>
        )}
      </RoleGate>
      <Popover
        open={catOpen}
        onOpenChange={setCatOpen}
        className="w-64 max-w-[calc(100vw-1rem)] p-0"
        trigger={
          <Button size="sm">
            <Tags /> Categorize
          </Button>
        }
      >
        <Command loop>
          <Command.Input aria-label="Search categories" placeholder="Set category…" className="h-9 w-full border-b border-line bg-transparent px-3 text-[13px] outline-none placeholder:text-ink-3" />
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink-3">No matches.</Command.Empty>
            {categories.map((c) => (
              <Command.Item
                key={c.value}
                value={c.label}
                onSelect={() => {
                  setCatOpen(false);
                  bulk((t) => ({ ...t, categoryId: c.value }), `Moved ${n} expenses to ${c.label}`, `set the category to ${c.label}`);
                }}
                className="flex cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-[13px] data-[selected=true]:bg-sunken"
              >
                {c.label}
                <span className="text-xs text-ink-3">{c.hint}</span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </Popover>
      <RoleGate action="expenses.export">
        {(allowed) => (
          <Button
            size="sm"
            disabled={!allowed}
            onClick={() => {
              downloadCsv(rowsFor(), "northpine-selected-expenses.csv", lookups());
              toast.success(`Downloaded ${n} expenses as CSV`);
            }}
          >
            <Download /> Export selected
          </Button>
        )}
      </RoleGate>
    </>
  );
}
