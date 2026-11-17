"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type GroupGuide, type HealthGroup, type Insights } from "@/lib/app-api";
import { ShareBar } from "./chart";
import { GuideStatus, Panel, PanelEmpty, when } from "./parts";

const percent = (share: number) => `${Math.round(share * 100)}%`;
const people = (count: number) => `${count.toLocaleString()} ${count === 1 ? "person" : "people"}`;

/**
 * What the company can fix. It leads with what people can't find: questions
 * grouped by meaning, ranked by how many different people asked, with how many
 * gave up and where. Guide health follows, for guides that stopped finishing,
 * then the steps where guides are left and the controls people click past.
 */
export function Gaps({ siteId, data, onOpen }: { siteId: string; data: Insights | null; onOpen: (guide: string) => void }) {
  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  return (
    <>
      <CantFind siteId={siteId} days={data.days} rows={data.cantFind} onOpen={onOpen} />
      <GuideHealth groups={data.health} alerts={data.alerts} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel title="Where people give up">
          {data.abandonedAt.length ? (
            <ul className="flex flex-col divide-y border-t">
              {data.abandonedAt.map((row) => (
                <li key={`${row.path} ${row.step} ${row.target_label}`} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{row.path}</span>
                    <span className="text-muted-foreground">
                      , step {row.step}
                      {row.target_label ? `, at ${row.target_label}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">{row.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <PanelEmpty>No guide has been abandoned or stopped.</PanelEmpty>
          )}
        </Panel>
        <Panel title="Steps people click past">
          {data.wrongClicks.length ? (
            <ul className="flex flex-col divide-y border-t">
              {data.wrongClicks.map((row) => (
                <li key={`${row.path} ${row.target_label}`} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{row.target_label}</span>
                    <span className="text-muted-foreground"> on {row.path}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {row.wrong} of {row.shown} clicked something else
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <PanelEmpty>No wrong clicks yet.</PanelEmpty>
          )}
        </Panel>
      </div>
    </>
  );
}

/** The lead. Each row is one question, however it was worded, counted by person, so one person asking ten times counts once. */
function CantFind({ siteId, days, rows, onOpen }: { siteId: string; days: number; rows: Insights["cantFind"]; onOpen: (guide: string) => void }) {
  const [shown, setShown] = useState<string | null>(null);
  return (
    <Panel
      title="What people can't find"
      foot="Questions worded differently but with the same words that matter count as one. Gave up means Haptic had nothing to point at, went in a loop, ran out of steps, hit an error, was abandoned or stopped, or the person said it did not help. Questions left for a person or that had nothing to do with your product are not counted."
    >
      {rows.length ? (
        <ul className="flex flex-col divide-y border-t">
          {rows.map((row) => {
            const gaveUp = (row.visitors - row.found) / row.visitors;
            return (
              <li key={row.key} className="flex flex-col gap-2 px-5 py-4">
                <div className="grid items-center gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_8rem_9rem]">
                  <span className="min-w-0">
                    <span className="font-medium">&ldquo;{row.question}&rdquo;</span>
                    <span className="text-muted-foreground">, asked by {people(row.visitors)}</span>
                  </span>
                  <ShareBar share={row.found / row.visitors} />
                  <span className="text-muted-foreground tabular-nums sm:text-right">{percent(gaveUp)} gave up</span>
                </div>
                <p className="text-sm leading-5 text-muted-foreground">
                  {row.stoppedAt
                    ? `Most who gave up stopped at step ${row.stoppedAt.step} on ${row.stoppedAt.path}${row.stoppedAt.label ? `, at ${row.stoppedAt.label}` : ""}.`
                    : "Those who gave up got no first step."}{" "}
                  Asked {row.asked.toLocaleString()} {row.asked === 1 ? "time" : "times"} in all.
                </p>
                <Button variant="secondary" size="sm" className="self-start" onClick={() => setShown(shown === row.key ? null : row.key)} aria-expanded={shown === row.key}>
                  {shown === row.key ? "Hide the guides" : "See the guides"}
                </Button>
                {shown === row.key && <GroupGuides siteId={siteId} days={days} groupKey={row.key} onOpen={onOpen} />}
              </li>
            );
          })}
        </ul>
      ) : (
        <PanelEmpty>Everyone who asked in the last {days} days got where they were going, as far as Haptic can tell.</PanelEmpty>
      )}
    </Panel>
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
    <ul className="flex flex-col rounded-lg border p-1">
      {guides.map((guide) => (
        <li key={guide.id}>
          <button
            type="button"
            onClick={() => onOpen(guide.id)}
            className="flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:justify-between sm:gap-4"
          >
            <span className="min-w-0 truncate">{guide.question}</span>
            <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
              <GuideStatus outcome={guide.outcome} helped={guide.helped} step={guide.step_count ? guide.step_count - 1 : null} />, {when(guide.started_at)}
            </span>
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
    <Panel
      title="Guide health"
      foot="A question is flagged when at least five guides this week finished at least 20 points less often than in the three weeks before. When a common one is flagged, your team gets an email, at most once a fortnight for each question."
    >
      {flagged.length ? (
        <ul className="flex flex-col divide-y border-t">
          {flagged.map((group) => {
            const flag = group.flag!;
            const alert = alerts.find((item) => item.key === group.key);
            return (
              <li key={group.key} className="flex flex-col gap-1 px-5 py-4 text-sm leading-5">
                <p>
                  <span className="font-medium">&ldquo;{group.question}&rdquo;</span> finished {percent(flag.before)} of the time in the three weeks before, and {percent(flag.now)} this week.
                </p>
                {flag.stop && (
                  <p className="text-muted-foreground">
                    Guides now stop at step {flag.stop.step} on {flag.stop.path}
                    {flag.stop.label ? `, at ${flag.stop.label}` : ""}.
                  </p>
                )}
                {flag.missing && (
                  <p className="text-muted-foreground">
                    Before, they pointed at <span className="font-medium text-foreground">{flag.missing.label}</span> on {flag.missing.path}, and no guide has this week. It may have moved or been
                    renamed. Open one of its guides and choose Point here instead to fix it.
                  </p>
                )}
                {alert && <p className="text-muted-foreground">{alert.emailed ? `We emailed your team about this ${when(alert.sent_at)}.` : `Flagged ${when(alert.sent_at)}.`}</p>}
              </li>
            );
          })}
        </ul>
      ) : (
        <PanelEmpty>Every common question finishes about as often as it did in the weeks before.</PanelEmpty>
      )}
      {steady.length > 0 && (
        <ul className="flex flex-col divide-y border-t">
          {steady.map((group) => {
            const now = rate(group, (ago) => ago === 0);
            const before = rate(group, (ago) => ago >= 1 && ago <= 3);
            return (
              <li key={group.key} className="flex flex-col gap-1 px-5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="min-w-0 truncate">{group.question}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {now === null ? "" : `${percent(now)} finished this week`}
                  {before === null ? "" : `, ${percent(before)} before`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
