"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentOrganization } from "@/lib/auth";
import { existingCustomer, stripe } from "@/lib/billing";

async function origin(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:4000";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Start a subscription, or open the portal for an organization that already has one. */
export async function startCheckout() {
  const { org, user, role } = await currentOrganization();
  if (!org || role !== "owner") redirect("/dashboard/billing");
  const base = await origin();
  const customer = await existingCustomer(org.stripe_customer_id);

  if (customer && org.subscription_status === "active") {
    const portal = await stripe().billingPortal.sessions.create({ customer, return_url: `${base}/dashboard/billing` });
    redirect(portal.url);
  }

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    success_url: `${base}/dashboard/billing?welcome=1`,
    cancel_url: `${base}/dashboard/billing`,
    allow_promotion_codes: true,
    client_reference_id: org.id,
    metadata: { org_id: org.id },
    subscription_data: { metadata: { org_id: org.id } },
    ...(customer ? { customer } : { customer_email: user.email }),
  });
  redirect(session.url!);
}

export async function openPortal() {
  const { org } = await currentOrganization();
  const customer = await existingCustomer(org?.stripe_customer_id);
  if (!customer) redirect("/dashboard/billing");
  const portal = await stripe().billingPortal.sessions.create({ customer, return_url: `${await origin()}/dashboard/billing` });
  redirect(portal.url);
}
