import { spawnSync } from "node:child_process";
import { listSiteIds, SITES_DIR } from "../server/sites.ts";

// Copies site contexts from data/sites to the store the online server reads.
// `npm run tag` builds a site on your machine. This is what makes it live.
//
//   npm run site:publish -- site_ab12cd34ef
//   npm run site:publish -- --all
//
// It uses wrangler, so it needs the same Cloudflare sign-in as a deploy.
// The online server picks a change up within a minute.

const asked = process.argv.slice(2);
const ids = asked.includes("--all") ? await listSiteIds() : asked;
if (!ids.length) {
  console.error("Name the sites to publish, or pass --all.\n\n  npm run site:publish -- site_ab12cd34ef");
  process.exit(1);
}
const known = await listSiteIds();
for (const id of ids) {
  if (!known.includes(id)) {
    console.error(`There is no ${id} in data/sites. Build it first with npm run tag.`);
    process.exit(1);
  }
  const result = spawnSync("npx", ["wrangler", "kv", "key", "put", "--binding", "SITES", "--remote", id, "--path", `${SITES_DIR}${id}.json`], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Published ${id}.`);
}
