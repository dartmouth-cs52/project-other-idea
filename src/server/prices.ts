// What a step costs, worked out from the tokens the provider reports for it.
// The budget in budget.ts is kept in these dollars.

/** US dollars per million tokens. */
interface Price {
  input: number;
  output: number;
  /** Writing the prompt cache, by how long it is kept. */
  write5m: number;
  write1h: number;
  /** Reading it back. */
  read: number;
}

// From platform.claude.com/docs/en/about-claude/pricing, read on 15 November 2026.
// The older models are here because a declined request is retried on one of
// them, and the dearest ones because the price for a model that is missing is
// taken from the top of this table.
const FABLE_52: Price = { input: 8, output: 40, write5m: 10, write1h: 16, read: 0.2 };
const FABLE_51: Price = { input: 10, output: 50, write5m: 12.5, write1h: 20, read: 0.25 };
const FABLE_5: Price = { ...FABLE_51, read: 1 };
const PRICES: Record<string, Price> = {
  "claude-fable-5-2": FABLE_52,
  "claude-mythos-5-2": FABLE_52,
  "claude-fable-5-1": FABLE_51,
  "claude-mythos-5-1": FABLE_51,
  "claude-fable-5": FABLE_5,
  "claude-mythos-5": FABLE_5,
  "claude-opus-5-5": { input: 4, output: 20, write5m: 5, write1h: 8, read: 0.2 },
  "claude-opus-5": { input: 5, output: 25, write5m: 6.25, write1h: 10, read: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, write5m: 6.25, write1h: 10, read: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, write5m: 2.5, write1h: 4, read: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, write5m: 2.5, write1h: 4, read: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, write5m: 0.125, write1h: 0.2, read: 0.01 },
};
/** Haiku costs more once a prompt passes 100,000 tokens. */
const HAIKU_LONG: Price = { input: 0.5, output: 2.5, write5m: 0.625, write1h: 1, read: 0.05 };
const HAIKU_LONG_FROM = 100_000;
/**
 * A model that is not in the table is priced at the highest price in it for
 * each kind of token, so a mistake here stops a site early and never late.
 */
const top = (field: keyof Price) => Math.max(...Object.values(PRICES).map((price) => price[field]));
const DEAREST: Price = { input: top("input"), output: top("output"), write5m: top("write5m"), write1h: top("write1h"), read: top("read") };

export interface StepTokens {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** What one step cost, in US dollars. The stand-in model costs nothing. */
export function costOf(model: string, tokens: StepTokens | undefined, cache: "5m" | "1h"): number {
  if (model === "mock" || !tokens) return 0;
  // The ID exactly, or with a date after it, as some IDs carry. Anything else, a newer model whose ID
  // only starts like one here among them ("claude-opus-5-6"), is priced at the top of the table.
  const name = Object.keys(PRICES).find((known) => model === known || (model.startsWith(`${known}-`) && /^\d{8}$/.test(model.slice(known.length + 1))));
  let price = name ? PRICES[name]! : DEAREST;
  if (name === "claude-haiku-5-5" && tokens.input + tokens.cacheRead + tokens.cacheWrite > HAIKU_LONG_FROM) price = HAIKU_LONG;
  const write = cache === "1h" ? price.write1h : price.write5m;
  return (tokens.input * price.input + tokens.cacheRead * price.read + tokens.cacheWrite * write + tokens.output * price.output) / 1_000_000;
}
