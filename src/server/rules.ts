import { TLDS } from "./tlds.ts";

// Rules every sentence is held to before a visitor reads it, whatever the
// model wrote. The model reads text from the customer's page, and anyone who
// can put text on that page (a comment, a display name, a record's title) can
// try to steer what it says. It cannot be argued out of these, because they
// are not in the prompt: they run on the reply.
//
// The rule is one idea: a visitor must not be handed a place to go or a way
// to get in touch that Haptic did not point at. "Re-enter your password at…"
// needs a web address. "Call this number to confirm your card" needs a
// number. A sentence that carries one is dropped.
//
// Two things make that harder than it sounds, and both were found by trying
// to break an earlier version with several hundred inputs:
//
// - An address can be dressed up so that a pattern misses it and a person
//   still reads it: an invisible character beside the dot, a Cyrillic "о" in
//   ".com", full-width letters, a space after the dot. So the text is checked
//   in a folded form, with all of that undone. What is shown is not changed.
// - Most things with a dot or a long number in them are not addresses or
//   phone numbers: "invoice.paid", "v2.1.beta", "2026-11-15 14:30", an order
//   number, "t.ex." in Swedish. So an address has to end the way real ones
//   do (tlds.ts), and a number only counts when the sentence says to call it
//   or it is written the way a phone number is.
//
// One more kind of sentence is dropped, though it names no place to go: one
// that asks the visitor to send someone a password, a code or their card
// details. A guide has no reason to say that. "Type your password" into the
// product's own field is a different thing and is left alone.
//
// It errs toward dropping. A dropped sentence costs the visitor some words,
// and the pointer still shows where to go. It is not a proof: someone
// determined will find a spelling this misses.

export type Rule = "markup" | "link" | "email" | "phone" | "contact" | "secret" | "length";

export interface Checked {
  /** What is left to show. Empty when no sentence survived. */
  say: string;
  /** The rules that changed it. Empty when it could be shown as written. */
  broke: Rule[];
}

/** A step's sentence is one or two short ones. This is room for that and no more. */
export const MAX_STEP_SAY = 280;

// Folding -------------------------------------------------------------------

/** Characters that draw nothing: zero-width spaces and joiners, direction marks, soft hyphens, variation selectors. */
const INVISIBLE = /[\p{Cf}͏᠋-᠏︀-️\u{E0100}-\u{E01EF}]/gu;
/** Letters from other alphabets that look like a Latin one, so ".cоm" with a Cyrillic "о" reads as ".com". */
const LOOKALIKES: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", у: "y", і: "i", ј: "j", ѕ: "s", ԁ: "d", һ: "h", ո: "n", м: "m", т: "t", к: "k", в: "b", н: "h",
  ο: "o", α: "a", ν: "v", ρ: "p", τ: "t", ι: "i", κ: "k", ε: "e", υ: "u", ɡ: "g", ɑ: "a", ı: "i", ǀ: "l",
};
/** Where the digit zero sits in the scripts that have digits of their own. The nine after it are 1 to 9. */
const ZEROS = [0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x17e0, 0x1810];

/**
 * The text as a reader takes it in, for checking only: compatibility forms
 * made plain (full-width, bold and circled letters), invisible characters and
 * stray accents gone, digits from any script as 0 to 9, every kind of dash a
 * hyphen, markup characters turned to spaces, and the ways of writing a dot or
 * an at-sign without typing one ("[.]", "(at)") undone.
 *
 * Angle brackets are read both ways, because each hides an address from the
 * other: "acme<span>.</span>com" needs its tags removed, and "<acme.com/login>"
 * needs its brackets opened.
 */
function fold(text: string, tags: "removed" | "opened"): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/\p{Mn}/gu, "")
    .replace(/\p{Nd}/gu, (digit) => {
      const code = digit.codePointAt(0)!;
      const zero = ZEROS.find((start) => code >= start && code <= start + 9);
      return zero === undefined ? digit : String(code - zero);
    })
    .replace(/[‐-―−﹘﹣]/g, "-")
    .replace(/<[^<>\s][^<>]{0,60}>/g, (tag) => (tags === "removed" ? "" : ` ${tag.slice(1, -1)} `))
    .replace(/\s*[[({]\s*(?:\.|dot)\s*[\])}]\s*/gi, ".")
    .replace(/\s*[[({]\s*at\s*[\])}]\s*/gi, "@")
    .replace(/(?<=[A-Za-z0-9])\s*[。｡]\s*(?=[A-Za-z])/g, ".")
    .replace(/[_*~`]+/g, " ");
}

const latin = (text: string): string => text.replace(/[^\u0000-\u007f]/gu, (letter) => LOOKALIKES[letter] ?? LOOKALIKES[letter.toLowerCase()] ?? letter);

// Addresses -----------------------------------------------------------------

const SCHEME = /(?:^|[^a-z])(?:h[tx]{2}ps?|ftp)\s*:\s*\/+/i;
const WWW = /(?:^|[^\p{L}\p{N}])www\d?\s*\.\s*[\p{L}\p{N}]/iu;
/** Names joined by dots and ending in letters, like "login.acme-billing.com". Whether it is an address depends on the ending. */
const DOTTED = /(?<![\p{L}\p{N}@.-])((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+)(\p{L}{2,24})(?![\p{L}\p{N}-])/gu;
/**
 * Endings for an address written with a space beside its dot: "acme-billing. com".
 * In small letters these are not how a sentence starts. With a capital, "Net"
 * and "Org" and "App" are, so only the ones that are never a word count then.
 */
const PLAIN_ENDINGS = "com|net|org|io|co|biz|xyz|info|dev|app|ai|ru|cn|de|uk";
const SPACED = new RegExp(
  `[\\p{L}\\p{N}]\\s*\\.\\s+(?:${PLAIN_ENDINGS}|C[Oo][Mm]|I[Oo]|X[Yy][Zz]|B[Ii][Zz])(?![\\p{L}\\p{N}-])|\\s\\.(?:${PLAIN_ENDINGS}|C[Oo][Mm]|I[Oo]|X[Yy][Zz]|B[Ii][Zz])(?![\\p{L}\\p{N}-])`,
  "u",
);
const SPELLED = new RegExp(`\\b(?:dot|punto|punkt)\\s+(?:${PLAIN_ENDINGS})\\b`, "i");
const IP_ADDRESS = /(?<![\d.])(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?![\d.]\d)/;

/** An ending as the root zone lists it: plain letters as they are, any other script in the form a browser turns it into. */
function isEnding(label: string): boolean {
  const lower = label.toLowerCase();
  if (/^[a-z]+$/.test(lower)) return TLDS.has(lower);
  try {
    return TLDS.has(new URL(`http://a.${lower}`).hostname.split(".").pop() ?? "");
  } catch {
    return false;
  }
}

function hasAddress(folded: string): boolean {
  if (SCHEME.test(folded) || WWW.test(folded) || SPACED.test(folded) || SPELLED.test(folded) || IP_ADDRESS.test(folded)) return true;
  // Once as written, so an address in Cyrillic or Chinese is seen, and once with look-alike letters read as Latin.
  for (const text of new Set([folded, latin(folded)])) {
    for (const found of text.matchAll(DOTTED)) {
      if (!isEnding(found[2] ?? "")) continue;
      const names = (found[1] ?? "").split(".").filter(Boolean);
      const after = text.slice((found.index ?? 0) + found[0].length);
      // "m.in" and "Sr.No" end like addresses and are abbreviations. A real name is three letters or more, or has a path after it.
      if (names.some((name) => name.length >= 3) && (names.at(-1)!.length >= 3 || names.length > 1 && names.at(-1)!.length >= 2) || /^[/:][\p{L}\p{N}]/u.test(after)) return true;
    }
  }
  return false;
}

// Email addresses and handles ----------------------------------------------

/** A name, an at-sign and a name, with nothing between. A payment handle like "name@bank" is caught as well. */
const EMAIL = /[\p{L}\p{N}._%+-]@[\p{L}\p{N}]/u;
const MESSAGING = /\b(?:telegram|whatsapp|signal|wechat|viber|discord|skype|instagram|snapchat|tiktok)\b/i;
const HANDLE = /(?:^|\s)@[\p{L}\p{N}_]{3,}/u;

// Phone numbers -------------------------------------------------------------

/** Words that tell someone to ring or text, in the languages a model is most likely to be steered into. */
const CALL =
  /\b(?:call(?:s|ing|ed)?|dial(?:s|ing)?|ring|phone|telephone|fax|sms|hotline|helpline|whatsapp|telegram|viber|llam[ae]\w*|appel\w*|t[ée]l[ée]phon\w*|anruf\w*|rufen|telefon\w*|ligue|ligar|chiam\w*|bellen|zadzwo\w*|позвон\w*|звон\w*)\b|電話|电话|拨打|致电|전화/iu;
/** A number that starts with a plus sign and a country, however it is spaced. */
const INTERNATIONAL = /\+\s?\d(?:[\s().\-/]*\d){6,}/;
/** Three digits, three and four, the way a North American number is written. */
const THREE_THREE_FOUR = /(?<![\d-])\(?\d{3}\)?[\s.\-/]{1,2}\d{3}[\s.-]\d{4}(?![\d-])/;
/** "Text PAY to 70070". */
const SHORT_CODE = /\b(?:text|sms|send)\b[^.!?]{0,40}\bto\s+\d{4,6}\b/i;
/** A number with a word in it, as dialled from a keypad: "1-800-FLOWERS". */
const WORD_NUMBER = /\d[-\s][A-Z]{3,}\b|\b[A-Z]{3,}[-\s]?\d/;

function hasPhone(folded: string): boolean {
  if (INTERNATIONAL.test(folded) || THREE_THREE_FOUR.test(folded) || SHORT_CODE.test(folded)) return true;
  if (!CALL.test(folded)) return false;
  // With a word that says to ring, any run of digits long enough to dial counts, whatever sits between them.
  const digits = folded.replace(/\D/g, "").length;
  return digits >= 6 || (digits >= 3 && WORD_NUMBER.test(folded));
}

// Secrets -------------------------------------------------------------------

const SECRETS = "password|passcode|passphrase|pin|login|log-in|credentials|verification code|security code|one-time code|code|card number|card details|cvv|cvc|api key|secret key|recovery (?:code|phrase)|seed phrase";
/**
 * A sentence that tells the visitor to hand a secret to someone: "email your
 * password to the admin", "tell us your code". It needs a word for passing
 * something on, then "your", then the secret, so a button called "Send code"
 * and a step like "Type your password" are not touched.
 */
const HAND_OVER = new RegExp(
  `\\b(?:send|e-?mail|mail|share|tell|give|text|message|forward|post|dm|read out|reply with|provide)\\b[^.!?]{0,40}\\b(?:your|their)\\s+(?:\\w+\\s+){0,2}(?:${SECRETS})\\b`,
  "i",
);

function ruleBrokenBy(sentence: string): Rule | undefined {
  for (const folded of new Set([fold(sentence, "removed"), fold(sentence, "opened")])) {
    if (EMAIL.test(folded)) return "email";
    if (hasAddress(folded)) return "link";
    if (hasPhone(folded)) return "phone";
    if (MESSAGING.test(folded) && HANDLE.test(folded)) return "contact";
    if (HAND_OVER.test(folded)) return "secret";
  }
  return undefined;
}

// Markup and length ---------------------------------------------------------

/**
 * Bold and code marks taken off, and a link written out with its address
 * beside its words so the address is still seen above. Nothing else is
 * touched: the widget only ever shows text as text, so "<Enter>" and "</body>"
 * are harmless, and a guide needs to be able to say them.
 */
function plain(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, "$1 $2")
    .replace(/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*/g, (whole, inner: string) => (/[\p{L}\p{N}]/u.test(inner) ? inner : whole))
    .replace(/`([^`\s](?:[^`]{0,38}[^`\s])?)`/g, (whole, inner: string) => (/[\p{L}\p{N}]/u.test(inner) ? inner : whole))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Where one sentence ends and the next begins. It is cautious on purpose: a
 * full stop only ends a sentence when the word before it is four letters or
 * more and a capital follows, so "No. 12", "e.g. this" and "f.eks. Pro" stay
 * in one piece. Dropping half of one of those would leave "Click No." A wrong
 * guess the other way only means two sentences are kept or dropped together.
 */
const SENTENCE_END = /(?<=[\p{L}\p{N}]{4}[)"'”’\]]*[.!?]|[!?。！？])\s+(?=["'“‘(\[]?[\p{Lu}\p{N}])|(?<=[^A-Za-z0-9\s][。！？])(?=\S)/gu;

/** The text in sentences, each with the space that followed it, so that what is kept goes back together exactly as it was. */
function sentences(text: string): string[] {
  const pieces: string[] = [];
  let from = 0;
  for (const end of text.matchAll(SENTENCE_END)) {
    const at = (end.index ?? 0) + end[0].length;
    pieces.push(text.slice(from, at));
    from = at;
  }
  pieces.push(text.slice(from));
  return pieces.filter((piece) => piece.trim());
}

export function checkSay(text: string, max = MAX_STEP_SAY): Checked {
  const broke = new Set<Rule>();
  const tidy = text.replace(/\s+/g, " ").trim();
  const cleaned = plain(text);
  if (cleaned !== tidy) broke.add("markup");

  // Read whole first: an address can be written across what looks like the end of a sentence ("acme-billing. Com").
  let kept = sentences(cleaned);
  if (ruleBrokenBy(cleaned)) {
    kept = kept.filter((sentence) => {
      const rule = ruleBrokenBy(sentence);
      if (rule) broke.add(rule);
      return !rule;
    });
    // Dropping a sentence can bring the two halves of an address together, and some are only seen whole. What is left is read once more.
    const rule = ruleBrokenBy(kept.join(""));
    if (rule) return { say: "", broke: [...broke.add(rule)] };
  }

  let say = "";
  for (const sentence of kept) {
    const next = say + sentence;
    if (next.trimEnd().length > max) {
      broke.add("length");
      // One sentence that is too long on its own is cut, at a space where there is one near the end, so there is still something to read.
      if (!say) {
        const cut = sentence.slice(0, max - 1);
        const space = cut.lastIndexOf(" ");
        say = (space > max * 0.6 ? cut.slice(0, space) : cut) + "…";
      }
      break;
    }
    say = next;
  }
  say = say.trimEnd();
  return { say, broke: [...broke] };
}
