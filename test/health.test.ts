import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { FILLER, groupOfKey, questionGroup } from "../src/shared/questions.ts";

process.env.HAPTIC_MODEL = "mock";
const { parseTurn } = await import("../src/server/app.ts");
const { Store } = await import("../src/server/db.ts");
const { visitorHash } = await import("../src/server/learned.ts");
const { describeBreak, flagDrop, missingControl, MIN_GUIDES } = await import("../web/worker/health.ts");

// Questions grouped by meaning, counted by person, and guides that stopped
// finishing. The queries themselves were run against Postgres 16 by hand
// (see the pull request); these check the parts that decide.

test("questions that mean the same thing fall in one group", () => {
  const group = questionGroup("How do I export invoices?");
  assert.equal(group, "export invoice");
  for (const question of ["export my invoices", "Where can I export an invoice", "EXPORT INVOICES!!", "invoices, export"]) assert.equal(questionGroup(question), group, question);
  assert.notEqual(questionGroup("how do I download an invoice"), group);
  assert.equal(questionGroup("classes and glass"), "classe glass", "only a final s comes off, and never from a double s: crude, but the same in the database");
  assert.equal(questionGroup("how do I"), "how do i", "a question of only filler keeps its words");
  assert.equal(questionGroup("email ana@example.com"), "[email] email", "masked first, and sorted by character code");
});

test("the database groups with the same filler words as the TypeScript", async () => {
  const sql = await readFile(new URL("../db/migrations/0011_question_groups.sql", import.meta.url), "utf8");
  const listed = /token <> all \(array\[([^\]]*)\]\)/.exec(sql)?.[1] ?? "";
  assert.deepEqual(listed.split(",").map((word) => word.trim().replace(/'/g, "")), FILLER);
  assert.match(sql, /order by word collate "C"/, "sorted by character code, as groupOfKey does");
  assert.equal(groupOfKey("b a"), "b a", "only filler is dropped, never short real words below two letters");
});

test("a group is flagged when this week finishes far less often than the three before, with enough guides in both", () => {
  const week = (ago: number, guides: number, finished: number) => ({ ago, guides, finished, visitors: guides });
  assert.deepEqual(flagDrop([week(0, 10, 3), week(1, 10, 9), week(2, 10, 8)]), { before: 17 / 20, now: 0.3, visitorsBefore: 20 });
  assert.equal(flagDrop([week(0, 10, 7), week(1, 10, 8)]), undefined, "a drop of 10 points isn't flagged");
  assert.equal(flagDrop([week(0, MIN_GUIDES - 1, 0), week(1, 10, 10)]), undefined, "too few guides this week");
  assert.equal(flagDrop([week(0, 10, 0), week(1, MIN_GUIDES - 1, 4)]), undefined, "too few guides before");
  assert.equal(flagDrop([week(1, 10, 10)]), undefined, "nothing this week");
  assert.ok(flagDrop([week(0, 10, 2), week(4, 10, 10), week(3, 10, 10)]), "only the three weeks before count as before");
});

test("the missing control is one most earlier finished guides used, on a page this week's guides still reach, that none of them used", () => {
  const row = (path: string, label: string, before: number, now: number) => ({ path, target_role: "button", target_label: label, before_finished: before, now });
  const rows = [row("/", "Billing", 10, 6), row("/billing", "Download invoice", 9, 0), row("/billing", "Rarely used", 2, 0), row("/old", "Gone page button", 10, 0)];
  assert.deepEqual(missingControl(rows, 10, new Set(["/", "/billing"])), { path: "/billing", role: "button", label: "Download invoice" });
  assert.equal(missingControl(rows, 10, new Set(["/"])), undefined, "a page nobody reaches now can't say what is missing on it");
  assert.equal(missingControl(rows, 0, new Set(["/billing"])), undefined);
});

test("the news is said plainly, the same on the dashboard and in the email", () => {
  const lines = describeBreak({
    key: "export invoice",
    question: "How do I export invoices?",
    weeks: [],
    flag: { before: 0.82, now: 0.31, visitorsBefore: 40, stop: { path: "/billing", step: 2, label: null }, missing: { path: "/billing", role: "button", label: "Download invoice" } },
  });
  assert.deepEqual(lines, [
    '"How do I export invoices?" finished 82% of the time in the three weeks before, and 31% in the last seven days.',
    "Guides now stop at step 2 on /billing.",
    'Before, they pointed at "Download invoice" on /billing, and no guide has this week. It may have moved or been renamed.',
  ]);
});

const VISITOR = "1b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d";
const GUIDE = "0b6f2c1e-6a1d-4c3e-9f2a-3d4c5b6a7e8f";

test("a step carries the widget's random id, and only one shaped like it", () => {
  const body = { site: "site_test", goal: "x", step: 0, history: [], snapshot: { path: "/", title: "", headings: [], text: [], elements: [] } };
  assert.equal(parseTurn({ ...body, visitor: VISITOR })?.visitor, VISITOR);
  assert.equal(parseTurn({ ...body, visitor: "ana@example.com" })?.visitor, undefined);
});

test("the guide keeps a hash of the visitor made with the site, never the id itself", async () => {
  const sent: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    sent.push({ text: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve([]);
  }) as unknown as ConstructorParameters<typeof Store>[0];
  await new Store(sql).startGuide({ site: "site_test", guide: GUIDE, visitor: VISITOR, goal: "export invoices", step: 0, history: [], snapshot: { path: "/", title: "", headings: [], text: [], truncated: false, elements: [] } }, undefined);
  const update = sent.find((query) => query.text.startsWith("update guides set visitor"))!;
  assert.match(update.text, /where id = \? and site_id = \? and visitor is null/);
  assert.equal(update.values[0], await visitorHash("site_test", VISITOR));
  assert.ok(!JSON.stringify(sent).includes(VISITOR), "the id itself never reaches the database");
});
