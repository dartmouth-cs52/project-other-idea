import { format, subDays, subMinutes, subMonths } from "date-fns";
import { toast } from "sonner";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lab } from "@/lab/lab";

// Accounting state that isn't in the shared data: the close checklist, locked
// periods, the fake sync job and its history, and department class mappings.

export interface CloseTask {
  id: string;
  section: "Reconcile" | "Review" | "Accrue" | "Sync and report";
  title: string;
  /** Index into the finance team, so names come from the seed. */
  assignee: number;
  /** Working day of the next month it's due on. */
  dueDay: number;
  href?: string;
}

export const CLOSE_TASKS: CloseTask[] = [
  { id: "rec-op", section: "Reconcile", title: "Reconcile operating account •••• 4417", assignee: 0, dueDay: 2 },
  { id: "rec-card", section: "Reconcile", title: "Reconcile card clearing account", assignee: 1, dueDay: 2 },
  { id: "rec-stmt", section: "Reconcile", title: "Match card statements to transactions", assignee: 1, dueDay: 3, href: "/expenses" },
  { id: "rev-uncat", section: "Review", title: "Review uncategorized card spend", assignee: 2, dueDay: 3, href: "/expenses?review=needs_review" },
  { id: "rev-receipts", section: "Review", title: "Chase missing receipts", assignee: 2, dueDay: 4, href: "/expenses?receipt=missing" },
  { id: "rev-bills", section: "Review", title: "Approve outstanding bills", assignee: 0, dueDay: 4, href: "/bills?status=awaiting_approval" },
  { id: "rev-reimb", section: "Review", title: "Review reimbursements", assignee: 3, dueDay: 4, href: "/reimbursements" },
  { id: "acc-unbilled", section: "Accrue", title: "Book accruals for unbilled services", assignee: 0, dueDay: 5 },
  { id: "acc-prepaid", section: "Accrue", title: "Record prepaid expense amortization", assignee: 3, dueDay: 5 },
  { id: "sync-fix", section: "Sync and report", title: "Fix failed Ledgerbook exports", assignee: 1, dueDay: 6, href: "/accounting/sync" },
  { id: "sync-final", section: "Sync and report", title: "Run final sync to Ledgerbook", assignee: 1, dueDay: 6, href: "/accounting/sync" },
  { id: "rep-flash", section: "Sync and report", title: "Send flash report to leadership", assignee: 0, dueDay: 7, href: "/reports" },
];

/** "2026-10" style keys, newest first: the month being closed, the current month, and two locked ones. */
export function periods() {
  const now = new Date();
  return [0, 1, 2, 3].map((n) => {
    const d = subMonths(now, n);
    return { key: format(d, "yyyy-MM"), label: format(d, "MMMM yyyy"), month: format(d, "MMMM") };
  });
}

export interface SyncRun {
  id: string;
  startedAt: string;
  durationSec: number;
  trigger: "Manual" | "Scheduled";
  records: number;
  failed: number;
  status: "success" | "partial" | "failed";
  by: string | null;
}

export interface FailedItem {
  id: string;
  kind: "Transaction" | "Bill" | "Reimbursement";
  label: string;
  amount: number;
  error: string;
  /** Retrying fails again while this department has no class. */
  needsClassFor?: string;
}

const now = () => new Date();

function seedHistory(): SyncRun[] {
  const t = now();
  return [
    { id: "run_6", startedAt: subMinutes(t, 120).toISOString(), durationSec: 41, trigger: "Scheduled", records: 386, failed: 3, status: "partial", by: null },
    { id: "run_5", startedAt: subMinutes(t, 120 + 360).toISOString(), durationSec: 38, trigger: "Scheduled", records: 214, failed: 0, status: "success", by: null },
    { id: "run_4", startedAt: subDays(t, 1).toISOString(), durationSec: 52, trigger: "Manual", records: 902, failed: 0, status: "success", by: "emp_me" },
    { id: "run_3", startedAt: subDays(t, 2).toISOString(), durationSec: 9, trigger: "Scheduled", records: 0, failed: 0, status: "failed", by: null },
    { id: "run_2", startedAt: subDays(t, 3).toISOString(), durationSec: 44, trigger: "Scheduled", records: 517, failed: 1, status: "partial", by: null },
    { id: "run_1", startedAt: subDays(t, 4).toISOString(), durationSec: 47, trigger: "Scheduled", records: 488, failed: 0, status: "success", by: null },
  ];
}

const SEED_FAILED: FailedItem[] = [
  { id: "fail_1", kind: "Transaction", label: "Copperpot Catering", amount: 1284.5, error: "Meals is mapped to an account Ledgerbook has archived." },
  { id: "fail_2", kind: "Bill", label: "CloudStack Hosting INV-46706", amount: 49912.49, error: "Vendor not found in Ledgerbook. Create it there or re-link it." },
  { id: "fail_3", kind: "Reimbursement", label: "Mileage, Portland to Bend", amount: 187.6, error: "The Data department has no class mapping.", needsClassFor: "dep_data" },
];

/** Classes in Ledgerbook. Departments map to one each. */
export const CLASSES = ["Research and development", "Sales and marketing", "General and administrative", "Cost of revenue", "Executive"];

const SEED_CLASS_MAP: Record<string, string | null> = {
  dep_executive: "Executive",
  dep_engineering: "Research and development",
  dep_platform: "Research and development",
  dep_mobile: "Research and development",
  dep_data: null,
  dep_sales: "Sales and marketing",
  dep_enterprise_sales: "Sales and marketing",
  dep_sales_development: "Sales and marketing",
  dep_marketing: "Sales and marketing",
  dep_brand: null,
  dep_finance: "General and administrative",
  dep_people: "General and administrative",
  dep_customer_success: "Cost of revenue",
  dep_legal: null,
};

interface AccountingState {
  /** Done task ids per period key. */
  done: Record<string, string[]>;
  locked: Record<string, string | null>;
  history: SyncRun[];
  failed: FailedItem[];
  classMap: Record<string, string | null>;
  summaEntity: string | null;
  job: { running: boolean; progress: number; stage: string };
  toggleTask: (period: string, id: string) => void;
  setLocked: (period: string, locked: boolean) => void;
  setClassMap: (map: Record<string, string | null>) => void;
  removeFailed: (id: string) => void;
  connectSumma: (entity: string | null) => void;
}

function seedDone(): Record<string, string[]> {
  const [current, closing, older, oldest] = periods();
  const all = CLOSE_TASKS.map((t) => t.id);
  return { [closing.key]: ["rec-op", "rec-card", "rec-stmt", "rev-uncat", "rev-bills", "acc-unbilled"], [current.key]: [], [older.key]: all, [oldest.key]: all };
}

function seedLocked(): Record<string, string | null> {
  const [, , older, oldest] = periods();
  return { [older.key]: subDays(now(), 40).toISOString(), [oldest.key]: subDays(now(), 70).toISOString() };
}

export const useAccounting = create<AccountingState>()(
  persist(
    (set) => ({
      done: seedDone(),
      locked: seedLocked(),
      history: seedHistory(),
      failed: SEED_FAILED,
      classMap: SEED_CLASS_MAP,
      summaEntity: null,
      job: { running: false, progress: 0, stage: "" },
      toggleTask: (period, id) => set((s) => ({ done: { ...s.done, [period]: (s.done[period] ?? []).includes(id) ? s.done[period].filter((x) => x !== id) : [...(s.done[period] ?? []), id] } })),
      setLocked: (period, locked) => set((s) => ({ locked: { ...s.locked, [period]: locked ? now().toISOString() : null } })),
      setClassMap: (classMap) => set({ classMap }),
      removeFailed: (id) => set((s) => ({ failed: s.failed.filter((f) => f.id !== id) })),
      connectSumma: (summaEntity) => set({ summaEntity }),
    }),
    { name: "northpine-accounting", version: 1, partialize: ({ job: _job, ...rest }) => rest },
  ),
);

const STAGES: [number, string][] = [
  [0, "Connecting to Ledgerbook"],
  [12, "Exporting card transactions"],
  [45, "Exporting bills"],
  [65, "Exporting reimbursements"],
  [82, "Matching vendors"],
  [94, "Finishing up"],
];

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the fake sync. It advances for about 8 seconds whatever page you're on,
 * then lands in the history.
 */
export function startSync() {
  const s = useAccounting.getState();
  if (s.job.running) return;
  const started = Date.now();
  useAccounting.setState({ job: { running: true, progress: 0, stage: STAGES[0][1] } });
  timer = setInterval(() => {
    const progress = Math.min(100, ((Date.now() - started) / 8000) * 100);
    const stage = [...STAGES].reverse().find(([at]) => progress >= at)![1];
    useAccounting.setState({ job: { running: progress < 100, progress, stage } });
    if (progress >= 100) {
      if (timer) clearInterval(timer);
      timer = null;
      const state = useAccounting.getState();
      const failedOut = Math.random() < lab().failureRate;
      const run: SyncRun = {
        id: `run_${Date.now().toString(36)}`,
        startedAt: new Date(started).toISOString(),
        durationSec: 8,
        trigger: "Manual",
        records: failedOut ? 0 : 140 + Math.floor(Math.random() * 300),
        failed: state.failed.length,
        status: failedOut ? "failed" : state.failed.length ? "partial" : "success",
        by: "emp_me",
      };
      useAccounting.setState({ history: [run, ...state.history].slice(0, 25), job: { running: false, progress: 0, stage: "" } });
      if (failedOut) toast.error("Sync failed. Ledgerbook didn't respond.");
      else if (run.failed) toast.warning(`Synced ${run.records} records. ${run.failed} still need attention.`);
      else toast.success(`Synced ${run.records} records to Ledgerbook`);
    }
  }, 200);
}
