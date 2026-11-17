import { neon } from "@neondatabase/serverless";
import { ROUTE_METRICS_SQL, type RouteMetrics } from "../server/routes.ts";

// How often questions repeat, and how verified routes are doing, for every
// site over the last few days. This is the number issue 13 says decides
// whether routes are worth serving: if questions rarely repeat on the same
// screen, there is little to gain.
//
//   npm run routes:report                 The last 7 days, every site with guides
//   npm run routes:report -- --days 30
//   npm run routes:report -- --site site_ab12cd34ef
//
// It reads the database in DATABASE_URL, over HTTPS.

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const days = Math.max(1, Number(option("days") ?? 7) || 7);
const only = option("site");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL to the database to read. It is in .env for your own machine.");
  process.exit(1);
}
const sql = neon(url);
const since = new Date(Date.now() - days * 86_400_000).toISOString();

const sites = only
  ? ((await sql`select id, name, routes_mode from sites where id = ${only}`) as { id: string; name: string; routes_mode: string }[])
  : ((await sql`
      select s.id, s.name, s.routes_mode from sites s
      where exists (select 1 from guides g where g.site_id = s.id and g.started_at >= ${since}) order by s.id`) as { id: string; name: string; routes_mode: string }[]);

if (!sites.length) {
  console.log(`No guides in the last ${days} days.`);
  process.exit(0);
}

const share = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "n/a");
const rows: Record<string, string | number>[] = [];
const total = { guides: 0, repeated: 0, lookedUp: 0, repeats: 0, servable: 0, agreed: 0, compared: 0 };

for (const site of sites) {
  const [m] = (await sql.query(ROUTE_METRICS_SQL, [site.id, since])) as RouteMetrics[];
  if (!m) continue;
  total.guides += m.guides;
  total.repeated += m.repeated_guides;
  total.lookedUp += m.looked_up;
  total.repeats += m.repeats;
  total.servable += m.servable;
  total.agreed += m.agreed;
  total.compared += m.agreed + m.disagreed;
  rows.push({
    site: site.id,
    mode: site.routes_mode,
    guides: m.guides,
    "question asked before": share(m.repeated_guides, m.guides),
    "steps looked up": m.looked_up,
    "had a route": share(m.repeats, m.looked_up),
    "could be served": share(m.servable, m.looked_up),
    "model agreed": share(m.agreed, m.agreed + m.disagreed),
    served: m.served,
    "used after served": share(m.served_used, m.served),
    "ms served / model": `${m.served_ms ?? "n/a"} / ${m.model_ms ?? "n/a"}`,
    "routes (trusted)": `${m.routes} (${m.trusted_routes})`,
  });
}

console.log(`Verified routes, last ${days} days\n`);
console.table(rows);
console.log(
  `\nAll sites: ${share(total.repeated, total.guides)} of ${total.guides} guides asked a question already asked on the same page. ` +
    `${share(total.repeats, total.lookedUp)} of ${total.lookedUp} steps had a route stored, ${share(total.servable, total.lookedUp)} had a trusted one that matched the page, ` +
    `and the model agreed with it ${share(total.agreed, total.compared)} of the time.`,
);
console.log(
  `\nHow to read it: "had a route" is the repeat rate that matters, the same question on the same screen at the same point. ` +
    `"could be served" is the share of steps that would skip the model. Turn serving on for a site once that share is worth having ` +
    `and the model agrees with its routes nearly every time.`,
);
