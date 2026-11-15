import { MODES, REASONS, type Mode, type Reason, type SiteContext, type Snapshot, type Source, type TurnReply, type TurnRequest } from "../shared/types.ts";
import { articlesOf, type Article } from "./prompt.ts";
import { checkSay, SAY_WITHOUT_WORDS, tidySay, type Rule } from "./rules.ts";

// What the server does with a reply on a site that has Answers on, after the
// model has written it. An answer is a statement made in the customer's name,
// which is a different risk from saying where a button is: in every case the
// research found where a company paid for what its chatbot said, the bot had
// stated something as fact. So what matters most is decided here, in code the
// model cannot be talked past, and not by the prompt:
//
// - When Haptic can't help, the visitor reads a fixed sentence. The model only
//   picks which one.
// - An answer has to rest on at least one of this site's help articles, named
//   by id. The visitor is shown those articles. With none, it is not an answer.
// - Prices, refunds, legal and medical matters, deadlines and anything about
//   the visitor's own account are never answered in words, whatever the docs
//   say. A step's sentence may not state a price or a refund rule either.
// - An answer is held to the same rules as any sentence (rules.ts), with more room.
// - A control the answer names is looked for on the page the visitor is on.
//   Help docs go out of date, and an answer built on an article that names a
//   button the product no longer has would send the visitor looking for it. A
//   bot that only reads docs cannot know. Haptic has the page.

/** An answer is one to four short sentences. This is room for that. */
export const MAX_ANSWER_SAY = 600;
/** The most articles shown under one answer. */
const MAX_SOURCES = 3;

/** A reply as the model wrote it. On a site without Answers only the first three fields are there. */
export interface ModelReply {
  target: string | null;
  status: TurnReply["status"];
  say: string;
  mode?: Mode;
  reason?: Reason | null;
  /** Ids of help articles, like "a2". */
  sources?: string[];
  /** The labels of the controls an answer tells the visitor to use. */
  controls?: string[];
}

/**
 * The fixed sentence for each reason. "Not covered" does not say the product
 * can't do the thing: Haptic only knows it could not find it.
 */
export function cannotHelpSay(reason: Reason, site: SiteContext): string {
  const name = site.name || "this site";
  if (reason === "sensitive") return `That needs an answer from a person at ${name}.`;
  if (reason === "off_topic") return `I can only help with using ${name}.`;
  return `I couldn't find that on ${name} or in its help docs.`;
}

// The topics the model never decides. Matching is by plain words, so it can be
// read and argued with. It errs toward handing off: a wrong match sends a
// question to a person, and a missed one lets the model speak for the company.
// Only answers in words are held to it. Pointing at the page where a visitor
// can see their own plan or invoice is how Haptic helps with these.
const NEVER_ASKED =
  /\b(?:refunds?|refunded|money back|chargebacks?|compensat\w*|disput\w*|overcharged?|charged twice|double charged?|lawsuits?|sue|suing|lawyers?|attorneys?|legal(?:ly)?|liab\w*|medical|diagnos\w*|prescri\w*|pric(?:e|es|ed|ing)|costs?|how much|discounts?|coupons?|promo codes?|deadlines?|due dates?|overdue|late fees?)\b|\bmy (?:own )?(?:account|invoices?|bills?|billing|card|payments?|subscription|trial|orders?|charges?|balance|data|plan)\b/i;
const NEVER_SAID =
  /[$€£¥]\s?\d|\b\d+(?:[.,]\d+)?\s?(?:usd|eur|gbp|dollars?|euros?|pounds?|cents?)\b|\b(?:refund\w*|money back|chargebacks?|guarantee\w*|warrant(?:y|ies)|legal advice|medical advice|lawsuits?|liable|liability)\b/i;

/** True when an answer in words would decide something only a person at the company should. */
export function neverDecided(question: string, answer: string): boolean {
  return NEVER_ASKED.test(question) || NEVER_SAID.test(answer);
}

/**
 * Why the server did not let a reply through as the model wrote it.
 * - no_source: an answer that named none of this site's articles
 * - no_words: an answer with no sentence left after the rules in rules.ts
 * - never_decided: an answer on a topic only a person at the company decides
 * - declined: the model's provider declined the request
 */
/** Why the server changed a reply. "blocked": it pointed at a control the site's owner ruled out (src/shared/corrections.ts). */
export type Overruled = "no_source" | "no_words" | "never_decided" | "declined" | "blocked";

export interface Finished {
  reply: TurnReply;
  /** The articles the answer rests on, by where each came from. For the log. */
  cited: string[];
  /** Labels of controls the answer named that are on none of the pages Haptic knows. With `cited`, this is which articles may be out of date. */
  unseen?: string[];
  overruled?: Overruled;
  broke: Rule[];
}

/**
 * Turns the model's reply into what the visitor gets. `now` is passed in so a
 * test can say what day it is.
 */
export function finishAnswer(site: SiteContext, request: TurnRequest, raw: ModelReply, now = new Date()): Finished {
  const onPage = raw.target !== null && request.snapshot.elements.some((element) => element.id === raw.target);
  const target = onPage ? raw.target : null;
  const mode: Mode = MODES.includes(raw.mode as Mode) ? (raw.mode as Mode) : "guide";

  const cannotHelp = (reason: Reason, overruled?: Overruled): Finished => ({
    // "Stuck", as a guide that finds no way forward is: Haptic did not help, so it is not billed.
    reply: { target: null, status: "stuck", say: cannotHelpSay(reason, site), mode: "cannot_help", reason },
    cited: [],
    broke: [],
    ...(overruled ? { overruled } : {}),
  });

  if (mode === "cannot_help") return cannotHelp(REASONS.includes(raw.reason as Reason) ? (raw.reason as Reason) : "not_covered");

  if (mode === "answer") {
    const { say, broke } = checkSay(tidySay(raw.say), MAX_ANSWER_SAY);
    if (neverDecided(request.goal, say)) return cannotHelp("sensitive", "never_decided");
    const articles = articlesOf(site);
    const cited = [...new Set(raw.sources ?? [])]
      .map((id) => articles.find((article) => article.id === id))
      .filter((article): article is Article => article !== undefined)
      .slice(0, MAX_SOURCES);
    if (!cited.length) return cannotHelp("not_covered", "no_source");
    if (!say) return cannotHelp("not_covered", "no_words");
    const missing = missingControls(site, request.snapshot, raw.controls ?? []);
    return {
      // With nothing to act on there is nothing to wait for.
      reply: { target, status: target ? raw.status : "done", say, mode, sources: cited.map((article) => asSource(article, site, now)), ...(missing.length ? { missing } : {}) },
      cited: cited.map((article) => article.doc.source),
      broke,
      ...(missing.length ? { unseen: missing } : {}),
    };
  }

  // A step says where to click, and leaves the facts to the page. One that states a price or a refund
  // rule on the way has decided the same thing an answer may not, so its words go and its pointer stays.
  const { say, broke } = checkSay(tidySay(raw.say));
  const stated = NEVER_SAID.test(say);
  return {
    reply: { target, status: raw.status, say: (stated ? "" : say) || (target ? SAY_WITHOUT_WORDS.pointing : SAY_WITHOUT_WORDS.nothing), mode },
    cited: [],
    broke,
    ...(stated ? { overruled: "never_decided" as const } : {}),
  };
}

function asSource(article: Article, site: SiteContext, now: Date): Source {
  const { doc } = article;
  const source: Source = { title: doc.title };
  if (doc.url) source.url = doc.url;
  if (doc.updated) {
    source.updated = doc.updated;
    const limit = site.answers?.staleAfterDays;
    if (limit && now.getTime() - Date.parse(doc.updated) > limit * 86_400_000) source.stale = true;
  }
  return source;
}

/** The reply when the model's provider declined the request. On a site with Answers on, the visitor is offered a person. */
export function declinedReply(site: SiteContext, answers: boolean): Finished {
  const reply: TurnReply = { target: null, status: "stuck", say: SAY_WITHOUT_WORDS.nothing };
  if (answers) Object.assign(reply, { mode: "cannot_help", reason: "not_covered" } satisfies Partial<TurnReply>);
  return { reply, cited: [], broke: [], overruled: "declined" };
}

/** The most controls checked for one answer. */
const MAX_CONTROLS = 6;
/** A site map with fewer different controls than this, over all its pages, says nothing about what the product has. */
const MIN_KNOWN_CONTROLS = 5;

/** A label made comparable: lower case, single spaces, and none of the quotes, dots or arrows a sentence wraps a label in. */
const plainLabel = (label: string): string =>
  label
    .toLowerCase()
    .replace(/["'“”‘’`…›»→]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,:;]+|[\s.,:;]+$/g, "");

/**
 * Whether two labels mean the same control. An article says "Save" where the
 * button says "Save changes", so one may hold the other as whole words. A very
 * short label has to match exactly: "A" is not in every label with an "a".
 */
function sameControl(named: string, label: string): boolean {
  if (!named || !label) return false;
  if (named === label) return true;
  const [short, long] = named.length <= label.length ? [named, label] : [label, named];
  return short.length >= 4 && ` ${long} `.includes(` ${short} `);
}

/**
 * The controls an answer names that are on neither the page the visitor is
 * looking at nor any other page Haptic knows.
 *
 * It only speaks when it can know. With a dialog open or the list cut short,
 * the page in hand is not the whole page. And where the crawl found next to
 * nothing, as it does for a product drawn in the browser or behind a login,
 * a control that isn't on this page is most likely just on another one. In
 * both cases nothing is reported.
 */
export function missingControls(site: SiteContext, snapshot: Snapshot, controls: string[]): string[] {
  if (snapshot.dialog !== undefined || snapshot.truncated) return [];
  // Each label once: a menu the crawl found on every page is still only the few controls in it.
  const known = [...new Set(site.pages.flatMap((page) => [...page.buttons, ...page.fields, ...page.links.map((link) => link.label)]).map(plainLabel))].filter(Boolean);
  if (known.length < MIN_KNOWN_CONTROLS) return [];
  const seen = [...snapshot.elements.map((element) => plainLabel(element.label)), ...known];

  const missing: string[] = [];
  for (const raw of [...new Set(controls)].slice(0, MAX_CONTROLS)) {
    const label = String(raw).slice(0, 80).trim();
    const named = plainLabel(label);
    if (named && !seen.some((other) => sameControl(named, other))) missing.push(label);
  }
  return missing;
}
