import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { checkAction } from "../shared/act-rules.ts";
import { BLOCKED_SAY, isBlocked } from "../shared/corrections.ts";
import { ACTING_LIMITS, ACTS, actionsAllowed, MODES, REASONS, type Act, type Mode, type Reason, type SiteContext, type SnapElement, type TurnReply, type TurnRequest } from "../shared/types.ts";
import { actingFor, type NotActing } from "./acting.ts";
import { declinedReply, finishAnswer, neverDecided, type Finished, type ModelReply, type Overruled } from "./answers.ts";
import type { Ceiling } from "./budget.ts";
import { gaveUpNote, judgeNamed, namedButNotDone, namedButNotDoneNote, namedButNotPointed, namedButNotPointedNote, namedForTheGoal, namedForTheGoalNote, pressLeftToVisitor, wantsTheWay, type NamedVerdict } from "./check.ts";
import { costOf } from "./prices.ts";
import { answersOn, articlesOf, buildSystemPrompt, buildUserMessage } from "./prompt.ts";
import { checkSay, SAY_MAX_CHARS, SAY_MAX_SENTENCES, SAY_WITHOUT_WORDS, tidySay, withoutBlame, type Rule } from "./rules.ts";

export { SAY_MAX_CHARS, SAY_MAX_SENTENCES, SAY_WITHOUT_WORDS, tidySay };

// One model call per step. HAPTIC_MODEL picks the model, or "mock" for a
// keyword matcher that needs no API key. The reply is streamed, so the control
// to point at is known before the sentence that goes with it is finished.
//
// A step is a guide's unless the widget asked to act and the site allows it
// (acting.ts). Only then is the model given the act instructions and the act
// reply's shape, its reply checked with the same rules the widget uses, and
// `mode: "act"` put on it: the widget acts on no reply without that.
//
// On a site with Answers on, a guide's step may also answer in words, or say
// it can't help (answers.ts). An act step never does: the visitor asked
// Haptic to do something, so it is asked and checked as an act step, Answers
// or not.

type Effort = "low" | "medium" | "high";
/** How long the provider keeps a site's rules and knowledge ready between steps. */
type CacheLife = "5m" | "1h";

/**
 * What is done with a reply whose sentence tells the visitor to use a listed
 * control while it points at nothing (check.ts). "log" only logs, "off" does
 * neither. "ask", the default, acts on it. A guide's reply is judged first
 * (check.ts, judgeNamed): when the control is plainly the goal's next step it
 * is pointed at, with the same sentence and "continue", and no model call is
 * made; when the control is named as an aside, something optional or for
 * later, the reply stands; otherwise the model is asked once more. On the
 * first question nothing is an aside, so there it is pointed at or asked about.
 *
 * Measured on 16 November 2026 over four runs of the 469 tuned single steps
 * (1,870 replies): on every step it caught 34 replies (1.8%), of which 14 were
 * scored wrong. Nearly all the other 20 came after the goal was reached and
 * named an optional extra ("Click Close when you're finished"), and asking
 * again made the model point at the extra in 3 of 27 tries. On first
 * questions it caught 9 replies (0.5%), all 9 wrong, such as "Click FAQ in the
 * top bar to read it" with nothing pointed at. Nothing can have been reached
 * before the first step, so there a control the sentence names is the step.
 * After the first step only the log was written, until Northpine's owner asked
 * to add a budget and the guide ended on Budgets with "To add one, use New
 * budget at the top.": what judgeNamed adds is measured in check.ts.
 *
 * A site with Answers on, which since main's #49 is every site with help
 * docs, was left out of all of this, on the ground that an answer names
 * controls without pointing by design. But most replies there are a guide's
 * (mode "guide"), and those are now judged the same. An answer in words is
 * looked at only for a goal that wants the way (check.ts, wantsTheWay).
 *
 * In act mode "ask" also asks once more at any step when a reply of
 * "continue" points at nothing and its sentence names a control Haptic could
 * press itself (check.ts, namedButNotDone). There every step is Haptic's to
 * do, and such a reply leaves the visitor waiting on nothing: on Northpine's
 * card wizard, 2 demo runs in 9 stopped on "Virtual is already selected, so
 * I'm skipping that choice. Next to open Limits and controls."
 *
 * Whatever this is set to, a reply in act mode that points at a control
 * Haptic could press, with "do" null, and only tells the visitor to click it
 * is made a click (check.ts, pressLeftToVisitor). That takes no model call.
 */
export type Recheck = "off" | "log" | "ask";

/** How a step is asked for. The server reads these from the environment, and the benchmark tries several. */
export interface TurnSettings {
  /** Any Claude model ID, or "mock". */
  model: string;
  effort: Effort;
  /** "off" asks for no thinking before the answer, on the models that allow it. */
  thinking: "default" | "off";
  /** How long a site's cached prompt outlives its last step. */
  cache: CacheLife;
  recheck?: Recheck;
}

/**
 * An hour, because a quiet site sees gaps longer than five minutes between
 * visitors, and every gap past the cache's life is a step paid for in full.
 * Writing an hour's cache costs 2x the input price where five minutes costs
 * 1.25x, so a site that never goes five minutes without a step is cheaper on "5m".
 */
export const DEFAULT_CACHE: CacheLife = "1h";

/** The names the settings are read from: HAPTIC_MODEL, HAPTIC_EFFORT, HAPTIC_THINKING, HAPTIC_CACHE, HAPTIC_RECHECK and ANTHROPIC_API_KEY. */
export type ModelEnv = Record<string, string | undefined>;

const EFFORTS: readonly string[] = ["low", "medium", "high"];
const RECHECKS: readonly string[] = ["off", "log", "ask"];

function settingsFrom(env: ModelEnv): TurnSettings {
  return {
    model: env.HAPTIC_MODEL || "claude-sonnet-5-5",
    // Each step is a small decision and the visitor is waiting on it, so the least effort is the default.
    effort: EFFORTS.includes(env.HAPTIC_EFFORT ?? "") ? (env.HAPTIC_EFFORT as Effort) : "low",
    thinking: env.HAPTIC_THINKING === "off" ? "off" : "default",
    cache: env.HAPTIC_CACHE === "5m" || env.HAPTIC_CACHE === "1h" ? env.HAPTIC_CACHE : DEFAULT_CACHE,
    recheck: RECHECKS.includes(env.HAPTIC_RECHECK ?? "") ? (env.HAPTIC_RECHECK as Recheck) : "ask",
  };
}

// On Node the settings are in process.env when this file loads. A Cloudflare
// Worker is only handed its settings with each request, so its entry point
// passes them to configure().
const startEnv: ModelEnv = typeof process === "undefined" ? {} : process.env;
export let SETTINGS: TurnSettings = settingsFrom(startEnv);
/** For trying the early pointer with no API key: the stand-in names its control, then waits this long before finishing. */
let mockPauseMs = Number(startEnv.HAPTIC_MOCK_PAUSE_MS) || 0;
/** For trying the budget with no API key: what the stand-in pretends each step cost, in US dollars. */
let mockUsd = Number(startEnv.HAPTIC_MOCK_USD) || 0;
let apiKey: string | undefined;
let client: Anthropic | undefined;

/** The calls this file makes to the model. Tests give a stand-in that answers from a script. */
type ModelClient = Pick<Anthropic, "beta">;
let given: ModelClient | undefined;

export function configure(env: ModelEnv, stand?: ModelClient) {
  SETTINGS = settingsFrom(env);
  mockPauseMs = Number(env.HAPTIC_MOCK_PAUSE_MS) || 0;
  mockUsd = Number(env.HAPTIC_MOCK_USD) || 0;
  if (env.ANTHROPIC_API_KEY !== apiKey) {
    apiKey = env.ANTHROPIC_API_KEY;
    client = undefined;
  }
  given = stand;
}

/** A step's reply, with what it took to get. */
export interface TurnMeasure {
  reply: TurnReply;
  /** The model that answered. After a fallback it is not the one asked for. */
  model: string;
  /** The whole step. */
  ms: number;
  /** Until the control to point at was known, which is when the pointer can start moving. */
  msToTarget: number;
  /** On a site with Answers on: until the kind of reply was known, which is the first thing the visitor can be shown. */
  msToMode?: number;
  /** The help articles an answer rests on, by where each came from. Empty for anything else. */
  cited: string[];
  /** Set when the server did not let the reply through as the model wrote it, with why. */
  overruled?: Overruled;
  /** Controls an answer named that are on none of the pages Haptic knows. The articles in `cited` may be out of date. */
  unseen?: string[];
  /** The sentence exactly as the model wrote it, before it was tidied and checked. The benchmark compares the two. */
  wrote: string;
  /** The rules in rules.ts that changed the sentence. Empty for nearly every step. */
  broke: Rule[];
  tokens?: { input: number; cacheRead: number; cacheWrite: number; output: number };
  /** What the step cost, in US dollars, worked out from the tokens: every call it made, a second look included. */
  usd: number;
  /**
   * The listed control the first reply's sentence told the visitor to use while it pointed at nothing, and whether the model was asked again.
   * `act` is set when it was an act reply of "continue" naming a control Haptic could press (namedButNotDone).
   * `verdict` is how a guide's reply was judged (judgeNamed), and `pointed` is set when the server pointed at the control itself.
   * `gaveUp` is set, with no control named, when the first reply said nothing covers a question that asks for a way.
   */
  recheck?: { named: string; asked: boolean; act?: true; verdict?: NamedVerdict; pointed?: true; gaveUp?: true };
  /**
   * Set when the widget asked to act. `refused`: why the step was answered as
   * a guide. `capped`: the step was past the site's cap, so the model was not
   * asked. `modelDo`: the model's own "do", before the server's check.
   * `converted`: the model left a click to the visitor on a control Haptic
   * could press, and the server made it Haptic's (check.ts,
   * pressLeftToVisitor). Names from Haptic's own code only, never anything
   * from the page.
   */
  acting?: { refused?: NotActing; capped?: boolean; modelDo?: Act | null; converted?: true };
}

const Reply = z.object({
  target: z.string().nullable().describe('Id of the element to point at, like "e12", or null'),
  status: z.enum(["continue", "done", "stuck"]),
  say: z.string().describe("One or two short sentences for the visitor"),
});

/**
 * The act-mode reply, in the order the model writes it (DESIGN 1.1): the
 * target first, so the pointer can still start early; what Haptic does to it
 * before the sentence. The act instructions say what each field means.
 */
const ActReply = z.object({
  target: Reply.shape.target,
  do: z.enum(ACTS).nullable(),
  enter: z.string().nullable(),
  commits: z.boolean(),
  status: Reply.shape.status,
  say: Reply.shape.say,
});

/** What the visitor reads when a step in act mode is past the site's cap. The widget, told why by `withheld`, says it in its own words. */
export const ACT_CAP_SAY = "That's as far as I'll go on my own.";

/** A guide's reply has these three fields and nothing else, whatever the model or the stand-in wrote, so no guide reply can carry an act. */
const asGuide = (reply: TurnReply): TurnReply => ({ target: reply.target, status: reply.status, say: reply.say });
/**
 * An act reply's own fields, without anything the model may not set: the echo and `withheld` are the server's.
 * A reply that is stuck does nothing: its "do", if the model gave one, goes.
 */
const asAct = (reply: TurnReply): TurnReply => ({
  target: reply.target,
  do: reply.status === "stuck" ? null : (reply.do ?? null),
  enter: reply.enter ?? null,
  commits: reply.commits === true,
  status: reply.status,
  say: reply.say,
});

/**
 * The server's check of an act reply (DESIGN 4): the same pure rules the
 * widget runs again before its gate. It can only remove a "do". If the
 * rules themselves fail, the "do" is removed too: nothing is acted on that
 * was not checked.
 */
function checked(reply: TurnReply, request: TurnRequest, commitWords: readonly string[] | undefined): TurnReply {
  try {
    const check = checkAction(reply, request, commitWords ? { commitWords } : {});
    return check.withheld ? { ...check.reply, withheld: check.withheld } : check.reply;
  } catch (error) {
    console.error("checkAction failed, so the step is left to the visitor:", error instanceof Error ? error.message : error);
    const { do: removed, ...rest } = reply;
    return removed ? { ...rest, enter: null, withheld: "unknown", removed } : { ...rest, enter: null };
  }
}

/**
 * The reply on a site with Answers on. The order matters: the kind of reply
 * and the control to point at come first, so both can be acted on while the
 * sentence is still being written.
 */
const AnswerReply = z.object({
  mode: z.enum(MODES).describe("\"guide\": a step, or the sentence that ends a guide. \"answer\": an explanation taken from the help articles, with or without a pointer. \"cannot_help\": neither is possible."),
  target: z.string().nullable().describe("Id of the element to point at, like \"e12\", or null. Always null with \"cannot_help\"."),
  status: z.enum(["continue", "done"]).describe("\"continue\" if the visitor must act on the target before the next step. Otherwise \"done\". Always \"done\" with \"cannot_help\"."),
  reason: z.enum(REASONS).nullable().describe("null unless mode is \"cannot_help\". Then \"not_covered\", \"sensitive\" or \"off_topic\"."),
  say: z.string().describe("With \"guide\", one or two short sentences. With \"answer\", one to four. With \"cannot_help\", an empty string."),
  sources: z.array(z.string()).describe("Ids of the help articles the answer is taken from, like [\"a2\"]. Empty unless mode is \"answer\"."),
  controls: z.array(z.string()).describe("The visible label of each control the answer tells the visitor to use, like [\"Send invite\"]. Empty unless mode is \"answer\"."),
});

/** The first fields of a reply, as soon as each is complete in the text streamed so far. */
const MODE_SO_FAR = /"mode"\s*:\s*"([a-z_]+)"/;
const TARGET_SO_FAR = /"target"\s*:\s*(?:"([^"]*)"|null)/;

/** Thrown for failures the visitor's browser should hear about with a specific status. */
export class TurnError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** What the failed call cost all the same, in US dollars. */
    readonly usd = 0,
  ) {
    super(message);
  }
}

/**
 * Thrown when the visitor's widget hung up before the step was ready, because
 * the page changed under it. The model call is stopped, and what it had cost
 * so far is still counted.
 */
export class TurnCancelled extends TurnError {
  constructor(usd = 0) {
    super(499, "The widget hung up before the step was ready.", usd);
  }
}

/** The most output a step may have. A reply is a few dozen tokens: this is room for a model that thinks first. */
const MAX_TOKENS = 4000;
/**
 * How many bytes of text are taken to make one token, to guess a prompt's size
 * before the provider has counted it. English runs nearer three and a half,
 * so the guess comes out high, which is the side to be wrong on.
 */
const BYTES_PER_TOKEN = 2.5;
/** A site's system prompt in tokens, guessed: for guides, and for acting, which has a few more rules. */
const promptTokens = new WeakMap<SiteContext, { guide?: number; act?: number }>();

/**
 * The most a step could cost on the model it asks for, worked out before the
 * call so it can be set aside from the site's budget: the whole prompt written
 * to the cache or read back from it, and as much output as a step may have.
 * A step that may ask the model a second time (`Recheck`) is set aside for two
 * calls, the second reading the prompt the first one wrote.
 */
export function ceilingFor(site: SiteContext, request: TurnRequest, settings: TurnSettings = SETTINGS): Ceiling {
  if (settings.model === "mock") return { cold: mockUsd, warm: mockUsd };
  const size = (text: string) => Math.ceil(new TextEncoder().encode(text).length / BYTES_PER_TOKEN);
  const act = actingFor(site, request).act;
  const mode = act ? "act" : "guide";
  const known = promptTokens.get(site) ?? {};
  promptTokens.set(site, known);
  const prompt = (known[mode] ??= size(buildSystemPrompt(site, act ? "act" : undefined)));
  const input = size(buildUserMessage(request, site)) + request.history.reduce((sum, turn) => sum + size(turn.text), 0);
  const cost = (cacheWrite: number, cacheRead: number) => costOf(settings.model, { input, cacheRead, cacheWrite, output: MAX_TOKENS }, settings.cache);
  // Any step may be asked twice: a guide's, on a site with Answers on too, and an act step (see measureTurn).
  const twice = settings.recheck === "ask";
  const again = twice ? cost(0, prompt) : 0;
  return { cold: cost(prompt, 0) + again, warm: cost(0, prompt) + again };
}

export async function runTurn(site: SiteContext, request: TurnRequest): Promise<TurnReply> {
  return (await measureTurn(site, request)).reply;
}

/** What a caller is told while a reply is still forming. Each is called at most once. */
export interface Watch {
  /** The kind of reply, on a site with Answers on. */
  onMode?(mode: Mode): void;
  /** The control to point at, and only if it is on the page the model was shown. */
  onTarget?(id: string): void;
}

/**
 * One step, timed. `watch` hears the kind of reply and the control to point at
 * as soon as each is known: the control only if it is on the page the model
 * was shown. The benchmark calls this with the settings it wants to compare.
 */
export async function measureTurn(
  site: SiteContext,
  asked: TurnRequest,
  settings: TurnSettings = SETTINGS,
  watch: Watch = {},
  /** Aborted when the widget hangs up. The model call stops and TurnCancelled is thrown. */
  signal?: AbortSignal,
): Promise<TurnMeasure> {
  const started = Date.now();
  // Decided again on every step, from the site as it is now.
  const acting = actingFor(site, asked);
  // A step answered as a guide is asked exactly as a guide's, whatever the widget asked for. From here, `request.mode` is the mode answered in.
  const request: TurnRequest = acting.act || asked.mode === undefined ? asked : withoutMode(asked);
  const actingMeasure: TurnMeasure["acting"] = asked.mode === "act" ? (acting.act ? {} : { refused: acting.refused ?? "site" }) : undefined;
  // Answers in words are for a guide's steps. A step Haptic was asked to do is answered as an act step, Answers or not.
  const answers = !acting.act && answersOn(site);

  // Past the site's cap, acting ends without asking the model. The widget's own cap comes first; this is for a widget that does not keep it.
  if (acting.act && request.step > actionsAllowed(acting.settings) + ACTING_LIMITS.stepAllowance) {
    const reply: TurnReply = { target: null, status: "done", say: ACT_CAP_SAY, mode: "act", withheld: "cap" };
    const ms = Date.now() - started;
    return { reply, model: "none", ms, msToTarget: ms, wrote: reply.say, broke: [], cited: [], usd: 0, acting: { ...actingMeasure, capped: true } };
  }

  let msToTarget: number | undefined;
  let msToMode: number | undefined;
  let declining = false;
  let pointed = false;
  const onPage = (id: string | null | undefined): id is string => !!id && request.snapshot.elements.some((element) => element.id === id);
  // A control the site's owner ruled out is never pointed at, whatever the model wrote. Not even for a moment, before the reply is checked.
  const blocked = (id: string | null | undefined) => !!id && isBlocked(request.snapshot.elements.find((element) => element.id === id), site.blocked);
  const modeKnown = (mode: string | undefined) => {
    if (msToMode !== undefined || !MODES.includes(mode as Mode)) return;
    msToMode = Date.now() - started;
    declining = mode === "cannot_help";
    watch.onMode?.(mode as Mode);
  };
  // A reply that names nothing may be followed by one that does, when the model is asked again, and that one is sent early too.
  const targetKnown = (id: string | null) => {
    if (pointed) return;
    if (msToTarget === undefined || onPage(id)) msToTarget = Date.now() - started;
    // A reply that declines points at nothing, whatever it names.
    if (!onPage(id) || declining || blocked(id)) return;
    pointed = true;
    watch.onTarget?.(id);
  };

  let answer: Answer;
  if (settings.model === "mock") {
    const reply = answers ? mockAnswerTurn(site, request) : mockTurn(request);
    if (mockPauseMs > 0) {
      modeKnown(reply.mode);
      targetKnown(reply.target);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, mockPauseMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new TurnCancelled(mockUsd));
        });
      });
    }
    if (signal?.aborted) throw new TurnCancelled(mockUsd);
    answer = { reply, model: "mock", usd: mockUsd };
  } else answer = await claudeTurn(site, request, settings, answers, modeKnown, targetKnown, signal);
  // The model can only point at what's on the page it was shown.
  if (!onPage(answer.reply.target)) answer.reply.target = null;

  // The second look is for a guide's steps and for acting, and never for a reply the provider declined. On a site with
  // Answers on, a reply in guide mode (a step, or the sentence that ends a guide) is a guide's like any other and is
  // judged the same. An answer in words from a help article names controls without pointing by design, so it is looked
  // at only when the visitor asked for a way (check.ts, wantsTheWay): the owner's rule is that they are taken through
  // it, not told about it. A question of fact or explanation keeps its answer as it is, and "cannot_help" is a fixed sentence.
  const kind: Mode = answers && MODES.includes(answer.reply.mode as Mode) ? (answer.reply.mode as Mode) : "guide";
  const looked = kind === "guide" || (kind === "answer" && wantsTheWay(request.goal));
  const checking = settings.model !== "mock" && settings.recheck !== "off" && looked && !answer.declined;
  // In act mode at any step: a "continue" that points at nothing stops the run, so a control it names that Haptic could press is asked about.
  const stalled = checking && acting.act ? namedButNotDone(request, asStep(answer.reply), acting.settings.commitWords) : undefined;
  const named = checking && !stalled ? namedButNotPointed(request.snapshot, asStep(answer.reply)) : undefined;
  // A guide that ends in words naming the goal's control, with no word that says to use it, is asked about too (check.ts).
  const ended = checking && !acting.act && !named ? namedForTheGoal(request, asStep(answer.reply)) : undefined;
  const found = stalled ?? named ?? ended;
  if (found) {
    // A reply that names a control is judged (check.ts), an act reply's too unless it stalls, which is always asked about.
    // One that only names it at the end of a guide is never pointed at in code: the model is asked.
    const verdict = stalled ? undefined : ended ? "ask" : judgeNamed(request, asStep(answer.reply), found);
    const acts = settings.recheck === "ask";
    // Only a guide's step is made in code. In act mode the step may be Haptic's own press, so the model is asked to make it.
    const point = acts && verdict === "point" && !acting.act;
    const ask = acts && (stalled !== undefined || verdict === "ask" || (verdict === "point" && acting.act));
    const then = point ? ", so it is pointed at" : ask ? ", asking again" : verdict === "aside" ? ", named as an aside" : "";
    // Ids only: the server's log holds nothing from the visitor's page.
    console.log(
      stalled
        ? `recheck ${site.id} step ${request.step}: an act reply of "continue" names ${found.id}, which Haptic could press, and nothing is pointed at${then}`
        : ended
          ? `recheck ${site.id} step ${request.step}: the guide ends in words that name ${found.id}, a control of the goal, and nothing is pointed at${then}`
          : `recheck ${site.id} step ${request.step}: the sentence tells the visitor to use ${found.id} and nothing is pointed at${then}`,
    );
    answer.recheck = { named: found.id, asked: ask, ...(stalled ? { act: true as const } : {}), ...(verdict ? { verdict } : {}), ...(point ? { pointed: true as const } : {}) };
    if (point) {
      // The same sentence, now with the pointer it describes, and the guide goes on.
      answer.reply = { ...answer.reply, target: found.id, status: "continue" };
      targetKnown(found.id);
    }
    if (ask) {
      try {
        const note = stalled ? namedButNotDoneNote(stalled) : ended ? namedForTheGoalNote(ended) : namedButNotPointedNote(found, answer.reply.status);
        // The model is shown its own reply as it wrote it: on a site with Answers on, with its mode, sources and controls.
        const again = await claudeTurn(site, request, settings, answers, modeKnown, targetKnown, signal, { reply: answers ? answer.reply : asStep(answer.reply), note });
        if (!onPage(again.reply.target)) again.reply.target = null;
        answer = { ...again, tokens: added(answer.tokens, again.tokens), usd: answer.usd + again.usd, recheck: answer.recheck };
      } catch (error) {
        // The visitor's widget hung up: the step is dropped, and both calls are counted.
        if (error instanceof TurnCancelled) throw new TurnCancelled(answer.usd + error.usd);
        // A second call that failed may still have been paid for.
        if (error instanceof TurnError) answer.usd += error.usd;
        // The first reply is still one the visitor can be shown.
        console.warn(`recheck ${site.id} step ${request.step}: asking again failed, so the first reply stands:`, error instanceof Error ? error.message : error);
      }
    }
  }

  // "I couldn't find that", to a first question that asks for a way, is asked about once more too (check.ts, gaveUpNote):
  // the way is often behind a menu the model did not think to open. Its second reply is the one sent, whatever it says.
  const gaveUp =
    kind === "cannot_help" &&
    (answer.reply.reason ?? "not_covered") === "not_covered" &&
    settings.model !== "mock" &&
    settings.recheck !== "off" &&
    !answer.declined &&
    request.step === 0 &&
    !request.event &&
    wantsTheWay(request.goal);
  if (gaveUp) {
    const ask = settings.recheck === "ask";
    console.log(`recheck ${site.id} step ${request.step}: "not covered" to a question that asks for a way${ask ? ", asking again" : ""}`);
    answer.recheck = { named: "", asked: ask, gaveUp: true };
    if (ask) {
      try {
        // A reply that declines points at nothing. The second one may point, and its pointer goes out as early as any.
        declining = false;
        const again = await claudeTurn(site, request, settings, answers, modeKnown, targetKnown, signal, { reply: answer.reply, note: gaveUpNote() });
        if (!onPage(again.reply.target)) again.reply.target = null;
        answer = { ...again, tokens: added(answer.tokens, again.tokens), usd: answer.usd + again.usd, recheck: answer.recheck };
      } catch (error) {
        if (error instanceof TurnCancelled) throw new TurnCancelled(answer.usd + error.usd);
        if (error instanceof TurnError) answer.usd += error.usd;
        console.warn(`recheck ${site.id} step ${request.step}: asking again failed, so the first reply stands:`, error instanceof Error ? error.message : error);
      }
    }
  }

  const wrote = answer.reply.say;
  let finished: Finished;
  if (answer.declined) finished = declinedReply(site, answers);
  else if (answers) finished = finishAnswer(site, request, answer.reply);
  else {
    const { say, broke } = checkSay(tidySay(wrote));
    // Nothing fit to show was left. The pointer, if there is one, still says where to go.
    finished = { reply: { ...asStep(answer.reply), say: say || (answer.reply.target ? SAY_WITHOUT_WORDS.pointing : SAY_WITHOUT_WORDS.nothing) }, cited: [], broke };
  }
  let reply = finished.reply;
  if (acting.act) {
    const modelDo = reply.do ?? null;
    // A press the model left to the visitor that Haptic could make itself is made Haptic's, with no model call (check.ts). The check below and the widget's gate judge it as any other.
    const pressed = pressLeftToVisitor(request, reply, acting.settings.commitWords);
    if (pressed) {
      // Ids only: the server's log holds nothing from the visitor's page.
      console.log(`press ${site.id} step ${request.step}: an act reply of "continue" left a click on ${pressed.element.id} to the visitor, which Haptic could press, so Haptic clicks it`);
      reply = { ...reply, do: "click", enter: null, say: pressed.say };
    }
    reply = { ...checked(asAct(reply), request, acting.settings.commitWords), mode: "act" };
    answer.acting = { ...actingMeasure, modelDo, ...(pressed ? { converted: true as const } : {}) };
  } else {
    // An answer's reply is already only its own fields (answers.ts). A guide's is its three.
    if (!answers) reply = asGuide(reply);
    if (actingMeasure) answer.acting = actingMeasure;
    // "Not that one." is for a visitor who used something else, which the widget says. One who did the step shown is not told so (rules.ts).
    reply = { ...reply, say: withoutBlame(reply.say, request.event) };
  }
  // A control the site's owner ruled out: nothing is pointed at, nothing is done, and the visitor reads a fixed sentence.
  let overruled = finished.overruled;
  if (blocked(reply.target)) {
    reply = { target: null, status: "done", say: BLOCKED_SAY, blocked: true, ...(acting.act ? { do: null, enter: null, commits: false, mode: "act" as const } : answers ? { mode: "guide" as const } : {}) };
    overruled = "blocked";
  }
  modeKnown(reply.mode);
  targetKnown(reply.target);
  const { broke, cited, unseen } = finished;
  if (broke.length) console.warn(`turn ${site.id} step ${request.step}: the sentence broke the rules for ${broke.join(", ")}.`);
  if (overruled) console.warn(`turn ${site.id} step ${request.step}: the reply was overruled (${overruled}).`);

  const { declined: _declined, reply: _raw, ...rest } = answer;
  const ms = Date.now() - started;
  return {
    ...rest,
    reply,
    ms,
    msToTarget: msToTarget ?? ms,
    ...(answers ? { msToMode: msToMode ?? ms } : {}),
    wrote,
    broke,
    cited,
    ...(overruled ? { overruled } : {}),
    ...(unseen ? { unseen } : {}),
  };
}

/** A reply as the model wrote it, as a step: the fields of a guide's or an act reply, and none of an answer's. */
function asStep(raw: ModelReply): TurnReply {
  const step: TurnReply = { target: raw.target, status: raw.status, say: raw.say };
  if (raw.do !== undefined) step.do = raw.do;
  if (raw.enter !== undefined) step.enter = raw.enter;
  if (raw.commits !== undefined) step.commits = raw.commits;
  return step;
}

/** The request without the mode the widget asked for, for a step answered as a guide. */
function withoutMode(request: TurnRequest): TurnRequest {
  const { mode: _asked, ...rest } = request;
  return rest;
}

/** What the model returned, before the server has checked it. */
interface Answer {
  reply: ModelReply;
  /** The model that answered. After a fallback it is not the one asked for. */
  model: string;
  tokens?: TurnMeasure["tokens"];
  /** What the call cost, in US dollars: every call the step made. */
  usd: number;
  /** The provider declined the request, so there is no reply to check. */
  declined?: true;
  recheck?: TurnMeasure["recheck"];
  acting?: TurnMeasure["acting"];
}

function added(one: TurnMeasure["tokens"], two: TurnMeasure["tokens"]): TurnMeasure["tokens"] {
  if (!one || !two) return one ?? two;
  return { input: one.input + two.input, cacheRead: one.cacheRead + two.cacheRead, cacheWrite: one.cacheWrite + two.cacheWrite, output: one.output + two.output };
}

/**
 * The setting that turns thinking off, for the models that take one. Haiku and
 * Sonnet each have their own. Opus always thinks, so it gets nothing here.
 */
function withoutThinking(model: string): { thinking?: { type: "disabled" } | { type: "between_tools" } } {
  if (model.includes("haiku")) return { thinking: { type: "disabled" } };
  if (model.includes("sonnet")) return { thinking: { type: "between_tools" } };
  return {};
}

async function claudeTurn(
  site: SiteContext,
  request: TurnRequest,
  settings: TurnSettings,
  answers: boolean,
  modeKnown: (mode: string | undefined) => void,
  targetKnown: (id: string | null) => void,
  signal?: AbortSignal,
  /** The reply to ask about again, and what to tell the model about it. */
  followUp?: { reply: TurnReply | ModelReply; note: string },
): Promise<Answer> {
  const model = given ?? (client ??= new Anthropic(apiKey ? { apiKey } : {}));
  const messages: Anthropic.Beta.BetaMessageParam[] = request.history.map((turn) => ({ role: turn.role, content: turn.text }));
  // The conversation has to start with a user message.
  while (messages[0]?.role === "assistant") messages.shift();
  messages.push({ role: "user", content: buildUserMessage(request, site) });
  if (followUp) messages.push({ role: "assistant", content: JSON.stringify(followUp.reply) }, { role: "user", content: followUp.note });

  // If the model declines a request on policy grounds, the API retries it on a
  // fallback model inside the same call. Haiku has no server-side fallback.
  const fallback = settings.model.includes("haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

  const started = Date.now();
  let response;
  // What the provider has counted so far. It is kept apart from the reply
  // because a call can be paid for and still fail: cut off at its length
  // limit, or ending in text that is not the JSON asked for.
  let counted: { usage: Anthropic.Beta.BetaUsage; model: string; stop: string | null } | undefined;
  // The provider only says how many tokens were written once the reply ends. A reply that breaks off
  // part-way has been paid for as far as it got, so what has arrived is counted as it comes, the same
  // cautious way the ceiling is: text, thinking and anything else the reply streams. Thinking the
  // provider does not stream is not seen, so a call cut short while thinking is still counted low.
  let streamed = 0;
  try {
    const stream = model.beta.messages.stream({
      model: settings.model,
      max_tokens: MAX_TOKENS,
      ...fallback,
      ...(settings.thinking === "off" ? withoutThinking(settings.model) : {}),
      output_config: {
        effort: settings.effort,
        format: request.mode === "act" ? betaZodOutputFormat(ActReply) : answers ? betaZodOutputFormat(AnswerReply) : betaZodOutputFormat(Reply),
      },
      // Rules and site knowledge are the same for every turn on a site, so they're cached: once for guides (or answers) and once for acting.
      system: [{ type: "text", text: buildSystemPrompt(site, request.mode), cache_control: { type: "ephemeral", ttl: settings.cache } }],
      messages,
    }, signal ? { signal } : undefined);
    // The reply is JSON with the fields that can be acted on first: the kind of reply where there is one, then "target".
    stream.on("text", (_delta, soFar) => {
      if (answers) modeKnown(MODE_SO_FAR.exec(soFar)?.[1]);
      const found = TARGET_SO_FAR.exec(soFar);
      if (found) targetKnown(found[1] ?? null);
    });
    stream.on("streamEvent", (event, soFar) => {
      counted = { usage: soFar.usage, model: soFar.model, stop: soFar.stop_reason };
      if (event.type === "content_block_delta") {
        const delta = event.delta as { text?: string; thinking?: string; partial_json?: string };
        streamed += (delta.text?.length ?? 0) + (delta.thinking?.length ?? 0) + (delta.partial_json?.length ?? 0);
      }
    });
    response = await stream.finalMessage();
  } catch (error) {
    const soFar = counted && { ...counted.usage, output_tokens: Math.max(counted.usage.output_tokens ?? 0, Math.ceil(streamed / BYTES_PER_TOKEN)) };
    const paid = counted && soFar ? usdOf(soFar, counted.model, settings.cache, settings.model) : 0;
    if (signal?.aborted) throw new TurnCancelled(paid);
    if (error instanceof Anthropic.AuthenticationError) throw new TurnError(500, "The server's Anthropic credentials are missing or invalid.", paid);
    if (error instanceof Anthropic.RateLimitError) throw new TurnError(503, "The model is rate limited. Try again shortly.", paid);
    if (error instanceof Anthropic.APIError) throw new TurnError(502, `The model call failed (${error.status ?? "no status"}): ${error.message}`, paid);
    // The stream ended and its text could not be read as a reply.
    if (counted) throw new TurnError(502, `The model's reply couldn't be read (stop reason: ${counted.stop ?? "none"}).`, paid);
    throw error;
  }

  const { usage } = response;
  const usd = usdOf(usage, response.model, settings.cache, settings.model);
  console.log(
    `turn ${site.id} step ${request.step}: ${Date.now() - started} ms, ${response.model}, ` +
      `input ${usage.input_tokens}, cache read ${usage.cache_read_input_tokens ?? 0}, cache write ${usage.cache_creation_input_tokens ?? 0}, output ${usage.output_tokens}`,
  );

  const tokens = {
    input: usage.input_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    output: usage.output_tokens,
  };
  if (response.stop_reason === "refusal") return { reply: { target: null, status: "stuck", say: SAY_WITHOUT_WORDS.nothing }, model: response.model, tokens, usd, declined: true };
  if (!response.parsed_output) throw new TurnError(502, `The model's reply couldn't be read (stop reason: ${response.stop_reason}).`, usd);
  return { reply: response.parsed_output, model: response.model, tokens, usd };
}

/**
 * What a call cost. When the provider retried a declined request on another
 * model, it lists each attempt, and the declined one is paid for as well: the
 * top-level count covers only the attempt that answered.
 */
function usdOf(usage: Anthropic.Beta.BetaUsage, model: string, cache: CacheLife, asked: string): number {
  type Counted = { input_tokens: number | null; cache_read_input_tokens: number | null; cache_creation_input_tokens: number | null; output_tokens: number | null };
  const cost = (part: Counted, by: string) =>
    costOf(by, { input: part.input_tokens ?? 0, cacheRead: part.cache_read_input_tokens ?? 0, cacheWrite: part.cache_creation_input_tokens ?? 0, output: part.output_tokens ?? 0 }, cache);
  if (!usage.iterations?.length) return cost(usage, model);
  // An attempt that does not say which model made it was the one asked for, unless it is the one that answered.
  return usage.iterations.reduce(
    (sum, attempt) => sum + cost(attempt, ("model" in attempt && attempt.model) || (attempt.type === "fallback_message" ? model : asked)),
    0,
  );
}

/**
 * Replies the stand-in gives before its own, one per step, so that a test can
 * have it write what a keyword matcher never would: a "do" on a control that
 * commits, a value the visitor did not give. Each call replaces the script.
 */
const mockScript: TurnReply[] = [];
export function scriptMock(...replies: TurnReply[]): void {
  mockScript.splice(0, mockScript.length, ...replies);
}

/**
 * The stand-in on a site with Answers on. A question that asks what, why,
 * when or who is answered with the opening of the help article that shares
 * the most words with it. Anything else is pointed at as before, and a first
 * question with nothing to point at is not covered. It exists so that every
 * kind of reply can be seen without a key, not to be right.
 */
function mockAnswerTurn(site: SiteContext, request: TurnRequest): ModelReply {
  const cannot = (reason: Reason): ModelReply => ({ mode: "cannot_help", target: null, status: "done", reason, say: "", sources: [] });
  const first = request.step === 0 && !request.event;
  const goal = request.goal.toLowerCase();
  if (first && /\b(?:poem|joke|weather|recipe|your instructions|your rules|system prompt)\b/.test(goal)) return cannot("off_topic");
  if (first && /^(?:what|why|when|who|which|does|do|is|are|can|will|how (?:long|many|often))\b/.test(goal)) {
    if (neverDecided(request.goal, "")) return cannot("sensitive");
    const words = new Set(goal.match(/[a-z]{4,}/g) ?? []);
    let best: { id: string; say: string; score: number } | undefined;
    for (const { id, doc } of articlesOf(site)) {
      const score = new Set((`${doc.title} ${doc.text}`.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((word) => words.has(word))).size;
      if (score < 2 || score <= (best?.score ?? 0)) continue;
      // The article's opening, without its heading.
      const body = doc.text.replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim();
      best = { id, score, say: body.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ") };
    }
    if (best) {
      // "…and where is it" gets a pointer too, when the control the question names is on the page.
      const named = request.snapshot.elements.find((element) => element.label.length > 3 && goal.includes(element.label.toLowerCase()));
      // The controls it names: whatever the answer says to press, click or choose.
      const controls = [...best.say.matchAll(/\b(?:press|click|choose|select|open)\s+(?:the\s+)?([A-Z][A-Za-z]*(?:\s+[a-z]+){0,3}?)(?=[.,;]|\s+(?:on|in|at|to|and|then)\b|$)/g)].map((found) => found[1] ?? "");
      return { mode: "answer", target: named?.id ?? null, status: "done", reason: null, say: best.say, sources: [best.id], controls };
    }
  }
  const step = mockTurn(request);
  if (first && !step.target) return cannot(neverDecided(request.goal, "") ? "sensitive" : "not_covered");
  return { ...step, mode: "guide", reason: null, sources: [] };
}

/**
 * Stand-in for the model: points at the element whose label shares the most
 * words with the goal, and never at the same label twice. Good enough to test
 * everything around the model, not to guide anyone. In act mode it also says
 * what Haptic does to the control (`mockAct`).
 */
function mockTurn(request: TurnRequest): ModelReply {
  const scripted = mockScript.shift();
  // A test's script may write anything a model could, fields the reply may not carry included: the server takes those off.
  if (scripted) return structuredClone(scripted) as unknown as ModelReply;
  const act = request.mode === "act";
  const words = (text: string) => text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const goal = new Set(words(request.goal));
  const used = request.history.filter((turn) => turn.role === "assistant").map((turn) => turn.text);
  // Every sentence the stand-in writes about a control ends with its label: "Click Billing." in a guide, "Clicking Billing." when acting.
  const usedBefore = (label: string) => used.some((text) => text.endsWith(`Click ${label}.`) || (act && text.endsWith(` ${label}.`)));
  const visitorDoes = (reply: ModelReply): ModelReply => (act ? { target: reply.target, do: null, enter: null, commits: false, status: reply.status, say: reply.say } : reply);
  // After a wrong click, point again at the control it meant, if that is still on the page.
  const strayed = /instead of|without using/.test(request.event ?? "");
  if (strayed) {
    const meant = /Click (.+)\.$/.exec(used.pop() ?? "")?.[1];
    const again = request.snapshot.elements.find((element) => element.label === meant && !element.state?.includes("disabled"));
    if (again) return visitorDoes({ target: again.id, status: "continue", say: `Not that one. Click ${again.label}.` });
  }
  let best: { element: SnapElement; score: number } | undefined;
  for (const element of request.snapshot.elements) {
    if (!element.label || element.state?.includes("disabled") || usedBefore(element.label)) continue;
    const score = words(element.label).filter((word) => goal.has(word)).length;
    if (score > (best?.score ?? 0)) best = { element, score };
  }
  if (!best) return visitorDoes(request.step ? { target: null, status: "done", say: "That should be it." } : { target: null, status: "stuck", say: "I don't see that on this page." });
  if (act && !strayed) return mockAct(best.element, request.goal);
  return visitorDoes({ target: best.element.id, status: "continue", say: `${strayed ? "Not that one. " : ""}Click ${best.element.label}.` });
}

/** Words that start the name of a control the stand-in takes to commit. Its own short list: the real rules are in act-rules.ts, and the server checks every reply with them. */
const MOCK_COMMITS = /^(?:save|send|submit|pay|delete|issue|publish|invite|approve|confirm|create)\b/i;

/**
 * The stand-in's act reply for the control it chose, as the act instructions
 * ask: the hand-over at a control that commits; a value only from quote marks
 * in the visitor's question, and otherwise the visitor fills the field in;
 * a click, a check or a choice by the control's role.
 */
function mockAct(element: SnapElement, goal: string): ModelReply {
  const { id: target, label } = element;
  if (MOCK_COMMITS.test(label)) return { target, do: null, enter: null, commits: true, status: "done", say: `Ready. Check it and click ${label}.` };
  const given = /["“]([^"“”]+)["”]/.exec(goal)?.[1]?.trim() || null;
  const step = (act: Act, say: string, enter: string | null = null): ModelReply => ({ target, do: act, enter, commits: false, status: "continue", say });
  switch (element.role) {
    case "textbox":
    case "searchbox":
    case "spinbutton":
      return given ? step("type", `Typing in ${label}.`, given) : { target, do: null, enter: null, commits: false, status: "continue", say: `Fill in ${label}.` };
    case "combobox":
    case "select":
      return given ? step("choose", `Choosing in ${label}.`, given) : { target, do: null, enter: null, commits: false, status: "continue", say: `Choose in ${label}.` };
    case "checkbox":
    case "switch":
      return step("check", `Checking ${label}.`);
    default:
      return step("click", `Clicking ${label}.`);
  }
}
