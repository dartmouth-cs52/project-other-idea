import type { Suggestion } from "./types.ts";

// The questions a company suggests above the ask box: how many there may be,
// how long each may be, and how a list is checked and cleaned. The dashboard's
// settings, the CLI, the server that serves them and the widget that shows
// them all read a list here, so they all read it the same way. No DOM or Node
// APIs here.

/** At most three, each at most 60 characters, so they fit as one line each above the ask box. */
export const SUGGESTION_LIMITS = { count: 3, chars: 60 } as const;

/** Why a list of suggestions can't be saved, in words for whoever wrote it, and the one at fault when it is one. */
export class SuggestionsRefused extends Error {
  constructor(
    message: string,
    /** The position of the one at fault in the list as it was given, counting from 0. */
    readonly index?: number,
  ) {
    super(message);
  }
}

/** A line break of any kind. A suggestion is one line. */
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/;
/** Characters that draw nothing, or something odd. */
const UNSHOWN = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/;

/** The words with the space at their ends taken off, and each run of spaces or tabs inside them made one space. */
function tidy(text: string): string {
  return text.replace(/[ \t ]+/g, " ").trim();
}

/**
 * A list of suggestions as a company gave it, checked and cleaned for saving.
 * Each one's words are trimmed, a blank one is left out (the dashboard sends
 * three fields, some of them empty), and `act` is kept only when it is true.
 * Anything else that breaks the rules is refused with a sentence that says
 * what to change: more than three, more than 60 characters, a line break, a
 * repeat, or a value of the wrong kind. Nothing given is none.
 */
export function checkSuggestions(input: unknown): Suggestion[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new SuggestionsRefused("Suggested questions must be a list.");
  const kept: Suggestion[] = [];
  const seen = new Set<string>();
  input.forEach((item: unknown, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof (item as { text?: unknown }).text !== "string") {
      throw new SuggestionsRefused("Give each suggested question its words, as text.", index);
    }
    const { text, act } = item as { text: string; act?: unknown };
    if (act !== undefined && typeof act !== "boolean") throw new SuggestionsRefused("Haptic does it is either on or off.", index);
    const words = tidy(text);
    if (!words) return;
    if (LINE_BREAK.test(words)) throw new SuggestionsRefused("Keep a suggested question to one line.", index);
    if (UNSHOWN.test(words)) throw new SuggestionsRefused("Take out the character that can't be shown.", index);
    if (words.length > SUGGESTION_LIMITS.chars) {
      throw new SuggestionsRefused(`Keep a suggested question to ${SUGGESTION_LIMITS.chars} characters. This one has ${words.length}.`, index);
    }
    const key = words.toLowerCase();
    if (seen.has(key)) throw new SuggestionsRefused("This is the same as another suggested question.", index);
    seen.add(key);
    if (kept.length === SUGGESTION_LIMITS.count) throw new SuggestionsRefused(`A site can have up to ${SUGGESTION_LIMITS.count} suggested questions.`, index);
    kept.push(act === true ? { text: words, act: true } : { text: words });
  });
  return kept;
}

/**
 * What can be shown of a list a site has stored: the ones that pass the same
 * check, cleaned the same way, the first three of them, and `act` only while
 * the site has acting on. It never throws. A site file edited by hand, or a
 * list saved before these rules, shows what it can, and nothing that breaks them.
 */
export function usableSuggestions(input: unknown, acting = true): Suggestion[] {
  if (!Array.isArray(input)) return [];
  const kept: Suggestion[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (kept.length === SUGGESTION_LIMITS.count) break;
    let one: Suggestion | undefined;
    try {
      one = checkSuggestions([item])[0];
    } catch {
      continue;
    }
    if (!one || seen.has(one.text.toLowerCase())) continue;
    seen.add(one.text.toLowerCase());
    kept.push(acting || !one.act ? one : { text: one.text });
  }
  return kept;
}

/** What is wrong with a stored list, as one sentence that says which one, or undefined when it can be saved as it is. For the CLI and publishing. */
export function suggestionsProblem(input: unknown): string | undefined {
  try {
    checkSuggestions(input);
    return undefined;
  } catch (error) {
    if (!(error instanceof SuggestionsRefused)) throw error;
    return error.index === undefined ? error.message : `Suggested question ${error.index + 1}: ${error.message}`;
  }
}
