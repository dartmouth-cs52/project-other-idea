import { spawnSync } from "node:child_process";
import { Store } from "../server/db.ts";
import { listSiteIds, loadSite } from "../server/sites.ts";
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
// a change up within a minute.
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

for (const id of ids) {
  const site = fromKv ? readFromKv(id) : await loadSite(id);
  if (!site) {
    console.error(fromKv ? `There is no ${id} in the KV store.` : `There is no ${id} in data/sites. Build it first with npm run tag.`);
    process.exit(1);
  }
  await store.saveSite(site);
  console.log(`Published ${id}${fromKv ? " from the KV store" : ""}.`);
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
