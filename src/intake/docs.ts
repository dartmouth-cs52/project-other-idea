import * as cheerio from "cheerio";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Doc } from "../shared/types.ts";

// Loads the help docs a company supplies: files, folders of files, or URLs.
// Each becomes plain text with a title.

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
  return isHtml ? fromHtml(body, url) : { title: firstHeading(body) || url, source: url, text: body.trim() };
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
  return [{ title: firstHeading(body) || basename(path, extension), source: path, text: body.trim() }];
}

function fromHtml(html: string, source: string): Doc {
  const $ = cheerio.load(html);
  const title = $("h1").first().text().trim() || $("title").first().text().trim() || source;
  $("script, style, noscript, nav, header, footer, aside, svg").remove();
  // Block elements end a line, so headings and list items don't run together.
  $("p, li, h1, h2, h3, h4, tr, br, div").each((_, el) => void $(el).append("\n"));
  const main = $("main, article, [role='main']").first();
  const text = (main.length ? main : $("body")).text();
  return { title, source, text: text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim() };
}

function firstHeading(markdown: string): string {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "";
}
