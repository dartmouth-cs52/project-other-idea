import { TLDS } from "./tlds.ts";

// Rules every sentence is held to before a visitor reads it, whatever the
// model wrote. The model reads text from the customer's page, and anyone who
// can put text on that page (a comment, a display name, a record's title) can
// try to steer what it says. It cannot be argued out of these, because they
// are not in the prompt: they run on the reply.
//
// The rule is one idea: a visitor must not be handed a place to go, a way to
// get in touch or somewhere to send money that Haptic did not point at.
// "Re-enter your password at…" needs a web address. "Call this number to
// confirm your card" needs a number. "Pay the fee to…" needs an account. A
// sentence that carries one is dropped.
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
//   do (tlds.ts), and a number only counts when it is one run of digits that
//   is written the way a phone number is, or sits beside a word that says to
//   call it. A date, a time and a price are never one, whatever the sentence
//   is about.
// - Other languages use the same letters for ordinary words. "Punto de
//   venta" is a point of sale and not ".de", and "Núm. de factura" is an
//   invoice number. So an ending that is also an everyday word only counts
//   when no word follows it, or when what stands before the dot is plainly a
//   name and not an abbreviation.
//
// One more kind of sentence is dropped, though it names no place to go: one
// that asks the visitor to send someone a password, a code or their card
// details. A guide has no reason to say that. "Type your password" into the
// product's own field is a different thing and is left alone.
//
// It errs toward dropping. A dropped sentence costs the visitor some words,
// and the pointer still shows where to go. It is not a proof: someone
// determined will find a spelling this misses.

export type Rule = "markup" | "link" | "email" | "phone" | "contact" | "payment" | "secret" | "length";

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
/** Endings no language uses as a word of its own. */
const SURE_ENDINGS = "org|biz|xyz|ru|cn|uk";
/**
 * Endings that are also an everyday word somewhere: "de" in Spanish, French,
 * Portuguese and Dutch, "com" in Portuguese, "io" and "ai" in Italian, "net",
 * "info", "app", "dev" and "co" in English. After a full stop and a space
 * they are usually just the next word: "Núm. de factura", "Est. net total".
 */
const WORDY_ENDINGS = "com|net|info|co|dev|app|ai|io|de";
const PLAIN_ENDINGS = `${SURE_ENDINGS}|${WORDY_ENDINGS}`;
/** An address written with a space after its dot, "acme-billing. com": the name, the ending, and whether the ending has a capital. */
const SPACED_AFTER = new RegExp(`([\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?)\\s*\\.\\s+(?:(${PLAIN_ENDINGS})|(C[Oo][Mm]|I[Oo]|X[Yy][Zz]|B[Ii][Zz]))(?![\\p{L}\\p{N}-])`, "gu");
/** One written with the space before the dot, "acme .com". No sentence has that by accident. */
const SPACED_BEFORE = new RegExp(`\\s\\.(?:${PLAIN_ENDINGS}|C[Oo][Mm]|I[Oo]|X[Yy][Zz]|B[Ii][Zz])(?![\\p{L}\\p{N}-])`, "u");
/**
 * Words that send the reader to a place, in English. In "at acme. com" what follows is one, whatever comes after it.
 * "To", "on" and "open" are left out: every step says "go to" or "click on" something.
 */
const SENT_THERE = /(?:^|[^\p{L}])(?:at|visit|via)\s*$/iu;

/**
 * Whether the text holds an address with a space after its dot. A sure ending
 * always counts. One that is also a word counts when nothing wordy follows it
 * ("acme. com"), or when the name before the dot could not be an abbreviation
 * (it has a hyphen or a digit, or six letters or more), or when a word before
 * the name sends the reader there. That leaves "Réf. de commande" and
 * "Misc. info in the sidebar" alone.
 */
function hasSpacedAddress(text: string): boolean {
  if (SPACED_BEFORE.test(text)) return true;
  const sure = new RegExp(`^(?:${SURE_ENDINGS})$`);
  for (const found of text.matchAll(SPACED_AFTER)) {
    const name = found[1] ?? "";
    // Only the few words on either side matter, and a long reply should not be read from its start for each one.
    const before = text.slice(Math.max(0, (found.index ?? 0) - 12), found.index ?? 0);
    const after = text.slice((found.index ?? 0) + found[0].length, (found.index ?? 0) + found[0].length + 12);
    const plainlyAName = /[\p{N}-]/u.test(name) || [...name].length >= 6;
    const sent = SENT_THERE.test(before);
    if (found[3]) {
      // "Com" and "Io" with a capital start sentences in Portuguese and Italian, so the name has to give it away.
      if (/[\p{N}-]/u.test(name) || sent) return true;
      continue;
    }
    if (sure.test(found[2] ?? "")) return true;
    const wordFollows = /^\s+\p{L}/u.test(after);
    if (!wordFollows || plainlyAName || sent) return true;
  }
  return false;
}

/**
 * An address said aloud: "acme dot com", "acme punto com". "Punto de venta"
 * and "point de vente" are a point of sale and "punto info" is an information
 * desk, so with those words ".de" only counts when nothing wordy follows,
 * ".info" not at all, and the French "point" only before an ending that is
 * never a word.
 */
const SPELLED = new RegExp(
  `\\b(?:dot|punkt)\\s+(?:${PLAIN_ENDINGS})\\b|\\b(?:punto|ponto)\\s+(?:${SURE_ENDINGS}|com|net|co|dev|app|ai|io)\\b|\\bpoint\\s+(?:${SURE_ENDINGS}|com)\\b|\\b(?:punto|ponto|point)\\s+de\\b(?!\\s+\\p{L})`,
  "iu",
);
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

/** A stray mark in front of a name, ".acme-billing.com" or "@acme-billing.com". A reader looks past it, so the check does too. */
const LEADING_MARK = /(^|[\s("'“‘\[])[@.\-…·•]+(?=[\p{L}\p{N}])/gu;
/** In the scripts written without spaces between words, two characters are a whole name. */
const NO_SPACES_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** Long enough to be a name and not the letters of an abbreviation. */
const isName = (part: string): boolean => [...part].length >= 3 || (NO_SPACES_SCRIPT.test(part) && [...part].length >= 2);
/** Pairs of letters with a dot between that are abbreviations and also end like addresses: "e.g", "a.m", "U.S". */
const SHORT_FORMS = new Set(["e.g", "i.e", "a.m", "p.m", "u.s", "u.k", "n.b", "p.s", "o.k", "a.k", "z.b", "d.h", "u.a", "c.q", "a.c", "d.c", "b.c", "a.d", "v.s", "m.in", "t.ex", "p.ej", "sr.no", "s.no", "no.is"]);
/** "Acct.No", "Ref.No", "Tel.Nr": a short capitalised word, a dot, and "No" or "Nr" with a capital. Norway's and Nauru's own addresses are written small. */
const NUMBER_LABEL = /^\p{Lu}[\p{L}]{0,4}\.(?:No|Nr|NO|NR)$/u;

function hasAddress(folded: string): boolean {
  if (SCHEME.test(folded) || WWW.test(folded) || hasSpacedAddress(folded) || SPELLED.test(folded) || IP_ADDRESS.test(folded)) return true;
  const bare = folded.replace(LEADING_MARK, "$1");
  // Once as written, so an address in Cyrillic or Chinese is seen, and once with look-alike letters read as Latin.
  for (const text of new Set([bare, latin(bare)])) {
    for (const found of text.matchAll(DOTTED)) {
      if (!isEnding(found[2] ?? "")) continue;
      const at = found.index ?? 0;
      const names = (found[1] ?? "").split(".").filter(Boolean);
      const last = names.at(-1) ?? "";
      const before = text.slice(Math.max(0, at - 12), at);
      const after = text.slice(at + found[0].length, at + found[0].length + 12);
      // A path after it settles it: "t.co/x8Zk".
      if (/^[/:][\p{L}\p{N}]/u.test(after)) return true;
      if (NUMBER_LABEL.test(found[0])) continue;
      // A field of a record in a template, "{{ customer.email }}", is not somewhere to go.
      if (/\{\{\s*$/.test(before) && /^\s*\}\}/.test(after)) continue;
      // "m.in" and "Sr.No" end like addresses and are abbreviations. A real name is three letters or more.
      if (names.some(isName) && (isName(last) || (names.length > 1 && [...last].length >= 2))) return true;
      // A shorter one, "x.com" or "t.me", is an address when the sentence sends the reader to it.
      if (!SHORT_FORMS.has(found[0].toLowerCase()) && /(?:^|[^\p{L}])(?:at|to|visit|via|on|open)\s+$/iu.test(before)) return true;
    }
  }
  return false;
}

// Email addresses and handles ----------------------------------------------

/** A name, an at-sign and a name, with nothing between. A payment handle like "name@bank" is caught as well. */
const EMAIL = /[\p{L}\p{N}._%+-]@[\p{L}\p{N}]/u;
const MESSAGING = /\b(?:telegram|whatsapp|signal|wechat|viber|discord|skype|instagram|snapchat|tiktok)\b/i;
/** A name on one of those: "@acme_refunds", or a word, a dot and two digits, as one of them writes its names. */
const HANDLE = /(?:^|\s)@[\p{L}\p{N}_]{3,}|(?:^|\s)\p{L}[\p{L}\p{N}_]{2,}\.\d{2}(?![\p{L}\p{N}])/u;

// Somewhere to send money -----------------------------------------------------

/** A bank account in the international form: two letters, two digits, then groups of four. */
const IBAN = /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?(?![\p{L}\p{N}])/u;
/** A wallet for a cryptocurrency, in the three commonest shapes. */
const WALLET = /(?<![\p{L}\p{N}])(?:bc1[a-z0-9]{20,70}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40})(?![\p{L}\p{N}])/u;
/** A name on a payment app: "$AcmeRefunds on Cash App". */
const PAY_APPS = /\b(?:cash ?app|venmo|paypal|zelle|revolut|wise)\b/i;
const PAY_NAME = /(?:^|\s)[$@][\p{L}][\p{L}\p{N}_-]{2,}/u;
const hasPayment = (text: string): boolean => IBAN.test(text) || WALLET.test(text) || (PAY_APPS.test(text) && PAY_NAME.test(text));

// Phone numbers -------------------------------------------------------------

/** Words that tell someone to ring or text, in the languages a model is most likely to be steered into. */
const CALL_WORDS =
  "call(?:s|ing|ed)?|dial(?:s|ing)?|ring|phone|telephone|tel|fax|sms|hotline|helpline|whatsapp|telegram|viber|llam[ae]\\w*|appel\\w*|t[ée]l[ée]phon\\w*|anruf\\w*|rufen|telefon\\w*|ligue|ligar|chiam\\w*|bellen|bel|zadzwo\\w*|позвон\\w*|звон\\w*";
const CALL = new RegExp(`\\b(?:${CALL_WORDS})\\b|電話|电话|拨打|致电|전화`, "iu");
/**
 * The same words as the last thing before a number: "call us on", "Tel:".
 * And "text" where it is something to do and not something to type: at the
 * start, or after "to", "and", "or", "please", "then" or "just".
 */
const CALL_JUST_BEFORE = new RegExp(
  `(?:\\b(?:${CALL_WORDS})\\b|(?:^|[.!?;,:]\\s*|\\b(?:to|and|or|please|then|just)\\s+)text\\b|電話|电话|拨打|致电|전화)[.:]?[^.!?;,\\d]{0,30}$`,
  "iu",
);
/**
 * Words for getting hold of someone that are too common to count alone: with
 * one, a number has to be written in groups, the way one to dial is. "Number"
 * and "line" are not here: they sit beside every order and invoice.
 */
const REACH = /\b(?:contact\w*|reach|speak|talk|support|desk|agent|helpdesk)\b/iu;
/** A number that starts with a plus sign and a country, however it is spaced. */
const INTERNATIONAL = /\+\s?\d(?:[\s().\-/]*\d){6,}/;
/** Three digits, three and four, the way a North American number is written. */
const THREE_THREE_FOUR = /(?<![\d-])\(?\d{3}\)?[\s.\-/]{1,2}\d{3}[\s.-]\d{4}(?![\d-])/;
/** "Text PAY to 70070". */
const SHORT_CODE = /\b(?:text|sms|send)\b[^.!?]{0,40}\bto\s+\d{4,6}\b/i;
/** A number with a word in it, as dialled from a keypad: "1-800-FLOWERS". */
const WORD_NUMBER = /\d[-\s][A-Z]{3,}\b|\b[A-Z]{3,}[-\s]?\d/;
/**
 * Digits that are never a number to dial, however a sentence about calls or
 * phone plans puts them: a date, a time, a price, a percentage, and an amount
 * with commas between its thousands. They are taken out before numbers are
 * looked for. A date has to stand alone, so "01.23.45.67.89" is not read as
 * one with something after it.
 */
const NOT_DIALLED = new RegExp(
  [
    String.raw`(?<![\d./-])\d{4}-\d{1,2}-\d{1,2}(?![./-]?\d)`,
    String.raw`(?<![\d./-])\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})(?![./-]?\d)`,
    String.raw`(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)`,
    String.raw`[$€£¥₹₩₽]\s?\d[\d.,]*`,
    String.raw`(?<![\d.,])\d[\d.,]*\s?(?:[%€£]|(?:percent|usd|eur|gbp|chf|sek|nok|dkk|pln|dollars?|euros?|pounds?)\b)`,
    String.raw`(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,])`,
  ].join("|"),
  "giu",
);
/**
 * One run of digits that could be dialled: groups of digits with a single
 * space, hyphen, slash or dot between them, or brackets round one. A full stop
 * followed by a space is not such a gap, so a run never reaches from one
 * sentence into the next.
 */
const RUN = /(?<![\p{L}\p{N}.,])\(?\d+\)?(?:(?:[ ./]| ?- ?| ?\(|\) ?)\(?\d+\)?)*(?![\p{L}\d])/gu;
/** An amount written with spaces between its thousands, "1 000 000". */
const THOUSANDS = /^\d{1,3}(?: \d{3})+$/;
/** The same, but the gaps may be wider or hold a dot: "415. 555. 0132". Only looked for once a word has said to ring. */
const LOOSE_RUN = /(?<![\p{L}\p{N}])\d+(?:[\s.\-/()]{1,3}\d+)+(?![\p{L}\d])/gu;
/** A placeholder that shows how to write a number, "000.000.000-00", is one digit over and over. */
const oneDigit = (digits: string): boolean => /^(\d)\1+$/.test(digits);

function hasPhone(folded: string): boolean {
  if (INTERNATIONAL.test(folded) || THREE_THREE_FOUR.test(folded) || SHORT_CODE.test(folded)) return true;
  const called = CALL.test(folded);
  if (called && folded.replace(/\D/g, "").length >= 3 && WORD_NUMBER.test(folded)) return true;
  const asked = called || REACH.test(folded);
  // A dot in the middle of the line between digits is one more way to write the gap.
  const text = folded.replace(/(?<=\d)\s*[·•∙‧]\s*(?=\d)/g, "-").replace(NOT_DIALLED, " ¤ ");
  if (THREE_THREE_FOUR.test(text)) return true;
  if (called) {
    for (const run of text.matchAll(LOOSE_RUN)) {
      const digits = run[0].replace(/\D/g, "");
      if (digits.length >= 7 && digits.length <= 15 && !oneDigit(digits) && !THOUSANDS.test(run[0])) return true;
    }
  }
  for (const run of text.matchAll(RUN)) {
    const groups = run[0].match(/\d+/g) ?? [];
    const digits = groups.join("").length;
    if (digits < 5 || digits > 15 || oneDigit(groups.join(""))) continue;
    // Written in groups, and not an amount: the way a number to dial is set down.
    const grouped = groups.length >= 2 && !THOUSANDS.test(run[0]);
    // A national number: a leading 0 and nine digits or more, in groups. "020 7946 0958", "0171/1234567", "01 23 45 67 89".
    if (grouped && /^\(?0/.test(run[0]) && digits >= 9) return true;
    // Four or five pairs, as numbers are written in France and Norway.
    if (groups.length >= 4 && groups.every((group) => group.length === 2)) return true;
    // Seven digits or more in groups, in a sentence about ringing someone or getting hold of them.
    if (grouped && digits >= 7 && asked) return true;
    // Three threes read as an amount, and also as a mobile number in Spain: "612 345 678". In such a sentence it is the number.
    if (asked && digits === 9 && THOUSANDS.test(run[0])) return true;
    // Any number straight after a word that says to ring it: "call 87070", "Tel: 02079460958".
    if (CALL_JUST_BEFORE.test(text.slice(Math.max(0, (run.index ?? 0) - 60), run.index ?? 0))) return true;
  }
  return false;
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
    if (hasPayment(folded)) return "payment";
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
 * more, or one of a few short words that end sentences all the time and are
 * never an abbreviation ("out", "it", "tab"), and a capital follows. So
 * "No. 12", "e.g. this" and "f.eks. Pro" stay in one piece. Dropping half of
 * one of those would leave "Click No." A wrong guess the other way only means
 * two sentences are kept or dropped together.
 *
 * Scripts with no capitals (Hindi, Arabic, Hebrew, Korean) start a sentence
 * with a letter of their own kind, and Hindi and Urdu end one with their own
 * mark.
 */
const SHORT_LAST_WORDS = "out|it|on|up|off|now|you|one|too|so|do|go|is|tab|box|bar|all|row|top|end|day|yes|way|new|key|log|map|tag|use|run|did|not|yet|ok";
const SENTENCE_END = new RegExp(
  String.raw`(?<=[\p{L}\p{N}]{4}[)"'”’\]]*[.!?]|(?<![\p{L}\p{N}.])(?:${SHORT_LAST_WORDS})[)"'”’\]]*\.|[!?。！？।॥؟۔])\s+(?=["'“‘(\[]?[\p{Lu}\p{Lo}\p{N}])|(?<=[^A-Za-z0-9\s][。！？।॥])(?=\S)`,
  "gu",
);

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
