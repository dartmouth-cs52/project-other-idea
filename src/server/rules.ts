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
// Three things make that harder than it sounds, and all three were found by
// trying to break earlier versions with several hundred inputs:
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
//   call it. Dates, times and prices are taken out before a run is looked
//   for, so "2026/11/15" and "08.30-17.00" are not one. A number that starts
//   with a plus sign is read before they are taken out, because that is how
//   a number to dial from abroad is written; a lone decimal and an amount
//   with its currency after it are left alone ("+40.712776", "+1.250.000 €").
// - Other languages use the same letters for ordinary words. "Punto de
//   venta" is a point of sale and not ".de", and "Núm. de factura" is an
//   invoice number. So an ending that is also an everyday word only counts
//   when no word or number follows it, or when what stands before the dot is
//   plainly a name and not an abbreviation.
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

/**
 * The scripts written without spaces between words (Chinese, Japanese, Thai),
 * and Korean, which joins its particles onto the word before. In them an
 * address or a number can sit straight against the words around it:
 * "请打开acme-billing.com重新输入密码", "請撥打0800123456確認".
 */
const JOINED_SCRIPTS = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}`;

// Addresses -----------------------------------------------------------------

const SCHEME = /(?:^|[^a-z])(?:h[tx]{2}ps?|ftp)\s*:\s*\/+/i;
const WWW = /(?:^|[^\p{L}\p{N}])www\d?\s*\.\s*[\p{L}\p{N}]/iu;
/** One name in an address: letters and digits, with hyphens inside. */
const NAME = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?`;
/**
 * Names joined by dots and ending in letters, like "login.acme-billing.com". Whether it is an address depends on the ending.
 * After one of the joined scripts a name may start straight away, and a Latin ending stops where that script starts again.
 */
const DOTTED = new RegExp(
  String.raw`(?:(?<![\p{L}\p{N}@.-])|(?<=[${JOINED_SCRIPTS}])(?=\p{Script=Latin}))((?:${NAME}\.)+)(\p{Script=Latin}{2,24}(?![\p{Script=Latin}\p{N}-])|[^\P{L}\p{Script=Latin}]{2,24}(?![\p{L}\p{N}-]))`,
  "gu",
);
/** Endings no language uses as a word of its own. */
const SURE_ENDINGS = "org|biz|xyz|ru|cn|uk";
const SURE = new Set(SURE_ENDINGS.split("|"));
/**
 * Endings that are also an everyday word somewhere: "de" in Spanish, French,
 * Portuguese and Dutch, "com" in Portuguese, "io" and "ai" in Italian, "net",
 * "info", "app", "dev" and "co" in English. After a full stop and a space
 * they are usually just the next word: "Núm. de factura", "Est. net total".
 */
const WORDY_ENDINGS = "com|net|info|co|dev|app|ai|io|de";
const PLAIN_ENDINGS = `${SURE_ENDINGS}|${WORDY_ENDINGS}`;
/**
 * An address written with a space after its dot, "acme-billing. com": the name, the ending, and whether the ending has a capital.
 * The name starts where a word starts, so a long word is not read again from each of its letters.
 */
const SPACED_AFTER = new RegExp(
  String.raw`(?<![\p{L}\p{N}]|[\p{L}\p{N}]-)(${NAME})\s*\.\s+(?:(${PLAIN_ENDINGS})|(C[Oo][Mm]|I[Oo]|X[Yy][Zz]|B[Ii][Zz]|O[Rr][Gg]))(?![\p{L}\p{N}-])`,
  "gu",
);
/**
 * One written with the space before the dot, "acme .com". A sentence about
 * domain names can have that too ("Domains ending in .app need HTTPS"), and
 * is dropped with it: nothing was found that tells the two apart.
 */
const SPACED_BEFORE = new RegExp(`\\s\\.(?:${PLAIN_ENDINGS}|C[Oo][Mm]|I[Oo]|X[Yy][Zz]|B[Ii][Zz]|O[Rr][Gg])(?![\\p{L}\\p{N}-])`, "u");
/**
 * Words that send the reader to a place, in English. In "at acme. com" what follows is one, whatever comes after it.
 * "To", "on" and "open" are left out: every step says "go to" or "click on" something.
 */
const SENT_THERE = /(?:^|[^\p{L}])(?:at|visit|via)\s*$/iu;

/**
 * Whether the text holds an address with a space after its dot. A sure ending
 * written small always counts. One that is also a word counts when no word or
 * number follows it ("acme. com"), or when the name before the dot could not
 * be an abbreviation (it has a hyphen or a digit, or six letters or more), or
 * when a word before the name sends the reader there. That leaves "Réf. de
 * commande", "nov. de 2026" and "Misc. info in the sidebar" alone, and lets
 * "Go to bank. de 24/7" through: "go to" is in every step.
 */
function hasSpacedAddress(text: string): boolean {
  if (SPACED_BEFORE.test(text)) return true;
  for (const found of text.matchAll(SPACED_AFTER)) {
    const name = found[1] ?? "";
    const at = found.index ?? 0;
    const end = at + found[0].length;
    // Only the few words on either side matter, and a long reply should not be read from its start for each one.
    const before = text.slice(Math.max(0, at - 12), at);
    const after = text.slice(end, end + 12);
    const sent = SENT_THERE.test(before);
    if (found[3]) {
      // An ending with a capital, "Com", "Io" or "Org", may be the first word of the next sentence ("Com" and "Io" are
      // Portuguese and Italian words), so the name has to give it away: letters and digits together ("acme2"), letters
      // with a hyphen between parts of two characters or more ("acme-billing"), or "at", "visit" or "via" before it.
      // A number ("vence em 15-12. Com ele") and "e-mail" do not, so "Go to e-pay. Com" and "Go to 247. Com" get through.
      const lettersAndDigits = /\p{L}/u.test(name) && /\p{N}/u.test(name);
      const hyphened = /\p{L}/u.test(name) && name.includes("-") && name.split("-").every((part) => [...part].length >= 2);
      if (lettersAndDigits || hyphened || sent) return true;
      continue;
    }
    if (SURE.has(found[2] ?? "")) return true;
    const wordFollows = /^\s+[\p{L}\p{N}]/u.test(after);
    const plainlyAName = /[\p{N}-]/u.test(name) || [...name].length >= 6;
    if (!wordFollows || plainlyAName || sent) return true;
  }
  return false;
}

/**
 * Words before "dot", "punkt", "punto" or "ponto" that make it the ordinary
 * word: an article or a preposition ("clique no ponto com o botão direito" is
 * "click the point with the right button", and in German "am Punkt"). Before
 * "dot" and "punkt", also the words two, three or four ("the three dot app
 * menu"), or a hyphen ("three-dot"). A digit does not: "the 3 dot app menu"
 * is dropped.
 */
const ARTICLES = "o|no|do|ao|um|pelo|cada|este|esse|el|un|del|al|il|lo|nel";
const GERMAN_ARTICLES = "den|dem|der|einen|einem|im|am|zum|beim";
/**
 * An address said aloud: "acme dot com", "acme punto com". "Punto de venta"
 * and "point de vente" are a point of sale and "punto info" is an information
 * desk, so with those words ".de" only counts when nothing wordy follows,
 * ".info" not at all, and the French "point" only before an ending that is
 * never a word.
 */
const SPELLED = new RegExp(
  String.raw`(?<!-|\b(?:${GERMAN_ARTICLES}|${ARTICLES}|two|three|four)\s)\b(?:dot|punkt)\s+(?:${PLAIN_ENDINGS})\b` +
    String.raw`|(?<!\b(?:${ARTICLES})\s)\b(?:punto|ponto)\s+(?:${SURE_ENDINGS}|com|net|co|dev|app|ai|io)\b` +
    String.raw`|\bpoint\s+(?:${SURE_ENDINGS}|com)\b|\b(?:punto|ponto|point)\s+de\b(?!\s+\p{L})`,
  "iu",
);

/** Four numbers with dots between, the way a server's address is written. */
const IP_ADDRESS = /(?<![\d.])(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?![\d.]\d)/g;
/**
 * A version or a clause is written the same way, and is named just before it: "version 2.1.0.4", "driver 1.0.0.12",
 * "clause 4.2.1.3", "§ 4.2.1.3". So a server's address after one of these words gets through: "at release 45.33.82.7".
 */
const NUMBERED = /(?<!\p{L})(?:version|ver|v|release|build|driver|clause|section|sect|§|art|article|step|chapter|rule|paragraph|ziff|abs)\.?\s*$/iu;
const hasIpAddress = (text: string): boolean =>
  [...text.matchAll(IP_ADDRESS)].some((found) => !NUMBERED.test(text.slice(Math.max(0, (found.index ?? 0) - 16), found.index ?? 0)));

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

/**
 * A stray mark in front of a name, ".acme-billing.com" or "@acme-billing.com". A reader looks past it, so the check does too.
 * That includes the at-sign of a mention: "@maria.kim" is read as "maria.kim", which ends like an address (.kim), and is
 * dropped. "@maria.lopez" is kept. Sparing every mention would let "@acmebilling.support" through.
 */
const LEADING_MARK = /(^|[\s("'“‘\[])[@.\-…·•]+(?=[\p{L}\p{N}])/gu;
/** In the joined scripts two characters are a whole name. */
const JOINED_LETTER = new RegExp(`[${JOINED_SCRIPTS}]`, "u");
/** Long enough to be a name and not the letters of an abbreviation. */
const isName = (part: string): boolean => [...part].length >= 3 || (JOINED_LETTER.test(part) && [...part].length >= 2);
/**
 * Pairs of letters with a dot between that are abbreviations and also end like addresses: "e.g", "a.m", "U.S". They are
 * compared in lower case. "sr.no" and "s.no" are here for when they are written small: with capitals, the number-label
 * rule below spares them first.
 */
const SHORT_FORMS = new Set(["e.g", "i.e", "a.m", "p.m", "u.s", "u.k", "n.b", "p.s", "o.k", "a.k", "z.b", "d.h", "u.a", "c.q", "a.c", "d.c", "b.c", "a.d", "v.s", "m.in", "t.ex", "p.ej", "sr.no", "s.no", "no.is"]);
/** "Acct.No", "Ref.No", "Tel.Nr": a short capitalised word, a dot, and "No" or "Nr" with a capital. */
const NUMBER_LABEL = /^\p{Lu}\p{L}{0,4}\.(?:No|Nr|NO|NR)$/u;
/**
 * The words such a label is made from. ".no" is Norway's ending, and the writer chooses the capitals, so "No" is only
 * read as "number" after one of these: "Vipps.No" is an address. After any other short word "Nr" still is: "Kd.Nr".
 */
const LABEL_WORD = /^(?:acct|acc|ref|inv|ord|order|tel|tlf|mob|reg|art|doc|bill|po|sr|sl|ser|cust|emp|item|vat|tax|chq|pol|roll|seat|flat|rm|unit|case|tkt|s|id)\./i;
/**
 * Italian forms of address and German academic titles that end like addresses: "Gent.mo" (gentilissimo), "Ill.ma",
 * "Avv.to" (avvocato), "Sig.na" (signorina), "Dr.med.vet", "Prof.Dr.phil". Only the real ones: "sig.me" is an address.
 */
const TITLE = /^(?:(?:gent|preg|ill|egr)\.m[oae]|avv\.to|sig\.na|(?:(?:prof|dr|dipl|univ)\.)+(?:med|vet|ing|dent|phil|rer|nat|jur|oec|habil)(?:\.(?:med|vet|dent|nat|pol))?)$/i;
/** Fields of a record whose names are also endings, as a template writes them: "{{ customer.email }}", "{!Contact.Name}". */
const FIELDS = new Set("email name id phone date data info link page company team group city country photo photos video events tax style design money credit work jobs run show".split(" "));
/** An initial or a title and a surname: "M.Weber", "Y.Li", "Dr.Kim". */
const INITIAL_AND_SURNAME = /^(?:\p{Lu}|Dr|Mr|Ms|Mx|St|Sr|Jr|Fr|Pr)\.\p{Lu}\p{Ll}+$/u;
/** Endings people type every day, so that "X.Com", "T.Me" and "Id.Me" are never taken for a surname. */
const WELL_KNOWN_ENDINGS = new Set("com net org edu gov io co me ai app dev ly gg to tv xyz top info biz link site online shop store club live ru cn uk de us in so sh fm am be it la cc ws vc gl tk ml ga cf gq pw su".split(" "));

function hasAddress(folded: string): boolean {
  if (SCHEME.test(folded) || WWW.test(folded) || hasSpacedAddress(folded) || SPELLED.test(folded) || hasIpAddress(folded)) return true;
  const bare = folded.replace(LEADING_MARK, "$1");
  // Once as written, so an address in Cyrillic or Chinese is seen, and once with look-alike letters read as Latin.
  for (const text of new Set([bare, latin(bare)])) {
    for (const found of text.matchAll(DOTTED)) {
      const ending = found[2] ?? "";
      if (!isEnding(ending)) continue;
      const at = found.index ?? 0;
      const end = at + found[0].length;
      const names = (found[1] ?? "").split(".").filter(Boolean);
      const last = names.at(-1) ?? "";
      const before = text.slice(Math.max(0, at - 12), at);
      const after = text.slice(end, end + 12);
      const label = NUMBER_LABEL.test(found[0]);
      const labelWord = label && LABEL_WORD.test(found[0]);
      // A number after a label is not a path: "Ref.No:4567", "Ord.No/A12". Nor is a second label, "S.No/Name", so
      // "at Ref.No/Login" gets through: asking for a digit there drops column names like "Acct.No/IBAN".
      if (labelWord && /^(?::\s*\d|\/\p{Lu})/u.test(after)) continue;
      // A path after it settles it: "t.co/x8Zk".
      if (/^[/:][\p{L}\p{N}]/u.test(after)) return true;
      // A label for a number, "Acct.No" or "Kd.Nr", and a title, "Dr.med", are not somewhere to go.
      if (labelWord || (label && /r$/i.test(found[0])) || TITLE.test(found[0])) continue;
      // A field in a template is not somewhere to go: "{!Contact.Name}", and in double braces with a filter after it,
      // "{{ customer.email | downcase }}". A name with a hyphen in it is never a field: "{{ acme-billing.com }}".
      const closing = /\{\{\s*$/.test(before) ? /^\s*(?:\|[^{}]{0,40})?\}\}/ : /\{!?\s*$/.test(before) ? /^\s*\}/ : undefined;
      if (FIELDS.has(ending.toLowerCase()) && !found[0].includes("-") && closing?.test(text.slice(end, end + 48))) continue;
      // "m.in" and "Sr.No" end like addresses and are abbreviations. A real name is three letters or more.
      if (names.some(isName) && (isName(last) || (names.length > 1 && [...last].length >= 2))) return true;
      // A person is not an address, "Assign the review to M.Weber.", unless the sentence sends the reader there: "at K.Bank".
      if (INITIAL_AND_SURNAME.test(found[0]) && !WELL_KNOWN_ENDINGS.has(ending.toLowerCase()) && !SENT_THERE.test(before)) continue;
      // A shorter one, "x.com" or "t.me", is an address when the sentence sends the reader to it.
      if (!SHORT_FORMS.has(found[0].toLowerCase()) && /(?:^|[^\p{L}])(?:at|to|visit|via|on|open)\s+$/iu.test(before)) return true;
    }
  }
  return false;
}

// Email addresses and handles ----------------------------------------------

/**
 * A name, an at-sign and a name, with nothing between. A payment handle like "name@bank" is caught as well.
 * Not a version, which is only digits and dots to its end ("react@18.3.1"), the scale of an image ("logo@2x.png"),
 * or the "@s" that makes a Spanish or Portuguese word mean both genders ("tod@s los usuari@s"). An address whose
 * name starts with digits is still one: "billing@365.cash".
 */
const EMAIL = /[\p{L}\p{N}._%+-]@(?!\d[\d.]*(?![\p{L}\p{N}@.])|\d+x\b|s(?![\p{L}\p{N}.@-]))[\p{L}\p{N}]/u;
const MESSAGING = /\b(?:telegram|whatsapp|signal|wechat|viber|discord|skype|instagram|snapchat|tiktok)\b/i;
/** A name on one of those: "@acme_refunds", or a word, a dot and two digits, as one of them writes its names. */
const HANDLE = /(?:^|\s)@[\p{L}\p{N}_]{3,}|(?:^|\s)\p{L}[\p{L}\p{N}_]{2,}\.\d{2}(?![\p{L}\p{N}])/u;

// Somewhere to send money -----------------------------------------------------

/** A bank account in the international form: two letters, two digits, then groups of four, in either case and with a space, a dot or a hyphen between. */
const IBAN = /(?<![\p{L}\p{N}])[A-Za-z]{2}\d{2}(?:[ .-]?[A-Za-z0-9]{4}){3,7}(?:[ .-]?[A-Za-z0-9]{1,3})?(?![\p{L}\p{N}])/gu;
/**
 * Whether it passes the check every real one passes (ISO 7064, mod 97), so that a parcel or an order id of the same
 * shape, "LP00512345678901", is left alone. The first four characters go to the end and each letter counts as two digits, A as 10.
 */
function isIban(found: string): boolean {
  const plain = found.replace(/[ .-]/g, "").toUpperCase();
  let rest = 0;
  for (const char of plain.slice(4) + plain.slice(0, 4)) {
    const value = parseInt(char, 36);
    rest = ((value < 10 ? rest * 10 : rest * 100) + value) % 97;
  }
  return rest === 1;
}
/** A wallet for a cryptocurrency, in the three commonest shapes. */
const WALLET = /(?<![\p{L}\p{N}])(?:bc1[a-z0-9]{20,70}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40})(?![\p{L}\p{N}])/gu;
/** A hash in lower-case hex can start with 1 or 3 and be as long as the second shape. A real address of that shape has capitals or letters past f. */
const isWallet = (found: string): boolean => !/^[13][0-9a-f]+$/.test(found);
/** A name on a payment app: "$AcmeRefunds on Cash App". "Wise" after a hyphen ends a word like "column-wise". */
const PAY_APPS = /\b(?:cash ?app|venmo|paypal|zelle|revolut|(?<!-)wise)\b/i;
const PAY_NAME = /(?:^|\s)[$@][\p{L}][\p{L}\p{N}_-]{2,}/u;
const hasPayment = (text: string): boolean =>
  [...text.matchAll(IBAN)].some((found) => isIban(found[0])) || [...text.matchAll(WALLET)].some((found) => isWallet(found[0])) || (PAY_APPS.test(text) && PAY_NAME.test(text));

// Phone numbers -------------------------------------------------------------

/** Words that tell someone to ring or text, in the languages a model is most likely to be steered into. */
const CALL_WORDS =
  "call(?:s|ing|ed)?|dial(?:s|ing)?|ring|phone|telephone|tel|fax|sms|hotline|helpline|whatsapp|telegram|viber|llam[ae]\\w*|appel\\w*|t[ée]l[ée]phon\\w*|anruf\\w*|rufen|telefon\\w*|ligue|ligar|chiam\\w*|bellen|bel|zadzwo\\w*|позвон\\w*|звон\\w*";
/** The same in Chinese, simplified and traditional, Japanese and Korean, which need no space around them. */
const JOINED_CALL_WORDS = "電話|电话|拨打|致电|撥打|致電|전화";
const CALL = new RegExp(`\\b(?:${CALL_WORDS})\\b|${JOINED_CALL_WORDS}`, "iu");
/**
 * The same words as the last thing before a number: "call us on", "Tel:".
 * And "text" where it is something to do and not something to type: at the
 * start, or after "to", "and", "or", "please", "then" or "just".
 */
const CALL_JUST_BEFORE = new RegExp(
  `(?:\\b(?:${CALL_WORDS})\\b|(?:^|[.!?;,:]\\s*|\\b(?:to|and|or|please|then|just)\\s+)text\\b|${JOINED_CALL_WORDS})[.:]?[^.!?;,\\d]{0,30}$`,
  "iu",
);
/**
 * Those words where they mean something else: "tel que" (such as), "API calls", "llamado 12345" (named), "appel
 * d'offres" (a tender), "Rufen Sie die Rechnung auf" (open the invoice). They are blanked before numbers are looked for.
 * The "auf" has to belong to that "rufen Sie" and not to a later one, so "Rufen Sie 87070 an und rufen Sie danach Ihre
 * Rechnung auf" is still a number. "Escriba al servicio llamado 87070" gets through as a name.
 */
const OTHER_SENSES = /\b(?:tel(?:le)?s?\s+que|(?:api|webhook|function|method|rpc|sdk|ajax|http|tool)\s+call(?:s|ing|ed)?|llamad[oa]s?(?=\s+\d)|chiamat[oa](?=\s+\d)|appel\s+d['’]offres?|tel\s+(?=de\s+rijen)|rufen\s+sie(?=(?:(?!rufen\b)[^.!?]){0,80}\bauf\b))/giu;
/**
 * Words for getting hold of someone that are too common to count alone: with
 * one, a number has to be written in groups, the way one to dial is. "Number"
 * and "line" are not here: they sit beside every order and invoice. So
 * "Contact the billing desk on 08001234567" gets through: an unbroken number
 * beside "Support", "Contacts" or "agent" is far more often a ticket, a record
 * or an agent's id.
 */
const REACH = /\b(?:contact\w*|reach|speak|talk|support|desk|agent|helpdesk)\b/iu;
/**
 * A number that starts with a plus sign and a country, however it is spaced. Not straight after a letter, a digit or a
 * bracket, where the plus sign joins two things.
 */
const INTERNATIONAL = /(?<![\p{L}\p{N})\]])\+\s?\d(?:[\s().\-/]*\d){6,}/gu;
/**
 * A lone decimal of up to eight places, "+40.712776" (a latitude), and an amount with its currency after it,
 * "+1.250.000 €", are not numbers to dial. "+44.2079460958" has too many places to be a decimal.
 */
function hasInternational(text: string): boolean {
  for (const found of text.matchAll(INTERNATIONAL)) {
    const end = (found.index ?? 0) + found[0].length;
    if (/^\+\d{1,3}\.\d{1,8}$/.test(found[0]) || /^\s?(?:[€£$%]|(?:eur|usd|gbp|chf)\b)/i.test(text.slice(end, end + 8))) continue;
    return true;
  }
  return false;
}
/** Three digits, three and four, the way a North American number is written. */
const THREE_THREE_FOUR = /(?<![\d-])\(?\d{3}\)?[\s.\-/]{1,2}\d{3}[\s.-]\d{4}(?![\d-])/;
/** "Text PAY to 70070": four to six digits after "to", not far after a word that says to text or send. */
const SHORT_CODE = /\b(?:text|sms|send)\b[^.!?]{0,40}\bto\s+\d{4,6}$/i;
/** "Send up to 2000 messages", "from 2024 to 2026": "to" before a number that is an amount or the end of a range. */
const UP_TO = /\b(?:up\s+to\s+\d+|from\s+\d{4}\s+to\s+\d{4})$/i;
/** A count after the number makes it an amount and not somewhere to text: "Send the newsletter to 25000 subscribers." */
const COUNTED = /^\s*(?:subscribers?|contacts?|recipients?|people|users?|messages?|characters?|chars?|emails?|members?|customers?|times|rows?|credits?|a\s+(?:day|week|month|year)|per)\b/i;
/** Each "to" and number is read on its own, so that "Send YES to 87070 to get up to 5000 points" is still caught. */
function hasShortCode(text: string): boolean {
  for (const to of text.matchAll(/\bto\s+\d{4,6}\b/gi)) {
    const end = (to.index ?? 0) + to[0].length;
    const lead = text.slice(Math.max(0, end - 80), end);
    if (SHORT_CODE.test(lead) && !UP_TO.test(lead) && !COUNTED.test(text.slice(end, end + 30))) return true;
  }
  return false;
}
/** Beside digits, a month, a currency, a time zone, a unit or a file type in capitals is not a word on a keypad: "NOV 2026", "08:00 CET", "500 MB". */
const NOT_ON_KEYPAD = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC|USD|EUR|GBP|CHF|JPY|CNY|INR|AUD|CAD|SEK|NOK|DKK|PLN|CET|CEST|EET|EST|EDT|CST|CDT|MST|MDT|PST|PDT|UTC|GMT|BST|IST|JST|AEST|MMS|SMS|MIN|MINS|SEC|HRS|KB|MB|GB|TB|PDF|CSV";
/** A number with a word in it, as dialled from a keypad: "1-800-FLOWERS", and "1-888-SMS-BANK" with a second word after one of those. */
const WORD_NUMBER = new RegExp(`\\d[-\\s](?:[A-Z]{3,}[-\\s])?(?!(?:${NOT_ON_KEYPAD})\\b)[A-Z]{3,}\\b|\\b(?!(?:${NOT_ON_KEYPAD})\\b)[A-Z]{3,}[-\\s]?\\d`);
/** A day of the month and a month, as a date writes them. */
const DAY = String.raw`(?:0?[1-9]|[12]\d|3[01])`;
const MONTH = String.raw`(?:0?[1-9]|1[0-2])`;
/**
 * Digits that are never a number to dial, however a sentence about calls or
 * phone plans puts them: a date (with the year first or last), a time, a
 * span of hours written with dots ("08.30-17.00"), a price, a percentage, and
 * an amount with commas between its thousands. They are taken out before
 * runs are looked for. A date has to stand alone, so "01.23.45.67.89" is not
 * read as one with something after it, and it needs a day and a month, either
 * way round, so "Call 12.34.5678" and "Call 13.13.2026" are still numbers.
 * "Ring 20.15-23.45" gets through as a span of hours: no country writes a
 * number to dial that way. So does "Call 0045 20.15-23.45", where the span
 * comes after a group of digits: a date before hours, "15.11.2026 08.00-12.00",
 * looks the same.
 */
const NOT_DIALLED = new RegExp(
  [
    String.raw`(?<![\d./-])\d{4}-\d{1,2}-\d{1,2}(?![./-]?\d)`,
    String.raw`(?<![\d./-])(?:19|20)\d{2}([./])${MONTH}\1${DAY}(?![./-]?\d)`,
    String.raw`(?<![\d.,])(?:[01]?\d|2[0-4])\.[0-5]\d\s?-\s?(?:[01]?\d|2[0-4])\.[0-5]\d(?![.,]?\d)`,
    String.raw`(?<![\d./-])(?:${DAY}[/.-]${MONTH}|${MONTH}[/.-]${DAY})[/.-](?:\d{4}|\d{2})(?![./-]?\d)`,
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
 * sentence into the next. A letter against it makes it part of a word, "A1234",
 * except a letter of the joined scripts: "請撥打0800123456確認".
 */
const RUN = new RegExp(String.raw`(?<![^\P{L}${JOINED_SCRIPTS}]|[\p{N}.,])\(?\d+\)?(?:(?:[ ./]| ?- ?| ?\(|\) ?)\(?\d+\)?)*(?![^\P{L}${JOINED_SCRIPTS}]|\d)`, "gu");
/** An amount with its thousands set apart by spaces or by dots: "1 000 000", "1.000.000". */
const THOUSANDS = /^\d{1,3}([ .])\d{3}(?:\1\d{3})*$/;
/**
 * The same, but the gaps may be wider or hold a dot, a comma, a colon or a bar: "415. 555. 0132", "0800, 123, 4567".
 * Only looked for once a word has said to ring.
 */
const LOOSE_RUN = /(?<![\p{L}\p{N}])\d+(?:[\s.\-/(),:;|]{1,3}\d+)+(?![\p{L}\d])/gu;
/** A placeholder that shows how to write a number, "000.000.000-00", is one digit over and over. */
const oneDigit = (digits: string): boolean => /^(\d)\1+$/.test(digits);
/**
 * A unit or a count straight after a number makes it an amount, whatever word came before: "ring timeout to 25000 ms",
 * "a limit of 10000 per hour", "10000 SMS al mes". It has to be the whole word, so "Llame al 87070 hoy" is still a
 * number, and "each" is not one: "Dial 87070 each time you pay".
 */
const UNIT_AFTER =
  /^\s*(?:ms|s|secs?|seconds?|mins?|minutes?|hours?|hrs?|h|days?|weeks?|months?|years?|rows?|records?|items?|messages?|mensajes|nachrichten|characters?|caracteres|zeichen|chars?|tokens?|calls?|llamadas|anrufe|requests?|events?|subscribers?|contacts?|contactos|users?|usuarios|people|recipients?|credits?|units?|per\s+(?:hour|day|week|month|year|minute|second|request|user|file|call|page)|a\s+(?:day|week|month|year)|kb|mb|gb|tb|bytes?|sms|mms|%|x|times|minutos|segundos|horas|minuten|sekunden|stunden|minuti|secondi|ore|secondes?|heures?)(?![\p{L}\p{N}])/iu;

function hasPhone(folded: string): boolean {
  const said = folded.replace(OTHER_SENSES, " ~ ");
  if (hasInternational(said) || THREE_THREE_FOUR.test(said) || hasShortCode(said)) return true;
  const called = CALL.test(said);
  const asked = called || REACH.test(said);
  // A dot in the middle of the line between digits is one more way to write the gap.
  const text = said.replace(/(?<=\d)\s*[·•∙‧]\s*(?=\d)/g, "-").replace(NOT_DIALLED, " ¤ ");
  if (called && text.replace(/\D/g, "").length >= 3 && WORD_NUMBER.test(text)) return true;
  if (THREE_THREE_FOUR.test(text)) return true;
  if (called) {
    for (const run of text.matchAll(LOOSE_RUN)) {
      // A list, "1200, 3400, 5600", is not a number to dial. One that starts with 0 is: "0800, 123, 4567".
      if (/[,:;|]/.test(run[0]) && !run[0].startsWith("0")) continue;
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
    // Not when the last group is one digit: that is the check digit of an ISBN or a product code, "0-306-40615-2".
    // So "the billing line is 0800 123 456 7" gets through.
    if (grouped && /^\(?0/.test(run[0]) && digits >= 9 && groups.at(-1)?.length !== 1) return true;
    // The same unbroken, in a sentence that says to ring: "Call us, the number is 02079460958."
    if (called && groups.length === 1 && /^0\d{9,10}$/.test(groups[0] ?? "")) return true;
    // Four or five pairs, as numbers are written in France and Norway.
    if (groups.length >= 4 && groups.every((group) => group.length === 2)) return true;
    // Seven digits or more in groups, in a sentence about ringing someone or getting hold of them.
    if (grouped && digits >= 7 && asked) return true;
    // Three threes read as an amount, and also as a mobile number in Spain, which starts with 6 to 9: "612 345 678". In such a sentence it is the number.
    // Portugal and Poland start some of theirs with 2 or 5, so "on 512.345.678" gets through: beside "Support" or
    // "contacts", nine digits that start with 1 or 2 are usually an amount ("100 000 000 events a month").
    if (asked && digits === 9 && THOUSANDS.test(run[0]) && /^[6-9]/.test(run[0])) return true;
    // Any number straight after a word that says to ring it, "call 87070", "Tel: 02079460958", unless a unit after it makes it an amount.
    const end = (run.index ?? 0) + run[0].length;
    if (CALL_JUST_BEFORE.test(text.slice(Math.max(0, (run.index ?? 0) - 60), run.index ?? 0)) && !UNIT_AFTER.test(text.slice(end, end + 40))) return true;
  }
  return false;
}

// Secrets -------------------------------------------------------------------

const SECRETS = "password|passcode|passphrase|pin|login|log-in|credentials|verification code|security code|one-time code|code|card number|card details|cvv|cvc|api key|secret key|recovery (?:code|phrase)|seed phrase";
/**
 * Words for passing something on. Not after "your", "the", "a" and the like, where "email", "text" and "message" are a
 * thing and not something to do: "Check your email for your login code."
 */
const PASS_ON = String.raw`(?<!\b(?:your|my|our|their|the|an?|this|that|each|every|new|text|via|by)\s+)\b(?:send|e-?mail|mail|share|tell|give|text|message|forward|post|dm|read out|reply|provide)\b`;
/** Codes that are meant to be passed on, or are not secret: "your referral code", "your ZIP code". */
const NOT_SECRET = "referral|promo|promotional|promotion|discount|coupon|voucher|gift|invite|invitation|zip|postal|post|area|country|tax|class|course|tracking|qr|bar|source|error|product|booking|reference|colou?r|dress|language|region|airport|station|currency";
/**
 * Words after the secret that make it the subject and not the thing handed over: "Tell your users the password policy.",
 * "Share your code of conduct". Not "of" before a number: "Send us your card number of 16 digits."
 */
const ABOUT_IT = String.raw`of(?!\s+\d)|policy|policies|rules?|requirements?|settings?|strength|manager|expiry|expiration|length|field|box|page|history|hint`;
/**
 * A sentence that tells the visitor to hand a secret to someone: "email your
 * password to the admin", "tell us your code", "send your 6-digit code". It
 * needs a word for passing something on, then "your", then the secret, so a
 * button called "Send code" and a step like "Type your password" are not
 * touched.
 */
const HAND_OVER = new RegExp(
  String.raw`${PASS_ON}[^.!?]{0,40}\b(?:your|their)\s+(?:[\w-]+\s+){0,2}(?<!\b(?:${NOT_SECRET})\s+)(?:${SECRETS})\b(?!\s+(?:${ABOUT_IT})\b)`,
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
 * never an abbreviation ("out", "it", "tab"), or a button's name ("OK",
 * "Yes", "New"); and when a capital follows. A digit does not start a
 * sentence. So "No. 12", "e.g. this", "f.eks. Pro" and "approx. 08.00" stay
 * in one piece. Dropping half of one of those would leave "Click No." A wrong
 * guess the other way only means two sentences are kept or dropped together.
 *
 * Scripts with no capitals (Hindi, Arabic, Hebrew, Korean) start a sentence
 * with a letter of their own kind, and end one with a full stop after any of
 * their letters, short words and words that end in a vowel sign included.
 * Hindi and Urdu also end one with their own mark.
 */
const SHORT_LAST_WORDS = "out|it|on|up|off|now|you|one|too|so|do|go|is|tab|box|bar|all|row|top|end|day|yes|way|new|key|log|map|tag|use|run|did|not|yet|ok";
/** Not "No", "Do" or "So", which start "No. 12" and the like. */
const BUTTON_NAMES = "OK|Ok|Yes|New|Go|Run|Off|Now|All|Top|End|Log|Tab|Box|Bar|Row|Key|Map|Tag|Use|Add|Out|One|Sí|Oui|Ja";
const SENTENCE_END = new RegExp(
  String.raw`(?<=[\p{L}\p{N}]{4}[)"'”’\]]*[.!?]|(?<![\p{L}\p{N}.])(?:${SHORT_LAST_WORDS}|${BUTTON_NAMES})[)"'”’\]]*\.|\p{Lo}\p{M}*\.|[!?。！？।॥؟۔])\s+(?=["'“‘(\[]?[\p{Lu}\p{Lo}])|(?<=[^A-Za-z0-9\s][。！？।॥])(?=\S)`,
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

/**
 * The most a visitor is shown. Of 1,555 live sentences, every one that was fine had at most four sentences and 258
 * characters. The length is the check's own (`checkSay`), so what has been tidied to it is never cut again there.
 */
export const SAY_MAX_SENTENCES = 4;
export const SAY_MAX_CHARS = MAX_STEP_SAY;

// The sentence is one string in the reply's JSON, and it is read only when the
// whole reply has arrived. So nothing wrong with it comes from cutting a reply
// that is still streaming: the model wrote it. About one live sentence in
// thirty has something that is not for the visitor, nearly always after its
// last full stop: a line-break tag, the reply's own closing quote mark and
// brace written with the wrong characters, a character with no width, a stray
// word. The tests hold every kind that was seen, as it was written.
//
// Why the reply's own closing can be in the sentence at all: the reply's shape
// is held by the provider's grammar, and the sentence is its last string. The
// grammar ends that string only at a plain quote mark. A model that closes the
// reply its own way first, with a brace, a bracket or the end of a code fence,
// has written those inside the string, and everything it writes until the
// quote mark comes is in the string too. Seen in visitors' sessions on 17
// November 2026: "…to start a new card for Malika.} ```", "…for Malika.[",
// and once a run of it long enough that the length limit then cut the sentence
// itself, which was shown as "Selecting For someone else so the card goes to…".

/** What ends a sentence. */
const STOP = ".!?…。！？";
/** A stop, then any quote marks or brackets that close with it, and nothing more. */
const PROPER_END = new RegExp(`[${STOP}]["'”’»«)\\]]*$`);
/**
 * Tags that break a line. The sentence is shown as plain text, so a tag would
 * be read out as one. Only the line-break tag has been seen. A name in angle
 * brackets that is not one of these, like a key, is left alone.
 */
const BREAK_TAG = /<\/?(?:br|p|div)\s*\/?>/gi;
/** Tags that only dress the words between them. */
const DRESS_TAG = /<\/?(?:b|i|em|strong|u|code|span)\s*\/?>/gi;
/**
 * A tag named after a field of the reply itself ("enter" is left out: "<Enter>" is a key). Seen on Northpine's staging
 * on 16 November, shown to the visitor: "…then open it to add the receipt.</say>".
 */
const FIELD_TAG = /<\/?(?:say|target|status|reply)\s*\/?>/gi;
/** Characters that take no room and mean nothing here. */
const NO_WIDTH = /[\u200B\u2060\uFEFF]/g;
/** The two joiners are part of how some languages are written, but only between letters, never beside a space or at an end. */
const LOOSE_JOINER = /(?<=^|[\s.!?,;:])[\u200C\u200D]+|[\u200C\u200D]+(?=$|[\s.!?,;:])/g;
/** A check mark or a picture where a sentence would start, with the marks that can trail a picture. Inside a sentence it may be part of a control's name. */
const SIGN_AFTER_STOP = /(?<=[.!?…])\s*(?:[\p{So}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]+\s*)+/gu;
/** "its menu.Step 1": a full stop with a new sentence right behind it. */
const NO_SPACE_AFTER_STOP = /(\p{Ll}[.!?])(?=\p{Lu}\p{Ll})/gu;
/**
 * What can be left stuck to the last full stop: quote marks and stops and then
 * one word of code ("start.”.replace"), or one bare word ("list.markdown").
 * A bare word has to be five letters or more, which spares the end of a file
 * name or a web address when a sentence stops on one with no full stop.
 */
const SCRAP = /^(?:["'”’»«)\]}.]+[A-Za-z_$][\w$]*(?:\(\))?|[A-Za-z]{5,})$/;
const OPENS: Record<string, string> = { "}": "{", "]": "[", ")": "(" };

const count = (text: string, chars: string) => [...text].filter((char) => chars.includes(char)).length;

/**
 * Where the reply's own ending may start inside the sentence: straight after a sentence's stop and the marks that
 * close with it, a brace or a square bracket that closes, a code fence, or a brace or square bracket that opens
 * with nothing but more of the same after it or with the start of another reply ('{"target"').
 */
const REPLY_END = /(?<=[.!?…。！？]["'“”‘’»«)\]]*\s*)(?:[}\]]|`{3,}|[[{](?=["'“”‘’»«`[\]{}\s]*$|\s*["[{]))/gu;

/**
 * The sentence up to where the model ended the reply itself: everything from there on is the reply's closing and
 * what was written after it, never words for the visitor. A brace or a bracket that closes one opened earlier in
 * the sentence is part of it and stays: "Use {first. Last} as the format."
 */
export function withoutReplyEnd(say: string): string {
  for (const found of say.matchAll(REPLY_END)) {
    const before = say.slice(0, found.index);
    const opener = OPENS[found[0]];
    if (opener && count(before, opener) > count(before, found[0])) continue;
    return before.trimEnd();
  }
  return say;
}

/**
 * Marks that end nothing once the last sentence has stopped: an opening bracket, what is left of a tag, a slash or
 * a bar. A code mark is one too when it has no partner or stands doubled, as what is left of a code fence does.
 * The marks that dress words (asterisks, underscores) are not: they come in pairs, and the check takes those off.
 */
const STRAY_MARKS = "[{(<|\\/^#=+";
/** The last sentence's stop and the marks that close with it, then only marks, with a stray one among them: "saved." ```", "saved.[". */
const STRAY_TAIL = new RegExp(`^(.*[${STOP}])([^\\p{L}\\p{N}${STOP}]*)$`, "su");

/** Takes off what follows the last sentence and is not part of it. */
function withoutLeftovers(text: string): string {
  for (;;) {
    const before = (text = text.trimEnd());
    // After the last stop come only marks, and one of them ends nothing: they go from the first such mark on.
    const tail = STRAY_TAIL.exec(text);
    const marks = [...(tail?.[2] ?? "")];
    const loneTick = count(text, "`") % 2 === 1;
    const stray = marks.findIndex((mark, at) => STRAY_MARKS.includes(mark) || (mark === "`" && (loneTick || marks[at + 1] === "`")));
    if (tail && stray >= 0) text = (tail[1]! + marks.slice(0, stray).join("")).trimEnd();
    const last = text.at(-1) ?? "";
    const rest = text.slice(0, -1);
    // A bracket that closes nothing: most often the brace that ends the reply itself.
    if (OPENS[last] && count(text, last) > count(text, OPENS[last])) text = rest;
    // A quote mark with no partner. French and German marks are counted with their own kind.
    else if ('"“”'.includes(last) && count(text, '"“”„') % 2) text = rest;
    else if ("«»".includes(last) && count(text, "«»") % 2) text = rest;
    // A single one counts only after a stop, and only when no word in the sentence opens with one: "we'll" does not.
    else if ("'’".includes(last) && STOP.includes(rest.at(-1) ?? " ") && !/(?:^|[\s(])['‘’]\S/.test(rest)) text = rest;
    // A comma, colon or semicolon after the last stop and any marks that close with it ends nothing: it is the reply's own JSON, written as text.
    else if (",;:".includes(last) && PROPER_END.test(rest)) text = rest;
    // An ellipsis straight after a stop says the sentence went on when it had ended.
    else if (last === "…" && rest.at(-1) !== "…" && PROPER_END.test(rest)) text = rest;
    else if (!PROPER_END.test(text)) {
      // The last run of characters holds a full stop with more stuck to it.
      const word = /\S+$/.exec(text)?.[0] ?? "";
      const stuck = /^.*?\p{L}[.!?](?=\D)/su.exec(word)?.[0];
      if (stuck && word.length - stuck.length > 1 && SCRAP.test(word.slice(stuck.length))) text = text.slice(0, text.length - word.length + stuck.length);
      // A digit or two stuck to the last full stop, like a footnote mark: "in the Email address field.2" (seen on staging,
      // 16 November 2026). A number of its own, "section 4.2", has no letter before its stop and is left alone.
      else if (/\p{L}[.!?]\d{1,2}$/u.test(word)) text = text.replace(/\d{1,2}$/, "");
    }
    if (text === before) return text;
  }
}

/** Where one sentence ends and the next begins. A lower-case letter after the stop means it was a short form, like "e.g.". */
const BETWEEN_SENTENCES = /[.!?…]["'”’»)\]]*(?=\s+[^\s\p{Ll}])|[。！？।॥؟۔]["”’」』）]*(?=.)/gsu;
/** A space in a script written with no spaces between words (Thai, Lao, Khmer, Burmese), where a space ends a phrase or a sentence. */
const PHRASE_SPACE = /(?<=[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}])\s+(?=[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}])/gu;

/**
 * Keeps to the limits above, cutting after a whole sentence wherever one ends in time. A sentence is never shown cut
 * off part-way: one that is longer than the limit by itself is not shown at all, and the caller's own sentence
 * stands in for it. (In the scripts above, the last phrase that fits ends it.)
 */
function capped(text: string, maxChars: number): string {
  let sentences = 0;
  let cut = 0;
  for (const end of text.matchAll(BETWEEN_SENTENCES)) {
    const at = end.index + end[0].length;
    if (at > maxChars) break;
    cut = at;
    if (++sentences === SAY_MAX_SENTENCES) return text.slice(0, cut);
  }
  if (text.length <= maxChars) return text;
  if (cut) return text.slice(0, cut);
  let phrase = 0;
  for (const space of text.slice(0, maxChars).matchAll(PHRASE_SPACE)) phrase = space.index;
  return text.slice(0, phrase);
}

/**
 * The sentence a visitor reads, tidied. It comes out as plain prose on one
 * line: no tags, no characters without width, no blank lines or double
 * spaces, a space after every full stop, nothing left over after the last
 * sentence, and no longer than a caption can show. A sentence that was fine
 * comes out exactly as it went in, and no sentence comes out cut part-way.
 * An answer in words (answers.ts) is given more room than a step's caption
 * with `maxChars`.
 */
export function tidySay(say: string, maxChars = SAY_MAX_CHARS): string {
  const prose = say
    .replace(BREAK_TAG, " ")
    .replace(DRESS_TAG, "")
    .replace(FIELD_TAG, "")
    .replace(NO_WIDTH, "")
    .replace(LOOSE_JOINER, "")
    .replace(SIGN_AFTER_STOP, " ")
    .replace(/\s*[\n\r]\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(NO_SPACE_AFTER_STOP, "$1 ")
    .trim();
  const shown = capped(withoutLeftovers(withoutReplyEnd(prose)), maxChars);
  // Marks with no word or number among them are nothing to read: a code fence, a brace.
  return /[\p{L}\p{N}]/u.test(shown) ? shown : "";
}

/** What a visitor reads when every sentence of a step had to be dropped. The pointer, if there is one, still says where to go. */
/**
 * The widget's own words for a visitor who used another control, or went to another page, in place of the step they
 * were shown: 'The user clicked "Team" instead of link "Billing".', 'The user went to /team without using link "Billing".'
 */
const USED_SOMETHING_ELSE = /\binstead of\b|\bwent to \S+ without using\b/;

/**
 * A step's sentence without the opening "Not that one.", unless the visitor did use something other than the step
 * they were shown, which `event`, what the widget heard them do, says in the words above.
 *
 * That opening is for a wrong click or a wrong turn, as the instructions have it. Written to a visitor who used the
 * very control pointed at, it blames them for the model's own wrong pointer. On Northpine's Bills the model pointed at
 * the Vendor column's button, the visitor clicked it, and the next step read "Not that one. Click the Vendor filter
 * dropdown above the table…". In the measurement of 16 November it was said 3 times in 596 steps, and all 3
 * were to a visitor who had done the step shown. It is as wrong for one who closed a dialog without using the control
 * in it: there was no other one. The step that follows the opening is the right one, so only the opening goes.
 */
export function withoutBlame(say: string, event: string | undefined): string {
  if (USED_SOMETHING_ELSE.test(event ?? "")) return say;
  const rest = say.replace(/^\s*not that one\s*[.!,:;]?\s*/i, "");
  if (!rest || rest === say) return say;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export const SAY_WITHOUT_WORDS = {
  pointing: "This is the one to use.",
  nothing: "I can't help with that one.",
} as const;

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
    // Dropping a sentence can bring the two halves of an address together, and some things are only seen whole: a word
    // in one sentence that says to ring the number in the next ("Contact our billing desk. The number is 0800 1234.").
    // What is left is read once more, and if it still breaks a rule nothing is shown.
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
