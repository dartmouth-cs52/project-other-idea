// The numbers on a site's dashboard, from the guides and steps the widget
// server records. Every query is limited to one site and a time window.
//
// What "unanswered" means: a guide that got stuck (nothing to point at, a loop,
// out of steps, an error), that was abandoned, or that the visitor said did not
// help. A visitor saying it helped always takes a guide off that list. Whether
// an answer was right cannot be known directly; this is the nearest honest proxy.

import type { Sql } from "./db";

/** A guide with no ending reported, and nothing new for this long, was abandoned. */
const ABANDONED_AFTER = "30 minutes";

/** One guide's outcome as the dashboard shows it, including the two the widget can't report: abandoned and under way. */
const OUTCOME = `case
  when g.outcome is not null then g.outcome
  when coalesce(g.last_step_at, g.started_at) < now() - interval '${ABANDONED_AFTER}' then 'abandoned'
  else 'under_way' end`;

const UNANSWERED = `(g.helped is distinct from true and (g.helped = false or (${OUTCOME}) in ('nothing_to_point_at', 'loop', 'step_limit', 'error', 'abandoned')))`;

export async function insights(sql: Sql, site: string, days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [summary, outcomes, unanswered, recent, abandonedAt, wrongClicks] = await Promise.all([
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
    // The headline: questions asked more than once that keep going unanswered. Each is something the company can fix.
    sql.query(
      `select g.question_key as key, (array_agg(g.question order by g.started_at desc))[1] as question,
        count(*)::int as asked, count(*) filter (where ${UNANSWERED})::int as unanswered, max(g.started_at) as last_asked,
        (array_agg(g.id order by g.started_at desc) filter (where ${UNANSWERED}))[1] as example
      from guides g where g.site_id = $1 and g.started_at >= $2
      group by g.question_key having count(*) filter (where ${UNANSWERED}) >= 2
      order by unanswered desc, asked desc limit 10`,
      [site, since],
    ),
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
  ]);

  return { days, summary: summary[0], outcomes, unanswered, recent, abandonedAt, wrongClicks };
}

export async function guideSteps(sql: Sql, site: string, guide: string) {
  if (!/^[0-9a-f-]{36}$/.test(guide)) return undefined;
  const rows = await sql.query(
    `select g.id, g.question, g.started_at, g.ended_at, g.started_path, g.origin, g.helped, ${OUTCOME} as outcome from guides g where g.id = $1 and g.site_id = $2`,
    [guide, site],
  );
  if (!rows[0]) return undefined;
  const steps = await sql`
    select n, path, target_role, target_label, target_context, said, status, event, strayed, ms, ms_to_target, created_at
    from steps where guide_id = ${guide} order by n`;
  return { ...rows[0], steps };
}
