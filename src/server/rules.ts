// Rules every sentence is held to before a visitor reads it, whatever the
// model wrote. The model reads text from the customer's page, and anyone who
// can put text on that page (a comment, a display name, a record's title) can
// try to steer what it says. It cannot be argued out of these, because they
// are not in the prompt: they run on the reply.
//
// - Plain text. Markup is removed, though the widget only ever shows text as text.
// - No web addresses, email addresses or phone numbers. A sentence that
//   carries one is dropped whole. "Re-enter your password at…" needs one.
// - A length limit, kept by dropping the last sentences, not by cutting words.

export type Rule = "markup" | "link" | "email" | "phone" | "length";

export interface Checked {
  /** What is left to show. Empty when no sentence survived. */
  say: string;
  /** The rules that changed it. Empty when it could be shown as written. */
  broke: Rule[];
}

/** A step's sentence is one or two short ones. This is room for that and no more. */
export const MAX_STEP_SAY = 280;

const SCHEME = /\b(?:https?:\/\/|www\.)\S+/i;
/**
 * A dot inside a word with letters on both sides, like "example.com". In a
 * sentence a full stop is followed by a space, so this is an address unless it
 * is a file's name. The endings listed are file types that are not also the
 * end of a web address (.zip and .md are both, so they are not here).
 */
const DOTTED = /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.([a-z]{2,24})\b/gi;
const FILE_ENDINGS = new Set(
  "pdf csv json js jsx ts tsx png jpg jpeg gif svg webp txt html htm css xml yaml yml xlsx xls docx doc pptx ppt mp3 mp4 log sql".split(" "),
);
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
/** Digits with the usual separators between them. Nine or more digits is a number to call, and fewer is a date or a count. */
const NUMBER_RUN = /\+?\d[\d\s().-]{7,}\d/g;

function ruleBrokenBy(sentence: string): Rule | undefined {
  if (EMAIL.test(sentence)) return "email";
  if (SCHEME.test(sentence)) return "link";
  for (const found of sentence.matchAll(DOTTED)) if (!FILE_ENDINGS.has((found[1] ?? "").toLowerCase())) return "link";
  for (const found of sentence.matchAll(NUMBER_RUN)) if (found[0].replace(/\D/g, "").length >= 9) return "phone";
  return undefined;
}

/** Markup taken out and white space made single. A link keeps its address beside its words, so the address is still seen below. */
function plain(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, "$1 $2")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*(?:#{1,6}|[-*•])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function checkSay(text: string, max = MAX_STEP_SAY): Checked {
  const broke = new Set<Rule>();
  const tidy = text.replace(/\s+/g, " ").trim();
  const cleaned = plain(text);
  if (cleaned !== tidy) broke.add("markup");

  // A sentence ends at ., ! or ? followed by a space. An address has no space in it, so it stays in one piece.
  const kept: string[] = [];
  for (const sentence of cleaned.split(/(?<=[.!?])\s+/)) {
    const rule = ruleBrokenBy(sentence);
    if (rule) broke.add(rule);
    else if (sentence) kept.push(sentence);
  }

  let say = "";
  for (const sentence of kept) {
    const next = say ? `${say} ${sentence}` : sentence;
    if (next.length > max) {
      broke.add("length");
      // One sentence that is too long on its own is cut at a word, so there is still something to read.
      if (!say) say = sentence.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
      break;
    }
    say = next;
  }
  return { say, broke: [...broke] };
}
