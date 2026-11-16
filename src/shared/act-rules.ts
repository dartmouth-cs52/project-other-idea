import type { Refusal, TurnReply, TurnRequest } from "./types.ts";

// The pure half of acting's safety gate: which words commit, which are safe,
// whether a value is the visitor's own, and the check a reply passes before
// anything is done with it. No DOM or Node APIs here: the widget and the
// server run the same code, and the server's run is only defence in depth.
//
// CONTRACT ONLY. The bodies below refuse everything, so that code written
// against this file is safe before the rules are in. The rules come next.

/**
 * What using a control would do, by its words. The hand-over check (DESIGN 4.5)
 * uses the classes again: a commit that is "destroy", "money", "session" or
 * "secret" is handed over only when the visitor's own words hold a word of the
 * same class.
 */
export type CommitClass = "destroy" | "money" | "session" | "send" | "save" | "dataOut" | "secret" | "dialog";

/** The languages whose words ship in the tables. The widget's own sentences are English. */
export const LANGUAGES = ["en", "es", "fr", "de", "pt", "it", "nl", "ja", "zh"] as const;
export type Language = (typeof LANGUAGES)[number];

/** The classes that stop a link. A link cannot post, so a link that saves or sends is a way to a form. */
export const LINK_STOPS: readonly CommitClass[] = ["destroy", "money", "session", "dataOut", "secret"];
/** The classes a commit must be asked for in the visitor's words before Haptic hands it over (4.5). */
export const ASKED_CLASSES: readonly CommitClass[] = ["destroy", "money", "session", "secret"];

/** How a control is used, which decides which classes stop it. */
export interface Naming {
  /** It is a link: only `LINK_STOPS` stop it. */
  link?: boolean;
  /** It is in a dialog, where "OK", "Yes", "Done" and "Continue" commit. */
  dialog?: boolean;
  /** It says it opens a menu, list or dialog: only destroy, money, session and secret stop it. */
  opener?: boolean;
  /** The site's own commit words (`ActingSettings.commitWords`). A match is class "save" and reported as `marked`. */
  extra?: readonly string[];
}

/** What a name says about the control, by the word tables. */
export interface NameVerdict {
  /** The class of the first commit word found, if any stops a control used this way. */
  commit?: CommitClass;
  /** The match came from the site's own `commitWords`. */
  marked?: boolean;
  /** The whole name is a safe word or phrase: next, back, cancel, close, edit, ... */
  safe: boolean;
}

/**
 * Reads a control's name for commit and safe words, in every shipped language.
 * `name` is everything the control is called by, joined: its label, its
 * aria-label, its title and its icon name.
 */
export function readName(name: string, how: Naming = {}): NameVerdict {
  void name;
  void how;
  return { commit: "save", safe: false };
}

/** Whether the visitor's words hold a word of this class: "delete" for destroy, "pay" for money, ... */
export function classAsked(commit: CommitClass, words: string): boolean {
  void commit;
  void words;
  return false;
}

/**
 * A field Haptic never types into or reads (rule 2), by the words that
 * describe it: its label, name, placeholder and autocomplete. Passwords,
 * payment details, account numbers, one-time codes, secrets, keys and tokens,
 * and "type DELETE to confirm".
 */
export function isSecretField(describedAs: string): boolean {
  void describedAs;
  return true;
}

/** Whether a field's words call it a search, filter or find box, in any shipped language. */
export function isSearchName(describedAs: string): boolean {
  void describedAs;
  return false;
}

/**
 * Whether `value` is in the visitor's own `words` (DESIGN 4.4). Every
 * significant word of the value must be there; numbers compare by their
 * digits ("$1,500" grounds "1500"); emails compare whole; an ISO date is
 * grounded by a date written in the words.
 */
export function grounded(value: string, words: string): boolean {
  void value;
  void words;
  return false;
}

/** A date written in the form a field shows ("MM-DD-YYYY" gives "12-01-2026" for 2026-12-01), or undefined when no form is shown. */
export function dateLike(form: string, date: { year: number; month: number; day: number }): string | undefined {
  void form;
  void date;
  return undefined;
}

/** A reply after the check, and why its `do` was removed when it was. */
export interface ActionCheck {
  reply: TurnReply;
  withheld?: Refusal;
}

/**
 * The check every act reply passes, on the server after the model answers and
 * again in the widget before the gate. It judges by the listed control only
 * (role, label, icon, link), never by the live page, so it can only remove a
 * `do`, never add one. The reply returned is a copy:
 * - `do` that is not one of `ACTS`, or with no target listed: removed.
 * - `do` with `commits: true`: `do` and `enter` removed, `commits` kept: the hand-over. Withheld "contradiction".
 * - `do` that does not fit the control's role: removed, "unfit".
 * - `do` on a control whose words commit (link or not, `readName`): removed, "words" (or "marked").
 * - `do` on a link to another site: removed, "leaves".
 * - `type` or `choose` on a field `isSecretField` names: removed, "secret".
 * - `type` whose `enter` is not grounded in the goal, or `choose` whose `enter`
 *   and the listed option it matches are not: removed, "ungrounded".
 * - `press_enter` outside a field named as a search: removed, "enter".
 * - `enter` with no `type` or `choose` left to use it: set to null.
 * When a `do` is removed, `withheld` is set on the reply too.
 */
export function checkAction(reply: TurnReply, request: Pick<TurnRequest, "goal" | "snapshot">, acting: { commitWords?: readonly string[] } = {}): ActionCheck {
  void request;
  void acting;
  const { do: act, ...rest } = reply;
  if (!act) return { reply: { ...rest, enter: null } };
  return { reply: { ...rest, enter: null, withheld: "unknown" }, withheld: "unknown" };
}
