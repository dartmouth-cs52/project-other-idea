import { endOfMonth, format, startOfMonth, startOfYear, subDays, subMonths } from "date-fns";
import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ME_ID, useCollection, useIndex } from "@/data/store";
import type { Employee, Transaction } from "@/data/types";
import { money } from "@/lib/format";
import { Badge } from "@/ui/display";
import type { Option, Range } from "@/ui/inputs";

// Labels, filters and small stores shared by the expense list, the quick-edit
// panel and the detail page.

export const REVIEW_LABELS: Record<Transaction["reviewStatus"], string> = {
  needs_review: "Needs review",
  approved: "Approved",
  flagged: "Flagged",
  exported: "Exported",
};

export const RECEIPT_LABELS: Record<Transaction["receipt"], string> = {
  missing: "Missing",
  attached: "Attached",
  not_required: "Not required",
  lost_affidavit: "Affidavit filed",
};

export const STATUS_LABELS: Record<Transaction["status"], string> = {
  pending: "Pending",
  cleared: "Cleared",
  declined: "Declined",
  refunded: "Refunded",
};

export const TAG_OPTIONS = ["Q4 offsite", "Project Atlas", "Billable", "Conference", "Client visit", "Hiring", "Personal"];

export function ReviewBadge({ status }: { status: Transaction["reviewStatus"] }) {
  const tone = status === "approved" ? "ok" : status === "flagged" ? "danger" : status === "exported" ? "info" : "warn";
  return (
    <Badge tone={tone} dot>
      {REVIEW_LABELS[status]}
    </Badge>
  );
}

export function ReceiptBadge({ receipt }: { receipt: Transaction["receipt"] }) {
  const tone = receipt === "attached" ? "ok" : receipt === "missing" ? "danger" : receipt === "lost_affidavit" ? "info" : "neutral";
  return <Badge tone={tone}>{RECEIPT_LABELS[receipt]}</Badge>;
}

export function useCategoryOptions(): Option[] {
  const cats = useCollection("categories");
  const gl = useIndex("glAccounts");
  return useMemo(() => cats.filter((c) => c.enabled).map((c) => ({ value: c.id, label: c.name, hint: gl.get(c.glAccountId)?.code })), [cats, gl]);
}

export function useDepartmentOptions(): Option[] {
  const deps = useCollection("departments");
  return useMemo(() => deps.map((d) => ({ value: d.id, label: d.name, hint: d.glCode })), [deps]);
}

export function usePeopleOptions(filter?: (e: Employee) => boolean): Option[] {
  const people = useCollection("employees");
  return useMemo(
    () =>
      people
        .filter((e) => e.status === "active" && (!filter || filter(e)))
        .map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName}`, hint: e.title })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [people],
  );
}

/** Everything the expense list can be filtered by. All of it lives in the URL, so links land filtered. */
export interface ExpenseFilters {
  q: string;
  from: string | null;
  to: string | null;
  status: string[];
  review: string[];
  receipt: string[];
  category: string[];
  dept: string[];
  holder: string | null;
  min: number | null;
  max: number | null;
  violations: boolean;
}

const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);
const num = (v: string | null) => (v && !Number.isNaN(Number(v)) ? Number(v) : null);

export function readFilters(p: URLSearchParams): ExpenseFilters {
  return {
    q: p.get("q") ?? "",
    from: p.get("from"),
    to: p.get("to"),
    status: list(p.get("status")),
    review: list(p.get("review")),
    receipt: list(p.get("receipt")),
    category: list(p.get("category")),
    dept: list(p.get("dept")),
    holder: p.get("holder"),
    min: num(p.get("min")),
    max: num(p.get("max")),
    violations: p.get("violations") === "1",
  };
}

export function countFilters(f: ExpenseFilters) {
  return [f.status.length, f.review.length, f.receipt.length, f.category.length, f.dept.length, f.holder, f.min !== null || f.max !== null, f.violations].filter(Boolean).length;
}

export function applyFilters(rows: Transaction[], f: ExpenseFilters, people: Map<string, Employee>): Transaction[] {
  const q = f.q.trim().toLowerCase();
  const from = f.from ? `${f.from}T00:00:00` : null;
  const to = f.to ? `${f.to}T23:59:59` : null;
  const status = new Set(f.status);
  const review = new Set(f.review);
  const receipt = new Set(f.receipt);
  const category = new Set(f.category);
  const dept = new Set(f.dept);
  return rows.filter((t) => {
    if (status.size && !status.has(t.status)) return false;
    if (review.size && !review.has(t.reviewStatus)) return false;
    if (receipt.size && !receipt.has(t.receipt)) return false;
    if (category.size && !category.has(t.categoryId ?? "none")) return false;
    if (dept.size && !dept.has(t.departmentId)) return false;
    if (f.holder && t.employeeId !== f.holder) return false;
    if (f.min !== null && t.amount < f.min) return false;
    if (f.max !== null && t.amount > f.max) return false;
    if (f.violations && t.violations.length === 0) return false;
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    if (q) {
      const p = people.get(t.employeeId);
      const hay = `${t.merchant} ${t.memo} ${t.id} ${t.amount.toFixed(2)} ${p ? `${p.firstName} ${p.lastName}` : ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const day = (d: Date) => format(d, "yyyy-MM-dd");

export function datePresets(): { label: string; range: Range }[] {
  const today = new Date();
  const lastMonth = subMonths(today, 1);
  return [
    { label: "Last 7 days", range: { from: day(subDays(today, 6)), to: day(today) } },
    { label: "Last 30 days", range: { from: day(subDays(today, 29)), to: day(today) } },
    { label: "This month", range: { from: day(startOfMonth(today)), to: day(today) } },
    { label: "Last month", range: { from: day(startOfMonth(lastMonth)), to: day(endOfMonth(lastMonth)) } },
    { label: "Last 90 days", range: { from: day(subDays(today, 89)), to: day(today) } },
    { label: "Year to date", range: { from: day(startOfYear(today)), to: day(today) } },
  ];
}

/** Writes rows to a CSV file and starts the download. */
export function downloadCsv(rows: Transaction[], name: string, lookups: { people: Map<string, Employee>; categories: Map<string, { name: string }> }) {
  const head = ["Date", "Merchant", "Amount", "Currency", "Card holder", "Category", "Memo", "Receipt", "Review status", "Transaction ID"];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = rows.map((t) => {
    const p = lookups.people.get(t.employeeId);
    return [t.date.slice(0, 10), t.merchant, t.amount.toFixed(2), t.currency, p ? `${p.firstName} ${p.lastName}` : "", (t.categoryId && lookups.categories.get(t.categoryId)?.name) || "", t.memo, RECEIPT_LABELS[t.receipt], REVIEW_LABELS[t.reviewStatus], t.id].map(esc).join(",");
  });
  const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fmtAmount = (t: Pick<Transaction, "amount" | "currency" | "status">) => (t.status === "refunded" ? `−${money(t.amount, t.currency)}` : money(t.amount, t.currency));

// Activity on each charge that the seed doesn't record: edits, uploads, reviews.
interface ActivityEvent {
  at: string;
  who: string;
  text: string;
}
interface ActivityStore {
  events: Record<string, ActivityEvent[]>;
  log: (txId: string, text: string) => void;
}
export const useActivity = create<ActivityStore>()(
  persist(
    (set) => ({
      events: {},
      log: (txId, text) => set((s) => ({ events: { ...s.events, [txId]: [{ at: new Date().toISOString(), who: ME_ID, text }, ...(s.events[txId] ?? [])].slice(0, 30) } })),
    }),
    { name: "northpine-expense-activity" },
  ),
);

/** Receipt files picked this visit, kept in memory so the preview can show them. */
export const receiptFiles = new Map<string, { url: string; type: string }>();

