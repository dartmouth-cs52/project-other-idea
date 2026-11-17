"use client";

// Billing where people already are, not only on its own page:
//
// - PlanLink, in the bar across the top: the company's plan, with Upgrade
//   beside it during early access, and the words "Payment failed" when the
//   last payment did.
// - BillingNotice, at the top of the list of sites and of a site's Overview.
//   During early access it is the case for a paid plan, made from the
//   company's own numbers. On a paid plan it speaks up only when the month is
//   close to what the plan includes, or past it, or a payment failed.
//
// Everything said here is true of the product as built: only finished guides
// are counted, each one is listed with a download, and going over never
// switches Haptic off (worker/billing.ts). The page's numbers come from
// /api/app/billing, asked for once per page and shared by both parts.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleCheck, FileDown, ShieldCheck, X } from "lucide-react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, type Billing, type Me } from "@/lib/app-api";
import { FREE_PLAN, monthTotal, paidPlans } from "@/lib/billing-plans";
import { pricing } from "@/lib/site";
import { BILLING_HREF } from "./nav";

/** The roles that may buy, as worker/billing.ts has them. */
const MANAGERS = ["owner", "admin"];
/** Billing as last asked for, shared by everything on the page, and asked again after a minute. */
let held: { at: number; promise: Promise<Billing> } | undefined;
const KEEP_MS = 60_000;

/** Forgets what was asked, so the next look asks again. The billing page calls it after a change. */
export function forgetBilling() {
  held = undefined;
}

export function useBilling(me: Me | undefined): Billing | null {
  const [billing, setBilling] = useState<Billing | null>(null);
  const approved = Boolean(me?.approved);
  useEffect(() => {
    if (!approved) return;
    let live = true;
    if (!held || Date.now() - held.at > KEEP_MS) {
      const promise = api<Billing>("/billing");
      held = { at: Date.now(), promise };
      promise.catch(() => held?.promise === promise && (held = undefined));
    }
    held.promise.then((next) => live && setBilling(next)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [approved]);
  return billing;
}

const trouble = (billing: Billing) => Boolean(billing.subscription && ["past_due", "unpaid", "incomplete"].includes(billing.subscription.status));
const dollars = (amount: number) => amount.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 });
const each = (amount: number) => `$${amount.toFixed(2)}`;

// The bar across the top -----------------------------------------------------------

const CHIP = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50";

/** The company's plan, beside who is signed in. Upgrade is the one button, only during early access, and only for an owner or admin. */
export function PlanLink({ me }: { me: Me }) {
  const billing = useBilling(me);
  if (!billing) return null;
  if (trouble(billing)) {
    return (
      <Link href={BILLING_HREF} className={cn(CHIP, "font-medium text-destructive")}>
        Payment failed
      </Link>
    );
  }
  // Only someone who can buy is offered Upgrade. Everyone else sees the plan, and it leads to the same page.
  if (billing.plan.id !== FREE_PLAN || !MANAGERS.includes(me.organization?.role ?? "")) {
    return (
      <Link href={BILLING_HREF} className={cn(CHIP, "hidden text-muted-foreground sm:inline-flex")}>
        {billing.plan.name}
      </Link>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Link href={BILLING_HREF} className={cn(CHIP, "hidden text-muted-foreground md:inline-flex")}>
        {billing.plan.name}
      </Link>
      <Link href={BILLING_HREF} className={buttonVariants({ size: "sm" })}>
        Upgrade
      </Link>
    </span>
  );
}

// The card at the top of a page ----------------------------------------------------

/** How long Not now keeps a notice away, in this browser. */
const QUIET_MS = 14 * 86_400_000;

function quietKey(org: string, kind: string, period: string) {
  return `haptic.billing-notice.${org}.${kind}.${period}`;
}

function isQuiet(key: string): boolean {
  try {
    const until = Number(window.localStorage.getItem(key));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function quiet(key: string) {
  try {
    window.localStorage.setItem(key, String(Date.now() + QUIET_MS));
  } catch {
    // Private windows can refuse. The notice just comes back next time.
  }
}

type Notice =
  | { kind: "trouble" }
  | { kind: "early"; over: boolean }
  | { kind: "near"; used: number; included: number; over: boolean };

function noticeFor(billing: Billing): Notice | null {
  if (trouble(billing)) return { kind: "trouble" };
  if (billing.plan.id === FREE_PLAN) {
    const included = pricing.plans.find((plan) => plan.id === FREE_PLAN)?.includedGuides ?? Infinity;
    return { kind: "early", over: billing.finished >= included };
  }
  const plan = billing.plans.find((item) => item.id === billing.plan.id);
  if (!plan) return null;
  if (billing.finished < plan.includedGuides * 0.8) return null;
  return { kind: "near", used: billing.finished, included: plan.includedGuides, over: billing.finished > plan.includedGuides };
}

/**
 * The card at the top of the list of sites and of a site's Overview. "Not now"
 * puts it away for two weeks in this browser, except a failed payment, which
 * stays until it is fixed.
 */
export function BillingNotice({ me, className }: { me: Me; className?: string }) {
  const billing = useBilling(me);
  const [hidden, setHidden] = useState<string | null>(null);
  const notice = billing ? noticeFor(billing) : null;
  const org = me.organization?.id ?? "";
  const key = billing && notice ? quietKey(org, notice.kind === "early" && notice.over ? "early-over" : notice.kind, notice.kind === "early" ? "" : billing.period.start.slice(0, 10)) : "";
  // Only ever drawn in the browser, after sign-in and billing have loaded, so reading localStorage here is safe.
  if (!billing || !notice) return null;
  if (notice.kind !== "trouble" && (hidden === key || isQuiet(key))) return null;
  const canManage = MANAGERS.includes(me.organization?.role ?? "");
  const notNow =
    notice.kind === "trouble" ? undefined : (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Not now"
        className="absolute top-3 right-3 text-muted-foreground"
        onClick={() => {
          quiet(key);
          setHidden(key);
        }}
      >
        <X />
      </Button>
    );

  if (notice.kind === "trouble") {
    return (
      <Frame className={className}>
        <h2 className="text-base font-medium">The last payment didn&apos;t go through</h2>
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          Haptic is still guiding your users. Update the card to keep your {billing.plan.name} plan. Stripe tries the card again over the next few days.
        </p>
        <Actions canManage={canManage} label="Update the card" />
      </Frame>
    );
  }

  if (notice.kind === "near") {
    const plan = billing.plans.find((item) => item.id === billing.plan.id)!;
    const bigger = billing.plans.find((item) => item.includedGuides > plan.includedGuides);
    return (
      <Frame className={className}>
        {notNow}
        <h2 className="pr-10 text-base font-medium">
          {notice.over
            ? `Your users have finished ${notice.used.toLocaleString()} guides this period, past the ${notice.included.toLocaleString()} ${plan.name} includes`
            : `Your users have finished ${notice.used.toLocaleString()} of the ${notice.included.toLocaleString()} guides ${plan.name} includes this period`}
        </h2>
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          Each one after that is {each(plan.overageUsd)}, and Haptic keeps guiding however many there are.
          {bigger ? ` ${bigger.name} includes ${bigger.includedGuides.toLocaleString()} a month for ${dollars(bigger.monthlyUsd)}, then ${each(bigger.overageUsd)} each.` : ""}
        </p>
        <Actions canManage={canManage} label={bigger ? `Compare with ${bigger.name}` : "See billing"} />
      </Frame>
    );
  }

  // Early access: the case for a paid plan, from the company's own month.
  const team = paidPlans()[0];
  if (!team) return null;
  const month = billing.finished;
  const total = monthTotal(team, month);
  return (
    <Frame className={className}>
      {notNow}
      <h2 className="pr-10 text-base font-medium">
        {month > 0
          ? `Your users finished ${month.toLocaleString()} ${month === 1 ? "guide" : "guides"} with Haptic this month`
          : "Haptic is free during early access"}
      </h2>
      <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
        {notice.over
          ? `That is past the ${(pricing.plans.find((plan) => plan.id === FREE_PLAN)?.includedGuides ?? 0).toLocaleString()} early access includes. `
          : ""}
        {month > 0
          ? `Each one is someone Haptic took where they asked to go. On ${team.name}, this month would come to ${dollars(total.total)}, with ${team.includedGuides.toLocaleString()} finished guides included and ${each(team.overageUsd)} for each one after.`
          : `After that, plans start at ${dollars(team.monthlyUsd)} a month, with ${team.includedGuides.toLocaleString()} finished guides included and ${each(team.overageUsd)} for each one after. Choose one whenever you're ready.`}
      </p>
      <Reasons />
      <Actions canManage={canManage} label="See plans" />
    </Frame>
  );
}

/** What every paid plan promises, true of the product as built. Shared with the billing page. */
export function Reasons({ className }: { className?: string }) {
  return (
    <ul className={cn("grid gap-2 text-sm sm:grid-cols-3", className)}>
      <Point icon={CircleCheck}>Only guides that finish are counted</Point>
      <Point icon={FileDown}>Every counted guide is listed, with a download</Point>
      <Point icon={ShieldCheck}>Going over never switches Haptic off</Point>
    </ul>
  );
}

function Frame({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("relative flex flex-col gap-3 rounded-xl border bg-card p-5", className)}>{children}</section>;
}

function Point({ icon: Icon, children }: { icon: typeof CircleCheck; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 leading-5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

/** The way to the billing page. Someone who can't buy is told who can. */
function Actions({ canManage, label }: { canManage: boolean; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-1">
      <Link href={BILLING_HREF} className={buttonVariants()}>
        {label}
      </Link>
      {!canManage && <span className="text-sm text-muted-foreground">An owner or admin of your company can change the plan.</span>}
    </div>
  );
}
