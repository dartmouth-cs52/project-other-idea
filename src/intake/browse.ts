import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { renderSiteMap } from "../server/prompt.ts";
import { cleanText, type PageNode } from "../shared/types.ts";
import type { CrawlResult } from "./crawl.ts";
import { pageKey, parentKey, reasonNotToFollow } from "./paths.ts";
import type { PageReading, ReadControl } from "./reader.ts";

// Reads a site's pages in a real browser, the way a visitor's browser draws
// them, and keeps an outline of each for the site map. Apps that draw
// themselves with JavaScript come back empty from the plain HTTP reader in
// crawl.ts; here they are read after they have drawn, with the widget's own
// reading of a page, so the map names controls the way the model sees them.
//
// It loads pages and follows links, and that is all. It never clicks, types,
// submits, focuses or scrolls anything. A link whose address signs out or does
// something (see paths.ts) is not loaded, nor is anything off the site. Pages
// behind a sign-in are read only when it is handed a signed-in session.
//
// It drives a browser with Playwright, which this project does not install:
//   npm install --no-save playwright && npx playwright install chromium

// Playwright is loaded by name at run time, so that the project neither depends on it nor type-checks against it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

export interface BrowseOptions {
  /** Most pages to load. */
  maxPages: number;
  /** How many links away from a start page to go. */
  maxDepth: number;
  /** Least time between two page loads, so a site other people use is not hurried. */
  paceMs: number;
  /** A signed-in session: a file of cookies and storage in Playwright's storage-state format. */
  session?: string;
  /** Addresses or link labels to leave alone, given by whoever runs the intake. */
  skip: RegExp[];
  /** Path prefixes to stay inside. Empty for the whole site. */
  within: string[];
  /** Words to keep out of the map wherever they appear, like the name of the account the reader signed in with. */
  hide?: string[];
  /** More pages to start from, besides the site's address. */
  also: string[];
  /** Told about each page as it is read. */
  onPage?: (path: string, done: number) => void;
}

export interface BrowseResult extends CrawlResult {
  /** Links that were not loaded, and why. */
  skipped: { url: string; reason: string }[];
  /** Pages that sent the reader to a sign-in page. */
  signInWalls: string[];
  /** Pages read but left out of the map to keep it within its budget. */
  cut: string[];
}

/** Some demo servers take half a minute to answer, so a page gets this long, and a second try. */
const PAGE_TIMEOUT_MS = 60_000;
/** How long to wait for the page to stop fetching. Pages that poll never stop, so this is a cap, not a requirement. */
const IDLE_MS = 8_000;
/** How long to wait for the list of controls to stop growing once the page has loaded. */
const SETTLE_MS = 12_000;
const SETTLE_STEP_MS = 700;
/** Readings in a row that must agree. An app that is still waiting for its data can hold still for a moment with only its frame drawn. */
const STEADY_READINGS = 3;
const EMPTY_MS = 3_000;
/** Pages of records (a row, a card, an address with an id) read under any one parent path. Ten product pages say no more than two. */
const PER_KIND = 2;
/** Links followed from the body of any one page, as opposed to its navigation, like the links in an article's text. */
const FOLLOW_FROM_BODY = 8;
/**
 * The most characters of site map sent with every step. It is paid for on
 * every step of every guide, so pages far from the start are dropped first
 * until it fits.
 */
export const MAP_BUDGET = 8_000;
const MAX_LINKS = 25;
/** Of those, links in the body of the page rather than its navigation, like the links inside an article's text. */
const MAX_CONTENT_LINKS = 10;
const MAX_BUTTONS = 20;
const MAX_FIELDS = 15;
const MAX_HEADINGS = 8;
const LABEL_CHARS = 50;
/** Downloads the map does not need, left out to go easy on the site. */
const NOT_NEEDED = new Set(["image", "media", "font"]);

const BUTTON_ROLES = new Set(["button", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "switch", "treeitem"]);
const FIELD_ROLES = new Set(["textbox", "searchbox", "combobox", "select", "checkbox", "radio", "slider", "spinbutton", "file-upload"]);

/** True when Playwright and its browser can be loaded here. */
export function canBrowse(): boolean {
  try {
    createRequire(import.meta.url).resolve("playwright");
    return true;
  } catch {
    return false;
  }
}

let script: Promise<string> | undefined;
/** reader.ts as one script for the page. Evaluating it defines __hapticIntake there. */
function readerScript(): Promise<string> {
  script ??= build({
    entryPoints: [fileURLToPath(new URL("./reader.ts", import.meta.url))],
    bundle: true,
    format: "iife",
    globalName: "__hapticIntake",
    target: "es2020",
    minify: true,
    write: false,
  }).then((result) => result.outputFiles[0]?.text ?? "");
  return script;
}

export async function browseSite(startUrl: string, options: BrowseOptions): Promise<BrowseResult> {
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)("playwright"));
  } catch {
    throw new Error("Reading pages in a browser needs Playwright: npm install --no-save playwright && npx playwright install chromium");
  }
  const reader = await readerScript();
  const start = new URL(startUrl);
  const result: BrowseResult = { pages: [], thin: [], failed: [], skipped: [], signInWalls: [], cut: [] };
  const depthOf = new Map<PageNode, number>();

  const browser = await chromium.launch();
  try {
    const plain = await browser.newPage();
    const userAgent = `${(await plain.evaluate("navigator.userAgent")) as string} HapticIntake/0.2`;
    await plain.close();
    // A site that forbids scripts from elsewhere would refuse the reader. It is this browser's own script, so the rule is set aside.
    const context = await browser.newContext({
      bypassCSP: true,
      viewport: { width: 1366, height: 900 },
      acceptDownloads: false,
      userAgent,
      ...(options.session ? { storageState: options.session } : {}),
    });
    await context.route("**/*", (route: Page) => (NOT_NEEDED.has(route.request().resourceType()) ? route.abort() : route.continue()));
    const page = await context.newPage();
    // Nothing the page opens is used: a second window is closed, a question the page asks is turned down.
    context.on("page", (other: Page) => other !== page && other.close().catch(() => undefined));
    page.on("dialog", (dialog: Page) => dialog.dismiss().catch(() => undefined));
    const run = async <T>(name: "read" | "count"): Promise<T> => (await page.evaluate(`${reader}\n;__hapticIntake.${name}()`)) as T;

    const queue: { address: string; depth: number }[] = [];
    const queued = new Set<string>();
    const enqueue = (address: string, depth: number) => {
      queued.add(pageKey(address));
      queue.push({ address, depth });
    };
    for (const address of [start.href, ...options.also]) enqueue(address, 0);
    const done = new Set<string>();
    const perParent = new Map<string, number>();
    let loads = 0;
    let lastLoad = 0;

    while (queue.length && loads < options.maxPages) {
      const visit = queue.shift()!;
      const wait = lastLoad + options.paceMs - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
      lastLoad = Date.now();
      loads++;

      let reading: PageReading;
      try {
        await page.goto(visit.address, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS }).catch(async (error: Error) => {
          if (!/timeout/i.test(error.message)) throw error;
          await page.goto(visit.address, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
        });
        await page.waitForLoadState("networkidle", { timeout: IDLE_MS }).catch(() => undefined);
        // A page drawn by JavaScript keeps adding controls after it has loaded. Read it once the list stops growing.
        // A page with nothing to use yet may still be drawing, so an empty one gets a few seconds more.
        let last = -1;
        let same = 0;
        for (const began = Date.now(); Date.now() < began + SETTLE_MS; ) {
          const now = await run<number>("count");
          same = now === last ? same + 1 : 1;
          if (same >= STEADY_READINGS && (now > 0 || Date.now() > began + EMPTY_MS)) break;
          last = now;
          await page.waitForTimeout(SETTLE_STEP_MS);
        }
        reading = await run<PageReading>("read");
      } catch (error) {
        result.failed.push({ url: visit.address, reason: (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "" });
        continue;
      }

      const landed = new URL(reading.address);
      if (landed.origin !== start.origin) {
        result.failed.push({ url: visit.address, reason: `it led off the site, to ${landed.origin}` });
        continue;
      }
      const key = pageKey(reading.address);
      if (reading.signIn && key !== pageKey(visit.address)) result.signInWalls.push(pageKey(visit.address));
      if (done.has(key)) continue;
      done.add(key);
      queued.add(key);
      const node = pageNode(reading, key, start.origin, options.hide);
      result.pages.push(node);
      depthOf.set(node, visit.depth);
      if (node.links.length + node.buttons.length + node.fields.length < 3) result.thin.push(key);
      options.onPage?.(key, loads);

      if (visit.depth >= options.maxDepth) continue;
      // The page's own navigation first: it leads to the sections of the site.
      let fromBody = 0;
      for (const link of [...reading.links].sort((a, b) => Number(b.nav && !b.record) - Number(a.nav && !a.record))) {
        let url: URL;
        try {
          url = new URL(link.address);
        } catch {
          continue;
        }
        if (url.origin !== start.origin) continue;
        // "#section" is a place on the same page. "#/route" is a page of an app that lives behind one address.
        if (!/^#!?\//.test(url.hash)) url.hash = "";
        const target = pageKey(url.href);
        if (queued.has(target)) continue;
        if (options.within.length && !options.within.some((prefix) => url.pathname.startsWith(prefix))) continue;
        const why = link.marked ? "the page marks it as more than a visit" : reasonNotToFollow(url.href, link.label, options.skip);
        if (why) {
          queued.add(target);
          result.skipped.push({ url: url.href, reason: why });
          continue;
        }
        if (link.record || target.includes(":id")) {
          const parent = parentKey(target);
          const count = perParent.get(parent) ?? 0;
          if (count >= PER_KIND) continue;
          perParent.set(parent, count + 1);
        } else if (!link.nav && ++fromBody > FOLLOW_FROM_BODY) {
          continue;
        }
        enqueue(url.href, visit.depth + 1);
      }
    }
  } finally {
    await browser.close();
  }

  tidy(result.pages);
  // Over budget, the pages farthest from the start go first, the last found first among equals.
  let kept = [...result.pages];
  let map = compact(kept);
  while (kept.length > 1 && renderSiteMap(sorted(map)).length > MAP_BUDGET) {
    const farthest = kept.reduce((far, node) => ((depthOf.get(node) ?? 0) >= (depthOf.get(far) ?? 0) ? node : far));
    kept = kept.filter((node) => node !== farthest);
    result.cut.push(farthest.path);
    map = compact(kept);
  }
  result.pages = sorted(map);
  return result;
}

/**
 * Pages of one kind repeat each other: every tab of an employee's record lists
 * the same eight other tabs. The site map lists what most pages share once at
 * the top, and this does the same for what only some share: a link or button
 * that three or more pages have, but not most, is kept on the first page that
 * has it and left off the rest. Pages are taken in the order they were read,
 * so the first is the one nearest the start.
 */
export function compact(pages: PageNode[]): PageNode[] {
  // The same test the site map uses for what goes at the top (renderSiteMap in src/server/prompt.ts).
  const linkText = (link: { label: string; to: string }) => `${link.label} → ${link.to}`;
  const counts = new Map<string, number>();
  for (const page of pages) for (const item of new Set([...page.links.map(linkText), ...page.buttons])) counts.set(item, (counts.get(item) ?? 0) + 1);
  const sharedMin = Math.max(3, Math.ceil(pages.length / 2));
  const placed = new Set<string>();
  const once = (item: string) => {
    const count = counts.get(item) ?? 0;
    if (count < 3 || count >= sharedMin) return true;
    if (placed.has(item)) return false;
    placed.add(item);
    return true;
  };
  return pages.map((page) => ({ ...page, links: page.links.filter((link) => once(linkText(link))), buttons: page.buttons.filter(once) }));
}

const sorted = (pages: PageNode[]) => [...pages].sort((a, b) => a.path.localeCompare(b.path));

/** One page of the map: what a visitor can use there, without the page's data. */
export function pageNode(reading: PageReading, key: string, origin: string, hide: string[] = []): PageNode {
  // Controls inside a table row, a card or an entry belong to the data on the page, like a person's name in a list
  // of employees. That is not the site's map, and it would put one account's data in front of every visitor.
  // So does the name of the account the reader is signed in as, which the person running the intake can name.
  const hidden = (text: string) => hide.some((words) => words && text.toLowerCase().includes(words.toLowerCase()));
  const own = reading.controls.filter((control) => !control.record && !hidden(control.label));
  const name = (control: ReadControl) => cleanText(control.label || (control.icon ? `${control.icon} icon` : ""), LABEL_CHARS);
  const unique = (items: string[], max: number) => [...new Set(items.filter(Boolean))].slice(0, max);

  const links: PageNode["links"] = [];
  /** Links that lead to no other page, like href="#": the app handles the click itself, so they are buttons to a visitor. */
  const inPlace: ReadControl[] = [];
  const toRecord = new Map<string, number>();
  let inContent = 0;
  for (const control of own) {
    if (control.role !== "link" || control.opensMenu) continue;
    let url: URL | undefined;
    try {
      url = control.address ? new URL(control.address) : undefined;
    } catch {
      url = undefined;
    }
    if (url && url.origin !== origin) continue;
    if (url && !/^#!?\//.test(url.hash)) url.hash = "";
    const to = url && pageKey(url.href);
    if (!to || to === key) {
      inPlace.push(control);
      continue;
    }
    const label = name(control);
    if (!label || links.length >= MAX_LINKS || links.some((link) => link.label === label && link.to === to)) continue;
    if (!control.nav && ++inContent > MAX_CONTENT_LINKS) continue;
    // Many links to pages of one kind, like products: two say where they lead.
    if (to.includes(":id")) {
      const seen = toRecord.get(to) ?? 0;
      toRecord.set(to, seen + 1);
      if (seen >= 2) continue;
    }
    links.push({ label, to });
  }

  const buttons = unique(
    own
      .filter((control) => BUTTON_ROLES.has(control.role) || (control.role === "link" && (control.opensMenu || inPlace.includes(control))) || (control.role === "clickable" && control.nav))
      .map(name)
      // Page numbers and lone symbols, like the × of a chip, say nothing about the site.
      .filter((label) => /\p{L}{2}/u.test(label)),
    MAX_BUTTONS,
  );
  const fields = unique(own.filter((control) => FIELD_ROLES.has(control.role)).map(name), MAX_FIELDS);
  const headings = unique(reading.headings.filter((heading) => !hidden(heading)), MAX_HEADINGS);
  const node: PageNode = { path: key, title: hidden(reading.title) ? "" : reading.title, headings, links, buttons, fields };
  if (reading.description) node.description = reading.description;
  return node;
}

/**
 * An app often gives every page the same title and the same description. Said
 * on every line, they say nothing: such a title gives way to the page's first
 * heading, and such a description is dropped.
 *
 * A page that is one record of many, like "/people/:id", is titled and headed
 * with that record: a person's name, an order. The map is sent to every
 * visitor, so of such a page it keeps only what every record's page has: its
 * controls, and a title only when other pages share it.
 */
export function tidy(pages: PageNode[]): void {
  const counts = (values: (string | undefined)[]) => {
    const map = new Map<string, number>();
    for (const value of values) if (value) map.set(value, (map.get(value) ?? 0) + 1);
    return map;
  };
  const titles = counts(pages.map((page) => page.title));
  const descriptions = counts(pages.map((page) => page.description));
  for (const page of pages) {
    const shared = (titles.get(page.title) ?? 0) > 1;
    if (page.path.includes(":id")) {
      if (!shared) page.title = "";
      page.headings = [];
      delete page.description;
      continue;
    }
    if (shared && page.headings[0]) page.title = page.headings.shift()!;
    if (page.description && (descriptions.get(page.description) ?? 0) > 1) delete page.description;
  }
}
