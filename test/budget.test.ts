import assert from "node:assert/strict";
import { test } from "node:test";
import { admit, DEFAULT_LIMITS, describeAlert, emptyMeter, limitsFor, MemoryBudget, settle, type Ceiling, type Limits } from "../src/server/budget.ts";
import { configure } from "../src/server/model.ts";
import { costOf } from "../src/server/prices.ts";
import { DEFAULT_APPEARANCE, STREAM_TYPE, type SiteContext } from "../src/shared/types.ts";

// The stand-in model, so these run with no API key. See turn.test.ts.
process.env.HAPTIC_MODEL = "mock";
const { createApp, FIXED_SAY } = await import("../src/server/app.ts");

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

const limits: Limits = { hour: 1, day: 3 };
const at = (time: string) => new Date(`2026-11-15T${time}Z`);
/** Nothing set aside, for the tests that are about what was spent. */
const FREE: Ceiling = { cold: 0, warm: 0 };
/** What is set aside at the moment, step by step. */
const held = (state: ReturnType<typeof emptyMeter>) => state.holds.map((hold) => hold.usd);
/** Only asks: what `admit` says, with nothing left set aside. */
const ask = (state: ReturnType<typeof emptyMeter>, by: Limits, caller: string, when: Date) => admit(state, by, caller, FREE, when).gate;

test("a step is priced from its tokens, and an unknown model is priced at the top of the table", () => {
  const tokens = { input: 600, cacheRead: 24_000, cacheWrite: 0, output: 150 };
  // The research report's warm answer on Sonnet: about half a cent.
  assert.ok(Math.abs(costOf("claude-sonnet-5-5", tokens, "1h") - 0.0051) < 0.0001);
  // The same answer on a cold cache, written for an hour: about ten cents.
  const cold = { input: 600, cacheRead: 0, cacheWrite: 24_000, output: 150 };
  assert.ok(Math.abs(costOf("claude-sonnet-5-5", cold, "1h") - 0.0987) < 0.0001);
  assert.ok(Math.abs(costOf("claude-sonnet-5-5", cold, "5m") - 0.0627) < 0.0001);
  assert.equal(costOf("mock", tokens, "1h"), 0);
  // Haiku's price steps up once the prompt passes 100,000 tokens.
  const long = { input: 1000, cacheRead: 100_000, cacheWrite: 0, output: 0 };
  assert.ok(costOf("claude-haiku-5-5", long, "1h") > 5 * costOf("claude-haiku-5-5", { ...long, cacheRead: 98_000 }, "1h") * 0.9);

  // A million tokens in and a million out, at list price.
  const million = { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 1_000_000 };
  assert.equal(costOf("claude-fable-5-2", million, "1h"), 48);
  assert.equal(costOf("claude-fable-5-1", million, "1h"), 60);
  assert.equal(costOf("claude-fable-5", million, "1h"), 60);
  assert.equal(costOf("claude-mythos-5-1", million, "1h"), 60);
  // A model the table does not know is never priced below one it does, whatever the mix of tokens.
  const known = ["claude-fable-5-2", "claude-fable-5-1", "claude-fable-5", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
  for (const mix of [tokens, cold, million, { input: 0, cacheRead: 1_000_000, cacheWrite: 0, output: 0 }]) {
    for (const cache of ["5m", "1h"] as const) {
      for (const model of known) assert.ok(costOf("claude-something-new", mix, cache) >= costOf(model, mix, cache), `${model} ${cache}`);
    }
  }
});

test("a site is stopped at its hourly limit, and starts again when the hour turns", () => {
  const state = emptyMeter();
  assert.deepEqual(settle(state, limits, "", undefined, 0.4, 1, at("10:05")).gate, { open: true });
  assert.deepEqual(settle(state, limits, "", undefined, 0.6, 1, at("10:20")).gate, { open: false, why: "hour" });
  assert.deepEqual(ask(state, limits, "", at("10:59")), { open: false, why: "hour" });
  assert.deepEqual(ask(state, limits, "", at("11:00")), { open: true });
  assert.equal(state.daySpent, 1);
});

test("the daily limit holds across hours", () => {
  const state = emptyMeter();
  for (const hour of ["08", "09", "10"]) settle(state, limits, "", undefined, 0.99, 1, at(`${hour}:00`));
  assert.deepEqual(settle(state, limits, "", undefined, 0.1, 1, at("11:00")).gate, { open: false, why: "day" });
  assert.deepEqual(ask(state, limits, "", new Date("2026-11-16T00:00:00Z")), { open: true });
});

test("steps that arrive together are counted against what is left, not all let through on one reading", () => {
  // Twenty steps at once, each of which could cost 60 cents, against a dollar an hour.
  const state = emptyMeter();
  const ceiling: Ceiling = { cold: 0.6, warm: 0.6 };
  const admitted = Array.from({ length: 20 }, () => admit(state, limits, "", ceiling, at("10:00:00")));
  const through = admitted.filter((one) => one.gate.open);
  assert.equal(through.length, 2);
  assert.deepEqual(admitted[2]?.gate, { open: false, why: "hour" });
  // They end and are paid for. The site is over by less than one step, where it was over by eleven dollars.
  for (const one of through) settle(state, limits, "", one.hold, 0.6, 1, at("10:00:03"));
  assert.ok(Math.abs(state.hourSpent - 1.2) < 1e-9);
  assert.deepEqual(held(state), []);
  assert.deepEqual(ask(state, limits, "", at("10:00:04")), { open: false, why: "hour" });
});

test("what is set aside for a step is swapped for what it cost, and given back if it never ends", () => {
  const state = emptyMeter();
  const ceiling: Ceiling = { cold: 0.9, warm: 0.2 };
  // The first step of the day holds the cold price: nothing has been written to the provider's cache yet.
  const first = admit(state, limits, "", ceiling, at("10:00:00"));
  assert.deepEqual(held(state), [0.9]);
  // It cost far less. The rest is free again.
  settle(state, limits, "", first.hold, 0.1, 1, at("10:00:02"));
  assert.deepEqual(held(state), []);
  assert.ok(Math.abs(state.hourSpent - 0.1) < 1e-9);
  // A step soon after one that was paid for holds the warm price.
  const second = admit(state, limits, "", ceiling, at("10:01:00"));
  assert.deepEqual(held(state), [0.2]);
  // A step that failed is settled with nothing, and what it held comes back.
  settle(state, limits, "", second.hold, 0, 0, at("10:01:01"));
  assert.deepEqual(held(state), []);
  // After ten quiet minutes the cache may be gone, so the cold price is held again.
  admit(state, limits, "", ceiling, at("10:12:00"));
  assert.deepEqual(held(state), [0.9]);
  // Its server stopped and it was never settled. Two minutes on, it no longer counts.
  assert.deepEqual(ask(state, limits, "", at("10:13:00")), { open: false, why: "hour" });
  assert.deepEqual(ask(state, limits, "", at("10:14:01")), { open: true });
});

test("a step dearer than the whole limit still runs, one at a time", () => {
  const state = emptyMeter();
  const ceiling: Ceiling = { cold: 5, warm: 5 };
  const one = admit(state, limits, "", ceiling, at("10:00"));
  assert.deepEqual(one.gate, { open: true });
  assert.equal(admit(state, limits, "", ceiling, at("10:00")).gate.open, false);
  settle(state, limits, "", one.hold, 0.01, 1, at("10:00"));
  assert.deepEqual(admit(state, limits, "", ceiling, at("10:00")).gate, { open: true });
});

test("an alert goes out once at half, four fifths and all of a limit", () => {
  const state = emptyMeter();
  const levels = (usd: number, time: string) => settle(state, limits, "", undefined, usd, 1, at(time)).alerts.map((alert) => `${alert.window}:${alert.level}`);
  assert.deepEqual(levels(0.3, "10:00"), []);
  assert.deepEqual(levels(0.3, "10:01"), ["hour:50"]);
  assert.deepEqual(levels(0.1, "10:02"), []);
  // One step that passes two levels reports the higher one only.
  assert.deepEqual(levels(0.4, "10:03"), ["hour:100"]);
  // A new hour can alert again, and by now the day has passed its own half.
  assert.deepEqual(levels(0.5, "11:00"), ["hour:50", "day:50"]);
  // What is only set aside sets off no alert.
  const fresh = emptyMeter();
  admit(fresh, limits, "", { cold: 0.9, warm: 0.9 }, at("10:00"));
  assert.deepEqual(settle(fresh, limits, "", undefined, 0.01, 1, at("10:00")).alerts, []);
  assert.match(describeAlert(site, { window: "hour", level: 80, spent: 0.8, limit: 1 }), /site_test \(Test\) has used 80% of its hourly budget \(\$0\.80 of \$1\.00\)/);
  assert.match(describeAlert(site, { window: "day", level: 100, spent: 3, limit: 3 }), /reached its daily budget of \$3\.00 and is resting until the next day/);
});

test("one visitor can be given a number of steps a day, without stopping the others", () => {
  const state = emptyMeter();
  const each: Limits = { ...limits, perCaller: 2 };
  settle(state, each, "ann", undefined, 0, 1, at("10:00"));
  // Her second step is under way. A third beside it does not get through.
  const second = admit(state, each, "ann", FREE, at("10:01"));
  assert.deepEqual(second.gate, { open: true });
  assert.deepEqual(admit(state, each, "ann", FREE, at("10:01")).gate, { open: false, why: "caller" });
  assert.deepEqual(settle(state, each, "ann", second.hold, 0, 1, at("10:01")).gate, { open: false, why: "caller" });
  const other = admit(state, each, "bo", FREE, at("10:02"));
  assert.deepEqual(other.gate, { open: true });
  settle(state, each, "bo", other.hold, 0, 0, at("10:02"));
  assert.deepEqual(ask(state, each, "ann", new Date("2026-11-16T09:00:00Z")), { open: true });
  assert.deepEqual(state.callers, {});
});

test("a site's own limits come first, then the server's settings, then the defaults", () => {
  assert.deepEqual(limitsFor(site, {}), { ...DEFAULT_LIMITS });
  assert.deepEqual(limitsFor(site, { HAPTIC_BUDGET_HOUR: "5", HAPTIC_BUDGET_DAY: "junk" }), { hour: 5, day: DEFAULT_LIMITS.day });
  assert.deepEqual(limitsFor({ ...site, budget: { day: 40, perCaller: 30 } }, { HAPTIC_BUDGET_HOUR: "5", HAPTIC_BUDGET_DAY: "20" }), { hour: 5, day: 40, perCaller: 30 });
});

const turn = (headers: Record<string, string> = {}) =>
  new Request("https://widget.test/v1/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://app.test", ...headers },
    body: JSON.stringify({ site: site.id, goal: "open billing", step: 0, history: [], snapshot: { path: "/", title: "Home", headings: [], text: [], truncated: false, elements: [{ id: "e1", role: "link", label: "Billing" }] } }),
  });

/** The stand-in model is free. These tests have it pretend each step cost 60 cents. */
const priced = (pauseMs = 0) => configure({ HAPTIC_MODEL: "mock", HAPTIC_MOCK_USD: "0.6", HAPTIC_MOCK_PAUSE_MS: String(pauseMs) });
const free = () => configure({ HAPTIC_MODEL: "mock" });

test("past its budget a site gets the fixed sentence, the model is not called, and the team is told once", async () => {
  priced();
  const turns: string[] = [];
  const alerts: string[] = [];
  const pending: Promise<unknown>[] = [];
  const app = createApp({
    loadSite: async () => site,
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit: () => false,
    budget: new MemoryBudget({ HAPTIC_BUDGET_HOUR: "1" }),
    onTurn: (request) => void turns.push(request.goal),
    onAlert: (_site, alert) => void alerts.push(`${alert.window}:${alert.level}`),
    background: (work) => void pending.push(work),
  });

  // Two steps pass the one dollar limit.
  for (let step = 0; step < 2; step++) {
    assert.equal((await (await app(turn(), "1.1.1.1"))?.json()).say, "Click Billing.");
    await Promise.all(pending);
  }
  assert.deepEqual(alerts, ["hour:50", "hour:100"]);

  // The fixed sentence is marked, so the widget does not take it for a guide that finished.
  const resting = { target: null, status: "done", say: FIXED_SAY.resting, paused: true };
  assert.deepEqual(await (await app(turn(), "1.1.1.1"))?.json(), resting);
  const streamed = await app(turn({ Accept: STREAM_TYPE }), "1.1.1.1");
  assert.deepEqual(JSON.parse(((await streamed?.text()) ?? "").trim()), resting);
  await Promise.all(pending);
  assert.deepEqual(turns, ["open billing", "open billing"]);
  assert.deepEqual(alerts, ["hour:50", "hour:100"]);
  free();
});

test("twenty steps at the same moment do not all reach the model", async () => {
  // Each takes 30 ms, so all twenty have asked before the first has been paid for.
  priced(30);
  const memory = new MemoryBudget({ HAPTIC_BUDGET_HOUR: "1" });
  const pending: Promise<unknown>[] = [];
  let reached = 0;
  const app = createApp({
    loadSite: async () => site,
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit: () => false,
    budget: memory,
    onTurn: () => void reached++,
    background: (work) => void pending.push(work),
  });
  const replies = await Promise.all(Array.from({ length: 20 }, async (_, index) => (await app(turn(index % 2 ? { Accept: STREAM_TYPE } : {}), "1.1.1.1"))?.text()));
  await Promise.all(pending);
  assert.equal(reached, 2);
  assert.equal(replies.filter((reply) => reply?.includes(FIXED_SAY.resting)).length, 18);
  // $1.20 against the dollar: over by less than one step. Before, all twenty ran and it was $12.
  assert.deepEqual(await memory.admit(site, "1.1.1.1", FREE), { gate: { open: false, why: "hour" } });
  free();
});

test("a budget that cannot be reached, or is slow to answer, does not cost a visitor their step", async () => {
  const parts = { loadSite: async () => site, widget: async () => "", widgetMaxAge: 0, overLimit: () => false };
  const broken = createApp({ ...parts, budget: { admit: async () => Promise.reject(new Error("unreachable")), settle: async () => Promise.reject(new Error("unreachable")) } });
  assert.equal((await (await broken(turn(), "1.1.1.1"))?.json()).say, "Click Billing.");

  // A budget that takes a second to answer. The step does not wait for it, and what it set aside is still given back.
  const settled: (number | undefined)[] = [];
  const pending: Promise<unknown>[] = [];
  const slow = createApp({
    ...parts,
    background: (work) => void pending.push(work),
    budget: {
      admit: () => new Promise((resolve) => setTimeout(() => resolve({ gate: { open: true }, hold: 7 }), 1000)),
      settle: async (_site, _caller, hold) => {
        settled.push(hold);
        return { gate: { open: true }, alerts: [] };
      },
    },
  });
  const started = Date.now();
  assert.equal((await (await slow(turn(), "1.1.1.1"))?.json()).say, "Click Billing.");
  assert.ok(Date.now() - started < 900, `the step waited ${Date.now() - started} ms`);
  await Promise.all(pending);
  assert.deepEqual(settled, [7]);
});
