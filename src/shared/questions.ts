// Grouping questions that mean the same thing, by their words. "How do I
// export invoices?", "export my invoices" and "where can I export an invoice"
// are one group, "export invoice". The words are made comparable (masked,
// lower case, no punctuation), filler like "how do I" is dropped, a plural s
// is taken off, and what is left is put in order.
//
// The database works out the same group for every question it keeps, with
// the function in db/migrations/0011_question_groups.sql. The two must agree,
// and a test holds the migration's list of filler words to this one.
// No extension on this import: the website imports this file too, and its settings refuse one.
import { questionKey } from "./types";

/** Words that say nothing about what someone wants. */
export const FILLER = [
  "a", "an", "and", "are", "can", "could", "do", "does", "for", "from", "get", "go", "have", "how", "i", "in", "is", "it", "me", "my",
  "of", "on", "or", "please", "the", "there", "this", "to", "want", "we", "what", "where", "which", "who", "why", "will", "with", "would", "you", "your",
];
const FILLER_SET = new Set(FILLER);

/** One word as it is grouped: a plural s comes off, but not from a word ending in ss, nor a short one. */
function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

/** The group of a question already made comparable with questionKey. */
export function groupOfKey(key: string): string {
  const words = [...new Set(key.split(" ").filter((word) => word.length > 1 && !FILLER_SET.has(word)).map(stem))];
  // Sorted by character code, as the database does with collate "C".
  words.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return words.join(" ") || key;
}

/** The group a question as typed belongs to. */
export function questionGroup(question: string): string {
  return groupOfKey(questionKey(question));
}
