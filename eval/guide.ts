import type { Kind, Matcher } from "./cases.ts";

// A guide as a script: the question, and for each step which controls are
// right and what a visitor would do next. eval/record.ts walks a site with
// these and keeps what the widget sends as benchmark cases. eval/drive.ts
// uses the same scripts to check that a model, left to itself, gets there.

/** One thing a visitor does. Selectors are Playwright's, and the first match is used. */
export type Act =
  | { click: string }
  | { fill: [selector: string, value: string] }
  | { select: [selector: string, optionLabel: string] }
  | { check: string }
  | { press: [selector: string, key: string] }
  | { hover: string };

export interface Step {
  /** The controls that are right at this step. Empty when the guide is over. */
  expect: Matcher[];
  /** What the visitor does next. Leave it out to stop here, as before a button that must not be pressed. */
  act?: Act;
  /**
   * True when the right control is on the page but the widget does not list
   * it, so no model can point at it. The step is kept and counted against
   * Haptic: a guide is written from what a visitor has to do, never from what
   * the widget happens to see. `expect` then describes the control in words
   * for the report, and `act` shows it is really there.
   */
  unlisted?: boolean;
  /**
   * True when the widget does not ask for this step at all, because it never
   * noticed what the visitor did before it: a pick it could not hear, a
   * dialog it could not be reached through. The visitor does the step alone.
   * Like an unlisted step it is kept, counted against Haptic, and needs an `act`.
   */
  silent?: boolean;
  /** Which of the right controls the scripted answer points at, when it matters. Otherwise the first one on the page. */
  point?: Matcher;
  /** What the scripted answer says, when "Click <label>." would not do. */
  say?: string;
  sayStartsWith?: string;
  /** Words the sentence must not contain: the answer to an off-topic question, or text the page tried to plant. */
  sayNot?: string[];
  /** Controls the step is there to keep the pointer away from: where planted text sends it, or a look-alike that deletes. */
  trap?: Matcher[];
}

/**
 * How to tell, at the end of a whole-guide run, that the visitor got where
 * they wanted. Everything given has to hold. Needed when the last step is
 * DONE. A guide that stops before a button is reached when that button is
 * pointed at.
 */
export interface Reached {
  /** A regular expression the page's address has to match, like "#/cart$". */
  url?: string;
  /** Text that has to be visible on the page. */
  text?: string;
  /** A selector that has to match something visible. */
  selector?: string;
}

export interface Guide {
  id: string;
  /** The path the visitor is on when they ask. It may carry a query or a hash. */
  start: string;
  goal: string;
  steps: Step[];
  reached?: Reached;
  /** What the guide is there to test. "task" when left out. */
  kind?: Kind;
  /** Kept out of prompt tuning and reported on its own. See eval/README.md. */
  heldOut?: boolean;
}

export interface GuideSet {
  /** The site's id in data/sites. Its context is saved with the cases. */
  siteId: string;
  /** Where the site is, like "https://example.com". */
  origin: string;
  /** False when the site's pages do not carry Haptic's script tag, so the recorder adds it. */
  hasTag: boolean;
  /** One line on what the site is and why it is in the benchmark. */
  about?: string;
  /** What a visitor does before asking anything, such as signing in to a public demo. Done afresh for every guide. */
  before?: { path: string; acts: Act[] };
  /** Things to click away when they show up after a page loads, like a cookie banner. */
  dismiss?: string[];
  /**
   * True when nothing done here is real: the data is made up and no one else
   * sees it. A whole-guide run then presses whatever it is pointed at. On any
   * other site it stops before a control that could send, buy, save or delete.
   */
  sandbox?: boolean;
  /**
   * A pattern for controls a whole-guide run must never use here, sandbox or
   * not, matched against a control's label and link. For the button that
   * resets a shared demo for everyone.
   */
  never?: string;
  /**
   * On a site that is not a sandbox, every request a page makes that is not a
   * plain read is stopped in the browser: see eval/net.ts. This is a pattern
   * for the site's own requests that only read and are still sent as a POST,
   * like a search or a chart's query. It is matched, whatever the case,
   * against the method, host and path: "POST play.grafana.org/api/ds/query".
   * Never list a request here that saves, sends, creates or deletes.
   */
  reads?: string;
  /**
   * A pattern, matched the same way, for what the site's pages send by
   * themselves whoever is looking: usage counts and error reports. They are
   * stopped like anything else, but are not taken for something a step did.
   */
  chatter?: string;
  /** Every guide here is kept out of prompt tuning: a whole site the prompt has never been adjusted against. */
  heldOut?: boolean;
  guides: Guide[];
}

export const button = (label: string): Matcher => ({ label, role: "button" });
export const link = (label: string): Matcher => ({ label, role: "link" });
export const any = (label: string): Matcher => ({ label });
export const DONE: Step = { expect: [] };
