import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Budget, Department } from "@/data/types";

// Budgets keep a few settings the Budget record doesn't have room for: every
// alert threshold, who is notified and rollover. They live here, saved in
// localStorage next to the page's view settings.

export type Period = "month" | "quarter" | "year";

export interface BudgetExtras {
  thresholds: number[];
  notify: string[];
  rollover: boolean;
  rolloverCap: string;
}

interface BudgetUi {
  period: Period;
  collapsed: string[];
  extras: Record<string, BudgetExtras>;
  setPeriod: (p: Period) => void;
  toggle: (group: string) => void;
  setExtras: (id: string, e: BudgetExtras) => void;
}

export const useBudgetUi = create<BudgetUi>()(
  persist(
    (set) => ({
      period: "month",
      collapsed: [],
      extras: {},
      setPeriod: (period) => set({ period }),
      toggle: (g) => set((s) => ({ collapsed: s.collapsed.includes(g) ? s.collapsed.filter((x) => x !== g) : [...s.collapsed, g] })),
      setExtras: (id, e) => set((s) => ({ extras: { ...s.extras, [id]: e } })),
    }),
    { name: "northpine-budgets" },
  ),
);

export const PERIOD_LABELS: Record<Period, string> = { month: "This month", quarter: "This quarter", year: "This year" };

/** How many months a budget's own period covers. */
const MONTHS: Record<Budget["period"], number> = { monthly: 1, quarterly: 3, yearly: 12 };
const VIEW_MONTHS: Record<Period, number> = { month: 1, quarter: 3, year: 12 };

/** A small, stable number from an id, so a budget's other periods look the same on every visit. */
function wobble(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 1000) / 1000;
}

/** A budget's amount and spend seen through the page's period switcher. */
export function inPeriod(b: Budget, period: Period): { amount: number; spent: number } {
  const monthly = b.amount / MONTHS[b.period];
  const amount = monthly * VIEW_MONTHS[period];
  const monthlySpent = b.spent / MONTHS[b.period];
  // The current month is part done, earlier months were full.
  const spent = period === "month" ? monthlySpent : period === "quarter" ? monthlySpent * (1.9 + wobble(b.id) * 0.7) : monthlySpent * (8.5 + wobble(b.id) * 3);
  return { amount, spent };
}

export function tone(spent: number, amount: number, alertAt: number): "danger" | "warn" | "brand" {
  const p = (spent / amount) * 100;
  return p > 100 ? "danger" : p >= alertAt ? "warn" : "brand";
}

/** The top-level department a department rolls up to. */
export function rootOf(id: string, deps: Map<string, Department>): Department | undefined {
  let d = deps.get(id);
  while (d?.parentId) d = deps.get(d.parentId);
  return d;
}
