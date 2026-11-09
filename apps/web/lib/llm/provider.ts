import type { Prompt, TurnRequest } from "@haptic/protocol";
import { env } from "../env";

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ModelStream {
  /** Text deltas as the model writes them. */
  text: AsyncIterable<string>;
  /** Token counts, available once the stream has finished. */
  usage(): ModelUsage;
}

export interface Provider {
  model: string;
  stream(prompt: Prompt, request: TurnRequest, signal: AbortSignal): ModelStream;
}

export const MAX_OUTPUT_TOKENS = 300;

export async function getProvider(model = env.model): Promise<Provider> {
  if (model === "mock") {
    const { MockProvider } = await import("./mock");
    return new MockProvider();
  }
  if (model.startsWith("claude-")) {
    const { ClaudeProvider } = await import("./claude");
    return new ClaudeProvider(model);
  }
  const { GeminiProvider } = await import("./gemini");
  return new GeminiProvider(model);
}
