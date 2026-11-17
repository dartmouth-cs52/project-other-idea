"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { api, type FinishedList } from "@/lib/app-api";
import { BILLING_HREF } from "./nav";
import { Card, CardTitle, when } from "./parts";

/** The last twelve months, newest first, as "2026-11". */
function recentMonths(): string[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, back) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7));
}

function monthName(month: string): string {
  return new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

/** How many shown on the page. The download has every one. */
const FINISHED_SHOWN = 50;

/**
 * Every finished guide, month by month. These are the guides billing counts,
 * and pricing promises each one is listed here so a bill can be checked.
 */
export function FinishedGuides({ siteId, onOpen }: { siteId: string; onOpen: (id: string) => void }) {
  const months = recentMonths();
  const [month, setMonth] = useState(months[0]!);
  const [list, setList] = useState<FinishedList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<FinishedList>(`/sites/${siteId}/finished?month=${month}`)
      .then((result) => live && (setList(result), setError(null)))
      .catch((failure: Error) => live && setError(failure.message));
    return () => {
      live = false;
    };
  }, [siteId, month]);

  return (
    <Card>
      <CardTitle
        aside={
          <select
            aria-label="Month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="h-8 rounded-lg border bg-card px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {months.map((item) => (
              <option key={item} value={item}>
                {monthName(item)}
              </option>
            ))}
          </select>
        }
      >
        Finished guides
      </CardTitle>
      {error && <p className="text-sm text-muted-foreground">{error}</p>}
      {list && list.month === month && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <p className="flex flex-col gap-1">
              <span className="text-4xl font-medium tracking-[-0.03em] tabular-nums">{list.count.toLocaleString()}</span>
              <span className="text-sm text-muted-foreground">finished in {monthName(month)}, on this site</span>
            </p>
            {list.count > 0 && (
              <a href={`/api/app/sites/${siteId}/finished?month=${month}&format=csv`} className={buttonVariants({ variant: "secondary" })} download>
                Download the list
              </a>
            )}
          </div>
          {list.count > 0 && (
            <ul className="flex flex-col divide-y rounded-lg border bg-card">
              {list.guides.slice(0, FINISHED_SHOWN).map((guide) => (
                <li key={guide.id}>
                  <button type="button" onClick={() => onOpen(guide.id)} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/60">
                    <span className="min-w-0 truncate text-sm">{guide.question}</span>
                    <span className="shrink-0 text-sm text-muted-foreground">{when(guide.ended_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.count > FINISHED_SHOWN && (
            <p className="text-sm text-muted-foreground">The {FINISHED_SHOWN} most recent are shown. The download has all {list.count.toLocaleString()}.</p>
          )}
        </>
      )}
      <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
        These are the guides billing counts. A guide is finished when the person uses the last control Haptic pointed at, or reaches the screen
        they asked for. Your plan, and what all your sites have used this month, are on the{" "}
        <Link href={BILLING_HREF} className="underline underline-offset-2">
          billing page
        </Link>
        .
      </p>
    </Card>
  );
}
