"use client";

// The company's billing page, /dashboard/?view=billing. Its plan, the finished
// guides counted so far this period against what the plan includes, the plans
// to choose from, and the way to Stripe's portal for the card, invoices and
// cancelling. The Worker's half is worker/billing.ts.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FormAlert, failureFrom, type Failure } from "@/components/form";
import { api, type Billing, type Me } from "@/lib/app-api";
import { monthTotal, type PaidPlan } from "@/lib/billing-plans";
import { pricing, site } from "@/lib/site";
import { siteHref } from "./nav";
import { forgetBilling, Reasons } from "./upgrade";
import { Card, CardTitle, DashboardSurface, FailedCard, PageHeader, Panel, PanelEmpty } from "./parts";

const dollars = (amount: number) => amount.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 });
const each = (amount: number) => `$${amount.toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
/** The last day of a period that ends at midnight UTC on `end`. */
const lastDay = (end: string) => day(new Date(new Date(end).getTime() - 1).toISOString());

export function BillingPage({ me }: { me: Me }) {
  const params = useSearchParams();
  const router = useRouter();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const [attempt, setAttempt] = useState(0);

  // Back from Checkout, the address names the session, so the Worker can make sure the new plan is saved before the page shows it.
  const session = params.get("session");
  useEffect(() => {
    let live = true;
    api<Billing>(`/billing${session ? `?session=${encodeURIComponent(session)}` : ""}`)
      .then((next) => {
        if (!live) return;
        setBilling(next);
        setFailed(null);
        if (session) router.replace("/dashboard/?view=billing", { scroll: false });
      })
      .catch((error: Error) => live && setFailed(error.message));
    return () => {
      live = false;
    };
  }, [session, router, attempt]);

  return (
    <DashboardSurface>
      <PageHeader title="Billing" note={me.organization ? `${me.organization.name}, across all of its sites` : undefined} />
      {failed && !billing && <FailedCard title="Billing didn't load" message={failed} retry={() => setAttempt((n) => n + 1)} level={2} />}
      {!billing && !failed && (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      )}
      {billing && <Loaded billing={billing} onChange={setBilling} />}
    </DashboardSurface>
  );
}

function Loaded({ billing, onChange }: { billing: Billing; onChange: (next: Billing) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const current = billing.plans.find((plan) => plan.id === billing.plan.id);
  const subscription = billing.subscription;

  async function go(what: string, path: string, body?: unknown) {
    setBusy(what);
    setFailure(null);
    try {
      const answer = await api<{ url?: string } & Partial<Billing>>(path, { method: "POST", body: body ?? {} });
      if (answer.url) return window.location.assign(answer.url);
      // The plan in the bar across the top and the notices ask again, and see the change.
      forgetBilling();
      onChange(answer as Billing);
    } catch (error) {
      // Switching plan is done here; checkout and the portal are Stripe's own pages, opened from here.
      setFailure(failureFrom(path === "/billing/plan" ? "The plan didn't change" : "Stripe didn't open", error));
    }
    setBusy(null);
  }

  const trouble = subscription && ["past_due", "unpaid", "incomplete"].includes(subscription.status);
  const plans = <Plans billing={billing} busy={busy} onCheckout={(plan) => go(plan, "/billing/checkout", { plan })} onSwitch={(plan) => go(plan, "/billing/plan", { plan })} />;

  return (
    <>
      <Card>
        <CardTitle
          aside={
            billing.canManage && billing.hasCustomer && billing.ready ? (
              <Button variant="secondary" disabled={busy !== null} onClick={() => go("portal", "/billing/portal")}>
                {busy === "portal" ? "Opening Stripe" : "Card, invoices and cancelling"}
              </Button>
            ) : undefined
          }
        >
          {billing.plan.name}
        </CardTitle>
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          {subscription && current
            ? subscription.cancelAt
              ? `${dollars(current.monthlyUsd)} a month with ${current.includedGuides.toLocaleString()} finished guides included. Cancelled, so it ends on ${day(subscription.cancelAt)}. Haptic keeps working after that, on early access.`
              : `${dollars(current.monthlyUsd)} a month with ${current.includedGuides.toLocaleString()} finished guides included. Renews on ${subscription.periodEnd ? day(subscription.periodEnd) : "the first of the month"}.`
            : subscription
              ? "A plan agreed with us. Email us to change it."
              : "Haptic is free during early access. Choose a plan below when you're ready to pay for it."}
        </p>
        {trouble && (
          <p className="max-w-[65ch] text-sm leading-5">
            The last payment didn&apos;t go through. Haptic keeps guiding your users. Update the card in Stripe to keep the plan.
          </p>
        )}
        {billing.testMode && <p className="text-xs text-muted-foreground">Stripe test mode. Nothing is charged.</p>}
        <FormAlert failure={failure} />
      </Card>

      {/* During early access the plans come first: choosing one is what this page is for. On a paid plan, what has been used this period is. */}
      {!subscription && plans}
      <Usage billing={billing} plan={current} />
      {subscription && plans}
    </>
  );
}

/** Finished guides so far this period, against what the plan includes, and what that comes to. */
function Usage({ billing, plan }: { billing: Billing; plan: PaidPlan | undefined }) {
  const included = plan?.includedGuides ?? pricing.plans.find((item) => item.id === billing.plan.id)?.includedGuides ?? null;
  const share = included ? Math.min(1, billing.finished / included) : 0;
  const total = plan ? monthTotal(plan, billing.finished) : null;
  const period = billing.period.kind === "billing" ? `${day(billing.period.start)} to ${lastDay(billing.period.end)}` : `This month, to ${lastDay(billing.period.end)}`;
  return (
    <Panel
      title="Finished guides"
      aside={<span className="text-sm text-muted-foreground">{period}</span>}
      foot={
        <>
          {pricing.lead} Going over the included guides never switches Haptic off. Each site&apos;s Usage tab lists every finished guide, with a download.
        </>
      }
    >
      <div className="flex flex-col gap-3 px-5 pb-5">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-4xl font-medium tracking-[-0.03em] tabular-nums">{billing.finished.toLocaleString()}</span>
          {included !== null && <span className="text-sm text-muted-foreground">of {included.toLocaleString()} included</span>}
        </p>
        {included !== null && (
          <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-border" role="presentation">
            <div className="h-full rounded-full bg-foreground" style={{ width: `${share * 100}%` }} />
          </div>
        )}
        {plan && total && (
          <p className="text-sm leading-5 text-muted-foreground">
            {total.extra
              ? `${total.extra.toLocaleString()} over, at ${each(plan.overageUsd)} each, which is ${dollars(total.overage)}. This period comes to ${dollars(total.total)} so far, before tax.`
              : `Nothing over yet. This period comes to ${dollars(total.monthly)}, before tax.`}
          </p>
        )}
      </div>
      {billing.sites.length > 1 && (
        <ul className="flex flex-col divide-y border-t">
          {billing.sites.map((item) => (
            <li key={item.id}>
              <Link href={siteHref(item.id, "settings", { tab: "usage" })} className="flex items-center justify-between gap-4 px-5 py-3 text-sm hover:bg-muted/60">
                <span className="min-w-0 truncate">{item.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{item.finished.toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {billing.sites.length === 0 && <PanelEmpty>Your company has no sites yet. Guides are counted once a site is running.</PanelEmpty>}
    </Panel>
  );
}

function Plans({ billing, busy, onCheckout, onSwitch }: { billing: Billing; busy: string | null; onCheckout: (plan: string) => void; onSwitch: (plan: string) => void }) {
  const subscription = billing.subscription;
  const [confirming, setConfirming] = useState<string | null>(null);
  const changeable = subscription && ["active", "trialing", "past_due"].includes(subscription.status);
  const onPaid = billing.plans.some((plan) => plan.id === billing.plan.id);

  return (
    <Card>
      <CardTitle>{subscription ? "Plans" : "Choose a plan"}</CardTitle>
      <ul className="grid gap-4 md:grid-cols-2">
        {billing.plans.map((plan) => {
          const current = plan.id === billing.plan.id;
          const detail = pricing.plans.find((item) => item.id === plan.id)?.detail;
          const thisMonth = monthTotal(plan, billing.finished);
          return (
            <li key={plan.id} className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-base font-medium">{plan.name}</h3>
                <span className="text-sm">
                  <span className="font-medium">{dollars(plan.monthlyUsd)}</span>
                  <span className="text-muted-foreground"> a month</span>
                </span>
              </div>
              <p className="text-sm leading-5 text-muted-foreground">
                {detail ? `${detail} ` : ""}
                {plan.includedGuides.toLocaleString()} finished guides a month included, then {each(plan.overageUsd)} each.
              </p>
              {!current && billing.finished > 0 && (
                <p className="text-sm leading-5">
                  With this {billing.period.kind === "billing" ? "period" : "month"}&apos;s {billing.finished.toLocaleString()} finished guides, {plan.name} would come to {dollars(thisMonth.total)}.
                </p>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                {current ? (
                  <span className="text-sm text-muted-foreground">Your plan</span>
                ) : !billing.canManage || !billing.ready ? null : !subscription ? (
                  <Button disabled={busy !== null} onClick={() => onCheckout(plan.id)}>
                    {busy === plan.id ? "Opening Stripe" : `Choose ${plan.name}`}
                  </Button>
                ) : changeable && onPaid ? (
                  confirming === plan.id ? (
                    <>
                      <Button disabled={busy !== null} onClick={() => onSwitch(plan.id)}>
                        {busy === plan.id ? "Switching" : `Switch to ${plan.name} now`}
                      </Button>
                      <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirming(null)}>
                        Keep my plan
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" onClick={() => setConfirming(plan.id)}>
                      Switch to {plan.name}
                    </Button>
                  )
                ) : null}
              </div>
              {confirming === plan.id && (
                <p className="text-xs leading-5 text-muted-foreground">
                  The change takes effect now. The monthly fee is prorated on your next invoice. Guides finished before the switch are billed at your current plan&apos;s rate.
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {!subscription && <Reasons />}
      <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
        {!billing.ready
          ? "Paying through the dashboard isn't switched on yet."
          : !billing.canManage
            ? "Only an owner or admin of your company can change the plan."
            : "Payment is through Stripe. Each month is billed on the first, with the plan's fee for the month ahead and any guides over the included amount from the month before. Cancel whenever you like."}{" "}
        For a larger rollout, email{" "}
        <a className="underline underline-offset-2" href={`mailto:${site.email}`}>
          {site.email}
        </a>
        .
      </p>
    </Card>
  );
}
