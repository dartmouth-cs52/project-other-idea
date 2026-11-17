import * as cheerio from "cheerio";
import { cleanText, normalizePath, type PageNode } from "../shared/types.ts";

// Reads a site's pages over plain HTTP and keeps an outline of each: title,
// headings, where its links lead, button labels and form field labels.
// It sees what the server sends, so a page drawn entirely by JavaScript, or
// one behind a login, comes back nearly empty. `thin` reports those.

const FETCH_TIMEOUT_MS = 10_000;
const CONCURRENCY = 4;
const NOT_PAGES = /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|css|js|json|xml|txt|mp4|woff2?)$/i;
const USER_AGENT = "HapticIntake/0.1";

export interface CrawlResult {
  pages: PageNode[];
  /** Paths whose HTML had almost nothing to click, usually because the page renders in the browser. */
  thin: string[];
  failed: { url: string; reason: string }[];
}

export async function crawlSite(startUrl: string, maxPages: number): Promise<CrawlResult> {
  const start = new URL(startUrl);
  const result: CrawlResult = { pages: [], thin: [], failed: [] };
  const queue: string[] = [start.href, ...(await sitemapUrls(start))];
  // Keyed by normalized path, so /orders/1 and /orders/2 are read once as /orders/:id.
  const seen = new Set<string>();

  const next = (): string | undefined => {
    while (queue.length && seen.size < maxPages) {
      const url = queue.shift()!;
      const key = normalizePath(new URL(url).pathname);
      if (seen.has(key)) continue;
      seen.add(key);
      return url;
    }
    return undefined;
  };

  const worker = async () => {
    for (let url = next(); url; url = next()) {
      try {
        const html = await fetchHtml(url);
        if (html === undefined) continue;
        const { page, found, controls } = extractPage(html, url);
        result.pages.push(page);
        if (controls < 3) result.thin.push(page.path);
        for (const link of found) if (new URL(link).origin === start.origin && !NOT_PAGES.test(new URL(link).pathname)) queue.push(link);
      } catch (error) {
        result.failed.push({ url, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  // Rounds, because a worker that finds the queue empty exits while others may still be adding to it.
  while (queue.length && seen.size < maxPages) await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  result.pages.sort((a, b) => a.path.localeCompare(b.path));
  return result;
}

async function fetchHtml(url: string): Promise<string | undefined> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!(response.headers.get("content-type") ?? "").includes("html")) return undefined;
  return response.text();
}

async function sitemapUrls(start: URL): Promise<string[]> {
  try {
    const response = await fetch(new URL("/sitemap.xml", start), { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return [];
    const locs = [...(await response.text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1] ?? "");
    return locs.filter((loc) => URL.canParse(loc) && new URL(loc).origin === start.origin && !NOT_PAGES.test(new URL(loc).pathname));
  } catch {
    return [];
  }
}

/** Whether a link is marked as opening a menu or unfolding something, which is then what a click on it does. */
function opensSomething(haspopup: string | undefined, expanded: string | undefined): boolean {
  return expanded !== undefined || !["", "false"].includes((haspopup ?? "").toLowerCase());
}

/** Outline of one page, plus the absolute URLs it links to and how many controls it has. */
export function extractPage(html: string, url: string): { page: PageNode; found: string[]; controls: number } {
  const $ = cheerio.load(html);
  $("script, style, noscript, template, svg, haptic-root").remove();
  const label = (el: Parameters<typeof $>[0]) => cleanText($(el).attr("aria-label") || $(el).text() || $(el).attr("title") || $(el).attr("value") || "", 60);
  const unique = (items: string[], max: number) => [...new Set(items.filter(Boolean))].slice(0, max);

  const found: string[] = [];
  const menus: string[] = [];
  const links = new Map<string, { label: string; to: string }>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (href.startsWith("#") || /^(javascript|mailto|tel):/i.test(href) || !URL.canParse(href, url)) return;
    const target = new URL(href, url);
    if (target.origin !== new URL(url).origin) return;
    target.hash = "";
    found.push(target.href);
    const text = label(el);
    // A link that opens a menu or unfolds a section does that when clicked, so it is
    // listed with the buttons, as the widget lists it. Its address is still a page to read.
    if (opensSomething($(el).attr("aria-haspopup"), $(el).attr("aria-expanded"))) {
      menus.push(text);
      return;
    }
    const to = normalizePath(target.pathname);
    if (text && links.size < 60) links.set(`${text}|${to}`, { label: text, to });
  });

  const fields: string[] = [];
  $("input, select, textarea").each((_, el) => {
    const type = ($(el).attr("type") ?? "").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(type)) return;
    const id = $(el).attr("id");
    const fromLabel = (id && $(`label[for="${id.replace(/"/g, "")}"]`).first().text()) || $(el).closest("label").text();
    fields.push(cleanText(fromLabel || $(el).attr("aria-label") || $(el).attr("placeholder") || $(el).attr("name") || "", 60));
  });

  const buttons = unique([...$("button, [role='button'], input[type='submit'], input[type='button'], summary").map((_, el) => label(el)).get(), ...menus], 40);
  const description = cleanText($('meta[name="description"]').attr("content") ?? "", 200);
  const page: PageNode = {
    path: normalizePath(new URL(url).pathname),
    title: cleanText($("title").first().text() || $("h1").first().text(), 80),
    headings: unique($("h1, h2, h3").map((_, el) => cleanText($(el).text(), 80)).get(), 12),
    links: [...links.values()],
    buttons,
    fields: unique(fields, 30),
  };
  if (description) page.description = description;
  return { page, found, controls: links.size + buttons.length + fields.length };
}
