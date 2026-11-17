"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Insights, Live } from "@/lib/app-api";
import { unanswered, withLive } from "./live";
import { GuideStatus, Segmented, useNow, when } from "./parts";

type Show = "all" | "finished" | "unanswered" | "under_way";

/** Under way and still moving. One that has gone quiet is shown as paused, and is not counted as under way. */
const moving = (row: { outcome: string; paused?: boolean }) => row.outcome === "under_way" && !row.paused;

/** The Worker sends this many of the newest questions. */
const MOST = 100;

/**
 * Every question of the time range, newest first, as a table to search and
 * filter. A row opens its guide beside the page. Live questions are laid over
 * the list, so a new one is at the top the moment it is asked.
 */
export function Questions({ data, live, onOpen }: { data: Insights | null; live: Live | null; onOpen: (guide: string) => void }) {
  const [show, setShow] = useState<Show>("all");
  const [search, setSearch] = useState("");
  const now = useNow();

  const rows = useMemo(() => (data ? withLive(data.recent, live?.guides, now - data.days * 86_400_000) : null), [data, live, now]);
  const counts = useMemo(
    () => ({
      all: rows?.length ?? 0,
      finished: rows?.filter((row) => row.outcome === "finished").length ?? 0,
      unanswered: rows?.filter(unanswered).length ?? 0,
      under_way: rows?.filter(moving).length ?? 0,
    }),
    [rows],
  );
  const words = search.trim().toLowerCase();
  const shown = rows?.filter(
    (row) =>
      (show === "all" || (show === "unanswered" ? unanswered(row) : show === "under_way" ? moving(row) : row.outcome === show)) && (!words || row.question.toLowerCase().includes(words) || row.started_path.toLowerCase().includes(words)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Which questions"
          value={show}
          onChange={setShow}
          options={[
            { value: "all", name: "All", count: counts.all },
            { value: "finished", name: "Finished", count: counts.finished },
            { value: "unanswered", name: "Unanswered", count: counts.unanswered },
            { value: "under_way", name: "Under way", count: counts.under_way },
          ]}
        />
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search questions" aria-label="Search questions" className="h-9 bg-card pl-9" />
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border bg-card">
        {!shown ? (
          <div className="flex flex-col gap-3 p-5">
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <Skeleton key={row} className="h-8" />
            ))}
          </div>
        ) : shown.length ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-10 px-5 text-xs font-medium text-muted-foreground">Question</TableHead>
                <TableHead className="h-10 px-3 text-xs font-medium text-muted-foreground">How it ended</TableHead>
                <TableHead className="hidden h-10 px-3 text-right text-xs font-medium text-muted-foreground md:table-cell">Steps</TableHead>
                <TableHead className="hidden h-10 px-3 text-xs font-medium text-muted-foreground lg:table-cell">Asked on</TableHead>
                <TableHead className="h-10 px-5 text-right text-xs font-medium text-muted-foreground">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <TableRow key={row.id} onClick={() => onOpen(row.id)} className="cursor-pointer hover:bg-muted/60 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0">
                  <TableCell className="max-w-0 px-5 py-2.5 sm:w-1/2">
                    {/* The button is what the keyboard reaches. A click anywhere on the row does the same. */}
                    <button type="button" className="block w-full truncate rounded-sm text-left font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                      {row.question}
                    </button>
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <GuideStatus outcome={row.outcome} helped={row.helped} paused={row.paused} step={row.step_count ? row.step_count - 1 : null} />
                    {row.helped !== null && <span className="text-muted-foreground">, {row.helped ? "helped" : "did not help"}</span>}
                  </TableCell>
                  <TableCell className="hidden px-3 py-2.5 text-right text-muted-foreground tabular-nums md:table-cell">{row.step_count}</TableCell>
                  <TableCell className="hidden max-w-40 truncate px-3 py-2.5 text-muted-foreground lg:table-cell">{row.started_path}</TableCell>
                  <TableCell className="px-5 py-2.5 text-right text-muted-foreground tabular-nums">{when(row.started_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="p-5 text-sm leading-5 text-muted-foreground">
            {rows?.length ? "No question matches that." : `No one has asked Haptic anything on this site in the last ${data?.days} days. Once people do, every question shows up here with how its guide went.`}
          </p>
        )}
      </section>
      {data && data.recent.length >= MOST && <p className="text-xs text-muted-foreground">The {MOST} most recent questions of the last {data.days} days are shown.</p>}
    </div>
  );
}
