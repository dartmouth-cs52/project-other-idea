import type { ControlName, Correction } from "./corrections.ts";
import type { TaughtRoute } from "./teach.ts";

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
  /** "Do it with me": whether Haptic may use the page's controls itself. Absent: it may not. */
  acting?: ActingSettings;
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
  /** Answers: replies in words from the help docs, beside the pointer. On for a site with help docs unless `enabled` is false (see answersOn). */
  answers?: AnswersConfig;
  /** Where a visitor is sent when Haptic can't help. Without it the widget offers nothing. */
  handoff?: Handoff;
  /** False stops the widget sending outlines of the pages it sees, so the site map is the crawl's alone. On unless set. */
  learn?: boolean;
  /** "Point here instead": steps the site's owner fixed from the dashboard. See src/shared/corrections.ts. */
  corrections?: Correction[];
  /** Controls Haptic must never point at, like "Delete workspace". Enforced by the server and the widget, not left to the prompt. */
  blocked?: ControlName[];
  /** "Teach Haptic": routes someone at the company showed Haptic by doing the task in their app. See src/shared/teach.ts. */
  taught?: TaughtRoute[];
  createdAt: string;
  updatedAt: string;
}

export interface SiteSource {
  url: string;
  maxPages: number;
  notesFile?: string;
  /** File paths, directories or URLs. */
  docs: string[];
  /** How the intake read the pages: in a browser, or as the HTML the server sends. Absent on sites built before there was a choice. */
  reader?: "browser" | "text";
  /** How many links away from the start the browser reader goes. */
  maxDepth?: number;
  /** Patterns for addresses or link labels the reader leaves alone. */
  skip?: string[];
  /** Path prefixes the reader stays inside. */
  within?: string[];
  /** More pages to start reading from. */
  also?: string[];
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
/**
 * Whether a site answers in words. A site that says so either way is taken at its word. Otherwise it is on
 * when the site has help docs, since those are what answers come from, and off without any, where it could
 * only ever say the docs don't cover it.
 */
export function answersOn(site: { answers?: AnswersConfig; docs?: readonly unknown[] }): boolean {
  return site.answers?.enabled ?? (site.docs?.length ?? 0) > 0;
}

export interface AnswersConfig {
  /** Left out, Answers is on when the site has help docs. */
  enabled?: boolean;
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
  /** Present only when the site has acting on. The widget shows the Do it button only then. */
  acting?: Omit<ActingSettings, "enabled">;
  /** Set when the site has asked not to be learned from its visits. The widget then sends no outlines. */
  learn?: false;
  /** Controls Haptic must never point at. The widget checks every pointer against it. */
  blocked?: ControlName[];
  handoff?: PublicHandoff;
}

// Acting ("do it with me") ----------------------------------------------------

/**
 * A company's settings for "do it with me", where Haptic uses the page's
 * controls itself while the visitor watches and always leaves the click that
 * commits to them. Off unless the company turns it on.
 */
export interface ActingSettings {
  enabled: boolean;
  /** Path prefixes where Haptic may act, like "/cards". Empty or absent: anywhere on the site's allowed origins. */
  paths?: string[];
  /** The company's own words for controls that commit, added to the built-in list: "Book", "Lodge claim". */
  commitWords?: string[];
  /** Most actions in one request. Default `ACTING_LIMITS.actions`; never more than `ACTING_LIMITS.actionsCeiling`. */
  maxActions?: number;
  /** Show the one-line explanation the first time a visitor uses Do it. Default true. */
  confirmFirst?: boolean;
}

/** The limits on acting, shared by the widget and the server. */
export const ACTING_LIMITS = {
  /** Actions in one request when the site sets none. */
  actions: 25,
  /** The most actions in one request any site may allow. */
  actionsCeiling: 40,
  /** Model turns in one acting request. Guides keep their own limit. */
  turns: 30,
  /** In act mode the server answers "done" once `step` passes the site's actions plus this. */
  stepAllowance: 10,
  /** Characters Haptic types in one request, all fields together. */
  typedChars: 400,
  /** Actions on one control with no change to the page in between. */
  sameControl: 2,
  /** "I couldn't do this one" hand-backs in a row before acting ends and the guide goes on as a guide. */
  failuresInARow: 3,
} as const;

/** How many actions a site allows in one request: its own number, kept between 1 and the ceiling, or the default. */
export function actionsAllowed(acting: Pick<ActingSettings, "maxActions"> | undefined): number {
  const asked = acting?.maxActions;
  if (typeof asked !== "number" || !Number.isFinite(asked)) return ACTING_LIMITS.actions;
  return Math.min(Math.max(Math.floor(asked), 1), ACTING_LIMITS.actionsCeiling);
}

/** Whether a page's path is one where the site lets Haptic act. No paths, or an empty list, means anywhere. */
export function actingAllowedAt(acting: Pick<ActingSettings, "paths"> | undefined, path: string): boolean {
  const prefixes = (acting?.paths ?? []).filter((prefix) => typeof prefix === "string" && prefix.trim());
  if (!prefixes.length) return true;
  return prefixes.some((prefix) => {
    const clean = "/" + prefix.trim().replace(/^\/+|\/+$/g, "");
    return clean === "/" || path === clean || path.startsWith(clean + "/") || path.startsWith(clean + "#") || path.startsWith(clean + "?");
  });
}

/** What Haptic does to the target itself, in act mode. `press_enter` is only for a search box that has no button. */
export const ACTS = ["click", "type", "choose", "check", "uncheck", "press_enter"] as const;
export type Act = (typeof ACTS)[number];

/**
 * Why Haptic did not do a step it was asked to do. The widget's gate gives one
 * with every step it declines, and the server counts the ones its own check
 * removed. Each is one rule of the gate (DESIGN section 4).
 */
export type Refusal =
  /** Rule 0: a press would land on something other than the control, its label or its own part. */
  | "covered"
  /** Rule 1: the company marked it `data-haptic-commit`, or its name holds one of the site's `commitWords`. */
  | "marked"
  /** Rule 1: inside `data-haptic-act="off"`. */
  | "off"
  /** Rule 2: a password, payment, one-time code, secret, file or type-to-confirm field, or a field in a confirmation. */
  | "secret"
  /** Rule 3: another origin, another tab or window, a download, or an address that is not a web page. */
  | "leaves"
  /** Rule 4: a native form submit, or a control the page marks as sending a write (`data-method`, `hx-post`, `data-confirm`, ...). */
  | "writes"
  /** Rule 5: a confirmation dialog is open. */
  | "confirmation"
  /** Rule 6: its words say it commits: delete, pay, sign out, send, save, export, reveal, ... */
  | "words"
  /** Rule 7: it is styled as destructive: red, or a toolkit's danger class. */
  | "styled"
  /** Rule 10: nothing says it is safe, so it is not acted on. */
  | "unknown"
  /** A field that may save the moment it changes: nothing around it waits for a later click. */
  | "live"
  /** The text to type, or the choice to pick, is not in the visitor's own words. */
  | "ungrounded"
  /** Enter, outside a search box and outside a list Haptic opened. */
  | "enter"
  /** The act does not fit the control, or is one Haptic does not do in this version (sliders, uploads, editors). */
  | "unfit"
  /** It picks a date: a day in a calendar, or a field the browser gives a date picker. Dates are not picked in this version. */
  | "date"
  /** The reply gave a `do` together with `commits: true`. Treated as a hand-over. */
  | "contradiction"
  /** 4.5: the commit deletes, spends, signs in or out, or reveals a secret, and the visitor asked for nothing of that kind. */
  | "class"
  /** The control is gone, or is no longer the one the reply named. The widget asks again. */
  | "changed"
  /** 4.2: a cap on actions, turns, typing or repeats was reached. */
  | "cap"
  /** The site, the page or the path does not allow acting, or the reply did not carry `mode: "act"`. */
  | "acting-off"
  /** After Haptic set a field, the page sent a request or showed a status at once: it may have saved. */
  | "tripwire"
  /** The engine did the step but could not see that it took, or could not do it at all. */
  | "failed";

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

/**
 * Which shape of turn request a widget sends. A widget from before the number
 * existed sends none, and counts as version 1. Version 2 is the first that
 * asks a closing question (`closing`) and sends the visitor's date (`today`).
 * Version 3 is the first that understands act replies (`ACT_VERSION`).
 * Raise it whenever a server would have to know what the widget in front of it
 * can do.
 */
export const TURN_VERSION = 3;
/** The first `TURN_VERSION` that understands act replies. A server reads `mode: "act"` only from a widget at this version or later. */
export const ACT_VERSION = 3;

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
  /** The widget's `TURN_VERSION`. Absent from a widget older than version 2. */
  version?: number;
  /** The date where the visitor is, as their own device has it, like "2026-11-15". The model is told it, so it need not guess the year. */
  today?: string;
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
  /** Set when the visitor has done what was called the last step, and this question is the look at what came of it. */
  closing?: true;
  /**
   * "act": the visitor pressed Do it, and Haptic may use the controls itself.
   * Read by a server only as this exact string, from a widget at `ACT_VERSION`
   * or later, on a site with acting on at this path. Absent: a guide.
   */
  mode?: "act";
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

/** How much of a question the widget sends: what the ask box holds. */
export const MAX_QUESTION = 300;
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

/**
 * One step. In a guide only `target`, `status` and `say` are used. In act mode
 * (the reply carries `mode: "act"`) the rest say what Haptic does:
 *
 * | Reply                                              | In act mode                                                       |
 * |----------------------------------------------------|-------------------------------------------------------------------|
 * | `continue` + target + `do`                         | Haptic does it, then asks again.                                  |
 * | `continue` + target, no `do`                       | The visitor does this one; acting resumes when they have.         |
 * | `done` + target + `commits: true`, no `do`         | The hand-over: the visitor makes the click that commits.          |
 * | `done`, no target                                  | Finished.                                                         |
 * | `stuck`, no target                                 | Nothing can be done: acting ends, as a stuck guide does.          |
 * | `do` together with `commits: true`                 | A contradiction, treated as the hand-over.                        |
 *
 * The model writes the fields in this order: target, do, enter, commits,
 * status, say. `target` stays first so the pointer can start early.
 *
 * On a site with Answers on, a guide's step can carry a `Mode` instead, with
 * `reason`, `sources` and `missing` (src/server/answers.ts). An act step never does.
 */
export interface TurnReply {
  /** Element id from the snapshot to point at, or null. */
  target: string | null;
  /** Act mode: what Haptic does to the target. Absent or null: the visitor uses the target, as in a guide. */
  do?: Act | null;
  /** The exact text to type or the choice to pick, written as the visitor wrote it. Null when there is nothing to enter. */
  enter?: string | null;
  /** Using the target saves, sends, submits, pays, approves, deletes, signs in or out, invites, issues or publishes. */
  commits?: boolean;
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
  /**
   * Set by the server when its own check (`checkAction`) removed the `do` the
   * model gave: why. `say` then describes an action that was not taken, so the
   * widget speaks for that step in its own words instead.
   */
  withheld?: Refusal;
  /** Set with `withheld`: the `do` that was removed. A name from `ACTS`, never anything from the page, so it can be logged and shown in a test run. */
  removed?: Act;
  /** True when the model named a control the site's owner has ruled out. The pointer stays put and `say` is the fixed sentence. */
  blocked?: true;
  /**
   * "act": set by a server that answered in act mode. The widget acts only on a reply that carries it.
   * A `Mode`: only on a site with Answers on, for a guide's step.
   */
  mode?: Mode | "act";
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

/**
 * Collapse ids so every user's /orders/8812 counts as the same page, /orders/:id.
 * Path parameters, the ";name=value" a server can add to a segment, are dropped:
 * one that adds the session to every link (";jsessionid=…") would otherwise give
 * one page a new address for every visitor.
 */
export function normalizePath(input: string): string {
  const withoutOrigin = input.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "");
  const pathOnly = (withoutOrigin.split(/[?#]/)[0] ?? "").replace(/;[^/;=]+=[^/;]*/g, "");
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

// Dates ---------------------------------------------------------------------

/** The date on this device's own clock and in its own time zone, as "2026-11-15". */
export function localDate(now: Date = new Date()): string {
  const two = (part: number) => String(part).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

// Text ----------------------------------------------------------------------

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** Digits written with the spaces and marks a phone number has. Whether it is one is decided in `maskNumbers`. */
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const LONG_DIGITS = /\d{5,}/g;
/** A date in figures, standing on its own among such digits: 2026-11-15, 15.11.2026, 11-15-26. Only a real one is left readable (`isRealDate`). */
const DATE = /(^|[\s(])(\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{1,2}[-.]\d{1,2}[-.](?:\d{4}|\d{2}))(?=$|[\s)])/g;

/**
 * Whether digits written as a date are one: a month from 1 to 12, a day from
 * 1 to 31, and a year of two figures or from 1800 to 2199. Year first is year,
 * month, day; otherwise day and month may come in either order. "12.34.5678"
 * and "12-34-5678" are not dates, and are masked as any other number is.
 */
function isRealDate(written: string): boolean {
  const parts = written.split(/[-.]/);
  const [first, second, third] = parts.map(Number) as [number, number, number];
  const month = (n: number) => n >= 1 && n <= 12;
  const day = (n: number) => n >= 1 && n <= 31;
  const year = (part: string) => part.length === 2 || (Number(part) >= 1800 && Number(part) <= 2199);
  if (parts[0]!.length === 4) return year(parts[0]!) && month(second) && day(third);
  return year(parts[2]!) && ((day(first) && month(second)) || (month(first) && day(second)));
}
/**
 * Digits written in groups, as a phone or card number is, are masked from this
 * many on. Eight, because a phone number in Norway, Denmark and Singapore has
 * eight ("912 34 567", "22 33 44 55"). Fewer is a price or a size.
 */
const MIN_PHONE_DIGITS = 8;
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
 * Masks phone numbers and long runs of digits. A real date is left alone, and
 * so is a run of digits that is one of `own`, the things the visitor named.
 * Digits that start right after a letter belong to a word, like the model
 * number in "Galaxy S II I9100 1.249,00 EUR", and what follows them is looked
 * at on its own; unless more of a number follows them: joined to it by a
 * dash, a dot or a bracket ("SSN123-45-6789", "D1234-56789-01234"), or
 * followed through single spaces by groups of plain digits that make eight or
 * more with them ("Card4111 1111 1111 1111", "Tel91 23 45 67"). Then they are
 * that number's first part, and it is masked whole. A run of five or more
 * digits in a row is masked all the same.
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
  const maskCandidate = (candidate: string): string => {
    let out = "";
    let from = 0;
    for (const date of candidate.matchAll(DATE)) {
      if (!isRealDate(date[2] ?? "")) continue;
      const start = date.index + (date[1] ?? "").length;
      out += maskRun(candidate.slice(from, start)) + (date[2] ?? "");
      from = start + (date[2] ?? "").length;
    }
    return out + maskRun(candidate.slice(from));
  };
  return text
    .replace(PHONE, (candidate: string, at: number, whole: string) => {
      if (at === 0 || !/\p{L}/u.test(whole[at - 1] ?? "")) return maskCandidate(candidate);
      const glued = /^\+?\d+/.exec(candidate)?.[0] ?? "";
      const rest = candidate.slice(glued.length);
      // Joined to more digits by a mark: one number glued to the word, masked whole.
      if (/^[().-]+\d/.test(rest)) return maskCandidate(candidate);
      // Followed by groups of plain digits that make a phone or card number with them: its first group.
      const groups = /^(?: \d+(?= |$))*/.exec(rest)?.[0] ?? "";
      if (groups && (glued + groups).replace(/\D/g, "").length >= MIN_PHONE_DIGITS) return maskRun(glued + groups) + maskCandidate(rest.slice(groups.length));
      return glued + maskCandidate(rest);
    })
    .replace(LONG_DIGITS, (digits) => (own?.has(digits) ? digits : "[number]"));
}

/**
 * Which of `own`, the values the visitor named (`namedIn`), stand on their own
 * in `text`, by the rule the page reading leaves them readable by: a whole
 * email address, or a whole run of digits. Text read with `own` left readable
 * holds one unmasked only where it stood on its own on the page.
 */
export function standingAlone(text: string, own: ReadonlySet<string>): string[] {
  const found: string[] = [];
  for (const email of text.match(EMAIL) ?? []) if (own.has(email.toLowerCase())) found.push(email.toLowerCase());
  for (const digits of text.replace(EMAIL, " ").match(LONG_DIGITS) ?? []) if (own.has(digits)) found.push(digits);
  return found;
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
  if (masked.length <= max) return masked;
  // Cut at a word, unless that would lose much: "Out of stock", not "Out o…".
  const cut = masked.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space >= max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

/** How an element is named in events, history and change summaries. */
export function describeElement(element: Pick<SnapElement, "role" | "label" | "icon">): string {
  if (element.label) return `${element.role} "${element.label}"`;
  if (element.icon) return `${element.role} with ${element.icon} icon`;
  return element.role;
}
