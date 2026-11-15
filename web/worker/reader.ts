// Reads a company's public pages at signup, a few at a time, so the dashboard
// can show "N pages read" as it goes and no single request runs long.
//
// It follows navigation only. It loads pages, opens tabs, menus and
// accordions that say they show something, and collects where links lead. It
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
import { cleanText, normalizePath, type PageNode } from "../../src/shared/types";
import { openDisclosures, outlinePage, type RawOutline } from "./outline";

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

export function startReading(url: string): Reading {
  return { queue: [url], seen: [], failed: [], thin: [], max: MAX_PAGES, startedAt: new Date().toISOString() };
}

/** Reads the next few pages. Returns the pages read and the reading to save, which is finished once nothing is left. */
export async function readMore(reading: Reading, browser?: BrowserBinding): Promise<{ pages: PageNode[]; reading: Reading }> {
  const next = { ...reading, queue: [...reading.queue], seen: [...reading.seen], failed: [...reading.failed], thin: [...reading.thin] };
  const origin = next.queue[0] ? new URL(next.queue[0]).origin : "";
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
    const urls = take(PER_BATCH.browser);
    try {
      outlines = await readWithBrowser(browser, urls, (url, reason) => next.failed.push({ url, reason }));
      next.via = "browser";
    } catch (error) {
      // No browser to be had right now (a limit, or none on the plan). Read these as plain HTML instead.
      console.error("Browser Rendering failed, reading as HTML:", error instanceof Error ? error.message : error);
      outlines = await readWithFetch(urls, (url, reason) => next.failed.push({ url, reason }));
      next.via = "http";
    }
  } else {
    outlines = await readWithFetch(take(PER_BATCH.http), (url, reason) => next.failed.push({ url, reason }));
    next.via = "http";
  }

  const pages: PageNode[] = [];
  for (const { url, outline } of outlines) {
    const { page, found, controls } = toPageNode(url, outline);
    pages.push(page);
    if (controls < 3) next.thin.push(page.path);
    for (const link of found) {
      if (new URL(link).origin === origin && !NOT_PAGES.test(new URL(link).pathname) && !next.seen.includes(normalizePath(new URL(link).pathname))) next.queue.push(link);
    }
  }
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
  return { pages, reading: next };
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
        const opened = await page.evaluate(openDisclosures, 20);
        const outline = await page.evaluate(outlinePage);
        out.push({ url: page.url() || url, outline: { ...outline, opened } });
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
  const outline: RawOutline = { title: "", description: "", headings: [], links: [], buttons: [], fields: [], opened: 0 };
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

/** Turns a raw outline into the PageNode the server's prompt reads, masked and capped like the intake crawl. */
export function toPageNode(url: string, raw: RawOutline): { page: PageNode; found: string[]; controls: number } {
  const here = new URL(url);
  const found: string[] = [];
  const links = new Map<string, { label: string; to: string }>();
  for (const link of raw.links) {
    if (!URL.canParse(link.href)) continue;
    const target = new URL(link.href);
    if (target.origin !== here.origin) continue;
    target.hash = "";
    found.push(target.href);
    const label = cleanText(link.label, 60);
    const to = normalizePath(target.pathname);
    if (label && links.size < 60) links.set(`${label}|${to}`, { label, to });
  }
  const page: PageNode = {
    path: normalizePath(here.pathname),
    title: cleanText(raw.title, 80),
    headings: raw.headings.map((text) => cleanText(text, 80)).filter(Boolean),
    links: [...links.values()],
    buttons: [...new Set(raw.buttons.map((text) => cleanText(text, 60)).filter(Boolean))],
    fields: [...new Set(raw.fields.map((text) => cleanText(text, 60)).filter(Boolean))],
  };
  const description = cleanText(raw.description, 200);
  if (description) page.description = description;
  return { page, found, controls: links.size + page.buttons.length + page.fields.length };
}
