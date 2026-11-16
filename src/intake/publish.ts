import { spawnSync } from "node:child_process";
import { actingProblems } from "../server/acting.ts";
import { listSiteIds, loadSite, SITES_DIR } from "../server/sites.ts";

// Copies site contexts from data/sites to the store the online server reads.
// `npm run tag` builds a site on your machine. This is what makes it live.
//
//   npm run site:publish -- site_ab12cd34ef
//   npm run site:publish -- --all
//
// It uses wrangler, so it needs the same Cloudflare sign-in as a deploy.
// The online server picks a change up within a minute, acting turned on or
// off included: it reads the site again for every step.

const asked = process.argv.slice(2);
const ids = asked.includes("--all") ? await listSiteIds() : asked;
if (!ids.length) {
  console.error("Name the sites to publish, or pass --all.\n\n  npm run site:publish -- site_ab12cd34ef");
  process.exit(1);
}
const known = await listSiteIds();
const sites = [];
for (const id of ids) {
  if (!known.includes(id)) {
    console.error(`There is no ${id} in data/sites. Build it first with npm run tag.`);
    process.exit(1);
  }
  // The server takes acting settings it cannot read as acting off, and says nothing. Saying it here is the only chance.
  // A site with acting plainly off always goes: that may be a company stopping it.
  const site = await loadSite(id);
  const problems = site?.acting?.enabled === false ? [] : actingProblems(site?.acting);
  if (!site || problems.length) {
    console.error(`Nothing was published, because of ${id}: ${site ? problems.join(" ") : "its file can't be read."}`);
    process.exit(1);
  }
  sites.push(site);
}
for (const site of sites) {
  const result = spawnSync("npx", ["wrangler", "kv", "key", "put", "--binding", "SITES", "--remote", site.id, "--path", `${SITES_DIR}${site.id}.json`], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const acting = site.acting?.enabled === true ? ` Acting is on${site.acting.paths?.length ? ` under ${site.acting.paths.join(", ")}` : ""}.` : "";
  console.log(`Published ${site.id}.${acting}`);
}
