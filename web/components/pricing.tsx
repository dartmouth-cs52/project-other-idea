import { pricing } from "@/lib/site";

// What Haptic costs, drawn from the plans in lib/site.ts. The cards carry no
// buttons: the site has one call to action, in the navigation, and nothing can
// be bought here yet.

type Plan = (typeof pricing.plans)[number];

const dollars = (amount: number) => "$" + (Number.isInteger(amount) ? String(amount) : amount.toFixed(2));
const count = (guides: number) => guides.toLocaleString("en-US");

function price(plan: Plan): string {
  if (plan.monthlyUsd === null) return "Custom";
  return plan.monthlyUsd === 0 ? "Free" : dollars(plan.monthlyUsd);
}

function includes(plan: Plan): string {
  if (plan.includedGuides === null) return "Volume by agreement.";
  const beyond = plan.overageUsd === null ? "" : ", then " + dollars(plan.overageUsd) + " each";
  return count(plan.includedGuides) + " finished guides a month" + beyond + ".";
}

export function Pricing() {
  return (
    <section id="pricing" className="mx-auto w-full max-w-5xl scroll-mt-8 px-6 pt-20 md:pt-32">
      <div className="grid gap-4 md:grid-cols-2 md:gap-8">
        <h2 className="text-4xl font-medium tracking-[-0.03em]">Pricing</h2>
        <p className="text-lg text-balance text-muted-foreground">{pricing.lead}</p>
      </div>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {pricing.plans.map((plan) => (
          <li key={plan.id} className="rounded-xl border bg-muted p-6">
            <h3 className="font-medium">{plan.name}</h3>
            <p className="mt-4 text-2xl leading-8 font-medium tracking-[-0.02em]">
              {price(plan)}
              {plan.monthlyUsd ? <span className="text-base font-normal tracking-normal text-muted-foreground"> a month</span> : null}
            </p>
            <p className="mt-4">{includes(plan)}</p>
            <p className="mt-2 text-muted-foreground">{plan.detail}</p>
          </li>
        ))}
      </ul>
      <div className="mt-6 max-w-[65ch] space-y-1 text-sm text-muted-foreground">
        {pricing.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
    </section>
  );
}
