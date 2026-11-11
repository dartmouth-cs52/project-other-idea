import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { SiteContext, TurnReply, TurnRequest } from "../shared/types.ts";
import { buildSystemPrompt, buildUserMessage } from "./prompt.ts";

// One model call per step. HAPTIC_MODEL picks the model, or "mock" for a
// keyword matcher that needs no API key.

export const MODEL = process.env.HAPTIC_MODEL || "claude-opus-5-5";

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
  const reply = MODEL === "mock" ? mockTurn(request) : await claudeTurn(site, request);
  // The model can only point at what's on the page it was shown.
  if (reply.target && !request.snapshot.elements.some((element) => element.id === reply.target)) reply.target = null;
  return reply;
}

async function claudeTurn(site: SiteContext, request: TurnRequest): Promise<TurnReply> {
  client ??= new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = request.history.map((turn) => ({ role: turn.role, content: turn.text }));
  // The conversation has to start with a user message.
  while (messages[0]?.role === "assistant") messages.shift();
  messages.push({ role: "user", content: buildUserMessage(request) });

  // If the model declines a request on policy grounds, the API retries it on a
  // fallback model inside the same call. Haiku has no server-side fallback.
  const fallback = MODEL.includes("haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

  const started = Date.now();
  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      ...fallback,
      // Each step is a small decision and the visitor is waiting on it.
      output_config: { effort: "low", format: betaZodOutputFormat(Reply) },
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

  if (response.stop_reason === "refusal") return { target: null, status: "done", say: "I can't help with that one." };
  if (!response.parsed_output) throw new TurnError(502, `The model's reply couldn't be read (stop reason: ${response.stop_reason}).`);
  return response.parsed_output;
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
  let best: { id: string; label: string; score: number } | undefined;
  for (const element of request.snapshot.elements) {
    if (!element.label || element.state?.includes("disabled") || used.includes(`Click ${element.label}.`)) continue;
    const score = words(element.label).filter((word) => goal.has(word)).length;
    if (score > (best?.score ?? 0)) best = { id: element.id, label: element.label, score };
  }
  if (!best) return { target: null, status: "done", say: request.step ? "That should be it." : "I don't see that on this page." };
  return { target: best.id, status: "continue", say: `Click ${best.label}.` };
}
