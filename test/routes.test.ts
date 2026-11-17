import assert from "node:assert/strict";
import { test } from "node:test";
import type { Admission, Budget, Ceiling, Report } from "../src/server/budget.ts";
import type { TurnMeasure } from "../src/server/model.ts";
import type { RouteResult, StoredRoute } from "../src/server/routes.ts";
import { DEFAULT_APPEARANCE, routeKey, STREAM_TYPE, type SiteContext, type SnapElement, type TurnRequest } from "../src/shared/types.ts";

// The stand-in model, so these run with no API key. See turn.test.ts.
process.env.HAPTIC_MODEL = "mock";
const { comparedRoute, createApp, servedStep, startRouting } = await import("../src/server/app.ts");
const { measureTurn } = await import("../src/server/model.ts");
const { compareRoute, matchRoute, ownerSteers, ROUTE_MODEL, routeLookup, servedReply } = await import("../src/server/routes.ts");

const site = (routes?: SiteContext["routes"], extra: Partial<SiteContext> = {}): SiteContext => ({
  version: 1,
  id: "site_test",
  name: "Test",
  origin: "https://app.test",
  allowedOrigins: ["https://app.test"],
  appearance: DEFAULT_APPEARANCE,
  notes: "",
  docs: [],
  pages: [],
  source: { url: "https://app.test", maxPages: 1, docs: [] },
  ...(routes ? { routes } : {}),
  ...extra,
  createdAt: "",
  updatedAt: "",
});

const billing: SnapElement = { id: "e1", role: "link", label: "Billing", context: "nav › Account" };
const team: SnapElement = { id: "e2", role: "link", label: "Team", context: "nav" };
const elements = [billing, team];

const turn = (extra: Partial<TurnRequest> = {}): TurnRequest => ({
  site: "site_test",
  goal: "How do I change my billing card?",
  step: 0,
  history: [],
  snapshot: { path: "/settings/8812", title: "", headings: [], text: [], truncated: false, elements },
  ...extra,
});

const trusted: StoredRoute = { targetKey: routeKey(billing), targetContext: "nav › Account", say: "Click Billing.", status: "continue", confirmed: true };
const correction = { id: "c1", route: "/settings/8812", question: "change my billing card", right: { role: "link", label: "Team" }, createdAt: "2026-11-01T00:00:00Z" };

test("a step is looked up by its question, its screen and the control used before it", () => {
  assert.deepEqual(routeLookup(turn()), { goalKey: "how do i change my billing card", path: "/settings/:id", dialog: "", afterKey: "" });
  assert.equal(routeLookup(turn({ step: 1, after: "link|Team||" }))?.afterKey, "link|Team||");
});

test("a step after a wrong click, a loop correction, an unknown previous control, or in Do it with me is never looked up", () => {
  assert.equal(routeLookup(turn({ offTrack: true })), undefined);
  // What the widget adds when the model points at the same control twice with nothing changing (hintIfStuck), and what it said before.
  const stuck = 'The user clicked link "Team". You have pointed at link "Team" twice from this page and nothing changed. Choose something not yet tried, or say what is blocking.';
  assert.equal(routeLookup(turn({ step: 1, after: "x", event: stuck })), undefined);
  assert.equal(routeLookup(turn({ step: 1, after: "x", event: 'You pointed at link "Team" again, but the user already used it and nothing changed.' })), undefined);
  assert.equal(routeLookup(turn({ step: 2 })), undefined);
  assert.equal(routeLookup(turn({ mode: "act" })), undefined);
  // A step asked again after the visitor already acted is not a guide's first, whatever its number.
  assert.equal(routeLookup(turn({ step: 0, event: 'The user clicked link "Billing".' })), undefined);
  assert.equal(routeLookup(turn({ step: 0, event: 'The user clicked link "Billing".', after: "link|Billing||" }))?.afterKey, "link|Billing||");
});

test("a route points only at the one live control with its key and place, and never at a disabled one", () => {
  const snapshot = turn().snapshot;
  assert.equal(matchRoute(trusted, snapshot), "e1");
  // Same label in two places, such as Edit on every row: refused.
  assert.equal(matchRoute({ ...trusted, targetContext: "" }, { ...snapshot, elements: [{ ...billing, context: "" }, { ...billing, id: "e9", context: "" }] }), undefined);
  assert.equal(matchRoute(trusted, { ...snapshot, elements: [team] }), undefined);
  assert.equal(matchRoute(trusted, { ...snapshot, elements: [{ ...billing, state: ["disabled"] }] }), undefined);
});

test("a label is masked before it is part of a route, so routes never hold an email", () => {
  assert.equal(routeKey({ role: "link", label: "Account of sam@acme.com" }), "link|Account of [email]||");
});

test("only a trusted route that matches is served, and the model's answer is compared with it", () => {
  const snapshot = turn().snapshot;
  assert.deepEqual(servedReply(trusted, snapshot), { target: "e1", status: "continue", say: "Click Billing." });
  assert.equal(servedReply({ ...trusted, confirmed: false }, snapshot), undefined);
  assert.equal(compareRoute(undefined, { target: "e1", status: "continue", say: "" }, snapshot), "miss");
  assert.equal(compareRoute({ ...trusted, confirmed: false }, { target: "e1", status: "continue", say: "" }, snapshot), "unconfirmed");
  assert.equal(compareRoute(trusted, { target: "e1", status: "continue", say: "" }, snapshot), "agreed");
  assert.equal(compareRoute(trusted, { target: "e2", status: "continue", say: "" }, snapshot), "disagreed");
  assert.equal(compareRoute(trusted, { target: "e1", status: "continue", say: "" }, { ...snapshot, elements: [team] }), "unmatched");
});

test("a route that points again at the control just used, or at a control the owner ruled out, is never served", () => {
  const lookup = { goalKey: "x", path: "/", dialog: "", afterKey: routeKey(billing) };
  assert.equal(servedReply(trusted, turn().snapshot, lookup), undefined);
  assert.equal(servedReply(trusted, turn().snapshot, undefined, [{ role: "link", label: "billing" }]), undefined);
  assert.ok(servedReply(trusted, turn().snapshot, undefined, [{ role: "button", label: "Billing" }]));
});

test("a step the owner's corrections or a taught route cover is left to the model", () => {
  assert.equal(ownerSteers(site(), turn()), false);
  assert.equal(ownerSteers(site(undefined, { corrections: [correction] }), turn()), true);
  const taught = { id: "t1", question: "How do I change my billing card?", steps: [{ kind: "press" as const, path: "/settings/:id", role: "link", label: "Billing" }], createdAt: "2026-11-01T00:00:00Z" };
  assert.equal(ownerSteers(site(undefined, { taught: [taught] }), turn()), true);
});

/** A budget that counts what it is asked, and lets everything through unless `closed`. */
function countingBudget(closed = false) {
  const calls = { admit: 0, settle: [] as { usd: number; steps: number }[] };
  const budget: Budget = {
    admit: async (_site: SiteContext, _caller: string, _ceiling: Ceiling): Promise<Admission> => {
      calls.admit++;
      return closed ? { gate: { open: false, why: "hour" } } : { gate: { open: true }, hold: 1 };
    },
    settle: async (_site: SiteContext, _caller: string, _hold: number | undefined, usd: number, steps: number): Promise<Report> => {
      calls.settle.push({ usd, steps });
      return { gate: { open: true }, alerts: [] };
    },
  };
  return { budget, calls };
}

/** The widget server with a route store that answers with `findRoute`, and what it was told about each step. */
function server(context: SiteContext, findRoute: (() => Promise<StoredRoute | undefined>) | undefined, budget?: Budget) {
  const turns: { measure: TurnMeasure; route?: RouteResult }[] = [];
  const asked: string[] = [];
  const pending: Promise<unknown>[] = [];
  const app = createApp({
    loadSite: async () => context,
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit: () => false,
    ...(budget ? { budget } : {}),
    ...(findRoute ? { findRoute } : {}),
    background: (work) => void pending.push(work),
    onAsk: (request) => void asked.push(request.goal),
    onTurn: (_request, measure, _site, _origin, route) => void turns.push({ measure, ...(route ? { route } : {}) }),
  });
  const send = async (extra: Partial<TurnRequest> = {}, headers: Record<string, string> = {}) => {
    const body = turn({ guide: "8f0a2f1e-4c8b-4a52-9d3e-6c1b2a3d4e5f", ...extra });
    const request = new Request("https://widget.test/v1/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://app.test", ...headers },
      body: JSON.stringify(body),
    });
    const text = (await (await app(request, "1.1.1.1"))?.text()) ?? "";
    await Promise.all(pending);
    return text;
  };
  return { send, turns, asked };
}

test("serving answers from a trusted route without the model, and neither sets anything aside nor charges the budget", async () => {
  const { budget, calls } = countingBudget();
  const { send, turns, asked } = server(site("serve"), async () => trusted, budget);
  assert.deepEqual(JSON.parse(await send({ goal: "update payment" })), { target: "e1", status: "continue", say: "Click Billing." });
  assert.equal(turns[0]?.measure.model, ROUTE_MODEL);
  assert.equal(turns[0]?.measure.usd, 0);
  assert.equal(turns[0]?.route?.outcome, "served");
  // The question goes on record, since it was answered.
  assert.deepEqual(asked, ["update payment"]);
  assert.equal(calls.admit, 0);
  assert.deepEqual(calls.settle, []);

  // Streamed, the pointer goes first, as it does from the model.
  const lines = (await send({ goal: "update payment" }, { Accept: STREAM_TYPE })).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines, [{ target: "e1" }, { target: "e1", status: "continue", say: "Click Billing." }]);
  assert.equal(calls.admit, 0);
  assert.deepEqual(calls.settle, []);
});

test("a site that has spent its budget still gets the steps a route answers, and the fixed sentence for the rest", async () => {
  const { budget, calls } = countingBudget(true);
  const { send } = server(site("serve"), async () => trusted, budget);
  assert.equal(JSON.parse(await send()).say, "Click Billing.");
  assert.equal(calls.admit, 0);
  const { send: unserved } = server(site("serve"), async () => undefined, budget);
  assert.equal(JSON.parse(await unserved()).paused, true);
  assert.equal(calls.admit, 1);
});

test("in shadow mode the model always answers, inside the budget, and the route is only compared", async () => {
  const { budget, calls } = countingBudget();
  const { send, turns } = server(site(), async () => ({ ...trusted, targetKey: routeKey(team), targetContext: "nav" }), budget);
  assert.equal(JSON.parse(await send()).target, "e1");
  assert.equal(turns[0]?.measure.model, "mock");
  assert.equal(turns[0]?.route?.outcome, "disagreed");
  assert.equal(calls.admit, 1);
  assert.deepEqual(calls.settle, [{ usd: 0, steps: 1 }]);

  await send({}, { Accept: STREAM_TYPE });
  assert.equal(turns[1]?.route?.outcome, "disagreed");
  assert.equal(calls.admit, 2);
  assert.equal(calls.settle.length, 2);
});

test("serving falls back to the model, inside the budget, when the route is untrusted, unmatched, blocked or overruled, or the lookup is slow or fails", async () => {
  const cases: [SiteContext, () => Promise<StoredRoute | undefined>][] = [
    [site("serve"), async () => ({ ...trusted, confirmed: false })],
    [site("serve"), async () => ({ ...trusted, targetContext: "somewhere else" })],
    [site("serve", { corrections: [correction] }), async () => trusted],
    [site("serve", { blocked: [{ label: "Billing" }] }), async () => trusted],
    [site("serve"), () => new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1000))],
    [
      site("serve"),
      async () => {
        throw new Error("database down");
      },
    ],
  ];
  for (const [context, findRoute] of cases) {
    const { budget, calls } = countingBudget();
    const { send, turns } = server(context, findRoute, budget);
    const started = Date.now();
    await send();
    assert.equal(turns[0]?.measure.model, "mock");
    assert.equal(calls.admit, 1);
    assert.equal(calls.settle.length, 1);
    assert.ok(Date.now() - started < 600, "a slow lookup never holds the step for long");
  }
});

test("a lookup that did not answer in time is not counted as a miss", async () => {
  const routing = startRouting({ findRoute: () => new Promise(() => {}) }, site("serve"), turn());
  assert.equal(await servedStep(routing, site("serve"), turn()), undefined);
  const measure = await measureTurn(site("serve"), turn());
  assert.equal(await comparedRoute(routing, measure, turn()), undefined);
});

test("with routes off, or nowhere to keep them, nothing is looked up", async () => {
  let asked = 0;
  assert.equal(startRouting({ findRoute: async () => (asked++, trusted) }, site("off"), turn()), undefined);
  assert.equal(startRouting({}, site("serve"), turn()), undefined);
  const { send, turns } = server(site("off"), async () => (asked++, trusted));
  await send();
  assert.equal(asked, 0);
  assert.equal(turns[0]?.route, undefined);
});
