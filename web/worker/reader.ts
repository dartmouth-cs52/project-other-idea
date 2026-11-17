// Reads a company's public pages at signup, a few at a time, so the dashboard
// can show "N pages read" as it goes and no single request runs long.
//
// It follows navigation only. It loads pages, opens tabs, menus and
// accordions that say they show something, and collects where links lead and
// what each of those openings showed, so a route that takes two clicks is known. It
// never submits a form or presses a button that changes anything, and in a
// real browser every request other than GET is refused before it leaves, so a
// stray click cannot change the company's data either.
//
// Pages built with JavaScript need a real browser: Cloudflare Browser
// Rendering, the BROWSER binding. Without it, or if it fails, pages are read
// as the HTML the server sends, as `npm run tag` does.
//
// Screens behind a login are never asked for. Haptic learns those from the
// widget once it is installed.

import puppeteer from "@cloudflare/puppeteer";
import { normalizePath, type PageNode } from "../../src/shared/types";
import { openDisclosures, outlinePage, type RawOutline } from "./outline";
import { toPageNode } from "./page-node";

export { toPageNode };

/** What is kept between batches, in sites.reading. */
export interface Reading {
  /** Pages still to read, as full URLs. */
  queue: string[];
  /** Normalized paths already taken from the queue, so /orders/1 and /orders/2 are read once. */
  seen: string[];
  failed: { url: string; reason: string }[];
  /** Paths with almost nothing to click: usually drawn by JavaScript, or behind a login. */
  thin: string[];
  max: number;
  via?: "browser" | "http";
  /** The origin being read. It starts as the one pasted and moves if the first page redirects to the same site's other address. */
  origin?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface BrowserBinding {
  fetch: typeof fetch;
}

export const MAX_PAGES = 30;
const PER_BATCH = { browser: 3, http: 6 };
const TIMEOUT_MS = 15_000;
const USER_AGENT = "HapticReader/1.0 (+https://joinhaptic.com)";
const NOT_PAGES = /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|css|js|json|xml|txt|mp4|woff2?)$/i;
/** Most page addresses taken from a sitemap. The reading stops at `max` pages anyway. */
const MAX_FROM_SITEMAP = 200;

export function startReading(url: string): Reading {
  return { queue: [url], seen: [], failed: [], thin: [], max: MAX_PAGES, startedAt: new Date().toISOString() };
}

/**
 * True when two addresses are the same site under its other name: with or
 * without www, or http against https. A redirect between those is followed. A
 * redirect anywhere else, such as to a sign-in service, is not.
 */
export function sameSite(a: URL, b: URL): boolean {
  const bare = (url: URL) => url.hostname.replace(/^www\./, "");
  return bare(a) === bare(b) && a.port === b.port;
}

/**
 * Reads the next few pages. Returns the pages read and the reading to save,
 * which is finished once nothing is left. The first call reads only the page
 * that was pasted, to learn where the site really lives: `movedTo` is set when
 * that page redirected to the site's other address, which is then the origin
 * read from there on.
 */
export async function readMore(reading: Reading, browser?: BrowserBinding): Promise<{ pages: PageNode[]; reading: Reading; movedTo?: string }> {
  const next = { ...reading, queue: [...reading.queue], seen: [...reading.seen], failed: [...reading.failed], thin: [...reading.thin] };
  const first = next.seen.length === 0;
  const start = next.queue[0] ? new URL(next.queue[0]) : undefined;
  next.origin ??= start?.origin ?? "";
  const fail = (url: string, reason: string) => void next.failed.push({ url, reason });
  const take = (count: number) => {
    const urls: string[] = [];
    while (next.queue.length && urls.length < count && next.seen.length < next.max) {
      const url = next.queue.shift()!;
      const key = normalizePath(new URL(url).pathname);
      if (next.seen.includes(key)) continue;
      next.seen.push(key);
      urls.push(url);
    }
    return urls;
  };

  let outlines: { url: string; outline: RawOutline }[] = [];
  if (browser) {
    const urls = take(first ? 1 : PER_BATCH.browser);
    try {
      outlines = await readWithBrowser(browser, urls, fail);
      next.via = "browser";
    } catch (error) {
      // No browser to be had right now (a limit, or none on the plan). Read these as plain HTML instead.
      console.error("Browser Rendering failed, reading as HTML:", error instanceof Error ? error.message : error);
      outlines = await readWithFetch(urls, fail);
      next.via = "http";
    }
  } else {
    outlines = await readWithFetch(take(first ? 1 : PER_BATCH.http), fail);
    next.via = "http";
  }

  let movedTo: string | undefined;
  if (first && start && outlines[0]) {
    const landed = new URL(outlines[0].url);
    if (landed.origin !== start.origin && sameSite(start, landed)) movedTo = next.origin = landed.origin;
  }

  const pages: PageNode[] = [];
  for (const { url, outline } of outlines) {
    // A page that sent us to another site, such as a sign-in service, is not one of this site's pages.
    if (new URL(url).origin !== next.origin) {
      fail(url, "leads to another site");
      continue;
    }
    const { page, found, controls } = toPageNode(url, outline);
    pages.push(page);
    if (controls < 3) next.thin.push(page.path);
    for (const link of found) {
      if (new URL(link).origin === next.origin && !NOT_PAGES.test(new URL(link).pathname) && !next.seen.includes(normalizePath(new URL(link).pathname))) next.queue.push(link);
    }
  }
  // After the links on the first page, which are the site's own navigation, come the pages its sitemap lists.
  // A site built with JavaScript may have no links in its HTML at all, and this is then the only way to its pages.
  if (first && pages.length) next.queue.push(...(await sitemapUrls(next.origin)).filter((url) => !next.seen.includes(normalizePath(new URL(url).pathname))));

  // Keep the queue short: one waiting URL per path is enough.
  const queued = new Set<string>();
  next.queue = next.queue.filter((url) => {
    const key = normalizePath(new URL(url).pathname);
    if (queued.has(key)) return false;
    queued.add(key);
    return true;
  });
  if (!next.queue.length || next.seen.length >= next.max) {
    next.queue = [];
    next.finishedAt = new Date().toISOString();
  }
  return { pages, reading: next, ...(movedTo ? { movedTo } : {}) };
}

/** The pages a site lists in /sitemap.xml, on its own origin. Empty when there is none or it cannot be read. */
async function sitemapUrls(origin: string): Promise<string[]> {
  try {
    const response = await fetch(`${origin}/sitemap.xml`, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return [];
    const text = (await response.text()).slice(0, 2_000_000);
    return [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
      .map((match) => (match[1] ?? "").replace(/&amp;/g, "&"))
      .filter((loc) => URL.canParse(loc) && new URL(loc).origin === origin && !NOT_PAGES.test(new URL(loc).pathname))
      .slice(0, MAX_FROM_SITEMAP);
  } catch {
    return [];
  }
}

async function readWithBrowser(binding: BrowserBinding, urls: string[], fail: (url: string, reason: string) => void) {
  const browser = await puppeteer.launch(binding as never);
  const out: { url: string; outline: RawOutline }[] = [];
  try {
    for (const url of urls) {
      const page = await browser.newPage();
      try {
        await page.setUserAgent(USER_AGENT);
        await page.setRequestInterception(true);
        page.on("request", (request) => {
          // Reading never sends anything: no form posts, no API writes, no analytics beacons.
          if (request.method() !== "GET" && request.method() !== "HEAD") void request.abort();
          else void request.continue();
        });
        const response = await page.goto(url, { waitUntil: "networkidle2", timeout: TIMEOUT_MS });
        if (response && !response.ok()) throw new Error(`HTTP ${response.status()}`);
        const { opened, reveals } = await page.evaluate(openDisclosures, 20);
        const outline = await page.evaluate(outlinePage);
        out.push({ url: page.url() || url, outline: { ...outline, opened, reveals } });
      } catch (error) {
        fail(url, error instanceof Error ? error.message : String(error));
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return out;
}

async function readWithFetch(urls: string[], fail: (url: string, reason: string) => void) {
  const out: { url: string; outline: RawOutline }[] = [];
  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!(response.headers.get("content-type") ?? "").includes("html")) return;
        out.push({ url: response.url || url, outline: await outlineHtml(response, response.url || url) });
      } catch (error) {
        fail(url, error instanceof Error ? error.message : String(error));
      }
    }),
  );
  return out;
}

/** The same outline from plain HTML, with the runtime's streaming parser. Text inside scripts and styles is skipped. */
export async function outlineHtml(response: Response, base: string): Promise<RawOutline> {
  const outline: RawOutline = { title: "", description: "", headings: [], links: [], buttons: [], fields: [], opened: 0, reveals: [] };
  // Each open element that collects text gets a buffer, closed by its end tag.
  const collect = (onDone: (text: string) => void) => {
    let buffer = "";
    return {
      element(el: HTMLRewriterElement) {
        buffer = "";
        el.onEndTag(() => onDone(buffer.replace(/\s+/g, " ").trim()));
      },
      text(chunk: HTMLRewriterText) {
        buffer += chunk.text;
      },
    };
  };
  let pendingHref = "";
  let pendingAria = "";
  const rewriter = new HTMLRewriter()
    .on("title", collect((text) => (outline.title ||= text)))
    .on('meta[name="description"]', { element: (el) => void (outline.description = el.getAttribute("content") ?? "") })
    .on("h1, h2, h3", collect((text) => text && outline.headings.push(text)))
    .on("a[href]", {
      element(el) {
        pendingHref = el.getAttribute("href") ?? "";
        pendingAria = el.getAttribute("aria-label") ?? "";
      },
    })
    .on(
      "a[href]",
      collect((text) => {
        if (!pendingHref || /^(#|javascript:|mailto:|tel:)/i.test(pendingHref) || !URL.canParse(pendingHref, base)) return;
        outline.links.push({ label: pendingAria || text, href: new URL(pendingHref, base).href });
      }),
    )
    .on("button, summary, [role='button'], [role='tab']", collect((text) => text && outline.buttons.push(text)))
    .on("input, select, textarea", {
      element(el) {
        const type = (el.getAttribute("type") ?? "").toLowerCase();
        if (["hidden", "submit", "button", "reset", "image", "password"].includes(type)) return;
        outline.fields.push(el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || "");
      },
    });
  await rewriter.transform(response).arrayBuffer();
  outline.headings = [...new Set(outline.headings)].slice(0, 12);
  outline.buttons = [...new Set(outline.buttons)].slice(0, 40);
  outline.fields = [...new Set(outline.fields.filter(Boolean))].slice(0, 30);
  return outline;
}
