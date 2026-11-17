// Puts Haptic's plans into Stripe, or checks that Stripe still matches them.
//
//   STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup
//   STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup -- --webhook https://joinhaptic.com --secret-file ~/stripe-webhook-secret
//   STRIPE_SECRET_KEY=rk_live_… npm run stripe:check
//
// The plans come from `pricing` in lib/site.ts, through lib/billing-plans.ts,
// so Stripe and the pricing page can't disagree. Run it once with a test key
// and once with a live key: the two modes hold separate copies of everything.
//
// It makes, or brings up to date:
//
// - the meter that counts finished guides;
// - a product and two prices for each paid plan. A price can't be changed once
//   made, so a changed price is made anew and takes over the lookup key, and
//   the old one is archived. Subscriptions already on the old one keep it
//   until they are moved;
// - the customer portal's settings: card, billing details, invoices and
//   cancelling at the end of the period. Not changing plan, which the portal
//   can't do for a metered price, so the dashboard does it;
// - with --webhook, the endpoint Stripe sends events to. Its signing secret is
//   shown by Stripe only when the endpoint is made, so it is written to the
//   file --secret-file names, readable only by you, and never printed. Put it
//   on the site's Worker with `npx wrangler secret put STRIPE_WEBHOOK_SECRET < file`.
//
// --check changes nothing, and exits 1 if anything differs. The site's deploy
// runs it, so a price changed in lib/site.ts can't go live before Stripe charges it.

import { chmod, writeFile } from "node:fs/promises";
import { isTestKey, stripe, STRIPE_API_VERSION, StripeError } from "../../src/shared/stripe";
import { METER_EVENT } from "../../src/shared/billing";
import { priceSpecs, type PriceSpec } from "../lib/billing-plans";
import { WEBHOOK_EVENTS, WEBHOOK_PATH } from "../worker/billing";
import { site } from "../lib/site";

const args = process.argv.slice(2);
const check = args.includes("--check");
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const webhookSite = option("--webhook");
const secretFile = option("--secret-file");
const siteUrl = (option("--site") ?? webhookSite ?? site.url).replace(/\/$/, "");

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!/^(sk|rk)_(test|live)_/.test(key)) {
  console.error("Set STRIPE_SECRET_KEY to a Stripe secret key (sk_test_…, or sk_live_… for live mode). A restricted key (rk_…) is enough for --check.");
  process.exit(1);
}
if (webhookSite && !secretFile) {
  console.error("--webhook needs --secret-file <path>: the endpoint's signing secret is written there, never printed.");
  process.exit(1);
}
const mode = isTestKey(key) ? "test" : "live";
console.log(`Stripe ${mode} mode. ${check ? "Checking, changing nothing." : "Making what is missing."}\n`);

const problems: string[] = [];
function differs(what: string) {
  problems.push(what);
  console.log(`  ✗ ${what}`);
}
function same(what: string) {
  console.log(`  ✓ ${what}`);
}
function made(what: string) {
  console.log(`  + ${what}`);
}

// The meter ----------------------------------------------------------------------

interface Meter {
  id: string;
  event_name: string;
  status: string;
  default_aggregation: { formula: string };
  customer_mapping: { event_payload_key: string; type: string };
  value_settings: { event_payload_key: string };
}

async function meter(): Promise<string | undefined> {
  console.log("Meter");
  const { data } = await stripe<{ data: Meter[] }>(key, "GET", "/v1/billing/meters", { status: "active", limit: 100 });
  const found = data.find((item) => item.event_name === METER_EVENT);
  if (found) {
    const right = found.default_aggregation.formula === "sum" && found.customer_mapping.event_payload_key === "stripe_customer_id" && found.value_settings.event_payload_key === "value";
    if (right) same(`${METER_EVENT} (${found.id}) sums "value" for each "stripe_customer_id"`);
    else differs(`meter ${found.id} for ${METER_EVENT} doesn't sum "value" by "stripe_customer_id". Archive it in Stripe and run this again.`);
    return found.id;
  }
  if (check) {
    differs(`no active meter for ${METER_EVENT}`);
    return undefined;
  }
  const created = await stripe<Meter>(key, "POST", "/v1/billing/meters", {
    display_name: "Finished guides",
    event_name: METER_EVENT,
    default_aggregation: { formula: "sum" },
    customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
    value_settings: { event_payload_key: "value" },
  });
  made(`${METER_EVENT} (${created.id})`);
  return created.id;
}

// Products and prices ------------------------------------------------------------

interface Product {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  tax_code: string | { id: string } | null;
}

async function product(spec: PriceSpec["product"]): Promise<void> {
  let found: Product | undefined;
  try {
    found = await stripe<Product>(key, "GET", `/v1/products/${spec.id}`);
  } catch (error) {
    if (!(error instanceof StripeError && error.status === 404)) throw error;
  }
  if (!found) {
    if (check) return differs(`no product ${spec.id}`);
    await stripe(key, "POST", "/v1/products", { id: spec.id, name: spec.name, description: spec.description, tax_code: spec.taxCode });
    return made(`product ${spec.id}, "${spec.name}"`);
  }
  const taxCode = typeof found.tax_code === "string" ? found.tax_code : found.tax_code?.id;
  if (found.name === spec.name && found.description === spec.description && found.active && taxCode === spec.taxCode) return same(`product ${spec.id}, "${spec.name}", tax code ${taxCode}`);
  if (check) return differs(`product ${spec.id} reads "${found.name}: ${found.description ?? ""}"${found.active ? "" : ", archived"}, tax code ${taxCode ?? "none"}, not "${spec.name}: ${spec.description}", ${spec.taxCode}`);
  await stripe(key, "POST", `/v1/products/${spec.id}`, { name: spec.name, description: spec.description, active: true, tax_code: spec.taxCode });
  made(`product ${spec.id} updated to "${spec.name}"`);
}

interface Price {
  id: string;
  active: boolean;
  lookup_key: string | null;
  product: string;
  currency: string;
  unit_amount_decimal: string | null;
  billing_scheme: string;
  tiers_mode: string | null;
  tiers?: { up_to: number | null; unit_amount_decimal: string | null; flat_amount_decimal: string | null }[];
  recurring: { interval: string; interval_count: number; usage_type: string; meter: string | null } | null;
  metadata: Record<string, string>;
}

/** How a price differs from what the plan says, in words, or nothing when it doesn't. */
function priceDifference(price: Price, spec: PriceSpec, meterId: string | undefined): string | undefined {
  const number = (text: string | null | undefined) => Number(text ?? Number.NaN);
  if (price.product !== spec.product.id) return `belongs to product ${price.product}, not ${spec.product.id}`;
  if (price.currency !== "usd") return `is in ${price.currency}, not usd`;
  if (price.recurring?.interval !== "month" || price.recurring.interval_count !== 1) return "isn't billed monthly";
  if (price.metadata.haptic_plan !== spec.plan || price.metadata.haptic_part !== spec.part) return "has the wrong haptic_plan or haptic_part metadata";
  if (spec.part === "monthly") {
    if (price.recurring.usage_type !== "licensed" || price.billing_scheme !== "per_unit") return "isn't a flat monthly fee";
    if (number(price.unit_amount_decimal) !== number(spec.unitAmountDecimal)) return `is ${price.unit_amount_decimal} cents a month, not ${spec.unitAmountDecimal}`;
    return undefined;
  }
  if (price.recurring.usage_type !== "metered" || price.billing_scheme !== "tiered" || price.tiers_mode !== "graduated") return "isn't metered with graduated tiers";
  if (!meterId || price.recurring.meter !== meterId) return `counts meter ${price.recurring.meter ?? "none"}, not ${meterId ?? METER_EVENT}`;
  const tiers = price.tiers ?? [];
  const wanted = spec.tiers ?? [];
  const show = (list: { upTo: number | "inf"; cents: number }[]) => list.map((tier) => `${tier.upTo}:${tier.cents}`).join(", ");
  const have = tiers.map((tier) => ({ upTo: tier.up_to ?? ("inf" as const), cents: number(tier.unit_amount_decimal) }));
  const want = wanted.map((tier) => ({ upTo: tier.upTo, cents: number(tier.unitAmountDecimal) }));
  if (tiers.some((tier) => number(tier.flat_amount_decimal ?? "0") !== 0) || show(have) !== show(want)) return `has tiers ${show(have)} (up to: cents each), not ${show(want)}`;
  return undefined;
}

async function prices(meterId: string | undefined): Promise<void> {
  const specs = priceSpecs();
  const { data } = await stripe<{ data: Price[] }>(key, "GET", "/v1/prices", { lookup_keys: specs.map((spec) => spec.lookupKey), "expand": ["data.tiers"], limit: 100 });
  for (const spec of specs) {
    console.log(`\n${spec.product.name}, ${spec.part}`);
    await product(spec.product);
    const found = data.find((price) => price.lookup_key === spec.lookupKey);
    const difference = found ? (found.active ? priceDifference(found, spec, meterId) : "is archived") : "is missing";
    if (found && !difference) {
      same(`price ${found.id} (${spec.lookupKey}) matches lib/site.ts`);
      continue;
    }
    if (check) {
      differs(`price ${spec.lookupKey} ${difference}`);
      continue;
    }
    if (spec.part === "guides" && !meterId) {
      differs(`price ${spec.lookupKey} needs the meter, which is missing`);
      continue;
    }
    const nickname = spec.part === "monthly" ? `${spec.product.name}, monthly` : `${spec.product.name}, metered`;
    const params =
      spec.part === "monthly"
        ? { unit_amount_decimal: spec.unitAmountDecimal, recurring: { interval: "month", usage_type: "licensed" } }
        : {
            billing_scheme: "tiered",
            tiers_mode: "graduated",
            tiers: (spec.tiers ?? []).map((tier) => ({ up_to: tier.upTo, unit_amount_decimal: tier.unitAmountDecimal })),
            recurring: { interval: "month", usage_type: "metered", meter: meterId },
          };
    const created = await stripe<Price>(key, "POST", "/v1/prices", {
      currency: "usd",
      product: spec.product.id,
      nickname,
      lookup_key: spec.lookupKey,
      transfer_lookup_key: true,
      metadata: { haptic_plan: spec.plan, haptic_part: spec.part },
      ...params,
    });
    made(`price ${created.id} (${spec.lookupKey})${found ? `, replacing ${found.id}, which ${difference}` : ""}`);
    if (found?.active) {
      await stripe(key, "POST", `/v1/prices/${found.id}`, { active: false });
      made(`archived ${found.id}. Subscriptions on it keep it until moved.`);
    }
  }
}

// The customer portal ------------------------------------------------------------

interface PortalConfiguration {
  id: string;
  is_default: boolean;
  features: {
    subscription_update: { enabled: boolean };
    subscription_cancel: { enabled: boolean; mode: string };
    payment_method_update: { enabled: boolean };
    invoice_history: { enabled: boolean };
  };
}

async function portal(): Promise<void> {
  console.log("\nCustomer portal");
  const settings = {
    business_profile: { headline: "Haptic billing", privacy_policy_url: `${site.url}/privacy/`, terms_of_service_url: `${site.url}/terms/` },
    default_return_url: `${siteUrl}/dashboard/?view=billing`,
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "address", "name", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        proration_behavior: "none",
        cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] },
      },
      // The portal can't change a subscription with a metered price. The dashboard does.
      subscription_update: { enabled: false },
    },
  };
  const { data } = await stripe<{ data: PortalConfiguration[] }>(key, "GET", "/v1/billing_portal/configurations", { is_default: true, active: true, limit: 1 });
  const found = data[0];
  if (found) {
    const right =
      found.features.payment_method_update.enabled &&
      found.features.invoice_history.enabled &&
      found.features.subscription_cancel.enabled &&
      found.features.subscription_cancel.mode === "at_period_end" &&
      !found.features.subscription_update.enabled;
    if (check) return right ? same(`default configuration ${found.id}`) : differs(`default portal configuration ${found.id} doesn't allow card, invoices and cancelling at period end, or allows changing plan`);
    await stripe(key, "POST", `/v1/billing_portal/configurations/${found.id}`, settings);
    return made(`default configuration ${found.id} set: card, details, invoices, cancel at period end`);
  }
  if (check) return differs("no default portal configuration");
  const created = await stripe<PortalConfiguration>(key, "POST", "/v1/billing_portal/configurations", settings);
  made(`configuration ${created.id}: card, details, invoices, cancel at period end`);
}

// The webhook endpoint -----------------------------------------------------------

interface Endpoint {
  id: string;
  url: string;
  status: string;
  enabled_events: string[];
  api_version: string | null;
  secret?: string;
}

async function webhook(): Promise<void> {
  if (!webhookSite) return;
  console.log("\nWebhook endpoint");
  const url = `${webhookSite.replace(/\/$/, "")}${WEBHOOK_PATH}`;
  const { data } = await stripe<{ data: Endpoint[] }>(key, "GET", "/v1/webhook_endpoints", { limit: 100 });
  const found = data.find((endpoint) => endpoint.url === url);
  const events = [...WEBHOOK_EVENTS];
  if (found) {
    const right = events.every((event) => found.enabled_events.includes(event)) && found.status === "enabled";
    if (check) return right ? same(`${url} (${found.id})`) : differs(`${url} (${found.id}) is ${found.status}, or misses some of: ${events.join(", ")}`);
    await stripe(key, "POST", `/v1/webhook_endpoints/${found.id}`, { enabled_events: events, disabled: false });
    made(`${url} (${found.id}) listens for ${events.length} events. Its signing secret is unchanged, on the endpoint's page in Stripe.`);
    return;
  }
  if (check) return differs(`no endpoint at ${url}`);
  const created = await stripe<Endpoint>(key, "POST", "/v1/webhook_endpoints", {
    url,
    enabled_events: events,
    api_version: STRIPE_API_VERSION,
    description: "Haptic: keeps each company's plan current (web/worker/billing.ts)",
  });
  await writeFile(secretFile!, created.secret ?? "", { mode: 0o600 });
  await chmod(secretFile!, 0o600);
  made(`${url} (${created.id}). Its signing secret is in ${secretFile}. Put it on the Worker and delete the file:`);
  console.log(`      npx wrangler secret put STRIPE_WEBHOOK_SECRET < ${secretFile} && rm ${secretFile}`);
}

async function main() {
  const meterId = await meter();
  await prices(meterId);
  await portal();
  await webhook();

  if (problems.length) {
    console.log(`\n${problems.length} ${problems.length === 1 ? "thing differs" : "things differ"} from lib/site.ts.${check ? " Run npm run stripe:setup with a secret key to fix them." : ""}`);
    process.exit(1);
  }
  console.log(`\nStripe's ${mode} mode matches lib/site.ts.`);
}

// The web package is CommonJS, which has no top-level await.
main().catch((error: Error) => {
  console.error(error instanceof StripeError ? `Stripe refused: ${error.message} (${error.status}${error.code ? `, ${error.code}` : ""})` : error);
  process.exit(1);
});
