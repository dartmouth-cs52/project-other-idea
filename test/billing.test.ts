import assert from "node:assert/strict";
import { before, beforeEach, describe, test } from "node:test";
import { METER_EVENT, reportUsage } from "../src/shared/billing.ts";
import { formEncode, signForTest, stripe, StripeError, verifiedEvent, WEBHOOK_TOLERANCE_S } from "../src/shared/stripe.ts";
import { cents, lookupKey, monthTotal, paidPlan, paidPlans, priceSpecs } from "../web/lib/billing-plans.ts";
import { pricing } from "../web/lib/site.ts";
import { billingRoutes, billingSweep, nextMonthStart, stripeWebhook, subscriptionOf, type BillingRequest } from "../web/worker/billing.ts";
import { exec, freshDatabase, psqlSql, TEST_DATABASE_URL, testDatabase } from "./psql.ts";

// Billing through Stripe: the prices worked out from lib/site.ts, the webhook's
// signature check, keeping a company's row current from its subscription, and
// sending each finished guide to Stripe once. Stripe itself is played by a
// function in place of fetch, so nothing leaves the process and no key is needed.

const DB = testDatabase("billing");
const KEY = "sk_test_not_a_real_key";
const SECRET = "whsec_test_secret";
const ORG = "00000000-0000-4000-8000-0000000000c1";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000c2";

describe("prices from lib/site.ts", () => {
  test("each paid plan has a flat monthly price and a graduated price for guides", () => {
    const team = pricing.plans.find((plan) => plan.id === "team")!;
    const specs = priceSpecs();
    assert.deepEqual(
      specs.map((spec) => spec.lookupKey),
      paidPlans().flatMap((plan) => [lookupKey(plan.id, "monthly"), lookupKey(plan.id, "guides")]),
    );
    const monthly = specs.find((spec) => spec.lookupKey === "haptic_team_monthly")!;
    assert.equal(monthly.unitAmountDecimal, String(team.monthlyUsd * 100));
    const guides = specs.find((spec) => spec.lookupKey === "haptic_team_guides")!;
    assert.deepEqual(guides.tiers, [
      { upTo: team.includedGuides, unitAmountDecimal: "0" },
      { upTo: "inf", unitAmountDecimal: cents(team.overageUsd!) },
    ]);
  });

  test("free and agreed plans are not for sale in the dashboard", () => {
    assert.deepEqual(paidPlans().map((plan) => plan.id), ["team", "scale"]);
    assert.equal(paidPlan("early-access"), undefined);
    assert.equal(paidPlan("enterprise"), undefined);
  });

  test("a month of 1,200 finished guides on Team is $149 plus 200 at $0.12", () => {
    assert.deepEqual(monthTotal(paidPlan("team")!, 1200), { monthly: 149, overage: 24, extra: 200, total: 173 });
    assert.deepEqual(monthTotal(paidPlan("team")!, 1000), { monthly: 149, overage: 0, extra: 0, total: 149 });
  });

  test("dollars become cents without rounding a fraction of a cent away", () => {
    assert.equal(cents(0.12), "12");
    assert.equal(cents(0.08), "8");
    assert.equal(cents(0.125), "12.5");
    assert.equal(cents(499), "49900");
  });

  test("a subscription renews at midnight UTC on the first", () => {
    assert.equal(nextMonthStart(new Date("2026-11-17T12:00:00Z")), Date.UTC(2026, 11, 1) / 1000);
    assert.equal(nextMonthStart(new Date("2026-12-31T23:59:59Z")), Date.UTC(2027, 0, 1) / 1000);
  });
});

describe("talking to Stripe", () => {
  test("parameters are form encoded the way Stripe reads them", () => {
    const form = formEncode({ line_items: [{ price: "price_1", quantity: 1 }, { price: "price_2" }], metadata: { plan: "team" }, skip: undefined, clear: null });
    assert.equal(form.toString(), "line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&line_items%5B1%5D%5Bprice%5D=price_2&metadata%5Bplan%5D=team&clear=");
  });

  test("an error comes back with Stripe's code", async () => {
    const fake = (async () => Response.json({ error: { message: "No such customer", code: "resource_missing", type: "invalid_request_error" } }, { status: 404 })) as typeof fetch;
    await assert.rejects(stripe(KEY, "GET", "/v1/customers/cus_x", {}, { fetch: fake }), (error: StripeError) => error.status === 404 && error.code === "resource_missing");
  });
});

describe("webhook signatures", () => {
  const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", created: 1, livemode: false, data: { object: { id: "in_1" } } });

  test("Stripe's signature of the exact body is accepted", async () => {
    const event = await verifiedEvent(body, await signForTest(body, SECRET), SECRET);
    assert.equal(event?.id, "evt_1");
  });

  test("a wrong secret, a changed body, an old signature or none at all is refused", async () => {
    assert.equal(await verifiedEvent(body, await signForTest(body, "whsec_other"), SECRET), undefined);
    assert.equal(await verifiedEvent(body.replace("in_1", "in_2"), await signForTest(body, SECRET), SECRET), undefined);
    const old = Math.floor(Date.now() / 1000) - WEBHOOK_TOLERANCE_S - 1;
    assert.equal(await verifiedEvent(body, await signForTest(body, SECRET, old), SECRET), undefined);
    assert.equal(await verifiedEvent(body, null, SECRET), undefined);
    assert.equal(await verifiedEvent(body, "t=1,v1=", SECRET), undefined);
  });

  test("only v1 signatures count", async () => {
    const v1 = await signForTest(body, SECRET);
    assert.equal(await verifiedEvent(body, v1.replace("v1=", "v0="), SECRET), undefined);
  });

  test("an event names its subscription wherever Stripe puts it", () => {
    const event = (type: string, object: Record<string, unknown>) => ({ id: "evt", type, created: 0, livemode: false, data: { object } });
    assert.equal(subscriptionOf(event("checkout.session.completed", { mode: "subscription", subscription: "sub_1" })), "sub_1");
    assert.equal(subscriptionOf(event("checkout.session.completed", { mode: "payment", subscription: null })), undefined);
    assert.equal(subscriptionOf(event("customer.subscription.updated", { id: "sub_2" })), "sub_2");
    assert.equal(subscriptionOf(event("invoice.paid", { parent: { subscription_details: { subscription: "sub_3" } } })), "sub_3");
    assert.equal(subscriptionOf(event("invoice.payment_failed", { subscription: "sub_4" })), "sub_4");
  });
});

// Against a real Postgres -----------------------------------------------------

/** Stripe, as far as billing uses it. */
class FakeStripe {
  subscriptions = new Map<string, Record<string, unknown>>();
  meterEvents: { identifier: string; customer: string; timestamp: number }[] = [];
  customers: { id: string; idempotency: string | null }[] = [];
  updates: { id: string; form: URLSearchParams }[] = [];
  checkouts: URLSearchParams[] = [];
  /** Answer meter events with this status, to play an outage. */
  meterStatus = 200;

  fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.hostname, "api.stripe.com", `an unexpected call to ${url}`);
    const method = init?.method ?? "GET";
    const form = new URLSearchParams(String(init?.body ?? ""));
    const headers = new Headers(init?.headers);
    const path = url.pathname;
    if (method === "POST" && path === "/v1/billing/meter_events") {
      if (this.meterStatus !== 200) return Response.json({ error: { message: "Down" } }, { status: this.meterStatus });
      const identifier = form.get("identifier")!;
      if (this.meterEvents.some((event) => event.identifier === identifier)) {
        // Word for word what Stripe answers, with no code, as seen in test mode.
        return Response.json({ error: { message: `An event already exists with identifier ${identifier}.`, type: "invalid_request_error" } }, { status: 400 });
      }
      this.meterEvents.push({ identifier, customer: form.get("payload[stripe_customer_id]")!, timestamp: Number(form.get("timestamp")) });
      return Response.json({ object: "billing.meter_event", identifier });
    }
    const subscription = /^\/v1\/subscriptions\/([^/]+)$/.exec(path)?.[1];
    if (subscription && method === "GET") {
      const found = this.subscriptions.get(subscription);
      return found ? Response.json(found) : Response.json({ error: { message: "No such subscription", code: "resource_missing" } }, { status: 404 });
    }
    if (subscription && method === "POST") {
      this.updates.push({ id: subscription, form });
      const found = this.subscriptions.get(subscription)!;
      const items = (found.items as { data: Record<string, unknown>[] }).data;
      for (let index = 0; form.has(`items[${index}][id]`); index++) {
        const item = items.find((one) => one.id === form.get(`items[${index}][id]`))!;
        item.price = price(form.get(`items[${index}][price]`)!);
      }
      return Response.json(found);
    }
    if (method === "POST" && path === "/v1/customers") {
      const idempotency = headers.get("idempotency-key");
      const again = this.customers.find((customer) => idempotency && customer.idempotency === idempotency);
      if (again) return Response.json({ id: again.id });
      const id = `cus_${this.customers.length + 1}`;
      this.customers.push({ id, idempotency });
      return Response.json({ id });
    }
    if (method === "GET" && path === "/v1/prices") {
      const keys = [...url.searchParams.entries()].filter(([name]) => name.startsWith("lookup_keys")).map(([, value]) => value);
      return Response.json({ data: keys.map((key) => ({ id: `price_${key}`, lookup_key: key })) });
    }
    if (method === "POST" && path === "/v1/checkout/sessions") {
      this.checkouts.push(form);
      return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    }
    if (method === "POST" && path === "/v1/billing_portal/sessions") return Response.json({ url: "https://billing.stripe.com/p/session/1" });
    throw new Error(`The fake Stripe doesn't answer ${method} ${path}`);
  }) as typeof fetch;
}

/** A price as Stripe sends it inside a subscription item, from one of our lookup keys (`price_haptic_team_monthly`). */
function price(id: string) {
  const key = id.replace(/^price_/, "");
  const match = /^haptic_(.+)_(monthly|guides)$/.exec(key);
  return { id, lookup_key: key, metadata: match ? { haptic_plan: match[1]!.replace(/_/g, "-"), haptic_part: match[2]! } : {} };
}

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);

function subscription(id: string, customer: string, plan: string, changes: Record<string, unknown> = {}) {
  const start = now() - 10 * DAY;
  return {
    id,
    object: "subscription",
    customer,
    status: "active",
    metadata: { organization_id: ORG },
    start_date: start,
    ended_at: null,
    cancel_at: null,
    cancel_at_period_end: false,
    items: {
      data: [
        { id: `si_${id}_monthly`, price: price(`price_haptic_${plan}_monthly`), current_period_start: start, current_period_end: start + 30 * DAY },
        { id: `si_${id}_guides`, price: price(`price_haptic_${plan}_guides`), current_period_start: start, current_period_end: start + 30 * DAY },
      ],
    },
    ...changes,
  };
}

let eventCount = 0;
async function deliver(fake: FakeStripe, type: string, object: Record<string, unknown>, options: { secret?: string; id?: string; livemode?: boolean } = {}) {
  const event = { id: options.id ?? `evt_${++eventCount}`, type, created: now(), livemode: options.livemode ?? false, data: { object } };
  const body = JSON.stringify(event);
  const request = new Request("https://joinhaptic.com/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": await signForTest(body, options.secret ?? SECRET) } });
  globalThis.fetch = fake.fetch;
  const response = await stripeWebhook(request, { STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET }, psqlSql(DB) as never);
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, event };
}

function billingRow(org = ORG) {
  return psqlSql(DB)`select plan, status, stripe_customer_id, stripe_subscription_id, cancel_at, metered_from, metered_until, livemode, period_end from billing where organization_id = ${org}`.then((rows) => rows[0]);
}

describe("the webhook and the company's row", { skip: !TEST_DATABASE_URL && "set TEST_DATABASE_URL to run against Postgres" }, () => {
  let fake: FakeStripe;
  before(() => freshDatabase(DB));
  beforeEach(() => {
    exec(DB, "truncate billing, stripe_events, guides, sites cascade;");
    fake = new FakeStripe();
  });

  test("a bad signature is refused and changes nothing", async () => {
    fake.subscriptions.set("sub_a", subscription("sub_a", "cus_a", "team"));
    const answer = await deliver(fake, "customer.subscription.created", { id: "sub_a" }, { secret: "whsec_wrong" });
    assert.equal(answer.status, 400);
    assert.equal(await billingRow(), undefined);
  });

  test("a new subscription shows its plan, from Stripe's copy of it", async () => {
    fake.subscriptions.set("sub_a", subscription("sub_a", "cus_a", "team"));
    // The event's own copy says Scale. What Stripe holds now is what counts.
    const answer = await deliver(fake, "checkout.session.completed", { id: "cs_test_1", mode: "subscription", subscription: "sub_a", plan: "scale" });
    assert.equal(answer.status, 200);
    const row = await billingRow();
    assert.equal(row?.plan, "team");
    assert.equal(row?.status, "active");
    assert.equal(row?.stripe_customer_id, "cus_a");
    assert.ok(row?.metered_from);
    assert.equal(row?.metered_until, null);
  });

  test("the same event twice changes nothing the second time", async () => {
    fake.subscriptions.set("sub_a", subscription("sub_a", "cus_a", "team"));
    const first = await deliver(fake, "customer.subscription.created", { id: "sub_a" }, { id: "evt_same" });
    assert.equal(first.status, 200);
    // Meanwhile the subscription moved on. The repeat must not be applied.
    fake.subscriptions.set("sub_a", subscription("sub_a", "cus_a", "scale"));
    const second = await deliver(fake, "customer.subscription.created", { id: "sub_a" }, { id: "evt_same" });
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal((await billingRow())?.plan, "team");
  });

  test("cancelling at the end of the period, then the end itself", async () => {
    fake.subscriptions.set("sub_a", subscription("sub_a", "cus_a", "team"));
    await deliver(fake, "customer.subscription.created", { id: "sub_a" });
    const end = now() + 20 * DAY;
    fake.subscriptions.set("sub_a", subscription("sub_a", "cus_a", "team", { cancel_at: end }));
    await deliver(fake, "customer.subscription.updated", { id: "sub_a" });
    let row = await billingRow();
    assert.equal(row?.plan, "team");
    assert.equal(new Date(String(row?.cancel_at)).getTime(), end * 1000);
    fake.subscriptions.set("sub_a", subscription("sub_a", "cus_a", "team", { status: "canceled", ended_at: end }));
    await deliver(fake, "customer.subscription.deleted", { id: "sub_a" });
    row = await billingRow();
    assert.equal(row?.plan, "early-access");
    assert.equal(row?.status, "canceled");
    assert.equal(new Date(String(row?.metered_until)).getTime(), end * 1000);
  });

  test("a payment that fails, then one that goes through", async () => {
    fake.subscriptions.set("sub_a", subscription("sub_a", "cus_a", "team", { status: "past_due" }));
    await deliver(fake, "invoice.payment_failed", { id: "in_1", parent: { subscription_details: { subscription: "sub_a" } } });
    assert.equal((await billingRow())?.status, "past_due");
    fake.subscriptions.set("sub_a", subscription("sub_a", "cus_a", "team"));
    await deliver(fake, "invoice.paid", { id: "in_2", parent: { subscription_details: { subscription: "sub_a" } } });
    assert.equal((await billingRow())?.status, "active");
  });

  test("a late event about an ended subscription doesn't undo a newer one", async () => {
    fake.subscriptions.set("sub_new", subscription("sub_new", "cus_a", "scale"));
    await deliver(fake, "customer.subscription.created", { id: "sub_new" });
    fake.subscriptions.set("sub_old", subscription("sub_old", "cus_a", "team", { status: "canceled", ended_at: now() - DAY }));
    await deliver(fake, "customer.subscription.deleted", { id: "sub_old" });
    const row = await billingRow();
    assert.equal(row?.stripe_subscription_id, "sub_new");
    assert.equal(row?.plan, "scale");
  });

  test("a subscription for a customer that is no company here is left alone", async () => {
    fake.subscriptions.set("sub_x", subscription("sub_x", "cus_x", "team", { metadata: {} }));
    const answer = await deliver(fake, "customer.subscription.created", { id: "sub_x" });
    assert.equal(answer.status, 200);
    assert.equal(await billingRow(), undefined);
  });

  test("a subscription deleted from Stripe is acknowledged, so Stripe stops sending it", async () => {
    const answer = await deliver(fake, "customer.subscription.updated", { id: "sub_gone" });
    assert.equal(answer.status, 200);
  });
});

describe("finished guides sent to Stripe", { skip: !TEST_DATABASE_URL && "set TEST_DATABASE_URL to run against Postgres" }, () => {
  let fake: FakeStripe;
  const sql = () => psqlSql(DB);
  before(() => freshDatabase(DB));
  beforeEach(() => {
    exec(DB, "truncate billing, stripe_events, guides, sites cascade;");
    exec(
      DB,
      `insert into sites (id, company_id, name, origin, context) values
        ('site_paid01', '${ORG}', 'Paid', 'https://paid.test', '{}'),
        ('site_other01', '${OTHER_ORG}', 'Other', 'https://other.test', '{}'),
        ('site_byhand01', null, 'By hand', 'https://byhand.test', '{}');
       insert into billing (organization_id, stripe_customer_id, stripe_subscription_id, plan, status, metered_from, livemode)
         values ('${ORG}', 'cus_paid', 'sub_paid', 'team', 'active', now() - interval '10 days', false);`,
    );
    fake = new FakeStripe();
    globalThis.fetch = fake.fetch;
  });

  let guideCount = 0;
  function guide(site: string, outcome: string | null, endedDaysAgo: number): string {
    const id = `00000000-0000-4000-8000-${String(++guideCount).padStart(12, "0")}`;
    const ended = outcome ? `now() - interval '${endedDaysAgo} days'` : "null";
    exec(DB, `insert into guides (id, site_id, question, question_key, started_path, outcome, ended_at) values ('${id}', '${site}', 'q', 'q', '/', ${outcome ? `'${outcome}'` : "null"}, ${ended});`);
    return id;
  }

  test("each finished guide of a paying company, once", async () => {
    const finished = guide("site_paid01", "finished", 1);
    guide("site_paid01", "stopped", 1);
    guide("site_paid01", "nothing_to_point_at", 1);
    guide("site_paid01", null, 0);
    guide("site_other01", "finished", 1);
    guide("site_byhand01", "finished", 1);
    assert.deepEqual(await reportUsage(sql(), KEY), { sent: 1, failed: 0 });
    assert.deepEqual(
      fake.meterEvents.map((event) => [event.identifier, event.customer]),
      [[finished, "cus_paid"]],
    );
    assert.deepEqual(await reportUsage(sql(), KEY), { sent: 0, failed: 0 });
    assert.equal(fake.meterEvents.length, 1);
  });

  test("only guides finished while the subscription ran", async () => {
    guide("site_paid01", "finished", 20);
    const during = guide("site_paid01", "finished", 5);
    guide("site_paid01", "finished", 1);
    exec(DB, `update billing set metered_until = now() - interval '2 days', status = 'canceled', plan = 'early-access' where organization_id = '${ORG}';`);
    await reportUsage(sql(), KEY);
    assert.deepEqual(fake.meterEvents.map((event) => event.identifier), [during]);
  });

  test("a guide Stripe already has is marked sent, not counted again", async () => {
    const id = guide("site_paid01", "finished", 1);
    fake.meterEvents.push({ identifier: id, customer: "cus_paid", timestamp: 0 });
    assert.deepEqual(await reportUsage(sql(), KEY), { sent: 1, failed: 0 });
    assert.equal(fake.meterEvents.length, 1);
    const [row] = await sql()`select billed_at from guides where id = ${id}`;
    assert.ok(row?.billed_at);
  });

  test("an outage leaves guides for the hourly sweep", async () => {
    const id = guide("site_paid01", "finished", 1);
    fake.meterStatus = 503;
    assert.deepEqual(await reportUsage(sql(), KEY), { sent: 0, failed: 1 });
    fake.meterStatus = 200;
    await billingSweep({ STRIPE_SECRET_KEY: KEY }, sql() as never);
    assert.deepEqual(fake.meterEvents.map((event) => event.identifier), [id]);
  });

  test("with a guide named, only that guide", async () => {
    guide("site_paid01", "finished", 2);
    const named = guide("site_paid01", "finished", 1);
    await reportUsage(sql(), KEY, { guide: named });
    assert.deepEqual(fake.meterEvents.map((event) => event.identifier), [named]);
  });

  test("a company billed in live mode is never sent with a test key", async () => {
    exec(DB, `update billing set livemode = true where organization_id = '${ORG}';`);
    guide("site_paid01", "finished", 1);
    assert.deepEqual(await reportUsage(sql(), KEY), { sent: 0, failed: 0 });
  });

  test("the event's time is when the guide finished", async () => {
    guide("site_paid01", "finished", 3);
    await reportUsage(sql(), KEY);
    const [event] = fake.meterEvents;
    assert.ok(Math.abs(event!.timestamp - (now() - 3 * DAY)) < 60);
  });

  test("the meter it reports to is the one the setup script makes", () => {
    assert.equal(METER_EVENT, "haptic_finished_guide");
  });
});

describe("the billing page's calls", { skip: !TEST_DATABASE_URL && "set TEST_DATABASE_URL to run against Postgres" }, () => {
  let fake: FakeStripe;
  before(() => freshDatabase(DB));
  beforeEach(() => {
    exec(DB, "truncate billing, stripe_events, guides, sites cascade;");
    fake = new FakeStripe();
    globalThis.fetch = fake.fetch;
  });

  const call = (path: string, role: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<{ status: number; body: Record<string, unknown> }> =>
    billingRoutes({
      request: new Request(`https://joinhaptic.com/api/app${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }),
      env: { STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET },
      sql: psqlSql(DB) as never,
      org: { id: ORG, name: "Example Co", role },
      user: { email: "dana@example.com" },
      path,
      url: new URL(`https://joinhaptic.com/api/app${path}`),
    } satisfies BillingRequest).then((answer) => answer as { status: number; body: Record<string, unknown> });

  test("anyone at the company sees the page; only owners and admins may buy", async () => {
    const page = await call("/billing", "member");
    assert.equal(page.status, 200);
    assert.equal(page.body.canManage, false);
    assert.deepEqual(page.body.plan, { id: "early-access", name: "Early access" });
    assert.equal((await call("/billing/checkout", "member", { plan: "team" })).status, 403);
    assert.equal((await call("/billing/portal", "member", {})).status, 403);
    assert.equal(fake.customers.length, 0);
  });

  test("Checkout starts with both of the plan's prices, and one customer however often it is pressed", async () => {
    const first = await call("/billing/checkout", "owner", { plan: "team" });
    assert.equal(first.status, 200);
    assert.match(String(first.body.url), /^https:\/\/checkout\.stripe\.com\//);
    await call("/billing/checkout", "admin", { plan: "scale" });
    assert.equal(fake.customers.length, 1);
    const form = fake.checkouts[0]!;
    assert.equal(form.get("mode"), "subscription");
    assert.equal(form.get("line_items[0][price]"), "price_haptic_team_monthly");
    assert.equal(form.get("line_items[0][quantity]"), "1");
    assert.equal(form.get("line_items[1][price]"), "price_haptic_team_guides");
    assert.equal(form.get("line_items[1][quantity]"), null);
    assert.equal(form.get("subscription_data[metadata][organization_id]"), ORG);
    assert.equal(form.get("client_reference_id"), ORG);
  });

  test("a plan that isn't for sale is refused", async () => {
    assert.equal((await call("/billing/checkout", "owner", { plan: "enterprise" })).status, 400);
  });

  test("a company with a subscription changes plan instead of buying a second", async () => {
    fake.subscriptions.set("sub_a", subscription("sub_a", "cus_a", "team"));
    await deliver(fake, "customer.subscription.created", { id: "sub_a" });
    assert.equal((await call("/billing/checkout", "owner", { plan: "scale" })).status, 409);
    const switched = await call("/billing/plan", "owner", { plan: "scale" });
    assert.equal(switched.status, 200);
    assert.deepEqual(switched.body.plan, { id: "scale", name: "Scale" });
    const update = fake.updates[0]!.form;
    assert.equal(update.get("items[0][id]"), "si_sub_a_monthly");
    assert.equal(update.get("items[0][price]"), "price_haptic_scale_monthly");
    assert.equal(update.get("items[1][price]"), "price_haptic_scale_guides");
    assert.equal(update.get("proration_behavior"), "create_prorations");
  });

  test("the page counts this period's finished guides across every site", async () => {
    fake.subscriptions.set("sub_a", subscription("sub_a", "cus_a", "team"));
    await deliver(fake, "customer.subscription.created", { id: "sub_a" });
    exec(
      DB,
      `insert into sites (id, company_id, name, origin, context) values ('site_one001', '${ORG}', 'One', 'https://one.test', '{}'), ('site_two001', '${ORG}', 'Two', 'https://two.test', '{}');
       insert into guides (id, site_id, question, question_key, started_path, outcome, ended_at) values
         ('00000000-0000-4000-9000-000000000001', 'site_one001', 'q', 'q', '/', 'finished', now() - interval '1 day'),
         ('00000000-0000-4000-9000-000000000002', 'site_two001', 'q', 'q', '/', 'finished', now() - interval '2 days'),
         ('00000000-0000-4000-9000-000000000003', 'site_two001', 'q', 'q', '/', 'stopped', now() - interval '2 days'),
         ('00000000-0000-4000-9000-000000000004', 'site_two001', 'q', 'q', '/', 'finished', now() - interval '40 days');`,
    );
    const page = await call("/billing", "member");
    assert.equal(page.body.finished, 2);
    assert.deepEqual(
      (page.body.sites as { id: string; finished: number }[]).map((site) => [site.id, site.finished]),
      [
        ["site_one001", 1],
        ["site_two001", 1],
      ],
    );
  });
});
