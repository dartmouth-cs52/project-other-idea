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
  /** The choices of a dropdown, as the page words them. Which one is chosen is never sent. */
  options?: string[];
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

/** The format a step is streamed in: one JSON value per line. The widget asks for it in its Accept header. */
export const STREAM_TYPE = "application/x-ndjson";

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
/** Digits written with the spaces and marks a phone number has. Whether it is one is decided in `maskNumbers`. */
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const LONG_DIGITS = /\d{5,}/g;
/** A date in figures, standing on its own among such digits: 2026-11-15, 15.11.2026, 11-15-26. */
const DATE = /(^|[\s(])(\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{1,2}[-.]\d{1,2}[-.](?:\d{4}|\d{2}))(?=$|[\s)])/g;
/** Fewer digits than this is a price, a size or a model number, not a phone number. */
const MIN_PHONE_DIGITS = 9;
/** A question names one or two things. More than this is not a question. */
const MAX_OWN = 8;

/**
 * What a visitor named in their own question that would otherwise be masked:
 * an email address, or a run of five or more digits such as an account or an
 * order number. The visitor wrote it, so the same thing on the page tells the
 * model nothing it was not already told, and is left readable. Only a whole
 * match counts: a number that merely ends or begins the same stays masked.
 */
export function namedIn(question: string): Set<string> {
  const found = new Set<string>();
  for (const email of question.match(EMAIL) ?? []) if (found.size < MAX_OWN) found.add(email.toLowerCase());
  for (const digits of question.replace(EMAIL, " ").match(LONG_DIGITS) ?? []) if (found.size < MAX_OWN) found.add(digits);
  return found;
}

/**
 * Masks phone numbers and long runs of digits. A date is left alone, and so
 * is a run of digits that is one of `own`, the things the visitor named.
 */
function maskNumbers(text: string, own?: ReadonlySet<string>): string {
  const whole = (piece: string): string => piece.replace(/\+?\d(?:[\d\s().-]*\d)?/, "[number]");
  // Digits set apart by spaces can be several numbers, like a row's account numbers. Each piece that is
  // one of the visitor's numbers stays, and every other piece goes. Digits joined by a dash, a dot or a
  // bracket are one number, so "13344-5566" goes whole: part of a number is never left readable.
  const around = (piece: string): string =>
    piece.replace(/\S+/g, (token) => (own?.has(token.replace(/^[(+]+|[),.;:]+$/g, "")) ? token : /\d/.test(token) ? whole(token) : token));
  const maskRun = (piece: string): string => {
    if (piece.replace(/\D/g, "").length < MIN_PHONE_DIGITS) return piece;
    return own?.size ? around(piece) : whole(piece);
  };
  return text
    .replace(PHONE, (candidate) => {
      let out = "";
      let from = 0;
      for (const date of candidate.matchAll(DATE)) {
        const start = date.index + (date[1] ?? "").length;
        out += maskRun(candidate.slice(from, start)) + (date[2] ?? "");
        from = start + (date[2] ?? "").length;
      }
      return out + maskRun(candidate.slice(from));
    })
    .replace(LONG_DIGITS, (digits) => (own?.has(digits) ? digits : "[number]"));
}

/** Collapse whitespace, mask emails and long numbers, cap the length. `own` is what must stay readable: see `namedIn`. */
export function cleanText(text: string, max = 80, own?: ReadonlySet<string>): string {
  const spaced = text.replace(/\s+/g, " ").trim();
  let masked = "";
  let from = 0;
  for (const email of spaced.matchAll(EMAIL)) {
    masked += maskNumbers(spaced.slice(from, email.index), own) + (own?.has(email[0].toLowerCase()) ? email[0] : "[email]");
    from = email.index + email[0].length;
  }
  masked += maskNumbers(spaced.slice(from), own);
  return masked.length > max ? masked.slice(0, max - 1).trimEnd() + "…" : masked;
}

/** How an element is named in events, history and change summaries. */
export function describeElement(element: Pick<SnapElement, "role" | "label" | "icon">): string {
  if (element.label) return `${element.role} "${element.label}"`;
  if (element.icon) return `${element.role} with ${element.icon} icon`;
  return element.role;
}
