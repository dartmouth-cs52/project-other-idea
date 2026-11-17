import { spawnSync } from "node:child_process";
import { actingProblems } from "../server/acting.ts";
import { Store } from "../server/db.ts";
import { listSiteIds, loadSite } from "../server/sites.ts";
import { suggestionsProblem } from "../shared/suggestions.ts";
import type { SiteContext } from "../shared/types.ts";

// Copies site contexts from data/sites into Neon, which the online server reads.
// `npm run tag` builds a site on your machine. This is what makes it live.
//
//   npm run site:publish -- site_ab12cd34ef
//   npm run site:publish -- --all
//   npm run site:publish -- --from-kv site_joinhaptic
//
// It needs DATABASE_URL, the same connection string the server uses (in .env).
// --from-kv moves a site from the KV store sites were kept in before Neon,
// which needs the same Cloudflare sign-in as a deploy. The online server picks
// a change up within a minute, acting turned on or off included: it reads the
// site again for every step.
//
// A site published this way keeps the company it belongs to, if one has
// claimed it, and the allowed origins it is given here replace the old ones.

const args = process.argv.slice(2);
const fromKv = args.includes("--from-kv");
const asked = args.filter((arg) => !arg.startsWith("--"));

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to the Neon connection string first. It belongs in .env.");
  process.exit(1);
}
const store = new Store(process.env.DATABASE_URL);

const ids = !fromKv && args.includes("--all") ? await listSiteIds() : asked;
if (!ids.length) {
  console.error("Name the sites to publish, or pass --all.\n\n  npm run site:publish -- site_ab12cd34ef");
  process.exit(1);
}

// Every site is read and checked before any is published, so one with a mistake stops them all.
const sites: SiteContext[] = [];
for (const id of ids) {
  const site = fromKv ? readFromKv(id) : await loadSite(id);
  if (!site) {
    console.error(fromKv ? `There is no ${id} in the KV store.` : `There is no ${id} in data/sites. Build it first with npm run tag.`);
    process.exit(1);
  }
  // The server takes acting settings it cannot read as acting off, and says nothing. Saying it here is the only chance.
  // A site with acting plainly off always goes: that may be a company stopping it.
  const problems = site.acting?.enabled === false ? [] : actingProblems(site.acting);
  if (problems.length) {
    console.error(`Nothing was published, because of ${id}: ${problems.join(" ")}`);
    process.exit(1);
  }
  // Suggested questions are checked as the dashboard checks them. A file without any keeps the ones set in the dashboard.
  const wrong = suggestionsProblem(site.suggestions);
  if (wrong) {
    console.error(`Nothing was published, because of ${id}. ${wrong}`);
    process.exit(1);
  }
  sites.push(site);
}
for (const site of sites) {
  await store.saveSite(site);
  const acting = site.acting?.enabled === true ? ` Acting is on${site.acting.paths?.length ? ` under ${site.acting.paths.join(", ")}` : ""}.` : "";
  console.log(`Published ${site.id}${fromKv ? " from the KV store" : ""}.${acting}`);
}

function readFromKv(id: string): SiteContext | undefined {
  const result = spawnSync("npx", ["wrangler", "kv", "key", "get", "--binding", "SITES", "--remote", id], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
  try {
    return JSON.parse(result.stdout) as SiteContext;
  } catch {
    return undefined;
  }
}
