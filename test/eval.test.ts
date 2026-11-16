import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCaseFiles, matches, plausibleRange, score, type Case } from "../eval/cases.ts";

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
  assert.deepEqual(score(item, { target: "e1", status: "done", say: "Type their email." }), { pass: true, statusAgrees: false, why: "" });
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

test("every saved case can be passed: its right controls are on its page", async () => {
  for (const { name, file } of await loadCaseFiles()) {
    assert.ok(file.cases.length > 0, `${name} has no cases`);
    for (const saved of file.cases) {
      if (!saved.expect.targets.length) continue;
      const present = saved.request.snapshot.elements.some((element) => saved.expect.targets.some((matcher) => matches(matcher, element)));
      assert.ok(present, `${name}: ${saved.id} wants a control that is not in its snapshot`);
    }
  }
});
