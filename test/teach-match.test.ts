import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readTask, sameTask, stemWord } from "../src/shared/task-match.ts";

// Whether a visitor's question asks for the task a route was taught for
// (src/shared/task-match.ts). A route is a whole procedure, so a wrong match
// leads the visitor through the wrong thing: the table holds rewordings that
// must match, and the same noun with another verb, negations, other things
// and questions too vague to read, which must not.

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

test("a question is read as its actions, the head of what is acted on, and whether it is negated", () => {
  assert.deepEqual(readTask("How do I add a marketing budget for Q1?"), { actions: ["create"], object: "budget", negated: false });
  assert.deepEqual(readTask("get rid of old policies"), { actions: ["delete"], object: "policy", negated: false });
  assert.deepEqual(readTask("what is a budget"), { actions: ["explain"], object: "budget", negated: false });
  assert.equal(readTask("I can't add a budget").negated, true);
  assert.deepEqual(readTask("set a budget").actions, [], "set alone could be add or change");
  assert.equal(stemWord("policies"), "policy");
  assert.equal(stemWord("address"), "address");
});

test("the same question always matches, and nothing matches an empty one", () => {
  assert.ok(sameTask("budgets?", "Budgets"));
  assert.ok(sameTask("can I buy lunch without a receipt", "Can I buy lunch without a receipt?"), "a negated question matches itself word for word");
  assert.ok(!sameTask("", "add a budget"));
  assert.ok(!sameTask("add a budget", "   "));
});
