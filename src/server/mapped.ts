import { MAPPING_PASS } from "../shared/mapping.ts";
import { cleanText, isLearnableLabel, normalizePath, type MapReport, type PageNode, type PageOpening } from "../shared/types.ts";

// Pages mapped from a signed-in browser at the company (src/widget/map.ts).
//
// Someone at the company starts it from the dashboard, and the widget in
// their own tab goes through the app: each page's labels, what each menu, tab
// and dialog showed, and where a button led. It arrives with a pass only the
// dashboard hands out, so unlike what is learned from visits it is trusted at
// once and goes straight into the site's pages.
//
// It is still checked and cleaned here. The pass says who sent it, not that
// what they sent is well formed.

/** Pages a site may hold in all: the public ones and the mapped ones. Past it, known pages are still updated and new ones are not added. */
export const MAX_SITE_PAGES = 80;
const MAX_LINKS = 60;
const MAX_BUTTONS = 40;
const MAX_FIELDS = 30;
const MAX_OPENINGS = 16;

const label = (value: unknown): string => (typeof value === "string" ? cleanText(value, 61) : "");
const path = (value: unknown): string => (typeof value === "string" && value.startsWith("/") ? normalizePath(value.slice(0, 300)) : "");
const list = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(0, max) : []);
const labels = (value: unknown, max: number): string[] => [...new Set(list(value, max).map(label).filter(isLearnableLabel))];

function links(value: unknown, max: number): { label: string; to: string }[] {
  const found: { label: string; to: string }[] = [];
  for (const item of list(value, max) as Record<string, unknown>[]) {
    const text = label(item?.label);
    const to = path(item?.to);
    if (isLearnableLabel(text) && to && !found.some((link) => link.label === text && link.to === to)) found.push({ label: text, to });
  }
  return found;
}

/** A report from the widget, checked and cleaned, or undefined when it isn't one. */
export function parseMapReport(body: unknown): MapReport | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw = body as Record<string, unknown>;
  if (typeof raw.site !== "string" || typeof raw.pass !== "string" || !MAPPING_PASS.test(raw.pass)) return undefined;
  const report: MapReport = { site: raw.site, pass: raw.pass };
  if (raw.page === undefined) return report;
  const from = raw.page as Record<string, unknown>;
  if (!from || typeof from !== "object") return undefined;
  const route = path(from.path);
  if (!route) return undefined;
  const page: PageNode = {
    path: route,
    title: isLearnableLabel(label(from.title)) ? label(from.title) : "",
    headings: labels(from.headings, 12),
    links: links(from.links, MAX_LINKS),
    buttons: labels(from.buttons, MAX_BUTTONS),
    fields: labels(from.fields, MAX_FIELDS),
    mapped: true,
  };
  const opens: PageOpening[] = [];
  for (const item of list(from.opens, MAX_OPENINGS) as Record<string, unknown>[]) {
    const control = label(item?.control);
    if (!isLearnableLabel(control) || opens.some((opening) => opening.control === control)) continue;
    const opening: PageOpening = { control, links: links(item.links, 30), buttons: labels(item.buttons, 20) };
    const fields = labels(item.fields, 20);
    if (fields.length) opening.fields = fields;
    if (opening.links.length || opening.buttons.length || fields.length) opens.push(opening);
  }
  if (opens.length) page.opens = opens;
  report.page = page;
  return report;
}

/**
 * The site's pages with one mapped page put in. A page already known keeps
 * what it had and gains what is new, because the widget sends a page again as
 * it finds more on it, and the public reading may have seen the same path
 * signed out. Returns the same list when the site is full and the page is new.
 */
export function mergeMapped(pages: PageNode[], page: PageNode): PageNode[] {
  const at = pages.findIndex((known) => known.path === page.path);
  if (at < 0) return pages.length >= MAX_SITE_PAGES ? pages : [...pages, page].sort((a, b) => a.path.localeCompare(b.path));
  const known = pages[at]!;
  const union = (a: string[], b: string[], max: number) => [...new Set([...a, ...b])].slice(0, max);
  const merged: PageNode = {
    ...known,
    // The signed-in view of a page is the one visitors with the widget see.
    title: page.title || known.title,
    headings: page.headings.length ? page.headings : known.headings,
    links: [...known.links, ...page.links.filter((link) => !known.links.some((had) => had.label === link.label && had.to === link.to))].slice(0, MAX_LINKS),
    buttons: union(known.buttons, page.buttons, MAX_BUTTONS),
    fields: union(known.fields, page.fields, MAX_FIELDS),
    mapped: true,
  };
  const opens = [...(known.opens ?? []).filter((had) => !page.opens?.some((opening) => opening.control === had.control)), ...(page.opens ?? [])].slice(0, MAX_OPENINGS);
  if (opens.length) merged.opens = opens;
  return pages.map((item, index) => (index === at ? merged : item));
}
