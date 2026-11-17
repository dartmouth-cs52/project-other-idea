import { endOfQuarter, format, parseISO, startOfMonth, startOfQuarter, startOfYear, subDays, subMonths, subQuarters } from "date-fns";
import type { Card, Category, Department, Employee, Entity, SavedReport, Transaction } from "@/data/types";
import { titleCase } from "@/lib/format";

// The report engine. A report is a grouping, a metric, some filters and a date
// range, run over the transactions in memory. Saved reports store the same
// thing as strings so they fit the SavedReport record.

export type FieldKey =
  | "department"
  | "merchant"
  | "category"
  | "employee"
  | "card"
  | "entity"
  | "month"
  | "week"
  | "quarter"
  | "status"
  | "receipt"
  | "merchantCategory"
  | "tag"
  | "review"
  | "violation";

export type Metric = "sum" | "count" | "average";
export type ChartKind = SavedReport["chart"];

export interface Ctx {
  departments: Map<string, Department>;
  employees: Map<string, Employee>;
  categories: Map<string, Category>;
  entities: Map<string, Entity>;
  cards: Map<string, Card>;
}

export interface FieldDef {
  key: FieldKey;
  label: string;
  group: "Spend" | "People and cards" | "Time" | "Custom fields";
  /** Custom fields need the advanced reports plan. */
  advanced?: boolean;
  time?: boolean;
  /** Group keys for one transaction. Tags can give several. */
  keys: (t: Transaction, ctx: Ctx) => string[];
  label_: (key: string, ctx: Ctx) => string;
}

const same = (k: string) => k;

export const FIELDS: FieldDef[] = [
  { key: "merchant", label: "Merchant", group: "Spend", keys: (t) => [t.merchant], label_: same },
  { key: "category", label: "Category", group: "Spend", keys: (t) => [t.categoryId ?? "none"], label_: (k, c) => c.categories.get(k)?.name ?? "Uncategorized" },
  { key: "merchantCategory", label: "Merchant type", group: "Spend", keys: (t) => [t.merchantCategory], label_: same },
  { key: "status", label: "Status", group: "Spend", keys: (t) => [t.status], label_: titleCase },
  { key: "receipt", label: "Receipt", group: "Spend", keys: (t) => [t.receipt], label_: (k) => titleCase(k === "lost_affidavit" ? "lost receipt affidavit" : k) },
  { key: "department", label: "Department", group: "People and cards", keys: (t) => [t.departmentId], label_: (k, c) => c.departments.get(k)?.name ?? "Unknown" },
  { key: "employee", label: "Person", group: "People and cards", keys: (t) => [t.employeeId], label_: (k, c) => { const e = c.employees.get(k); return e ? `${e.firstName} ${e.lastName}` : "Unknown"; } },
  { key: "card", label: "Card", group: "People and cards", keys: (t) => [t.cardId], label_: (k, c) => { const card = c.cards.get(k); return card ? `${card.nickname} ••${card.last4}` : "Unknown card"; } },
  { key: "entity", label: "Entity", group: "People and cards", keys: (t) => [t.entityId], label_: (k, c) => c.entities.get(k)?.name ?? k },
  { key: "month", label: "Month", group: "Time", time: true, keys: (t) => [t.date.slice(0, 7)], label_: (k) => format(parseISO(`${k}-01`), "MMM yyyy") },
  { key: "quarter", label: "Quarter", group: "Time", time: true, keys: (t) => [format(parseISO(t.date), "yyyy-'Q'Q")], label_: (k) => k.replace("-", " ") },
  { key: "week", label: "Week", group: "Time", time: true, keys: (t) => [format(parseISO(t.date), "RRRR-'W'II")], label_: (k) => k.replace("-W", " week ") },
  { key: "tag", label: "Tag", group: "Custom fields", advanced: true, keys: (t) => (t.tags.length ? t.tags : ["untagged"]), label_: (k) => (k === "untagged" ? "No tag" : k) },
  { key: "review", label: "Review status", group: "Custom fields", advanced: true, keys: (t) => [t.reviewStatus], label_: titleCase },
  { key: "violation", label: "Policy violation", group: "Custom fields", advanced: true, keys: (t) => (t.violations.length ? t.violations : ["none"]), label_: (k) => (k === "none" ? "No violation" : k) },
];

export const fieldOf = (key: string) => FIELDS.find((f) => f.key === key);

export const METRICS: { value: Metric; label: string }[] = [
  { value: "sum", label: "Total spend" },
  { value: "count", label: "Number of transactions" },
  { value: "average", label: "Average transaction" },
];

export const DATE_PRESETS: { value: string; label: string }[] = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "quarter", label: "This quarter" },
  { value: "last_quarter", label: "Last quarter" },
  { value: "ytd", label: "Year to date" },
  { value: "12m", label: "Last 12 months" },
];

/** A date setting as from and to days. Custom ranges are "yyyy-mm-dd..yyyy-mm-dd". */
export function rangeOf(date: string): { from: string; to: string } {
  const today = new Date();
  const d = (x: Date) => format(x, "yyyy-MM-dd");
  switch (date) {
    case "30d":
      return { from: d(subDays(today, 30)), to: d(today) };
    case "90d":
      return { from: d(subDays(today, 90)), to: d(today) };
    case "quarter":
      return { from: d(startOfQuarter(today)), to: d(today) };
    case "last_quarter": {
      const q = subQuarters(today, 1);
      return { from: d(startOfQuarter(q)), to: d(endOfQuarter(q)) };
    }
    case "ytd":
      return { from: d(startOfYear(today)), to: d(today) };
    case "12m":
      // Twelve whole calendar months, this one included, so a pivot by month has twelve columns.
      return { from: d(subMonths(startOfMonth(today), 11)), to: d(today) };
    default: {
      const [from, to] = date.split("..");
      return { from: from || d(subDays(today, 365)), to: to || d(today) };
    }
  }
}

export function dateLabel(date: string) {
  const preset = DATE_PRESETS.find((p) => p.value === date);
  if (preset) return preset.label;
  const { from, to } = rangeOf(date);
  return `${format(parseISO(from), "MMM d")} to ${format(parseISO(to), "MMM d, yyyy")}`;
}

export interface Filter {
  field: FieldKey;
  values: string[];
}

export interface Spec {
  name: string;
  groupBy: FieldKey[];
  filters: Filter[];
  metric: Metric;
  chart: ChartKind;
  date: string;
}

export const BLANK: Spec = { name: "Untitled report", groupBy: ["department"], filters: [], metric: "sum", chart: "bar", date: "90d" };

export function specFromSaved(r: SavedReport): Spec {
  const filters: Filter[] = [];
  let date = "12m";
  for (const f of r.filters) {
    const [field, ...rest] = f.split(":");
    const value = rest.join(":");
    if (field === "date") {
      date = value === "quarter" ? "quarter" : value;
      continue;
    }
    if (!fieldOf(field)) continue;
    const existing = filters.find((x) => x.field === field);
    if (existing) existing.values.push(value);
    else filters.push({ field: field as FieldKey, values: [value] });
  }
  const groupBy = r.groupBy.split(",").filter((g) => fieldOf(g)) as FieldKey[];
  return { name: r.name, groupBy: groupBy.length ? groupBy : ["department"], filters, metric: (["sum", "count", "average"].includes(r.metric) ? r.metric : "sum") as Metric, chart: r.chart, date };
}

export function specToSaved(s: Spec): Pick<SavedReport, "name" | "groupBy" | "metric" | "filters" | "chart"> {
  return {
    name: s.name,
    groupBy: s.groupBy.join(","),
    metric: s.metric,
    chart: s.chart,
    filters: [`date:${s.date}`, ...s.filters.flatMap((f) => f.values.map((v) => `${f.field}:${v}`))],
  };
}

export interface ResultRow {
  key: string;
  label: string;
  value: number;
  count: number;
}

export interface Pivot {
  rows: { key: string; label: string; total: number }[];
  cols: { key: string; label: string }[];
  cells: Map<string, number>;
}

export interface Result {
  rows: ResultRow[];
  total: number;
  count: number;
  pivot: Pivot | null;
}

function finish(sum: number, count: number, metric: Metric) {
  return metric === "count" ? count : metric === "average" ? (count ? sum / count : 0) : sum;
}

/** Runs a report. Declined charges are left out and refunds count against spend. */
export function run(tx: Transaction[], spec: Spec, ctx: Ctx): Result {
  const { from, to } = rangeOf(spec.date);
  const toEnd = `${to}T23:59:59`;
  const filters = spec.filters.filter((f) => f.values.length).map((f) => ({ def: fieldOf(f.field)!, values: new Set(f.values) }));
  const [g1, g2] = spec.groupBy.map((g) => fieldOf(g)!).filter(Boolean);
  const groups = new Map<string, { sum: number; count: number }>();
  const cells = new Map<string, { sum: number; count: number }>();
  const colKeys = new Set<string>();
  let sum = 0;
  let count = 0;
  for (const t of tx) {
    if (t.date < from || t.date > toEnd || t.status === "declined") continue;
    if (filters.some((f) => !f.def.keys(t, ctx).some((k) => f.values.has(k)))) continue;
    const amount = t.status === "refunded" ? -t.amount : t.amount;
    sum += amount;
    count++;
    if (!g1) continue;
    for (const k1 of g1.keys(t, ctx)) {
      const g = groups.get(k1) ?? { sum: 0, count: 0 };
      g.sum += amount;
      g.count++;
      groups.set(k1, g);
      if (g2)
        for (const k2 of g2.keys(t, ctx)) {
          colKeys.add(k2);
          const id = `${k1}\u0000${k2}`;
          const c = cells.get(id) ?? { sum: 0, count: 0 };
          c.sum += amount;
          c.count++;
          cells.set(id, c);
        }
    }
  }
  let rows: ResultRow[] = [...groups.entries()].map(([key, g]) => ({ key, label: g1.label_(key, ctx), value: finish(g.sum, g.count, spec.metric), count: g.count }));
  rows = g1?.time ? rows.sort((a, b) => a.key.localeCompare(b.key)) : rows.sort((a, b) => b.value - a.value);

  let pivot: Pivot | null = null;
  if (g2) {
    const cols = [...colKeys].sort((a, b) => a.localeCompare(b)).map((key) => ({ key, label: g2.label_(key, ctx) }));
    const values = new Map<string, number>();
    for (const [id, c] of cells) values.set(id, finish(c.sum, c.count, spec.metric));
    pivot = { rows: rows.map((r) => ({ key: r.key, label: r.label, total: r.value })), cols, cells: values };
  }
  return { rows, total: finish(sum, count, spec.metric), count, pivot };
}

/** Values a filter on this field can take, from the data, most common first. */
export function valuesOf(field: FieldKey, tx: Transaction[], ctx: Ctx): { value: string; label: string; count: number }[] {
  const def = fieldOf(field)!;
  const seen = new Map<string, number>();
  for (let i = 0; i < tx.length; i += 3) for (const k of def.keys(tx[i], ctx)) seen.set(k, (seen.get(k) ?? 0) + 1);
  const out = [...seen.entries()].map(([value, count]) => ({ value, label: def.label_(value, ctx), count }));
  return def.time ? out.sort((a, b) => b.value.localeCompare(a.value)) : out.sort((a, b) => b.count - a.count);
}

export const formatValue = (v: number, metric: Metric) =>
  metric === "count" ? Math.round(v).toLocaleString() : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: metric === "average" ? 2 : 0 }).format(v);

export const formatCompact = (v: number, metric: Metric) =>
  metric === "count" ? Intl.NumberFormat("en-US", { notation: "compact" }).format(v) : Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(v);

export interface Template {
  id: string;
  name: string;
  description: string;
  spec: Omit<Spec, "name">;
  /** Needs the advanced reports plan. */
  advanced?: boolean;
}

export const TEMPLATES: Template[] = [
  { id: "spend-by-department", name: "Spend by department", description: "Where the money goes, team by team.", spec: { groupBy: ["department"], filters: [], metric: "sum", chart: "bar", date: "quarter" } },
  { id: "top-merchants", name: "Top merchants", description: "The vendors you pay most on cards.", spec: { groupBy: ["merchant"], filters: [], metric: "sum", chart: "table", date: "90d" } },
  { id: "missing-receipts", name: "Missing receipts by person", description: "Who owes you receipts, and how many.", spec: { groupBy: ["employee"], filters: [{ field: "receipt", values: ["missing"] }], metric: "count", chart: "bar", date: "90d" } },
  { id: "card-utilization", name: "Card utilization", description: "Spend per card over the last 30 days.", spec: { groupBy: ["card"], filters: [], metric: "sum", chart: "table", date: "30d" } },
  { id: "monthly-trend", name: "Monthly spend trend", description: "Twelve months of card spend.", spec: { groupBy: ["month"], filters: [], metric: "sum", chart: "area", date: "12m" } },
  { id: "category-mix", name: "Category mix", description: "Share of spend by category.", spec: { groupBy: ["category"], filters: [], metric: "sum", chart: "pie", date: "quarter" } },
  { id: "merchant-by-month", name: "Merchants by month", description: "A pivot of every merchant across twelve months.", spec: { groupBy: ["merchant", "month"], filters: [], metric: "sum", chart: "table", date: "12m" } },
  { id: "policy-violations", name: "Policy violations", description: "Charges that broke a rule, by rule.", advanced: true, spec: { groupBy: ["violation"], filters: [], metric: "count", chart: "bar", date: "90d" } },
];
