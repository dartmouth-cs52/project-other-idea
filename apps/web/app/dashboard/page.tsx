import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { currentOrganization } from "@/lib/auth";
import { OnboardingForm } from "./forms";

export const metadata = { title: "Sites" };

export default async function DashboardPage() {
  const { supabase, org } = await currentOrganization();

  if (!org) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 font-display font-normal tracking-[-0.02em] text-[34px] leading-tight">Set up Haptic</h1>
        <p className="mb-6 text-ink-muted">Tell us about the app your users need help with. You’ll get a script tag to paste into it.</p>
        <Card>
          <OnboardingForm />
        </Card>
      </div>
    );
  }

  const { data: sites } = await supabase
    .from("sites")
    .select("id, name, url, installed_at, installed_origin")
    .eq("org_id", org.id)
    .order("created_at");

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display font-normal tracking-[-0.02em] text-[34px] leading-tight">{org.name}</h1>
          <p className="text-ink-muted">Each site is one web app with its own key and settings.</p>
        </div>
        <Link href="/dashboard/sites/new" className="inline-flex h-9 items-center rounded-lg bg-ink px-3.5 font-medium text-white hover:bg-black">
          Add site
        </Link>
      </div>
      <div className="grid gap-3">
        {(sites ?? []).map((site) => (
          <Link key={site.id} href={`/dashboard/sites/${site.id}`} className="flex items-center justify-between rounded-xl border border-line bg-white p-4 hover:border-ink/30">
            <div>
              <div className="font-medium">{site.name}</div>
              <div className="text-ink-muted">{site.url}</div>
            </div>
            {site.installed_at ? <Badge tone="good">Installed</Badge> : <Badge tone="warn">Waiting for install</Badge>}
          </Link>
        ))}
      </div>
    </div>
  );
}
