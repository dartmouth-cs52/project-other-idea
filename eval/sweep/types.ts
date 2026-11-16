import type { SiteKind } from "./sites.ts";

// What a sweep finds out about each site. Written to eval/sweep/results/ as
// JSON, and printed by report.ts.

/** One load of a site's page, with Haptic in it or not. */
export interface LoadRecord {
  /** A1 and A2 are without Haptic, B1 and B2 with it. */
  label: "A1" | "B1" | "B2" | "A2" | "CSP";
  haptic: boolean;
  /** The status the page's own address answered with, or 0. */
  status: number;
  url: string;
  title: string;
  /** From asking for the page to its settling. */
  ms: number;
  /** The page's own console errors and uncaught errors, worded alike from load to load, each once. */
  errors: string[];
  /** Uncaught errors whose stack runs through Haptic's script: Haptic throwing into the page. */
  hapticThrows: string[];
  /** Warnings Haptic printed, which it does when something of its own went wrong and it caught it. */
  hapticWarnings: string[];
  /**
   * The errors, and the count of stopped requests, as they stood at the end of
   * the idle checks: the same moment in every load, before anything that only
   * some loads do, like scrolling to the foot of the page or the step.
   */
  idleErrors?: string[];
  idleWarnings?: string[];
  idleStopped?: number;
  /** Requests the page tried that were not a plain read, stopped in the browser, by method, host and path. */
  stopped: Record<string, number>;
  /** WebSockets opened, and messages sent on them, which are counted and not stopped. */
  sockets: number;
  framesSent: number;
  /** Where the page's own elements were, by path. Dropped from the saved results once compared. */
  layout?: { anchors: Record<string, string>; scroll: string };
  /** What had the keyboard after the page loaded, and after each press of Tab. */
  focus?: { initial: string; tabs: string[] };
  /**
   * Presses of Tab made while the page had the keyboard, and how many reached
   * a listener on the page's window. `presses` has, for each press, what had
   * the keyboard before it and whether it reached the window.
   */
  keys?: { pressed: number; reached: number; presses?: [string, boolean][] };
  /** Why the site could not be tested: a bot check or a block. */
  blocked?: string;
  /** The load itself failed. */
  error?: string;
}

/** A control of the page's own under Haptic's launcher. */
export interface Covered {
  markup: string;
  words: string;
  share: number;
  middle: boolean;
  pinned: boolean;
  launcherShare: number;
}

export interface LauncherResult {
  /** Haptic's element is in the page. */
  there: boolean;
  /** Its launcher is drawn inside the window. */
  shown: boolean;
  /** Nothing of the page's is on top of the launcher's middle. */
  onTop: boolean;
  /** What is on top of it, when something is. */
  over?: string;
  /** Controls under the launcher with the page at its top, and at its foot. */
  coveredTop: Covered[];
  coveredBottom: Covered[];
}

export interface ReadingResult {
  /** Each of three readings, in ms, by the widget's own reader. */
  times: number[];
  fastestMs: number;
  /** Controls listed, and whether the list was cut at the widget's limit. */
  controls: number;
  truncated: boolean;
  /** Controls the reader finds with its length limits lifted. -1 when they could not be lifted. */
  unlimited: number;
  offscreen: number;
  /** The dialog the widget took to be open, if any. */
  dialog?: string;
}

/** A control the accessibility tree has and the widget's list lacks. */
export interface MissingControl {
  role: string;
  name: string;
  /**
   * "closed shadow root": the widget can never read it. "outside the open
   * dialog": the widget lists only an open modal, by design. "cut by the limit":
   * read, and dropped to keep the list under its length. "not read": the reader
   * did not take it for a control.
   */
  reason: "not read" | "cut by the limit" | "closed shadow root" | "outside the open dialog";
  markup: string;
  onScreen: boolean;
  inOpenShadow: boolean;
  tag: string;
}

export interface ListedResult {
  /** Controls a visitor could use, by the accessibility tree, and how many the widget listed. Closed shadow roots left out. */
  expected: number;
  found: number;
  /** The same, for the controls inside the window when the page was read. */
  onScreenExpected: number;
  onScreenFound: number;
  /** Controls in closed shadow roots, which the widget can never read. */
  closedShadow: number;
  missingByReason: Record<string, number>;
  /** On-screen ones first. At most 25. */
  missing: MissingControl[];
  unnamedCount: number;
  /** `inTree`: the accessibility tree has a control there, with `treeName` its name. */
  unnamed: { line: string; treeName: string; inTree: boolean; markup: string }[];
  /** Listed entries with no name that the accessibility tree has no control for. */
  unnamedNotInTree: number;
  /** Groups of listed controls whose whole line is the same, and how many lines are in such groups. */
  duplicateGroups: number;
  duplicateLines: number;
  duplicates: { line: string; count: number; treeSame: boolean; markup: string }[];
  stateMissingCount: number;
  stateMissing: { line: string; treeState: string; markup: string }[];
  lines: number;
  distinct: number;
  /**
   * Listed controls inside the window that a click anywhere on them would not
   * reach, because something of the page's is over them, and what is over them.
   * Haptic's open box over a control is counted apart.
   */
  covered: number;
  /** `why`: drawn invisible, clipped out of view inside a box, or under a consent notice, a dialog, a frame, a pinned bar or something else. */
  coveredExamples: { line: string; blocker: string; why: string }[];
  coveredWhy: Record<string, number>;
  underHaptic: number;
  /** The list read beside it to tie entries to elements was the same as the one the widget sent. */
  matchedSent: boolean;
  /** The accessibility tree had more controls than were looked at. */
  capped?: number;
}

export interface FrameInfo {
  sameOrigin: boolean;
  from: string;
  width: number;
  height: number;
  onScreen: boolean;
  title: string;
  /** Controls a visitor could use inside it, counted in the frame. -1 when the frame could not be read. */
  controls?: number;
}

export interface InventoryResult {
  frames: FrameInfo[];
  canvases: number;
  /** The share of the window the largest canvas covers, and all canvases together. */
  canvasLargest: number;
  canvasTotal: number;
  openShadow: number;
  closedShadow: number;
  customElements: number;
  dialogs: { markup: string; consent: boolean; modal: boolean }[];
  notices: string[];
  consentFrames: number;
  nodes: number;
  rtl: boolean;
  lang: string;
}

/** "failed": the widget gave up with its own error message. */
export type Heard = "true" | "wrong" | "unclear" | "none" | "silent" | "failed";

/** The one scripted step: a pointer at a safe control, used with the real mouse. */
export interface StepResult {
  /** The question could be typed into Haptic's box and was sent. */
  asked: boolean;
  askNotes?: string;
  /** Why no step was taken. */
  skipped?: string;
  kind?: "tab" | "disclosure" | "in-page link" | "menu";
  /** The control as the widget listed it, and its markup. */
  line?: string;
  markup?: string;
  pointed?: boolean;
  /** Where the pointer's tip, Haptic's caption and its launcher were, against the control. */
  pointer?: {
    tip: { x: number; y: number };
    box: { x: number; y: number; w: number; h: number };
    pointedAtSame: boolean;
    tipInBox: boolean;
    tipHits: boolean;
    underTip: string;
    caption?: { x: number; y: number; w: number; h: number };
    captionShare: number;
    captionOverMiddle: boolean;
    dockShare: number;
    dockOverMiddle: boolean;
    ring: boolean;
  };
  caption?: string;
  /** Haptic's own caption or launcher was in front of the control where a visitor would click. */
  coveredByHaptic?: boolean;
  /** Something of the page's was in front of it. */
  blocker?: string;
  /** What the click did to the control and the page. */
  effect?: string;
  navigated?: boolean;
  heard?: Heard;
  event?: string;
  why?: string;
  /** How many times the widget asked again before the visitor clicked. */
  askedAgain?: number;
}

/** What Haptic, present and idle, changed about the page. */
export interface IdleResult {
  /** Errors in both loads with Haptic and in neither without it. */
  errorsNew: string[];
  /** Errors in both loads without Haptic and in neither with it. */
  errorsGone: string[];
  hapticThrows: string[];
  hapticWarnings: string[];
  /** Elements that were in the same place in both loads without Haptic and in both with it, and how many of those moved. */
  layoutStable: number;
  layoutMoved: number;
  layoutExamples: string[];
  scrollChanged?: string;
  /** The first place the order of Tab differed with Haptic, when the loads without it agreed and the loads with it agreed. */
  focusCompared: number;
  /** A press of Tab, from the same place, that reached the page's window in both loads without Haptic and in neither with it. */
  keysLost?: string;
  focusDiffers?: string;
  initialFocusDiffers?: string;
  keysReached: { without: number[]; with: number[]; pressed: number };
  stoppedWithout: number;
  stoppedWith: number;
}

export interface SiteResult {
  id: string;
  url: string;
  kinds: SiteKind[];
  why: string;
  status: "tested" | "could not test" | "could not reach";
  whyNot?: string;
  loads: LoadRecord[];
  launcher?: LauncherResult;
  reading?: ReadingResult;
  listed?: ListedResult;
  inventory?: InventoryResult;
  idle?: IdleResult;
  step?: StepResult;
  /** Uncaught errors from Haptic, and its warnings, while the step ran. */
  stepThrows?: string[];
  stepWarnings?: string[];
  notes: string[];
  ms: number;
  at: string;
}

/** What the browser did with Haptic's tag on a page whose Content Security Policy was left in force. */
export interface CspResult {
  id: string;
  url: string;
  kinds: SiteKind[];
  status: "tested" | "could not test" | "could not reach";
  whyNot?: string;
  /** The policy as the page set it: its header, its report-only header, and any in a meta tag. */
  policy: { header?: string; reportOnly?: string; meta: string[] };
  /** What the browser reported it blocked, by directive and address. */
  violations: { directive: string; blocked: string }[];
  /** Whether the script tag loaded. */
  script: "loaded" | "blocked" | "failed" | "not added";
  /** Whether the widget's requests could leave the page: its settings (GET) and a step (POST). */
  connectGet: "allowed" | "blocked";
  connectPost: "allowed" | "blocked";
  /** Whether the widget's stylesheet, an inline <style> in its shadow root, was applied. */
  style: "applied" | "blocked" | "not mounted";
  /**
   * Read from the policy's words: whether it would block Haptic's inline
   * stylesheet, and its requests, if the site's owner allowed Haptic's script.
   */
  inlineStyleAllowed: boolean;
  connectAllowedByPolicy: boolean;
  trustedTypes: boolean;
  mounted: boolean;
  /** A question typed into Haptic's box reached the (local) server. */
  askWorked: boolean;
  hapticWarnings: string[];
  notes: string[];
  at: string;
}

export interface SweepRun {
  mode: "sweep" | "csp";
  /** What a reader of the results should know about how they were made, like sites run again. */
  notes?: string[];
  widget: { checkout: string; commit: string; fingerprint: string };
  startedAt: string;
  finishedAt: string;
  results: SiteResult[];
  csp: CspResult[];
}
