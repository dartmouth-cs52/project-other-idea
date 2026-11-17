// How often questions repeat on a site, and how verified routes are doing.
// Shared by the dashboard (web/worker/insights.ts) and `npm run routes:report`.
// No imports, so the website's build can use it as it is.

/**
 * How often questions repeat on a site, and how well routes would do or did,
 * over guides started since $2. Shared by the dashboard and `npm run routes:report`.
 * - guides, repeated_guides: guides, and those whose question was asked before on the same page
 * - looked_up: steps a route was looked up for. repeats: of those, steps where a route was stored
 * - servable: steps where a trusted route matched exactly one control. agreed, disagreed: what the model did then (shadow)
 * - served, served_used: steps answered from a route, and those where the visitor then used the control
 * - served_ms, model_ms: median time until the pointer moved, for served steps and for steps the model answered
 */
export const ROUTE_METRICS_SQL = `
  with g as (select * from guides where site_id = $1 and started_at >= $2),
  s as (
    select s.*, next.strayed as next_strayed, next.n as next_n
    from steps s join g on g.id = s.guide_id
    left join steps next on next.guide_id = s.guide_id and next.n = s.n + 1
  )
  select
    (select count(*)::int from g) as guides,
    (select count(*)::int from g where exists (
      select 1 from guides e where e.site_id = g.site_id and e.question_key = g.question_key
        and e.started_path = g.started_path and e.started_at < g.started_at)) as repeated_guides,
    count(*) filter (where route is not null)::int as looked_up,
    count(*) filter (where route is not null and route <> 'miss')::int as repeats,
    count(*) filter (where route in ('agreed', 'disagreed', 'served'))::int as servable,
    count(*) filter (where route = 'agreed')::int as agreed,
    count(*) filter (where route = 'disagreed')::int as disagreed,
    count(*) filter (where route = 'served')::int as served,
    count(*) filter (where route = 'served' and next_n is not null and not next_strayed)::int as served_used,
    (percentile_cont(0.5) within group (order by ms_to_target) filter (where route = 'served'))::int as served_ms,
    (percentile_cont(0.5) within group (order by ms_to_target) filter (where route is distinct from 'served'))::int as model_ms,
    (select count(*)::int from routes where site_id = $1) as routes,
    (select count(*)::int from routes where site_id = $1 and confirmed) as trusted_routes
  from s`;

export interface RouteMetrics {
  guides: number;
  repeated_guides: number;
  looked_up: number;
  repeats: number;
  servable: number;
  agreed: number;
  disagreed: number;
  served: number;
  served_used: number;
  served_ms: number | null;
  model_ms: number | null;
  routes: number;
  trusted_routes: number;
}
