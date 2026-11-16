import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { actingProblems } from "../server/acting.ts";
import { webhookAllowed } from "../server/handoff.ts";
import { buildSystemPrompt, docsThatFit, renderSiteMap } from "../server/prompt.ts";
import { listSiteIds, loadSite, saveSite } from "../server/sites.ts";
import { DEFAULT_APPEARANCE, type SiteContext, type SiteSource } from "../shared/types.ts";
import { browseSite, canBrowse, MAP_BUDGET } from "./browse.ts";
import { crawlSite, type CrawlResult } from "./crawl.ts";
import { loadDocs } from "./docs.ts";

// Builds everything Haptic knows about a customer's site and prints the
// script tag they paste into it.
//
//   npm run tag -- --url https://app.acme.com --name Acme --notes notes.md --docs help/
//   npm run tag -- --url https://app.acme.com --session signed-in.json
//   npm run tag -- refresh site_ab12cd34ef     (or: refresh --all, for a cron job)
//   npm run tag -- acting site_ab12cd34ef on  (or off: "do it with me", without reading the site again)

const HELP = `Usage:
  npm run tag -- --url <site url> [options]     Build a site's context and print its script tag
  npm run tag -- refresh <site id> | --all      Re-crawl and re-read docs for sites already built
  npm run tag -- acting <site id> on|off        Let Haptic use the page's controls when a visitor presses
                                                Do it, or stop it, without reading the site again.
                                                Publish the site afterwards for it to take effect.

Options:
  --url <url>          Where to start reading the site. Required.
  --name <name>        The product's name, as the guide should call it. Defaults to the home page's title.
  --notes <file>       A text file of notes about the product, in the company's own words.
  --docs <path|url>    A help doc: a file, a folder of files, or a URL. Repeat for more.
  --max-pages <n>      Most pages to read from the site. Default 30.
  --reader <how>       browser: load each page in a browser and read it once it has drawn, as the widget
                       does. text: read the HTML the server sends, which is empty for apps drawn by
                       JavaScript. Default browser when Playwright is installed, otherwise text.
  --session <file>     A signed-in session for the browser reader, so it can read pages behind a sign-in:
                       cookies and storage in Playwright's storage-state format. Not kept in the site file.
  --max-depth <n>      How many links away from the start the browser reader goes. Default 3.
  --pace <ms>          Least time between two page loads. Default 1500.
  --skip <pattern>     Leave alone pages whose address or link text matches this. Repeat for more.
  --within <path>      Stay inside this path, like /app/. Repeat for more.
  --also <url>         Another page to start reading from. Repeat for more.
  --hide <words>       Keep these words out of the map, like the name of the account in --session.
                       Repeat for more. Not kept in the site file: give it again on refresh.
  --allow <origin>     Another origin the widget may run on, like a staging site. Repeat for more.
  --accent <hex>       Color of the pointer and its highlight. Default ${DEFAULT_APPEARANCE.accent}.
  --position <side>    bottom-right or bottom-left. Default bottom-right.
  --label <text>       Text on the launcher button. Default "${DEFAULT_APPEARANCE.launcherLabel}".
  --answers <on|off>   Answers: reply in words from the help docs as well as pointing. Off by default.
  --stale-days <n>     With Answers on, mark an answer from an article older than this as possibly out of date.
  --handoff-webhook <url>    When Haptic can't help, the widget offers a short form (an email address and a note).
                             It is posted here as JSON, with the conversation and the page. An https address of yours.
  --handoff-secret <text>    Sign each post with this, in an X-Haptic-Signature header.
  --handoff-url <url>        Open this page instead, like your contact form.
  --handoff-email <address>  Or open the visitor's mail program, writing to this address.
  --handoff-label <text>     The words on the button. Default "Contact support".
  --budget-hour <usd>  The most the site may spend on the model in an hour, in US dollars. Default: the server's.
  --budget-day <usd>   The same for a day.
  --visitor-steps <n>  Steps one visitor may take in a day. For a public demo. Default: no limit.
  --acting <on|off>    "Do it with me": Haptic uses the page's controls itself when a visitor presses Do it,
                       and always leaves the click that saves, sends or pays to them. Default off. Where it
                       may act (acting.paths) and the company's own commit words (acting.commitWords) are
                       set in the site file and kept when the site is built again.
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
    reader: { type: "string" },
    session: { type: "string" },
    "max-depth": { type: "string" },
    pace: { type: "string" },
    skip: { type: "string", multiple: true },
    within: { type: "string", multiple: true },
    also: { type: "string", multiple: true },
    hide: { type: "string", multiple: true },
    allow: { type: "string", multiple: true },
    accent: { type: "string" },
    position: { type: "string" },
    label: { type: "string" },
    "handoff-webhook": { type: "string" },
    "handoff-secret": { type: "string" },
    "handoff-url": { type: "string" },
    "handoff-email": { type: "string" },
    "handoff-label": { type: "string" },
    answers: { type: "string" },
    "stale-days": { type: "string" },
    "budget-hour": { type: "string" },
    "budget-day": { type: "string" },
    "visitor-steps": { type: "string" },
    acting: { type: "string" },
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

/** Whether "on" or "off" was given, or undefined when nothing was. */
function onOrOff(given: string | undefined, what: string): boolean | undefined {
  if (given === undefined) return undefined;
  if (given !== "on" && given !== "off") fail(`${what} is on or off, not "${given}".`);
  return given === "on";
}

/**
 * The site's acting switched on or off. Its other settings stay, so switching
 * it back on acts where it did before. Off is never refused: it is how a
 * company stops acting at once, and the server reads nothing else of a site
 * with acting off.
 */
function switchActing(site: SiteContext, on: boolean): SiteContext["acting"] {
  const kept = site.acting && typeof site.acting === "object" && !Array.isArray(site.acting) ? site.acting : undefined;
  const problems = actingProblems({ ...kept, enabled: on });
  if (on && problems.length) fail(`Acting was left off for ${site.id}, because its settings in the site file can't be read: ${problems.join(" ")}`);
  return { ...kept, enabled: on };
}

/** One line on whether and where Haptic may act on the site. */
function actingLine(site: SiteContext): string {
  if (site.acting?.enabled !== true) return "Acting is off: Haptic only points.";
  const paths = site.acting.paths?.filter((path) => path.trim()) ?? [];
  const where = paths.length ? `only on pages under ${paths.join(", ")}` : "anywhere on its allowed origins";
  return `Acting is on: when a visitor presses Do it, Haptic uses the controls itself ${where}, and leaves the click that commits to them.`;
}

const pace = Number(values.pace ?? 1500);

/** Reads the site's pages the way `source` says, in a browser unless it says otherwise or there is none. */
async function readPages(source: SiteSource): Promise<CrawlResult> {
  if (source.reader !== "text" && !canBrowse()) {
    if (source.reader === "browser") throw new Error("The browser reader needs Playwright: npm install --no-save playwright && npx playwright install chromium");
    console.warn("Playwright or its browser isn't installed, so pages are read as the HTML the server sends. Pages drawn by JavaScript will come back empty.");
    source.reader = "text";
  }
  if (source.reader === "text") {
    console.log(`Reading ${source.url} as HTML (up to ${source.maxPages} pages)…`);
    return crawlSite(source.url, source.maxPages);
  }
  source.reader = "browser";
  const maxDepth = source.maxDepth ?? 3;
  console.log(`Reading ${source.url} in a browser (up to ${source.maxPages} pages, ${maxDepth} links deep${values.session ? ", signed in" : ""})…`);
  const crawl = await browseSite(source.url, {
    maxPages: source.maxPages,
    maxDepth,
    paceMs: pace,
    ...(values.session ? { session: values.session } : {}),
    skip: (source.skip ?? []).map((pattern) => new RegExp(pattern, "i")),
    within: source.within ?? [],
    also: source.also ?? [],
    hide: values.hide ?? [],
    onPage: (path, done) => console.log(`  ${String(done).padStart(3)} ${path}`),
  });
  const reasons = new Map<string, number>();
  for (const { reason } of crawl.skipped) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  if (crawl.skipped.length) console.log(`  Left ${crawl.skipped.length} links alone: ${[...reasons].map(([reason, count]) => `${count} because ${reason}`).join("; ")}.`);
  if (crawl.signInWalls.length) {
    console.warn(`  ${crawl.signInWalls.length} pages sent the reader to a sign-in page (${crawl.signInWalls.slice(0, 3).join(", ")}${crawl.signInWalls.length > 3 ? ", …" : ""}). Pass --session to read them signed in.`);
  }
  if (crawl.cut.length) console.log(`  Left ${crawl.cut.length} of the farthest pages out of the map to keep it under ${MAP_BUDGET.toLocaleString()} characters: ${crawl.cut.join(", ")}.`);
  return crawl;
}

/** Reads the site and the docs again from `source` and returns the updated context. */
async function build(base: SiteContext): Promise<SiteContext> {
  const { source } = base;
  const crawl = await readPages(source);
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
  if (crawl.thin.length && source.reader === "text") {
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
  if (site.answers?.enabled) {
    const linked = docs.filter((doc) => doc.url).length;
    const dated = docs.filter((doc) => doc.updated).length;
    console.log(`  Answers is on. ${linked} of ${docs.length} help docs have an address to link to, and ${dated} have a date.`);
    if (!docs.length) console.warn("  There are no help docs, so nothing can be answered in words. Haptic will still point, and say when it can't help.");
    // "That needs an answer from a person" with no way to reach one is a dead end.
    if (!site.handoff?.webhook && !site.handoff?.url && !site.handoff?.email) {
      console.warn("  There is no way to a person set, so when Haptic can't help it will say so and offer nothing.\n  Set one with --handoff-webhook, --handoff-url or --handoff-email before this goes in front of visitors.");
    }
  }
  const mapChars = site.pages.length ? renderSiteMap(site.pages).length : 0;
  console.log(`  The site map is ${mapChars.toLocaleString()} characters. The site knowledge sent with each question is about ${Math.round(buildSystemPrompt(site).length / 4).toLocaleString()} tokens.`);
  return site;
}

async function main() {
  if (values.help) return console.log(HELP);

  if (positionals[0] === "refresh") {
    const ids = values.all ? await listSiteIds() : positionals.slice(1);
    if (!ids.length) fail("Say which site to refresh: a site id, or --all.");
    // Refreshing re-reads a site as it is. A setting passed with it would be dropped without a word. How it is
    // read this time (signed in, the words to keep out of the map, the pace) is not kept, so it is given again here.
    const settings = Object.keys(values).filter((flag) => !["all", "host", "session", "hide", "pace"].includes(flag));
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
  if (positionals[0] === "acting") {
    const [, id, state] = positionals;
    if (!id || positionals.length !== 3) fail("Say which site, and on or off: npm run tag -- acting site_ab12cd34ef on");
    const on = onOrOff(state, "Acting");
    const site = await loadSite(id);
    if (!site) fail(`No site with the id ${id}.`);
    site.acting = switchActing(site, on === true);
    site.updatedAt = new Date().toISOString();
    await saveSite(site);
    console.log(`${actingLine(site)}\nThe online server reads it once it is published: npm run site:publish -- ${site.id}`);
    return;
  }
  if (positionals.length) fail(`Unknown command "${positionals[0]}".\n\n${HELP}`);

  const existing = values.id ? await loadSite(values.id) : undefined;
  const url = values.url ?? existing?.source.url;
  if (!url) fail(`--url is required.\n\n${HELP}`);
  if (!URL.canParse(url)) fail(`"${url}" isn't a full URL. Include https://.`);
  if (values.accent && !/^#[0-9a-f]{6}$/i.test(values.accent)) fail(`--accent has to be a hex color like #5b5bd6, not "${values.accent}".`);
  if (values.position && values.position !== "bottom-right" && values.position !== "bottom-left") fail("--position is bottom-right or bottom-left.");
  const actingOn = onOrOff(values.acting, "--acting");
  const maxPages = Number(values["max-pages"] ?? existing?.source.maxPages ?? 30);
  if (!Number.isInteger(maxPages) || maxPages < 1) fail("--max-pages has to be a whole number, 1 or more.");
  if (!Number.isInteger(pace) || pace < 0) fail("--pace has to be a whole number of milliseconds.");

  const budget = { ...existing?.budget };
  for (const [flag, field] of [["budget-hour", "hour"], ["budget-day", "day"], ["visitor-steps", "perCaller"]] as const) {
    if (values[flag] === undefined) continue;
    const amount = Number(values[flag]);
    if (!(amount > 0) || (field === "perCaller" && !Number.isInteger(amount))) fail(`--${flag} has to be ${field === "perCaller" ? "a whole number" : "an amount"} above 0, not "${values[flag]}".`);
    budget[field] = amount;
  }

  if (values.answers && values.answers !== "on" && values.answers !== "off") fail("--answers is on or off.");
  const staleDays = values["stale-days"] === undefined ? existing?.answers?.staleAfterDays : Number(values["stale-days"]);
  if (staleDays !== undefined && !(Number.isInteger(staleDays) && staleDays > 0)) fail(`--stale-days has to be a whole number above 0, not "${values["stale-days"]}".`);
  const answersOn = values.answers ? values.answers === "on" : existing?.answers?.enabled === true;
  const answers = answersOn || staleDays !== undefined ? { enabled: answersOn, ...(staleDays !== undefined ? { staleAfterDays: staleDays } : {}) } : undefined;

  const handoff = { ...existing?.handoff };
  for (const [flag, field] of [["handoff-webhook", "webhook"], ["handoff-secret", "secret"], ["handoff-url", "url"], ["handoff-email", "email"], ["handoff-label", "label"]] as const) {
    if (values[flag] !== undefined) handoff[field] = values[flag];
  }
  // A webhook on this machine is let through here for trying it out. The online server refuses one.
  if (handoff.webhook && !webhookAllowed(handoff.webhook, true)) fail(`--handoff-webhook has to be an https address, not "${handoff.webhook}".`);
  if (handoff.url && !/^https?:\/\//i.test(handoff.url)) fail(`--handoff-url has to start with https://, not "${handoff.url}".`);
  if (handoff.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(handoff.email)) fail(`--handoff-email has to be an email address, not "${handoff.email}".`);

  const origin = new URL(url).origin;
  const source: SiteSource = { url, maxPages, docs: values.docs ?? existing?.source.docs ?? [] };
  const notesFile = values.notes ?? existing?.source.notesFile;
  if (notesFile) source.notesFile = notesFile;
  if (values.reader && values.reader !== "browser" && values.reader !== "text") fail("--reader is browser or text.");
  const reader = (values.reader as SiteSource["reader"]) ?? existing?.source.reader;
  if (reader) source.reader = reader;
  const maxDepth = Number(values["max-depth"] ?? existing?.source.maxDepth ?? 3);
  if (!Number.isInteger(maxDepth) || maxDepth < 0) fail("--max-depth has to be a whole number, 0 or more.");
  source.maxDepth = maxDepth;
  for (const pattern of values.skip ?? []) {
    try {
      new RegExp(pattern, "i");
    } catch {
      fail(`--skip "${pattern}" isn't a pattern that can be read.`);
    }
  }
  for (const [key, given] of [["skip", values.skip], ["within", values.within], ["also", values.also]] as const) {
    const list = given ?? existing?.source[key];
    if (list?.length) source[key] = list;
  }
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
    ...(answers ? { answers } : {}),
    ...(Object.keys(handoff).length ? { handoff } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  // Kept from the site being rebuilt unless --acting says otherwise. A site that never had it gets no field at all.
  const acting = actingOn === undefined ? existing?.acting : existing ? switchActing(existing, actingOn) : { enabled: actingOn };
  if (acting) base.acting = acting;

  const site = await build(base);
  const file = await saveSite(site);
  console.log(`\nSaved ${site.name} to ${file}`);
  console.log(`The widget will run on: ${site.allowedOrigins.join(", ")}`);
  if (site.acting) console.log(actingLine(site));
  console.log(`\nPaste this just before </body> on every page:\n\n${scriptTag(site)}\n`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
