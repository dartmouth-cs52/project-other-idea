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
  /**
   * For a control that opens a list: what the visitor picks from it, as a
   * selector, when the widget shows the control and then says nothing more. A
   * whole-guide run uses it only when the sentence names no choice. Without it
   * the next step's own click is what the visitor picks.
   */
  pick?: string;
  /**
   * The visitor scrolls the page this many pixels before using the control, as
   * someone looking around would. Scrolling is not a step: a widget that asks
   * a new question because of it is counted, and shown in the summary.
   */
  scrollFirst?: number;
  /**
   * For a guide that ends on this step unpressed: the step counts only while
   * the page is like this. For a filter that has to be set before the visitor
   * is pointed at the button that runs it, when nothing on the page would
   * show that the button was pressed.
   */
  given?: Reached;
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
  /**
   * A regular expression the page's address has to match, like "#/cart$": the
   * address as it is, or with its escapes undone and whatever the case, so a
   * query can be written as the visitor would type it.
   */
  url?: string;
  /** Text that has to be visible on the page. */
  text?: string;
  /** A selector that has to match something visible. */
  selector?: string;
  /** A selector that must match nothing visible: what the visitor wanted rid of has gone. */
  absent?: string;
  /**
   * A selector for a field the visitor has typed into on this page. For a form
   * that has to hold what the visitor came to enter before they are shown the
   * button that sends it.
   */
  typedInto?: string;
  /**
   * For a page whose look does not show what was asked of it, as an empty list
   * looks the same whatever filter ran: the last request the page made to an
   * address matching `to` has to match `has` too. Both are patterns matched
   * against the whole address, query and all. It is read from the page's own
   * record of what it has fetched since it loaded, which nothing leaves.
   */
  request?: { to: string; has: string };
  /**
   * A pattern, matched whatever the case, that the sentence on show has to
   * match. For an ending where the page holds several places and only the
   * sentence says which one the visitor should look at. Only the widget's own
   * words can pass it: a page alone never does.
   */
  said?: string;
}

/**
 * A test of the last sentence, for a question that asks for a fact: "which
 * laptops are out of stock?". The visitor has what they asked for once the
 * true answer has been said to them, wherever on the site that happens, so a
 * guide with `says` is reached either way: by the walk-through or by the
 * answer. Everything given has to hold, and a sentence that hedges ("it may
 * be", "check whether") never passes: see `HEDGES` in eval/browser.ts.
 */
export interface Says {
  /** Patterns the sentence has to match, whatever the case. Only for an answer that cannot change, such as what the app can do. */
  all?: string[];
  /** Patterns the sentence must not match: a wrong answer, or the right words said the wrong way round ("isn't offered"). */
  not?: string[];
  /** For an answer that can change: read from the page, never written here. The sentence has to contain every piece of it. */
  shown?: ReadAnswer;
  /** Wrong answers, read from the page the same way: the sentence must contain none of them. For "and no in-stock one". */
  notShown?: ReadAnswer;
}

/** Where on the page an answer is read from. */
export interface ReadAnswer {
  /** Every visible element it matches is one piece of the answer, and there has to be at least one. */
  selector: string;
  /** A pattern for the part of each text that counts, like the date in a line of a history. */
  part?: string;
  /** True when the words may come in any order, as in a date that can be written two ways. */
  anyOrder?: boolean;
  /**
   * "start" reads it from the page the guide starts on, before the question is
   * asked, which suits an answer that is there all along. "end", the default,
   * reads it from the page as it is when the sentence is judged.
   */
  when?: "start" | "end";
  /**
   * A path on the same site to read it from instead, when the guide starts on
   * a page that does not show it: the answer to "what does it read?" asked
   * from the sign-up form is on the home page. It is opened in a tab of its own
   * as the guide starts, read, and closed; the visitor's page is left alone.
   * Only with `when: "start"`.
   */
  from?: string;
}

export interface Guide {
  id: string;
  /** The path the visitor is on when they ask. It may carry a query or a hash. */
  start: string;
  goal: string;
  steps: Step[];
  /**
   * How to tell the visitor got there. A list gives the ends of other good
   * ways to the same goal, and any one of them holding is enough.
   */
  reached?: Reached | Reached[];
  /**
   * The last controls of other good ways to the same goal, on a site where they
   * must not be pressed: each is a step with no `act`, like a script's own last
   * step, and with a `given` where the page has to show that it is the right
   * one (the Remove in this panel's menu, not another's). A run that points at
   * one is over, as reached, the way it is at the script's own last control.
   */
  otherEnds?: Step[];
  /**
   * For a question that asks for a fact: the last sentence gives the true
   * answer, which reaches the guide as fully as the walk-through does. In a
   * whole-guide run such a guide's kind is "answer", so that the summary can
   * also give the rate without these guides, as a check that a rise is honest.
   * The steps still script the walk to where the answer shows.
   */
  says?: Says;
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

/**
 * What is wrong with a guide set as a script, in words, one line per fault.
 * A guide of more than one step has to have a way to be scored as reached: a
 * `reached`, a `says`, or a last step that is pointed at and not pressed.
 * Without one, no run of it can ever pass, whatever Haptic does.
 */
export function faults(set: GuideSet): string[] {
  const found: string[] = [];
  const ids = new Set<string>();
  for (const guide of set.guides) {
    if (ids.has(guide.id)) found.push(`${guide.id}: two guides have this id`);
    ids.add(guide.id);
    const last = guide.steps[guide.steps.length - 1];
    if (!last) {
      found.push(`${guide.id}: it has no steps`);
      continue;
    }
    if (guide.steps.length > 1 && !guide.reached && !guide.says && (last.act || !last.expect.length)) {
      found.push(`${guide.id}: no run of it can be scored as reached. Give it a "reached" that says how to tell the visitor got there, or end it on a step with no "act"`);
    }
    const ends = guide.otherEnds ?? [];
    const tests = (name: string, reached: Reached | undefined): (readonly [string, string | undefined])[] =>
      reached ? [[`${name}.url`, reached.url], [`${name}.said`, reached.said], [`${name}.request.to`, reached.request?.to], [`${name}.request.has`, reached.request?.has]] : [];
    const patterns = [
      ...reachedList(guide.reached).flatMap((one, index) => tests(Array.isArray(guide.reached) ? `reached[${index}]` : "reached", one)),
      ...(guide.says?.all ?? []).map((one) => ["says.all", one] as const),
      ...(guide.says?.not ?? []).map((one) => ["says.not", one] as const),
      ["says.shown.part", guide.says?.shown?.part] as const,
      ["says.notShown.part", guide.says?.notShown?.part] as const,
      ...tests("the last step's given", last.given),
      ...ends.flatMap((end, index) => tests(`otherEnds[${index}].given`, end.given)),
    ];
    for (const [name, pattern] of patterns) {
      if (pattern === undefined) continue;
      try {
        new RegExp(pattern);
      } catch {
        found.push(`${guide.id}: ${name} is not a pattern that can be read: ${pattern}`);
      }
    }
    if (guide.says && !guide.says.all?.length && !guide.says.shown) found.push(`${guide.id}: "says" has to give the answer, with "all" or "shown"`);
    for (const answer of [guide.says?.shown, guide.says?.notShown]) if (answer?.from !== undefined && answer.when !== "start") found.push(`${guide.id}: an answer read "from" another page is read when the guide starts: give it when: "start"`);
    if (guide.steps.some((step) => step.given && (step !== last || step.act))) found.push(`${guide.id}: only a last step that is not pressed can have a "given"`);
    if (Array.isArray(guide.reached) && !guide.reached.length) found.push(`${guide.id}: "reached" is an empty list, which nothing can match`);
    if (ends.some((end) => end.act || !end.expect.length)) found.push(`${guide.id}: each of "otherEnds" is a control that is pointed at and not pressed: it needs "expect" and no "act"`);
  }
  for (const name of ["never", "reads", "chatter"] as const) {
    if (set[name] === undefined) continue;
    try {
      new RegExp(set[name]);
    } catch {
      found.push(`"${name}" is not a pattern that can be read`);
    }
  }
  return found;
}

/** A guide's `reached` as a list of the ends that count: empty when it has none. */
export function reachedList(reached: Reached | Reached[] | undefined): Reached[] {
  return reached === undefined ? [] : Array.isArray(reached) ? reached : [reached];
}

export const button = (label: string): Matcher => ({ label, role: "button" });
export const link = (label: string): Matcher => ({ label, role: "link" });
export const any = (label: string): Matcher => ({ label });
export const DONE: Step = { expect: [] };
