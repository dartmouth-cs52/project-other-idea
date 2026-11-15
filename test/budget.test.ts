import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIMITS, describeAlert, emptyMeter, limitsFor, MemoryBudget, meter, type Limits } from "../src/server/budget.ts";
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
  assert.deepEqual(meter(state, limits, "", 0.4, 1, at("10:05")).gate, { open: true });
  assert.deepEqual(meter(state, limits, "", 0.6, 1, at("10:20")).gate, { open: false, why: "hour" });
  // Only asking changes nothing.
  assert.deepEqual(meter(state, limits, "", 0, 0, at("10:59")).gate, { open: false, why: "hour" });
  assert.deepEqual(meter(state, limits, "", 0, 0, at("11:00")).gate, { open: true });
  assert.equal(state.daySpent, 1);
});

test("the daily limit holds across hours", () => {
  const state = emptyMeter();
  for (const hour of ["08", "09", "10"]) meter(state, limits, "", 0.99, 1, at(`${hour}:00`));
  assert.deepEqual(meter(state, limits, "", 0.1, 1, at("11:00")).gate, { open: false, why: "day" });
  assert.deepEqual(meter(state, limits, "", 0, 0, new Date("2026-11-16T00:00:00Z")).gate, { open: true });
});

test("an alert goes out once at half, four fifths and all of a limit", () => {
  const state = emptyMeter();
  const levels = (usd: number, time: string) => meter(state, limits, "", usd, 1, at(time)).alerts.map((alert) => `${alert.window}:${alert.level}`);
  assert.deepEqual(levels(0.3, "10:00"), []);
  assert.deepEqual(levels(0.3, "10:01"), ["hour:50"]);
  assert.deepEqual(levels(0.1, "10:02"), []);
  // One step that passes two levels reports the higher one only.
  assert.deepEqual(levels(0.4, "10:03"), ["hour:100"]);
  // A new hour can alert again, and by now the day has passed its own half.
  assert.deepEqual(levels(0.5, "11:00"), ["hour:50", "day:50"]);
  assert.match(describeAlert(site, { window: "hour", level: 80, spent: 0.8, limit: 1 }), /site_test \(Test\) has used 80% of its hourly budget \(\$0\.80 of \$1\.00\)/);
  assert.match(describeAlert(site, { window: "day", level: 100, spent: 3, limit: 3 }), /reached its daily budget of \$3\.00 and is resting until the next day/);
});

test("one visitor can be given a number of steps a day, without stopping the others", () => {
  const state = emptyMeter();
  const each: Limits = { ...limits, perCaller: 2 };
  meter(state, each, "ann", 0, 1, at("10:00"));
  assert.deepEqual(meter(state, each, "ann", 0, 1, at("10:01")).gate, { open: false, why: "caller" });
  assert.deepEqual(meter(state, each, "bo", 0, 0, at("10:02")).gate, { open: true });
  assert.deepEqual(meter(state, each, "ann", 0, 0, new Date("2026-11-16T09:00:00Z")).gate, { open: true });
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

test("past its budget a site gets the fixed sentence, the model is not called, and the team is told once", async () => {
  // The stand-in model is free, so each step is charged 60 cents here. Two steps pass the one dollar limit.
  const memory = new MemoryBudget({ HAPTIC_BUDGET_HOUR: "1" });
  const turns: string[] = [];
  const alerts: string[] = [];
  const pending: Promise<unknown>[] = [];
  const app = createApp({
    loadSite: async () => site,
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit: () => false,
    budget: { spend: (asked, caller, _usd, steps) => memory.spend(asked, caller, steps * 0.6, steps) },
    onTurn: (request) => void turns.push(request.goal),
    onAlert: (_site, alert) => void alerts.push(`${alert.window}:${alert.level}`),
    background: (work) => void pending.push(work),
  });

  for (let step = 0; step < 2; step++) {
    assert.equal((await (await app(turn(), "1.1.1.1"))?.json()).say, "Click Billing.");
    await Promise.all(pending);
  }
  assert.deepEqual(alerts, ["hour:50", "hour:100"]);

  const resting = { target: null, status: "done", say: FIXED_SAY.resting };
  assert.deepEqual(await (await app(turn(), "1.1.1.1"))?.json(), resting);
  const streamed = await app(turn({ Accept: STREAM_TYPE }), "1.1.1.1");
  assert.deepEqual(JSON.parse(((await streamed?.text()) ?? "").trim()), resting);
  await Promise.all(pending);
  assert.deepEqual(turns, ["open billing", "open billing"]);
  assert.deepEqual(alerts, ["hour:50", "hour:100"]);
});

test("a budget that cannot be reached does not cost a visitor their step", async () => {
  const app = createApp({
    loadSite: async () => site,
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit: () => false,
    budget: { spend: async () => Promise.reject(new Error("unreachable")) },
  });
  assert.equal((await (await app(turn(), "1.1.1.1"))?.json()).say, "Click Billing.");
});
