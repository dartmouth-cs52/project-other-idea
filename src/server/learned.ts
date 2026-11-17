import { cleanText, isLearnableLabel, isLearnableRoute, normalizePath, type OutlineReport, type PageNode, type PageOpening, type PageOutline, type SiteContext } from "../shared/types.ts";

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
//
// Anyone can post an outline: the site's id is in its script tag, and the
// widget's random id is whatever the caller says it is. So three things hold
// whoever sent it. A label or a path that could act on the prompt is never
// kept, and never used if it was kept before (`isLearnableLabel`,
// `isLearnableRoute`), and the site map defuses anything shaped like a tag as
// it is written into the prompt (`renderSiteMap`). Visitors are also counted
// by the network they called from, which a caller cannot make up, so one
// machine with many ids is still one (`networkHash`). And the prompt's rules
// say the whole site map is data, never instructions.
//
// None of this makes a label true. Callers on three networks, which are
// cheap to rent, can still teach Haptic a button that is not there, or a
// sentence of up to 60 characters. What they can no longer do is put it
// anywhere but inside the site map, among the labels.

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
  /** Distinct networks they called from, up to ten. Absent on a row counted before networks were. */
  networks?: number;
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
  networks?: number;
  seen: number;
}

export type OpeningRow = Pick<LearnedOpening, "route" | "control" | "label" | "href">;

/** How many different visitors must have seen a label before the prompt gets it. */
export function labelThreshold(env: Record<string, string | undefined>): number {
  const set = Number(env.HAPTIC_LABEL_THRESHOLD);
  if (Number.isInteger(set) && set >= 1) return set;
  return env.NODE_ENV === "production" || env.HAPTIC_PRODUCTION === "1" ? 3 : 1;
}

/**
 * How many different networks those visitors must have called from. Online it
 * is the same three, so three ids made up on one machine teach nothing. On a
 * developer's machine every call comes from the same address, so it is none.
 * Never more than the visitors needed. `HAPTIC_NETWORK_THRESHOLD=0` stops
 * counting networks, for a server whose callers all arrive from one address.
 */
export function networkThreshold(env: Record<string, string | undefined>): number {
  const set = env.HAPTIC_NETWORK_THRESHOLD?.trim() ? Number(env.HAPTIC_NETWORK_THRESHOLD) : NaN;
  const wanted = Number.isInteger(set) && set >= 0 ? set : env.NODE_ENV === "production" || env.HAPTIC_PRODUCTION === "1" ? 3 : 0;
  return Math.min(wanted, labelThreshold(env));
}

/** What a label needs before the prompt gets it. A bare number is that many visitors, from anywhere. */
export interface LabelNeeds {
  visitors: number;
  networks: number;
}

export function labelNeeds(env: Record<string, string | undefined>): LabelNeeds {
  return { visitors: labelThreshold(env), networks: networkThreshold(env) };
}

/** Each label keeps at most this many visitor hashes, and as many network hashes. Enough for any threshold we would use, and a bounded row. */
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
/** A page's path, normalized, or nothing when it is not one a browser could have sent. */
const path = (value: unknown): string => {
  if (typeof value !== "string" || !value.startsWith("/")) return "";
  const route = normalizePath(value.slice(0, 300));
  return isLearnableRoute(route) ? route : "";
};

/**
 * A report from the widget, checked and cleaned again, or undefined when it
 * isn't one. A page on a customer's site is untrusted input, and so is the
 * caller: what arrives need not have come from the widget at all.
 */
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
 * no storage has no id and isn't counted at all.
 */
export async function visitorHash(site: string, visitor: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${site} v:${visitor}`));
  return hex(digest, 12);
}

const hex = (bytes: ArrayBuffer, count: number): string => Array.from(new Uint8Array(bytes).slice(0, count), (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * The network a caller's address belongs to, which is what is counted: an
 * IPv4 address whole, and the first three groups (the /48) of an IPv6 one.
 * One subscriber can be handed a whole /48 to use as they like, so anything
 * smaller would let one home count as thousands of networks. Nothing for what
 * is not an address.
 */
export function networkOf(address: string): string | undefined {
  const bare = address.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const four = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  if (four) return four.slice(1).every((part) => Number(part) <= 255) ? four.slice(1).map(Number).join(".") : undefined;
  if (!/^[0-9a-f:]{2,39}$/.test(bare) || !bare.includes(":")) return undefined;
  const halves = bare.split("::");
  if (halves.length > 2) return undefined;
  const groups = (part: string) => (part ? part.split(":") : []);
  const [head, tail] = [groups(halves[0] ?? ""), groups(halves[1] ?? "")];
  const missing = 8 - head.length - tail.length;
  // Without "::" there are exactly eight groups. With it, it stands for at least one.
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const all = [...head, ...Array<string>(halves.length === 1 ? 0 : missing).fill("0"), ...tail];
  if (!all.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return undefined;
  return all.slice(0, 3).map((group) => parseInt(group, 16).toString(16)).join(":") + "::/48";
}

/**
 * What a caller's network is counted as on one site: the first two bytes of a
 * hash of it made with the site's id, or nothing when the address is not one.
 *
 * Two bytes is on purpose. An address is not random like the widget's id, and
 * there are few enough that a longer hash could be turned back by trying them
 * all. With two, about 65,000 IPv4 addresses (and billions of IPv6 networks)
 * share each value, so a stored one says nothing about where a visitor was.
 * It is still enough to count with: a label needs three of its networks to
 * differ, and three different networks share a value about once in 20,000
 * labels, which only means that label waits for a fourth. What one caller
 * cannot do is make one network look like three.
 */
export async function networkHash(site: string, address: string): Promise<string | undefined> {
  const network = networkOf(address);
  if (!network) return undefined;
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${site} n:${network}`)), 2);
}

/** Whether a row holds only what could be learned today. One stored before these checks existed may not. */
const sound = (row: { route: string; label: string; href: string; control?: string }): boolean =>
  isLearnableRoute(row.route) && isLearnableLabel(row.label) && (row.href === "" || isLearnableRoute(row.href)) && (row.control === undefined || isLearnableLabel(row.control));

const asNeeds = (needs: number | LabelNeeds): LabelNeeds => (typeof needs === "number" ? { visitors: needs, networks: 0 } : needs);
/** Enough visitors, from enough networks. */
const enough = (row: { visitors: number; networks?: number }, needs: LabelNeeds): boolean => row.visitors >= needs.visitors && (row.networks ?? 0) >= needs.networks;
/** The most widely seen first: by networks, which are the hardest to make up, then visitors, then sightings. */
const widest = (a: { visitors: number; networks?: number; seen: number }, b: { visitors: number; networks?: number; seen: number }): number =>
  (b.networks ?? 0) - (a.networks ?? 0) || b.visitors - a.visitors || b.seen - a.seen;

/**
 * The site's pages with what traffic has taught Haptic merged in, for the
 * prompt's site map. Labels seen by fewer visitors than `needs` asks for, or
 * from fewer networks, are left out, and so is any row that could not be
 * learned today. The crawl's pages keep their order and their own labels come first.
 *
 * How often a label was seen decides only whether it makes the cut. What is
 * kept is then listed in a fixed order, by page and label, because the site
 * map is part of the prompt the model provider keeps cached: if it reshuffled
 * every time a count went up, every step would pay to cache it again.
 */
export function mergeLearned(pages: PageNode[], labels: LearnedLabel[], needs: number | LabelNeeds, openings: LearnedOpening[] = []): PageNode[] {
  const asked = asNeeds(needs);
  const ranked = labels.filter((row) => enough(row, asked) && sound(row)).sort(widest);
  if (!ranked.length) return mergeOpenings(pages, openings, asked);
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
  return mergeOpenings([...byPath.values()], openings, asked);
}

/**
 * What enough visitors saw behind a control, added to its page's `opens`
 * beside what the crawl found there. A page nothing else told us about is
 * skipped: its own labels come first. Listed in a fixed order, for the same
 * reason as the labels.
 */
function mergeOpenings(pages: PageNode[], openings: LearnedOpening[], needs: LabelNeeds): PageNode[] {
  const known = new Set(pages.map((page) => page.path));
  const ranked = openings.filter((row) => typeof row.control === "string" && row.control && enough(row, needs) && known.has(row.route) && sound(row)).sort(widest);
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
export function withLearned(site: SiteContext, labels: LearnedLabel[], needs: number | LabelNeeds, openings: LearnedOpening[] = []): SiteContext {
  const pages = mergeLearned(site.pages, labels, needs, openings);
  return pages === site.pages ? site : { ...site, pages };
}

/** A row as MemoryLearned holds it: who saw it, and from where. */
type Held<Row> = Row & { visitors: Set<string>; networks: Set<string>; seen: number };

/**
 * Learned labels kept in memory, for the server on a developer's machine
 * without a database. `save` and `restore` let the Node server keep them in a
 * file between restarts. The Worker never uses this.
 */
export class MemoryLearned {
  private readonly rows = new Map<string, Map<string, Held<LabelRow>>>();
  private readonly opened = new Map<string, Map<string, Held<OpeningRow>>>();

  /** `visitor` and `network` are already hashed. A caller whose network is not known is counted as a visitor only. */
  record(site: string, visitor: string, outline: PageOutline, network?: string) {
    const count = <Row extends object>(table: Map<string, Map<string, Held<Row>>>, key: string, row: Row) => {
      const kept = table.get(site) ?? new Map<string, Held<Row>>();
      table.set(site, kept);
      const held = kept.get(key) ?? { ...row, visitors: new Set<string>(), networks: new Set<string>(), seen: 0 };
      held.seen++;
      if (held.visitors.size < MAX_VISITORS) held.visitors.add(visitor);
      if (network && held.networks.size < MAX_VISITORS) held.networks.add(network);
      kept.set(key, held);
    };
    for (const row of outlineRows(outline)) count(this.rows, `${row.route} ${row.kind} ${row.label} ${row.href}`, row);
    for (const row of openingRows(outline)) count(this.opened, `${row.route} ${row.control} ${row.label} ${row.href}`, row);
  }

  labels(site: string): LearnedLabel[] {
    return [...(this.rows.get(site)?.values() ?? [])].map(({ visitors, networks, ...row }) => ({ ...row, visitors: visitors.size, networks: networks.size }));
  }

  openings(site: string): LearnedOpening[] {
    return [...(this.opened.get(site)?.values() ?? [])].map(({ visitors, networks, ...row }) => ({ ...row, visitors: visitors.size, networks: networks.size }));
  }

  /** Everything held, as plain data. Visitors and networks are already hashed per site. */
  save(): SavedLearning {
    const dump = <Row>(table: Map<string, Map<string, Held<Row>>>) =>
      Object.fromEntries([...table].map(([site, kept]) => [site, [...kept].map(([key, held]) => [key, { ...held, visitors: [...held.visitors], networks: [...held.networks] }])]));
    return { version: 1, labels: dump(this.rows), openings: dump(this.opened) } as SavedLearning;
  }

  /** Takes back what `save` gave. Anything that doesn't look right is skipped. A file from before networks were counted has none. */
  restore(saved: unknown) {
    if (!saved || typeof saved !== "object" || (saved as SavedLearning).version !== 1) return;
    const load = <Row>(from: unknown, into: Map<string, Map<string, Held<Row>>>) => {
      if (!from || typeof from !== "object") return;
      for (const [site, entries] of Object.entries(from)) {
        if (!Array.isArray(entries)) continue;
        const kept = new Map<string, Held<Row>>();
        for (const entry of entries) {
          if (!Array.isArray(entry) || typeof entry[0] !== "string" || !entry[1] || !Array.isArray(entry[1].visitors)) continue;
          const networks: unknown[] = Array.isArray(entry[1].networks) ? entry[1].networks : [];
          kept.set(entry[0], {
            ...entry[1],
            visitors: new Set(entry[1].visitors.slice(0, MAX_VISITORS)),
            networks: new Set(networks.filter((item): item is string => typeof item === "string").slice(0, MAX_VISITORS)),
            seen: Number(entry[1].seen) || 1,
          });
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
  labels: Record<string, [string, LabelRow & { visitors: string[]; networks?: string[]; seen: number }][]>;
  openings: Record<string, [string, OpeningRow & { visitors: string[]; networks?: string[]; seen: number }][]>;
}
