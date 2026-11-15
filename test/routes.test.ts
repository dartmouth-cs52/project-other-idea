import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_APPEARANCE, routeKey, type SiteContext, type SnapElement, type TurnRequest } from "../src/shared/types.ts";

// The stand-in model, so these run with no API key. See turn.test.ts.
process.env.HAPTIC_MODEL = "mock";
const { answerTurn } = await import("../src/server/app.ts");
const { compareRoute, matchRoute, routeLookup, servedReply } = await import("../src/server/routes.ts");

const site = (routes?: SiteContext["routes"]): SiteContext => ({
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

const trusted = { targetKey: routeKey(billing), targetContext: "nav › Account", say: "Click Billing.", status: "continue" as const, confirmed: true };

test("a step is looked up by its question, its screen and the control used before it", () => {
  assert.deepEqual(routeLookup(turn()), { goalKey: "how do i change my billing card", path: "/settings/:id", dialog: "", afterKey: "" });
  assert.equal(routeLookup(turn({ step: 1, after: "link|Team||" }))?.afterKey, "link|Team||");
});

test("a step after a wrong click, a loop correction, or an unknown previous control is never looked up", () => {
  assert.equal(routeLookup(turn({ offTrack: true })), undefined);
  assert.equal(routeLookup(turn({ step: 1, after: "x", event: "You pointed at link \"Team\" again, but the user already used it and nothing changed." })), undefined);
  assert.equal(routeLookup(turn({ step: 2 })), undefined);
  // A step asked again after the visitor already acted is not a guide's first, whatever its number.
  assert.equal(routeLookup(turn({ step: 0, event: "The user clicked link \"Billing\"." })), undefined);
  assert.equal(routeLookup(turn({ step: 0, event: "The user clicked link \"Billing\".", after: "link|Billing||" }))?.afterKey, "link|Billing||");
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

test("a route that points again at the control just used is never served", () => {
  const lookup = { goalKey: "x", path: "/", dialog: "", afterKey: routeKey(billing) };
  assert.equal(servedReply(trusted, turn().snapshot, lookup), undefined);
});

test("serving answers from a trusted route without the model, and points at once", async () => {
  const pointed: string[] = [];
  const { measure, route } = await answerTurn({ findRoute: async () => trusted }, site("serve"), turn({ goal: "update payment" }), (id) => pointed.push(id));
  assert.equal(measure.model, "route");
  assert.deepEqual(measure.reply, { target: "e1", status: "continue", say: "Click Billing." });
  assert.equal(route?.outcome, "served");
  assert.deepEqual(pointed, ["e1"]);
});

test("in shadow mode the model always answers, and the route is only compared", async () => {
  const { measure, route } = await answerTurn({ findRoute: async () => ({ ...trusted, targetKey: routeKey(team), targetContext: "nav" }) }, site(), turn());
  assert.equal(measure.model, "mock");
  assert.equal(measure.reply.target, "e1");
  assert.equal(route?.outcome, "disagreed");
});

test("serving falls back to the model when the route is not trusted, does not match, or the lookup is slow or fails", async () => {
  for (const findRoute of [
    async () => ({ ...trusted, confirmed: false }),
    async () => ({ ...trusted, targetContext: "somewhere else" }),
    () => new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1000)),
    async () => {
      throw new Error("database down");
    },
  ]) {
    const started = Date.now();
    const { measure } = await answerTurn({ findRoute }, site("serve"), turn());
    assert.equal(measure.model, "mock");
    assert.ok(Date.now() - started < 600, "a slow lookup never holds the step for long");
  }
});

test("a lookup that did not answer in time is not counted as a miss", async () => {
  const { route } = await answerTurn({ findRoute: () => new Promise(() => {}) }, site("serve"), turn());
  assert.equal(route, undefined);
});

test("with routes off, nothing is looked up", async () => {
  let asked = 0;
  const { route } = await answerTurn({ findRoute: async () => (asked++, trusted) }, site("off"), turn());
  assert.equal(asked, 0);
  assert.equal(route, undefined);
});
