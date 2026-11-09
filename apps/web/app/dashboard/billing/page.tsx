import { Badge, Button, Card } from "@/components/ui";
import { currentOrganization } from "@/lib/auth";
import { hasStripe, PLANS } from "@/lib/billing";
import { monthStart, trialEnded as hasTrialEnded } from "@/lib/db/sites";
import { openPortal, startCheckout } from "./actions";

export const metadata = { title: "Billing" };

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

export default async function BillingPage() {
  const { supabase, org, role } = await currentOrganization();
  if (!org) return <p className="text-ink-muted">Create a site first.</p>;

  const { data: usage } = await supabase.from("usage_monthly").select("turns").eq("org_id", org.id).eq("month", monthStart()).maybeSingle();
  const used = usage?.turns ?? 0;
  const percent = Math.min(100, Math.round((used / Math.max(1, org.monthly_turn_limit)) * 100));
  const trialEnded = hasTrialEnded(org);
  const plan = PLANS[org.plan as keyof typeof PLANS] ?? PLANS.trial;

  let status: React.ReactNode;
  if (org.subscription_status === "active") status = <Badge tone="good">Active</Badge>;
  else if (org.subscription_status === "past_due") status = <Badge tone="warn">Payment failed, retrying</Badge>;
  else if (trialEnded) status = <Badge tone="warn">Trial ended</Badge>;
  else if (org.subscription_status === "trialing") status = <Badge>Trial until {dateFormat.format(new Date(org.trial_ends_at))}</Badge>;
  else status = <Badge tone="warn">Not subscribed</Badge>;

  return (
    <div className="space-y-6">
      <h1 className="font-display font-normal tracking-[-0.02em] text-[34px] leading-tight">Billing</h1>
      <Card title={`${plan.name} plan`} actions={status}>
        <div className="mb-2 flex justify-between text-ink-muted">
          <span>Questions this month</span>
          <span>
            {used.toLocaleString()} of {org.monthly_turn_limit.toLocaleString()}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-canvas">
          <div className={`h-full rounded-full ${percent >= 90 ? "bg-amber-500" : "bg-accent"}`} style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-3 text-ink-muted">
          A question is one step of a guide. When the limit is reached, Haptic stops loading on your sites until the next month or an upgrade.
          {org.current_period_end && org.subscription_status === "active" && (
            <> {org.cancels_at_period_end ? "Ends" : "Renews"} on {dateFormat.format(new Date(org.current_period_end))}.</>
          )}
        </p>
      </Card>

      {!hasStripe() ? (
        <Card title="Payments aren't set up">
          <p className="text-ink-muted">Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID to the server environment to enable subscriptions.</p>
        </Card>
      ) : role !== "owner" ? (
        <p className="text-ink-muted">Only the organization owner can change billing.</p>
      ) : org.subscription_status === "active" || org.subscription_status === "past_due" ? (
        <form action={openPortal}>
          <Button type="submit" variant="secondary">
            Manage billing
          </Button>
        </form>
      ) : (
        <Card title="Starter" description={`${PLANS.starter.turns.toLocaleString()} questions a month across all your sites.`}>
          <form action={startCheckout}>
            <Button type="submit">Subscribe</Button>
          </form>
        </Card>
      )}
    </div>
  );
}
