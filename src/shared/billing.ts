// Sending finished guides to Stripe, as usage on a company's subscription.
//
// The widget server sends a guide the moment it is kept as finished
// (`Store.report` in src/server/db.ts), and the site's Worker sweeps every hour
// for any that did not get through (web/worker/billing.ts). Both call
// `reportUsage` here, so they pick guides by the same rule:
//
// - the guide is "finished", which the server only keeps when its own record
//   bears it out (docs/operations.md, "Which guides are finished");
// - its site belongs to a company with a Stripe customer in the key's mode,
//   live or test, and it finished while
//   that company's paid subscription was running (`metered_from` up to
//   `metered_until`, written by the webhook from the subscription itself);
// - it has not been sent already (`guides.billed_at`).
//
// Each event is keyed by the guide's own id, and Stripe keeps one event per key
// for at least a day. So if the widget server and the sweep send one guide at
// the same moment, or a send succeeds and marking it fails, Stripe counts it
// once. Past that day, `billed_at` is what stops a second send.

import { isTestKey, stripe, StripeError, type StripeCall } from "./stripe";

/** The meter's event name in Stripe. `web/scripts/stripe-setup.ts` makes the meter. */
export const METER_EVENT = "haptic_finished_guide";

/** Stripe takes a meter event up to 35 days old. A day is kept in hand. */
export const USAGE_MAX_AGE_DAYS = 34;

/** A query function shaped like Neon's: a tagged template that resolves to rows. */
export type QueryRows = (strings: TemplateStringsArray, ...values: unknown[]) => PromiseLike<Record<string, unknown>[]>;

export interface UsageResult {
  sent: number;
  failed: number;
}

/**
 * Sends Stripe one meter event for each finished guide that is owed and not yet
 * sent, and marks each one sent. With `guide`, only that guide. Never throws:
 * a guide that fails stays unsent, for the next sweep.
 */
export async function reportUsage(sql: QueryRows, key: string, options: { guide?: string; limit?: number; call?: StripeCall } = {}): Promise<UsageResult> {
  const result: UsageResult = { sent: 0, failed: 0 };
  let rows: Record<string, unknown>[];
  try {
    const only = options.guide ?? null;
    const live = !isTestKey(key);
    rows = await sql`
      select g.id, extract(epoch from g.ended_at)::bigint as ended, b.stripe_customer_id as customer
      from guides g
      join sites s on s.id = g.site_id
      join billing b on b.organization_id = s.company_id
      where g.outcome = 'finished' and g.billed_at is null
        and (${only}::uuid is null or g.id = ${only}::uuid)
        and b.stripe_customer_id is not null and b.livemode = ${live} and b.metered_from is not null
        and g.ended_at >= b.metered_from and (b.metered_until is null or g.ended_at < b.metered_until)
        and g.ended_at > now() - make_interval(days => ${USAGE_MAX_AGE_DAYS})
      order by g.ended_at
      limit ${options.limit ?? 500}`;
  } catch (error) {
    // Most likely the billing table is not there yet (db/migrations/0015). Nothing is billed until it is.
    console.error("Couldn't look for finished guides to bill:", error instanceof Error ? error.message : error);
    return result;
  }
  for (const row of rows) {
    const id = String(row.id);
    try {
      await sendGuide(key, id, String(row.customer), Number(row.ended), options.call);
      await sql`update guides set billed_at = now() where id = ${id}::uuid and billed_at is null`;
      result.sent++;
    } catch (error) {
      result.failed++;
      console.error(`Couldn't send finished guide ${id} to Stripe:`, error instanceof Error ? error.message : error);
      // A key Stripe refuses, or an outage, fails the rest the same way. The next sweep tries again.
      if (error instanceof StripeError && (error.status === 401 || error.status === 403 || error.status >= 500)) break;
    }
  }
  return result;
}

/** One meter event: one finished guide, for this customer, at the time it finished. */
async function sendGuide(key: string, guide: string, customer: string, endedS: number, call?: StripeCall): Promise<void> {
  // Stripe refuses a time more than five minutes ahead of its clock. A guide's time is the database's, which can run a little ahead.
  const timestamp = Math.min(endedS, Math.floor(Date.now() / 1000));
  try {
    await stripe(key, "POST", "/v1/billing/meter_events", { event_name: METER_EVENT, identifier: guide, timestamp, payload: { stripe_customer_id: customer, value: 1 } }, call);
  } catch (error) {
    // Stripe already has an event with this guide's id: it was sent, and only marking it failed. It counts once either way.
    if (error instanceof StripeError && isDuplicate(error)) return;
    throw error;
  }
}

/** Stripe's answer to a second event with the same identifier, as of API version 2026-10-28: a 400 with no code, "An event already exists with identifier …". */
function isDuplicate(error: StripeError): boolean {
  return error.status === 400 && (error.code === "resource_already_exists" || (/already exists/i.test(error.message) && /identifier/i.test(error.message)));
}
