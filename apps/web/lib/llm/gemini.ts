import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { Prompt } from "@haptic/protocol";
import { env } from "../env";
import { MAX_OUTPUT_TOKENS, type ModelStream, type ModelUsage, type Provider } from "./provider";

let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  if (!env.geminiApiKey) throw new Error("GEMINI_API_KEY is not set");
  client ??= new GoogleGenAI({ apiKey: env.geminiApiKey });
  return client;
}

/** Lowest thinking level each model accepts. Thinking delays the first token. */
function thinkingLevelFor(model: string): ThinkingLevel {
  const configured = process.env.HAPTIC_THINKING_LEVEL?.toUpperCase();
  if (configured && configured in ThinkingLevel) return ThinkingLevel[configured as keyof typeof ThinkingLevel];
  return model.includes("flash-lite") ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;
}

export class GeminiProvider implements Provider {
  constructor(readonly model: string) {}

  stream(prompt: Prompt, _request: unknown, signal: AbortSignal): ModelStream {
    let usage: ModelUsage = {};
    const model = this.model;
    async function* text() {
      const response = await getClient().models.generateContentStream({
        model,
        contents: prompt.messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.text }],
        })),
        config: {
          systemInstruction: prompt.system,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingLevel: thinkingLevelFor(model) },
          abortSignal: signal,
        },
      });
      for await (const chunk of response) {
        if (chunk.usageMetadata) {
          usage = {
            inputTokens: chunk.usageMetadata.promptTokenCount,
            outputTokens: chunk.usageMetadata.candidatesTokenCount,
          };
        }
        const delta = chunk.text;
        if (delta) yield delta;
      }
    }
    return { text: text(), usage: () => usage };
  }
}
