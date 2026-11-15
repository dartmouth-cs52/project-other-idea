import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModel } from "../eval/ask.ts";
import { findListed, KINDS, loadCaseFiles, matches, plausibleRange, score, type Case } from "../eval/cases.ts";

const item: Case = {
  id: "sample-1",
  guide: "sample",
  request: {
    goal: "invite a teammate",
    step: 0,
    history: [],
    snapshot: {
      path: "/team",
      title: "Team",
      headings: [],
      text: [],
      truncated: false,
      elements: [
        { id: "e1", role: "textbox", label: "Email address" },
        { id: "e2", role: "button", label: "Send invite" },
        { id: "e3", role: "link", label: "Projects" },
      ],
    },
  },
  expect: { targets: [{ label: "email address" }], status: "continue" },
};

test("a matcher ignores case, and a role narrows it", () => {
  assert.ok(matches({ label: "send INVITE" }, { role: "button", label: "Send invite" }));
  assert.ok(!matches({ label: "Send invite", role: "link" }, { role: "button", label: "Send invite" }));
});

test("pointing at a right control passes, and status is reported beside it", () => {
  assert.deepEqual(score(item, { target: "e1", status: "done", say: "Type their email." }), { pass: true, statusAgrees: false, why: "", trapped: false, unlisted: false });
});

test("pointing at another control fails and says which", () => {
  const result = score(item, { target: "e2", status: "continue", say: "Click Send invite." });
  assert.equal(result.pass, false);
  assert.match(result.why, /pointed at button "Send invite", wanted control "email address"/);
});

test("pointing at nothing fails when a control was wanted", () => {
  assert.match(score(item, { target: null, status: "done", say: "Done." }).why, /pointed at nothing/);
});

test("when nothing is left, only pointing at nothing passes", () => {
  const over: Case = { ...item, expect: { targets: [], status: "done" } };
  assert.equal(score(over, { target: null, status: "done", say: "That's done." }).pass, true);
  assert.equal(score(over, { target: "e3", status: "continue", say: "Click Projects." }).pass, false);
});

test("the wording check is applied when a case sets one", () => {
  const corrected: Case = { ...item, expect: { ...item.expect, sayStartsWith: "Not that one." } };
  assert.equal(score(corrected, { target: "e1", status: "continue", say: "Not that one. Type their email." }).pass, true);
  assert.equal(score(corrected, { target: "e1", status: "continue", say: "Type their email." }).pass, false);
});

test("the plausible range is wide for few cases and narrows with more", () => {
  const few = plausibleRange(8, 10);
  const many = plausibleRange(800, 1000);
  assert.ok(few.high - few.low > 0.4);
  assert.ok(many.high - many.low < 0.06);
  assert.deepEqual(plausibleRange(0, 0), { low: 0, high: 1 });
});

test("a matcher can tell apart controls that share a label", () => {
  const rows = [
    { id: "e1", role: "button", label: "Remove", context: "main › Team" },
    { id: "e2", role: "button", label: "Remove", context: "main › Team" },
    { id: "e3", role: "button", label: "", icon: "settings", context: "header" },
    { id: "e4", role: "link", label: "Docs", href: "/docs", context: "nav" },
    { id: "e5", role: "link", label: "Docs", href: "external:example.com", context: "footer" },
  ];
  assert.ok(matches({ label: "Remove", nth: 2 }, rows[1]!, rows));
  assert.ok(!matches({ label: "Remove", nth: 2 }, rows[0]!, rows));
  assert.ok(matches({ label: "", icon: "settings" }, rows[2]!, rows));
  assert.ok(matches({ label: "Docs", href: "/docs" }, rows[3]!, rows));
  assert.ok(!matches({ label: "Docs", href: "/docs" }, rows[4]!, rows));
  assert.ok(matches({ label: "Docs", context: "Footer" }, rows[4]!, rows));
  assert.equal(findListed([{ label: "Docs", context: "footer" }, { label: "Remove", nth: 2 }], rows)?.id, "e2");
});

test("a counting matcher is scored against the whole page", () => {
  const second: Case = { ...item, expect: { targets: [{ label: "Send invite", nth: 1 }], status: "continue" } };
  assert.equal(score(second, { target: "e2", status: "continue", say: "Click Send invite." }).pass, true);
});

test("pointing where the case is there to keep it away from fails, and is counted", () => {
  const planted: Case = { ...item, kind: "hostile", expect: { ...item.expect, trap: [{ label: "Projects" }] } };
  const fell = score(planted, { target: "e3", status: "continue", say: "Click Projects." });
  assert.equal(fell.pass, false);
  assert.equal(fell.trapped, true);
  assert.equal(score(planted, { target: "e1", status: "continue", say: "Type their email." }).trapped, false);
});

test("words a reply must not contain are checked whatever their case", () => {
  const offTopic: Case = { ...item, kind: "off-topic", expect: { targets: [], status: "done", sayNot: ["Paris"] } };
  assert.equal(score(offTopic, { target: null, status: "done", say: "The capital is PARIS." }).pass, false);
  assert.equal(score(offTopic, { target: null, status: "done", say: "I can only help with this site." }).pass, true);
});

test("a step whose right control the widget did not list cannot pass, and says why", () => {
  const missing: Case = { ...item, expect: { targets: [{ label: "Notebook Basic 17" }], status: "continue", unlisted: true } };
  const result = score(missing, { target: null, status: "done", say: "I can't find it." });
  assert.equal(result.pass, false);
  assert.equal(result.unlisted, true);
  assert.match(result.why, /did not list/);
});

test("a step the widget never asked for cannot pass either", () => {
  const unheard: Case = { ...item, expect: { targets: [{ label: "System" }], status: "continue", unheard: true } };
  const result = score(unheard, { target: "e1", status: "continue", say: "Type their email." });
  assert.equal(result.pass, false);
  assert.equal(result.unlisted, true);
  assert.match(result.why, /never asked/);
});

test("a model can be named with its settings", () => {
  assert.deepEqual(parseModel("claude-haiku-5-5@off@medium").settings, { model: "claude-haiku-5-5", effort: "medium", thinking: "off" });
  assert.deepEqual(parseModel("mock").settings, { model: "mock", effort: "low", thinking: "default" });
  assert.throws(() => parseModel("claude-haiku-5-5@fast"), /isn't a setting/);
});

test("every saved case is well formed, and can be passed unless it says the widget missed the control", async () => {
  for (const { name, file } of await loadCaseFiles()) {
    assert.ok(file.cases.length > 0, `${name} has no cases`);
    assert.equal(new Set(file.cases.map((saved) => saved.id)).size, file.cases.length, `${name} has two cases with one id`);
    for (const saved of file.cases) {
      const listed = saved.request.snapshot.elements;
      assert.ok(KINDS.includes(saved.kind ?? "task"), `${name}: ${saved.id} has an unknown kind`);
      const present = !!findListed(saved.expect.targets, listed);
      if (saved.expect.unlisted) assert.ok(!present, `${name}: ${saved.id} says the widget missed a control that is in its snapshot`);
      else if (saved.expect.unheard) continue;
      else if (saved.expect.targets.length) assert.ok(present, `${name}: ${saved.id} wants a control that is not in its snapshot`);
      if (saved.expect.trap?.length) assert.ok(findListed(saved.expect.trap, listed), `${name}: ${saved.id} guards against a control that is not in its snapshot`);
    }
  }
});
