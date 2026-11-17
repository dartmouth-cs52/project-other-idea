// Turns what the reader saw of a page into what Haptic keeps of it. Kept apart
// from reader.ts because it needs no browser and no Worker runtime, so the
// server's own tests can run it.

import { cleanText, normalizePath, type PageNode, type PageOpening } from "../../src/shared/types";
import type { RawOutline } from "./outline";

/** Most menus, tabs and accordions kept for one page, each with what it showed. */
const MAX_OPENINGS = 12;

/** Turns a raw outline into the PageNode the server's prompt reads, masked and capped like the intake crawl. */
export function toPageNode(url: string, raw: RawOutline): { page: PageNode; found: string[]; controls: number } {
  const here = new URL(url);
  const found: string[] = [];
  /** Keeps this site's links, masked and capped, and notes each address as one more page to read. */
  const sameSiteLinks = (from: { label: string; href: string }[], max: number) => {
    const links = new Map<string, { label: string; to: string }>();
    for (const link of from) {
      if (!URL.canParse(link.href)) continue;
      const target = new URL(link.href);
      if (target.origin !== here.origin) continue;
      target.hash = "";
      found.push(target.href);
      const label = cleanText(link.label, 60);
      const to = normalizePath(target.pathname);
      if (label && links.size < max) links.set(`${label}|${to}`, { label, to });
    }
    return links;
  };
  const links = sameSiteLinks(raw.links, 60);
  const opens: PageOpening[] = [];
  for (const reveal of raw.reveals ?? []) {
    const control = cleanText(reveal.control, 60);
    const shown = { control, links: [...sameSiteLinks(reveal.links, 30).values()], buttons: [...new Set(reveal.buttons.map((text) => cleanText(text, 60)).filter(Boolean))].slice(0, 20) };
    if (control && (shown.links.length || shown.buttons.length) && opens.length < MAX_OPENINGS) opens.push(shown);
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
  if (opens.length) page.opens = opens;
  const behind = opens.reduce((sum, opening) => sum + opening.links.length + opening.buttons.length, 0);
  return { page, found, controls: links.size + page.buttons.length + page.fields.length + behind };
}
