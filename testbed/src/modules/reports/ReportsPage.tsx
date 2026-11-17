import { CalendarClock, ChartArea, ChartColumn, ChartLine, ChartPie, Copy, LayoutGrid, Lock, MoreHorizontal, Plus, Share2, Table2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ME_ID, newId, remove, upsert, useCollection, useIndex } from "@/data/store";
import type { SavedReport } from "@/data/types";
import { useCan, useFeature } from "@/lib/access";
import { date } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { Badge, Card, EmptyState, PageHeader, Person } from "@/ui/display";
import { act, Loader, RoleGate } from "@/ui/flow";
import { Input } from "@/ui/form";
import { ConfirmDialog, Menu } from "@/ui/overlay";
import { ScheduleSheet, ShareModal } from "./dialogs";
import { TEMPLATES } from "./engine";

export const CHART_ICON = { bar: ChartColumn, line: ChartLine, area: ChartArea, pie: ChartPie, table: Table2 } as const;

export function ReportsPage() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Reports"
        description="Saved reports and templates, built from every card transaction."
        actions={
          <RoleGate action="reports.create">
            {(ok) => (
              <Button variant="primary" disabled={!ok} onClick={() => navigate("/reports/new")}>
                <Plus /> New report
              </Button>
            )}
          </RoleGate>
        }
      />
      <Loader loadKey="reports" rows={8}>
        {() => <ReportsBody />}
      </Loader>
    </>
  );
}

function ReportsBody() {
  const reports = useCollection("reports");
  const people = useIndex("employees");
  const navigate = useNavigate();
  const canCreate = useCan("reports.create").allowed;
  const advanced = useFeature("advancedReports");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<SavedReport | null>(null);
  const [sharing, setSharing] = useState<SavedReport | null>(null);
  const [scheduling, setScheduling] = useState<SavedReport | null>(null);
  const shown = useMemo(() => reports.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase())), [reports, query]);

  const duplicate = (r: SavedReport) =>
    act(() => upsert("reports", { ...r, id: newId("rep"), name: `${r.name} (copy)`, ownerId: ME_ID, schedule: "none", recipients: [], createdAt: new Date().toISOString() }), {
      success: `Duplicated "${r.name}"`,
    });

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Saved reports"
        description={`${reports.length} ${reports.length === 1 ? "report" : "reports"} you can open, schedule or share`}
        actions={<Input aria-label="Search saved reports" placeholder="Search reports" value={query} onChange={(e) => setQuery(e.target.value)} className="w-56" />}
        bodyClassName="p-0"
      >
        {shown.length === 0 ? (
          <EmptyState
            icon={<ChartColumn />}
            title={reports.length ? "No reports match" : "No saved reports yet"}
            description={reports.length ? "Try a different name." : "Start from a template below, or build one from scratch."}
            action={
              reports.length ? (
                <Button size="sm" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              ) : null
            }
          />
        ) : (
          <ul>
            {shown.map((r) => {
              const Icon = CHART_ICON[r.chart];
              return (
                <li key={r.id} className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-0 hover:bg-sunken/50">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-brand-soft text-brand">
                    <Icon className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Link to={`/reports/${r.id}`} className="truncate text-[13.5px] font-medium hover:underline">
                      {r.name}
                    </Link>
                    <span className="text-xs text-ink-3">Created {date(r.createdAt)}</span>
                  </span>
                  <span className="hidden w-44 md:block">
                    <Person person={people.get(r.ownerId)} sub={r.ownerId === ME_ID ? "You" : "Owner"} />
                  </span>
                  <span className="hidden w-36 lg:block">
                    {r.schedule === "none" ? (
                      <span className="text-xs text-ink-3">Not scheduled</span>
                    ) : (
                      <Badge tone="brand">
                        <CalendarClock className="size-3" /> {r.schedule[0].toUpperCase() + r.schedule.slice(1)}, {r.recipients.length} {r.recipients.length === 1 ? "recipient" : "recipients"}
                      </Badge>
                    )}
                  </span>
                  <Menu
                    trigger={
                      // Icon-only with no accessible name, on purpose. The tooltip says "More".
                      <IconButton icon={<MoreHorizontal />} label="More" named={false} size="icon-sm" />
                    }
                    items={[
                      { label: "Open", icon: <LayoutGrid />, onSelect: () => navigate(`/reports/${r.id}`) },
                      { label: "Duplicate", icon: <Copy />, onSelect: () => duplicate(r), disabled: !canCreate },
                      { label: advanced.enabled ? "Schedule" : "Schedule (Growth plan)", icon: advanced.enabled ? <CalendarClock /> : <Lock />, onSelect: () => setScheduling(r) },
                      { label: "Share", icon: <Share2 />, onSelect: () => setSharing(r) },
                      { separator: true, label: "" },
                      { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => setDeleting(r), disabled: !canCreate },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Start from a template</h2>
          <p className="text-[13px] text-ink-3">Each one opens in the report builder, where you can change anything before saving.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {TEMPLATES.map((t) => {
            const Icon = CHART_ICON[t.spec.chart];
            const locked = t.advanced && !advanced.enabled;
            return (
              <div key={t.id} className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4 shadow-xs">
                <span className="flex items-center justify-between">
                  <span className="grid size-8 place-items-center rounded-md bg-sunken text-ink-2">
                    <Icon className="size-4" />
                  </span>
                  {t.advanced ? <Badge tone={locked ? "neutral" : "brand"}>{locked ? <Lock className="size-3" /> : null} Advanced</Badge> : null}
                  {t.spec.groupBy.length > 1 ? <Badge tone="info">Pivot</Badge> : null}
                </span>
                <span className="flex flex-col gap-0.5">
                  <h3 className="text-[13.5px] font-semibold">{t.name}</h3>
                  <p className="text-[12.5px] text-ink-3">{t.description}</p>
                </span>
                {/* Every card has the same "Use template" button, on purpose. Only the heading above tells them apart. */}
                <Button size="sm" className="mt-auto self-start" disabled={!canCreate || locked} onClick={() => navigate(`/reports/new?template=${t.id}`)}>
                  Use template
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="The report and its schedule are deleted for everyone it's shared with."
        confirmLabel="Delete report"
        danger
        onConfirm={async () => {
          const r = deleting;
          if (r) await act(() => remove("reports", r.id), { success: `Deleted "${r.name}"`, undo: () => upsert("reports", r) });
        }}
      />
      {sharing ? <ShareModal report={sharing} open={!!sharing} onOpenChange={(v) => !v && setSharing(null)} /> : null}
      {scheduling ? <ScheduleSheet report={scheduling} open={!!scheduling} onOpenChange={(v) => !v && setScheduling(null)} /> : null}
    </div>
  );
}
