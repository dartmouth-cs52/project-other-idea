import Anthropic from "@anthropic-ai/sdk";
import type { Prompt } from "@haptic/protocol";
import { env } from "../env";
import { MAX_OUTPUT_TOKENS, type ModelStream, type ModelUsage, type Provider } from "./provider";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!env.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  // Set the base URL explicitly so a shell-level ANTHROPIC_BASE_URL (used by
  // other tools) doesn't silently reroute Haptic's traffic.
  client ??= new Anthropic({
    apiKey: env.anthropicApiKey,
    baseURL: process.env.HAPTIC_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
  });
  return client;
}

export class ClaudeProvider implements Provider {
  constructor(readonly model: string) {}

  stream(prompt: Prompt, _request: unknown, signal: AbortSignal): ModelStream {
    let usage: ModelUsage = {};
    const model = this.model;
    async function* text() {
      const stream = getClient().messages.stream(
        {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
          messages: prompt.messages.map((message) => ({ role: message.role, content: message.text })),
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
      }
      const final = await stream.finalMessage();
      usage = { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens };
    }
    return { text: text(), usage: () => usage };
  }
}
