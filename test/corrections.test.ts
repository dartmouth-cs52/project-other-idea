import assert from "node:assert/strict";
import { test } from "node:test";
import { BLOCKED_SAY, correctionsFor, isBlocked, matchesControl, similarQuestion, type Correction } from "../src/shared/corrections.ts";
import { DEFAULT_APPEARANCE, type SiteContext, type TurnRequest } from "../src/shared/types.ts";

process.env.HAPTIC_MODEL = "mock";
const { measureTurn } = await import("../src/server/model.ts");
const { buildSystemPrompt, buildUserMessage } = await import("../src/server/prompt.ts");
const { createApp } = await import("../src/server/app.ts");
const { addCorrection, removeCorrection, setBlocked, knownControls, Invalid } = await import("../web/worker/corrections.ts");

// Corrections from the customer, and the controls Haptic must never point at.

const site: SiteContext = {
  version: 1,
  id: "site_test",
  name: "Test",
  origin: "https://app.test",
  allowedOrigins: ["https://app.test"],
  appearance: DEFAULT_APPEARANCE,
  notes: "",
  docs: [],
  pages: [{ path: "/settings", title: "Settings", headings: [], links: [{ label: "Team", to: "/team" }], buttons: ["Save changes", "Delete workspace"], fields: ["Workspace name"] }],
  source: { url: "https://app.test", maxPages: 1, docs: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const correction = (over: Partial<Correction>): Correction => ({
  id: "c1",
  route: "/billing",
  question: "How do I add more seats?",
  wrong: { role: "button", label: "Change plan" },
  right: { role: "link", label: "Team" },
  createdAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

const ask = (goal: string, elements: TurnRequest["snapshot"]["elements"], path = "/settings"): TurnRequest => ({
  site: site.id,
  goal,
  step: 0,
  history: [],
  snapshot: { path, title: "Settings", headings: [], text: [], truncated: false, elements },
});

test("a control is matched by its words without regard to case or spacing, and by kind when one is given", () => {
  assert.ok(matchesControl({ role: "button", label: "Delete  workspace" }, { label: "delete workspace" }));
  assert.ok(matchesControl({ role: "button", label: "Delete workspace" }, { role: "button", label: "Delete workspace" }));
  assert.ok(!matchesControl({ role: "link", label: "Delete workspace" }, { role: "button", label: "Delete workspace" }));
  assert.ok(!matchesControl({ role: "button", label: "Delete workspace forever" }, { label: "Delete workspace" }), "the whole label, not part of it");
  assert.ok(matchesControl({ role: "button", label: "", icon: "trash-2" }, { label: "icon:trash-2" }));
  assert.ok(!isBlocked(undefined, [{ label: "x" }]));
});

test("questions are alike when they share most of what they are about", () => {
  assert.ok(similarQuestion("How do I add more seats?", "add seats to my plan"));
  assert.ok(similarQuestion("Where do I get an API key?", "api key please"));
  assert.ok(!similarQuestion("How do I add more seats?", "how do I change my password"));
  assert.ok(!similarQuestion("how do I", "where is it"), "filler alone matches nothing");
});

test("the corrections for a step: a question like this one first, then this page's, at most five", () => {
  const all = [
    correction({ id: "here", route: "/settings", question: "rename the workspace", createdAt: "2026-11-03T00:00:00.000Z" }),
    correction({ id: "like", route: "/billing" }),
    correction({ id: "neither", route: "/billing", question: "download an invoice" }),
    ...Array.from({ length: 6 }, (_, i) => correction({ id: `more${i}`, route: "/settings", question: `question ${i}` })),
  ];
  const chosen = correctionsFor(all, "/settings", "can I add seats");
  assert.equal(chosen[0]!.id, "like");
  assert.equal(chosen.length, 5);
  assert.ok(!chosen.some((item) => item.id === "neither"));
  assert.deepEqual(correctionsFor(undefined, "/", "x"), []);
});

test("corrections go with the step that needs them, and a site without any is asked as before", () => {
  const request = ask("add seats to my plan", [{ id: "e1", role: "link", label: "Team" }], "/");
  const corrected = { ...site, corrections: [correction({})] };
  const message = buildUserMessage(request, corrected);
  assert.match(message, /<corrections>\nThe site's owner corrected earlier guides\./);
  assert.match(message, /- On \/billing, asked "How do I add more seats\?": point at link "Team", not button "Change plan"\./);
  assert.equal(buildUserMessage(request, site), buildUserMessage(request), "nothing extra without corrections");
  assert.equal(buildUserMessage(ask("rename my workspace", [], "/"), corrected), buildUserMessage(ask("rename my workspace", [], "/")), "nor for an unrelated question on another page");
  assert.equal(buildSystemPrompt(corrected), buildSystemPrompt(site), "corrections never change the cached part");
});

test("the list of controls never to point at is in the prompt only for a site that has one", () => {
  const prompt = buildSystemPrompt({ ...site, blocked: [{ role: "button", label: "Delete workspace" }, { label: "Transfer ownership" }] });
  assert.match(prompt, /# Controls never to point at, from its owner\n.*\n- button "Delete workspace"\n- control "Transfer ownership"/);
  assert.doesNotMatch(buildSystemPrompt(site), /never to point at/);
});

test("the server never points at a blocked control, not even early, and says it can't help with that here", async () => {
  const blockedSite = { ...site, blocked: [{ label: "Delete workspace" }] };
  const elements = [{ id: "e1", role: "button", label: "Save changes" }, { id: "e2", role: "button", label: "Delete workspace" }];
  const early: string[] = [];
  const measure = await measureTurn(blockedSite, ask("delete my workspace", elements), undefined, { onTarget: (id) => early.push(id) });
  assert.deepEqual(measure.reply, { target: null, status: "done", say: BLOCKED_SAY, blocked: true });
  assert.equal(measure.overruled, "blocked");
  assert.deepEqual(early, [], "the pointer was never sent to it");
  const fine = await measureTurn(blockedSite, ask("save changes", elements));
  assert.equal(fine.reply.target, "e1", "other controls are pointed at as usual");
  const answers = await measureTurn({ ...blockedSite, answers: { enabled: true } }, ask("delete my workspace", elements));
  assert.equal(answers.reply.blocked, true);
  assert.equal(answers.reply.mode, "guide");
});

test("the widget is told which controls are ruled out", async () => {
  const app = createApp({ loadSite: async () => ({ ...site, blocked: [{ label: "Delete workspace" }] }), widget: async () => "", widgetMaxAge: 0, overLimit: () => false });
  const response = await app(new Request(`https://widget.test/v1/sites/${site.id}`, { headers: { Origin: "https://app.test" } }), "1.1.1.1");
  assert.deepEqual((await response?.json()).blocked, [{ label: "Delete workspace" }]);
});

// The dashboard's side, with a stand-in for the database.
function standIn(rows: (text: string) => unknown[] = () => []) {
  const sent: { text: string; values: unknown[] }[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    sent.push({ text, values });
    return Promise.resolve(rows(text));
  };
  return { sql: sql as unknown as Parameters<typeof addCorrection>[0], sent };
}
const GUIDE = "0b6f2c1e-6a1d-4c3e-9f2a-3d4c5b6a7e8f";

test("Point here instead takes the page, the question and what was pointed at from the step itself", async () => {
  const step = { path: "/billing", target_role: "button", target_label: "Change plan", question: "How do I add more seats?" };
  const { sql, sent } = standIn((text) => (text.startsWith("select s.path") ? [step] : []));
  const earlier = correction({ id: "old", route: "/billing", question: "how do I add more seats" });
  const corrections = await addCorrection(sql, { id: site.id, context: { ...site, corrections: [earlier] } }, "org", { guide: GUIDE, step: 2, right: { role: "link", label: " Team " } });
  assert.equal(corrections.length, 1, "it replaces the correction for the same question on the same page");
  assert.deepEqual({ ...corrections[0], id: undefined, createdAt: undefined }, { id: undefined, createdAt: undefined, route: "/billing", question: "How do I add more seats?", wrong: { role: "button", label: "Change plan" }, right: { role: "link", label: "Team" } });
  const lookup = sent[0]!;
  assert.match(lookup.text, /where g.id = \? and g.site_id = \? and s.n = \?/);
  assert.deepEqual(lookup.values, [GUIDE, site.id, 2], "a step is only found on the caller's own site");
  const update = sent.at(-1)!;
  assert.match(update.text, /update sites set context = jsonb_set\(context, \?::text\[\], \?::jsonb\)/);
  assert.match(update.text, /where id = \? and company_id = \?/);
  assert.equal(update.values[0], "{corrections}");

  await assert.rejects(addCorrection(standIn().sql, { id: site.id, context: site }, "org", { guide: GUIDE, step: 0, right: { label: "Team" } }), Invalid, "a step that isn't on this site");
  await assert.rejects(addCorrection(sql, { id: site.id, context: site }, "org", { guide: GUIDE, step: 0, right: { role: "script", label: "x" } }), Invalid);
  await assert.rejects(addCorrection(sql, { id: site.id, context: site }, "org", { guide: GUIDE, step: 0, right: { label: "" } }), Invalid);
});

test("a correction can be taken back, and the blocked list is checked and kept without repeats", async () => {
  const { sql } = standIn();
  assert.deepEqual(await removeCorrection(sql, { id: site.id, context: { ...site, corrections: [correction({ id: "a" }), correction({ id: "b" })] } }, "org", "a"), [correction({ id: "b" })]);
  assert.deepEqual(await setBlocked(sql, site.id, "org", [{ label: "Delete workspace" }, { label: "delete workspace" }, { role: "button", label: "Transfer ownership" }]), [
    { label: "Delete workspace" },
    { role: "button", label: "Transfer ownership" },
  ]);
  await assert.rejects(setBlocked(sql, site.id, "org", Array.from({ length: 51 }, (_, i) => ({ label: `x${i}` }))), Invalid);
  await assert.rejects(setBlocked(sql, site.id, "org", "Delete"), Invalid);
});

test("the picker offers the controls the crawl found on that page, and those enough visitors saw", async () => {
  const { sql, sent } = standIn((text) => (text.includes("outline_labels") ? [{ kind: "button", label: "Archive" }] : []));
  const controls = await knownControls(sql, { id: site.id, context: site }, "/settings");
  assert.deepEqual(controls, [
    { role: "button", label: "Save changes" },
    { role: "button", label: "Delete workspace" },
    { role: "link", label: "Team" },
    { role: "textbox", label: "Workspace name" },
    { role: "button", label: "Archive" },
  ]);
  assert.ok(sent[0]!.values.includes(3), "only labels three visitors have seen, as for the prompt");
  assert.match(sent[0]!.text, /visitor_count >= \? and network_count >= \?/, "and from three networks, since visitor ids can be made up");
});
