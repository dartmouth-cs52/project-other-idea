import type Stripe from "stripe";
import { stripe, syncSubscription } from "@/lib/billing";

// Stripe calls this without a session, so it trusts nothing until the
// signature checks out. A 500 makes Stripe retry later.
export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET ?? "");
  } catch (error) {
    return new Response(`Webhook error: ${error instanceof Error ? error.message : "bad signature"}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          await syncSubscription(String(session.subscription), session.client_reference_id ?? session.metadata?.org_id);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object.id);
        break;
    }
  } catch (error) {
    console.error(`[billing] handling ${event.type} failed`, error);
    return new Response("Webhook handler failed", { status: 500 });
  }
  return new Response(null, { status: 200 });
}
