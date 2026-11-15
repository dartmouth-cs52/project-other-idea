import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../src/server/db.ts";
import type { TurnMeasure } from "../src/server/model.ts";
import type { TurnRequest } from "../src/shared/types.ts";

// These check what the server sends to the database, with a stand-in for the
// query function. They do not check that Postgres accepts it: that takes a
// database, which the tests do not have.

interface Sent {
  text: string;
  values: unknown[];
}

/** Stands in for Neon's query function. `refuse` makes any statement that matches it fail, as a missing column would. */
function standIn(refuse?: RegExp) {
  const sent: Sent[] = [];
  const run = (query: Sent) => {
    sent.push(query);
    if (refuse?.test(query.text)) throw new Error('column "usd" of relation "steps" does not exist');
  };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query: Sent = { text: strings.join("?").replace(/\s+/g, " ").trim(), values };
    // Neon's queries are sent when awaited, or all together by transaction().
    return { query, then: (done: (rows: unknown[]) => unknown, failed: (error: unknown) => unknown) => Promise.resolve().then(() => run(query)).then(() => done([]), failed) };
  };
  sql.transaction = async (queries: { query: Sent }[]) => queries.map(({ query }) => run(query));
  return { sql: sql as unknown as ConstructorParameters<typeof Store>[0], sent };
}

const GUIDE = "0b6f2c1e-6a1d-4c3e-9f2a-3d4c5b6a7e8f";
const request: TurnRequest = {
  site: "site_test",
  guide: GUIDE,
  goal: "open billing",
  step: 2,
  history: [],
  snapshot: { path: "/", title: "Home", headings: [], text: [], truncated: false, elements: [{ id: "e1", role: "link", label: "Billing" }] },
};
const measure: TurnMeasure = {
  reply: { target: "e1", status: "continue", say: "Click Billing." },
  model: "claude-sonnet-5-5",
  ms: 1400,
  msToTarget: 800,
  wrote: "Click Billing.",
  broke: [],
  cited: [],
  tokens: { input: 600, cacheRead: 24_000, cacheWrite: 0, output: 150 },
  usd: 0.0051,
};

test("a step's tokens and cost are added to its row, after the step itself is written", async () => {
  const { sql, sent } = standIn();
  await new Store(sql).recordStep(request, measure, "https://app.test");
  assert.equal(sent.length, 3);
  assert.match(sent[0]!.text, /^insert into guides/);
  assert.match(sent[1]!.text, /^insert into steps/);
  assert.match(sent[2]!.text, /^update steps set input_tokens = \?, cache_read_tokens = \?, cache_write_tokens = \?, output_tokens = \?, usd = \?, broke = \? where guide_id = \? and n = \?$/);
  assert.deepEqual(sent[2]!.values, [600, 24_000, 0, 150, 0.0051, [], GUIDE, 2]);
});

test("a database without the cost columns still gets the step", async () => {
  const { sql, sent } = standIn(/^update steps/);
  const errors: unknown[][] = [];
  const logged = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    // It must not throw: nothing here may cost a visitor their step.
    await new Store(sql).recordStep(request, measure, undefined);
  } finally {
    console.error = logged;
  }
  assert.deepEqual(sent.map((query) => query.text.split(" ").slice(0, 3).join(" ")), ["insert into guides", "insert into steps", "update steps set"]);
  assert.match(String(errors[0]?.[0]), /0004/);
});

test("the stand-in model has no cost to record, and a broken rule is recorded even so", async () => {
  const free = standIn();
  await new Store(free.sql).recordStep(request, { ...measure, model: "mock", tokens: undefined, usd: 0 }, undefined);
  assert.equal(free.sent.length, 2);

  const broke = standIn();
  await new Store(broke.sql).recordStep(request, { ...measure, model: "mock", tokens: undefined, usd: 0, broke: ["link"] }, undefined);
  assert.deepEqual(broke.sent[2]!.values, [null, null, null, null, null, ["link"], GUIDE, 2]);
});

test("on a site with Answers, the kind of reply and the docs it rested on are added too", async () => {
  const { sql, sent } = standIn();
  const answer: TurnMeasure = {
    ...measure,
    reply: { target: null, status: "done", say: "The link works for 7 days.", mode: "answer", sources: [{ title: "Inviting teammates" }] },
    cited: ["help/inviting.md"],
  };
  await new Store(sql).recordStep(request, answer, undefined);
  assert.equal(sent.length, 4);
  assert.match(sent[3]!.text, /^update steps set mode = \?, reason = \?, sources = \?, overruled = \? where guide_id = \? and n = \?$/);
  assert.deepEqual(sent[3]!.values, ["answer", null, ["help/inviting.md"], null, GUIDE, 2]);

  const declined = standIn();
  await new Store(declined.sql).recordStep(request, { ...measure, reply: { target: null, status: "done", say: "The help docs don't cover that.", mode: "cannot_help", reason: "not_covered" }, overruled: "no_source" }, undefined);
  assert.deepEqual(declined.sent[3]!.values, ["cannot_help", "not_covered", [], "no_source", GUIDE, 2]);
});

test("a control an answer named that is nowhere in the product is recorded with the step", async () => {
  const { sql, sent } = standIn();
  const stale: TurnMeasure = {
    ...measure,
    reply: { target: null, status: "done", say: "Open the project and press Archive project.", mode: "answer", sources: [{ title: "Archiving" }], missing: ["Archive project"] },
    cited: ["help/archiving.md"],
    unseen: ["Archive project"],
  };
  await new Store(sql).recordStep(request, stale, undefined);
  assert.equal(sent.length, 5);
  assert.match(sent[4]!.text, /^update steps set unseen = \? where guide_id = \? and n = \?$/);
  assert.deepEqual(sent[4]!.values, [["Archive project"], GUIDE, 2]);
});
