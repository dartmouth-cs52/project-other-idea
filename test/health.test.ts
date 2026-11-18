import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { FILLER, groupOfKey, questionGroup } from "../src/shared/questions.ts";

process.env.HAPTIC_MODEL = "mock";
const { parseTurn } = await import("../src/server/app.ts");
const { Store } = await import("../src/server/db.ts");
const { visitorHash } = await import("../src/server/learned.ts");
const { alertEmail, describeBreak, flagDrop, missingControl, MIN_GUIDES, oneLine } = await import("../web/worker/health.ts");

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

test("the news is said plainly in the email, with the question said to be a visitor's", () => {
  const lines = describeBreak({
    key: "export invoice",
    question: "How do I export invoices?",
    weeks: [],
    flag: { before: 0.82, now: 0.31, visitorsBefore: 40, stop: { path: "/billing", step: 2, label: null }, missing: { path: "/billing", role: "button", label: "Download invoice" } },
  });
  assert.deepEqual(lines, [
    'Guides for "How do I export invoices?", as a visitor last asked it, finished 82% of the time in the three weeks before, and 31% in the last seven days.',
    "Guides now stop at step 2 on /billing.",
    'Before, they pointed at "Download invoice" on /billing, and no guide has this week. It may have moved or been renamed.',
  ]);
});

// The email goes from alerts@joinhaptic.com to everyone at the company, and the question, the page and the
// control's name in it are whatever visitors' browsers sent, which anyone can send.
test("what a visitor could have written reaches the email short, with nothing in it a mail program could link", () => {
  const zeroWidth = String.fromCodePoint(0x200b);
  const fullStop = String.fromCodePoint(0xff0e);
  const flag = (question: string, label: string, path: string) =>
    describeBreak({ key: "k", question, weeks: [], flag: { before: 0.9, now: 0.2, visitorsBefore: 9, stop: { path, step: 1, label }, missing: { path, role: "link", label } } });

  const lines = flag(
    'Your Haptic account is locked. Verify now at evil.example/login or "https://evil.example" before it is deleted, the Haptic team',
    "Call http://10.0.0.1 now",
    "/verify-at.evil.example/now",
  );
  const all = lines.join("\n");
  for (const gone of [/evil/, /https?:/, /10\.0\.0\.1/]) assert.doesNotMatch(all, gone);
  assert.match(lines[0]!, /^Guides for "Your Haptic account is locked\. Verify now at \[link\] or \[link\] before it is…", as a visitor last asked it,/, "and cut short");
  assert.match(lines[1]!, /on \/\[link\]\/now, at "Call \[link\] now"\.$/);
  assert.match(flag('Press "OK", then the Haptic team will call', "x", "/")[0]!, /^Guides for "Press 'OK', then the Haptic team will call", as/, "a quote of its own can't close ours");

  // Written to slip past: full-width letters and dots, a character that draws nothing, www., a bare IP address.
  for (const sly of [`evil${fullStop}example`, `ｅｖｉｌ.ｅｘａｍｐｌｅ`, `evil${zeroWidth}.example`, "www.evil", "go to 192.168.4.20", "evil。example"]) {
    assert.doesNotMatch(flag(sly, "x", "/").join("\n"), /evil|192/, sly);
  }
  // Everyday questions keep their words, abbreviations included.
  assert.match(flag("How do I export v2.0 invoices for the U.S. office, e.g. last month's?", "Export", "/billing")[0]!, /"How do I export v2\.0 invoices for the U\.S\. office, e\.g\. last month's\?"/);
  // A page named like a file keeps the rest of its path.
  assert.match(flag("x", "Download", "/docs/guide.pdf")[1]!, /on \/docs\/\[link\], at "Download"/);
  // Emails and long numbers are masked as everywhere else.
  assert.match(flag("refund order 123456789 for ana@example.com", "x", "/")[0]!, /refund order \[number\] for \[email\]/);
});

test("the email's subject is one line, whatever the site's name holds", () => {
  const group = { key: "k", question: "Where are invoices?", weeks: [], flag: { before: 0.9, now: 0.2, visitorsBefore: 9, stop: null } };
  const { subject, text } = alertEmail({ name: "Acme\r\nBcc: everyone@example.com\u2028\u202eEvil" }, group, "https://joinhaptic.com/dashboard/");
  assert.equal(subject, "Guides for a common question on Acme Bcc: everyone@example.com Evil stopped finishing");
  assert.doesNotMatch(subject, /[\r\n\u2028\u202e]/u);
  assert.ok(text.endsWith("\nhttps://joinhaptic.com/dashboard/"));
  assert.equal(oneLine("  Acme\t\tCo  "), "Acme Co");
  assert.equal(oneLine("👩\u200d💻 Acme"), "👩\u200d💻 Acme", "the joiner inside an emoji is kept");
  assert.equal(oneLine("x".repeat(100)).length, 80);
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
