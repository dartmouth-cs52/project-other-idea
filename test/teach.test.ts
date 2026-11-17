import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAction } from "../src/shared/act-rules.ts";
import {
  cleanTaughtSteps,
  hashTeachToken,
  isUnnamed,
  leftForVisitor,
  newTeachToken,
  routeText,
  stepText,
  taughtFor,
  taughtRoutePrompt,
  TEACH_TOKEN,
  type TaughtRoute,
  type TaughtStep,
} from "../src/shared/teach.ts";
import { ACT_VERSION, DEFAULT_APPEARANCE, type SiteContext, type TurnRequest } from "../src/shared/types.ts";

process.env.HAPTIC_MODEL = "mock";
const { createApp } = await import("../src/server/app.ts");
const { MemoryTeachStore, NeonTeachStore, stepsToKeep } = await import("../src/server/teach.ts");
const { buildSystemPrompt, buildUserMessage } = await import("../src/server/prompt.ts");
const { actingFor } = await import("../src/server/acting.ts");
const { reviewedSteps, saveTaught, startTeaching, stepViews, TeachRefused } = await import("../web/worker/teach.ts");

// Teach Haptic: one-time tokens, what a recorded step may hold, matching a
// question to a taught route, and what the route adds to the prompt.

const ORIGIN = "https://app.test";
const site: SiteContext = {
  version: 1,
  id: "site_test",
  name: "Test",
  origin: ORIGIN,
  allowedOrigins: [ORIGIN],
  appearance: DEFAULT_APPEARANCE,
  notes: "",
  docs: [],
  pages: [],
  source: { url: ORIGIN, maxPages: 1, docs: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const other: SiteContext = { ...site, id: "site_other", origin: "https://other.test", allowedOrigins: ["https://other.test"] };

const step = (over: Partial<TaughtStep>): TaughtStep => ({ kind: "press", path: "/budgets", role: "button", label: "New budget", ...over });
const ROUTE: TaughtRoute = {
  id: "a1b2c3d4",
  question: "how do I add a budget",
  createdAt: "2026-11-16T10:00:00.000Z",
  steps: [
    step({ context: "main › Budgets" }),
    step({ kind: "type", role: "textbox", label: "Budget name", dialog: "New budget", note: "Any name works." }),
    step({ kind: "choose", role: "combobox", label: "Department", choice: "Marketing", dialog: "New budget" }),
    step({ kind: "press", label: "Add budget", dialog: "New budget", leave: true }),
  ],
};

/** The widget server with an in-memory store and a clock a test can move. */
function server(options: { limited?: boolean } = {}) {
  let shift = 0;
  const store = new MemoryTeachStore(() => Date.now() + shift);
  const asked: string[] = [];
  const app = createApp({
    loadSite: async (id) => [site, other].find((known) => known.id === id),
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit: () => false,
    overTeachLimit: () => options.limited === true,
    teach: store,
    onAsk: () => asked.push("ask"),
    onTurn: () => asked.push("turn"),
  });
  const post = async (path: string, body: unknown, origin: string | null = ORIGIN) => {
    const headers: Record<string, string> = { "Content-Type": "text/plain" };
    if (origin) headers.Origin = origin;
    const response = (await app(new Request(`https://widget.test${path}`, { method: "POST", headers, body: JSON.stringify(body) }), "1.2.3.4"))!;
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { store, post, asked, later: (minutes: number) => (shift += minutes * 60_000) };
}

test("a token is 32 random bytes, kept only as its SHA-256", async () => {
  const tokens = new Set(Array.from({ length: 50 }, () => newTeachToken()));
  assert.equal(tokens.size, 50);
  for (const token of tokens) assert.match(token, TEACH_TOKEN);
  const [one] = tokens;
  assert.match(await hashTeachToken(one!), /^[0-9a-f]{64}$/);
  assert.equal(await hashTeachToken(one!), await hashTeachToken(one!));
  assert.notEqual(await hashTeachToken(one!), await hashTeachToken(newTeachToken()));
});

test("a token is claimed once, for its own site, from an allowed address, and then only that tab reaches the session", async () => {
  const { store, post } = server();
  const token = await store.create(site.id, "how do I add a budget", newTeachToken());
  const claim = newTeachToken();
  assert.equal((await post("/v1/teach/claim", { site: site.id, token, claim }, "https://evil.test")).status, 403, "not from an address the site does not allow");
  assert.equal((await post("/v1/teach/claim", { site: site.id, token, claim }, null)).status, 403, "not from outside a page");
  const wrongSite = await post("/v1/teach/claim", { site: other.id, token, claim }, "https://other.test");
  assert.equal(wrongSite.status, 404, "a token of another site is unknown here");
  assert.equal(wrongSite.body.refused, "unknown");

  const claimed = await post("/v1/teach/claim", { site: site.id, token, claim });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.question, "how do I add a budget");
  const again = await post("/v1/teach/claim", { site: site.id, token, claim: newTeachToken() });
  assert.equal(again.status, 410, "single use");
  assert.equal(again.body.refused, "used");
  assert.equal(again.body.error, "That teaching link has already been used. Start again from the Haptic dashboard.");
  assert.equal((await post("/v1/teach/check", { site: site.id, token, claim })).status, 200, "the tab that claimed it carries on");
  assert.equal((await post("/v1/teach/check", { site: site.id, token, claim: newTeachToken() })).status, 410, "another tab with the token does not");
  assert.equal((await post("/v1/teach/check", { site: other.id, token, claim }, "https://other.test")).status, 404);
  assert.equal((await post("/v1/teach/claim", { site: site.id, token: newTeachToken(), claim })).body.refused, "unknown");
  assert.equal((await post("/v1/teach/claim", { site: site.id, token: "short", claim })).status, 400);
  assert.equal((await post("/v1/teach/claim", { site: site.id, token, claim: token })).status, 400, "the claim is a secret of its own");
});

test("a token expires 30 minutes after it is made, and a claimed session 30 minutes after the claim", async () => {
  const { store, post, later } = server();
  const stale = await store.create(site.id, "q one", newTeachToken());
  later(31);
  const expired = await post("/v1/teach/claim", { site: site.id, token: stale, claim: newTeachToken() });
  assert.equal(expired.status, 410);
  assert.equal(expired.body.refused, "expired");
  assert.equal(expired.body.error, "That teaching link has expired. Start again from the Haptic dashboard.");

  const token = await store.create(site.id, "q two", newTeachToken());
  const claim = newTeachToken();
  later(25);
  assert.equal((await post("/v1/teach/claim", { site: site.id, token, claim })).status, 200);
  later(20);
  assert.equal((await post("/v1/teach/check", { site: site.id, token, claim })).status, 200, "45 minutes after it was made, 20 after the claim");
  later(11);
  assert.equal((await post("/v1/teach/check", { site: site.id, token, claim })).body.refused, "expired");
  assert.equal((await post("/v1/teach/done", { site: site.id, token, claim, steps: [step({})] })).body.refused, "expired");
});

test("the steps are taken once, checked again, and teach calls never reach the model", async () => {
  const { store, post, asked } = server();
  const token = await store.create(site.id, "how do I add a budget", newTeachToken());
  const claim = newTeachToken();
  await post("/v1/teach/claim", { site: site.id, token, claim });
  assert.equal((await post("/v1/teach/done", { site: site.id, token, claim, steps: [] })).status, 400, "nothing to send");
  const done = await post("/v1/teach/done", {
    site: site.id,
    token,
    claim,
    steps: [
      { kind: "press", path: "/budgets", role: "button", label: "New budget", commits: true },
      { kind: "type", path: "/budgets", role: "textbox", label: "Budget name", value: "Groceries", typed: "Groceries", note: "from the page", leave: true },
      { kind: "press", path: "/budgets", role: "button", label: "Create budget" },
    ],
  });
  assert.equal(done.status, 200);
  const kept = (await store.stepsOf(token))!;
  assert.deepEqual(kept, [
    { kind: "press", path: "/budgets", role: "button", label: "New budget" },
    { kind: "type", path: "/budgets", role: "textbox", label: "Budget name" },
    { kind: "press", path: "/budgets", role: "button", label: "Create budget", commits: true },
  ]);
  assert.equal((await post("/v1/teach/done", { site: site.id, token, claim, steps: [step({})] })).body.refused, "used", "sent once");
  assert.deepEqual(asked, []);
});

test("Cancel closes the session for good, and a closed session says so", async () => {
  const { store, post } = server();
  const token = await store.create(site.id, "q", newTeachToken());
  const claim = newTeachToken();
  await post("/v1/teach/claim", { site: site.id, token, claim });
  assert.equal((await post("/v1/teach/cancel", { site: site.id, token, claim: newTeachToken() })).status, 410, "only the tab that claimed it");
  assert.equal((await post("/v1/teach/cancel", { site: site.id, token, claim })).status, 200);
  const after = await post("/v1/teach/check", { site: site.id, token, claim });
  assert.equal(after.body.refused, "closed");
  assert.equal(after.body.error, "That teaching session was closed. Start again from the Haptic dashboard.");
});

test("teach calls are limited per caller before anything is looked up", async () => {
  const { post } = server({ limited: true });
  assert.equal((await post("/v1/teach/claim", { site: "site_nothing", token: newTeachToken(), claim: newTeachToken() })).status, 429);
});

test("in Neon, a claim only takes an unclaimed, open, unexpired token of the same site, and only hashes are sent", async () => {
  const sent: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    sent.push({ text: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve([]);
  }) as unknown as ConstructorParameters<typeof NeonTeachStore>[0];
  const store = new NeonTeachStore(sql);
  const token = newTeachToken();
  const [tokenHash, claimHash] = [await hashTeachToken(token), await hashTeachToken("c".repeat(43))];
  assert.equal(await store.claim(site.id, tokenHash, claimHash, ORIGIN), "unknown");
  const [claim, why] = sent;
  assert.match(claim!.text, /where token_hash = \? and site_id = \? and claimed_at is null and finished_at is null and cancelled_at is null and expires_at > now\(\)/);
  assert.match(claim!.text, /expires_at = now\(\) \+ \?::interval/);
  assert.ok(!JSON.stringify(sent).includes(token), "the token itself never reaches the database");
  assert.match(why!.text, /where token_hash = \? and site_id = \?/);
  sent.length = 0;
  await store.check(site.id, tokenHash, claimHash);
  assert.match(sent[0]!.text, /claim_hash = \?/);
});

test("a recorded step never holds a typed value, an email or a long number, whatever is posted", () => {
  const posted = [
    {
      kind: "type",
      path: "/people/ana@example.com/cards/4111111111111111",
      role: "textbox",
      label: "Email for ana@example.com",
      context: "main › Card 4111 1111 1111 1111 › row: Ana Lopez, ana@example.com › 2 of 9",
      dialog: "Edit 123456789",
      value: "secret value",
      text: "secret text",
      choice: "not for typing",
    },
    { kind: "choose", path: "/x", role: "select", label: "Account", choice: "Account 987654321" },
    { kind: "press", path: "/x", role: "<script>", label: "x".repeat(200) },
    { kind: "delete everything", path: "/x", role: "button", label: "Nope" },
  ];
  const kept = stepsToKeep(posted);
  const text = JSON.stringify(kept);
  for (const hidden of ["ana@", "4111", "123456789", "987654321", "secret", "Ana Lopez", "not for typing"]) assert.ok(!text.includes(hidden), `kept ${hidden}`);
  assert.deepEqual(kept[0], {
    kind: "type",
    path: "/people/:id/cards/:id",
    role: "textbox",
    label: "Email for [email]",
    context: "main › Card [number]",
    dialog: "Edit [number]",
  });
  assert.equal(kept[1]!.choice, "Account [number]");
  assert.equal(kept[2]!.role, "clickable", "a role the page made up is not kept");
  assert.ok(kept[2]!.label.length <= 80);
  assert.equal(kept.length, 3, "a kind of step that does not exist is dropped");
});

test("pages are kept as paths with ids masked, the way the rest of Haptic keys them", () => {
  const path = (input: string) => cleanTaughtSteps([{ kind: "press", path: input, role: "button", label: "Go" }])[0]!.path;
  assert.equal(path("/budgets/8812/edit?tab=owner#top"), "/budgets/:id/edit");
  assert.equal(path("https://app.test/users/ana@example.com/settings"), "/users/:id/settings");
  assert.equal(path("/customers/cus_9f8a7sd6f2/invoices/0b6f2c1e-6a1d-4c3e-9f2a-3d4c5b6a7e8f"), "/customers/:id/invoices/:id");
  assert.equal(path("/cart;jsessionid=ABC123/checkout"), "/cart/checkout");
  assert.equal(path("/#/budgets/8812"), "/#/budgets/:id", "an app that keeps its place after #/");
  assert.equal(path("/step-3"), "/step-3", "a word with a small number stays");
});

test("a step's control the recorder couldn't name is kept, and says so with its page", () => {
  const [unnamed] = cleanTaughtSteps([{ kind: "press", path: "/budgets", role: "button", label: "" }]);
  assert.ok(unnamed && isUnnamed(unnamed));
  assert.equal(stepText(unnamed), "Press an unnamed control on /budgets");
  assert.equal(stepText({ ...unnamed, dialog: "New budget", kind: "type" }), "In the New budget dialog, type in an unnamed control on /budgets");
  assert.ok(!isUnnamed({ ...unnamed, row: true }), "a record's own name is left out on purpose, and says so");
  assert.equal(stepText({ ...unnamed, row: true, role: "link" }), "On /budgets, open one of the links in a row of the list");
});

test("steps are written plainly, naming the page when it changes and the dialog a control is in", () => {
  assert.deepEqual(routeText(ROUTE.steps), [
    "On /budgets, press New budget",
    "In the New budget dialog, type in Budget name",
    "Choose Marketing in Department",
    "Press Add budget",
  ]);
  assert.equal(stepText(step({ kind: "choose", role: "select", label: "Period", choice: "Monthly" }), step({})), "Choose Monthly in Period");
  assert.equal(stepText(step({ role: "link", label: "Budgets", path: "/" })), "On /, open Budgets");
  assert.equal(stepText(step({ role: "tab", label: "Owners" }), step({})), "Open the Owners tab");
  assert.equal(stepText(step({ kind: "check", role: "switch", label: "Roll over" }), step({})), "Turn on Roll over");
  assert.equal(stepText(step({ label: "icon:plus" }), step({})), "Press the plus icon");
});

test("a visitor's question gets the route taught for the same task, the closest and then the newest", () => {
  const older = { ...ROUTE, id: "older", createdAt: "2026-11-01T00:00:00.000Z" };
  const spend = { ...ROUTE, id: "spend", question: "where do I see spend by department", createdAt: "2026-11-20T00:00:00.000Z" };
  const routes = () => [older, ROUTE, spend];
  assert.equal(taughtFor(routes(), "how do I delete a budget"), undefined, "the same thing, another action");
  assert.equal(taughtFor(routes(), "How do I add a new budget?")?.id, ROUTE.id, "the newer of two the same");
  assert.equal(taughtFor(routes(), "add budget")?.id, ROUTE.id);
  assert.equal(taughtFor(routes(), "show spend by department")?.id, "spend");
  assert.equal(taughtFor(routes(), "spend by department"), undefined, "no action, so unsure");
  assert.equal(taughtFor(routes(), "how do I reset my password"), undefined);
  assert.equal(taughtFor(routes(), "how do I"), undefined, "filler alone matches nothing");
  assert.equal(taughtFor([{ ...ROUTE, steps: [] }], "add a budget"), undefined, "a route with no steps is never used");
  assert.equal(taughtFor(undefined, "add a budget"), undefined);
});

const ask = (goal: string, mode?: "act"): TurnRequest => ({
  site: site.id,
  goal,
  step: 0,
  history: [],
  snapshot: { path: "/budgets", title: "Budgets", headings: [], text: [], truncated: false, elements: [{ id: "e1", role: "button", label: "Add budget" }] },
  ...(mode ? { mode, version: ACT_VERSION } : {}),
});

test("a matching question carries the route as the company's own steps; any other is asked as before", () => {
  const taught = { ...site, taught: [ROUTE] };
  const message = buildUserMessage(ask("how can I add a budget for marketing"), taught);
  const block = message.slice(message.indexOf("<taught_route>"), message.indexOf("</taught_route>") + "</taught_route>".length);
  assert.ok(block, "the route is there");
  assert.equal(
    block,
    [
      "<taught_route>",
      `The site's owner showed Haptic the way to do this, for the question "how do I add a budget". If the visitor wants the same task, follow these steps in order: match each step's control to the one in this page's list by its kind and name, even if it has moved or reads a little differently, skip steps already done, and if a step's control is not here, find the way to it. Fields are for the visitor's own values.`,
      `1. On /budgets: use button "New budget" (main › Budgets).`,
      `2. In dialog "New budget": type in textbox "Budget name". Note: Any name works.`,
      `3. Choose "Marketing" in combobox "Department".`,
      `4. Use button "Add budget". The visitor makes this click.`,
      "</taught_route>",
    ].join("\n"),
  );
  assert.ok(message.indexOf("<taught_route>") < message.indexOf("The visitor asks:"), "before the question");
  assert.ok(block.length < 1000, "short");
  assert.equal(buildUserMessage(ask("how do I reset my password"), taught), buildUserMessage(ask("how do I reset my password"), site), "only for matching questions");
  assert.equal(buildSystemPrompt(taught), buildSystemPrompt(site), "the cached part does not change");
  const quoted = taughtRoutePrompt({ ...ROUTE, question: 'add "a" budget', steps: [step({ label: 'Say "hi"' })] });
  assert.ok(quoted.includes(`button "Say 'hi'"`) && quoted.includes(`question "add 'a' budget"`), "a quote can't close a label");
});

test("on a site with Answers on, the route is in the Answers prompt's question, and is to be guided, not answered in words", () => {
  const docs = [{ title: "Budgets", source: "pasted:budgets", text: "To add a budget, open Budgets and press New budget. Pick a department and an amount, then Create budget." }];
  const answering = { ...site, docs, taught: [ROUTE] };
  assert.match(buildSystemPrompt(answering), /"mode": "guide" for a step/, "the Answers variant of the system prompt");
  const message = buildUserMessage(ask("how do I add a budget"), answering);
  assert.match(message, /<taught_route>/);
  assert.match(message, /Guide it step by step with mode "guide", even where a help article describes the same task\./);
  assert.ok(!buildUserMessage(ask("how do I add a budget"), { ...site, taught: [ROUTE] }).includes('mode "guide"'), "a site without Answers has no modes to name");
  const act = buildUserMessage(ask("add a budget", "act"), { ...answering, acting: { enabled: true } });
  assert.ok(act.includes("<taught_route>") && !act.includes('mode "guide"'), "an act step has no modes either");
  assert.equal(buildSystemPrompt(answering), buildSystemPrompt({ ...answering, taught: [] }), "the cached part does not change");
});

test("in Do it with me a taught route may be followed, but the click it leaves for the visitor stays theirs", () => {
  const acting = { ...site, acting: { enabled: true }, taught: [ROUTE] };
  assert.deepEqual(leftForVisitor(ROUTE), ["Add budget"]);
  const decision = actingFor(acting, ask("add a budget", "act"));
  assert.ok(decision.act);
  assert.deepEqual(decision.settings.commitWords, ["Add budget"]);
  // "Add budget" has no commit word of its own, so without the route Haptic could press it.
  const press = { target: "e1", do: "click" as const, commits: false, status: "continue" as const, say: "Adding it." };
  assert.equal(checkAction(press, ask("add a budget", "act")).withheld, undefined);
  assert.equal(checkAction(press, ask("add a budget", "act"), decision.settings).withheld, "marked");
  const unrelated = actingFor(acting, ask("reset my password", "act"));
  assert.ok(unrelated.act && unrelated.settings.commitWords === undefined, "other questions are acted on as before");
});

// The dashboard's side, with a stand-in for the database. Like Neon's, a query runs when it is awaited, or in a transaction.
function standIn(rows: (text: string) => unknown[] = () => []) {
  const sent: { text: string; values: unknown[] }[] = [];
  const run = (text: string, values: unknown[]) => {
    sent.push({ text: text.replace(/\s+/g, " ").trim(), values });
    return Promise.resolve(rows(text.replace(/\s+/g, " ").trim()));
  };
  const lazy = (text: string, values: unknown[]) => ({ run: () => run(text, values), then: (ok: (value: unknown) => unknown, no?: (error: unknown) => unknown) => run(text, values).then(ok, no) });
  const sql = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => lazy(strings.join("?"), values), {
    query: (text: string, values: unknown[] = []) => lazy(text, values),
    transaction: async (queries: { run(): Promise<unknown> }[]) => {
      const results = [];
      for (const query of queries) results.push(await query.run());
      return results;
    },
  });
  return { sql: sql as unknown as Parameters<typeof startTeaching>[0], sent };
}
const teachSite = { id: site.id, origin: ORIGIN, allowed_origins: [ORIGIN, "https://staging.app.test"], context: site };
const teacher = { id: "user-1", name: "Dana", email: "dana@app.test" };

test("starting a teach session keeps only the token's hash, for 30 minutes, with who started it, and opens the page in the fragment", async () => {
  const { sql, sent } = standIn((text) => (text.startsWith("select count") ? [{ waiting: 0 }] : text.startsWith("insert") ? [{ id: "0b6f2c1e-6a1d-4c3e-9f2a-3d4c5b6a7e8f", question: "how do I add a budget", created_by_name: "Dana", created_at: new Date(), expires_at: new Date(Date.now() + 1800_000), claimed_at: null, finished_at: null, cancelled_at: null, saved_at: null, steps: null, expired: false }] : []));
  const { session, url } = await startTeaching(sql, teachSite, teacher, { question: "  how do I add a budget  " });
  assert.equal(session.status, "waiting");
  const token = /#haptic-teach=([A-Za-z0-9_-]{43})$/.exec(url)?.[1];
  assert.ok(token, url);
  assert.ok(url.startsWith(`${ORIGIN}/#haptic-teach=`), "the site's first page, the token after #");
  const insert = sent.find((item) => item.text.startsWith("insert"))!;
  assert.ok(!JSON.stringify(sent).includes(token), "the token itself is never stored");
  assert.deepEqual(insert.values.slice(0, 6), [site.id, await hashTeachToken(token), "how do I add a budget", null, "user-1", "Dana"]);
  assert.match(insert.text, /now\(\) \+ \?::interval/);
  assert.equal(insert.values[6], "30 minutes");
  assert.ok(sent.some((item) => /delete from teach_sessions where site_id = \? and saved_at is null and created_at < now\(\) - \?::interval/.test(item.text)), "unsaved ones go after a week");

  await assert.rejects(startTeaching(sql, teachSite, teacher, { question: " ? " }), TeachRefused);
  const full = standIn((text) => (text.startsWith("select count") ? [{ waiting: 10 }] : []));
  await assert.rejects(startTeaching(full.sql, teachSite, teacher, { question: "add a budget" }), /10 teaching links waiting/);
});

test("from a failed guide, the tab opens where that guide started, on its own allowed address", async () => {
  const guide = "0b6f2c1e-6a1d-4c3e-9f2a-3d4c5b6a7e8f";
  const inserted = { id: guide, question: "q", created_by_name: "Dana", created_at: new Date(), expires_at: new Date(), claimed_at: null, finished_at: null, cancelled_at: null, saved_at: null, steps: null, expired: false };
  const rowsFor = (started: string, origin: string) => (text: string) =>
    text.startsWith("select question, origin") ? [{ question: "add a budget", origin, started_path: started }] : text.startsWith("select count") ? [{ waiting: 0 }] : text.startsWith("insert") ? [inserted] : [];
  const one = await startTeaching(standIn(rowsFor("/budgets", "https://staging.app.test")).sql, teachSite, teacher, { guide });
  assert.match(one.url, /^https:\/\/staging\.app\.test\/budgets#haptic-teach=/);
  const two = await startTeaching(standIn(rowsFor("/budgets/:id", "https://evil.test")).sql, teachSite, teacher, { guide });
  assert.match(two.url, /^https:\/\/app\.test\/#haptic-teach=/, "not a page with a record's id, nor an address the site doesn't allow");
  await assert.rejects(startTeaching(standIn().sql, teachSite, teacher, { guide }), /That guide isn't on this site/);
});

test("review: delete steps, add notes, leave the last click, and name an unnamed control or delete it", () => {
  const recorded = [step({}), step({ label: "" }), step({ kind: "type", role: "textbox", label: "Budget name" }), step({ label: "Create budget", commits: true }), step({ label: "Done" })];
  assert.throws(() => reviewedSteps(recorded, { steps: [{ n: 0 }, { n: 1 }] }), /Step 2 is an unnamed control on \/budgets\. Type the words on it, or delete the step\./);
  const named = reviewedSteps(recorded, { steps: [{ n: 0 }, { n: 1, name: "Add  owner" }] });
  assert.equal(named[1]!.label, "Add owner");
  const kept = reviewedSteps(recorded, { steps: [{ n: 0, note: "The button at the top right. ana@example.com" }, { n: 2 }, { n: 3 }, { n: 4, label: "Something else" }], leaveLast: true });
  assert.deepEqual(
    kept.map(({ label, note, leave }) => ({ label, note, leave })),
    [
      { label: "New budget", note: "The button at the top right. [email]", leave: undefined },
      { label: "Budget name", note: undefined, leave: undefined },
      { label: "Create budget", note: undefined, leave: true },
      { label: "Done", note: undefined, leave: true },
    ],
    "a step that commits is always the visitor's; names can't be changed here",
  );
  assert.throws(() => reviewedSteps(recorded, { steps: [{ n: 2 }, { n: 1 }] }), TeachRefused, "in their order");
  assert.throws(() => reviewedSteps(recorded, { steps: [{ n: 9 }] }), TeachRefused);
  assert.throws(() => reviewedSteps(recorded, { steps: [] }), /Keep at least one step/);
  assert.equal(stepViews([step({ label: "" })])[0]!.text, "Press an unnamed control on /budgets");
});

test("a save that fails leaves the steps where they were, so it can be tried again", async () => {
  const session = { id: "0b6f2c1e-6a1d-4c3e-9f2a-3d4c5b6a7e8f", question: "how do I add a budget", created_by_name: "Dana", created_at: new Date(), expires_at: new Date(), claimed_at: new Date(), finished_at: new Date(), cancelled_at: null, saved_at: null, steps: [step({}), step({ label: "Create budget", commits: true })], expired: true };
  const { sql, sent } = standIn((text) => (text.startsWith("select") ? [session] : []));
  const failing = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => sql(strings, ...values), {
    query: (sql as unknown as { query: (text: string, values: unknown[]) => Promise<unknown> }).query,
    transaction: async () => {
      throw new Error("Neon is down");
    },
  }) as unknown as typeof sql;
  await assert.rejects(saveTaught(failing, teachSite, "org", session.id, { steps: [{ n: 0 }, { n: 1 }] }), /Neon is down/);
  assert.ok(!sent.some((item) => /^update teach_sessions set (saved_at|steps|cancelled_at)/.test(item.text)), "nothing marked saved, nothing cleared");

  const saved = await saveTaught(sql, { ...teachSite, context: { ...site, taught: [{ ...ROUTE, question: "How do I add a budget?" }] } }, "org", session.id, { steps: [{ n: 0 }, { n: 1 }] });
  assert.equal(saved.taught.length, 1, "it replaces the route for the same question");
  assert.equal(saved.route.by, "Dana");
  assert.deepEqual(
    saved.route.steps.map((item) => item.text),
    ["On /budgets, press New budget", "Press Create budget"],
  );
  const update = sent.find((item) => item.text.startsWith("update sites"))!;
  assert.match(update.text, /jsonb_set\(context, '\{taught\}', \?::jsonb\)/);
  assert.match(update.text, /where id = \? and company_id = \?/);
  assert.ok(sent.some((item) => /update teach_sessions set saved_at = now\(\) where id = \? and site_id = \? and saved_at is null/.test(item.text)));
  await assert.rejects(
    saveTaught(standIn((text) => (text.startsWith("select") ? [{ ...session, finished_at: null, steps: null }] : [])).sql, teachSite, "org", session.id, { steps: [{ n: 0 }] }),
    /The steps haven't come in yet/,
  );
});

test("a site published again keeps its taught routes", async () => {
  const { Store } = await import("../src/server/db.ts");
  const sent: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    sent.push(strings.join("?").replace(/\s+/g, " "));
    return Promise.resolve([]);
  }) as unknown as ConstructorParameters<typeof Store>[0];
  await new Store(sql).saveSite(site);
  assert.match(sent[0]!, /'taught', sites\.context->'taught'/);
});
