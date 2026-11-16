import { endOfDay, format, parseISO, startOfDay, subDays } from "date-fns";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useCollection, useIndex } from "@/data/store";
import type { AuditEvent } from "@/data/types";
import { useCan } from "@/lib/access";
import { dateTime, fullName } from "@/lib/format";
import { Button } from "@/ui/button";
import { Person } from "@/ui/display";
import { DataTable, type ColumnDef } from "@/ui/data-table";
import { Field, Input, NativeSelect, Select, Switch } from "@/ui/form";
import { act, Loader, PlanGate, RoleGate } from "@/ui/flow";
import { Combobox, DateRangePicker, type Range } from "@/ui/inputs";
import { downloadText, FieldGrid, SaveCard, SettingsHeader, useDraft } from "./common";
import { useSettings } from "./store";

const ACTION_LABELS: Record<string, string> = {
  "signed in": "Signed in",
  "changed a card limit on": "Changed a card limit",
  froze: "Froze a card",
  approved: "Approved",
  rejected: "Rejected",
  exported: "Exported",
  invited: "Invited someone",
  "changed role for": "Changed a role",
  "created API key": "Created an API key",
  "updated policy": "Updated a policy",
  "downloaded statement for": "Downloaded a statement",
};

const day = (d: Date) => format(d, "yyyy-MM-dd");

export function AuditPage() {
  return (
    <>
      <SettingsHeader title="Audit log" description="Every sign-in and change in your workspace, kept for a year." />
      <PlanGate feature="auditLog" title="Audit log">
        <Loader loadKey="settings-audit" rows={14}>
          {() => (
            <div className="flex flex-col gap-5">
              <Log />
              <div className="grid gap-5 lg:grid-cols-2">
                <Retention />
                <Streaming />
              </div>
            </div>
          )}
        </Loader>
      </PlanGate>
    </>
  );
}

function Log() {
  const events = useCollection("audit");
  const people = useIndex("employees");
  const [actor, setActor] = useState<string | null>(null);
  const [action, setAction] = useState<string>("all");
  const [range, setRange] = useState<Range>({ from: null, to: null });
  const [q, setQ] = useState("");

  const actorOptions = useMemo(() => {
    const ids = [...new Set(events.map((e) => e.actorId))];
    return [{ value: "all", label: "Anyone" }, ...ids.map((id) => ({ value: id, label: fullName(people.get(id)), hint: people.get(id)?.title }))].sort((a, b) => (a.value === "all" ? -1 : b.value === "all" ? 1 : a.label.localeCompare(b.label)));
  }, [events, people]);

  const rows = useMemo(() => {
    const from = range.from ? startOfDay(parseISO(range.from)).toISOString() : null;
    const to = range.to ? endOfDay(parseISO(range.to)).toISOString() : range.from ? endOfDay(parseISO(range.from)).toISOString() : null;
    const needle = q.trim().toLowerCase();
    return events.filter(
      (e) =>
        (!actor || actor === "all" || e.actorId === actor) &&
        (action === "all" || e.action === action) &&
        (!from || e.at >= from) &&
        (!to || e.at <= to) &&
        (!needle || e.target.toLowerCase().includes(needle) || e.ip.includes(needle)),
    );
  }, [events, actor, action, range, q]);

  const columns: ColumnDef<AuditEvent, unknown>[] = [
    { id: "at", header: "When", accessorKey: "at", size: 190, cell: ({ row }) => <span className="tabular text-ink-2">{dateTime(row.original.at)}</span> },
    { id: "actor", header: "Who", accessorFn: (e) => fullName(people.get(e.actorId)), cell: ({ row }) => <Person person={people.get(row.original.actorId)} /> },
    { id: "action", header: "Action", accessorKey: "action", cell: ({ row }) => <span>{ACTION_LABELS[row.original.action] ?? row.original.action}</span> },
    { id: "target", header: "Target", accessorKey: "target", cell: ({ row }) => <span className="text-ink-2">{row.original.target}</span> },
    { id: "ip", header: "IP address", accessorKey: "ip", size: 140, cell: ({ row }) => <span className="font-mono text-[12.5px] text-ink-3">{row.original.ip}</span> },
  ];

  const today = new Date();
  const exportCsv = async () => {
    const csv = ["when,who,action,target,ip", ...rows.map((e) => [e.at, fullName(people.get(e.actorId)), ACTION_LABELS[e.action] ?? e.action, e.target, e.ip].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    await act(() => downloadText(`northpine-audit-${day(today)}.csv`, csv, "text/csv"), { success: `Exported ${rows.length.toLocaleString()} events` });
  };

  return (
    // 2,400 rows, virtualized: only the rows on screen exist in the page.
    <DataTable
      label="Audit events"
      data={rows}
      columns={columns}
      getRowId={(e) => e.id}
      virtual
      height={520}
      columnPicker
      initialSort={[{ id: "at", desc: true }]}
      toolbar={
        <>
          <Combobox aria-label="Actor" className="w-48" value={actor} onChange={setActor} options={actorOptions} placeholder="Anyone" searchPlaceholder="Search people…" />
          <Select
            aria-label="Action"
            className="w-52"
            value={action}
            onValueChange={setAction}
            options={[{ value: "all", label: "All actions" }, ...Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))]}
          />
          <DateRangePicker
            value={range}
            onChange={setRange}
            presets={[
              { label: "Today", range: { from: day(today), to: day(today) } },
              { label: "Yesterday", range: { from: day(subDays(today, 1)), to: day(subDays(today, 1)) } },
              { label: "Last 7 days", range: { from: day(subDays(today, 6)), to: day(today) } },
              { label: "Last 30 days", range: { from: day(subDays(today, 29)), to: day(today) } },
            ]}
          />
          <Input aria-label="Search targets" placeholder="Search targets or IPs" className="w-56" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="flex-1" />
          <RoleGate action="settings.security">
            {(ok) => (
              <Button size="sm" disabled={!ok} onClick={exportCsv}>
                <Download /> Export CSV
              </Button>
            )}
          </RoleGate>
        </>
      }
      empty={
        <div className="flex flex-col items-center gap-2 py-14 text-center text-[13px] text-ink-3">
          No events match these filters.
          <Button
            size="sm"
            onClick={() => {
              setActor(null);
              setAction("all");
              setRange({ from: null, to: null });
              setQ("");
            }}
          >
            Clear filters
          </Button>
        </div>
      }
    />
  );
}

function Retention() {
  const a = useSettings((s) => s.audit);
  const set = useSettings((s) => s.set);
  const { allowed } = useCan("settings.security");
  const { draft, update, dirty } = useDraft({ retention: a.retention });
  return (
    <SaveCard title="Retention" description="Events older than this are deleted. Exports you've downloaded are yours to keep." dirty={dirty} action="settings.security" onSave={() => set("audit", draft)} success="Retention saved">
      <Field label="Keep events for">
        {(id) => (
          <NativeSelect id={id} disabled={!allowed} value={draft.retention} onChange={(e) => update({ retention: e.target.value })}>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
            <option value="730">2 years</option>
            <option value="2555">7 years</option>
          </NativeSelect>
        )}
      </Field>
    </SaveCard>
  );
}

function Streaming() {
  const a = useSettings((s) => s.audit);
  const set = useSettings((s) => s.set);
  const { allowed } = useCan("settings.security");
  const { draft, update, dirty } = useDraft({ streamOn: a.streamOn, streamUrl: a.streamUrl });
  return (
    <SaveCard
      title="Stream to your SIEM"
      description={
        <>
          Send each event to your security tools as it happens. See <Link to="/help/api-keys" className="text-brand hover:underline">the setup guide</Link>.
        </>
      }
      dirty={dirty}
      action="settings.security"
      onSave={() => set("audit", draft)}
      success="Streaming saved"
    >
      <div className="flex flex-col gap-4">
        <Switch label="Stream audit events" disabled={!allowed} checked={draft.streamOn} onCheckedChange={(v) => update({ streamOn: v })} />
        {draft.streamOn ? (
          <FieldGrid>
            <Field label="HTTPS endpoint" className="sm:col-span-2">
              {(id) => <Input id={id} disabled={!allowed} placeholder="https://siem.example.com/ingest" value={draft.streamUrl} onChange={(e) => update({ streamUrl: e.target.value })} />}
            </Field>
          </FieldGrid>
        ) : null}
      </div>
    </SaveCard>
  );
}
