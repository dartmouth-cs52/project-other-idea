import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_APPEARANCE, STREAM_TYPE, type SiteContext, type TurnRequest } from "../src/shared/types.ts";

// When the page changes while the model is answering, the widget hangs up and
// asks again from the new page. The server stops the model call at once and
// counts the dropped step, without recording it as a step.
// The stand-in model waits a second and a half between naming its control and finishing.
process.env.HAPTIC_MODEL = "mock";
process.env.HAPTIC_MOCK_PAUSE_MS = "1500";
const { createApp } = await import("../src/server/app.ts");
const { Store } = await import("../src/server/db.ts");

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

const body = {
  site: site.id,
  guide: "6f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f",
  goal: "open billing",
  step: 1,
  history: [],
  event: "The user clicked link \"Reports\".",
  snapshot: { path: "/", title: "Home", headings: [], text: [], truncated: false, elements: [{ id: "e1", role: "link", label: "Billing" }] },
};

test("hanging up on a streamed step stops it, counts it as dropped, and records no step", async () => {
  const dropped: TurnRequest[] = [];
  const finished: TurnRequest[] = [];
  const app = createApp({
    loadSite: async () => site,
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit: () => false,
    onTurn: (request) => void finished.push(request),
    onCancel: (request) => void dropped.push(request),
  });
  const started = Date.now();
  const response = await app(
    new Request("https://widget.test/v1/turn", { method: "POST", headers: { "Content-Type": "application/json", Accept: STREAM_TYPE, Origin: "https://app.test" }, body: JSON.stringify(body) }),
    "1.1.1.1",
  );
  const reader = response!.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.deepEqual(JSON.parse(first), { target: "e1" }, "the control is named before the hang-up");
  await reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0]!.step, 1);
  assert.equal(finished.length, 0, "a dropped step is not recorded as a step");
  assert.ok(Date.now() - started < 1000, "the model call stopped at the hang-up, not when it would have finished");
});

test("a dropped step is counted on its guide", async () => {
  const sent: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    sent.push({ text: strings.join("?"), values });
    return Promise.resolve([]);
  }) as unknown as ConstructorParameters<typeof Store>[0];
  const store = new Store(sql);
  await store.cancelStep(body as TurnRequest);
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.text, /update guides set cancelled_steps = cancelled_steps \+ 1 where id = \? and site_id = \?/);
  assert.deepEqual(sent[0]!.values, [body.guide, site.id]);
});
