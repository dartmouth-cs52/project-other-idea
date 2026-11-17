import type { TurnReply } from "../src/shared/types.ts";

// How long the sentence beside the pointer is. The pointer shows where the
// control is, so a caption is the action and the control's label, like "Click
// Sign out." (src/server/prompt.ts, "Writing say"). Nothing else in the
// benchmark reads the sentence's length, and before 17 November 2026 the
// typical caption on the live server had grown to 16 words without anyone
// seeing it. These numbers are printed beside the score so that a change to
// the prompt cannot do that again unseen.

/** The most words a caption has and still counts as short. "Not that one. Click Team." is five. */
export const SHORT_CAPTION_WORDS = 6;

/**
 * Words that tell the visitor about a step after the one pointed at: "then
 * choose Sign out", "After that, click Continue", "Next I'll point at Submit
 * for approval". That step gets its own caption once the visitor has acted,
 * so saying it first is two things to do while the pointer shows one.
 */
const LATER_STEP = /\b(?:then|after that|afterwards)\b|\bI(?:'|’)ll (?:point|show|take)\b/i;

/** Words in a sentence, as a reader counts them: "Click Sign out." is three. */
export function wordsIn(say: string): number {
  const text = say.trim();
  return text ? text.split(/\s+/).length : 0;
}

/** Whether a caption also tells the visitor a later step. */
export function namesALaterStep(say: string): boolean {
  return LATER_STEP.test(say);
}

/**
 * Whether the widget shows this reply's sentence in a caption beside the
 * pointer. A reply with nothing to point at, one that is stuck, and an answer
 * in words are read in the chat, where a sentence or more is right.
 */
export function shownAsCaption(reply: Pick<TurnReply, "target" | "status" | "mode">): boolean {
  return reply.target !== null && reply.status !== "stuck" && reply.mode !== "answer" && reply.mode !== "cannot_help";
}

export interface CaptionStats {
  /** Captions counted. An empty one is left out: the widget shows none. */
  captions: number;
  /** The middle caption's length in words. */
  typicalWords: number;
  /** Captions of `SHORT_CAPTION_WORDS` words or fewer. */
  short: number;
  /** Captions that also tell a later step. */
  laterStep: number;
}

export function captionStats(says: readonly string[]): CaptionStats {
  const shown = says.filter((say) => say.trim());
  const words = shown.map(wordsIn).sort((a, b) => a - b);
  return {
    captions: shown.length,
    typicalWords: words.length ? words[Math.floor(words.length / 2)]! : 0,
    short: words.filter((count) => count <= SHORT_CAPTION_WORDS).length,
    laterStep: shown.filter(namesALaterStep).length,
  };
}

/** The same, as a row of a printed table. */
export function captionRow(says: readonly string[]): Record<string, string | number> {
  const stats = captionStats(says);
  const share = (part: number) => (stats.captions ? `${Math.round((100 * part) / stats.captions)}%` : "n/a");
  return {
    captions: stats.captions,
    "words, typical": stats.typicalWords,
    [`${SHORT_CAPTION_WORDS} words or fewer`]: share(stats.short),
    "tells a later step": share(stats.laterStep),
  };
}
