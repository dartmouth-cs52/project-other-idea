"use client";

// The small charts of the dashboard, drawn with plain elements in the two
// neutrals, so they follow DESIGN.md in both modes with no chart library. The
// chart of guides each day is in headline.tsx.

import { useMemo } from "react";
import { cn } from "cn";

const DAY_MS = 86_400_000;

/** "2026-11-16", by the viewer's own clock, as the Worker names a day for the list of sites. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The last `days` days up to today, oldest first, with the days nobody asked filled in. */
export function lastDays(daily: { day: string; guides: number }[], days: number, now = new Date()): number[] {
  const byDay = new Map(daily.map((row) => [row.day, row.guides]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Noon, so a day an hour short or long when the clocks change still lands on its own date.
  return Array.from({ length: days }, (_, at) => byDay.get(dayKey(new Date(today.getTime() - (days - 1 - at) * DAY_MS + DAY_MS / 2))) ?? 0);
}

/** The last fortnight as fourteen small bars, today's in Ink. A shape to glance at, with its numbers in the words beside it. */
export function Spark({ daily, days = 14, className }: { daily: { day: string; guides: number }[]; days?: number; className?: string }) {
  const bars = useMemo(() => lastDays(daily, days), [daily, days]);
  const top = Math.max(...bars, 1);
  return (
    <div className={cn("flex h-8 items-end gap-0.5", className)} aria-hidden>
      {bars.map((bar, at) => (
        <span
          key={at}
          className={cn("min-h-px flex-1 rounded-t-sm transition-[height] duration-200 ease-out", at === bars.length - 1 ? "bg-primary" : "bg-primary/25")}
          style={{ height: `${(bar / top) * 100}%` }}
        />
      ))}
    </div>
  );
}

/** A share of a whole as a thin bar: Ink on the Border grey track. */
export function ShareBar({ share, className }: { share: number; className?: string }) {
  return (
    <span className={cn("block h-1.5 overflow-hidden rounded-full bg-secondary", className)} aria-hidden>
      <span className="block h-full rounded-full bg-primary transition-[width] duration-200 ease-out" style={{ width: `${Math.min(100, Math.max(share > 0 ? 2 : 0, share * 100))}%` }} />
    </span>
  );
}
