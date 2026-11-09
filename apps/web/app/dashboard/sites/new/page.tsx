import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { currentOrganization } from "@/lib/auth";
import { NewSiteForm } from "../../forms";

export const metadata = { title: "Add site" };

export default async function NewSitePage() {
  const { org } = await currentOrganization();
  if (!org) redirect("/dashboard");
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-6 font-display font-normal tracking-[-0.02em] text-[34px] leading-tight">Add a site</h1>
      <Card>
        <NewSiteForm orgId={org.id} />
      </Card>
    </div>
  );
}
