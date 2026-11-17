"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OUTCOME_LABEL, type Insights, type Live, type LiveGuide } from "@/lib/app-api";
import { ShareBar } from "./chart";
import { HeadlineChart, HeadlineTiles, HeadlineWaiting, useHeadline } from "./headline";
import { siteHref } from "./nav";
import { GuideStatus, Panel, PanelEmpty, StatusMark, seconds, useNow, when } from "./parts";

/** How many of the newest questions the first page shows. The Questions page has the rest. */
const LATEST_SHOWN = 8;

const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * A site at a glance: four numbers, the newest questions as they happen, the
 * guides of the time range day by day, how guides ended, and what people could
 * not find. A site nobody has asked anything yet says what will show here.
 */
export function Overview({
  siteId,
  origin,
  days,
  stamp,
  data,
  live,
  onOpen,
}: {
  siteId: string;
  origin: string;
  days: number;
  /** Changes whenever anything about the site's questions does, so the numbers are asked for again. */
  stamp: string | undefined;
  data: Insights | null;
  live: Live | null;
  onOpen: (guide: string) => void;
}) {
  const headline = useHeadline(siteId, days, stamp);
  if (headline.data && !headline.data.asked) {
    return (
      <>
        <HeadlineWaiting origin={origin} />
        <Latest siteId={siteId} live={live} onOpen={onOpen} />
      </>
    );
  }
  return (
    <>
      <HeadlineTiles data={headline.data} days={days} error={headline.error} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Latest siteId={siteId} live={live} onOpen={onOpen} className="lg:col-span-3" />
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <HeadlineChart data={headline.data} />
          <Endings data={data} />
        </div>
      </div>
      <CantFindSummary siteId={siteId} data={data} />
    </>
  );
}

/** Where a guide has got to, after its status: the control it is pointing at, or where it ended. */
function reached(guide: LiveGuide): string {
  if (guide.outcome === "under_way") return guide.last ? `, ${guide.last.target_label ?? "nothing to point at"} on ${guide.last.path}` : "";
  if (guide.outcome === "finished") return `, ${guide.step_count} ${guide.step_count === 1 ? "step" : "steps"}`;
  if (guide.last && ["abandoned", "stopped", "loop", "step_limit"].includes(guide.outcome)) return `, at step ${guide.last.n + 1} on ${guide.last.path}`;
  return "";
}

/** The newest questions, kept current. One under way shows the step it is on, and a new one slides in at the top. */
function Latest({ siteId, live, onOpen, className }: { siteId: string; live: Live | null; onOpen: (guide: string) => void; className?: string }) {
  useNow();
  const guides = live?.guides.slice(0, LATEST_SHOWN);
  return (
    <Panel
      title="Latest questions"
      className={className}
      aside={
        <Link href={siteHref(siteId, "questions")} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          All questions
        </Link>
      }
    >
      {!guides ? (
        <div className="flex flex-col gap-3 px-5 pb-5">
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} className="h-10" />
          ))}
        </div>
      ) : guides.length ? (
        <ul className="flex flex-col divide-y border-t">
          {guides.map((guide) => (
            <li key={guide.id} className="motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-top-1">
              <button
                type="button"
                onClick={() => onOpen(guide.id)}
                className="flex w-full items-center gap-4 px-5 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{guide.question}</span>
                  <span className="flex min-w-0 items-center text-xs leading-5 text-muted-foreground">
                    <GuideStatus outcome={guide.outcome} helped={guide.helped} paused={guide.paused} step={guide.last?.n ?? null} className={cn("shrink-0", guide.outcome === "under_way" && !guide.paused && "text-foreground")} />
                    <span className="truncate">{reached(guide)}</span>
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{when(guide.started_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <PanelEmpty>No one has asked Haptic anything on this site yet. The first question shows up here the moment it is asked.</PanelEmpty>
      )}
    </Panel>
  );
}

/** How the range's guides ended, most common first, with what people said and how fast the pointer moved under them. */
function Endings({ data }: { data: Insights | null }) {
  const summary = data?.summary;
  const said = summary ? summary.helped_yes + summary.helped_no : 0;
  const foot = summary
    ? [
        said ? `${summary.helped_yes} of ${said} who answered said it helped.` : null,
        summary.median_ms_to_pointer !== null ? `The pointer moved ${seconds(summary.median_ms_to_pointer)} after the question, at the median.` : null,
        summary.median_steps_finished !== null ? `A finished guide took ${Number(summary.median_steps_finished).toLocaleString()} steps, at the median.` : null,
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  return (
    <Panel title="How guides ended" foot={foot || undefined}>
      {!data ? (
        <div className="px-5 pb-5">
          <Skeleton className="h-32" />
        </div>
      ) : data.outcomes.length ? (
        <ul className="flex flex-col gap-2.5 px-5 pb-5">
          {data.outcomes.map((row) => (
            <li key={row.outcome} className="grid grid-cols-[minmax(0,14.5rem)_1fr_2.5rem] items-center gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <StatusMark outcome={row.outcome} />
                <span className="truncate">{OUTCOME_LABEL[row.outcome]}</span>
              </span>
              <ShareBar share={row.count / data.summary.guides} />
              <span className="text-right text-muted-foreground tabular-nums">{row.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      ) : (
        <PanelEmpty>No guides in the last {data.days} days.</PanelEmpty>
      )}
    </Panel>
  );
}

/** The three questions most people could not find, with the way to the rest. */
function CantFindSummary({ siteId, data }: { siteId: string; data: Insights | null }) {
  if (!data) return null;
  const rows = data.cantFind.slice(0, 3);
  const flagged = data.health.filter((group) => group.flag).length;
  let note: ReactNode = null;
  if (flagged) note = `${flagged} common ${flagged === 1 ? "question has" : "questions have"} stopped finishing this week.`;
  return (
    <Panel
      title="What people can't find"
      aside={
        <Link href={siteHref(siteId, "gaps")} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          All gaps
        </Link>
      }
      foot={note}
    >
      {rows.length ? (
        <ul className="flex flex-col divide-y border-t">
          {rows.map((row) => (
            <li key={row.key} className="grid items-center gap-x-6 gap-y-1 px-5 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_8rem_9rem]">
              <span className="min-w-0 truncate">
                <span className="font-medium">&ldquo;{row.question}&rdquo;</span>
                <span className="text-muted-foreground">
                  , asked by {row.visitors.toLocaleString()} {row.visitors === 1 ? "person" : "people"}
                </span>
              </span>
              <ShareBar share={row.found / row.visitors} />
              <span className="text-muted-foreground tabular-nums sm:text-right">{percent((row.visitors - row.found) / row.visitors)} gave up</span>
            </li>
          ))}
        </ul>
      ) : (
        <PanelEmpty>Everyone who asked in the last {data.days} days got where they were going, as far as Haptic can tell.</PanelEmpty>
      )}
    </Panel>
  );
}
