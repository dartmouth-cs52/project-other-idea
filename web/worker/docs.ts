// Help docs a company adds from its dashboard, by address or by pasting.
// They go into the prompt as they are, so Haptic uses the company's own words.
// The prompt holds whole docs only, up to DOCS_BUDGET characters, in the order
// they were added; the rest are kept but left out (src/server/prompt.ts).

import type { Doc } from "../../src/shared/types";
import { capped } from "./body";

/** The prompt's room for help docs, in characters. The same figures as src/server/prompt.ts. */
export const DOCS_BUDGET = 60_000;
/** With Answers on, the docs are what answers come from, so they get more room. */
export const ANSWERS_DOCS_BUDGET = 250_000;
/** One doc may fill the whole room, and no more. */
export const MAX_DOC_CHARS = DOCS_BUDGET;
export const MAX_DOCS = 30;
const MAX_PAGE_BYTES = 2_000_000;
const TOO_LARGE = "That page is too large to use as a help doc.";
const TIMEOUT_MS = 15_000;
const USER_AGENT = "HapticReader/1.0 (+https://joinhaptic.com)";

/** Which docs the prompt holds: whole docs, in order, until the room is used up. */
export function docsThatFit(docs: Doc[], budget = DOCS_BUDGET): Set<string> {
  let used = 0;
  const fit = new Set<string>();
  for (const doc of docs) {
    if (used + doc.text.length > budget) continue;
    used += doc.text.length;
    fit.add(doc.source);
  }
  return fit;
}

/** Tidies text the way the intake does: single spaces, one line per block, no blank runs. */
export function tidy(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\f\v]+/g, " ")
      // A run of whitespace with a line break in it becomes one line break. Matched as whole runs, as /\s*\n\s*/
      // would try every place in a long run of other spaces, such as no-break spaces, and take seconds.
      .replace(/\s+/g, (run) => (run.includes("\n") ? "\n" : run))
      .trim()
  );
}

/**
 * Reads a help page by its address. Navigation, headers, footers, scripts and
 * forms are left out, each block of text ends a line, and when the page has a
 * main or article element only that is kept, as `npm run tag` does with --docs.
 *
 * No more than MAX_PAGE_BYTES of it is read, whatever length it gives, since a
 * site that streams a page for ever would otherwise use up the Worker's memory.
 * A text file is all doc, so one longer than that is refused. A web page is
 * mostly scripts, styles and navigation, sometimes with images written into it,
 * so one longer than that is read that far, and kept if its article had ended
 * by then. One whose article runs on past it, or that has none, is refused,
 * rather than kept cut short.
 */
export async function docFromUrl(url: URL): Promise<Doc> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html, text/plain, text/markdown" }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`The page answered ${response.status}.`);
  const type = response.headers.get("content-type") ?? "";
  const source = response.url || url.href;
  // Reading stops at the limit whether the page said how long it is or not, and `cut` says it did.
  let cut = false;
  const page = capped(response, MAX_PAGE_BYTES, () => void (cut = true));

  if (!type.includes("html")) {
    if (!/text\/(plain|markdown)/.test(type)) throw new Error("That address is not a web page or a text file.");
    if (Number(response.headers.get("content-length") ?? 0) > MAX_PAGE_BYTES) throw new Error(TOO_LARGE);
    const raw = await page.text();
    if (cut) throw new Error(TOO_LARGE);
    const text = tidy(raw);
    const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
    return { title: heading || new URL(source).pathname, source, text };
  }

  let skipping = 0;
  let inMain = 0;
  /** A main or article element has ended, so `main` holds all of it. */
  let mainEnded = false;
  let title = "";
  let heading = "";
  let readingHeading = false;
  const all: string[] = [];
  const main: string[] = [];
  const add = (chunk: string) => {
    if (skipping) return;
    all.push(chunk);
    if (inMain) main.push(chunk);
  };
  const rewriter = new HTMLRewriter()
    .on("title", { text: (chunk) => void (title += chunk.text) })
    .on("script, style, noscript, template, nav, header, footer, aside, svg, form, button", {
      element(el) {
        skipping++;
        el.onEndTag(() => void skipping--);
      },
    })
    .on("main, article, [role='main']", {
      element(el) {
        inMain++;
        el.onEndTag(() => {
          inMain--;
          if (!inMain) mainEnded = true;
        });
      },
    })
    .on("h1", {
      element(el) {
        if (heading) return;
        readingHeading = true;
        el.onEndTag(() => void (readingHeading = false));
      },
      text(chunk) {
        if (readingHeading) heading += chunk.text;
      },
    })
    // Block elements end a line, so headings and list items do not run together.
    .on("p, li, h1, h2, h3, h4, h5, h6, tr, br, div, pre, blockquote, dt, dd, section", {
      element(el) {
        add("\n");
        el.onEndTag(() => add("\n"));
      },
    })
    .onDocument({ text: (chunk) => add(chunk.text) });
  await rewriter.transform(page).arrayBuffer();
  // A page cut short was read up to the limit, all of it, so an article that had ended by then is whole.
  if (cut && (inMain || !mainEnded || !main.join("").trim())) throw new Error(TOO_LARGE);
  const text = tidy((main.join("").trim() ? main : all).join(""));
  return { title: tidy(heading) || tidy(title) || new URL(source).pathname, source, text };
}

/** A doc someone pasted. Its source is a made-up address, so it can be told apart and removed. */
export function pastedDoc(title: string, text: string): Doc {
  return { title: tidy(title).slice(0, 120), source: `pasted:${crypto.randomUUID()}`, text: tidy(text) };
}
