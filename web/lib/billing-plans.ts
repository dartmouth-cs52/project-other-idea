// What Stripe has to hold for each plan, worked out from `pricing` in
// lib/site.ts, which is the one place a price is set. The setup script
// (scripts/stripe-setup.ts) makes these in Stripe and checks them, the Worker
// finds them by their lookup keys, and the billing page shows the same plans.
// No React and no Worker APIs, so all three can use it.
//
// Each paid plan is two prices on a monthly subscription:
//
// - "monthly": the flat fee, paid at the start of each month.
// - "guides": finished guides, counted by the meter and paid at the end of the
//   month. Graduated tiers make the plan's included guides free and charge the
//   overage price for each one after them, so 1,200 guides on Team cost
//   1,000 × $0 + 200 × $0.12.

import { pricing } from "./site";

export type Plan = (typeof pricing.plans)[number];
export type PlanId = Plan["id"];

/** A plan a company can buy from the dashboard: a monthly price, an amount included, and a price after it. */
export interface PaidPlan {
  id: PlanId;
  name: string;
  monthlyUsd: number;
  includedGuides: number;
  overageUsd: number;
}

export function paidPlans(): PaidPlan[] {
  return pricing.plans.flatMap((plan): PaidPlan[] =>
    plan.monthlyUsd && plan.includedGuides !== null && plan.overageUsd !== null
      ? [{ id: plan.id, name: plan.name, monthlyUsd: plan.monthlyUsd, includedGuides: plan.includedGuides, overageUsd: plan.overageUsd }]
      : [],
  );
}

export function paidPlan(id: unknown): PaidPlan | undefined {
  return paidPlans().find((plan) => plan.id === id);
}

export function planName(id: string): string {
  return pricing.plans.find((plan) => plan.id === id)?.name ?? id;
}

/** The free plan every company is on until it pays. */
export const FREE_PLAN: PlanId = "early-access";

export type PricePart = "monthly" | "guides";

/**
 * Stripe's tax category for every product: software as a service, for business
 * use. Stripe Tax and Managed Payments both need one to work out sales tax and
 * VAT, and Checkout refuses a product without it when Managed Payments is on.
 */
export const PRODUCT_TAX_CODE = "txcd_10103001";

export function lookupKey(plan: string, part: PricePart): string {
  return `haptic_${plan.replace(/-/g, "_")}_${part}`;
}

/** Dollars as Stripe's smallest unit, as a decimal string, so $0.125 a guide would be "12.5" cents and not rounded. */
export function cents(usd: number): string {
  const text = (usd * 100).toFixed(6).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

export interface PriceSpec {
  lookupKey: string;
  plan: PlanId;
  part: PricePart;
  product: { id: string; name: string; description: string; taxCode: string };
  /** For "monthly": the fee in cents. */
  unitAmountDecimal?: string;
  /** For "guides": free up to the included amount, then this many cents each. */
  tiers?: { upTo: number | "inf"; unitAmountDecimal: string }[];
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

function usd(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 4 })}`;
}

/** Every price Stripe must have, two a paid plan. */
export function priceSpecs(): PriceSpec[] {
  return paidPlans().flatMap((plan): PriceSpec[] => [
    {
      lookupKey: lookupKey(plan.id, "monthly"),
      plan: plan.id,
      part: "monthly",
      product: { id: `haptic_${plan.id}`, name: `Haptic ${plan.name}`, description: `${count(plan.includedGuides)} finished guides a month included.`, taxCode: PRODUCT_TAX_CODE },
      unitAmountDecimal: cents(plan.monthlyUsd),
    },
    {
      lookupKey: lookupKey(plan.id, "guides"),
      plan: plan.id,
      part: "guides",
      product: {
        id: `haptic_${plan.id}_guides`,
        name: `Finished guides on ${plan.name}`,
        description: `The first ${count(plan.includedGuides)} each month are included. Each one after that is ${usd(plan.overageUsd)}. Guides that don't finish are free.`,
        taxCode: PRODUCT_TAX_CODE,
      },
      tiers: [
        { upTo: plan.includedGuides, unitAmountDecimal: "0" },
        { upTo: "inf", unitAmountDecimal: cents(plan.overageUsd) },
      ],
    },
  ]);
}

/** What a month comes to on a plan with this many finished guides, in dollars. */
export function monthTotal(plan: PaidPlan, finished: number): { monthly: number; overage: number; extra: number; total: number } {
  const extra = Math.max(0, finished - plan.includedGuides);
  const overage = Math.round(extra * plan.overageUsd * 100) / 100;
  return { monthly: plan.monthlyUsd, overage, extra, total: Math.round((plan.monthlyUsd + overage) * 100) / 100 };
}
