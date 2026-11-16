import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModel } from "../eval/ask.ts";
import { findListed, KINDS, loadCaseFiles, matches, plausibleRange, score, type Case } from "../eval/cases.ts";
import { addressFits, saidOrWhy } from "../eval/browser.ts";
import { DONE, faults, type Guide, type GuideSet } from "../eval/guide.ts";
import { judge, Net, onlyQueries } from "../eval/net.ts";
import { NEUTRAL, valueAsked } from "../eval/visitor.ts";

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

// The net that keeps a run from writing to a site other people use. test/net.browser.test.ts tries it in a browser.

const live = { origin: "https://app.example.com", reads: "^POST app\\.example\\.com/api/search$", chatter: "^POST app\\.example\\.com/api/usage$" };
const post = (url: string, body?: string) => ({ method: "POST", url, body });

test("a GraphQL request is a read only when every operation in it is a query", () => {
  const body = (query: string) => JSON.stringify({ query });
  assert.ok(onlyQueries(body("query Issues($first: Int) { issues(first: $first) { id } }")));
  assert.ok(onlyQueries(body("{ me { name } }")));
  assert.ok(onlyQueries(body("fragment Row on Issue { id }\nquery List { issues { ...Row } }")));
  assert.ok(onlyQueries(JSON.stringify([{ query: "{ a }" }, { query: "query B { b }" }])));
  assert.ok(!onlyQueries(body("mutation Rename { rename(id: 1) { id } }")));
  assert.ok(!onlyQueries(body("query A { a }\nmutation B { b }")), "one mutation among queries is still a write");
  assert.ok(!onlyQueries(JSON.stringify([{ query: "{ a }" }, { query: "mutation { b }" }])));
  assert.ok(!onlyQueries(body("subscription S { s }")));
  // The word "query" inside a comment or a string does not make a mutation a query.
  assert.ok(!onlyQueries(body('# query\nmutation M { say(text: "query { a }") }')));
  assert.ok(onlyQueries(body('query Q { find(text: "mutation { x }") { id } }')));
  assert.ok(!onlyQueries(JSON.stringify({ extensions: { persistedQuery: { sha256Hash: "abc" } } })), "a query sent by its hash cannot be read, so it is not known to be one");
  assert.ok(!onlyQueries("name=x&query=y"));
  assert.ok(!onlyQueries(JSON.stringify({ query: { match: "x" } })));
  assert.ok(!onlyQueries(null));
});

test("on a site other people use, a request goes through only when it is known to read", () => {
  assert.deepEqual(judge({ method: "GET", url: "https://app.example.com/anything" }, live), { act: "pass" });
  assert.deepEqual(judge({ method: "OPTIONS", url: "https://app.example.com/api/save" }, live), { act: "pass" });
  assert.equal(judge(post("https://app.example.com/api/search?text=secret"), live).act, "let");
  assert.equal(judge(post("https://app.example.com/graphql", JSON.stringify({ query: "{ me { id } }" })), live).act, "let");
  // Not listed, so stopped, and nobody has said it is harmless.
  assert.deepEqual(judge(post("https://app.example.com/api/save"), live), { act: "stop", why: "not known to be a read", unknown: true });
  assert.deepEqual(judge({ method: "DELETE", url: "https://app.example.com/api/search" }, live), { act: "stop", why: "not known to be a read", unknown: true });
  assert.equal(judge(post("https://app.example.com/graphql", JSON.stringify({ query: "mutation { save }" })), live).act, "stop");
  // The page's own reports are stopped too, and are not held against the run.
  for (const quiet of [judge(post("https://stats.elsewhere.net/collect"), live), judge(post("https://app.example.com/api/usage"), live), judge({ ...post("https://app.example.com/ping"), beacon: true }, live)]) {
    assert.equal(quiet.act, "stop");
    assert.equal(quiet.act === "stop" && quiet.unknown, false);
  }
  // Another host of the same site is the site: a write there is a write.
  assert.deepEqual(judge(post("https://api.example.com/save"), live), { act: "stop", why: "not known to be a read", unknown: true });
  // What the set's own sign-in sends was checked by its author.
  assert.equal(judge(post("https://app.example.com/login"), live, true).act, "let");
});

test("a stopped request the visitor's step set off spoils the run, and says which step", () => {
  const net = new Net(live);
  assert.equal(net.decide(post("https://app.example.com/api/usage")), false);
  assert.equal(net.decide(post("https://app.example.com/api/search")), true);
  assert.equal(net.spoiled(), undefined);
  net.acting('used button "Copy link"');
  assert.equal(net.decide(post("https://app.example.com/api/short-urls?x=1")), false);
  assert.equal(net.decide(post("https://app.example.com/api/short-urls?x=2")), false);
  const spoiled = net.spoiled();
  assert.ok(spoiled?.byAStep);
  assert.match(spoiled.why, /after the visitor used button "Copy link", the page tried to send POST app\.example\.com\/api\/short-urls, which was stopped/);
  assert.deepEqual(net.log.stopped.at(-1), { method: "POST", to: "app.example.com/api/short-urls", why: "not known to be a read", times: 2, after: 'used button "Copy link"' });

  const fresh = new Net(live);
  fresh.decide(post("https://app.example.com/api/unknown"));
  assert.equal(fresh.spoiled()?.byAStep, false);
});

/** The guide sets this project tunes against. The held-out sets are left alone here as everywhere. */
const TUNED = ["demo", "hard", "joinhaptic", "ui5", "antdpro", "orangehrm", "toolshop", "parabank", "grafana", "backstage", "jira", "wikipedia"];

test("no live guide set lets a request through that saves, sends or deletes", async () => {
  const writes: Record<string, string[]> = {
    grafana: ["POST play.grafana.org/api/short-urls", "POST play.grafana.org/api/snapshots", "POST play.grafana.org/api/dashboards/db", "DELETE play.grafana.org/api/ds/query", "POST play.grafana.org/api/datasources/uid/x/resources/api/v1/admin/tsdb/delete_series"],
    jira: ["POST issues.apache.org/jira/login.jsp", "POST issues.apache.org/jira/rest/api/2/issue", "POST issues.apache.org/jira/secure/AjaxIssueEditAction.jspa", "POST issues.apache.org/jira/rest/api/2/filter"],
    backstage: ["POST demo.backstage.io/api/catalog/locations", "DELETE demo.backstage.io/api/catalog/entities/by-uid/1", "POST demo.backstage.io/api/scaffolder/v2/tasks"],
    wikipedia: ["POST en.wikipedia.org/w/index.php", "POST en.wikipedia.org/w/api.php"],
    joinhaptic: ["POST joinhaptic.com/request-access/", "POST joinhaptic.com/api/request"],
    orangehrm: ["POST opensource-demo.orangehrmlive.com/web/index.php/api/v2/pim/employees", "PUT opensource-demo.orangehrmlive.com/web/index.php/api/v2/pim/employees/7/personal-details"],
  };
  for (const name of TUNED) {
    const set = (await import(`../eval/guides/${name}.ts`)).default as GuideSet;
    if (set.sandbox) {
      assert.ok(!set.reads && !set.chatter, `${name} is a sandbox, where nothing is stopped, so it needs no "reads" or "chatter"`);
      continue;
    }
    assert.ok(writes[name], `${name} is a site other people use, so this test has to try some of its writes`);
    for (const line of writes[name]) {
      const [method = "", to = ""] = line.split(" ");
      assert.deepEqual(judge({ method, url: `https://${to}` }, set), { act: "stop", why: "not known to be a read", unknown: true }, `${name} would let ${line} through, or call it chatter`);
    }
  }
});

test("a guide that no run could ever score as reached is refused, and says which", () => {
  const pressedLast: Guide = { id: "pressed-last", start: "/", goal: "x", steps: [{ expect: [{ label: "A" }], act: { click: "#a" } }, { expect: [{ label: "B" }], act: { click: "#b" } }] };
  const one = (guide: Guide): GuideSet => ({ siteId: "s", origin: "https://example.com", hasTag: false, guides: [guide] });
  assert.match(faults(one(pressedLast))[0] ?? "", /^pressed-last: no run of it can be scored as reached/);
  // Each way of being scored is enough on its own.
  assert.deepEqual(faults(one({ ...pressedLast, reached: { absent: "#row" } })), []);
  assert.deepEqual(faults(one({ ...pressedLast, says: { all: ["yes"] } })), []);
  assert.deepEqual(faults(one({ ...pressedLast, steps: [pressedLast.steps[0]!, { expect: [{ label: "B" }] }] })), []);
  // A guide of one step is never run whole, and DONE without a test is still refused.
  assert.deepEqual(faults(one({ ...pressedLast, steps: [pressedLast.steps[0]!] })), []);
  assert.equal(faults(one({ ...pressedLast, steps: [pressedLast.steps[0]!, DONE] })).length, 1);
  assert.match(faults(one({ ...pressedLast, says: {} }))[0] ?? "", /"says" has to give the answer/);
  assert.match(faults(one({ ...pressedLast, reached: { url: "(" } }))[0] ?? "", /reached\.url is not a pattern/);
});

test("every guide set this project tunes against can be run", async () => {
  for (const name of TUNED) {
    const set = (await import(`../eval/guides/${name}.ts`)).default as GuideSet;
    assert.deepEqual(faults(set), [], `eval/guides/${name}.ts`);
  }
});

test("an answer in words passes only when it says the true answer, and nothing wrong", () => {
  const stock = { shown: { selector: ".out" }, notShown: { selector: ".in" } };
  const read = { shown: ["Notebook Professional 17"], notShown: ["Notebook Basic 17", "Notebook Professional 15"] };
  assert.equal(saidOrWhy(stock, "Only the Notebook Professional 17 is out of stock.", read), "");
  assert.match(saidOrWhy(stock, "The Notebook Basic 17 is out of stock.", read), /does not say "Notebook Professional 17"/);
  assert.match(saidOrWhy(stock, "The Notebook Professional 17 and the Notebook Basic 17 are out of stock.", read), /names "Notebook Basic 17", which the page shows is not the answer/);
  assert.match(saidOrWhy(stock, "Out of stock, so far: nothing.", { notShown: read.notShown }), /showed nothing at \.out/);
  // A hedge is not an answer, even with the right words in it.
  assert.match(saidOrWhy(stock, "It may be the Notebook Professional 17. Check whether the list says so.", read), /hedges \("It may be"\)/);
  assert.match(saidOrWhy({ all: ["\\bcash.on.delivery\\b"] }, "Vielleicht gibt es Cash on Delivery."), /hedges/);

  // A fixed answer, and the same words said the wrong way round.
  const cash = { all: ["\\bcash.on.delivery\\b"], not: ["\\b(isn't|is not|not) (offered|available)\\b"] };
  assert.equal(saidOrWhy(cash, "Yes. Choose Cash on Delivery in this list to pay the driver."), "");
  assert.match(saidOrWhy(cash, "Cash on Delivery isn't offered here."), /says "isn't offered", which is the wrong answer/);
  assert.match(saidOrWhy(cash, "Pay by card."), /does not say/);

  // A date read from the page may be written either way round, and only the part that counts is needed.
  const when = { shown: { selector: ".lastmod", part: "\\d{1,2} \\w+ \\d{4}", anyOrder: true } };
  const page = { shown: ["This page was last edited on 20 September 2026, at 19:55 (UTC)."] };
  assert.equal(saidOrWhy(when, "The latest edit is from September 20, 2026, by Quivico.", page), "");
  assert.match(saidOrWhy(when, "The latest edit is from 19 September 2026.", page), /does not say "20 September 2026"/);
});

test("the visitor types what the sentence asks for, in quotes of any kind or after \"type\" with none", () => {
  // Seen on staging: an unquoted name sent the visitor's "Test" into UI5's search ("No products found"), a value in
  // single quotes was never typed into Ant Design's description (eight times round), and a query after "type:" never
  // reached Jira's query box.
  assert.equal(valueAsked("Click the Search box and type Notebook Basic 17 to find it.", "Search"), "Notebook Basic 17");
  assert.equal(valueAsked("Click Rule Description and type a longer text, like 'template change', then we'll continue.", "Rule Description"), "template change");
  assert.equal(valueAsked("Click the Advanced Query box and type: created >= -7d (you can add project = KAFKA before it).", "Advanced Query"), "created >= -7d");
  assert.equal(valueAsked("Type ‘Kafka’ to find the project.", "Find Projects..."), "Kafka");
  assert.equal(valueAsked("Tapez « Shortlisted » dans le champ.", "Status"), "Shortlisted");
  assert.equal(valueAsked('Type "KAFKA-1" in the search box.', "Search"), "KAFKA-1");
  assert.equal(valueAsked("Click Timespan and type 7, then choose days.", "Timespan"), "7");
  // Text in quotes straight after "type" wins over any other, and text after "type" over quotes elsewhere.
  assert.equal(valueAsked('Click the Timespan box under "Within the last" and type 7.', "Timespan"), "7");
  // A description of what to type, the field's own name, a key to press and an apostrophe give nothing.
  for (const say of ["Type your work email.", "Enter a name for the rule.", "Escribe tu nuevo número en el campo Phone #.", "Type text here and press Enter.", "Fill in Rule Description, then click Next.", 'Click the "Search" box.', "Click the users' list, then type the name."]) {
    assert.equal(valueAsked(say, say.includes("Rule Description") ? "Rule Description" : "Search"), undefined, say);
  }
  // With nothing asked for, the made-up text is long enough for a field that wants five characters.
  assert.ok(NEUTRAL.length >= 5);
});

test("a guide's other ends are checked like its own: patterns that can be read, and controls that are not pressed", () => {
  const base: Guide = { id: "g", start: "/", goal: "x", steps: [{ expect: [{ label: "A" }], act: { click: "#a" } }, { expect: [{ label: "Delete" }] }] };
  const one = (guide: Guide): GuideSet => ({ siteId: "s", origin: "https://example.com", hasTag: false, guides: [guide] });
  assert.deepEqual(faults(one({ ...base, otherEnds: [{ expect: [{ label: "Remove", role: "menuitem" }], given: { selector: "[aria-expanded=true]" } }] })), []);
  assert.match(faults(one({ ...base, otherEnds: [{ expect: [{ label: "Remove" }], act: { click: "#remove" } }] }))[0] ?? "", /each of "otherEnds" is a control that is pointed at and not pressed/);
  assert.match(faults(one({ ...base, otherEnds: [{ expect: [{ label: "Remove" }], given: { url: "(" } }] }))[0] ?? "", /otherEnds\[0\]\.given\.url is not a pattern/);
  assert.deepEqual(faults(one({ ...base, steps: [base.steps[0]!, DONE], reached: [{ url: "/a$" }, { url: "/b$", said: "\\bB\\b" }] })), []);
  assert.match(faults(one({ ...base, steps: [base.steps[0]!, DONE], reached: [{ url: "/a$" }, { said: "(" }] }))[0] ?? "", /reached\[1\]\.said is not a pattern/);
  assert.match(faults(one({ ...base, steps: [base.steps[0]!, DONE], reached: { request: { to: "/api", has: "[" } } }))[0] ?? "", /reached\.request\.has is not a pattern/);
  assert.match(faults(one({ ...base, steps: [base.steps[0]!, DONE], reached: [] }))[0] ?? "", /empty list/);
  assert.match(faults(one({ ...base, says: { shown: { selector: "p", from: "/" } } }))[0] ?? "", /read "from" another page is read when the guide starts/);
});

test("an address is matched as it is, or as a visitor would write it", () => {
  const kafka = addressFits("[?&]jql=project\\s*=\\s*kafka\\s+and\\s+created\\s*>=\\s*-7d(?:&|$)");
  assert.equal(kafka("https://issues.apache.org/jira/issues/?jql=project%20%3D%20KAFKA%20AND%20created%20%3E%3D%20-7d"), true);
  assert.equal(kafka("https://issues.apache.org/jira/issues/?jql=project+%3D+KAFKA+AND+created+%3E%3D+-7d"), true);
  assert.equal(kafka("https://issues.apache.org/jira/issues/?jql=created%20%3E%3D%20-7d"), false);
  // A pattern written for the address as it is still works.
  assert.equal(addressFits("created%20%3E%3D%20-7d")("https://x/?jql=created%20%3E%3D%20-7d"), true);
});
