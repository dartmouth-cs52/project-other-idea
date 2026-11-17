import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { Admission, Budget, Report } from "../src/server/budget.ts";
import { DEFAULT_APPEARANCE, type SiteContext, type Snapshot, type TurnReply } from "../src/shared/types.ts";
import { exec, freshDatabase, psqlSql, TEST_DATABASE_URL, testDatabase } from "./psql.ts";

// Verified routes, start to end: the server as the widget reaches it, the
// store, and a real Postgres with every migration applied, wired as
// worker/index.ts wires them. A route is learned from the model's answer,
// trusted once a guide the record says finished used it, served without the
// model or the budget on a site that serves routes, and loses its trust on a
// No to Did this help.
//
// The stand-in model answers, so these run with no API key. See turn.test.ts.
process.env.HAPTIC_MODEL = "mock";
const { createApp } = await import("../src/server/app.ts");
const { Store } = await import("../src/server/db.ts");

const DB = testDatabase("routes");
const ORIGIN = "https://app.test";
const SITE = "site_routes001";

const context: Omit<SiteContext, "id" | "name" | "origin" | "allowedOrigins"> = {
  version: 1,
  appearance: DEFAULT_APPEARANCE,
  notes: "",
  docs: [],
  pages: [],
  source: { url: ORIGIN, maxPages: 1, docs: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const HOME: Snapshot = { path: "/", title: "Home", headings: [], text: [], truncated: false, elements: [{ id: "e1", role: "link", label: "Billing", context: "nav" }, { id: "e2", role: "link", label: "Team", context: "nav" }] };
const BILLING: Snapshot = { path: "/billing", title: "Billing", headings: ["Billing"], text: [], truncated: false, elements: [{ id: "e1", role: "link", label: "Home", context: "nav" }] };

let made = 0;
const newGuide = () => `00000000-0000-4000-8000-${String(++made).padStart(12, "0")}`;

function server() {
  const sql = psqlSql(DB) as unknown as ConstructorParameters<typeof Store>[0];
  const store = new Store(sql, 3, { reportWaitsMs: [0, 250, 400] });
  const work: Promise<unknown>[] = [];
  const later = (write: Promise<unknown> | undefined) => void (write && work.push(write));
  const budget = { admitted: 0, settled: 0 };
  const meter: Budget = {
    admit: async (): Promise<Admission> => (budget.admitted++, { gate: { open: true }, hold: 1 }),
    settle: async (): Promise<Report> => (budget.settled++, { gate: { open: true }, alerts: [] }),
  };
  const app = createApp({
    loadSite: (id) => store.loadSite(id),
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit: () => false,
    budget: meter,
    background: (job) => void work.push(job),
    onAsk: (turn, _site, origin) => later(store.startGuide(turn, origin)),
    onTurn: (turn, measure, _site, origin, route) => later(store.recordStep(turn, measure, origin, route)),
    findRoute: (site, lookup) => store.findRoute(site.id, lookup),
    onReport: (site, guide, report) => later(store.report(site, guide, report)),
  });
  const post = (path: string, body: unknown) => app(new Request(`https://widget.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify(body) }), "1.1.1.1");
  const settled = async () => {
    while (work.length) await work.shift();
  };
  return {
    budget,
    async step(guide: string, step: number, snapshot: Snapshot, extra: Record<string, unknown> = {}): Promise<TurnReply> {
      const response = await post("/v1/turn", { site: SITE, guide, goal: "open billing", step, history: [], snapshot, ...extra });
      assert.equal(response?.status, 200);
      const reply = (await response!.json()) as TurnReply;
      await settled();
      return reply;
    },
    async report(guide: string, body: Record<string, unknown>): Promise<void> {
      const response = await post(`/v1/guides/${guide}/report`, { site: SITE, ...body });
      assert.equal(response?.status, 200);
      await settled();
    },
  };
}

const steps = async (guide: string) =>
  (await psqlSql(DB)`select n, model, route, target_key, after_key from steps where guide_id = ${guide} order by n`) as { n: number; model: string; route: string | null; target_key: string | null; after_key: string | null }[];
const routes = async () =>
  (await psqlSql(DB)`select path, after_key, target_key, confirmed, uses, repairs from routes where site_id = ${SITE} order by path, after_key`) as {
    path: string;
    after_key: string;
    target_key: string;
    confirmed: boolean;
    uses: number;
    repairs: number;
  }[];

describe("verified routes in the database", { skip: TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a local, empty database to run these" }, () => {
  before(() => {
    freshDatabase(DB);
    exec(DB, `insert into sites (id, name, origin, allowed_origins, context) values ('${SITE}', 'Test', '${ORIGIN}', '{${ORIGIN}}', '${JSON.stringify(context)}')`);
  });

  test("a new site watches: routes are learned from the model, trusted by a finished guide, and compared after that", async () => {
    const { step, report, budget } = server();
    const first = newGuide();
    assert.equal((await step(first, 0, HOME)).target, "e1");
    assert.equal((await step(first, 1, BILLING, { event: 'The user clicked link "Billing".', after: "link|Billing||" })).status, "done");
    assert.deepEqual(
      (await steps(first)).map((row) => [row.n, row.model, row.route, row.after_key]),
      [
        [0, "mock", "miss", ""],
        [1, "mock", "miss", "link|Billing||"],
      ],
    );
    // The first step's answer is a route, not yet trusted. The second pointed at nothing, so it is not one.
    assert.deepEqual(await routes(), [{ path: "/", after_key: "", target_key: "link|Billing||", confirmed: false, uses: 0, repairs: 0 }]);

    await report(first, { outcome: "finished", step: 1 });
    assert.deepEqual((await routes()).map((row) => [row.confirmed, row.uses]), [[true, 1]]);

    // The same question on the same screen: the model still answers, and it agreed.
    const second = newGuide();
    assert.equal((await step(second, 0, HOME)).target, "e1");
    assert.equal((await steps(second))[0]?.route, "agreed");
    assert.equal(budget.admitted, 3);
    assert.equal(budget.settled, 3);
  });

  test("a site that serves routes answers from a trusted one without the model or the budget, and a No takes the trust away", async () => {
    exec(DB, `update sites set routes_mode = 'serve' where id = '${SITE}'`);
    const { step, report, budget } = server();
    const guide = newGuide();
    assert.deepEqual(await step(guide, 0, HOME), { target: "e1", status: "continue", say: "Click Billing." });
    assert.deepEqual((await steps(guide)).map((row) => [row.model, row.route]), [["route", "served"]]);
    assert.equal(budget.admitted, 0);
    assert.equal(budget.settled, 0);

    // A guide finished on a step a route answered is kept as finished: it was answered.
    await step(guide, 1, BILLING, { event: 'The user clicked link "Billing".', after: "link|Billing||" });
    await report(guide, { outcome: "finished", step: 1 });
    const [kept] = (await psqlSql(DB)`select outcome from guides where id = ${guide}`) as { outcome: string }[];
    assert.equal(kept?.outcome, "finished");
    assert.deepEqual((await routes()).map((row) => [row.confirmed, row.uses]), [[true, 2]]);

    await report(guide, { helped: false });
    assert.deepEqual((await routes()).map((row) => row.confirmed), [false]);
    // Untrusted, it goes to the model again.
    const next = newGuide();
    await step(next, 0, HOME);
    assert.deepEqual((await steps(next)).map((row) => [row.model, row.route]), [["mock", "unconfirmed"]]);
    exec(DB, `update sites set routes_mode = 'shadow' where id = '${SITE}'`);
  });

  test("a different answer from the model replaces the route and counts as a repair", async () => {
    const { step } = server();
    const guide = newGuide();
    // Team is the only link the stand-in can match for this question now.
    await step(guide, 0, { ...HOME, elements: [{ id: "e2", role: "link", label: "Billing Team", context: "nav" }] });
    const [route] = await routes();
    assert.equal(route?.target_key, "link|Billing Team||");
    assert.equal(route?.confirmed, false);
    assert.equal(route?.repairs, 1);
  });
});
