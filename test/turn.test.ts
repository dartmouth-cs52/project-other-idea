import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemPrompt } from "../src/server/prompt.ts";
import { DEFAULT_APPEARANCE, type SiteContext, type SnapElement, type TurnRequest } from "../src/shared/types.ts";

// These use the stand-in model, so they run with no API key. The model is
// chosen when model.ts loads, so the setting has to come before the import.
process.env.HAPTIC_MODEL = "mock";
const { runTurn } = await import("../src/server/model.ts");

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

const elements: SnapElement[] = [
  { id: "e1", role: "link", label: "Billing" },
  { id: "e2", role: "link", label: "Team" },
  { id: "e3", role: "button", label: "Update card" },
];

function request(event: string): TurnRequest {
  return {
    site: site.id,
    goal: "update my billing card",
    step: 1,
    history: [
      { role: "user", text: "update my billing card" },
      { role: "assistant", text: "Click Billing." },
    ],
    event,
    snapshot: { path: "/", title: "Home", headings: [], text: [], elements, truncated: false },
  };
}

test("a wrong click is called out, and the pointer goes back to the control it meant", async () => {
  const reply = await runTurn(site, request('The user clicked "Team" instead of link "Billing".'));
  assert.equal(reply.target, "e1");
  assert.equal(reply.say, "Not that one. Click Billing.");
});

test("leaving the page without using the control is called out too", async () => {
  const reply = await runTurn(site, request('The user went to /team without using link "Billing".'));
  assert.equal(reply.say, "Not that one. Click Billing.");
});

test("a click on the control it pointed at is not called out", async () => {
  const reply = await runTurn(site, request('The user clicked link "Billing".'));
  assert.equal(reply.target, "e3");
  assert.equal(reply.say, "Click Update card.");
});

test("the model is told to say so when a click goes off the way", () => {
  assert.match(buildSystemPrompt(site), /start "say" with "Not that one\."/);
});
