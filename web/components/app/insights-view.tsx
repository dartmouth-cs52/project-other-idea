"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, OUTCOME_LABEL, type Correction, type FinishedList, type GuideDetail, type Insights } from "@/lib/app-api";
import { PointHereInstead } from "./guiding-rules";
import { Card, CardTitle, DoneMark, seconds, when } from "./parts";

const RANGES = [7, 30, 90];

/**
 * What a company's users asked and how each guide went. It leads with the
 * questions that keep going unanswered, because those are what the company
 * can fix.
 */
export function InsightsView({ siteId, refreshKey, onCorrected }: { siteId: string; refreshKey: number; onCorrected?: (corrections: Correction[]) => void }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<Insights>(`/sites/${siteId}/insights?days=${days}`)
      .then((result) => live && (setData(result), setError(null)))
      .catch((failure: Error) => live && setError(failure.message));
    return () => {
      live = false;
    };
  }, [siteId, days, refreshKey]);

  if (error) return <Card><p className="text-base text-muted-foreground">{error}</p></Card>;
  if (!data) return <Card><p className="text-base text-muted-foreground">Loading questions</p></Card>;

  const { summary } = data;
  const ranges = (
    <div className="flex gap-1" role="group" aria-label="Time range">
      {RANGES.map((range) => (
        <Button key={range} size="sm" variant={range === days ? "default" : "ghost"} onClick={() => setDays(range)} aria-pressed={range === days}>
          {range} days
        </Button>
      ))}
    </div>
  );

  if (!summary.guides) {
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <CardTitle aside={ranges}>Questions</CardTitle>
          <p className="max-w-[65ch] text-base leading-6 text-muted-foreground">
            No one has asked Haptic anything on this site in the last {days} days. Once people do, every question shows up here with how its guide went.
          </p>
        </Card>
        <FinishedGuides siteId={siteId} refreshKey={refreshKey} onOpen={setOpen} />
        {open && <GuideDrawer siteId={siteId} guideId={open} onClose={() => setOpen(null)} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardTitle aside={ranges}>Asked again and again, not yet answered</CardTitle>
        {data.unanswered.length ? (
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {data.unanswered.map((row) => (
              <li key={row.key}>
                <button type="button" onClick={() => row.example && setOpen(row.example)} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/60">
                  <span className="min-w-0 text-base">{row.question}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {row.unanswered} of {row.asked} unanswered
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="max-w-[65ch] text-base leading-6 text-muted-foreground">
            Nothing yet. A question shows up here once it has gone unanswered twice, so you can see what to fix first.
          </p>
        )}
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          Unanswered means Haptic had nothing to point at, went in a loop, ran out of steps, hit an error, was abandoned, or the person said it did not help.
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Guides started" value={summary.guides.toLocaleString()} />
        <Stat label="Unanswered" value={summary.unanswered.toLocaleString()} />
        <Stat label="Said it helped" value={summary.helped_yes + summary.helped_no ? `${summary.helped_yes} of ${summary.helped_yes + summary.helped_no}` : "No answers yet"} />
        <Stat label="Time until the pointer moved" value={seconds(summary.median_ms_to_pointer)} note="Median, first step" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-2xl font-medium tracking-[-0.02em]">How guides ended</h2>
          <ul className="flex flex-col gap-3">
            {data.outcomes.map((row) => (
              <li key={row.outcome} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate">{OUTCOME_LABEL[row.outcome]}</span>
                <span className="h-2 rounded-full bg-secondary">
                  <span className="block h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, (row.count / summary.guides) * 100)}%` }} />
                </span>
                <span className="w-10 text-right tabular-nums text-muted-foreground">{row.count}</span>
              </li>
            ))}
          </ul>
          {summary.median_steps_finished !== null && (
            <p className="text-sm text-muted-foreground">A finished guide took {Number(summary.median_steps_finished).toLocaleString()} steps, at the median.</p>
          )}
        </Card>
        <Card>
          <h2 className="text-2xl font-medium tracking-[-0.02em]">Where people give up</h2>
          {data.abandonedAt.length ? (
            <ul className="flex flex-col divide-y rounded-lg border bg-card">
              {data.abandonedAt.map((row) => (
                <li key={`${row.path} ${row.step}`} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{row.path}</span>
                    <span className="text-muted-foreground">
                      , step {row.step}
                      {row.target_label ? `, at ${row.target_label}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{row.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-muted-foreground">No guide has been abandoned or stopped.</p>
          )}
          <h3 className="pt-2 text-base font-medium">Steps people click past</h3>
          {data.wrongClicks.length ? (
            <ul className="flex flex-col divide-y rounded-lg border bg-card">
              {data.wrongClicks.map((row) => (
                <li key={`${row.path} ${row.target_label}`} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{row.target_label}</span>
                    <span className="text-muted-foreground"> on {row.path}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {row.wrong} of {row.shown} clicked something else
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-muted-foreground">No wrong clicks yet.</p>
          )}
        </Card>
      </div>

      <FinishedGuides siteId={siteId} refreshKey={refreshKey} onOpen={setOpen} />

      <Card>
        <h2 className="text-2xl font-medium tracking-[-0.02em]">Every question</h2>
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {data.recent.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => setOpen(row.id)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="min-w-0 text-base">{row.question}</span>
                <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                  {row.outcome === "finished" && <DoneMark className="size-4" />}
                  <span>
                    {[OUTCOME_LABEL[row.outcome], row.helped === null ? null : row.helped ? "helped" : "did not help", when(row.started_at)].filter(Boolean).join(", ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {open && <GuideDrawer siteId={siteId} guideId={open} onClose={() => setOpen(null)} onCorrected={onCorrected} />}
    </div>
  );
}

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
function FinishedGuides({ siteId, refreshKey, onOpen }: { siteId: string; refreshKey: number; onOpen: (id: string) => void }) {
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
  }, [siteId, month, refreshKey]);

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
      {error && <p className="text-base text-muted-foreground">{error}</p>}
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
                    <span className="min-w-0 text-base">{guide.question}</span>
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
        These are the guides billing will count. A guide is finished when the person uses the last control Haptic pointed at, or reaches the screen
        they asked for. Haptic is free during early access.
      </p>
    </Card>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-muted p-6">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-4xl font-medium tracking-[-0.03em] tabular-nums">{value}</span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

/** One guide, step by step: what was pointed at, what was said, and what the person did. */
function GuideDrawer({ siteId, guideId, onClose, onCorrected }: { siteId: string; guideId: string; onClose: () => void; onCorrected?: (corrections: Correction[]) => void }) {
  const [guide, setGuide] = useState<GuideDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<GuideDetail>(`/sites/${siteId}/guides/${guideId}`).then(setGuide, (failure: Error) => setError(failure.message));
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [siteId, guideId, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/20" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Guide"
        className="flex h-full w-full max-w-xl flex-col gap-4 overflow-y-auto border-l bg-background p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl font-medium tracking-[-0.02em]">{guide?.question ?? "Guide"}</h2>
          <Button variant="secondary" onClick={onClose} autoFocus>
            Close
          </Button>
        </div>
        {error && <p className="text-base text-muted-foreground">{error}</p>}
        {guide && (
          <>
            <p className="text-sm text-muted-foreground">
              {OUTCOME_LABEL[guide.outcome]}
              {guide.helped !== null ? `, ${guide.helped ? "said it helped" : "said it did not help"}` : ""}, started on {guide.started_path}
              {guide.origin ? ` at ${guide.origin}` : ""}, {when(guide.started_at)}
            </p>
            {guide.cancelled_steps > 0 && (
              <p className="text-sm text-muted-foreground">
                {guide.cancelled_steps === 1 ? "One step was" : `${guide.cancelled_steps} steps were`} asked again because the page changed while Haptic was answering. Pages that load slowly after a click cause this.
              </p>
            )}
            <ol className="flex flex-col gap-3">
              {guide.steps.map((step) => (
                <li key={step.n} className={cn("flex flex-col gap-2 rounded-xl border bg-muted p-4")}>
                  <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                    <span>
                      Step {step.n + 1} on {step.path}
                    </span>
                    <span className="tabular-nums">pointer after {seconds(step.ms_to_target)}</span>
                  </div>
                  {step.event && <p className="text-sm text-muted-foreground">{step.strayed ? `Wrong click. ${step.event}` : step.event}</p>}
                  <p className="text-base">
                    {step.target_label ? (
                      <>
                        Pointed at <span className="font-medium">{step.target_label}</span>
                        {step.target_context ? <span className="text-muted-foreground"> in {step.target_context}</span> : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Pointed at nothing</span>
                    )}
                  </p>
                  <p className="w-fit max-w-full rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">{step.said}</p>
                  <PointHereInstead siteId={siteId} guideId={guideId} step={step.n} path={step.path} onSaved={(corrections) => onCorrected?.(corrections)} />
                </li>
              ))}
            </ol>
          </>
        )}
      </aside>
    </div>
  );
}
