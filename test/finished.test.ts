import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { TurnMeasure } from "../src/server/model.ts";
import { DEFAULT_APPEARANCE, NO_MODEL, type GuideOutcome, type SiteContext, type Snapshot, type TurnReply } from "../src/shared/types.ts";
import { exec, freshDatabase, psqlSql, TEST_DATABASE_URL, testDatabase } from "./psql.ts";

// Which guides are stored as finished, start to end: the server as the widget
// reaches it, the store, and a real Postgres with every migration applied.
// "Finished" is what the pricing page bills, and the report of it is the word
// of whatever sent the request, so it is kept only when the steps this server
// recorded bear it out (`endingFor` in src/server/db.ts).
//
// The stand-in model answers, so these run with no API key. See turn.test.ts.
process.env.HAPTIC_MODEL = "mock";
const { createApp, FIXED_SAY } = await import("../src/server/app.ts");
type AppParts = import("../src/server/app.ts").AppParts;
const { Store } = await import("../src/server/db.ts");
const { scriptMock } = await import("../src/server/model.ts");

/** This file's own database, when TEST_DATABASE_URL is set. */
const DB = testDatabase("finished");

const ORIGIN = "https://app.test";
const plain: SiteContext = {
  version: 1,
  id: "site_finished01",
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
const off: SiteContext = { ...plain, id: "site_finished02", off: true };
const acting: SiteContext = { ...plain, id: "site_finished03", acting: { enabled: true } };
/** A site whose owner ruled out the link home. */
const ruling: SiteContext = { ...plain, id: "site_finished04", blocked: [{ label: "Home" }] };
/** A site with Answers on: it has a help article. */
const answers: SiteContext = { ...plain, id: "site_finished05", docs: [{ title: "Teammates", source: "help/teammates.md", text: "Who can invite teammates? Owners and admins can invite teammates from the Team page." }] };
/** A site whose company pays for a plan with Stripe. */
const paying: SiteContext = { ...plain, id: "site_finished06" };
const PAYING_ORG = "00000000-0000-4000-8000-0000000000d1";
const sites = [plain, off, acting, ruling, answers, paying];

/** A page with a link the stand-in will point at for "open billing", and one with nothing for it. */
const HOME: Snapshot = { path: "/", title: "Home", headings: [], text: [], truncated: false, elements: [{ id: "e1", role: "link", label: "Billing" }] };
const BILLING: Snapshot = { path: "/billing", title: "Billing", headings: ["Billing"], text: [], truncated: false, elements: [{ id: "e1", role: "link", label: "Home" }] };
/** A form in Do it with me, whose button commits. */
const FORM: Snapshot = { path: "/cards/new", title: "New card", headings: [], text: [], truncated: false, elements: [{ id: "e1", role: "button", label: "Create card" }] };

let made = 0;
/** A guide id as the widget makes one. */
const newGuide = () => `00000000-0000-4000-8000-${String(++made).padStart(12, "0")}`;

interface Options {
  /** More of what the host supplies: an off switch, a budget. */
  parts?: Partial<AppParts>;
  /** Each step's row is written this long after its reply has gone, by another process than the one the report reaches. */
  stepsLandAfterMs?: number;
  /** Steps are answered and never written, as when the database cannot be reached. */
  stepsLost?: boolean;
  /** Stripe's key, so a guide kept as finished is sent to Stripe at once. */
  stripeKey?: string;
}

/** The server with the store behind it, as worker/index.ts wires them, and what a widget on the site's page would send. */
function server(options: Options = {}) {
  const sql = psqlSql(DB) as unknown as ConstructorParameters<typeof Store>[0];
  // A report looks for its guide at once, and twice more: enough for a row written a moment late, and quick to give up.
  const store = new Store(sql, 3, { reportWaitsMs: [0, 250, 400], stripeKey: options.stripeKey });
  const elsewhere = new Store(sql, 3, { reportWaitsMs: [0, 250, 400] });
  const work: Promise<unknown>[] = [];
  const later = (write: Promise<unknown> | undefined) => void (write && work.push(write));
  const app = createApp({
    loadSite: async (id) => sites.find((site) => site.id === id),
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit: () => false,
    onAsk: (turn, _site, origin) => later(store.startGuide(turn, origin)),
    onTurn: (turn, measure, _site, origin) => {
      if (options.stepsLost) return;
      if (options.stepsLandAfterMs === undefined) return later(store.recordStep(turn, measure, origin));
      later(new Promise((resolve) => setTimeout(resolve, options.stepsLandAfterMs)).then(() => elsewhere.recordStep(turn, measure, origin)));
    },
    onReport: (site, guide, report) => later(store.report(site, guide, report)),
    ...options.parts,
  });
  const post = (path: string, body: unknown) => app(new Request(`https://widget.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify(body) }), "1.1.1.1");
  /** Everything handed to the host to finish after a response, as waitUntil does on a Worker. */
  const settled = async () => {
    while (work.length) await work.shift();
  };
  return {
    /** One step of a guide. The reply is read, and by default its row is written before the next thing happens. */
    async step(site: SiteContext, guide: string, step: number, snapshot: Snapshot, extra: Record<string, unknown> = {}, wait = true): Promise<TurnReply> {
      const response = await post("/v1/turn", { site: site.id, guide, goal: "open billing", step, history: [], snapshot, ...extra });
      assert.equal(response?.status, 200);
      const reply = (await response!.json()) as TurnReply;
      if (wait) await settled();
      return reply;
    },
    /** What the widget reports when a guide ends, and afterwards. */
    async report(site: SiteContext, guide: string, body: Record<string, unknown>): Promise<void> {
      const response = await post(`/v1/guides/${guide}/report`, { site: site.id, ...body });
      assert.equal(response?.status, 200);
      await settled();
    },
  };
}

interface Kept {
  outcome: GuideOutcome | null;
  ended: boolean;
  helped: boolean | null;
  step_count: number;
  steps: number;
  models: string | null;
}

/** The guide as the database has it, or undefined when it has no such guide. */
async function kept(guide: string): Promise<Kept | undefined> {
  const [row] = await psqlSql(DB)`
    select g.outcome, g.ended_at is not null as ended, g.helped, g.step_count,
      (select count(*)::int from steps s where s.guide_id = g.id) as steps,
      (select string_agg(s.model, ',' order by s.n) from steps s where s.guide_id = g.id) as models
    from guides g where g.id = ${guide}`;
  return row as Kept | undefined;
}

/** Runs `work` with the server's warnings kept off the test's output, and hands them back. */
async function hearing(work: () => Promise<unknown>): Promise<string> {
  const said: string[] = [];
  const { warn, error } = console;
  console.warn = console.error = (...args: unknown[]) => void said.push(args.join(" "));
  try {
    await work();
  } finally {
    Object.assign(console, { warn, error });
  }
  return said.join("\n");
}

describe("which guides are stored as finished", { skip: TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a local, empty database to run these" }, () => {
  before(() => {
    freshDatabase(DB);
    exec(DB, `insert into sites (id, name, origin, allowed_origins, context) values ${sites.map((site) => `('${site.id}', 'Test', '${ORIGIN}', '{${ORIGIN}}', '{}')`).join(", ")}`);
  });

  test("a guide the visitor followed to the end is finished, and the first outcome reported is the one kept", async () => {
    const { step, report } = server();
    const guide = newGuide();
    assert.deepEqual(await step(plain, guide, 0, HOME), { target: "e1", status: "continue", say: "Click Billing." });
    assert.deepEqual(await step(plain, guide, 1, BILLING, { event: 'The user clicked link "Billing".' }), { target: null, status: "done", say: "That should be it." });
    await report(plain, guide, { outcome: "finished" });
    assert.deepEqual(await kept(guide), { outcome: "finished", ended: true, helped: null, step_count: 2, steps: 2, models: "mock,mock" });
    // Whether it helped is added, and a later outcome changes nothing.
    await report(plain, guide, { helped: true });
    await report(plain, guide, { outcome: "stopped" });
    assert.deepEqual(await kept(guide), { outcome: "finished", ended: true, helped: true, step_count: 2, steps: 2, models: "mock,mock" });
  });

  test("a first answer that points at a control is finished when the widget says it was used, and one in words alone is shown", async () => {
    const { step, report } = server();
    // "Billing is this link", with the pointer on it: the visitor uses it, and the widget reports at the click.
    const pointed = newGuide();
    scriptMock({ target: "e1", status: "done", say: "Billing is this link." });
    await step(plain, pointed, 0, HOME);
    await report(plain, pointed, { outcome: "finished" });
    assert.equal((await kept(pointed))?.outcome, "finished");

    // An answer that only needed words has nothing to use. The widget calls that shown, and so does the record.
    const words = newGuide();
    scriptMock({ target: null, status: "done", say: "Billing is in the menu at the top." });
    await step(plain, words, 0, HOME);
    const said = await hearing(() => report(plain, words, { outcome: "finished" }));
    assert.deepEqual(await kept(words), { outcome: "shown", ended: true, helped: null, step_count: 1, steps: 1, models: "mock" });
    assert.match(said, /reported finished, but the newest step 0 on record does not bear it out, so it is kept as shown/);
  });

  test("a report of finished for a guide with no recorded step is not stored as finished", async () => {
    // The question was asked and is on record. No step of it is: the visitor left before the answer, or it could not be written.
    const { step, report } = server({ stepsLost: true });
    const guide = newGuide();
    await step(plain, guide, 0, HOME);
    assert.deepEqual(await kept(guide), { outcome: null, ended: false, helped: null, step_count: 0, steps: 0, models: null });
    const said = await hearing(() => report(plain, guide, { outcome: "finished" }));
    assert.deepEqual(await kept(guide), { outcome: null, ended: false, helped: null, step_count: 0, steps: 0, models: null });
    assert.match(said, /so no ending is kept/);
    // The guide is still open to the ending the widget would report for it.
    await report(plain, guide, { outcome: "error" });
    assert.equal((await kept(guide))?.outcome, "error");
  });

  test("a question asked while the site is switched off or over budget is not recorded, and cannot be reported finished", async () => {
    const closed: AppParts["budget"] = { admit: async () => ({ gate: { open: false, why: "hour" } }), settle: async () => ({ gate: { open: false, why: "hour" }, alerts: [] }) };
    const refusing: [string, ReturnType<typeof server>, SiteContext, string][] = [
      ["the site's own switch", server(), off, FIXED_SAY.off],
      ["the host's switch", server({ parts: { isOff: () => true } }), plain, FIXED_SAY.off],
      ["the budget", server({ parts: { budget: closed } }), plain, FIXED_SAY.resting],
    ];
    for (const [name, { step, report }, site, say] of refusing) {
      const guide = newGuide();
      // The model is not asked, so this costs the sender nothing.
      assert.deepEqual(await step(site, guide, 0, HOME), { target: null, status: "stuck", say, paused: true }, name);
      assert.equal(await kept(guide), undefined, name);
      const said = await hearing(() => report(site, guide, { outcome: "finished" }));
      assert.equal(await kept(guide), undefined, name);
      assert.match(said, /came for a guide that is not on record/, name);
    }
    // A guide that began while the site was on, and met the switch at a later step, is on record and ends as the widget reports.
    const began = server();
    const guide = newGuide();
    await began.step(plain, guide, 0, HOME);
    const paused = server({ parts: { isOff: () => true } });
    assert.equal((await paused.step(plain, guide, 1, BILLING)).paused, true);
    await paused.report(plain, guide, { outcome: "error" });
    assert.deepEqual(await kept(guide), { outcome: "error", ended: true, helped: null, step_count: 1, steps: 1, models: "mock" });
  });

  test("a guide the model was stuck on is stored as that, whatever is reported", async () => {
    const { step, report } = server();
    const guide = newGuide();
    assert.equal((await step(plain, guide, 0, BILLING)).status, "stuck");
    await hearing(() => report(plain, guide, { outcome: "finished" }));
    assert.equal((await kept(guide))?.outcome, "nothing_to_point_at");
  });

  test("a guide that ended on a control the owner ruled out, or in words on a site with Answers on, is stored as that", async () => {
    const { step, report } = server();
    // The first step points at Billing. The second names the link home, which the owner ruled out, so nothing is pointed at.
    const ruledOut = newGuide();
    await step(ruling, ruledOut, 0, HOME);
    const refused = await step(ruling, ruledOut, 1, BILLING, { event: 'The user clicked link "Billing".', goal: "go home" });
    assert.deepEqual(refused, { target: null, status: "done", say: "I can't help with that here.", blocked: true });
    await hearing(() => report(ruling, ruledOut, { outcome: "finished" }));
    assert.equal((await kept(ruledOut))?.outcome, "blocked");

    const answered = newGuide();
    assert.equal((await step(answers, answered, 0, BILLING, { goal: "who can invite teammates" })).mode, "answer");
    await hearing(() => report(answers, answered, { outcome: "finished" }));
    assert.equal((await kept(answered))?.outcome, "answered");
  });

  test("a step for one site that names another site's guide changes nothing of that guide, nor how it ends", async () => {
    // The widget makes the guide's id, so anything that can send a step for one site can name a guide of another in it.
    const { step, report } = server();
    const guide = newGuide();
    await step(plain, guide, 0, HOME);
    const row = async () =>
      (await psqlSql(DB)`select said, target_label, mode, reason, sources, overruled, usd, input_tokens, broke, unseen from steps where guide_id = ${guide} and n = 0`)[0];
    const before = await row();
    assert.deepEqual(before, { said: "Click Billing.", target_label: "Billing", mode: null, reason: null, sources: null, overruled: null, usd: null, input_tokens: null, broke: null, unseen: null });

    // Through the server: a step for the site with Answers on, from its own page, carrying this guide's id.
    assert.equal((await step(answers, guide, 0, BILLING, { goal: "who can invite teammates" })).mode, "answer");
    // And straight to the store, with everything a step the model answered adds after the step itself.
    const store = new Store(psqlSql(DB) as unknown as ConstructorParameters<typeof Store>[0], 3, { reportWaitsMs: [0] });
    const measure: TurnMeasure = {
      reply: { target: null, status: "done", say: "The help docs don't cover that.", mode: "cannot_help", reason: "not_covered" },
      model: "claude-sonnet-5-5",
      ms: 900,
      msToTarget: 900,
      wrote: "The help docs don't cover that.",
      broke: ["link"],
      cited: ["help/teammates.md"],
      overruled: "no_source",
      tokens: { input: 600, cacheRead: 0, cacheWrite: 0, output: 40 },
      usd: 0.01,
      unseen: ["Invite teammate"],
    };
    await store.recordStep({ site: answers.id, guide, goal: "who can invite teammates", step: 0, history: [], snapshot: BILLING }, measure, ORIGIN);
    assert.deepEqual(await row(), before);
    const [owner] = await psqlSql(DB)`select site_id from guides where id = ${guide}`;
    assert.equal(owner?.site_id, plain.id);

    // So the step the guide's own visitor used still bears out the ending the widget reports.
    await report(plain, guide, { outcome: "finished" });
    assert.equal((await kept(guide))?.outcome, "finished");
  });

  test("the report still counts when it arrives before the step that ends the guide is written", async () => {
    // The widget reports the moment the last reply shows, as the page may be going, and the step's row is written after
    // the reply has gone out, here by another process. The report waits for it.
    const { step, report } = server({ stepsLandAfterMs: 150 });
    const guide = newGuide();
    scriptMock({ target: "e1", status: "done", say: "Billing is this link." });
    await step(plain, guide, 0, HOME, {}, false);
    await report(plain, guide, { outcome: "finished" });
    assert.deepEqual(await kept(guide), { outcome: "finished", ended: true, helped: null, step_count: 1, steps: 1, models: "mock" });
  });

  test("a report is judged by the step it names, so the look after the last control cannot change it", async () => {
    // The visitor followed a step, and the last reply (step 1) pointed at what they asked for. They used it, and the widget
    // reported finished at once, naming step 1. Then the look at what came of the click (step 2) was answered: the model
    // found nothing more to point at. Here that look is written before the report is read, as when the report is held up.
    const { step, report } = server();
    const ask = async (guide: string) => {
      await step(plain, guide, 0, HOME);
      scriptMock({ target: "e1", status: "done", say: "This is the billing page. Home is here." });
      await step(plain, guide, 1, BILLING, { event: 'The user clicked link "Billing".' });
      scriptMock({ target: null, status: "stuck", say: "I don't see anything more to do here." });
      await step(plain, guide, 2, BILLING, { event: 'The user clicked link "Home".', closing: true });
      assert.deepEqual(await kept(guide), { outcome: null, ended: false, helped: null, step_count: 3, steps: 3, models: "mock,mock,mock" });
    };
    const named = newGuide();
    await ask(named);
    await report(plain, named, { outcome: "finished", step: 1 });
    assert.equal((await kept(named))?.outcome, "finished");

    // A widget too old to name its step is judged by the newest step on record, as before: here, the look that found nothing.
    const unnamed = newGuide();
    await ask(unnamed);
    await hearing(() => report(plain, unnamed, { outcome: "finished" }));
    assert.equal((await kept(unnamed))?.outcome, "nothing_to_point_at");

    // A step that is never on record is waited for, and then the newest is what is judged.
    const missing = newGuide();
    await ask(missing);
    const said = await hearing(() => report(plain, missing, { outcome: "finished", step: 7 }));
    assert.equal((await kept(missing))?.outcome, "nothing_to_point_at");
    assert.match(said, /but the newest step 2 on record does not bear it out/);
  });

  test("in Do it with me, the click that commits finishes the guide, also when the reply that pointed at it said continue", async () => {
    const { step, report } = server();
    const act = { version: 3, mode: "act", goal: "create card" };
    // The hand-over as the model is asked to write it: done, pointing at the control that commits.
    const handed = newGuide();
    const reply = await step(acting, handed, 0, FORM, act);
    assert.deepEqual({ target: reply.target, status: reply.status, commits: reply.commits, mode: reply.mode }, { target: "e1", status: "done", commits: true, mode: "act" });
    await report(acting, handed, { outcome: "finished" });
    assert.equal((await kept(handed))?.outcome, "finished");

    // A reply that says to click it and that it commits contradicts itself. The click is taken off it and the widget
    // treats it as the hand-over, so the visitor's click finishes the guide though the step on record says "continue".
    const contradicted = newGuide();
    scriptMock({ target: "e1", do: "click", enter: null, commits: true, status: "continue", say: "Creating the card." });
    const second = await step(acting, contradicted, 0, FORM, act);
    assert.deepEqual({ status: second.status, do: second.do, commits: second.commits, withheld: second.withheld }, { status: "continue", do: null, commits: true, withheld: "contradiction" });
    await report(acting, contradicted, { outcome: "finished" });
    assert.equal((await kept(contradicted))?.outcome, "finished");
  });

  test("a step past the cap on acting, which the model is not asked for, starts no guide and finishes none", async () => {
    const { step, report } = server();
    const capped = { version: 3, mode: "act", goal: "create card" };
    // On its own: the server answers "done" for nothing, so it must not be able to put a guide on record.
    const alone = newGuide();
    assert.deepEqual(await step(acting, alone, 100, FORM, capped), { target: null, status: "done", say: "That's as far as I'll go on my own.", mode: "act", withheld: "cap" });
    assert.equal(await kept(alone), undefined);
    await hearing(() => report(acting, alone, { outcome: "finished" }));
    assert.equal(await kept(alone), undefined);

    // After steps the model did answer: the capped step joins the guide, which ran out of steps and did not finish.
    const real = newGuide();
    await step(acting, real, 0, { ...FORM, elements: [{ id: "e1", role: "link", label: "Cards" }] }, { ...capped, goal: "open cards" });
    await step(acting, real, 100, FORM, capped);
    assert.deepEqual(await kept(real), { outcome: null, ended: false, helped: null, step_count: 101, steps: 2, models: `mock,${NO_MODEL}` });
    const said = await hearing(() => report(acting, real, { outcome: "finished" }));
    assert.equal((await kept(real))?.outcome, "step_limit");
    assert.match(said, /so it is kept as step_limit/);
  });
  test("a finished guide on a paying company's site goes to Stripe at once, and one that isn't finished doesn't", async () => {
    exec(
      DB,
      `update sites set company_id = '${PAYING_ORG}' where id = '${paying.id}';
       insert into billing (organization_id, stripe_customer_id, stripe_subscription_id, plan, status, metered_from)
         values ('${PAYING_ORG}', 'cus_paying', 'sub_paying', 'team', 'active', now() - interval '1 day');`,
    );
    const sent: URLSearchParams[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), "https://api.stripe.com/v1/billing/meter_events");
      sent.push(new URLSearchParams(String(init?.body)));
      return Response.json({ object: "billing.meter_event" });
    }) as typeof fetch;
    try {
      const { step, report } = server({ stripeKey: "sk_test_not_a_real_key" });
      const finished = newGuide();
      await step(paying, finished, 0, HOME);
      await step(paying, finished, 1, BILLING, { event: 'The user clicked link "Billing".' });
      await report(paying, finished, { outcome: "finished" });
      const stopped = newGuide();
      await step(paying, stopped, 0, HOME);
      await report(paying, stopped, { outcome: "stopped" });
      assert.deepEqual(
        sent.map((form) => [form.get("identifier"), form.get("payload[stripe_customer_id]"), form.get("payload[value]")]),
        [[finished, "cus_paying", "1"]],
      );
      const [row] = await psqlSql(DB)`select billed_at is not null as billed from guides where id = ${finished}`;
      assert.equal(row?.billed, true);
    } finally {
      globalThis.fetch = real;
    }
  });
});
