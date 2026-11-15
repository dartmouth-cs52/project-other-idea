import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { docsThatFit, buildSystemPrompt } from "../server/prompt.ts";
import { listSiteIds, loadSite, saveSite } from "../server/sites.ts";
import { DEFAULT_APPEARANCE, type SiteContext, type SiteSource } from "../shared/types.ts";
import { crawlSite } from "./crawl.ts";
import { loadDocs } from "./docs.ts";

// Builds everything Haptic knows about a customer's site and prints the
// script tag they paste into it.
//
//   npm run tag -- --url https://app.acme.com --name Acme --notes notes.md --docs help/
//   npm run tag -- refresh site_ab12cd34ef     (or: refresh --all, for a cron job)

const HELP = `Usage:
  npm run tag -- --url <site url> [options]     Build a site's context and print its script tag
  npm run tag -- refresh <site id> | --all      Re-crawl and re-read docs for sites already built

Options:
  --url <url>          Where to start reading the site. Required.
  --name <name>        The product's name, as the guide should call it. Defaults to the home page's title.
  --notes <file>       A text file of notes about the product, in the company's own words.
  --docs <path|url>    A help doc: a file, a folder of files, or a URL. Repeat for more.
  --max-pages <n>      Most pages to read from the site. Default 30.
  --allow <origin>     Another origin the widget may run on, like a staging site. Repeat for more.
  --accent <hex>       Color of the pointer and its highlight. Default ${DEFAULT_APPEARANCE.accent}.
  --position <side>    bottom-right or bottom-left. Default bottom-right.
  --label <text>       Text on the launcher button. Default "${DEFAULT_APPEARANCE.launcherLabel}".
  --budget-hour <usd>  The most the site may spend on the model in an hour, in US dollars. Default: the server's.
  --budget-day <usd>   The same for a day.
  --visitor-steps <n>  Steps one visitor may take in a day. For a public demo. Default: no limit.
  --id <site id>       Use this id, or rebuild the site that has it, keeping what isn't given again.
  --host <url>         Where the Haptic server is reachable. Default $HAPTIC_PUBLIC_URL or http://localhost:4000.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string" },
    name: { type: "string" },
    notes: { type: "string" },
    docs: { type: "string", multiple: true },
    "max-pages": { type: "string" },
    allow: { type: "string", multiple: true },
    accent: { type: "string" },
    position: { type: "string" },
    label: { type: "string" },
    "budget-hour": { type: "string" },
    "budget-day": { type: "string" },
    "visitor-steps": { type: "string" },
    id: { type: "string" },
    host: { type: "string" },
    all: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const host = (values.host ?? process.env.HAPTIC_PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function scriptTag(site: SiteContext): string {
  return `<script src="${host}/widget.js" data-site="${site.id}" async></script>`;
}

/** Reads the site and the docs again from `source` and returns the updated context. */
async function build(base: SiteContext): Promise<SiteContext> {
  const { source } = base;
  console.log(`Reading ${source.url} (up to ${source.maxPages} pages)…`);
  const crawl = await crawlSite(source.url, source.maxPages);
  if (!crawl.pages.length) {
    const why = crawl.failed[0] ? ` ${crawl.failed[0].url}: ${crawl.failed[0].reason}` : "";
    throw new Error(`Couldn't read any page from ${source.url}.${why}`);
  }
  const notes = source.notesFile ? (await readFile(source.notesFile, "utf8")).trim() : base.notes;
  const docs = await loadDocs(source.docs);
  const site: SiteContext = { ...base, name: base.name || crawl.pages.find((page) => page.title)?.title || new URL(source.url).hostname, notes, docs, pages: crawl.pages, updatedAt: new Date().toISOString() };

  const links = site.pages.reduce((sum, page) => sum + page.links.length, 0);
  console.log(`  ${site.pages.length} pages, ${links} links between them, ${docs.length} help docs, ${notes.length} characters of notes.`);
  for (const { url, reason } of crawl.failed) console.warn(`  Couldn't read ${url}: ${reason}`);
  if (crawl.thin.length) {
    console.warn(
      `  ${crawl.thin.length} of ${site.pages.length} pages had almost nothing to click in their HTML (${crawl.thin.slice(0, 5).join(", ")}${crawl.thin.length > 5 ? ", …" : ""}).\n` +
        `  They're probably drawn by JavaScript or sit behind a login, which this reader can't see. The widget still reads each page live;\n` +
        `  notes and docs matter more for a site like this.`,
    );
  }
  const left = docs.filter((doc) => !docsThatFit(site).includes(doc));
  if (left.length) {
    console.warn(`  ${left.length} help docs don't fit in the prompt and won't be used: ${left.map((doc) => doc.source).join(", ")}.\n  Trim them or pass fewer. Looking docs up by question is the fix for this and isn't built yet.`);
  }
  console.log(`  The site knowledge sent with each question is about ${Math.round(buildSystemPrompt(site).length / 4).toLocaleString()} tokens.`);
  return site;
}

async function main() {
  if (values.help) return console.log(HELP);

  if (positionals[0] === "refresh") {
    const ids = values.all ? await listSiteIds() : positionals.slice(1);
    if (!ids.length) fail("Say which site to refresh: a site id, or --all.");
    // Refreshing re-reads a site as it is. A setting passed with it would be dropped without a word.
    const settings = Object.keys(values).filter((flag) => flag !== "all" && flag !== "host");
    if (settings.length) fail(`refresh changes no settings, so --${settings[0]} would be ignored. To change it: npm run tag -- --id <site id> --${settings[0]} …`);
    let failures = 0;
    for (const id of ids) {
      const site = await loadSite(id);
      if (!site) fail(`No site with the id ${id}.`);
      try {
        await saveSite(await build(site));
        console.log(`Refreshed ${id}.\n`);
      } catch (error) {
        // One unreachable site shouldn't stop the rest. Its old context stays in place.
        failures++;
        console.error(`Couldn't refresh ${id}, so it was left as it was: ${error instanceof Error ? error.message : error}\n`);
      }
    }
    process.exit(failures ? 1 : 0);
  }
  if (positionals.length) fail(`Unknown command "${positionals[0]}".\n\n${HELP}`);

  const existing = values.id ? await loadSite(values.id) : undefined;
  const url = values.url ?? existing?.source.url;
  if (!url) fail(`--url is required.\n\n${HELP}`);
  if (!URL.canParse(url)) fail(`"${url}" isn't a full URL. Include https://.`);
  if (values.accent && !/^#[0-9a-f]{6}$/i.test(values.accent)) fail(`--accent has to be a hex color like #5b5bd6, not "${values.accent}".`);
  if (values.position && values.position !== "bottom-right" && values.position !== "bottom-left") fail("--position is bottom-right or bottom-left.");
  const maxPages = Number(values["max-pages"] ?? existing?.source.maxPages ?? 30);
  if (!Number.isInteger(maxPages) || maxPages < 1) fail("--max-pages has to be a whole number, 1 or more.");

  const budget = { ...existing?.budget };
  for (const [flag, field] of [["budget-hour", "hour"], ["budget-day", "day"], ["visitor-steps", "perCaller"]] as const) {
    if (values[flag] === undefined) continue;
    const amount = Number(values[flag]);
    if (!(amount > 0) || (field === "perCaller" && !Number.isInteger(amount))) fail(`--${flag} has to be ${field === "perCaller" ? "a whole number" : "an amount"} above 0, not "${values[flag]}".`);
    budget[field] = amount;
  }

  const origin = new URL(url).origin;
  const source: SiteSource = { url, maxPages, docs: values.docs ?? existing?.source.docs ?? [] };
  const notesFile = values.notes ?? existing?.source.notesFile;
  if (notesFile) source.notesFile = notesFile;
  const now = new Date().toISOString();
  const base: SiteContext = {
    version: 1,
    id: values.id ?? `site_${randomBytes(6).toString("hex")}`,
    name: values.name ?? existing?.name ?? "",
    origin,
    allowedOrigins: [...new Set([origin, ...(values.allow ?? existing?.allowedOrigins ?? [])])],
    appearance: {
      accent: values.accent ?? existing?.appearance.accent ?? DEFAULT_APPEARANCE.accent,
      position: (values.position as "bottom-right" | "bottom-left" | undefined) ?? existing?.appearance.position ?? DEFAULT_APPEARANCE.position,
      launcherLabel: values.label ?? existing?.appearance.launcherLabel ?? DEFAULT_APPEARANCE.launcherLabel,
    },
    notes: existing?.notes ?? "",
    docs: [],
    pages: [],
    source,
    ...(existing?.off ? { off: true } : {}),
    ...(Object.keys(budget).length ? { budget } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const site = await build(base);
  const file = await saveSite(site);
  console.log(`\nSaved ${site.name} to ${file}`);
  console.log(`The widget will run on: ${site.allowedOrigins.join(", ")}`);
  console.log(`\nPaste this just before </body> on every page:\n\n${scriptTag(site)}\n`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
