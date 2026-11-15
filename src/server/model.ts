import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { SiteContext, TurnReply, TurnRequest } from "../shared/types.ts";
import type { Ceiling } from "./budget.ts";
import { costOf } from "./prices.ts";
import { buildSystemPrompt, buildUserMessage } from "./prompt.ts";

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
  /** The sentence exactly as the model wrote it, before tidySay. The benchmark compares the two. */
  wrote: string;
  tokens?: { input: number; cacheRead: number; cacheWrite: number; output: number };
  /** What the step cost, in US dollars, worked out from the tokens. */
  usd: number;
}

const Reply = z.object({
  target: z.string().nullable().describe('Id of the element to point at, like "e12", or null'),
  status: z.enum(["continue", "done", "stuck"]),
  say: z.string().describe("One or two short sentences for the visitor"),
});

/** The reply's first field, as soon as it is complete in the text streamed so far. */
const TARGET_SO_FAR = /"target"\s*:\s*(?:"([^"]*)"|null)/;

/**
 * The sentence a visitor reads, tidied: no blank space at either end, and no
 * closing brace left over from the reply's own JSON. Some settings add one.
 * Sonnet with thinking off did in about one reply in eight.
 */
export function tidySay(say: string): string {
  return say.replace(/[\s}]+$/, "").trimStart();
}

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

/**
 * One step, timed. `onTarget` is called once, as soon as the control to point
 * at is known and only if it is on the page the model was shown. The benchmark
 * calls this with the settings it wants to compare.
 */
export async function measureTurn(
  site: SiteContext,
  request: TurnRequest,
  settings: TurnSettings = SETTINGS,
  onTarget?: (id: string) => void,
): Promise<TurnMeasure> {
  const started = Date.now();
  let msToTarget: number | undefined;
  const onPage = (id: string | null): id is string => id !== null && request.snapshot.elements.some((element) => element.id === id);
  const targetKnown = (id: string | null) => {
    if (msToTarget !== undefined) return;
    msToTarget = Date.now() - started;
    if (onPage(id)) onTarget?.(id);
  };

  let answer: Omit<TurnMeasure, "ms" | "msToTarget" | "wrote">;
  if (settings.model === "mock") {
    const reply = mockTurn(request);
    if (mockPauseMs > 0) {
      targetKnown(reply.target);
      await new Promise((resolve) => setTimeout(resolve, mockPauseMs));
    }
    answer = { reply, model: "mock", usd: mockUsd };
  } else answer = await claudeTurn(site, request, settings, targetKnown);
  // The model can only point at what's on the page it was shown.
  if (!onPage(answer.reply.target)) answer.reply.target = null;
  targetKnown(answer.reply.target);
  const wrote = answer.reply.say;
  answer.reply.say = tidySay(wrote);
  return { ...answer, ms: Date.now() - started, msToTarget: msToTarget ?? Date.now() - started, wrote };
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
  targetKnown: (id: string | null) => void,
): Promise<Omit<TurnMeasure, "ms" | "msToTarget" | "wrote">> {
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
  try {
    const stream = client.beta.messages.stream({
      model: settings.model,
      max_tokens: MAX_TOKENS,
      ...fallback,
      ...(settings.thinking === "off" ? withoutThinking(settings.model) : {}),
      output_config: { effort: settings.effort, format: betaZodOutputFormat(Reply) },
      // Rules and site knowledge are the same for every turn on a site, so they're cached.
      system: [{ type: "text", text: buildSystemPrompt(site), cache_control: { type: "ephemeral", ttl: settings.cache } }],
      messages,
    });
    // The reply is JSON with "target" first, so it is the first thing that can be acted on.
    stream.on("text", (_delta, soFar) => {
      const found = TARGET_SO_FAR.exec(soFar);
      if (found) targetKnown(found[1] ?? null);
    });
    stream.on("streamEvent", (_event, soFar) => {
      counted = { usage: soFar.usage, model: soFar.model, stop: soFar.stop_reason };
    });
    response = await stream.finalMessage();
  } catch (error) {
    const paid = counted ? usdOf(counted.usage, counted.model, settings.cache) : 0;
    if (error instanceof Anthropic.AuthenticationError) throw new TurnError(500, "The server's Anthropic credentials are missing or invalid.", paid);
    if (error instanceof Anthropic.RateLimitError) throw new TurnError(503, "The model is rate limited. Try again shortly.", paid);
    if (error instanceof Anthropic.APIError) throw new TurnError(502, `The model call failed (${error.status ?? "no status"}): ${error.message}`, paid);
    // The stream ended and its text could not be read as a reply.
    if (counted) throw new TurnError(502, `The model's reply couldn't be read (stop reason: ${counted.stop ?? "none"}).`, paid);
    throw error;
  }

  const { usage } = response;
  const usd = usdOf(usage, response.model, settings.cache);
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
  if (response.stop_reason === "refusal") return { reply: { target: null, status: "stuck", say: "I can't help with that one." }, model: response.model, tokens, usd };
  if (!response.parsed_output) throw new TurnError(502, `The model's reply couldn't be read (stop reason: ${response.stop_reason}).`, usd);
  return { reply: response.parsed_output, model: response.model, tokens, usd };
}

/**
 * What a call cost. When the provider retried a declined request on another
 * model, it lists each attempt, and the declined one is paid for as well: the
 * top-level count covers only the attempt that answered.
 */
function usdOf(usage: Anthropic.Beta.BetaUsage, model: string, cache: CacheLife): number {
  type Counted = { input_tokens: number | null; cache_read_input_tokens: number | null; cache_creation_input_tokens: number | null; output_tokens: number | null };
  const cost = (part: Counted, by: string) =>
    costOf(by, { input: part.input_tokens ?? 0, cacheRead: part.cache_read_input_tokens ?? 0, cacheWrite: part.cache_creation_input_tokens ?? 0, output: part.output_tokens ?? 0 }, cache);
  if (!usage.iterations?.length) return cost(usage, model);
  return usage.iterations.reduce((sum, attempt) => sum + cost(attempt, ("model" in attempt && attempt.model) || model), 0);
}

/**
 * Stand-in for the model: points at the element whose label shares the most
 * words with the goal, and never at the same label twice. Good enough to test
 * everything around the model, not to guide anyone.
 */
function mockTurn(request: TurnRequest): TurnReply {
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
