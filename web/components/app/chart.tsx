"use client";

// The dashboard's charts, drawn with plain elements in the two neutrals, so
// they follow DESIGN.md in both modes with no chart library. Ink is the part
// that finished. A quarter-strength Ink is everything else.

import { useMemo, useState } from "react";
import { cn } from "cn";

const DAY_MS = 86_400_000;

/** "2026-11-16", by the viewer's own clock, as the Worker names a day. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shortDay(date: Date): string {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export interface Bucket {
  /** "12 Nov", or "6 to 12 Nov" for a week. */
  name: string;
  guides: number;
  finished: number;
}

/**
 * The days of a time range, oldest first, with the days nobody asked filled
 * in. A range longer than a month is shown a week at a time, so a bar stays
 * wide enough to point at.
 */
export function bucketsOf(daily: { day: string; guides: number; finished?: number }[], days: number, now = new Date()): { buckets: Bucket[]; weekly: boolean } {
  const byDay = new Map(daily.map((row) => [row.day, row]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // The range is the last `days` times 24 hours, so it reaches back into one more calendar day.
  const each = Array.from({ length: days + 1 }, (_, at) => {
    const date = new Date(today.getTime() - (days - at) * DAY_MS + DAY_MS / 2);
    const row = byDay.get(dayKey(date));
    return { date, guides: row?.guides ?? 0, finished: row?.finished ?? 0 };
  });
  if (days <= 31) return { weekly: false, buckets: each.map((day, at) => ({ name: at === each.length - 1 ? "Today" : shortDay(day.date), guides: day.guides, finished: day.finished })) };
  const buckets: Bucket[] = [];
  // Weeks are counted back from today, so the last bar is always the last seven days.
  for (let end = each.length; end > 0; end -= 7) {
    const week = each.slice(Math.max(0, end - 7), end);
    buckets.unshift({
      name: `${shortDay(week[0]!.date)} to ${shortDay(week[week.length - 1]!.date)}`,
      guides: week.reduce((sum, day) => sum + day.guides, 0),
      finished: week.reduce((sum, day) => sum + day.finished, 0),
    });
  }
  return { weekly: true, buckets };
}

/** The top of the scale: the next number at or above the tallest bar whose half is round too, since the scale shows both. */
function roundUp(value: number): number {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.2, 1.6, 2, 3, 4, 5, 6, 8, 10]) if (step * power >= value) return Math.round(step * power);
  return 10 * power;
}

/**
 * Questions over time, one bar for each day or week. The Ink part of a bar is
 * the guides that finished. Pointing at a bar, or reaching it with the
 * keyboard, says what it holds.
 */
export function QuestionsOverTime({ buckets, className }: { buckets: Bucket[]; className?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const top = roundUp(Math.max(...buckets.map((bucket) => bucket.guides), 0));
  const shown = active === null ? null : buckets[active];
  const middle = Math.floor((buckets.length - 1) / 2);

  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      <div className="relative h-40" onMouseLeave={() => setActive(null)}>
        {/* The scale: three hairlines and their numbers. */}
        {[1, 0.5, 0].map((share) => (
          <div key={share} className="absolute right-0 left-0 flex items-center" style={{ bottom: `${share * 100}%`, transform: "translateY(50%)" }} aria-hidden>
            <span className="w-7 shrink-0 text-xs text-muted-foreground tabular-nums">{Math.round(top * share).toLocaleString()}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        ))}
        <div className="absolute inset-y-0 right-0 left-7 flex items-end justify-between gap-0.5">
          {buckets.map((bucket, at) => {
            const rest = bucket.guides - bucket.finished;
            return (
              <button
                key={at}
                type="button"
                aria-label={`${bucket.name}, ${bucket.guides.toLocaleString()} ${bucket.guides === 1 ? "question" : "questions"}, ${bucket.finished.toLocaleString()} finished`}
                onMouseEnter={() => setActive(at)}
                onFocus={() => setActive(at)}
                onBlur={() => setActive(null)}
                className="group flex h-full max-w-6 min-w-0 flex-1 cursor-default flex-col justify-end gap-0.5 rounded-t-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {rest > 0 && <span className={cn("w-full rounded-t-sm bg-primary/25 transition-[height] duration-200 ease-out", active === at && "bg-primary/40")} style={{ height: `${(rest / top) * 100}%` }} />}
                {bucket.finished > 0 && (
                  <span className={cn("w-full bg-primary transition-[height] duration-200 ease-out", rest === 0 && "rounded-t-sm", active !== null && active !== at && "bg-primary/70")} style={{ height: `${(bucket.finished / top) * 100}%` }} />
                )}
              </button>
            );
          })}
        </div>
        {shown && active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute bottom-full z-10 mb-1 w-max -translate-x-1/2 rounded-lg bg-primary px-2.5 py-1.5 text-xs leading-4 text-primary-foreground"
            // Kept inside the chart at both ends, so the first and last bars' words are not cut off.
            style={{ left: `clamp(4.5rem, calc(1.75rem + (100% - 1.75rem) * ${(active + 0.5) / buckets.length}), calc(100% - 4.5rem))` }}
          >
            <span className="block font-medium">{shown.name}</span>
            <span className="block tabular-nums">
              {shown.guides.toLocaleString()} {shown.guides === 1 ? "question" : "questions"}, {shown.finished.toLocaleString()} finished
            </span>
          </div>
        )}
      </div>
      <div className="flex justify-between pl-7 text-xs text-muted-foreground" aria-hidden>
        <span>{buckets[0]?.name}</span>
        {buckets.length > 4 && <span>{buckets[middle]?.name}</span>}
        <span>{buckets[buckets.length - 1]?.name}</span>
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 pl-7 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary" aria-hidden />
          Finished
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary/25" aria-hidden />
          Everything else
        </span>
      </figcaption>
      {/* The same numbers as a table, for a screen reader. */}
      <table className="sr-only">
        <caption>Questions over time</caption>
        <thead>
          <tr>
            <th>When</th>
            <th>Questions</th>
            <th>Finished</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket, at) => (
            <tr key={at}>
              <td>{bucket.name}</td>
              <td>{bucket.guides}</td>
              <td>{bucket.finished}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** The last fortnight as fourteen small bars, today's in Ink. A shape to glance at, with its numbers in the words beside it. */
export function Spark({ daily, days = 14, className }: { daily: { day: string; guides: number }[]; days?: number; className?: string }) {
  const bars = useMemo(() => bucketsOf(daily, days - 1).buckets, [daily, days]);
  const top = Math.max(...bars.map((bar) => bar.guides), 1);
  return (
    <div className={cn("flex h-8 items-end gap-0.5", className)} aria-hidden>
      {bars.map((bar, at) => (
        <span
          key={at}
          className={cn("min-h-px flex-1 rounded-t-sm transition-[height] duration-200 ease-out", at === bars.length - 1 ? "bg-primary" : "bg-primary/25")}
          style={{ height: `${(bar.guides / top) * 100}%` }}
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
