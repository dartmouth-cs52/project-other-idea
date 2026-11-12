// Shapes shared by the widget (browser), the server and the intake CLI.
// No DOM or Node APIs here.

/** Everything we know about one customer site. Stored as data/sites/<id>.json. */
export interface SiteContext {
  version: 1;
  /** Public id that goes in the script tag. Not a secret: allowedOrigins is what restricts it. */
  id: string;
  name: string;
  /** Origin the site was crawled from, e.g. "https://app.acme.com". */
  origin: string;
  /** Origins the widget may call the API from. */
  allowedOrigins: string[];
  appearance: Appearance;
  /** Free-form notes from the company about their product. */
  notes: string;
  /** Help docs the company supplied. */
  docs: Doc[];
  /** What the crawl found. Pages are nodes and their links are edges, so this is already a graph. */
  pages: PageNode[];
  /** The inputs this was built from, so `refresh` can rebuild it unattended. */
  source: SiteSource;
  createdAt: string;
  updatedAt: string;
}

export interface SiteSource {
  url: string;
  maxPages: number;
  notesFile?: string;
  /** File paths, directories or URLs. */
  docs: string[];
}

export interface Appearance {
  /** Hex color for the pointer and its highlight. */
  accent: string;
  position: "bottom-right" | "bottom-left";
  launcherLabel: string;
}

export const DEFAULT_APPEARANCE: Appearance = { accent: "#1E6EF4", position: "bottom-right", launcherLabel: "Ask" };

export interface Doc {
  title: string;
  /** The file path or URL it came from. */
  source: string;
  text: string;
}

export interface PageNode {
  /** Normalized path: ids collapsed to ":id", no query string. */
  path: string;
  title: string;
  description?: string;
  headings: string[];
  /** Same-site links: where each one leads. */
  links: { label: string; to: string }[];
  buttons: string[];
  /** Labels of form fields. */
  fields: string[];
}

/** What the widget sends the server about the site on boot. */
export interface PublicSiteConfig {
  name: string;
  appearance: Appearance;
}

export interface SnapElement {
  /** Short handle like "e12", valid for one snapshot only. */
  id: string;
  /** link, button, textbox, checkbox, select, tab, menuitem, clickable, ... */
  role: string;
  label: string;
  /** Icon name when the class gives one away, e.g. "settings" from lucide-settings. */
  icon?: string;
  /** "disabled", "expanded", "collapsed", "current", "checked", "selected". */
  state?: string[];
  /** Normalized path for same-site links, "external:host" for others. */
  href?: string;
  /** Landmark and nearest heading above it, e.g. "nav › Account". */
  context?: string;
  /** Set when the element is scrolled out of view. */
  offscreen?: "above" | "below";
}

export interface Snapshot {
  path: string;
  title: string;
  /** Label of the open modal dialog. When set, only its elements are listed. */
  dialog?: string;
  headings: string[];
  /** Short visible text blocks, masked and capped. Never form values. */
  text: string[];
  elements: SnapElement[];
  truncated: boolean;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export interface TurnRequest {
  site: string;
  goal: string;
  /** Steps already given in this guide. 0 for the first question. */
  step: number;
  history: HistoryTurn[];
  /** What the user did since the last step, in words. Absent on the first turn. */
  event?: string;
  /** What changed on the page since the last step, in words. */
  change?: string;
  snapshot: Snapshot;
}

export interface TurnReply {
  /** Element id from the snapshot to point at, or null. */
  target: string | null;
  /** "continue": the user must act on the target, then we go again. "done": nothing left to wait for. */
  status: "continue" | "done";
  /** One or two sentences shown next to the pointer. */
  say: string;
}

// Paths ---------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Collapse ids so every user's /orders/8812 counts as the same page, /orders/:id. */
export function normalizePath(input: string): string {
  const withoutOrigin = input.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "");
  const pathOnly = withoutOrigin.split(/[?#]/)[0] ?? "";
  const segments = pathOnly
    .split("/")
    .filter(Boolean)
    .map((segment) => (isIdSegment(safeDecode(segment)) ? ":id" : segment));
  return "/" + segments.join("/");
}

function isIdSegment(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (UUID.test(segment)) return true;
  if (segment.includes("@")) return true;
  if (/^[0-9a-f]{8,}$/i.test(segment) && /\d/.test(segment)) return true;
  // Mixed tokens like cus_9f8a7sd6f. Words with a small suffix ("step-3") stay.
  if (segment.length >= 10 && /\d/.test(segment) && /[a-z]/i.test(segment)) return segment.replace(/\D/g, "").length >= 3;
  return false;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// Text ----------------------------------------------------------------------

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const LONG_DIGITS = /\d{5,}/g;

/** Collapse whitespace, mask emails and long numbers, cap the length. */
export function cleanText(text: string, max = 80): string {
  const masked = text.replace(/\s+/g, " ").trim().replace(EMAIL, "[email]").replace(PHONE, "[number]").replace(LONG_DIGITS, "[number]");
  return masked.length > max ? masked.slice(0, max - 1).trimEnd() + "…" : masked;
}

/** How an element is named in events, history and change summaries. */
export function describeElement(element: Pick<SnapElement, "role" | "label" | "icon">): string {
  if (element.label) return `${element.role} "${element.label}"`;
  if (element.icon) return `${element.role} with ${element.icon} icon`;
  return element.role;
}
