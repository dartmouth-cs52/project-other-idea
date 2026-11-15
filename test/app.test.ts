import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_APPEARANCE, STREAM_TYPE, type SiteContext } from "../src/shared/types.ts";

// The stand-in model, so these run with no API key. See turn.test.ts.
process.env.HAPTIC_MODEL = "mock";
const { createApp, parseTurn } = await import("../src/server/app.ts");

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

function makeApp(limit = false) {
  const turns: string[] = [];
  const app = createApp({
    loadSite: async (id) => (id === site.id ? site : undefined),
    widget: async () => "/* widget */",
    widgetMaxAge: 300,
    overLimit: () => limit,
    onTurn: (request) => void turns.push(request.goal),
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
