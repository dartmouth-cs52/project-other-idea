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
import { cantFind, guideHealth } from "./health";

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

/**
 * `minutesWest` is the viewer's clock, as JavaScript's getTimezoneOffset gives it, so a day on the chart
 * starts at their midnight and not at UTC's.
 */
export async function insights(sql: Sql, site: string, days: number, minutesWest = 0) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  // The same length of time just before, for "against the 30 days before".
  const before = new Date(Date.now() - 2 * days * 86_400_000).toISOString();

  const [summary, previous, daily, outcomes, recent, abandonedAt, wrongClicks, cannotFind, health, alerts] = await Promise.all([
    sql.query(
      `select count(*)::int as guides,
        count(*) filter (where g.outcome = 'finished')::int as finished,
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
    sql.query(
      `select count(*)::int as guides,
        count(*) filter (where g.outcome = 'finished')::int as finished,
        count(*) filter (where ${UNANSWERED})::int as unanswered
      from guides g where g.site_id = $1 and g.started_at >= $2 and g.started_at < $3`,
      [site, before, since],
    ),
    // One row for each day that had a question. The page fills in the days that had none.
    sql.query(
      `select to_char((g.started_at at time zone 'UTC') - make_interval(mins => $3), 'YYYY-MM-DD') as day,
        count(*)::int as guides,
        count(*) filter (where g.outcome = 'finished')::int as finished,
        count(*) filter (where ${UNANSWERED})::int as unanswered
      from guides g where g.site_id = $1 and g.started_at >= $2 group by 1 order by 1`,
      [site, since, minutesWest],
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

  return { days, summary: summary[0], previous: previous[0], daily, outcomes, recent, abandonedAt, wrongClicks, cantFind: cannotFind, health, alerts };
}

/** How many of a site's newest questions the live list carries. */
const LIVE_SHOWN = 20;

/** A short mark that is the same for the same text, to tell the page when something changed. */
function markOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at++) hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193);
  return (hash >>> 0).toString(36);
}

/**
 * What is happening on a site right now: its newest questions, each with the
 * step it has reached. The dashboard asks for this every second or two while
 * it is open, so it is one query. `stamp` changes whenever anything about the
 * last day's questions does: a new one, a step, an ending, or an answer to
 * "Did this help?". The page asks for the heavier numbers again only then.
 */
export async function live(sql: Sql, site: string) {
  const rows = await sql.query(
    `select g.id, g.question, g.started_at, g.started_path, g.step_count, g.helped, ${OUTCOME} as outcome,
      coalesce(g.last_step_at, g.started_at) as moved_at,
      last.n as step, last.path, last.target_label, last.said, last.status,
      (select concat_ws(' ', count(*), count(a.outcome), count(a.helped), coalesce(sum(a.step_count), 0), coalesce(sum(a.cancelled_steps), 0), max(coalesce(a.last_step_at, a.started_at)))
        from guides a where a.site_id = $1 and a.started_at >= now() - interval '1 day') as day
    from guides g
    left join lateral (select s.n, s.path, s.target_label, s.said, s.status from steps s where s.guide_id = g.id order by s.n desc limit 1) last on true
    where g.site_id = $1 order by g.started_at desc limit ${LIVE_SHOWN}`,
    [site],
  );
  const guides = rows.map((row) => ({
    id: row.id as string,
    question: row.question as string,
    started_at: row.started_at as string,
    started_path: row.started_path as string,
    step_count: row.step_count as number,
    helped: row.helped as boolean | null,
    outcome: row.outcome as string,
    moved_at: row.moved_at as string,
    // The step it is on, or ended on. Null before the first answer comes back.
    last: row.step === null ? null : { n: row.step as number, path: row.path as string, target_label: row.target_label as string | null, said: row.said as string, status: row.status as string },
  }));
  return { stamp: markOf(JSON.stringify([rows[0]?.day ?? "", guides])), guides };
}

/**
 * Every site a company has, as its card on the list of sites shows it: whether
 * the script is running, the last week's questions, the last fortnight day by
 * day, and the newest question.
 */
export async function sitesOverview(sql: Sql, company: string, minutesWest = 0) {
  const [sites, days] = await Promise.all([
    sql.query(
      `select s.id, s.name, s.origin,
        exists (select 1 from site_origins o where o.site_id = s.id and o.origin = any(s.allowed_origins)) as connected,
        (select count(*)::int from guides g where g.site_id = s.id and g.started_at >= now() - interval '7 days') as guides,
        (select count(*)::int from guides g where g.site_id = s.id and g.started_at >= now() - interval '7 days' and g.outcome = 'finished') as finished,
        last.question as last_question, last.started_at as last_at, last.outcome as last_outcome
      from sites s
      left join lateral (select g.question, g.started_at, ${OUTCOME} as outcome from guides g where g.site_id = s.id order by g.started_at desc limit 1) last on true
      where s.company_id = $1 order by s.created_at`,
      [company],
    ),
    sql.query(
      `select g.site_id, to_char((g.started_at at time zone 'UTC') - make_interval(mins => $2), 'YYYY-MM-DD') as day, count(*)::int as guides
      from guides g join sites s on s.id = g.site_id
      where s.company_id = $1 and g.started_at >= now() - interval '14 days' group by 1, 2 order by 1, 2`,
      [company, minutesWest],
    ),
  ]);
  return {
    sites: sites.map((site) => ({
      id: site.id as string,
      name: site.name as string,
      origin: site.origin as string,
      connected: site.connected as boolean,
      guides: site.guides as number,
      finished: site.finished as number,
      last: site.last_question === null ? null : { question: site.last_question as string, started_at: site.last_at as string, outcome: site.last_outcome as string },
      daily: days.filter((row) => row.site_id === site.id).map((row) => ({ day: row.day as string, guides: row.guides as number })),
    })),
  };
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
