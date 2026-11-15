import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { SiteContext, TurnReply, TurnRequest } from "../shared/types.ts";
import { buildSystemPrompt, buildUserMessage } from "./prompt.ts";

// One model call per step. HAPTIC_MODEL picks the model, or "mock" for a
// keyword matcher that needs no API key.

export const MODEL = process.env.HAPTIC_MODEL || "claude-opus-5-5";

type Effort = "low" | "medium" | "high";

/** How a step is asked for. The server reads these from the environment, and the benchmark tries several. */
export interface TurnSettings {
  /** Any Claude model ID, or "mock". */
  model: string;
  effort: Effort;
  /** "off" asks for no thinking before the answer, on the models that allow it. */
  thinking: "default" | "off";
}

const EFFORTS: readonly string[] = ["low", "medium", "high"];

export const SETTINGS: TurnSettings = {
  model: MODEL,
  // Each step is a small decision and the visitor is waiting on it, so the least effort is the default.
  effort: EFFORTS.includes(process.env.HAPTIC_EFFORT ?? "") ? (process.env.HAPTIC_EFFORT as Effort) : "low",
  thinking: process.env.HAPTIC_THINKING === "off" ? "off" : "default",
};

/** A step's reply, with what it took to get. */
export interface TurnMeasure {
  reply: TurnReply;
  /** The model that answered. After a fallback it is not the one asked for. */
  model: string;
  ms: number;
  tokens?: { input: number; cacheRead: number; cacheWrite: number; output: number };
}

const Reply = z.object({
  target: z.string().nullable().describe('Id of the element to point at, like "e12", or null'),
  status: z.enum(["continue", "done"]),
  say: z.string().describe("One or two short sentences for the visitor"),
});

/** Thrown for failures the visitor's browser should hear about with a specific status. */
export class TurnError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let client: Anthropic | undefined;

export async function runTurn(site: SiteContext, request: TurnRequest): Promise<TurnReply> {
  return (await measureTurn(site, request)).reply;
}

/** One step, timed. The benchmark calls this with the settings it wants to compare. */
export async function measureTurn(site: SiteContext, request: TurnRequest, settings: TurnSettings = SETTINGS): Promise<TurnMeasure> {
  const started = Date.now();
  const answer = settings.model === "mock" ? { reply: mockTurn(request), model: "mock" } : await claudeTurn(site, request, settings);
  // The model can only point at what's on the page it was shown.
  if (answer.reply.target && !request.snapshot.elements.some((element) => element.id === answer.reply.target)) answer.reply.target = null;
  return { ...answer, ms: Date.now() - started };
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

async function claudeTurn(site: SiteContext, request: TurnRequest, settings: TurnSettings): Promise<Omit<TurnMeasure, "ms">> {
  client ??= new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = request.history.map((turn) => ({ role: turn.role, content: turn.text }));
  // The conversation has to start with a user message.
  while (messages[0]?.role === "assistant") messages.shift();
  messages.push({ role: "user", content: buildUserMessage(request) });

  // If the model declines a request on policy grounds, the API retries it on a
  // fallback model inside the same call. Haiku has no server-side fallback.
  const fallback = settings.model.includes("haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

  const started = Date.now();
  let response;
  try {
    response = await client.beta.messages.parse({
      model: settings.model,
      max_tokens: 4000,
      ...fallback,
      ...(settings.thinking === "off" ? withoutThinking(settings.model) : {}),
      output_config: { effort: settings.effort, format: betaZodOutputFormat(Reply) },
      // Rules and site knowledge are the same for every turn on a site, so they're cached.
      system: [{ type: "text", text: buildSystemPrompt(site), cache_control: { type: "ephemeral" } }],
      messages,
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new TurnError(500, "The server's Anthropic credentials are missing or invalid.");
    if (error instanceof Anthropic.RateLimitError) throw new TurnError(503, "The model is rate limited. Try again shortly.");
    if (error instanceof Anthropic.APIError) throw new TurnError(502, `The model call failed (${error.status ?? "no status"}): ${error.message}`);
    throw error;
  }

  const { usage } = response;
  console.log(
    `turn ${site.id} step ${request.step}: ${Date.now() - started} ms, ${response.model}, ` +
      `input ${usage.input_tokens}, cache read ${usage.cache_read_input_tokens ?? 0}, output ${usage.output_tokens}`,
  );

  const tokens = {
    input: usage.input_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    output: usage.output_tokens,
  };
  if (response.stop_reason === "refusal") return { reply: { target: null, status: "done", say: "I can't help with that one." }, model: response.model, tokens };
  if (!response.parsed_output) throw new TurnError(502, `The model's reply couldn't be read (stop reason: ${response.stop_reason}).`);
  return { reply: response.parsed_output, model: response.model, tokens };
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
  if (!best) return { target: null, status: "done", say: request.step ? "That should be it." : "I don't see that on this page." };
  return { target: best.id, status: "continue", say: `${strayed ? "Not that one. " : ""}Click ${best.label}.` };
}
