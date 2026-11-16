"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, OUTCOME_LABEL, type Correction, type FinishedList, type GroupGuide, type GuideDetail, type HealthGroup, type Insights } from "@/lib/app-api";
import { PointHereInstead } from "./guiding-rules";
import { Card, CardTitle, DoneMark, FailedCard, seconds, when } from "./parts";

const RANGES = [7, 30, 90];

/**
 * What a company's users asked and how each guide went. It leads with what
 * people can't find: questions grouped by meaning, ranked by how many
 * different people asked, with how many gave up and where. Those are what the
 * company can fix. Guide health follows, for guides that stopped finishing.
 */
export function InsightsView({ siteId, refreshKey, onCorrected }: { siteId: string; refreshKey: number; onCorrected?: (corrections: Correction[]) => void }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // Bumped by Try again, to ask once more without waiting for the next refresh.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api<Insights>(`/sites/${siteId}/insights?days=${days}`)
      .then((result) => live && (setData(result), setError(null)))
      .catch((failure: Error) => live && setError(failure.message));
    return () => {
      live = false;
    };
  }, [siteId, days, refreshKey, attempt]);

  if (error) {
    return (
      <FailedCard
        level={2}
        title="Couldn't load the questions"
        message={error}
        retry={() => {
          setError(null);
          setAttempt((count) => count + 1);
        }}
      />
    );
  }
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
      <CantFind siteId={siteId} days={days} rows={data.cantFind} ranges={ranges} onOpen={setOpen} />
      <GuideHealth groups={data.health} alerts={data.alerts} />

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

const percent = (share: number) => `${Math.round(share * 100)}%`;
const people = (count: number) => `${count.toLocaleString()} ${count === 1 ? "person" : "people"}`;

/** The lead. Each row is one question, however it was worded, counted by person, so one person asking ten times counts once. */
function CantFind({ siteId, days, rows, ranges, onOpen }: { siteId: string; days: number; rows: Insights["cantFind"]; ranges: ReactNode; onOpen: (guide: string) => void }) {
  const [shown, setShown] = useState<string | null>(null);
  return (
    <Card>
      <CardTitle aside={ranges}>What people can&apos;t find</CardTitle>
      {rows.length ? (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {rows.map((row) => {
            const gaveUp = (row.visitors - row.found) / row.visitors;
            return (
              <li key={row.key} className="flex flex-col gap-2 px-4 py-3">
                <p className="text-base">
                  {people(row.visitors)} asked &ldquo;{row.question}&rdquo;, and {percent(gaveUp)} gave up.
                </p>
                <div className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
                  <span className="h-2 rounded-full bg-secondary" aria-hidden>
                    <span className="block h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, (row.found / row.visitors) * 100)}%` }} />
                  </span>
                  <span className="tabular-nums text-muted-foreground">{percent(row.found / row.visitors)} got there</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {row.stoppedAt
                    ? `Most who gave up stopped at step ${row.stoppedAt.step} on ${row.stoppedAt.path}${row.stoppedAt.label ? `, at ${row.stoppedAt.label}` : ""}.`
                    : "Those who gave up got no first step."}{" "}
                  Asked {row.asked.toLocaleString()} {row.asked === 1 ? "time" : "times"} in all.
                </p>
                <Button variant="ghost" size="sm" className="self-start" onClick={() => setShown(shown === row.key ? null : row.key)} aria-expanded={shown === row.key}>
                  {shown === row.key ? "Hide the guides" : "See the guides"}
                </Button>
                {shown === row.key && <GroupGuides siteId={siteId} days={days} groupKey={row.key} onOpen={onOpen} />}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="max-w-[65ch] text-base leading-6 text-muted-foreground">
          Everyone who asked in the last {days} days got where they were going, as far as Haptic can tell.
        </p>
      )}
      <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
        Questions worded differently but with the same words that matter count as one. Gave up means Haptic had nothing to point at, went in a loop,
        ran out of steps, hit an error, was abandoned or stopped, or the person said it did not help. Questions left for a person or that had nothing
        to do with your product are not counted.
      </p>
    </Card>
  );
}

function GroupGuides({ siteId, days, groupKey, onOpen }: { siteId: string; days: number; groupKey: string; onOpen: (guide: string) => void }) {
  const [guides, setGuides] = useState<GroupGuide[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ guides: GroupGuide[] }>(`/sites/${siteId}/groups?key=${encodeURIComponent(groupKey)}&days=${days}`).then(
      (result) => (setGuides(result.guides), setError(null)),
      (failure: Error) => setError(failure.message),
    );
  }, [siteId, days, groupKey]);
  if (error) return <p className="text-sm text-muted-foreground">The guides didn&apos;t load. {error}</p>;
  if (!guides) return <p className="text-sm text-muted-foreground">Loading the guides</p>;
  return (
    <ul className="flex flex-col rounded-lg border">
      {guides.map((guide) => (
        <li key={guide.id}>
          <button type="button" onClick={() => onOpen(guide.id)} className="flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left text-sm hover:bg-muted sm:flex-row sm:justify-between sm:gap-4">
            <span className="min-w-0 truncate">{guide.question}</span>
            <span className="shrink-0 text-muted-foreground">{[OUTCOME_LABEL[guide.outcome], when(guide.started_at)].join(", ")}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Guides that used to finish and now don't, which is what a change to the
 * product looks like from here. Each flagged question says where its guides
 * now stop and which control they no longer point at.
 */
function GuideHealth({ groups, alerts }: { groups: HealthGroup[]; alerts: Insights["alerts"] }) {
  const flagged = groups.filter((group) => group.flag);
  const steady = groups.filter((group) => !group.flag && group.weeks.some((week) => week.ago === 0)).slice(0, 5);
  if (!flagged.length && !steady.length) return null;
  const rate = (group: HealthGroup, pick: (ago: number) => boolean) => {
    const weeks = group.weeks.filter((week) => pick(week.ago));
    const guides = weeks.reduce((sum, week) => sum + week.guides, 0);
    return guides ? weeks.reduce((sum, week) => sum + week.finished, 0) / guides : null;
  };
  return (
    <Card>
      <CardTitle>Guide health</CardTitle>
      {flagged.length ? (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {flagged.map((group) => {
            const flag = group.flag!;
            const alert = alerts.find((item) => item.key === group.key);
            return (
              <li key={group.key} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <p className="text-base">
                  &ldquo;{group.question}&rdquo; finished {percent(flag.before)} of the time in the three weeks before, and {percent(flag.now)} this week.
                </p>
                {flag.stop && (
                  <p className="text-muted-foreground">
                    Guides now stop at step {flag.stop.step} on {flag.stop.path}
                    {flag.stop.label ? `, at ${flag.stop.label}` : ""}.
                  </p>
                )}
                {flag.missing && (
                  <p className="text-muted-foreground">
                    Before, they pointed at <span className="font-medium text-foreground">{flag.missing.label}</span> on {flag.missing.path}, and no guide has this
                    week. It may have moved or been renamed. Open one of its guides and choose Point here instead to fix it.
                  </p>
                )}
                {alert && <p className="text-muted-foreground">{alert.emailed ? `We emailed your team about this ${when(alert.sent_at)}.` : `Flagged ${when(alert.sent_at)}.`}</p>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="max-w-[65ch] text-base leading-6 text-muted-foreground">Every common question finishes about as often as it did in the weeks before.</p>
      )}
      {steady.length > 0 && (
        <ul className="flex flex-col gap-2">
          {steady.map((group) => {
            const now = rate(group, (ago) => ago === 0);
            const before = rate(group, (ago) => ago >= 1 && ago <= 3);
            return (
              <li key={group.key} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="min-w-0 truncate">{group.question}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {now === null ? "" : `${percent(now)} finished this week`}
                  {before === null ? "" : `, ${percent(before)} before`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
        A question is flagged when at least five guides this week finished at least 20 points less often than in the three weeks before. When a common
        one is flagged, your team gets an email, at most once a fortnight for each question.
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
