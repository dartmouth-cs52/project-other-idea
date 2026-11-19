// Billing, through Stripe. The plans and their prices are `pricing` in
// lib/site.ts; lib/billing-plans.ts says what Stripe holds for each, and
// scripts/stripe-setup.ts makes it there.
//
//   GET  /api/app/billing             the company's plan, its period, and finished guides so far
//   POST /api/app/billing/checkout    start a subscription to a paid plan, through Stripe Checkout
//   POST /api/app/billing/portal      Stripe's customer portal: card, invoices, cancelling
//   POST /api/app/billing/plan        move a subscription between paid plans
//   POST /api/stripe/webhook          Stripe telling us something changed
//
// Only a company's owners and admins can start, change or manage a
// subscription. Everyone at the company can see the page.
//
// The portal cannot change the plan of a subscription with a metered price,
// so moving between Team and Scale is done here, through the API, and the
// portal is for everything else.
//
// What the database holds about a subscription is written in one place,
// `syncSubscription`, from the subscription as Stripe has it at that moment.
// Webhooks only say which subscription to look at. So events that arrive out
// of order, late or twice all leave the same row behind.
//
// When a company goes over its included guides, or a payment fails, Haptic
// keeps guiding its users. Switching it off would break the company's product
// in front of its own customers. The dashboard says so instead.

import { reportUsage } from "../../src/shared/billing";
import { isTestKey, stripe, StripeError, verifiedEvent, type StripeEvent } from "../../src/shared/stripe";
import { FREE_PLAN, lookupKey, paidPlan, paidPlans, planName, type PaidPlan } from "../lib/billing-plans";
import { boundedText } from "./body";
import { database, type Organization, type Sql } from "./db";

export interface BillingEnv {
  DATABASE_URL?: string;
  /** Stripe's secret key, test or live. A secret. */
  STRIPE_SECRET_KEY?: string;
  /** Signs the webhooks Stripe sends to WEBHOOK_PATH. A secret, from the endpoint's page in Stripe or from the setup script. */
  STRIPE_WEBHOOK_SECRET?: string;
}

export const WEBHOOK_PATH = "/api/stripe/webhook";

/** The events the webhook endpoint is subscribed to. The setup script registers exactly these. */
export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

/** A subscription in these has ended for good. Any other status still counts as the company's subscription. */
const ENDED = ["canceled", "incomplete_expired"];
/** A plan can be changed only from these. */
const CHANGEABLE = ["active", "trialing", "past_due"];
/** Who may pay, change plan or open the portal. */
const MANAGERS = ["owner", "admin"];

export type Answer = { status: number; body: unknown };

export interface BillingRequest {
  request: Request;
  env: BillingEnv;
  sql: Sql;
  org: Organization;
  /** Who is signed in. Only the address is used, as the new Stripe customer's email. Declared here so the tests at the top of the repository don't need Neon Auth's package. */
  user: { email: string };
  path: string;
  url: URL;
}

class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function billingRoutes(call: BillingRequest): Promise<Answer | undefined> {
  if (call.path !== "/billing" && !call.path.startsWith("/billing/")) return undefined;
  const method = call.request.method;
  try {
    if (call.path === "/billing" && method === "GET") {
      const session = call.url.searchParams.get("session");
      if (session) await settleCheckout(call, session);
      return { status: 200, body: await billingStatus(call) };
    }
    if (call.path === "/billing/checkout" && method === "POST") return { status: 200, body: await checkout(call, await body(call.request)) };
    if (call.path === "/billing/portal" && method === "POST") return { status: 200, body: await portal(call) };
    if (call.path === "/billing/plan" && method === "POST") return { status: 200, body: await changePlan(call, await body(call.request)) };
    return { status: 404, body: { error: "Not found." } };
  } catch (error) {
    if (error instanceof Refused) return { status: error.status, body: { error: error.message } };
    if (error instanceof StripeError) {
      console.error(`Stripe refused a billing call (${error.status} ${error.code ?? ""}):`, error.message);
      return { status: 502, body: { error: "Stripe didn't accept that. Try again in a minute." } };
    }
    throw error;
  }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  // Read only so far: a body past the limit is never read in full, and reads as empty.
  const text = await boundedText(request, 2_000);
  if (text === null) return {};
  try {
    const value = JSON.parse(text || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// What the page shows ---------------------------------------------------------

interface BillingRow {
  organization_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
  status: string | null;
  period_start: string | null;
  period_end: string | null;
  cancel_at: string | null;
  livemode: boolean;
}

/** The company's row, or nothing when it has none or its ids are from Stripe's other mode. */
async function billingRow(sql: Sql, org: string, key: string | undefined): Promise<BillingRow | undefined> {
  const [row] = (await sql`
    select organization_id, stripe_customer_id, stripe_subscription_id, plan, status, period_start, period_end, cancel_at, livemode
    from billing where organization_id = ${org}`) as BillingRow[];
  if (!row) return undefined;
  if (key && row.livemode === isTestKey(key)) return undefined;
  return row;
}

function hasSubscription(row: BillingRow | undefined): row is BillingRow & { stripe_subscription_id: string; status: string } {
  return Boolean(row?.stripe_subscription_id && row.status && !ENDED.includes(row.status));
}

/** The calendar month under way, in UTC: the period for a company with no subscription. */
function calendarMonth(now = new Date()): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
}

export async function billingStatus(call: Pick<BillingRequest, "env" | "sql" | "org">) {
  const { env, sql, org } = call;
  const key = env.STRIPE_SECRET_KEY;
  const row = await billingRow(sql, org.id, key);
  const subscribed = hasSubscription(row);
  const period = subscribed && row.period_start && row.period_end ? { start: new Date(row.period_start), end: new Date(row.period_end) } : calendarMonth();
  const sites = (await sql`
    select s.id, s.name,
      count(g.id)::int as finished,
      count(g.id) filter (where g.billed_at is not null)::int as sent
    from sites s
    left join guides g on g.site_id = s.id and g.outcome = 'finished' and g.ended_at >= ${period.start.toISOString()} and g.ended_at < ${period.end.toISOString()}
    where s.company_id = ${org.id}
    group by s.id, s.name, s.created_at
    order by s.created_at`) as { id: string; name: string; finished: number; sent: number }[];
  const plan = subscribed ? row.plan : FREE_PLAN;
  return {
    ready: Boolean(key && env.STRIPE_WEBHOOK_SECRET),
    testMode: key ? isTestKey(key) : false,
    canManage: MANAGERS.includes(org.role),
    plan: { id: plan, name: planName(plan) },
    subscription: subscribed
      ? { status: row.status, cancelAt: row.cancel_at, periodEnd: row.period_end }
      : null,
    hasCustomer: Boolean(row?.stripe_customer_id),
    period: { start: period.start.toISOString(), end: period.end.toISOString(), kind: subscribed ? "billing" : "month" },
    finished: sites.reduce((sum, site) => sum + Number(site.finished), 0),
    sent: sites.reduce((sum, site) => sum + Number(site.sent), 0),
    sites: sites.map((site) => ({ id: site.id, name: site.name, finished: Number(site.finished) })),
    plans: paidPlans(),
  };
}

// Starting, changing and managing a subscription ---------------------------------

function manager(call: BillingRequest): string {
  if (!MANAGERS.includes(call.org.role)) throw new Refused(403, "Only an owner or admin of your company can change billing.");
  const key = call.env.STRIPE_SECRET_KEY;
  if (!key) throw new Refused(503, "Billing isn't set up on this server yet.");
  return key;
}

/** The company's Stripe customer, made the first time anyone there starts to subscribe. */
async function ensureCustomer(call: BillingRequest, key: string): Promise<string> {
  const { sql, org, user } = call;
  const row = await billingRow(sql, org.id, key);
  if (row?.stripe_customer_id) return row.stripe_customer_id;
  const live = !isTestKey(key);
  // Keyed by the company and the mode, so pressing twice, or two people at once, makes one customer.
  const customer = await stripe<{ id: string }>(
    key,
    "POST",
    "/v1/customers",
    { name: org.name, email: user.email, metadata: { organization_id: org.id } },
    { idempotencyKey: `haptic-customer-${live ? "live" : "test"}-${org.id}` },
  );
  // A row from Stripe's other mode is started over: its ids mean nothing here.
  const [saved] = await sql`
    insert into billing (organization_id, stripe_customer_id, livemode) values (${org.id}, ${customer.id}, ${live})
    on conflict (organization_id) do update set
      stripe_customer_id = case when billing.livemode = excluded.livemode then coalesce(billing.stripe_customer_id, excluded.stripe_customer_id) else excluded.stripe_customer_id end,
      stripe_subscription_id = case when billing.livemode = excluded.livemode then billing.stripe_subscription_id end,
      plan = case when billing.livemode = excluded.livemode then billing.plan else ${FREE_PLAN} end,
      status = case when billing.livemode = excluded.livemode then billing.status end,
      period_start = case when billing.livemode = excluded.livemode then billing.period_start end,
      period_end = case when billing.livemode = excluded.livemode then billing.period_end end,
      cancel_at = case when billing.livemode = excluded.livemode then billing.cancel_at end,
      metered_from = case when billing.livemode = excluded.livemode then billing.metered_from end,
      metered_until = case when billing.livemode = excluded.livemode then billing.metered_until end,
      livemode = excluded.livemode,
      updated_at = now()
    returning stripe_customer_id`;
  return String(saved?.stripe_customer_id ?? customer.id);
}

interface PriceRow {
  id: string;
  lookup_key: string | null;
}

/** The two prices of a plan, found by their lookup keys, so a price changed by the setup script is picked up without a deploy. */
async function planPrices(key: string, plan: PaidPlan): Promise<{ monthly: string; guides: string }> {
  const keys = [lookupKey(plan.id, "monthly"), lookupKey(plan.id, "guides")];
  const { data } = await stripe<{ data: PriceRow[] }>(key, "GET", "/v1/prices", { lookup_keys: keys, active: true });
  const monthly = data.find((price) => price.lookup_key === keys[0])?.id;
  const guides = data.find((price) => price.lookup_key === keys[1])?.id;
  if (!monthly || !guides) {
    console.error(`Stripe has no active prices with the lookup keys ${keys.join(" and ")}. Run scripts/stripe-setup.ts.`);
    throw new Refused(503, "Billing isn't set up in Stripe yet.");
  }
  return { monthly, guides };
}

/** Midnight UTC on the first of next month. Subscriptions renew then, so a bill covers the same month the dashboard's lists do. */
export function nextMonthStart(now = new Date()): number {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) / 1000);
}

async function checkout(call: BillingRequest, input: Record<string, unknown>) {
  const key = manager(call);
  const plan = paidPlan(input.plan);
  if (!plan) throw new Refused(400, "Choose Team or Scale.");
  const row = await billingRow(call.sql, call.org.id, key);
  if (hasSubscription(row)) throw new Refused(409, "Your company already has a subscription. Change its plan on this page instead.");
  const customer = await ensureCustomer(call, key);
  const prices = await planPrices(key, plan);
  const back = `${call.url.origin}/dashboard/?view=billing`;
  const session = await stripe<{ url: string }>(key, "POST", "/v1/checkout/sessions", {
    mode: "subscription",
    customer,
    client_reference_id: call.org.id,
    // The flat fee has a quantity. A metered price must not: the meter counts it.
    line_items: [{ price: prices.monthly, quantity: 1 }, { price: prices.guides }],
    subscription_data: {
      metadata: { organization_id: call.org.id },
      // Flexible billing keeps usage from before a plan change at the price it was used under.
      billing_mode: { type: "flexible" },
      // The first month is prorated, and every bill after it is a calendar month.
      billing_cycle_anchor: nextMonthStart(),
    },
    // An invoice to a company needs its address, and some need a tax id on it.
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    tax_id_collection: { enabled: true },
    success_url: `${back}&session={CHECKOUT_SESSION_ID}`,
    cancel_url: back,
  });
  return { url: session.url };
}

/**
 * Back from Checkout, the page names its session. The webhook usually has the
 * subscription in the database by then, and if it hasn't, this does it, so the
 * page shows the new plan at once. The session must be this company's.
 */
async function settleCheckout(call: BillingRequest, id: string) {
  const key = call.env.STRIPE_SECRET_KEY;
  if (!key || !/^cs_(test|live)_[A-Za-z0-9]{1,200}$/.test(id)) return;
  try {
    const row = await billingRow(call.sql, call.org.id, key);
    if (!row?.stripe_customer_id) return;
    const session = await stripe<{ customer: string | null; subscription: string | null; client_reference_id: string | null }>(key, "GET", `/v1/checkout/sessions/${id}`);
    if (session.customer !== row.stripe_customer_id || session.client_reference_id !== call.org.id || !session.subscription) return;
    await syncSubscription(call.sql, key, session.subscription);
  } catch (error) {
    // The webhook will bring it. The page shows what the database has.
    console.error("Couldn't look up a finished Checkout:", error instanceof Error ? error.message : error);
  }
}

async function portal(call: BillingRequest) {
  const key = manager(call);
  const row = await billingRow(call.sql, call.org.id, key);
  if (!row?.stripe_customer_id) throw new Refused(409, "Your company has no billing account yet. Choose a plan first.");
  const session = await stripe<{ url: string }>(key, "POST", "/v1/billing_portal/sessions", {
    customer: row.stripe_customer_id,
    return_url: `${call.url.origin}/dashboard/?view=billing`,
  });
  return { url: session.url };
}

interface SubscriptionItem {
  id: string;
  price: { id: string; lookup_key: string | null; metadata?: Record<string, string> };
  current_period_start?: number;
  current_period_end?: number;
}

interface Subscription {
  id: string;
  customer: string | { id: string };
  status: string;
  metadata?: Record<string, string>;
  items: { data: SubscriptionItem[] };
  start_date: number;
  ended_at: number | null;
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  /** Before API version 2025-03-31 the period was on the subscription. It is on each item now. */
  current_period_start?: number;
  current_period_end?: number;
}

function partOf(item: SubscriptionItem): string | undefined {
  return item.price.metadata?.haptic_part ?? (item.price.lookup_key?.endsWith("_monthly") ? "monthly" : item.price.lookup_key?.endsWith("_guides") ? "guides" : undefined);
}

/**
 * Moves the subscription to another paid plan at once. The flat fee is
 * prorated onto the next invoice. Guides used before the change are billed at
 * the old plan's rate, and the new plan's included guides start from the
 * change, which is how Stripe rates a metered price swapped in flexible billing.
 */
async function changePlan(call: BillingRequest, input: Record<string, unknown>) {
  const key = manager(call);
  const plan = paidPlan(input.plan);
  if (!plan) throw new Refused(400, "Choose Team or Scale.");
  const row = await billingRow(call.sql, call.org.id, key);
  if (!hasSubscription(row)) throw new Refused(409, "Your company has no subscription to change. Choose a plan to start one.");
  if (!CHANGEABLE.includes(row.status)) throw new Refused(409, "This subscription can't change plan until its payment goes through. Update the card first.");
  const subscription = await stripe<Subscription>(key, "GET", `/v1/subscriptions/${row.stripe_subscription_id}`);
  const monthly = subscription.items.data.find((item) => partOf(item) === "monthly");
  const guides = subscription.items.data.find((item) => partOf(item) === "guides");
  if (!monthly || !guides) throw new Refused(409, "This subscription was set up by hand. Email us to change it.");
  if (monthly.price.metadata?.haptic_plan === plan.id) return billingStatus(call);
  const prices = await planPrices(key, plan);
  await stripe(
    key,
    "POST",
    `/v1/subscriptions/${subscription.id}`,
    {
      items: [
        { id: monthly.id, price: prices.monthly, quantity: 1 },
        { id: guides.id, price: prices.guides },
      ],
      proration_behavior: "create_prorations",
    },
    // Two presses in the same minute make one change.
    { idempotencyKey: `haptic-plan-${subscription.id}-${plan.id}-${Math.floor(Date.now() / 60_000)}` },
  );
  await syncSubscription(call.sql, key, subscription.id);
  return billingStatus(call);
}

// Keeping the database current ---------------------------------------------------

const seconds = (value: number | null | undefined) => (typeof value === "number" ? new Date(value * 1000).toISOString() : null);

/**
 * Reads a subscription from Stripe and writes what the company's row should
 * say about it. The company is the one the subscription's customer belongs to,
 * or, for a customer this database has not seen, the one named in the
 * subscription's metadata, which Checkout puts there.
 *
 * A subscription that has ended never replaces a newer one that is running, so
 * the last event about an old subscription can't undo a new one.
 */
export async function syncSubscription(sql: Sql, key: string, id: string): Promise<"saved" | "unknown" | "kept"> {
  const subscription = await stripe<Subscription>(key, "GET", `/v1/subscriptions/${id}`);
  const customer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const [owner] = await sql`select organization_id from billing where stripe_customer_id = ${customer}`;
  const org = (owner?.organization_id as string | undefined) ?? subscription.metadata?.organization_id;
  if (!org || !/^[0-9a-f-]{36}$/i.test(org)) {
    console.warn(`Subscription ${id} belongs to customer ${customer}, who is no company here. Give the subscription organization_id metadata to tie it to one.`);
    return "unknown";
  }
  const ended = ENDED.includes(subscription.status);
  const monthly = subscription.items.data.find((item) => partOf(item) === "monthly");
  // A subscription made by hand in Stripe, for a price that isn't one of ours, is an agreed one.
  const plan = ended ? FREE_PLAN : (monthly?.price.metadata?.haptic_plan ?? "enterprise");
  const first = subscription.items.data[0];
  const periodStart = seconds(first?.current_period_start ?? subscription.current_period_start);
  const periodEnd = seconds(first?.current_period_end ?? subscription.current_period_end);
  const cancelAt = seconds(subscription.cancel_at) ?? (subscription.cancel_at_period_end ? periodEnd : null);
  // Usage counts from the day the subscription started, once its first payment went through.
  const meteredFrom = ["incomplete", "incomplete_expired"].includes(subscription.status) ? null : seconds(subscription.start_date);
  const meteredUntil = seconds(subscription.ended_at);
  const live = !isTestKey(key);
  const saved = await sql`
    insert into billing (organization_id, stripe_customer_id, stripe_subscription_id, plan, status, period_start, period_end, cancel_at, metered_from, metered_until, livemode)
    values (${org}::uuid, ${customer}, ${id}, ${plan}, ${subscription.status}, ${periodStart}, ${periodEnd}, ${cancelAt}, ${meteredFrom}, ${meteredUntil}, ${live})
    on conflict (organization_id) do update set
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id,
      plan = excluded.plan,
      status = excluded.status,
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      cancel_at = excluded.cancel_at,
      metered_from = excluded.metered_from,
      metered_until = excluded.metered_until,
      livemode = excluded.livemode,
      updated_at = now()
    where billing.stripe_subscription_id is null
      or billing.stripe_subscription_id = excluded.stripe_subscription_id
      or billing.livemode <> excluded.livemode
      or billing.status = any(${ENDED}::text[])
      or not (excluded.status = any(${ENDED}::text[]))
    returning organization_id`;
  return saved.length ? "saved" : "kept";
}

/** The subscription an event is about, if it is about one. */
export function subscriptionOf(event: StripeEvent): string | undefined {
  const object = event.data.object as Record<string, unknown>;
  const id = (value: unknown) => (typeof value === "string" ? value : value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" ? (value as { id: string }).id : undefined);
  if (event.type === "checkout.session.completed") return object.mode === "subscription" ? id(object.subscription) : undefined;
  if (event.type.startsWith("customer.subscription.")) return id(object.id);
  if (event.type.startsWith("invoice.")) {
    // Since API version 2025-03-31 an invoice names its subscription under parent. Before, at the top.
    const parent = object.parent as { subscription_details?: { subscription?: unknown } } | null | undefined;
    return id(parent?.subscription_details?.subscription) ?? id(object.subscription);
  }
  return undefined;
}

const MAX_WEBHOOK_BYTES = 1_000_000;

/**
 * POST /api/stripe/webhook. Refuses anything not signed by Stripe with this
 * endpoint's secret. An event already applied is answered and skipped. An
 * event is recorded as applied only once it has been, so if this fails Stripe
 * sends it again, and it is applied then.
 */
export async function stripeWebhook(request: Request, env: BillingEnv, db?: Sql): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "Use POST." }, { status: 405 });
  const key = env.STRIPE_SECRET_KEY;
  const sql = db ?? (env.DATABASE_URL ? database(env.DATABASE_URL) : undefined);
  if (!key || !env.STRIPE_WEBHOOK_SECRET || !sql) return Response.json({ error: "Billing isn't set up on this server." }, { status: 503 });
  // Read only so far, before the signature is checked, since anyone can post here. What is read is the text
  // Request.text() would give, so the signature, over the bytes as sent, is checked the same.
  const text = await boundedText(request, MAX_WEBHOOK_BYTES);
  if (text === null) return Response.json({ error: "Too large." }, { status: 413 });
  const event = await verifiedEvent(text, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!event) return Response.json({ error: "The signature doesn't match." }, { status: 400 });
  // An endpoint is registered in one mode, so this is a key from the other mode. Nothing here can act on it.
  if (event.livemode === isTestKey(key)) {
    console.warn(`Ignored ${event.type} ${event.id}: it is from Stripe's ${event.livemode ? "live" : "test"} mode, and this server's key is not.`);
    return Response.json({ received: true, ignored: "other mode" });
  }
  const [seen] = await sql`select 1 from stripe_events where id = ${event.id}`;
  if (seen) return Response.json({ received: true, duplicate: true });
  const subscription = subscriptionOf(event);
  if (subscription) {
    try {
      const result = await syncSubscription(sql, key, subscription);
      console.log(`Stripe ${event.type} ${event.id}: subscription ${subscription} ${result}.`);
    } catch (error) {
      // Deleted in Stripe, as test data can be. Sending it again won't help.
      if (error instanceof StripeError && error.status === 404) console.warn(`Stripe ${event.type} ${event.id}: subscription ${subscription} no longer exists.`);
      else {
        console.error(`Couldn't apply Stripe ${event.type} ${event.id}:`, error instanceof Error ? error.message : error);
        return Response.json({ error: "Couldn't apply it. Send it again." }, { status: 500 });
      }
    }
  }
  await sql`insert into stripe_events (id, type) values (${event.id}, ${event.type}) on conflict (id) do nothing`;
  return Response.json({ received: true });
}

// Every hour ---------------------------------------------------------------------

/**
 * Sends Stripe the finished guides the widget server didn't get through, and
 * forgets webhook events older than Stripe ever retries.
 */
export async function billingSweep(env: BillingEnv, db?: Sql): Promise<void> {
  const sql = db ?? (env.DATABASE_URL ? database(env.DATABASE_URL) : undefined);
  if (!sql || !env.STRIPE_SECRET_KEY) return;
  const usage = await reportUsage(sql, env.STRIPE_SECRET_KEY, { limit: 2000 });
  if (usage.sent || usage.failed) console.log(`Billing sweep: ${usage.sent} finished guides sent to Stripe, ${usage.failed} failed.`);
  await sql`delete from stripe_events where received_at < now() - interval '30 days'`.catch((error: Error) => console.error("Couldn't forget old Stripe events:", error.message));
}
