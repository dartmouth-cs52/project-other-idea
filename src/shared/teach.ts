// No extension on these imports: the website imports this file too, and its settings refuse one.
import { sameTask } from "./task-match";
import { cleanText, normalizePath, questionKey } from "./types";

// Teach Haptic: someone at the company shows Haptic the right way to do a task
// by doing it in their own app, and Haptic guides that way from then on.
//
// The dashboard makes a short-lived teach session and opens the app with its
// token in the address's fragment, which never reaches the app's server. The
// widget already on the page sees it, checks it with the widget server, and
// records which controls the person uses: each by the name the page outline
// gives it, the page as a path with ids masked, and what was done with it.
// Never what was typed, and nothing the outline's masking would hide. The
// person reviews the steps in the dashboard, and saving them keeps a taught
// route in the site's context beside the corrections. A visitor's question
// for the same task carries the route into the prompt as the company's own
// instructions (src/server/prompt.ts).
//
// Shared by the widget (recording and wording), the widget server (checking
// what is posted), the website's Worker (saving) and the prompt.

export { TEACH_FRAGMENT, TEACH_KEY, TEACH_TOKEN } from "./teach-link";
/** A teach session can be claimed for this long after it is made, and lasts this long after it is claimed. */
export const TEACH_MINUTES = 30;
/** The most steps one route keeps. A task needing more is not one to teach in one go. */
export const MAX_TAUGHT_STEPS = 30;
/** The most routes one site keeps. */
export const MAX_TAUGHT_ROUTES = 50;
/** A one-line note on a step. */
export const MAX_NOTE = 140;

/**
 * What was done with a control.
 * - press: a button, link, tab or menu item was used
 * - choose: a choice was picked from a list, a dropdown or a set of radio buttons
 * - type: something was typed into a field (never what)
 * - check, uncheck: a tick box or switch was turned on or off
 * - enter: Enter was pressed in a field
 */
export const TEACH_KINDS = ["press", "choose", "type", "check", "uncheck", "enter"] as const;
export type TeachKind = (typeof TEACH_KINDS)[number];

/** The roles a recorded control may have: the ones the page reading gives. Anything else is recorded as "clickable". */
const ROLES = new Set([
  "button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "checkbox", "radio", "switch", "combobox",
  "treeitem", "textbox", "searchbox", "slider", "spinbutton", "select", "clickable", "gridcell", "listbox", "radiogroup",
]);

/** One step someone showed Haptic. Names only: never what was typed into a field. */
export interface TaughtStep {
  kind: TeachKind;
  /** The page, as a path with ids masked: /budgets/:id. */
  path: string;
  /** The kind of control, as the page reading names it: button, link, textbox, combobox… For "choose", the list chosen in. */
  role: string;
  /** The control's label as the page outline gives it, masked the same way. For "choose", the list's label. Empty when it is a record's own name. */
  label: string;
  /** The section it sits in, like "main › Budgets". Never the row it was in. */
  context?: string;
  /** The open dialog's title, when the control was in one. */
  dialog?: string;
  /** For "choose": what was chosen, in the page's words. */
  choice?: string;
  /** The control sits in a row of a table or list of records, like Edit beside one budget. */
  row?: true;
  /** Its words say it saves, sends, pays, deletes and so on. Set by the server, never by the page. Always left for the visitor. */
  commits?: true;
  /** In Do it with me, Haptic leaves this click for the visitor. Set from the dashboard, and always on a step that commits. */
  leave?: true;
  /** A one-line note from the person who taught it, added in the dashboard. */
  note?: string;
}

/** A route someone taught Haptic, kept in the site's context (`SiteContext.taught`). */
export interface TaughtRoute {
  id: string;
  /** The question it answers, masked as the dashboard keeps questions. */
  question: string;
  steps: TaughtStep[];
  createdAt: string;
  /** Who taught it, as the dashboard names them. Never sent to the widget or the model. */
  by?: string;
}

/** What the widget server tells a tab whose token it accepted. */
export interface TeachSessionInfo {
  question: string;
  expiresAt: string;
}

// Tokens -----------------------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A new random token: 32 bytes, 43 characters. Used for teach tokens, and for the secret a tab claims one with. */
export function newTeachToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** How a token is kept: its SHA-256 in hex. The token itself is never stored. */
export async function hashTeachToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Checking steps -----------------------------------------------------------------

const text = (value: unknown, max: number): string => (typeof value === "string" ? cleanText(value, max) : "");

/**
 * A control's surroundings without the row it is in or its place among its
 * like: "main › Budgets › row: Platform travel, $75,000 › 2 of 14" is kept as
 * "main › Budgets". The row holds a record's own words, and its place moves.
 */
export function sectionOf(context: string): string {
  return context
    .split(" › ")
    .filter((part) => part && !/^(?:row|disabled): /.test(part) && !/^\d+ of \d+$/.test(part))
    .join(" › ");
}

/**
 * Steps as they may be kept: checked field by field and masked again, the
 * way the server masks everything it keeps. Anything else that came with a
 * step is dropped, so nothing a page or a changed widget adds can be kept.
 * `withNotes` keeps the dashboard's notes and "leave for the visitor"; the
 * widget's post never has them. A step whose control had no name is kept,
 * so the person reviewing it sees it and can name it or delete it
 * (`isUnnamed`): nothing the person did is dropped without a word.
 */
export function cleanTaughtSteps(input: unknown, { withNotes = false } = {}): TaughtStep[] {
  if (!Array.isArray(input)) return [];
  const steps: TaughtStep[] = [];
  for (const item of input.slice(0, MAX_TAUGHT_STEPS * 2)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    if (!TEACH_KINDS.includes(raw.kind as TeachKind)) continue;
    const kind = raw.kind as TeachKind;
    const role = typeof raw.role === "string" && ROLES.has(raw.role) ? raw.role : "clickable";
    // An address has no spaces or line breaks of its own, so a path that has some was made up: they are taken out.
    const path = typeof raw.path === "string" ? raw.path.replace(/[\s\p{Cc}]+/gu, "") : "";
    const step: TaughtStep = { kind, path: normalizePath(path ? path.slice(0, 300) : "/"), role, label: text(raw.label, 80) };
    // A hash route is part of the path, as the widget reads it: /#/budgets/:id.
    if (/#\/./.test(path)) step.path += `#${normalizePath(path.slice(path.indexOf("#") + 1))}`;
    const context = sectionOf(text(raw.context, 120));
    if (context) step.context = context;
    const dialog = text(raw.dialog, 60);
    if (dialog) step.dialog = dialog;
    const choice = kind === "choose" ? text(raw.choice, 60) : "";
    if (choice) step.choice = choice;
    if (raw.row === true) step.row = true;
    if (raw.commits === true) step.commits = true;
    if (withNotes) {
      const note = text(raw.note, MAX_NOTE);
      if (note) step.note = note;
      if (raw.leave === true || step.commits) step.leave = true;
    }
    steps.push(step);
    if (steps.length >= MAX_TAUGHT_STEPS) break;
  }
  return steps;
}

/** A step whose control the recorder could not name: no label, and not a record's row, whose name is left out on purpose. */
export function isUnnamed(step: Pick<TaughtStep, "label" | "row" | "choice" | "kind">): boolean {
  return !step.label && !step.row && !(step.kind === "choose" && step.choice);
}

// Wording ----------------------------------------------------------------------

/** "Budgets", or "the plus icon" for an icon-only control named "icon:plus". */
function shown(label: string): string {
  const icon = /^icon:(.+)$/.exec(label)?.[1];
  return icon ? `the ${icon.replace(/-/g, " ")} icon` : label;
}

/** What a step asks for, as a plain sentence without the page: "press New budget", "choose Monthly in Period". */
function action(step: TaughtStep): string {
  const name = shown(step.label);
  const inRow = step.row ? " in a row of the list" : "";
  switch (step.kind) {
    case "choose":
      if (step.choice && name) return `choose ${step.choice} in ${name}`;
      return step.choice ? `choose ${step.choice}` : `choose an option in ${name}`;
    case "type":
      return `type in ${name || "a field"}${inRow}`;
    case "check":
      return step.role === "switch" ? `turn on ${name}` : `tick ${name}`;
    case "uncheck":
      return step.role === "switch" ? `turn off ${name}` : `untick ${name}`;
    case "enter":
      return `press Enter in ${name || "the field"}`;
    case "press":
      if (!name) return `open one of the ${step.role === "link" ? "links" : "items"}${inRow || " in the list"}`;
      if (step.role === "link") return `open ${name}${inRow}`;
      if (step.role === "tab") return `open the ${name} tab`;
      if (step.role === "menuitem" || step.role === "menuitemcheckbox" || step.role === "menuitemradio") return `choose ${name} in the menu`;
      if (step.role === "option") return `choose ${name}`;
      return `press ${name}${inRow}`;
  }
}

export const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/**
 * One step as the dashboard shows it, written plainly: "On /budgets, press New
 * budget", "Choose Monthly in Period". The page is named when it differs from
 * the step before's, and the dialog when the control is in one.
 */
export function stepText(step: TaughtStep, before?: TaughtStep): string {
  if (isUnnamed(step)) return unnamedText(step);
  const lead: string[] = [];
  if (!before || before.path !== step.path) lead.push(`on ${step.path}`);
  if (step.dialog && step.dialog !== before?.dialog) lead.push(`in the ${step.dialog} dialog`);
  return capital(lead.length ? `${lead.join(", ")}, ${action(step)}` : action(step));
}

/** A step with no name, which always says its page: "Press an unnamed control on /budgets". */
function unnamedText(step: TaughtStep): string {
  const verb: Record<TeachKind, string> = {
    press: "press",
    choose: "choose an option in",
    type: "type in",
    check: step.role === "switch" ? "turn on" : "tick",
    uncheck: step.role === "switch" ? "turn off" : "untick",
    enter: "press Enter in",
  };
  const where = step.dialog ? `in the ${step.dialog} dialog, ` : "";
  return capital(`${where}${verb[step.kind]} an unnamed control on ${step.path}`);
}

/** Every step of a route as the dashboard shows it. */
export function routeText(steps: TaughtStep[]): string[] {
  return steps.map((step, index) => stepText(step, steps[index - 1]));
}

// Matching and the prompt ------------------------------------------------------------

/** How many of the words that matter two questions share, for ranking. */
function overlap(a: string, b: string): number {
  const words = (question: string) => new Set(questionKey(question).split(" ").filter((word) => word.length > 1));
  const x = words(a);
  const y = words(b);
  return [...x].filter((word) => y.has(word)).length / Math.max(1, Math.max(x.size, y.size));
}

/**
 * The taught route for a visitor's question, if one was taught for the same
 * task: the same action on the same thing, and nothing negated
 * (`sameTask`, src/shared/task-match.ts). Stricter than corrections, since a
 * route is a whole procedure. The closest question wins, then the newest.
 * One at most, so the prompt stays short.
 */
export function taughtFor(routes: TaughtRoute[] | undefined, goal: string): TaughtRoute | undefined {
  if (!routes?.length || !goal.trim()) return undefined;
  const like = routes.filter((route) => route.steps.length && sameTask(route.question, goal));
  like.sort((a, b) => overlap(b.question, goal) - overlap(a.question, goal) || b.createdAt.localeCompare(a.createdAt));
  return like[0];
}

/**
 * The labels of the steps a matching route leaves for the visitor, for Do it
 * with me: Haptic never presses them for the visitor, whatever the model asks
 * (src/server/acting.ts adds them to the site's commit words for that step).
 */
export function leftForVisitor(route: TaughtRoute | undefined): string[] {
  // A choice or a field is named by its list or field, which is not what is pressed, so only presses and ticks count.
  const pressed = (step: TaughtStep) => step.kind === "press" || step.kind === "check" || step.kind === "uncheck";
  return (route?.steps ?? []).filter((step) => step.leave && pressed(step) && step.label && !/^icon:/.test(step.label)).map((step) => step.label);
}
