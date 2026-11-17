import { DEFAULT_CACHE, type TurnSettings } from "../src/server/model.ts";

// How a model and its settings are written on the command line, for both benchmarks.

/** "claude-haiku-5-5@off" is Haiku with no thinking. After @: low, medium or high for effort, and off for no thinking. */
export function parseModel(spec: string): { name: string; settings: TurnSettings } {
  const [model = "", ...flags] = spec.trim().split("@");
  const settings: TurnSettings = { model, effort: "low", thinking: "default", cache: DEFAULT_CACHE };
  for (const flag of flags) {
    if (flag === "low" || flag === "medium" || flag === "high") settings.effort = flag;
    else if (flag === "off") settings.thinking = "off";
    else throw new Error(`"${flag}" in "${spec}" isn't a setting. Use low, medium, high or off.`);
  }
  if (!model) throw new Error("A model is missing from --models.");
  return { name: spec.trim(), settings };
}

export const percent = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "n/a");
/** The value a given share of the way through a sorted list: 0.5 for the middle one. */
export const middle = (sorted: number[], share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
