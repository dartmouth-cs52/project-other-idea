import { spawnSync } from "node:child_process";

// The off switch for the online server. Switching a site off takes its
// launcher away and stops every model call for it, within a minute or two and
// with no deploy. Switching it on undoes that.
//
//   npm run site:off -- site_ab12cd34ef     one site
//   npm run site:off -- --all               every site
//   npm run site:on -- site_ab12cd34ef
//   npm run site:on -- --all
//
// "--all" is its own switch: `site:on -- --all` does not switch on a site that
// was switched off by name. It uses wrangler, so it needs the same Cloudflare
// sign-in as a deploy. On your own machine, HAPTIC_OFF=1 does the same.

const [turn, ...asked] = process.argv.slice(2);
const SITE_ID = /^site_[a-z0-9_]{3,40}$/;
const names = asked.map((name) => (name === "--all" ? "all" : name));
if ((turn !== "off" && turn !== "on") || !names.length || names.some((name) => name !== "all" && !SITE_ID.test(name))) {
  console.error("Say which site, or --all.\n\n  npm run site:off -- site_ab12cd34ef\n  npm run site:on -- --all");
  process.exit(1);
}

for (const name of names) {
  const key = `off:${name}`;
  const args = turn === "off" ? ["kv", "key", "put", "--binding", "SITES", "--remote", key, new Date().toISOString()] : ["kv", "key", "delete", "--binding", "SITES", "--remote", key];
  const result = spawnSync("npx", ["wrangler", ...args], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`${name === "all" ? "Every site" : name} is switched ${turn}. Allow a minute or two for it to take effect.`);
}
