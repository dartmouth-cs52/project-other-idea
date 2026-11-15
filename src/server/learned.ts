import { cleanText, isLearnableLabel, normalizePath, type OutlineReport, type PageNode, type PageOutline, type SiteContext } from "../shared/types.ts";

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
// could not see: pages behind a sign-in, and the way to a page that only a
// click in a dialog or a menu leads to.

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

/**
 * What a visitor is counted as on one site: a hash of their widget's id with
 * the site's id, so it means nothing anywhere else. A visitor whose browser
 * keeps no storage is counted by their network address, hashed the same way,
 * which can only make Haptic slower to learn, never quicker.
 */
export async function visitorHash(site: string, visitor: string | undefined, caller: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${site} ${visitor ? `v:${visitor}` : `n:${caller}`}`));
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
export function mergeLearned(pages: PageNode[], labels: LearnedLabel[], threshold: number): PageNode[] {
  const ranked = labels.filter((row) => row.visitors >= threshold).sort((a, b) => b.visitors - a.visitors || b.seen - a.seen);
  if (!ranked.length) return pages;
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
  return [...byPath.values()];
}

/** The site with its learned labels merged into its pages. */
export function withLearned(site: SiteContext, labels: LearnedLabel[], threshold: number): SiteContext {
  const pages = mergeLearned(site.pages, labels, threshold);
  return pages === site.pages ? site : { ...site, pages };
}

/**
 * Learned labels kept in memory, for the server on a developer's machine
 * without a database. Gone when the server stops.
 */
export class MemoryLearned {
  private readonly rows = new Map<string, Map<string, LabelRow & { visitors: Set<string>; seen: number }>>();

  record(site: string, visitor: string, outline: PageOutline) {
    const kept = this.rows.get(site) ?? new Map();
    this.rows.set(site, kept);
    for (const row of outlineRows(outline)) {
      const key = `${row.route} ${row.kind} ${row.label} ${row.href}`;
      const held = kept.get(key) ?? { ...row, visitors: new Set<string>(), seen: 0 };
      held.seen++;
      if (held.visitors.size < MAX_VISITORS) held.visitors.add(visitor);
      kept.set(key, held);
    }
  }

  labels(site: string): LearnedLabel[] {
    return [...(this.rows.get(site)?.values() ?? [])].map(({ visitors, ...row }) => ({ ...row, visitors: visitors.size }));
  }
}
