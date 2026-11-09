import { notFound } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";
import { appUrl, requireUser } from "@/lib/auth";
import { mergeAppearance, monthStart } from "@/lib/db/sites";
import { env } from "@/lib/env";
import { LABEL_THRESHOLD } from "@/lib/siteMap";
import { deleteSite, rotateKey, setLabelHidden } from "../../actions";
import { AppearanceForm, CopyButton, KnowledgeForm, OriginsForm } from "../../forms";

export const metadata = { title: "Site" };

export default async function SitePage({ params }: PageProps<"/dashboard/sites/[id]">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: site } = await supabase
    .from("sites")
    .select("id, org_id, name, url, publishable_key, allowed_origins, notes, appearance, voice_enabled, learning_enabled, installed_at, installed_origin, organizations(monthly_turn_limit)")
    .eq("id", id)
    .maybeSingle();
  if (!site) notFound();

  const [{ data: labels }, { data: turns }, { data: usage }] = await Promise.all([
    supabase.from("outline_labels").select("route, kind, label, seen_count, visitor_count, hidden").eq("site_id", id).order("route").order("visitor_count", { ascending: false }).limit(400),
    supabase.from("turns").select("id, kind, question, path, outcome, first_point_ms, created_at").eq("site_id", id).eq("kind", "ask").order("created_at", { ascending: false }).limit(15),
    supabase.from("usage_monthly").select("turns").eq("org_id", site.org_id).eq("month", monthStart()).maybeSingle(),
  ]);

  const snippet = `<script src="${appUrl()}/sdk/haptic.js" data-key="${site.publishable_key}" async></script>`;
  const nextSnippet = `import Script from "next/script";\n\n<Script src="${appUrl()}/sdk/haptic.js" data-key="${site.publishable_key}" strategy="afterInteractive" />`;
  const routes = groupByRoute(labels ?? []);
  const limit = site.organizations?.monthly_turn_limit ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display font-normal tracking-[-0.02em] text-[34px] leading-tight">{site.name}</h1>
          <p className="text-ink-muted">{site.url}</p>
        </div>
        {site.installed_at ? <Badge tone="good">Installed on {site.installed_origin}</Badge> : <Badge tone="warn">Waiting for first load</Badge>}
      </div>

      <Card title="Install" description="Paste this into your app's HTML, before the closing </body> tag. It loads asynchronously and won't slow your page.">
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <pre className="flex-1 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-[13px] text-white">{snippet}</pre>
            <CopyButton text={snippet} />
          </div>
          <details className="text-ink-muted">
            <summary className="cursor-pointer">Using Next.js?</summary>
            <div className="mt-2 flex items-start gap-3">
              <pre className="flex-1 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-[13px] text-white">{nextSnippet}</pre>
              <CopyButton text={nextSnippet} />
            </div>
            <p className="mt-2">Put it in your root layout so it loads on every page.</p>
          </details>
          <OriginsForm siteId={site.id} origins={site.allowed_origins} />
          <form action={rotateKey} className="flex items-center gap-3 border-t border-line pt-4">
            <input type="hidden" name="site_id" value={site.id} />
            <Button type="submit" variant="secondary">
              Rotate key
            </Button>
            <span className="text-ink-muted">The old key stops working right away. Update your snippet after rotating.</span>
          </form>
        </div>
      </Card>

      <Card title="Knowledge" description="Haptic reads each page as your users see it. Notes and learned pages help it with questions about other pages.">
        <KnowledgeForm siteId={site.id} notes={site.notes} learning={site.learning_enabled} />
        <div className="mt-6 border-t border-line pt-4">
          <h3 className="mb-1 font-medium">Learned pages</h3>
          <p className="mb-3 text-ink-muted">
            A label is used once {LABEL_THRESHOLD} or more different people have seen it, so one person’s own data never is. Hide anything you’d rather Haptic didn’t mention.
          </p>
          {routes.length === 0 ? (
            <p className="text-ink-muted">Nothing yet. Pages appear here as people use your app with Haptic installed.</p>
          ) : (
            <div className="divide-y divide-line rounded-lg border border-line">
              {routes.map(([route, items]) => (
                <div key={route} className="p-3">
                  <div className="mb-2 font-mono text-[13px]">{route}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((item) => (
                      <form key={`${item.kind}|${item.label}`} action={setLabelHidden}>
                        <input type="hidden" name="site_id" value={site.id} />
                        <input type="hidden" name="route" value={route} />
                        <input type="hidden" name="kind" value={item.kind} />
                        <input type="hidden" name="label" value={item.label} />
                        <input type="hidden" name="hidden" value={String(!item.hidden)} />
                        <button
                          type="submit"
                          title={item.hidden ? "Hidden. Click to use again." : `${item.kind}, seen by ${item.visitor_count ?? 0}${(item.visitor_count ?? 0) >= 10 ? "+" : ""} ${item.visitor_count === 1 ? "person" : "people"}. Click to hide.`}
                          className={`rounded-md border px-2 py-0.5 text-xs ${item.hidden ? "border-dashed border-line text-ink-muted line-through" : (item.visitor_count ?? 0) >= LABEL_THRESHOLD ? "border-line bg-canvas" : "border-line text-ink-muted"}`}
                        >
                          {item.label}
                        </button>
                      </form>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card title="Appearance">
        <AppearanceForm siteId={site.id} appearance={mergeAppearance(site.appearance)} voice={env.voiceFeature ? site.voice_enabled : undefined} />
      </Card>

      <Card title="Activity" description={`${usage?.turns ?? 0} of ${limit.toLocaleString()} questions used this month across your organization.`}>
        {(turns ?? []).length === 0 ? (
          <p className="text-ink-muted">No questions yet.</p>
        ) : (
          <table className="w-full">
            <thead className="text-left text-ink-muted">
              <tr>
                <th className="pb-2 font-medium">Question</th>
                <th className="pb-2 font-medium">Page</th>
                <th className="pb-2 font-medium">Result</th>
                <th className="pb-2 text-right font-medium">First point</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(turns ?? []).map((turn) => (
                <tr key={turn.id}>
                  <td className="py-2 pr-4">{turn.question}</td>
                  <td className="py-2 pr-4 font-mono text-[13px] text-ink-muted">{turn.path}</td>
                  <td className="py-2 pr-4">{turn.outcome}</td>
                  <td className="py-2 text-right text-ink-muted">{turn.first_point_ms ? `${turn.first_point_ms} ms` : "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <form action={deleteSite} className="flex items-center justify-between rounded-xl border border-red-200 bg-white p-5">
        <input type="hidden" name="site_id" value={site.id} />
        <div>
          <div className="font-medium">Delete site</div>
          <div className="text-ink-muted">Removes the key, notes and learned pages. The script stops working on your app.</div>
        </div>
        <Button type="submit" variant="danger">
          Delete site
        </Button>
      </form>
    </div>
  );
}

interface LabelRow {
  route: string;
  kind: string;
  label: string;
  seen_count: number;
  visitor_count: number | null;
  hidden: boolean;
}

function groupByRoute(rows: LabelRow[]): [string, LabelRow[]][] {
  const map = new Map<string, LabelRow[]>();
  for (const row of rows) map.set(row.route, [...(map.get(row.route) ?? []), row]);
  return Array.from(map.entries());
}
