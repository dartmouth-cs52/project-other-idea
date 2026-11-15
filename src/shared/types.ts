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
  /** True switches Haptic off on this site: no launcher is drawn and the model is never called. */
  off?: boolean;
  /**
   * The most this site may spend on the model, in US dollars. Past it visitors
   * get a fixed sentence until the hour or the day turns. The server's own
   * limits apply to whatever is left out (see src/server/budget.ts).
   */
  budget?: {
    hour?: number;
    day?: number;
    /** Steps one visitor may take in a day. Meant for a public demo: in an office, everyone can share one address. */
    perCaller?: number;
  };
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
  /** Set when Haptic is switched off here. The widget then draws nothing. */
  off?: true;
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
  /** Made by the widget when the question is asked, and kept across page loads, so a guide's steps can be tied together. */
  guide?: string;
  goal: string;
  /** Steps already given in this guide. 0 for the first question. */
  step: number;
  history: HistoryTurn[];
  /** What the user did since the last step, in words. Absent on the first turn. */
  event?: string;
  /** What changed on the page since the last step, in words. */
  change?: string;
  /** True when what the user just did was something other than the step they were shown. */
  offTrack?: boolean;
  snapshot: Snapshot;
}

/**
 * How a guide ended, as the widget saw it. A guide that never reports one was
 * abandoned: the visitor closed the tab or walked away.
 *
 * Only "finished" is billed. Pricing (web/lib/site.ts) defines it as the
 * visitor using the last control Haptic pointed at, or reaching the screen
 * they asked for, and says a guide where Haptic cannot find the way is free.
 *
 * - finished: the visitor followed the steps and arrived, or used the control the last answer pointed at
 * - shown: the first answer pointed at something or explained, and the visitor did not use what it pointed at
 * - stopped: the visitor pressed Stop or closed the caption
 * - nothing_to_point_at: the model was stuck, or had nothing on the page to show
 * - loop: the same control was pointed at again with nothing changing
 * - step_limit: the guide ran out of steps
 * - error: a step failed
 */
export const GUIDE_OUTCOMES = ["finished", "shown", "stopped", "nothing_to_point_at", "loop", "step_limit", "error"] as const;
export type GuideOutcome = (typeof GUIDE_OUTCOMES)[number];

/** A guide id, as the widget makes it with crypto.randomUUID(). */
export const GUIDE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** What the widget sends when a guide ends, and again if the visitor says whether it helped. */
export interface GuideReport {
  site: string;
  outcome?: GuideOutcome;
  helped?: boolean;
}

/** A question as typed, made comparable: masked, lower case, no punctuation, single spaces. */
export function questionKey(question: string): string {
  return cleanText(question, 300)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\[\] ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The format a step is streamed in: one JSON value per line. The widget asks for it in its Accept header. */
export const STREAM_TYPE = "application/x-ndjson";

export interface TurnReply {
  /** Element id from the snapshot to point at, or null. */
  target: string | null;
  /**
   * "continue": the user must act on the target, then we go again.
   * "done": nothing left to do, because the goal is reached or the question only needed an answer.
   * "stuck": no way forward could be found. Kept apart from "done" because a guide that gets stuck is free.
   */
  status: "continue" | "done" | "stuck";
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
