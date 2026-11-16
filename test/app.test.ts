import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_APPEARANCE, STREAM_TYPE, type SiteContext } from "../src/shared/types.ts";

// The stand-in model, so these run with no API key. See turn.test.ts.
process.env.HAPTIC_MODEL = "mock";
const { createApp, parseTurn, FIXED_SAY } = await import("../src/server/app.ts");
const { renderSnapshot } = await import("../src/server/prompt.ts");
type AppParts = import("../src/server/app.ts").AppParts;

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

function makeApp(limit = false, extra: Partial<AppParts> = {}, served: SiteContext = site) {
  const turns: string[] = [];
  const app = createApp({
    loadSite: async (id) => (id === served.id ? served : undefined),
    widget: async () => "/* widget */",
    widgetMaxAge: 300,
    overLimit: () => limit,
    onTurn: (request) => void turns.push(request.goal),
    ...extra,
  });
  return { app, turns };
}

const turnBody = JSON.stringify({
  site: site.id,
  goal: "open billing",
  step: 0,
  history: [],
  snapshot: { path: "/", title: "Home", headings: [], text: [], truncated: false, elements: [{ id: "e1", role: "link", label: "Billing" }, { id: "e2", role: "link", label: "Team" }] },
});

const turn = (headers: Record<string, string> = {}) =>
  new Request("https://widget.test/v1/turn", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://app.test", ...headers }, body: turnBody });

test("the widget file is served as a script that browsers may keep for a while", async () => {
  const response = await makeApp().app(new Request("https://widget.test/widget.js"), "1.1.1.1");
  assert.equal(response?.status, 200);
  assert.match(response?.headers.get("Content-Type") ?? "", /javascript/);
  assert.equal(response?.headers.get("Cache-Control"), "public, max-age=300");
  assert.equal(await response?.text(), "/* widget */");
});

test("a site's settings go only to the origins it lists", async () => {
  const { app } = makeApp();
  const ask = (id: string, origin: string) => app(new Request(`https://widget.test/v1/sites/${id}`, { headers: { Origin: origin } }), "1.1.1.1");
  assert.equal((await ask("site_none", "https://app.test"))?.status, 404);
  assert.equal((await ask(site.id, "https://elsewhere.test"))?.status, 403);
  const allowed = await ask(site.id, "https://app.test");
  assert.equal(allowed?.status, 200);
  assert.equal(allowed?.headers.get("Access-Control-Allow-Origin"), "https://app.test");
  assert.deepEqual(await allowed?.json(), { name: "Test", appearance: DEFAULT_APPEARANCE });
});

test("a step comes back whole when the caller does not ask for a stream", async () => {
  const { app, turns } = makeApp();
  const response = await app(turn(), "1.1.1.1");
  assert.equal(response?.status, 200);
  assert.deepEqual(await response?.json(), { target: "e1", status: "continue", say: "Click Billing." });
  assert.deepEqual(turns, ["open billing"]);
});

test("a streamed step names the control first and ends with the whole reply", async () => {
  const response = await makeApp().app(turn({ Accept: STREAM_TYPE }), "1.1.1.1");
  assert.match(response?.headers.get("Content-Type") ?? "", /x-ndjson/);
  const lines = ((await response?.text()) ?? "").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines, [{ target: "e1" }, { target: "e1", status: "continue", say: "Click Billing." }]);
});

test("a step from an origin the site does not list is refused", async () => {
  assert.equal((await makeApp().app(turn({ Origin: "https://elsewhere.test" }), "1.1.1.1"))?.status, 403);
});

test("a caller over the limit is told to wait", async () => {
  assert.equal((await makeApp(true).app(turn(), "1.1.1.1"))?.status, 429);
});

test("a body that is not a step is turned away, and other addresses are left to the host", async () => {
  const { app } = makeApp();
  const junk = new Request("https://widget.test/v1/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"goal":"x"}' });
  assert.equal((await app(junk, "1.1.1.1"))?.status, 400);
  assert.equal(await app(new Request("https://widget.test/demo/"), "1.1.1.1"), undefined);
  assert.equal(parseTurn({ site: "s", goal: "  ", snapshot: { elements: [] } }), undefined);
});

test("the browser's check before a cross-site request is answered", async () => {
  const response = await makeApp().app(new Request("https://widget.test/v1/turn", { method: "OPTIONS", headers: { Origin: "https://app.test" } }), "1.1.1.1");
  assert.equal(response?.status, 204);
  assert.match(response?.headers.get("Access-Control-Allow-Headers") ?? "", /Content-Type/);
});

const GUIDE = "0b6f2c1e-6a1d-4c3e-9f2a-3d4c5b6a7e8f";

test("each call from a page is noted, and a refused origin is noted as refused", async () => {
  const seen: string[] = [];
  const app = createApp({
    loadSite: async (id) => (id === site.id ? site : undefined),
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit: () => false,
    onSeen: (_site, origin, allowed) => void seen.push(`${origin} ${allowed}`),
  });
  const ask = (origin?: string) => app(new Request(`https://widget.test/v1/sites/${site.id}`, { headers: origin ? { Origin: origin } : {} }), "1.1.1.1");
  await ask("https://app.test");
  await ask("https://elsewhere.test");
  await ask();
  assert.deepEqual(seen, ["https://app.test true", "https://elsewhere.test false"]);
});

test("what a page marks on its fields reaches the model beside each field", () => {
  const elements = [
    { id: "e1", role: "textbox", label: "Email address 1", state: ["invalid"] },
    { id: "e2", role: "combobox", label: "Department", state: ["collapsed", "required"] },
    { id: "e3", role: "textbox", label: "Personal note", state: ["optional"] },
    { id: "e4", role: "button", label: "Send invite" },
  ];
  const request = parseTurn({ ...JSON.parse(turnBody), snapshot: { path: "/people", title: "People", headings: [], text: [], elements } });
  assert.deepEqual(request?.snapshot.elements.map((element) => element.state), [["invalid"], ["collapsed", "required"], ["optional"], undefined]);
  const page = renderSnapshot(request!.snapshot);
  assert.match(page, /^e1 textbox "Email address 1" \(invalid\)$/m);
  assert.match(page, /^e2 combobox "Department" \(collapsed, required\)$/m);
  assert.match(page, /^e3 textbox "Personal note" \(optional\)$/m);
  assert.match(page, /^e4 button "Send invite"$/m);
});

test("a step carries its guide and whether the visitor strayed, and a bad guide id is dropped", () => {
  const body = JSON.parse(turnBody);
  assert.equal(parseTurn({ ...body, guide: GUIDE, offTrack: true })?.guide, GUIDE);
  assert.equal(parseTurn({ ...body, guide: GUIDE, offTrack: true })?.offTrack, true);
  assert.equal(parseTurn({ ...body, guide: "not-a-uuid" })?.guide, undefined);
  // The widget masks a question of up to 300 characters, which can make it longer. The server takes up to 450.
  assert.equal(parseTurn({ ...body, goal: "x".repeat(500) })?.goal.length, 450);
  assert.equal(parseTurn({ ...body, offTrack: "yes" })?.offTrack, undefined);
});

test("how a guide ended is passed on, from allowed origins only, and nonsense is refused", async () => {
  const reports: unknown[] = [];
  const app = createApp({
    loadSite: async (id) => (id === site.id ? site : undefined),
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit: () => false,
    onReport: (_site, guide, report) => void reports.push({ guide, ...report }),
  });
  const send = (guide: string, body: unknown, origin = "https://app.test") =>
    app(new Request(`https://widget.test/v1/guides/${guide}/report`, { method: "POST", headers: { "Content-Type": "text/plain", Origin: origin }, body: JSON.stringify(body) }), "1.1.1.1");
  assert.equal((await send(GUIDE, { site: site.id, outcome: "finished" }))?.status, 200);
  assert.equal((await send(GUIDE, { site: site.id, helped: false }))?.status, 200);
  assert.equal((await send(GUIDE, { site: site.id, outcome: "exploded" }))?.status, 400);
  assert.equal((await send("nope", { site: site.id, outcome: "finished" }))?.status, 400);
  assert.equal((await send(GUIDE, { site: site.id, outcome: "finished" }, "https://elsewhere.test"))?.status, 403);
  assert.equal((await send(GUIDE, { site: "site_none", outcome: "finished" }))?.status, 404);
  assert.deepEqual(reports, [
    { guide: GUIDE, site: site.id, outcome: "finished" },
    { guide: GUIDE, site: site.id, helped: false },
  ]);
});

test("a guide's first question is passed on before the model answers, and later steps are not", async () => {
  const order: string[] = [];
  const hurried: (boolean | undefined)[] = [];
  const app = createApp({
    loadSite: async (id, hurry) => {
      hurried.push(hurry);
      return id === site.id ? site : undefined;
    },
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit: () => false,
    onAsk: (request) => void order.push(`asked ${request.step}`),
    onTurn: (request) => void order.push(`answered ${request.step}`),
  });
  const send = (extra: Record<string, unknown>) =>
    app(new Request("https://widget.test/v1/turn", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://app.test" }, body: JSON.stringify({ ...JSON.parse(turnBody), ...extra }) }), "1.1.1.1");
  await send({ guide: GUIDE, step: 0 });
  await send({ guide: GUIDE, step: 1 });
  await send({ step: 0 });
  assert.deepEqual(order, ["asked 0", "answered 0", "answered 1", "answered 0"]);
  // A step is answered from the copy of the site already held. The widget loading on a page waits for a fresh one.
  await app(new Request(`https://widget.test/v1/sites/${site.id}`, { headers: { Origin: "https://app.test" } }), "1.1.1.1");
  assert.deepEqual(hurried, [true, true, true, undefined]);
});

test("a site that is switched off gets no launcher, and a step that still arrives never reaches the model", async () => {
  const off = { target: null, status: "stuck", say: FIXED_SAY.off, paused: true };
  // Once by the host's switch and once by the site's own setting.
  for (const { app, turns } of [makeApp(false, { isOff: () => true }), makeApp(false, {}, { ...site, off: true })]) {
    const config = await app(new Request(`https://widget.test/v1/sites/${site.id}`, { headers: { Origin: "https://app.test" } }), "1.1.1.1");
    assert.equal((await config?.json()).off, true);
    assert.deepEqual(await (await app(turn(), "1.1.1.1"))?.json(), off);
    const streamed = await app(turn({ Accept: STREAM_TYPE }), "1.1.1.1");
    assert.deepEqual(JSON.parse(((await streamed?.text()) ?? "").trim()), off);
    assert.deepEqual(turns, []);
  }
});
