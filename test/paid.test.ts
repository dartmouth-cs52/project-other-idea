import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryBudget } from "../src/server/budget.ts";
import { DEFAULT_APPEARANCE, STREAM_TYPE, type SiteContext } from "../src/shared/types.ts";

// What reaches a site's budget when the model was really called. The real
// provider library runs here, with the network under it swapped for a function
// that plays back a streamed reply, so nothing leaves the process and no key
// is needed.
process.env.HAPTIC_MODEL = "claude-sonnet-5-5";
process.env.ANTHROPIC_API_KEY = "not-a-key";

interface Counted {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}
interface Play {
  text: string;
  stop: string;
  usage: Counted;
  model?: string;
  /** Each attempt the provider made, when a declined request was retried on another model. */
  attempts?: (Counted & { type: string; model: string | null })[];
  /** Break the connection after the text, before the provider has said how much was written. */
  breaks?: boolean;
}
let play: Play;

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  assert.ok(url.includes("/v1/messages"), `an unexpected call to ${url}`);
  const { text, stop, usage, model = "claude-sonnet-5-5", attempts, breaks } = play;
  const encoder = new TextEncoder();
  const event = (name: string, data: unknown) => encoder.encode(`event: ${name}\ndata: ${JSON.stringify({ type: name, ...(data as object) })}\n\n`);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(event("message_start", { message: { id: "msg_played", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } }));
      controller.enqueue(event("content_block_start", { index: 0, content_block: { type: "text", text: "" } }));
      controller.enqueue(event("content_block_delta", { index: 0, delta: { type: "text_delta", text } }));
      // An error drops whatever has not been read yet, so the break comes once the reader has had the rest.
      if (breaks) return void setTimeout(() => controller.error(new TypeError("terminated")), 20);
      controller.enqueue(event("content_block_stop", { index: 0 }));
      controller.enqueue(event("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output_tokens, ...(attempts ? { iterations: attempts } : {}) } }));
      controller.enqueue(event("message_stop", {}));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_played" } });
}) as typeof fetch;

const { createApp } = await import("../src/server/app.ts");

const site: SiteContext = {
  version: 1,
  id: "site_test",
  name: "Test",
  origin: "https://app.test",
  allowedOrigins: ["https://app.test"],
  appearance: DEFAULT_APPEARANCE,
  notes: "",
  docs: [],
  pages: [],
  source: { url: "https://app.test", maxPages: 1, docs: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const turn = (headers: Record<string, string> = {}) =>
  new Request("https://widget.test/v1/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://app.test", ...headers },
    body: JSON.stringify({ site: site.id, goal: "open billing", step: 0, history: [], snapshot: { path: "/", title: "Home", headings: [], text: [], truncated: false, elements: [{ id: "e1", role: "link", label: "Billing" }] } }),
  });

/** An app whose budget notes every settlement. */
function appWithBudget() {
  const memory = new MemoryBudget({});
  const settled: { usd: number; steps: number }[] = [];
  const pending: Promise<unknown>[] = [];
  const app = createApp({
    loadSite: async () => site,
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit: () => false,
    background: (work) => void pending.push(work),
    budget: {
      admit: (asked, caller, ceiling) => memory.admit(asked, caller, ceiling),
      settle: (asked, caller, hold, usd, steps) => {
        settled.push({ usd, steps });
        return memory.settle(asked, caller, hold, usd, steps);
      },
    },
  });
  return { app, settled, done: () => Promise.all(pending) };
}

const near = (actual: number | undefined, expected: number) => assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
const quietly = async <T>(work: () => Promise<T>): Promise<T> => {
  const { log, error } = console;
  console.log = console.error = () => {};
  try {
    return await work();
  } finally {
    Object.assign(console, { log, error });
  }
};

test("a step is added to the budget at what its tokens cost", async () => {
  const { app, settled, done } = appWithBudget();
  // A cold cache: 600 fresh tokens, 24,000 written for an hour, 150 out.
  play = { text: '{"target":"e1","status":"continue","say":"Click Billing."}', stop: "end_turn", usage: { input_tokens: 600, cache_creation_input_tokens: 24_000, cache_read_input_tokens: 0, output_tokens: 150 } };
  const reply = await quietly(async () => (await app(turn(), "1.1.1.1"))?.json());
  await done();
  assert.equal(reply.say, "Click Billing.");
  assert.equal(settled.length, 1);
  near(settled[0]?.usd, (600 * 2 + 24_000 * 4 + 150 * 10) / 1e6);
  assert.equal(settled[0]?.steps, 1);
});

test("a reply cut off at its length limit is paid for, so it is added to the budget", async () => {
  const { app, settled, done } = appWithBudget();
  // 4,000 tokens of output and the JSON never closes. The visitor gets an error, and the provider still counts every token.
  play = { text: '{"target":"e1","status":"continue","say":"Click Billing and then ' + "keep going ".repeat(40), stop: "max_tokens", usage: { input_tokens: 600, cache_creation_input_tokens: 0, cache_read_input_tokens: 24_000, output_tokens: 4000 } };
  const cost = (600 * 2 + 24_000 * 0.1 + 4000 * 10) / 1e6;

  const plain = await quietly(async () => app(turn(), "1.1.1.1"));
  assert.equal(plain?.status, 502);
  assert.match((await plain?.json()).error, /couldn't be read \(stop reason: max_tokens\)/);

  const streamed = await quietly(async () => (await app(turn({ Accept: STREAM_TYPE }), "1.1.1.1"))?.text());
  assert.match(streamed ?? "", /"code":502/);

  await done();
  assert.equal(settled.length, 2);
  for (const one of settled) {
    near(one.usd, cost);
    // It is not counted as a step the visitor took.
    assert.equal(one.steps, 0);
  }
});

test("a reply that breaks off part-way is counted for what it had written", async () => {
  const { app, settled, done } = appWithBudget();
  // 2,500 characters of a reply arrive, then the connection drops. The provider had only counted one token of output.
  const text = '{"target":"e1","status":"continue","say":"' + "x".repeat(2500);
  play = { text, stop: "end_turn", breaks: true, usage: { input_tokens: 600, cache_creation_input_tokens: 0, cache_read_input_tokens: 24_000, output_tokens: 1 } };
  await quietly(async () => app(turn(), "1.1.1.1"));
  await done();
  assert.equal(settled.length, 1);
  assert.equal(settled[0]?.steps, 0);
  // At least a token for every two and a half characters, the same cautious count the ceiling uses.
  const output = Math.ceil(text.length / 2.5);
  near(settled[0]?.usd, (600 * 2 + 24_000 * 0.1 + output * 10) / 1e6);
});

test("an attempt that does not name its model is priced as the model asked for", async () => {
  const { app, settled, done } = appWithBudget();
  const declined = { type: "message", model: null, input_tokens: 600, cache_creation_input_tokens: 0, cache_read_input_tokens: 24_000, output_tokens: 0 };
  const served = { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 600, cache_creation_input_tokens: 24_000, cache_read_input_tokens: 0, output_tokens: 150 };
  play = {
    text: '{"target":"e1","status":"continue","say":"Click Billing."}',
    stop: "end_turn",
    model: "claude-opus-4-8",
    usage: { input_tokens: 600, cache_creation_input_tokens: 24_000, cache_read_input_tokens: 0, output_tokens: 150 },
    attempts: [declined, served],
  };
  await quietly(async () => (await app(turn(), "1.1.1.1"))?.json());
  await done();
  // The declined attempt is Sonnet 5.5's, the model the server asked for, and not Opus 4.8's.
  near(settled[0]?.usd, (600 * 2 + 24_000 * 0.1) / 1e6 + (600 * 5 + 24_000 * 10 + 150 * 25) / 1e6);
});

test("when a declined request is retried on another model, both attempts are added", async () => {
  const { app, settled, done } = appWithBudget();
  // Sonnet read the prompt and declined. Opus then wrote the prompt to its own cache and answered.
  const declined = { type: "message", model: "claude-sonnet-5-5", input_tokens: 600, cache_creation_input_tokens: 0, cache_read_input_tokens: 24_000, output_tokens: 0 };
  const served = { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 600, cache_creation_input_tokens: 24_000, cache_read_input_tokens: 0, output_tokens: 150 };
  play = {
    text: '{"target":"e1","status":"continue","say":"Click Billing."}',
    stop: "end_turn",
    model: "claude-opus-4-8",
    // The top-level count covers only the attempt that answered.
    usage: { input_tokens: 600, cache_creation_input_tokens: 24_000, cache_read_input_tokens: 0, output_tokens: 150 },
    attempts: [declined, served],
  };
  await quietly(async () => (await app(turn(), "1.1.1.1"))?.json());
  await done();
  near(settled[0]?.usd, (600 * 2 + 24_000 * 0.1) / 1e6 + (600 * 5 + 24_000 * 10 + 150 * 25) / 1e6);
});
