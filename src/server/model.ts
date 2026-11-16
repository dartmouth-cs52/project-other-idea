import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { MODES, REASONS, type Mode, type Reason, type SiteContext, type TurnReply, type TurnRequest } from "../shared/types.ts";
import { declinedReply, finishAnswer, neverDecided, type Finished, type ModelReply, type Overruled } from "./answers.ts";
import type { Ceiling } from "./budget.ts";
import { costOf } from "./prices.ts";
import { answersOn, articlesOf, buildSystemPrompt, buildUserMessage } from "./prompt.ts";
import { checkSay, SAY_WITHOUT_WORDS, tidySay, type Rule } from "./rules.ts";

export { SAY_WITHOUT_WORDS, tidySay };

// One model call per step. HAPTIC_MODEL picks the model, or "mock" for a
// keyword matcher that needs no API key. The reply is streamed, so the control
// to point at is known before the sentence that goes with it is finished.

type Effort = "low" | "medium" | "high";
/** How long the provider keeps a site's rules and knowledge ready between steps. */
type CacheLife = "5m" | "1h";

/** How a step is asked for. The server reads these from the environment, and the benchmark tries several. */
export interface TurnSettings {
  /** Any Claude model ID, or "mock". */
  model: string;
  effort: Effort;
  /** "off" asks for no thinking before the answer, on the models that allow it. */
  thinking: "default" | "off";
  /** How long a site's cached prompt outlives its last step. */
  cache: CacheLife;
}

/**
 * An hour, because a quiet site sees gaps longer than five minutes between
 * visitors, and every gap past the cache's life is a step paid for in full.
 * Writing an hour's cache costs 2x the input price where five minutes costs
 * 1.25x, so a site that never goes five minutes without a step is cheaper on "5m".
 */
export const DEFAULT_CACHE: CacheLife = "1h";

/** The names the settings are read from: HAPTIC_MODEL, HAPTIC_EFFORT, HAPTIC_THINKING, HAPTIC_CACHE and ANTHROPIC_API_KEY. */
export type ModelEnv = Record<string, string | undefined>;

const EFFORTS: readonly string[] = ["low", "medium", "high"];

function settingsFrom(env: ModelEnv): TurnSettings {
  return {
    model: env.HAPTIC_MODEL || "claude-sonnet-5-5",
    // Each step is a small decision and the visitor is waiting on it, so the least effort is the default.
    effort: EFFORTS.includes(env.HAPTIC_EFFORT ?? "") ? (env.HAPTIC_EFFORT as Effort) : "low",
    thinking: env.HAPTIC_THINKING === "off" ? "off" : "default",
    cache: env.HAPTIC_CACHE === "5m" || env.HAPTIC_CACHE === "1h" ? env.HAPTIC_CACHE : DEFAULT_CACHE,
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

export function configure(env: ModelEnv) {
  SETTINGS = settingsFrom(env);
  mockPauseMs = Number(env.HAPTIC_MOCK_PAUSE_MS) || 0;
  mockUsd = Number(env.HAPTIC_MOCK_USD) || 0;
  if (env.ANTHROPIC_API_KEY !== apiKey) {
    apiKey = env.ANTHROPIC_API_KEY;
    client = undefined;
  }
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
  /** What the step cost, in US dollars, worked out from the tokens. */
  usd: number;
}

const Reply = z.object({
  target: z.string().nullable().describe('Id of the element to point at, like "e12", or null'),
  status: z.enum(["continue", "done", "stuck"]),
  say: z.string().describe("One or two short sentences for the visitor"),
});

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
const promptTokens = new WeakMap<SiteContext, number>();

/**
 * The most a step could cost on the model it asks for, worked out before the
 * call so it can be set aside from the site's budget: the whole prompt written
 * to the cache or read back from it, and as much output as a step may have.
 */
export function ceilingFor(site: SiteContext, request: TurnRequest, settings: TurnSettings = SETTINGS): Ceiling {
  if (settings.model === "mock") return { cold: mockUsd, warm: mockUsd };
  const size = (text: string) => Math.ceil(new TextEncoder().encode(text).length / BYTES_PER_TOKEN);
  let prompt = promptTokens.get(site);
  if (prompt === undefined) promptTokens.set(site, (prompt = size(buildSystemPrompt(site))));
  const input = size(buildUserMessage(request)) + request.history.reduce((sum, turn) => sum + size(turn.text), 0);
  const cost = (cacheWrite: number, cacheRead: number) => costOf(settings.model, { input, cacheRead, cacheWrite, output: MAX_TOKENS }, settings.cache);
  return { cold: cost(prompt, 0), warm: cost(0, prompt) };
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

/** What the model returned, before the server has checked it. */
interface Answered {
  reply: ModelReply;
  model: string;
  tokens?: TurnMeasure["tokens"];
  /** What the call cost, in US dollars. */
  usd: number;
  /** The provider declined the request, so there is no reply to check. */
  declined?: true;
}

/**
 * One step, timed. `watch` hears the kind of reply and the control to point at
 * as soon as each is known. The benchmark calls this with the settings it
 * wants to compare.
 */
export async function measureTurn(
  site: SiteContext,
  request: TurnRequest,
  settings: TurnSettings = SETTINGS,
  watch: Watch = {},
  /** Aborted when the widget hangs up. The model call stops and TurnCancelled is thrown. */
  signal?: AbortSignal,
): Promise<TurnMeasure> {
  const started = Date.now();
  const answers = answersOn(site);
  let msToTarget: number | undefined;
  let msToMode: number | undefined;
  let declining = false;
  const onPage = (id: string | null): id is string => id !== null && request.snapshot.elements.some((element) => element.id === id);
  const modeKnown = (mode: string | undefined) => {
    if (msToMode !== undefined || !MODES.includes(mode as Mode)) return;
    msToMode = Date.now() - started;
    declining = mode === "cannot_help";
    watch.onMode?.(mode as Mode);
  };
  const targetKnown = (id: string | null) => {
    if (msToTarget !== undefined) return;
    msToTarget = Date.now() - started;
    // A reply that declines points at nothing, whatever it names.
    if (onPage(id) && !declining) watch.onTarget?.(id);
  };

  let answered: Answered;
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
    answered = { reply, model: "mock", usd: mockUsd };
  } else answered = await claudeTurn(site, request, settings, answers, modeKnown, targetKnown, signal);

  const wrote = answered.reply.say;
  let finished: Finished;
  if (answered.declined) finished = declinedReply(site, answers);
  else if (answers) finished = finishAnswer(site, request, answered.reply);
  else {
    // The model can only point at what's on the page it was shown.
    const target = onPage(answered.reply.target) ? answered.reply.target : null;
    const { say, broke } = checkSay(tidySay(wrote));
    // Nothing fit to show was left. The pointer, if there is one, still says where to go.
    finished = { reply: { target, status: answered.reply.status, say: say || (target ? SAY_WITHOUT_WORDS.pointing : SAY_WITHOUT_WORDS.nothing) }, cited: [], broke };
  }
  const { reply, cited, broke, overruled, unseen } = finished;
  modeKnown(reply.mode);
  targetKnown(reply.target);
  if (broke.length) console.warn(`turn ${site.id} step ${request.step}: the sentence broke the rules for ${broke.join(", ")}.`);
  if (overruled) console.warn(`turn ${site.id} step ${request.step}: the reply was overruled (${overruled}).`);

  const ms = Date.now() - started;
  return {
    reply,
    model: answered.model,
    ms,
    msToTarget: msToTarget ?? ms,
    ...(answers ? { msToMode: msToMode ?? ms } : {}),
    wrote,
    broke,
    cited,
    ...(overruled ? { overruled } : {}),
    ...(unseen ? { unseen } : {}),
    ...(answered.tokens ? { tokens: answered.tokens } : {}),
    usd: answered.usd,
  };
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
): Promise<Answered> {
  client ??= new Anthropic(apiKey ? { apiKey } : {});
  const messages: Anthropic.Beta.BetaMessageParam[] = request.history.map((turn) => ({ role: turn.role, content: turn.text }));
  // The conversation has to start with a user message.
  while (messages[0]?.role === "assistant") messages.shift();
  messages.push({ role: "user", content: buildUserMessage(request) });

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
    const stream = client.beta.messages.stream({
      model: settings.model,
      max_tokens: MAX_TOKENS,
      ...fallback,
      ...(settings.thinking === "off" ? withoutThinking(settings.model) : {}),
      output_config: { effort: settings.effort, format: betaZodOutputFormat(answers ? AnswerReply : Reply) },
      // Rules and site knowledge are the same for every turn on a site, so they're cached.
      system: [{ type: "text", text: buildSystemPrompt(site), cache_control: { type: "ephemeral", ttl: settings.cache } }],
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
 * everything around the model, not to guide anyone.
 */
function mockTurn(request: TurnRequest): ModelReply {
  const words = (text: string) => text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const goal = new Set(words(request.goal));
  const used = request.history.filter((turn) => turn.role === "assistant").map((turn) => turn.text);
  // After a wrong click, point again at the control it meant, if that is still on the page.
  const strayed = /instead of|without using/.test(request.event ?? "");
  if (strayed) {
    const meant = /Click (.+)\.$/.exec(used.pop() ?? "")?.[1];
    const again = request.snapshot.elements.find((element) => element.label === meant && !element.state?.includes("disabled"));
    if (again) return { target: again.id, status: "continue", say: `Not that one. Click ${again.label}.` };
  }
  let best: { id: string; label: string; score: number } | undefined;
  for (const element of request.snapshot.elements) {
    if (!element.label || element.state?.includes("disabled") || used.some((text) => text.endsWith(`Click ${element.label}.`))) continue;
    const score = words(element.label).filter((word) => goal.has(word)).length;
    if (score > (best?.score ?? 0)) best = { id: element.id, label: element.label, score };
  }
  if (!best) return request.step ? { target: null, status: "done", say: "That should be it." } : { target: null, status: "stuck", say: "I don't see that on this page." };
  return { target: best.id, status: "continue", say: `${strayed ? "Not that one. " : ""}Click ${best.label}.` };
}
