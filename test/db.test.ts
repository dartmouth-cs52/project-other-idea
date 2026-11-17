import assert from "node:assert/strict";
import { test } from "node:test";
import { endingFor, Store, type LastStep } from "../src/server/db.ts";
import type { TurnMeasure } from "../src/server/model.ts";
import { NO_MODEL, type SiteContext, type TurnRequest } from "../src/shared/types.ts";

// These check what the server sends to the database, with a stand-in for the
// query function. They do not check that Postgres accepts it: that takes a
// database, which the tests do not have.

interface Sent {
  text: string;
  values: unknown[];
}

/** Stands in for Neon's query function. `refuse` makes any statement that matches it fail, as a missing column would. */
function standIn(refuse?: RegExp) {
  const sent: Sent[] = [];
  const run = (query: Sent) => {
    sent.push(query);
    if (refuse?.test(query.text)) throw new Error('column "usd" of relation "steps" does not exist');
  };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query: Sent = { text: strings.join("?").replace(/\s+/g, " ").trim(), values };
    // Neon's queries are sent when awaited, or all together by transaction().
    return { query, then: (done: (rows: unknown[]) => unknown, failed: (error: unknown) => unknown) => Promise.resolve().then(() => run(query)).then(() => done([]), failed) };
  };
  sql.transaction = async (queries: { query: Sent }[]) => queries.map(({ query }) => run(query));
  return { sql: sql as unknown as ConstructorParameters<typeof Store>[0], sent };
}

const GUIDE = "0b6f2c1e-6a1d-4c3e-9f2a-3d4c5b6a7e8f";
const request: TurnRequest = {
  site: "site_test",
  guide: GUIDE,
  goal: "open billing",
  step: 2,
  history: [],
  snapshot: { path: "/", title: "Home", headings: [], text: [], truncated: false, elements: [{ id: "e1", role: "link", label: "Billing" }] },
};
const measure: TurnMeasure = {
  reply: { target: "e1", status: "continue", say: "Click Billing." },
  model: "claude-sonnet-5-5",
  ms: 1400,
  msToTarget: 800,
  wrote: "Click Billing.",
  broke: [],
  cited: [],
  tokens: { input: 600, cacheRead: 24_000, cacheWrite: 0, output: 150 },
  usd: 0.0051,
};

test("a step's tokens and cost are added to its row, after the step itself is written", async () => {
  const { sql, sent } = standIn();
  await new Store(sql).recordStep(request, measure, "https://app.test");
  assert.equal(sent.length, 3);
  assert.match(sent[0]!.text, /^insert into guides/);
  assert.match(sent[1]!.text, /^insert into steps/);
  assert.match(sent[2]!.text, /^update steps set input_tokens = \?, cache_read_tokens = \?, cache_write_tokens = \?, output_tokens = \?, usd = \?, broke = \? where guide_id = \? and n = \?$/);
  assert.deepEqual(sent[2]!.values, [600, 24_000, 0, 150, 0.0051, [], GUIDE, 2]);
});

test("a database without the cost columns still gets the step", async () => {
  const { sql, sent } = standIn(/^update steps/);
  const errors: unknown[][] = [];
  const logged = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    // It must not throw: nothing here may cost a visitor their step.
    await new Store(sql).recordStep(request, measure, undefined);
  } finally {
    console.error = logged;
  }
  assert.deepEqual(sent.map((query) => query.text.split(" ").slice(0, 3).join(" ")), ["insert into guides", "insert into steps", "update steps set"]);
  assert.match(String(errors[0]?.[0]), /0004/);
});

test("the stand-in model has no cost to record, and a broken rule is recorded even so", async () => {
  const free = standIn();
  await new Store(free.sql).recordStep(request, { ...measure, model: "mock", tokens: undefined, usd: 0 }, undefined);
  assert.equal(free.sent.length, 2);

  const broke = standIn();
  await new Store(broke.sql).recordStep(request, { ...measure, model: "mock", tokens: undefined, usd: 0, broke: ["link"] }, undefined);
  assert.deepEqual(broke.sent[2]!.values, [null, null, null, null, null, ["link"], GUIDE, 2]);
});

test("on a site with Answers, the kind of reply and the docs it rested on are added too", async () => {
  const { sql, sent } = standIn();
  const answer: TurnMeasure = {
    ...measure,
    reply: { target: null, status: "done", say: "The link works for 7 days.", mode: "answer", sources: [{ title: "Inviting teammates" }] },
    cited: ["help/inviting.md"],
  };
  await new Store(sql).recordStep(request, answer, undefined);
  assert.equal(sent.length, 5);
  assert.match(sent[3]!.text, /^update steps set mode = \?, reason = \?, sources = \?, overruled = \? where guide_id = \? and n = \?$/);
  assert.deepEqual(sent[3]!.values, ["answer", null, ["help/inviting.md"], null, GUIDE, 2]);
  // No control it named was missing, which is said too.
  assert.deepEqual(sent[4]!.values, [null, GUIDE, 2]);

  const declined = standIn();
  await new Store(declined.sql).recordStep(request, { ...measure, reply: { target: null, status: "done", say: "The help docs don't cover that.", mode: "cannot_help", reason: "not_covered" }, overruled: "no_source" }, undefined);
  assert.deepEqual(declined.sent[3]!.values, ["cannot_help", "not_covered", [], "no_source", GUIDE, 2]);
});

test("a control an answer named that is nowhere in the product is recorded with the step", async () => {
  const { sql, sent } = standIn();
  const stale: TurnMeasure = {
    ...measure,
    reply: { target: null, status: "done", say: "Open the project and press Archive project.", mode: "answer", sources: [{ title: "Archiving" }], missing: ["Archive project"] },
    cited: ["help/archiving.md"],
    unseen: ["Archive project"],
  };
  await new Store(sql).recordStep(request, stale, undefined);
  assert.equal(sent.length, 5);
  assert.match(sent[4]!.text, /^update steps set unseen = \? where guide_id = \? and n = \?$/);
  assert.deepEqual(sent[4]!.values, [["Archive project"], GUIDE, 2]);

  // The same step written again, when the widget asks for it a second time, with an answer that named
  // nothing missing: the first answer's list goes.
  const again = standIn();
  await new Store(again.sql).recordStep(request, { ...stale, reply: { ...stale.reply, missing: undefined }, unseen: undefined }, undefined);
  assert.match(again.sent[4]!.text, /^update steps set unseen = \? where guide_id = \? and n = \?$/);
  assert.deepEqual(again.sent[4]!.values, [null, GUIDE, 2]);

  // A site without Answers never has any, and sends nothing for them.
  const guideOnly = standIn();
  await new Store(guideOnly.sql).recordStep(request, measure, undefined);
  assert.ok(guideOnly.sent.every((statement) => !/unseen/.test(statement.text)));
});

test("an act step is recorded as a step, and its mode is not written where a guide's kind of reply goes", async () => {
  const { sql, sent } = standIn();
  await new Store(sql).recordStep({ ...request, mode: "act" }, { ...measure, reply: { ...measure.reply, do: "click", enter: null, commits: false, mode: "act" } }, undefined);
  assert.deepEqual(sent.map((query) => query.text.split(" ").slice(0, 3).join(" ")), ["insert into guides", "insert into steps", "update steps set"]);
  assert.doesNotMatch(sent.map((query) => query.text).join("\n"), /set mode = |set unseen = /);
});


// How a guide ended ----------------------------------------------------------
//
// Only "finished" is billed, and the widget's report of it is the word of
// whatever sent the request. The store keeps it only when the steps this
// server recorded bear it out.

const SITE = { id: "site_test" } as SiteContext;

test("a guide is finished only on a step the model answered that said done, or pointed at a control the visitor could use", () => {
  const step = (n: number, status: LastStep["status"], pointed: boolean, model = "claude-sonnet-5-5"): LastStep => ({ n, status, pointed, model });
  // Every ending the widget reports as finished.
  assert.equal(endingFor(step(3, "done", false)), "finished", "followed the steps and arrived");
  assert.equal(endingFor(step(3, "done", true)), "finished", "the last pointer of a guide that got there");
  assert.equal(endingFor(step(0, "done", true)), "finished", "the control a first answer pointed at, used");
  assert.equal(endingFor(step(2, "continue", true)), "finished", "the click that commits, at the hand-over of Do it with me");
  assert.equal(endingFor(step(1, "done", false, "mock")), "finished", "the stand-in model answers steps too");
  // What the record shows ended another way is kept as that, and none of these is billed.
  assert.equal(endingFor(step(0, "done", false)), "shown", "a first answer that only needed words");
  assert.equal(endingFor(step(4, "stuck", false)), "nothing_to_point_at");
  assert.equal(endingFor(step(4, "stuck", true)), "nothing_to_point_at");
  assert.equal(endingFor(step(36, "done", false, NO_MODEL)), "step_limit", "the server's own cap on acting, which no model was asked for");
  assert.equal(endingFor({ ...step(2, "done", false), blocked: true }), "blocked", "a control the site's owner ruled out");
  // On a site with Answers on.
  assert.equal(endingFor({ ...step(1, "done", true), mode: "answer" }), "answered", "an answer in words, also one that points");
  assert.equal(endingFor({ ...step(2, "done", false), mode: "cannot_help", reason: "sensitive" }), "sensitive");
  assert.equal(endingFor({ ...step(2, "done", false), mode: "cannot_help", reason: null }), "not_covered", "a reason not yet written");
  assert.equal(endingFor({ ...step(1, "continue", true), mode: "answer" }), "finished", "an answer that points goes on as a guide, and the hand-over may follow it");
  assert.equal(endingFor({ ...step(3, "done", false), mode: "guide" }), "finished", "a guide's step on a site with Answers on");
  // And with nothing on record that ended, nothing is kept.
  assert.equal(endingFor(undefined), undefined, "no step was ever answered");
  assert.equal(endingFor(step(2, "continue", false)), undefined, "a step the visitor was still to do");
});

/**
 * Stands in for the database when a report arrives: `looks` is what each look
 * at the guide finds, in turn, and the last one is found from then on. A look
 * that finds `undefined` finds no guide.
 */
function onRecord(...looks: (Record<string, unknown> | undefined)[]) {
  const sent: Sent[] = [];
  let look = 0;
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query: Sent = { text: strings.join("?").replace(/\s+/g, " ").trim(), values };
    sent.push(query);
    if (!query.text.startsWith("select")) return Promise.resolve([]);
    const found = looks[Math.min(look++, looks.length - 1)];
    return Promise.resolve(found ? [found] : []);
  };
  const store = new Store(sql as unknown as ConstructorParameters<typeof Store>[0], 3, { reportWaitsMs: [0, 0, 0] });
  /** What was written, without the looks. */
  const written = () => sent.filter((query) => !query.text.startsWith("select"));
  return { store, sent, written, looks: () => look };
}

/** The guide as a look finds it: still open, with its newest step. */
const guideWith = (step?: { n: number; status: string; pointed: boolean; model?: string; mode?: string; reason?: string; blocked?: boolean }, open = true) =>
  step
    ? { open, model: "claude-sonnet-5-5", mode: null, reason: null, blocked: false, ...step }
    : { open, n: null, status: null, pointed: null, model: null, mode: null, reason: null, blocked: null };

const quiet = async (work: () => Promise<void>): Promise<string[]> => {
  const said: string[] = [];
  const { warn, error } = console;
  console.warn = console.error = (...args: unknown[]) => void said.push(args.join(" "));
  try {
    await work();
  } finally {
    Object.assign(console, { warn, error });
  }
  return said;
};

test("a report of finished for a guide with no recorded step is not stored as finished", async () => {
  // The question is on record and the model never answered a step of it.
  const { store, written, looks } = onRecord(guideWith());
  const said = await quiet(() => store.report(SITE, GUIDE, { site: SITE.id, outcome: "finished" }));
  assert.deepEqual(written(), [], "no ending is written, so the guide stays one that never reported one");
  assert.equal(looks(), 3, "it looked again each time, in case the step was still on its way");
  assert.match(said.join("\n"), /reported finished, but it has no step on record, so no ending is kept/);

  // The same for a guide that is not on record at all: one whose first question the off switch or the budget refused.
  const refused = onRecord(undefined);
  const told = await quiet(() => refused.store.report(SITE, GUIDE, { site: SITE.id, outcome: "finished" }));
  assert.deepEqual(refused.written(), []);
  assert.match(told.join("\n"), /came for a guide that is not on record/);
});

test("finished is stored when the guide's steps on record bear it out", async () => {
  for (const step of [
    { n: 2, status: "done", pointed: false },
    { n: 0, status: "done", pointed: true },
    { n: 3, status: "continue", pointed: true },
  ]) {
    const { store, written, looks } = onRecord(guideWith(step));
    await store.report(SITE, GUIDE, { site: SITE.id, outcome: "finished" });
    assert.equal(looks(), 1);
    assert.equal(written().length, 1);
    assert.match(written()[0]!.text, /^update guides set outcome = \?, ended_at = now\(\) where id = \? and site_id = \? and outcome is null$/);
    assert.deepEqual(written()[0]!.values, ["finished", GUIDE, SITE.id]);
  }
});

test("a report that arrives before its step's row is written waits for it", async () => {
  // The widget reports the ending the moment the last reply shows, and the step is written after that reply has gone.
  // First there is no guide, then the guide with its earlier step, a key the visitor was to press, then the step that ended it.
  const { store, written, looks } = onRecord(undefined, guideWith({ n: 0, status: "continue", pointed: false }), guideWith({ n: 1, status: "done", pointed: false }));
  await store.report(SITE, GUIDE, { site: SITE.id, outcome: "finished" });
  assert.equal(looks(), 3);
  assert.deepEqual(written().map((query) => query.values), [["finished", GUIDE, SITE.id]]);
});

test("a report is checked against the step it names, which it waits for, and a later step on record does not change it", async () => {
  // The visitor used the control the last reply (step 1) pointed at, and the widget reported finished at once, naming
  // step 1. The report was held up, and the look at what came of the click (step 2) was written first: the model found
  // nothing more there. Step 1's own row comes on the next look.
  const { store, sent, written, looks } = onRecord(
    { ...guideWith({ n: 2, status: "stuck", pointed: false }), named: false },
    { ...guideWith({ n: 1, status: "done", pointed: true }), named: true },
  );
  await store.report(SITE, GUIDE, { site: SITE.id, outcome: "finished", step: 1 });
  assert.equal(looks(), 2, "it waited for the step it names, though a newer one was on record");
  assert.ok(sent[0]!.values.includes(1), "the step is looked up by its number");
  assert.deepEqual(written().map((query) => query.values), [["finished", GUIDE, SITE.id]]);

  // A step that never comes: what is on record at the last look is what is kept, as for a widget that names none.
  const never = onRecord({ ...guideWith({ n: 2, status: "stuck", pointed: false }), named: false });
  const said = await quiet(() => never.store.report(SITE, GUIDE, { site: SITE.id, outcome: "finished", step: 1 }));
  assert.equal(never.looks(), 3);
  assert.deepEqual(never.written().map((query) => query.values), [["nothing_to_point_at", GUIDE, SITE.id]]);
  assert.match(said.join("\n"), /but the newest step 2 on record does not bear it out, so it is kept as nothing_to_point_at/);

  // The step it names, found at once, is the one judged: here it bears finished out, and nothing more is looked at.
  const found = onRecord({ ...guideWith({ n: 0, status: "done", pointed: true }), named: true });
  await found.store.report(SITE, GUIDE, { site: SITE.id, outcome: "finished", step: 0 });
  assert.equal(found.looks(), 1);
  assert.deepEqual(found.written().map((query) => query.values), [["finished", GUIDE, SITE.id]]);
});

test("a report of finished that the record contradicts is stored as the ending on record, at once", async () => {
  const cases: [Parameters<typeof guideWith>[0], string][] = [
    [{ n: 0, status: "done", pointed: false }, "shown"],
    [{ n: 2, status: "stuck", pointed: false }, "nothing_to_point_at"],
    [{ n: 36, status: "done", pointed: false, model: NO_MODEL }, "step_limit"],
    [{ n: 1, status: "done", pointed: false, blocked: true }, "blocked"],
    [{ n: 1, status: "done", pointed: true, mode: "answer" }, "answered"],
    [{ n: 1, status: "done", pointed: false, mode: "cannot_help", reason: "off_topic" }, "off_topic"],
  ];
  for (const [step, kept] of cases) {
    const { store, written, looks } = onRecord(guideWith(step));
    const said = await quiet(() => store.report(SITE, GUIDE, { site: SITE.id, outcome: "finished" }));
    assert.equal(looks(), 1, "a later step would not change how this one ended");
    assert.deepEqual(written().map((query) => query.values), [[kept, GUIDE, SITE.id]]);
    assert.match(said.join("\n"), new RegExp(`it is kept as ${kept}`));
  }
});

test("every other outcome is free, and is stored as the widget reports it, with whether it helped", async () => {
  // None of these needs a step on record: "error" is what the widget reports when the first step failed.
  for (const outcome of ["shown", "stopped", "nothing_to_point_at", "loop", "step_limit", "error", "answered", "not_covered", "blocked"] as const) {
    const { store, written } = onRecord(guideWith());
    await store.report(SITE, GUIDE, { site: SITE.id, outcome });
    assert.deepEqual(written().map((query) => query.values), [[outcome, GUIDE, SITE.id]], outcome);
  }
  // The first outcome reported is the one kept: a guide that has ended is not ended again, as finished or as anything.
  const ended = onRecord(guideWith({ n: 2, status: "done", pointed: false }, false));
  await ended.store.report(SITE, GUIDE, { site: SITE.id, outcome: "finished" });
  assert.deepEqual(ended.written(), []);
  // Whether it helped, and that the visitor went to a person, are kept with a finished report that is not.
  const unproven = onRecord(guideWith());
  await quiet(() => unproven.store.report(SITE, GUIDE, { site: SITE.id, outcome: "finished", helped: true, handoff: true }));
  assert.deepEqual(unproven.written().map((query) => query.text.replace(/ where.*/, "")), ["update guides set helped = ?", "update guides set handed_off = true"]);
});

test("a step the server answered by itself, without asking the model, never starts a guide's record", async () => {
  // Past the cap on acting the server answers "done" for nothing. The widget chooses the guide's id and the question,
  // so a step like that must not be able to make the guide's row.
  const { sql, sent } = standIn();
  const capped: TurnMeasure = { reply: { target: null, status: "done", say: "That's as far as I'll go on my own.", mode: "act", withheld: "cap" }, model: NO_MODEL, ms: 1, msToTarget: 1, wrote: "", broke: [], cited: [], usd: 0, acting: { capped: true } };
  await new Store(sql).recordStep({ ...request, step: 100, mode: "act" }, capped, "https://app.test");
  assert.equal(sent.length, 2);
  assert.match(sent[0]!.text, /^update guides set last_step_at = now\(\), step_count = greatest\(step_count, \?\) where id = \? and site_id = \?$/);
  assert.deepEqual(sent[0]!.values, [101, GUIDE, "site_test"]);
  // The step itself is written only for a guide that is there.
  assert.match(sent[1]!.text, /^insert into steps .* where exists \(select 1 from guides where id = \? and site_id = \?\)/);
  assert.ok(sent.every((query) => !/insert into guides/.test(query.text)));
  // A step the model answered starts the record as it always has.
  const answered = standIn();
  await new Store(answered.sql).recordStep(request, measure, "https://app.test");
  assert.match(answered.sent[0]!.text, /^insert into guides/);
});
