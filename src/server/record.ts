import { appendFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { TurnRequest } from "../shared/types.ts";
import type { TurnMeasure } from "./model.ts";

// With HAPTIC_RECORD=1, every step is appended to data/recordings/<site>.jsonl:
// what the widget sent and what came back. Those lines are the raw material for
// benchmark cases (see eval/README.md), and they show how often questions repeat.
// It is off unless asked for, because a step holds a visitor's question and the
// labels on the page they were looking at.

export const RECORDINGS_DIR = fileURLToPath(new URL("../../data/recordings/", import.meta.url));
const RECORDING = process.env.HAPTIC_RECORD === "1";

/** Never throws: a failed write must not cost the visitor their step. */
export async function recordTurn(request: TurnRequest, measure: TurnMeasure): Promise<void> {
  if (!RECORDING) return;
  try {
    await mkdir(RECORDINGS_DIR, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), request, reply: measure.reply, model: measure.model, ms: measure.ms, tokens: measure.tokens });
    await appendFile(`${RECORDINGS_DIR}${request.site}.jsonl`, line + "\n");
  } catch (error) {
    console.error(`Couldn't record a step for ${request.site}:`, error);
  }
}
