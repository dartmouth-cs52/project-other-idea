import "server-only";
import Stripe from "stripe";
import { createAdminClient } from "./supabase/admin";

// Plans and how many guide questions (turns) each includes per month.
export const PLANS = {
  trial: { name: "Trial", turns: 500 },
  starter: { name: "Starter", turns: 5000 },
  growth: { name: "Growth", turns: 25000 },
} as const;

let client: Stripe | undefined;

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  // No apiVersion: the SDK pins the version its types were built for.
  client ??= new Stripe(key);
  return client;
}

export const hasStripe = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);

/** The saved customer if it exists in this Stripe account (test and live are separate). */
export async function existingCustomer(customerId: string | null | undefined): Promise<string | null> {
  if (!customerId) return null;
  try {
    const customer = await stripe().customers.retrieve(customerId);
    return customer.deleted ? null : customer.id;
  } catch {
    return null;
  }
}

// past_due keeps service running while Stripe retries a failed payment.
const LIVE_STATUSES = ["active", "trialing", "past_due"];

/**
 * Make an organization match its Stripe subscription. Re-reads the
 * subscription from Stripe so events arriving out of order can't leave an
 * organization on the wrong plan.
 */
export async function syncSubscription(subscriptionId: string, orgIdHint?: string | null) {
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  const item = subscription.items.data[0];
  const periodEnd = item?.current_period_end ?? null;
  const orgId = orgIdHint ?? subscription.metadata.org_id;
  const admin = createAdminClient();

  const query = admin.from("organizations").select("id, stripe_subscription_id");
  const { data: org, error } = await (orgId ? query.eq("id", orgId) : query.eq("stripe_customer_id", String(subscription.customer))).maybeSingle();
  if (error) throw error;
  if (!org) {
    console.error("[billing] no organization for subscription", subscription.id);
    return;
  }

  const live = LIVE_STATUSES.includes(subscription.status);
  // An old subscription ending shouldn't undo a newer one.
  if (!live && org.stripe_subscription_id && org.stripe_subscription_id !== subscription.id) return;

  const plan = live ? "starter" : "trial";
  const { error: updateError } = await admin
    .from("organizations")
    .update({
      plan,
      subscription_status: live ? (subscription.status === "trialing" ? "active" : subscription.status) : "canceled",
      stripe_customer_id: String(subscription.customer),
      stripe_subscription_id: subscription.id,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancels_at_period_end: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
      monthly_turn_limit: PLANS[plan].turns,
    })
    .eq("id", org.id);
  if (updateError) throw updateError;
}
