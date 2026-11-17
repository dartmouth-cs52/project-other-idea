import * as cheerio from "cheerio";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Doc } from "../shared/types.ts";

// Loads the help docs a company supplies: files, folders of files, or URLs.
// Each becomes plain text with a title, and where it is known, the address a
// visitor can read it at and the day it was last changed. An answer shows
// both, so the reader can open the article and judge how fresh it is.
//
// A text file can say these itself, in a few lines at its very top:
//
//   ---
//   title: Inviting teammates
//   url: https://help.acme.com/articles/inviting-teammates
//   updated: 2026-10-02
//   ---

const TEXT_FILES = new Set([".md", ".mdx", ".txt", ".html", ".htm"]);

export async function loadDocs(sources: string[]): Promise<Doc[]> {
  const docs: Doc[] = [];
  for (const source of sources) {
    if (/^https?:\/\//i.test(source)) docs.push(await fromUrl(source));
    else docs.push(...(await fromPath(source)));
  }
  return docs.filter((doc) => doc.text);
}

async function fromUrl(url: string): Promise<Doc> {
  const response = await fetch(url, { headers: { "User-Agent": "HapticIntake/0.1" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Couldn't fetch the doc at ${url}: HTTP ${response.status}`);
  const body = await response.text();
  const isHtml = (response.headers.get("content-type") ?? "").includes("html");
  const doc = isHtml ? fromHtml(body, url) : fromText(body, url, url);
  doc.url ??= url;
  // The page's own word for when it changed comes first. The server's is a fallback, and is often just the time of the request.
  const changed = doc.updated ?? day(response.headers.get("last-modified") ?? "");
  if (changed) doc.updated = changed;
  return doc;
}

async function fromPath(path: string): Promise<Doc[]> {
  if ((await stat(path)).isDirectory()) {
    const docs: Doc[] = [];
    for (const name of (await readdir(path)).sort()) {
      if (!name.startsWith(".")) docs.push(...(await fromPath(join(path, name))));
    }
    return docs;
  }
  const extension = extname(path).toLowerCase();
  if (!TEXT_FILES.has(extension)) {
    console.warn(`Skipped ${path}: only ${[...TEXT_FILES].join(", ")} files are read.`);
    return [];
  }
  const body = await readFile(path, "utf8");
  if (extension === ".html" || extension === ".htm") return [fromHtml(body, path)];
  return [fromText(body, path, basename(path, extension))];
}

/** A text or Markdown doc. Lines at the very top between two "---" lines give its title, address and date. */
export function fromText(body: string, source: string, fallbackTitle: string): Doc {
  const fields: Record<string, string> = {};
  let text = body;
  const top = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
  if (top) {
    text = body.slice(top[0].length);
    for (const line of (top[1] ?? "").split(/\r?\n/)) {
      const field = /^([A-Za-z_]+)\s*:\s*(.+)$/.exec(line);
      if (field) fields[field[1]!.toLowerCase()] = field[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  const doc: Doc = { title: fields.title || firstHeading(text) || fallbackTitle, source, text: text.trim() };
  if (isWebAddress(fields.url)) doc.url = fields.url;
  const changed = day(fields.updated ?? "");
  if (changed) doc.updated = changed;
  return doc;
}

const isWebAddress = (value: string | undefined): value is string => !!value && /^https?:\/\//i.test(value) && URL.canParse(value);

/** A date in any form Date understands, as "2026-10-02". Undefined when it isn't a date. */
export function day(value: string): string | undefined {
  const time = Date.parse(value);
  return value && !Number.isNaN(time) ? new Date(time).toISOString().slice(0, 10) : undefined;
}

export function fromHtml(html: string, source: string): Doc {
  const $ = cheerio.load(html);
  // A help page's <title> starts with the page's own name and ends with the site's: "Basic searching | Jira Software".
  // Its first h1 is often the site's name, or the first section's.
  const titled = $("title").first().text().split(/\s+[|–—]\s+|\s+-\s+/)[0]?.trim() ?? "";
  const address = $('link[rel="canonical"]').attr("href");
  const changed = day($('meta[property="article:modified_time"], meta[name="last-modified"], meta[name="revised"]').first().attr("content") ?? "");
  $("script, style, noscript, nav, header, footer, aside, svg").remove();
  // Block elements end a line, so headings and list items don't run together.
  $("p, li, h1, h2, h3, h4, tr, br, div").each((_, el) => void $(el).append("\n"));
  // A help page can have more than one of these, like a search box's results drawn as an article before the page's own.
  // The one with the most words is the page.
  const candidates = $("main, article, [role='main']").toArray();
  const main = candidates.sort((a, b) => $(b).text().length - $(a).text().length)[0];
  const body = main ? $(main) : $("body");
  const title = titled || $("h1").first().text().trim() || source;
  const text = body.text();
  const doc: Doc = { title, source, text: text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim() };
  if (isWebAddress(address)) doc.url = address;
  if (changed) doc.updated = changed;
  return doc;
}

function firstHeading(markdown: string): string {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "";
}
