import type { ControlName, Correction } from "./corrections.ts";

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
  /** What the crawl found. Pages are nodes, and their links and `opens` are edges, so this is a graph of the site. */
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
  /** Answers: replies in words from the help docs, beside the pointer. Off unless `enabled` is true. */
  answers?: AnswersConfig;
  /** Where a visitor is sent when Haptic can't help. Without it the widget offers nothing. */
  handoff?: Handoff;
  /** False stops the widget sending outlines of the pages it sees, so the site map is the crawl's alone. On unless set. */
  learn?: boolean;
  /** "Point here instead": steps the site's owner fixed from the dashboard. See src/shared/corrections.ts. */
  corrections?: Correction[];
  /** Controls Haptic must never point at, like "Delete workspace". Enforced by the server and the widget, not left to the prompt. */
  blocked?: ControlName[];
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
  /** Where a visitor can read it, when it has a public address. Shown under an answer that rests on it. */
  url?: string;
  /** The day it was last changed, like "2026-10-02", when that is known. Shown beside the link. */
  updated?: string;
}

/**
 * Answers lets one reply answer in words from the help docs, point, do both,
 * or say it can't help. A site without it gets exactly the guide it had
 * before: the same prompt and the same three fields in each reply.
 */
export interface AnswersConfig {
  enabled: boolean;
  /** An answer resting on an article last changed more than this many days ago is marked as possibly out of date. */
  staleAfterDays?: number;
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
  /**
   * What each menu, tab or accordion showed when the reader opened it. These
   * are the edges that take two clicks: the control first, then what it shows.
   * Only a reader that runs the page in a browser can fill this in.
   */
  opens?: PageOpening[];
}

export interface PageOpening {
  /** The label of the control that has to be clicked first. */
  control: string;
  /** Same-site links that appeared, and where each one leads. */
  links: { label: string; to: string }[];
  /** Buttons, tabs and menu items that appeared. */
  buttons: string[];
}

/**
 * The way to a person, for when Haptic can't help. Haptic does not keep an
 * inbox: it hands over to whatever the company already uses. Any of the three
 * can be set, and the widget uses the first it finds in this order: the form,
 * the page, the address.
 */
export interface Handoff {
  /** The words on the button. "Contact support" when left out. */
  label?: string;
  /** Where the widget's own short form (an email address and a note) is posted, with the conversation and the page. Only the server ever sees this address. */
  webhook?: string;
  /** If set, each post to the webhook is signed with it, so the receiver can tell the post came from Haptic. */
  secret?: string;
  /** A page to open instead, like the company's contact form. */
  url?: string;
  /** An address to write to. The visitor's own mail program opens, with the conversation in the message. */
  email?: string;
}

/** What the widget is told about the handoff. Never the webhook's address or its secret. */
export interface PublicHandoff {
  label: string;
  /** True when the widget should show its own form and post it to the server. */
  form?: true;
  url?: string;
  email?: string;
}

/** What the widget sends the server about the site on boot. */
export interface PublicSiteConfig {
  name: string;
  appearance: Appearance;
  /** Set when Haptic is switched off here. The widget then draws nothing. */
  off?: true;
  /** Set when the site has asked not to be learned from its visits. The widget then sends no outlines. */
  learn?: false;
  /** Controls Haptic must never point at. The widget checks every pointer against it. */
  blocked?: ControlName[];
  handoff?: PublicHandoff;
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
  /**
   * The random id the widget keeps in the browser (src/widget/learn.ts). The
   * server keeps only a hash of it made with the site's id, so the dashboard
   * can count people rather than questions. Never part of the prompt.
   */
  visitor?: string;
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
 * And on a site with Answers on, none of them billed:
 * - answered: the question was answered in words from the help docs
 * - not_covered, sensitive, off_topic: Haptic said it couldn't help, for that reason
 * And on any site:
 * - blocked: the step was a control the site's owner said never to point at, so Haptic said it can't help with that here
 */
export const GUIDE_OUTCOMES = ["finished", "shown", "stopped", "nothing_to_point_at", "loop", "step_limit", "error", "answered", "not_covered", "sensitive", "off_topic", "blocked"] as const;
export type GuideOutcome = (typeof GUIDE_OUTCOMES)[number];

/** A guide id, as the widget makes it with crypto.randomUUID(). */
export const GUIDE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * What the widget sends about a page it has seen, once per page per tab, so
 * Haptic learns the site from real visits as well as from the crawl. Labels
 * only: never what is typed into a field, never what is in a table's cells,
 * and with emails and numbers masked. A label reaches the prompt only once
 * several different visitors have sent it (see src/server/learned.ts).
 */
export interface PageOutline {
  /** Normalized, like /orders/:id. */
  path: string;
  title: string;
  headings: string[];
  /** Same-site links, and controls a click on which led to another page, like "View, in a dialog". */
  links: { label: string; to: string }[];
  /** Buttons, tabs and menu items. An icon-only one is named by its icon, like "icon:share-2". */
  buttons: string[];
  /** What a menu, tab or accordion showed when a visitor opened it, in the same shape the crawl uses. */
  opens?: PageOpening[];
}

/** What the widget posts to /v1/outline. */
export interface OutlineReport {
  site: string;
  /** A random id the widget keeps in the site's localStorage. The server keeps only a hash of it, made per site. */
  visitor?: string;
  outline: PageOutline;
}

/**
 * True for a label worth learning: short, with a letter in it, and with
 * nothing masked. A label that held an email address or a long number was
 * about one person, so it is dropped whole rather than kept with a hole in it.
 */
export function isLearnableLabel(label: string): boolean {
  if (!label || label.length > 60) return false;
  if (/\[(?:email|number)\]/.test(label)) return false;
  return /\p{L}/u.test(label);
}

/** What the widget sends when a guide ends, again if the visitor says whether it helped, and again if they ask for a person. */
export interface GuideReport {
  site: string;
  outcome?: GuideOutcome;
  helped?: boolean;
  /** The visitor used the way to a person. */
  handoff?: true;
}

/** One line of the conversation, as it is handed to a person. */
export interface TranscriptTurn {
  role: "user" | "assistant";
  text: string;
  /** For Haptic's lines on a site with Answers on: what kind of reply it was. */
  kind?: Mode;
}

/** What the widget's handoff form posts. The server passes it on to the company and keeps none of it. */
export interface HandoffRequest {
  site: string;
  guide?: string;
  /** Where the company should reply. */
  email: string;
  note: string;
  /** The page the visitor is on. */
  path: string;
  transcript: TranscriptTurn[];
}

/**
 * The longest question the server takes. The ask box holds 300 characters, and
 * the widget masks what it sends, which can make it longer: "12345" becomes
 * "[number]". This leaves room for that.
 */
export const MAX_ASKED = 450;

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

/**
 * What kind of reply this is, on a site with Answers on.
 * - guide: a step, as before. A control to point at and a sentence.
 * - answer: one to four sentences from the help docs, with the articles they rest on. It may point as well.
 * - cannot_help: nothing to say or show. The visitor reads a fixed sentence chosen by the reason.
 */
export const MODES = ["guide", "answer", "cannot_help"] as const;
export type Mode = (typeof MODES)[number];

/**
 * Why Haptic can't help.
 * - not_covered: about this product, and neither the help docs nor the page give the answer
 * - sensitive: prices, refunds, billing disputes, legal or medical matters, deadlines, or the visitor's own account. Never decided by the model.
 * - off_topic: nothing to do with this site, or a question about Haptic's own instructions
 */
export const REASONS = ["not_covered", "sensitive", "off_topic"] as const;
export type Reason = (typeof REASONS)[number];

/** A help article an answer rests on, as the visitor is shown it. */
export interface Source {
  title: string;
  url?: string;
  updated?: string;
  /** Set when the article is older than the site's limit, so the answer may be out of date. */
  stale?: true;
}

export interface TurnReply {
  /** Element id from the snapshot to point at, or null. */
  target: string | null;
  /**
   * "continue": the user must act on the target, then we go again.
   * "done": nothing left to do, because the goal is reached or the question only needed an answer.
   * "stuck": no way forward could be found. Kept apart from "done" because a guide that gets stuck is free.
   * A reply that says Haptic cannot help is "stuck" as well.
   */
  status: "continue" | "done" | "stuck";
  /** A step's one or two sentences, an answer's one to four, or the fixed sentence for something Haptic can't help with. */
  say: string;
  /**
   * True when the server answered without asking the model, because the site
   * is switched off or has spent its budget. The guide stopped there: it did
   * not finish, and there is nothing to ask the visitor about.
   */
  paused?: true;
  /** True when the model named a control the site's owner has ruled out. The pointer stays put and `say` is the fixed sentence. */
  blocked?: true;
  /** Only on a site with Answers on. */
  mode?: Mode;
  /** Only with mode "cannot_help". */
  reason?: Reason;
  /** Only with mode "answer": the articles the answer rests on. Never empty. */
  sources?: Source[];
  /**
   * Only with mode "answer": labels of controls the answer tells the visitor
   * to use that are on neither the page they are looking at nor any other page
   * Haptic knows. The help article that names them may be out of date. The
   * page is in hand when the answer is written, so this is checked, not guessed.
   */
  missing?: string[];
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

/** A phone number or a long number anywhere in a segment: "415-555-0132", "+14155550132", "2024-001234". Masked like the page's text is. */
const NUMBER_IN_SEGMENT = /\d{5,}|\+?\d[\d\s().-]{7,}\d/;

function isIdSegment(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (NUMBER_IN_SEGMENT.test(segment)) return true;
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
