import { Car, CalendarDays, Receipt } from "lucide-react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Reimbursement, ReimbursementKind } from "@/data/types";

// Things a reimbursement has that the shared record doesn't: split lines,
// per diem dates, the comment thread and the history. Kept per browser, like
// the rest of a visitor's changes.

export const MILEAGE_RATE = 0.7;
export const PER_DIEM_RATES: { city: string; rate: number }[] = [
  { city: "New York, NY", rate: 79 },
  { city: "San Francisco, CA", rate: 79 },
  { city: "Seattle, WA", rate: 74 },
  { city: "Chicago, IL", rate: 74 },
  { city: "Austin, TX", rate: 69 },
  { city: "Denver, CO", rate: 69 },
  { city: "Boston, MA", rate: 79 },
  { city: "London, UK", rate: 92 },
  { city: "Berlin, DE", rate: 68 },
  { city: "Anywhere else in the US", rate: 59 },
];

export const KIND_LABELS: Record<ReimbursementKind, string> = { out_of_pocket: "Out of pocket", mileage: "Mileage", per_diem: "Per diem" };

export function KindIcon({ kind, className }: { kind: ReimbursementKind; className?: string }) {
  const Icon = kind === "mileage" ? Car : kind === "per_diem" ? CalendarDays : Receipt;
  return <Icon className={className ?? "size-4 text-ink-3"} />;
}

export interface SplitLine {
  categoryId: string;
  amount: number;
  memo: string;
}
export interface Comment {
  authorId: string;
  body: string;
  at: string;
}
export interface HistoryEvent {
  label: string;
  by: string;
  at: string;
}

interface Extras {
  splits: Record<string, SplitLine[]>;
  perDiem: Record<string, { from: string; to: string; city: string; mealsProvided: number }>;
  roundTrip: Record<string, boolean>;
  receiptNames: Record<string, string>;
  comments: Record<string, Comment[]>;
  history: Record<string, HistoryEvent[]>;
  addComment: (id: string, c: Comment) => void;
  log: (id: string, e: HistoryEvent) => void;
  setExtra: (patch: Partial<Pick<Extras, "splits" | "perDiem" | "roundTrip" | "receiptNames">>) => void;
}

export const useExtras = create<Extras>()(
  persist(
    (set) => ({
      splits: {},
      perDiem: {},
      roundTrip: {},
      receiptNames: {},
      comments: {},
      history: {},
      addComment: (id, c) => set((s) => ({ comments: { ...s.comments, [id]: [...(s.comments[id] ?? []), c] } })),
      log: (id, e) => set((s) => ({ history: { ...s.history, [id]: [...(s.history[id] ?? []), e] } })),
      setExtra: (patch) =>
        set((s) => ({
          splits: { ...s.splits, ...patch.splits },
          perDiem: { ...s.perDiem, ...patch.perDiem },
          roundTrip: { ...s.roundTrip, ...patch.roundTrip },
          receiptNames: { ...s.receiptNames, ...patch.receiptNames },
        })),
    }),
    { name: "northpine-reimbursement-extras" },
  ),
);

/** Miles between two places. There's no map service, so it's a stable number from the names. */
export function estimateMiles(origin: string, destination: string) {
  const a = origin.trim().toLowerCase();
  const b = destination.trim().toLowerCase();
  if (!a || !b || a === b) return 0;
  const known: Record<string, number> = {
    "portland, or|bend, or": 162,
    "portland, or|hood river, or": 62,
    "portland, or|vancouver, wa": 10,
    "portland, or|corvallis, or": 85,
    "portland, or|salem, or": 47,
    "portland, or|seattle, wa": 174,
    "portland, or|eugene, or": 110,
    "portland, or|pdx airport": 12,
  };
  const key = [a, b].sort().join("|");
  const hit = Object.entries(known).find(([k]) => k.split("|").sort().join("|") === key);
  if (hit) return hit[1];
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return 6 + (h % 240);
}

export const statusOrder: Reimbursement["status"][] = ["draft", "submitted", "approved", "paid"];
