import { MODES, REASONS, type Mode, type Reason, type SiteContext, type Source, type TurnReply, type TurnRequest } from "../shared/types.ts";
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
//   the visitor's own account are never answered in words, whatever the docs say.
// - An answer is held to the same rules as any sentence (rules.ts), with more room.

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
}

/** The fixed sentence for each reason. `site` is the product's name. */
export function cannotHelpSay(reason: Reason, site: SiteContext): string {
  if (reason === "sensitive") return "I can't answer that one. It needs someone from the team.";
  if (reason === "off_topic") return `I can only help with ${site.name || "this site"}.`;
  return "The help docs don't cover that.";
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
export type Overruled = "no_source" | "no_words" | "never_decided" | "declined";

export interface Finished {
  reply: TurnReply;
  /** The articles the answer rests on, by where each came from. For the log. */
  cited: string[];
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
    return {
      // With nothing to act on there is nothing to wait for.
      reply: { target, status: target ? raw.status : "done", say, mode, sources: cited.map((article) => asSource(article, site, now)) },
      cited: cited.map((article) => article.doc.source),
      broke,
    };
  }

  const { say, broke } = checkSay(tidySay(raw.say));
  return { reply: { target, status: raw.status, say: say || (target ? SAY_WITHOUT_WORDS.pointing : SAY_WITHOUT_WORDS.nothing), mode }, cited: [], broke };
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
