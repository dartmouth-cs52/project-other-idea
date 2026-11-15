// What a toolkit file says about its demos, and what a run finds out about each.
// A toolkit file names pages, containers and the controls a visitor uses, by
// role and visible text. The checks themselves are in checks.ts and are shared.

// Playwright is loaded by name at run time, as in eval/browser.ts, so it is not type-checked against.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Page = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Locator = any;

/** The kinds of control the suite covers, in the order the table shows them. */
export const KINDS = [
  "button",
  "icon-button",
  "tooltip-icon-button",
  "text-field",
  "native-select",
  "select",
  "combobox",
  "multi-select",
  "checkbox",
  "radio",
  "switch",
  "menu",
  "nested-menu",
  "tabs",
  "accordion",
  "dialog",
  "drawer",
  "date-picker",
  "date-range-picker",
  "table",
  "tree",
  "slider",
  "iframe",
  "shadow-root",
] as const;
export type Kind = (typeof KINDS)[number];

/**
 * A control on the page, found the way a person would describe it: by its
 * role and name, or by the words on it. Never by a generated class name.
 */
export interface Target {
  /** An ARIA role, as Playwright's getByRole takes it. */
  role?: string;
  /** The accessible name, or a pattern for it. */
  name?: string | RegExp;
  /** Words shown on it, for things that have no useful role, like a calendar's day. */
  text?: string | RegExp;
  /** Whether a name or text given as words must match whole. It must unless this says otherwise. */
  exact?: boolean;
  /** Which of several matches. The first when left out. */
  nth?: number;
  /** "demo" (the default) looks inside the demo. "page" looks anywhere, for what a control opened. */
  where?: "demo" | "page";
}

/** One thing a visitor does with a real mouse or keyboard. Each is pointed at first. */
export type Action =
  | { click: Target }
  /** Clicks into the field, then types, key by key. */
  | { type: Target; text: string }
  /** Clicks the control, then presses these keys in turn. */
  | { keys: Target; press: string[] }
  /** Presses the mouse on the control and moves it this far before letting go. */
  | { drag: Target; by: [number, number] }
  | { hover: Target };

export interface Demo {
  kind: Kind;
  /** The page on the toolkit's site, from its origin. */
  path: string;
  /** What the toolkit file's `container` takes to find this demo on the page. */
  demo: string;
  /** What a visitor does, in order. A control that opens something takes two: the opening, and the pick inside. */
  steps: Action[];
  /** The first step opens something over the page. Also check a visitor can ask Haptic while it is open. */
  overlay?: boolean;
  /** Set when the demo is left out on purpose, with the reason. It is reported as not tested. */
  skip?: string;
  /** Where the demo's controls really live, when it is somewhere the widget does not read. */
  unreadable?: "iframe" | "closed shadow root" | "canvas";
}

export interface Kit {
  id: string;
  name: string;
  origin: string;
  /** The demo's container on a loaded page. Nothing matches when the demo is not there. */
  container: (page: Page, demo: string) => Locator;
  /** Controls inside a container that belong to the documentation site, not to the demo. */
  chrome?: Target[];
  /** Things a first-time visitor sees in front of the page, clicked away once if they are there. */
  dismiss?: Target[];
  demos: Demo[];
}

// Results -------------------------------------------------------------------

/** A control the accessibility tree has in the demo and the widget's list does not. */
export interface Missing {
  role: string;
  name: string;
  /** Why it is missing, when it can be told: cut by the list's length limit, or never read at all. */
  reason: "not read" | "cut by the limit";
  markup: string;
}

export interface Duplicate {
  line: string;
  count: number;
  markup: string;
  /** The accessibility tree gives them the same names too, so the page itself does not tell them apart. */
  treeSame: boolean;
}

export interface ListedResult {
  /** Controls a visitor could use in the demo, by the accessibility tree. */
  expected: number;
  /** How many of those the widget listed. */
  found: number;
  missing: Missing[];
  /** Listed controls with no name and no icon: what the model is told is just "button". */
  unnamed: { line: string; treeName: string; markup: string }[];
  /** Groups of listed controls whose whole line is the same. */
  duplicates: Duplicate[];
  /** Listed controls in the demo, and how many distinct lines they make. */
  lines: number;
  distinct: number;
  /** Whether the list the widget sent was the same as the one read beside it to find each control. */
  matchedSent: boolean;
}

/**
 * "silent": the action opened something and the widget asked nothing, waiting
 * for a pick in it. Not counted as heard or unheard: the pick that follows is.
 */
export type Heard = "true" | "wrong" | "unclear" | "none" | "not pointed" | "blocked" | "silent";
export type ReadAt = "right" | "right on asking again" | "early" | "stale" | "nothing changed" | "not checked";

export interface StepResult {
  action: string;
  /** The control, as the widget listed it. Empty when it was not listed. */
  line: string;
  listed: boolean;
  /** The pointer went to that control. */
  pointed: boolean;
  /** The visitor used it without a pointer, because the widget was waiting for a pick in what the last step opened. */
  unpointed?: boolean;
  heard: Heard;
  event?: string;
  /** Why the sentence was judged as it was, when it was not plainly true. */
  why?: string;
  readAt: ReadAt;
  /** Controls on the page after the action that the list sent after it lacked. */
  missingAfter: string[];
  /** Controls gone after the action that the list sent after it still had. */
  staleAfter: string[];
  /** Haptic's own caption or button was on top of the control at the point a visitor would click. */
  coveredByHaptic?: boolean;
  /** How many times the widget asked about the page after this action before the answer stood. */
  asked: number;
  /** Controls the action opened, and how many of them had Haptic's caption or button on top of their middle while the widget waited. */
  opened?: number;
  openedUnderHaptic?: string[];
  /** The dialog the widget said was open in the list sent after the action, if any. */
  dialog?: string;
}

export interface OverlayResult {
  /** The overlay was open before the visitor went to Haptic's box. */
  opened: boolean;
  /** It was still open when the question went. */
  stayedOpen: boolean;
  /** What closed it, when it did not stay open. */
  closedBy?: string;
  /** What the visitor typed arrived in Haptic's box and the question went. */
  typed: boolean;
  why?: string;
  /** The overlay's controls, and how many of them the list sent with the question had. */
  expected: number;
  found: number;
  missing: string[];
  /** The dialog the widget said was open, if any. */
  dialog?: string;
}

export interface DemoResult {
  kit: string;
  kind: Kind;
  demo: string;
  url: string;
  tested: boolean;
  /** Why it was not tested. */
  why?: string;
  unreadable?: Demo["unreadable"];
  listed?: ListedResult;
  steps: StepResult[];
  overlay?: OverlayResult;
  notes: string[];
  ms: number;
}

export interface RunResults {
  /** The checkout whose widget was tested, and its commit. */
  widget: { checkout: string; commit: string };
  startedAt: string;
  finishedAt: string;
  results: DemoResult[];
}
