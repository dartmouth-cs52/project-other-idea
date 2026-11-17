// The numbers on a site's dashboard, from the guides and steps the widget
// server records. Every query is limited to one site and a time window.
//
// What "unanswered" means: a guide that got stuck (nothing to point at, a loop,
// out of steps, an error), a question the help docs did not cover, one that was
// abandoned, or one the visitor said did not help. A visitor saying it helped
// always takes a guide off that list. Whether an answer was right cannot be
// known directly; this is the nearest honest proxy.
//
// A question left for a person (prices, refunds, the visitor's own account) and
// one that had nothing to do with the site are not counted: no change to the
// product or its help docs would have answered them.

import type { Sql } from "./db";
import { cantFind, COUNTED, guideHealth } from "./health";

/** A guide with no ending reported, and nothing new for this long, was abandoned. */
const ABANDONED_AFTER = "30 minutes";

/** One guide's outcome as the dashboard shows it, including the two the widget can't report: abandoned and under way. */
const OUTCOME = `case
  when g.outcome is not null then g.outcome
  when coalesce(g.last_step_at, g.started_at) < now() - interval '${ABANDONED_AFTER}' then 'abandoned'
  else 'under_way' end`;

const UNANSWERED = `(g.helped is distinct from true and (g.helped = false or (${OUTCOME}) in ('nothing_to_point_at', 'loop', 'step_limit', 'error', 'not_covered', 'abandoned')))`;

/**
 * The new cards need db/migrations/0011. Until it is applied they come back empty, and the rest of the
 * dashboard still loads, so a deploy that lands before the migration breaks nothing.
 */
async function untilMigrated<T>(what: string, query: Promise<T[]>): Promise<T[]> {
  try {
    return await query;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "42703" && code !== "42P01" && code !== "42883") throw error;
    console.error(`insights: ${what} needs db/migrations/0011, which isn't applied yet.`);
    return [];
  }
}

export async function insights(sql: Sql, site: string, days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [summary, outcomes, recent, abandonedAt, wrongClicks, cannotFind, health, alerts] = await Promise.all([
    sql.query(
      `select count(*)::int as guides,
        count(*) filter (where ${UNANSWERED})::int as unanswered,
        count(*) filter (where g.helped = true)::int as helped_yes,
        count(*) filter (where g.helped = false)::int as helped_no,
        (select percentile_cont(0.5) within group (order by s.ms_to_target)::int from steps s join guides g2 on g2.id = s.guide_id
          where g2.site_id = $1 and g2.started_at >= $2 and s.n = 0) as median_ms_to_pointer,
        (select percentile_cont(0.5) within group (order by g3.step_count)::float from guides g3
          where g3.site_id = $1 and g3.started_at >= $2 and g3.outcome = 'finished') as median_steps_finished
      from guides g where g.site_id = $1 and g.started_at >= $2`,
      [site, since],
    ),
    sql.query(`select ${OUTCOME} as outcome, count(*)::int as count from guides g where g.site_id = $1 and g.started_at >= $2 group by 1 order by 2 desc`, [site, since]),
    sql.query(
      `select g.id, g.question, g.started_at, g.started_path, g.origin, g.step_count, g.helped, ${OUTCOME} as outcome,
        (select count(*)::int from steps s where s.guide_id = g.id and s.strayed) as wrong_clicks,
        (select s.ms_to_target from steps s where s.guide_id = g.id and s.n = 0) as ms_to_pointer
      from guides g where g.site_id = $1 and g.started_at >= $2 order by g.started_at desc limit 100`,
      [site, since],
    ),
    // Where guides are given up on: the page and step each abandoned or stopped guide was last at.
    sql.query(
      `select last.path, last.n + 1 as step, last.target_label, count(*)::int as count
      from guides g
      join lateral (select s.path, s.n, s.target_label from steps s where s.guide_id = g.id order by s.n desc limit 1) last on true
      where g.site_id = $1 and g.started_at >= $2 and (${OUTCOME}) in ('abandoned', 'stopped')
      group by 1, 2, 3 order by count desc limit 8`,
      [site, since],
    ),
    // Wrong clicks per step: a step is marked when the visitor's next action was something other than what it pointed at.
    sql.query(
      `select pointed.path, pointed.target_label, count(*)::int as shown, count(*) filter (where next.strayed)::int as wrong
      from steps pointed
      join guides g on g.id = pointed.guide_id
      join steps next on next.guide_id = pointed.guide_id and next.n = pointed.n + 1
      where g.site_id = $1 and g.started_at >= $2 and pointed.target_label is not null
      group by 1, 2 having count(*) filter (where next.strayed) > 0
      order by wrong desc, shown desc limit 8`,
      [site, since],
    ),
    // The lead: what people asked and couldn't find, grouped by meaning and counted by person.
    untilMigrated("what people can't find", cantFind(sql, site, since)),
    // Groups whose guides stopped finishing, week over week, always over the last eight weeks.
    untilMigrated("guide health", guideHealth(sql, site)),
    untilMigrated(
      "health alerts",
      sql.query(`select question_group as key, max(sent_at) as sent_at, bool_or(emailed) as emailed from health_alerts where site_id = $1 and sent_at > now() - interval '30 days' group by 1`, [site]),
    ),
  ]);

  return { days, summary: summary[0], outcomes, recent, abandonedAt, wrongClicks, cantFind: cannotFind, health, alerts };
}

/** "2026-11" for the month a date falls in, in UTC. Bills are counted by UTC month. */
export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Every guide on a site that finished in one month, the guides billing will
 * count. Pricing promises each one is listed, so there is no cap short of
 * MAX_FINISHED_LISTED, far above what any plan includes.
 */
export async function finishedGuides(sql: Sql, site: string, month: string) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const rows = (await sql.query(
    `select g.id, g.question, g.started_at, g.ended_at, g.started_path, g.origin, g.step_count
    from guides g where g.site_id = $1 and g.outcome = 'finished' and g.ended_at >= $2 and g.ended_at < $3
    order by g.ended_at desc limit ${MAX_FINISHED_LISTED + 1}`,
    [site, start.toISOString(), end.toISOString()],
  )) as { id: string; question: string; started_at: string; ended_at: string; started_path: string; origin: string | null; step_count: number }[];
  return { month, count: Math.min(rows.length, MAX_FINISHED_LISTED), more: rows.length > MAX_FINISHED_LISTED, guides: rows.slice(0, MAX_FINISHED_LISTED) };
}

const MAX_FINISHED_LISTED = 50_000;

/** The same list as a spreadsheet file, one guide per row. */
export function finishedCsv(list: Awaited<ReturnType<typeof finishedGuides>>): string {
  const cell = (value: unknown) => {
    // Times come from the database as Date objects. A spreadsheet sorts the ISO form correctly.
    const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
    // Quote every cell, double any quote inside, and stop a spreadsheet reading a question as a formula.
    return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
  };
  const lines = [["finished_at", "question", "started_on", "origin", "steps", "guide_id"].map(cell).join(",")];
  for (const guide of list.guides) lines.push([guide.ended_at, guide.question, guide.started_path, guide.origin, guide.step_count, guide.id].map(cell).join(","));
  return lines.join("\r\n") + "\r\n";
}

export async function guideSteps(sql: Sql, site: string, guide: string) {
  if (!/^[0-9a-f-]{36}$/.test(guide)) return undefined;
  const rows = await sql.query(
    `select g.id, g.question, g.started_at, g.ended_at, g.started_path, g.origin, g.helped,
      coalesce((to_jsonb(g)->>'cancelled_steps')::int, 0) as cancelled_steps, ${OUTCOME} as outcome from guides g where g.id = $1 and g.site_id = $2`,
    [guide, site],
  );
  if (!rows[0]) return undefined;
  const steps = await sql`
    select n, path, target_role, target_label, target_context, said, status, event, strayed, ms, ms_to_target, created_at
    from steps where guide_id = ${guide} order by n`;
  return { ...rows[0], steps };
}

// The top of the dashboard --------------------------------------------------

const DAY_MS = 86_400_000;

/** One range's numbers. Guides finished are counted by when they finished, as billing counts them. The rest by when they started. */
export interface HeadlinePeriod {
  /** Guides that finished in the range: the number billing counts. */
  finished: number;
  /** Questions asked in the range. */
  started: number;
  /** Of those, the ones that could have finished: not still under way, not left for a person, not off topic, not ruled out. */
  counted: number;
  /** Of those, the ones that finished. Finish rate is this over `counted`. */
  countedFinished: number;
  /** Questions Haptic couldn't guide, as "unanswered" is defined at the top of this file. */
  unguided: number;
  /** From the question to the last step, at the median, for guides that finished in the range. */
  medianMsToFinish: number | null;
}

export interface Headline {
  days: number;
  /** Whether anyone has ever asked anything on this site. False shows what will appear, not zeros. */
  asked: boolean;
  now: HeadlinePeriod;
  /** The same number of days just before. */
  before: HeadlinePeriod;
  /** Each day of the range, oldest first, in UTC: guides started, and guides finished that day. */
  daily: { day: string; started: number; finished: number }[];
}

/** One range's columns, for `from` <= time < `to`. A guide that finished in range may have started up to a day before it. */
function periodColumns(suffix: string, from: string, to: string | null): string {
  const startedIn = `g.started_at >= ${from}${to ? ` and g.started_at < ${to}` : ""}`;
  const endedIn = `g.ended_at >= ${from}${to ? ` and g.ended_at < ${to}` : ""}`;
  return `count(*) filter (where g.outcome = 'finished' and ${endedIn})::int as finished${suffix},
    count(*) filter (where ${startedIn})::int as started${suffix},
    count(*) filter (where ${startedIn} and ${COUNTED})::int as counted${suffix},
    count(*) filter (where ${startedIn} and ${COUNTED} and g.outcome = 'finished')::int as counted_finished${suffix},
    count(*) filter (where ${startedIn} and ${UNANSWERED})::int as unguided${suffix},
    percentile_cont(0.5) within group (order by extract(epoch from (g.ended_at - g.started_at)) * 1000)
      filter (where g.outcome = 'finished' and ${endedIn}) as median_ms${suffix}`;
}

/**
 * The four numbers at the top of a site's dashboard for the last `days` days,
 * the same four for the days before, and a count of guides started and finished
 * for each day. Two queries, both limited to one site and the two ranges.
 *
 * A range is whole UTC days, today being the last and so far, the same days
 * the chart has a bar for, so the bars add up to the numbers above them.
 */
export async function headline(sql: Sql, site: string, days: number): Promise<Headline> {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(today - (days - 1) * DAY_MS).toISOString();
  const before = new Date(today - (2 * days - 1) * DAY_MS).toISOString();
  const [totals, daily] = await Promise.all([
    sql.query(
      `select ${periodColumns("", "$2::timestamptz", null)},
        ${periodColumns("_before", "$3::timestamptz", "$2::timestamptz")},
        exists (select 1 from guides a where a.site_id = $1) as asked
      from guides g where g.site_id = $1 and g.started_at >= $3::timestamptz - interval '1 day'`,
      [site, since, before],
    ),
    sql.query(
      `with days as (
        select generate_series(date_trunc('day', now() at time zone 'utc') - make_interval(days => $2::int - 1), date_trunc('day', now() at time zone 'utc'), interval '1 day') as day
      ),
      started as (
        select date_trunc('day', g.started_at at time zone 'utc') as day, count(*)::int as n
        from guides g where g.site_id = $1 and g.started_at >= $3::timestamptz group by 1
      ),
      finished as (
        -- The same guides the tiles count as finished: started no earlier than theirs, a day before the range before.
        select date_trunc('day', g.ended_at at time zone 'utc') as day, count(*)::int as n
        from guides g where g.site_id = $1 and g.outcome = 'finished' and g.ended_at >= $3::timestamptz
          and g.started_at >= $4::timestamptz - interval '1 day' group by 1
      )
      select to_char(days.day, 'YYYY-MM-DD') as day, coalesce(started.n, 0) as started, coalesce(finished.n, 0) as finished
      from days left join started on started.day = days.day left join finished on finished.day = days.day
      order by days.day`,
      [site, days, since, before],
    ),
  ]);
  const row = (totals[0] ?? {}) as Record<string, number | boolean | null>;
  const period = (suffix: string): HeadlinePeriod => {
    const median = row[`median_ms${suffix}`];
    return {
      finished: Number(row[`finished${suffix}`] ?? 0),
      started: Number(row[`started${suffix}`] ?? 0),
      counted: Number(row[`counted${suffix}`] ?? 0),
      countedFinished: Number(row[`counted_finished${suffix}`] ?? 0),
      unguided: Number(row[`unguided${suffix}`] ?? 0),
      medianMsToFinish: median === null || median === undefined ? null : Math.round(Number(median)),
    };
  };
  return {
    days,
    asked: row.asked === true,
    now: period(""),
    before: period("_before"),
    daily: (daily as { day: string; started: number; finished: number }[]).map((item) => ({ day: item.day, started: Number(item.started), finished: Number(item.finished) })),
  };
}
