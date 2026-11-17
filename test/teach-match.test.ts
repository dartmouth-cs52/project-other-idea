import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readTask, sameTask, stemWord } from "../src/shared/task-match.ts";

// Whether a visitor's question asks for the task a route was taught for
// (src/shared/task-match.ts). A route is a whole procedure, so a wrong match
// leads the visitor through the wrong thing: the table holds rewordings that
// must match, and the same noun with another verb, negations, other things,
// another one of the same thing (another vendor's bill) and questions too
// vague to read, which must not.

interface Pair {
  taught: string;
  asked: string;
  match: boolean;
  why: string;
}
const { pairs } = JSON.parse(readFileSync(new URL("./fixtures/teach-matching.json", import.meta.url), "utf8")) as { pairs: Pair[] };

test("the table has at least 40 pairs, both ways", () => {
  assert.ok(pairs.length >= 40);
  assert.ok(pairs.filter((pair) => pair.match).length >= 15);
  assert.ok(pairs.filter((pair) => !pair.match).length >= 25);
});

for (const pair of pairs) {
  test(`${pair.match ? "matches" : "does not match"}: "${pair.asked}" for a route taught for "${pair.taught}" (${pair.why})`, () => {
    assert.equal(sameTask(pair.taught, pair.asked), pair.match, JSON.stringify(readTask(pair.asked)));
  });
}

test("a question is read as its actions, the head of what is acted on, which one, and whether it is negated", () => {
  assert.deepEqual(readTask("How do I add a marketing budget for Q1?"), { actions: ["create"], object: "budget", which: ["marketing"], names: ["marketing", "q1"], negated: false, around: false });
  assert.deepEqual(readTask("get rid of old policies"), { actions: ["delete"], object: "policy", which: ["old"], names: ["old"], negated: false, around: false });
  assert.deepEqual(readTask("what is a budget"), { actions: ["explain"], object: "budget", which: [], names: [], negated: false, around: false });
  assert.deepEqual(readTask("pay a bill from Brightdesk").which, [], "what follows a preposition is a detail, not which one");
  assert.deepEqual(readTask("pay a bill from Brightdesk").names, ["brightdesk"]);
  assert.equal(readTask("I can't add a budget").negated, true);
  assert.equal(readTask("how do I undo adding a budget").around, true, "around the task, not for it");
  assert.equal(readTask("who can add a budget").around, true);
  assert.deepEqual(readTask("Can you show me how to add a budget?").actions, ["create"], "a way of asking is not a second action");
  assert.equal(readTask("I can't figure out how to add a budget").negated, false, "nor a negation");
  assert.deepEqual(readTask("set a budget").actions, [], "set alone could be add or change");
  assert.equal(stemWord("policies"), "policy");
  assert.equal(stemWord("address"), "address");
});

test("a route taught for one named thing is not used for another, and one taught for any is", () => {
  const taught = "pay the Brightdesk Coworking bill";
  assert.ok(sameTask(taught, "how do I pay the Brightdesk bill"), "one of its names");
  assert.ok(sameTask(taught, "where do I pay bills"), "no name at all");
  assert.ok(!sameTask(taught, "pay the Fjord Freight bill"), "another name in its place");
  assert.ok(!sameTask(taught, "pay a bill from Fjord Freight"), "another name, said after");
  assert.ok(sameTask("how do I pay a bill", "pay the Fjord Freight bill"), "taught for any bill");
  assert.ok(sameTask("how do I add a budget", "add a marketing budget for the offsite"), "taught for any budget");
});

test("the same question always matches, and nothing matches an empty one", () => {
  assert.ok(sameTask("budgets?", "Budgets"));
  assert.ok(sameTask("can I buy lunch without a receipt", "Can I buy lunch without a receipt?"), "a negated question matches itself word for word");
  assert.ok(!sameTask("", "add a budget"));
  assert.ok(!sameTask("add a budget", "   "));
});
