import { cleanText, isLearnableLabel, normalizePath, type OutlineReport, type PageNode, type PageOpening, type PageOutline, type SiteContext } from "../shared/types.ts";

// The site map Haptic learns from real visits, beside the one the crawl built.
//
// The widget sends an outline of each page it sees (src/widget/learn.ts). Each
// label in it is counted by distinct visitor: the widget keeps a random id,
// and the server keeps only a hash of it made with the site's id, so the same
// visitor is a different value on every site. Each label keeps up to ten of
// those hashes. A label reaches the prompt only once enough different visitors
// have seen it, so one person's own data, like the name of their project,
// never does, while the product's own buttons do.
//
// The crawl's pages come first. What was learned fills in what the crawl
// could not see: pages behind a sign-in, the way to a page that only a click
// in a dialog or a menu leads to, and what each menu, tab or accordion shows
// once a visitor opens it. Each item behind a control is counted on its own,
// so a menu reaches the prompt with only the items enough visitors saw.

export type LabelKind = "title" | "heading" | "link" | "button";

/** One learned label, as stored and as counted. */
export interface LearnedLabel {
  route: string;
  kind: LabelKind;
  label: string;
  /** Where a link leads. Empty for anything else. */
  href: string;
  /** Distinct visitors who sent it, up to ten. */
  visitors: number;
  /** Every time it was sent. Used to rank, never to decide. */
  seen: number;
}

/** A label as one outline gives it, before it is counted. */
export type LabelRow = Pick<LearnedLabel, "route" | "kind" | "label" | "href">;

/** One item a visitor saw behind a control, like "Contact support" behind "Help". A link has `href`, a button doesn't. */
export interface LearnedOpening {
  route: string;
  control: string;
  label: string;
  /** Where a link leads. Empty for a button or menu item. */
  href: string;
  visitors: number;
  seen: number;
}

export type OpeningRow = Pick<LearnedOpening, "route" | "control" | "label" | "href">;

/** How many different visitors must have seen a label before the prompt gets it. */
export function labelThreshold(env: Record<string, string | undefined>): number {
  const set = Number(env.HAPTIC_LABEL_THRESHOLD);
  if (Number.isInteger(set) && set >= 1) return set;
  return env.NODE_ENV === "production" || env.HAPTIC_PRODUCTION === "1" ? 3 : 1;
}

/** Each label keeps at most this many visitor hashes. Enough for any threshold we would use, and a bounded row. */
export const MAX_VISITORS = 10;
/** Pages that only traffic knows, beyond the crawl's. The most visited win. */
const MAX_LEARNED_ROUTES = 40;
/** Links learned for one page, beyond the crawl's. */
const MAX_LEARNED_LINKS = 20;
const MAX_HEADINGS = 12;
/** Controls with something behind them, per outline and per page in the prompt. */
const MAX_OPENINGS = 12;
/** Items behind one control. */
const MAX_OPENING_ITEMS = 30;

const label = (value: unknown): string => (typeof value === "string" ? cleanText(value, 61) : "");
const path = (value: unknown): string => (typeof value === "string" && value.startsWith("/") ? normalizePath(value.slice(0, 300)) : "");

/** A report from the widget, checked and cleaned again, or undefined when it isn't one. A page on a customer's site is untrusted input. */
export function parseOutlineReport(body: unknown): OutlineReport | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw = body as Record<string, unknown>;
  const outline = raw.outline as Record<string, unknown> | undefined;
  if (typeof raw.site !== "string" || !outline || typeof outline !== "object") return undefined;
  const route = path(outline.path);
  if (!route) return undefined;
  const list = (value: unknown, max: number) => (Array.isArray(value) ? value.slice(0, max) : []);
  const clean: PageOutline = {
    path: route,
    title: isLearnableLabel(label(outline.title)) ? label(outline.title) : "",
    headings: [...new Set(list(outline.headings, 12).map(label).filter(isLearnableLabel))],
    links: [],
    buttons: [...new Set(list(outline.buttons, 40).map(label).filter(isLearnableLabel))],
  };
  for (const item of list(outline.links, 60) as Record<string, unknown>[]) {
    const text = label(item?.label);
    const to = path(item?.to);
    if (isLearnableLabel(text) && to && !clean.links.some((link) => link.label === text && link.to === to)) clean.links.push({ label: text, to });
  }
  const opens: PageOpening[] = [];
  for (const item of list(outline.opens, MAX_OPENINGS) as Record<string, unknown>[]) {
    const control = label(item?.control);
    if (!isLearnableLabel(control) || opens.some((opening) => opening.control === control)) continue;
    const opening: PageOpening = { control, links: [], buttons: [] };
    for (const link of list(item.links, MAX_OPENING_ITEMS) as Record<string, unknown>[]) {
      const text = label(link?.label);
      const to = path(link?.to);
      if (isLearnableLabel(text) && to && !opening.links.some((known) => known.label === text && known.to === to)) opening.links.push({ label: text, to });
    }
    opening.buttons = [...new Set(list(item.buttons, MAX_OPENING_ITEMS).map(label).filter((text) => isLearnableLabel(text) && text !== control))];
    if (opening.links.length || opening.buttons.length) opens.push(opening);
  }
  if (opens.length) clean.opens = opens;
  const report: OutlineReport = { site: raw.site, outline: clean };
  if (typeof raw.visitor === "string" && /^[0-9a-f-]{36}$/.test(raw.visitor)) report.visitor = raw.visitor;
  return report;
}

/** An outline as the rows that are counted. The same label twice on one page counts once. */
export function outlineRows(outline: PageOutline): LabelRow[] {
  const rows = new Map<string, LabelRow>();
  const add = (kind: LabelKind, text: string, href = "") => rows.set(`${kind} ${text} ${href}`, { route: outline.path, kind, label: text, href });
  if (outline.title) add("title", outline.title);
  for (const heading of outline.headings) add("heading", heading);
  for (const link of outline.links) add("link", link.label, link.to);
  for (const button of outline.buttons) add("button", button);
  return [...rows.values()];
}

/** What a visitor saw behind each control, as the rows that are counted. */
export function openingRows(outline: PageOutline): OpeningRow[] {
  const rows = new Map<string, OpeningRow>();
  for (const opening of outline.opens ?? []) {
    const add = (text: string, href = "") => rows.set(`${opening.control} ${text} ${href}`, { route: outline.path, control: opening.control, label: text, href });
    for (const link of opening.links) add(link.label, link.to);
    for (const button of opening.buttons) add(button);
  }
  return [...rows.values()];
}

/**
 * What a visitor is counted as on one site: a hash of their widget's random id
 * with the site's id, so it means nothing anywhere else. The id is random, so
 * the hash can't be turned back into anything. A visitor whose browser keeps
 * no storage has no id and isn't counted at all: a hash of their network
 * address could be reversed by trying every address.
 */
export async function visitorHash(site: string, visitor: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${site} v:${visitor}`));
  return Array.from(new Uint8Array(digest).slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The site's pages with what traffic has taught Haptic merged in, for the
 * prompt's site map. Labels seen by fewer than `threshold` visitors are left
 * out. The crawl's pages keep their order and their own labels come first.
 *
 * How often a label was seen decides only whether it makes the cut. What is
 * kept is then listed in a fixed order, by page and label, because the site
 * map is part of the prompt the model provider keeps cached: if it reshuffled
 * every time a count went up, every step would pay to cache it again.
 */
export function mergeLearned(pages: PageNode[], labels: LearnedLabel[], threshold: number, openings: LearnedOpening[] = []): PageNode[] {
  const ranked = labels.filter((row) => row.visitors >= threshold).sort((a, b) => b.visitors - a.visitors || b.seen - a.seen);
  if (!ranked.length) return mergeOpenings(pages, openings, threshold);
  const crawled = new Set(pages.map((page) => page.path));
  const learnedRoutes = new Set<string>();
  const links = new Map<string, number>();
  const kept = ranked.filter((row) => {
    if (!crawled.has(row.route) && !learnedRoutes.has(row.route)) {
      if (learnedRoutes.size >= MAX_LEARNED_ROUTES) return false;
      learnedRoutes.add(row.route);
    }
    if (row.kind !== "link") return true;
    const count = links.get(row.route) ?? 0;
    links.set(row.route, count + 1);
    return count < MAX_LEARNED_LINKS;
  });
  const order: LabelKind[] = ["title", "heading", "link", "button"];
  kept.sort((a, b) => a.route.localeCompare(b.route) || order.indexOf(a.kind) - order.indexOf(b.kind) || a.label.localeCompare(b.label) || a.href.localeCompare(b.href));

  const byPath = new Map(pages.map((page) => [page.path, { ...page, headings: [...page.headings], links: [...page.links], buttons: [...page.buttons] }]));
  for (const route of [...learnedRoutes].sort()) byPath.set(route, { path: route, title: "", headings: [], links: [], buttons: [], fields: [] });
  for (const row of kept) {
    const page = byPath.get(row.route)!;
    if (row.kind === "title") page.title ||= row.label;
    else if (row.kind === "heading") {
      if (page.headings.length < MAX_HEADINGS && !page.headings.includes(row.label)) page.headings.push(row.label);
    } else if (row.kind === "button") {
      if (!page.buttons.includes(row.label)) page.buttons.push(row.label);
    } else if (row.href && !page.links.some((link) => link.label === row.label && link.to === row.href)) page.links.push({ label: row.label, to: row.href });
  }
  return mergeOpenings([...byPath.values()], openings, threshold);
}

/**
 * What enough visitors saw behind a control, added to its page's `opens`
 * beside what the crawl found there. A page nothing else told us about is
 * skipped: its own labels come first. Listed in a fixed order, for the same
 * reason as the labels.
 */
function mergeOpenings(pages: PageNode[], openings: LearnedOpening[], threshold: number): PageNode[] {
  const known = new Set(pages.map((page) => page.path));
  const ranked = openings.filter((row) => typeof row.control === "string" && row.control && row.visitors >= threshold && known.has(row.route)).sort((a, b) => b.visitors - a.visitors || b.seen - a.seen);
  if (!ranked.length) return pages;
  const controls = new Map<string, Map<string, number>>();
  const kept = ranked.filter((row) => {
    const onPage = controls.get(row.route) ?? new Map<string, number>();
    controls.set(row.route, onPage);
    const items = onPage.get(row.control);
    if (items === undefined && onPage.size >= MAX_OPENINGS) return false;
    onPage.set(row.control, (items ?? 0) + 1);
    return (items ?? 0) < MAX_OPENING_ITEMS;
  });
  kept.sort((a, b) => a.route.localeCompare(b.route) || a.control.localeCompare(b.control) || a.label.localeCompare(b.label) || a.href.localeCompare(b.href));
  return pages.map((page) => {
    const mine = kept.filter((row) => row.route === page.path);
    if (!mine.length) return page;
    const opens = (page.opens ?? []).map((opening) => ({ ...opening, links: [...opening.links], buttons: [...opening.buttons] }));
    for (const row of mine) {
      let opening = opens.find((item) => item.control === row.control);
      if (!opening) opens.push((opening = { control: row.control, links: [], buttons: [] }));
      if (row.href) {
        if (!opening.links.some((link) => link.label === row.label && link.to === row.href)) opening.links.push({ label: row.label, to: row.href });
      } else if (!opening.buttons.includes(row.label)) opening.buttons.push(row.label);
    }
    return { ...page, opens };
  });
}

/** The site with its learned labels merged into its pages. */
export function withLearned(site: SiteContext, labels: LearnedLabel[], threshold: number, openings: LearnedOpening[] = []): SiteContext {
  const pages = mergeLearned(site.pages, labels, threshold, openings);
  return pages === site.pages ? site : { ...site, pages };
}

/**
 * Learned labels kept in memory, for the server on a developer's machine
 * without a database. `save` and `restore` let the Node server keep them in a
 * file between restarts. The Worker never uses this.
 */
export class MemoryLearned {
  private readonly rows = new Map<string, Map<string, LabelRow & { visitors: Set<string>; seen: number }>>();
  private readonly opened = new Map<string, Map<string, OpeningRow & { visitors: Set<string>; seen: number }>>();

  record(site: string, visitor: string, outline: PageOutline) {
    const count = <Row extends object>(table: Map<string, Map<string, Row & { visitors: Set<string>; seen: number }>>, key: string, row: Row) => {
      const kept = table.get(site) ?? new Map();
      table.set(site, kept);
      const held = kept.get(key) ?? { ...row, visitors: new Set<string>(), seen: 0 };
      held.seen++;
      if (held.visitors.size < MAX_VISITORS) held.visitors.add(visitor);
      kept.set(key, held);
    };
    for (const row of outlineRows(outline)) count(this.rows, `${row.route} ${row.kind} ${row.label} ${row.href}`, row);
    for (const row of openingRows(outline)) count(this.opened, `${row.route} ${row.control} ${row.label} ${row.href}`, row);
  }

  labels(site: string): LearnedLabel[] {
    return [...(this.rows.get(site)?.values() ?? [])].map(({ visitors, ...row }) => ({ ...row, visitors: visitors.size }));
  }

  openings(site: string): LearnedOpening[] {
    return [...(this.opened.get(site)?.values() ?? [])].map(({ visitors, ...row }) => ({ ...row, visitors: visitors.size }));
  }

  /** Everything held, as plain data. Visitors are already hashed per site. */
  save(): SavedLearning {
    const dump = <Row>(table: Map<string, Map<string, Row & { visitors: Set<string>; seen: number }>>) =>
      Object.fromEntries([...table].map(([site, kept]) => [site, [...kept].map(([key, held]) => [key, { ...held, visitors: [...held.visitors] }])]));
    return { version: 1, labels: dump(this.rows), openings: dump(this.opened) } as SavedLearning;
  }

  /** Takes back what `save` gave. Anything that doesn't look right is skipped. */
  restore(saved: unknown) {
    if (!saved || typeof saved !== "object" || (saved as SavedLearning).version !== 1) return;
    const load = <Row>(from: unknown, into: Map<string, Map<string, Row & { visitors: Set<string>; seen: number }>>) => {
      if (!from || typeof from !== "object") return;
      for (const [site, entries] of Object.entries(from)) {
        if (!Array.isArray(entries)) continue;
        const kept = new Map<string, Row & { visitors: Set<string>; seen: number }>();
        for (const entry of entries) {
          if (!Array.isArray(entry) || typeof entry[0] !== "string" || !entry[1] || !Array.isArray(entry[1].visitors)) continue;
          kept.set(entry[0], { ...entry[1], visitors: new Set(entry[1].visitors.slice(0, MAX_VISITORS)), seen: Number(entry[1].seen) || 1 });
        }
        into.set(site, kept);
      }
    };
    load((saved as SavedLearning).labels, this.rows);
    load((saved as SavedLearning).openings, this.opened);
  }
}

/** What MemoryLearned keeps in its file. */
export interface SavedLearning {
  version: 1;
  labels: Record<string, [string, LabelRow & { visitors: string[]; seen: number }][]>;
  openings: Record<string, [string, OpeningRow & { visitors: string[]; seen: number }][]>;
}
