import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CalendarClock, ChevronDown, Download, FileDown, FileSpreadsheet, GripVertical, Lock, MessageSquare, Plus, Share2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ME_ID, newId, upsert, useCollection, useRow } from "@/data/store";
import type { SavedReport } from "@/data/types";
import { useCan, useFeature } from "@/lib/access";
import { cn } from "@/lib/cn";
import { date, shortDate } from "@/lib/format";
import { Button, IconButton, Tooltip } from "@/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/ui/display";
import { act, Loader, UnsavedGuard, UpgradePrompt } from "@/ui/flow";
import { Checkbox, Field, Input, Select, Switch } from "@/ui/form";
import { DateRangePicker, InlineEdit } from "@/ui/inputs";
import { Menu, Modal, Popover } from "@/ui/overlay";
import { useReportCtx } from "./ctx";
import { ScheduleSheet, ShareModal } from "./dialogs";
import { BLANK, DATE_PRESETS, dateLabel, FIELDS, fieldOf, METRICS, rangeOf, run, specFromSaved, specToSaved, TEMPLATES, valuesOf, type FieldKey, type Filter, type Spec } from "./engine";
import { CHART_ICON } from "./ReportsPage";
import { PivotTable, ReportChart, ResultTable } from "./ReportChart";

export function ReportBuilderPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const saved = useRow("reports", id);
  const template = TEMPLATES.find((t) => t.id === params.get("template"));
  if (id && !saved)
    return (
      <>
        <PageHeader title="Report not found" crumbs={[{ label: "Reports", to: "/reports" }, { label: "Not found" }]} />
        <EmptyState
          title="This report doesn't exist"
          description="It may have been deleted, or the link is wrong."
          action={
            <Button asChild>
              <Link to="/reports">Back to reports</Link>
            </Button>
          }
        />
      </>
    );
  const initial: Spec = saved ? specFromSaved(saved) : template ? { ...template.spec, name: template.name, filters: template.spec.filters.map((f) => ({ ...f, values: [...f.values] })) } : BLANK;
  return (
    <Loader loadKey={["report", id ?? "new", template?.id]} rows={10}>
      {() => <Builder key={id ?? `new-${template?.id ?? ""}`} saved={saved} initial={initial} />}
    </Loader>
  );
}

function Builder({ saved, initial }: { saved: SavedReport | undefined; initial: Spec }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tx = useCollection("transactions");
  const ctx = useReportCtx();
  const advanced = useFeature("advancedReports");
  const canCreate = useCan("reports.create");
  const [spec, setSpec] = useState<Spec>(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [saveOpen, setSaveOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(params.get("schedule") === "1");
  const [openFilter, setOpenFilter] = useState<FieldKey | null>(null);
  const [goTo, setGoTo] = useState<string | null>(null);
  const [dragging, setDragging] = useState<FieldKey | null>(null);
  const dirty = JSON.stringify(spec) !== baseline;

  // Navigate after the baseline catches up, so the unsaved guard doesn't stop it.
  useEffect(() => {
    if (goTo && !dirty) navigate(goTo, { replace: true });
  }, [goTo, dirty, navigate]);

  const result = useMemo(() => run(tx, spec, ctx), [tx, spec, ctx]);
  const g1 = fieldOf(spec.groupBy[0]);
  const g2 = fieldOf(spec.groupBy[1]);
  const set = (p: Partial<Spec>) => setSpec((s) => ({ ...s, ...p }));

  const addGroup = (key: FieldKey) =>
    setSpec((s) => {
      if (s.groupBy.includes(key)) return s;
      const groupBy = s.groupBy.length >= 2 ? [s.groupBy[0], key] : [...s.groupBy, key];
      return { ...s, groupBy, chart: groupBy.length > 1 ? "table" : s.chart };
    });
  // "Group by X" from the + menu makes X the rows. Dropping on the zone adds it, which makes a pivot when there's already one.
  const setRows = (key: FieldKey) =>
    setSpec((s) => {
      const groupBy = [key, ...s.groupBy.slice(1).filter((g) => g !== key)];
      return { ...s, groupBy, chart: groupBy.length > 1 ? "table" : s.chart };
    });
  const addFilter = (key: FieldKey) => {
    setSpec((s) => (s.filters.some((f) => f.field === key) ? s : { ...s, filters: [...s.filters, { field: key, values: [] }] }));
    setOpenFilter(key);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const key = String(e.active.id).replace("field:", "") as FieldKey;
    if (e.over?.id === "zone-group") addGroup(key);
    if (e.over?.id === "zone-filter") addFilter(key);
  };

  const saveExisting = async () => {
    if (!saved) return;
    const ok = await act(
      () => {
        upsert("reports", { ...saved, ...specToSaved(spec) });
        return true;
      },
      { success: "Report saved" },
    );
    if (ok) setBaseline(JSON.stringify(spec));
  };

  const exportCsv = () => {
    const header = result.pivot ? [g1?.label ?? "", ...result.pivot.cols.map((c) => c.label), "Total"] : [g1?.label ?? "Group", "Value", "Transactions"];
    const lines = result.pivot
      ? result.pivot.rows.map((r) => [r.label, ...result.pivot!.cols.map((c) => (result.pivot!.cells.get(`${r.key}\u0000${c.key}`) ?? 0).toFixed(2)), r.total.toFixed(2)])
      : result.rows.map((r) => [r.label, r.value.toFixed(2), String(r.count)]);
    const csv = [header, ...lines].map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec.name.replace(/[^\w]+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  };

  // A job that reports progress in a toast, like a real PDF render.
  const exportPdf = () => {
    const id = toast.loading("Preparing PDF… 0%");
    let p = 0;
    const timer = setInterval(() => {
      p += 20;
      if (p >= 100) {
        clearInterval(timer);
        toast.success("PDF ready. We also emailed it to you.", { id });
      } else toast.loading(`Preparing PDF… ${p}%`, { id });
    }, 450);
  };

  const crumbs = [{ label: "Reports", to: "/reports" }, { label: saved ? saved.name : "New report" }];

  return (
    <>
      <UnsavedGuard when={dirty && canCreate.allowed} />
      <PageHeader
        crumbs={crumbs}
        title={<InlineEdit value={spec.name} label="Report name" onSave={(name) => set({ name: name.trim() || "Untitled report" })} className="-ml-1 text-[22px] font-semibold" />}
        description={`${result.count.toLocaleString()} transactions, ${dateLabel(spec.date).toLowerCase()}. Declined charges are left out and refunds count against spend.`}
        meta={
          <>
            {saved?.schedule && saved.schedule !== "none" ? (
              <Badge tone="brand">
                <CalendarClock className="size-3" /> Emailed {saved.schedule}
              </Badge>
            ) : null}
            {dirty ? <Badge tone="warn">Unsaved changes</Badge> : saved ? <Badge tone="ok">Saved</Badge> : <Badge>Draft</Badge>}
          </>
        }
        actions={
          <>
            <Menu
              trigger={
                <Button>
                  <Download /> Export <ChevronDown className="text-ink-3" />
                </Button>
              }
              items={[
                { label: "Download CSV", icon: <FileSpreadsheet />, onSelect: exportCsv },
                { label: "Download PDF", icon: <FileDown />, onSelect: exportPdf },
                { separator: true, label: "" },
                // Disabled, and the reason is in small print inside the item, on purpose.
                {
                  label: (
                    <span className="flex flex-col">
                      Send to Slack
                      <span className="text-[11px] text-ink-3">Connect Slack in Settings first</span>
                    </span>
                  ),
                  icon: <MessageSquare />,
                  disabled: true,
                },
              ]}
            />
            {saved ? (
              <>
                <Button onClick={() => setShareOpen(true)}>
                  <Share2 /> Share
                </Button>
                <Button
                  onClick={() => {
                    setScheduleOpen(true);
                  }}
                >
                  {advanced.enabled ? <CalendarClock /> : <Lock />} Schedule
                </Button>
              </>
            ) : (
              <Tooltip content="Save the report before you schedule it.">
                <span tabIndex={0} className="inline-flex">
                  <Button disabled>
                    <CalendarClock /> Schedule
                  </Button>
                </span>
              </Tooltip>
            )}
            <Tooltip content={canCreate.allowed ? undefined : canCreate.reason}>
              <span tabIndex={canCreate.allowed ? undefined : 0} className="inline-flex">
                <Button variant="primary" disabled={!canCreate.allowed || (!!saved && !dirty)} onClick={() => (saved ? saveExisting() : setSaveOpen(true))}>
                  Save report
                </Button>
              </span>
            </Tooltip>
          </>
        }
      />

      <DndContext sensors={sensors} onDragStart={(e) => setDragging(String(e.active.id).replace("field:", "") as FieldKey)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <FieldsPanel spec={spec} advanced={advanced.enabled} onRows={setRows} onGroup={addGroup} onFilter={addFilter} />

          <div className="flex min-w-0 flex-col gap-5">
            <Card bodyClassName="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <DropZone id="zone-group" label="Group by" hint={spec.groupBy.length > 1 ? "First field is rows, second is columns." : "Drag a field here, or use + next to it. Add two for a pivot."}>
                  {spec.groupBy.map((g, i) => (
                    <span key={g} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-brand-soft pr-1 pl-2.5 text-[12.5px] font-medium text-brand">
                      {spec.groupBy.length > 1 ? <span className="text-[10.5px] tracking-wide uppercase opacity-70">{i === 0 ? "Rows" : "Columns"}</span> : null}
                      {fieldOf(g)?.label}
                      <button
                        type="button"
                        aria-label={`Remove ${fieldOf(g)?.label} from group by`}
                        className="grid size-5 cursor-pointer place-items-center rounded hover:bg-brand/10"
                        onClick={() => set({ groupBy: spec.groupBy.filter((x) => x !== g) })}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </DropZone>
                <DropZone id="zone-filter" label="Filters" hint="Drag a field here to narrow the results.">
                  {spec.filters.map((f) => (
                    <FilterChip
                      key={f.field}
                      filter={f}
                      open={openFilter === f.field}
                      onOpenChange={(v) => setOpenFilter(v ? f.field : null)}
                      onChange={(values) => set({ filters: spec.filters.map((x) => (x.field === f.field ? { ...x, values } : x)) })}
                      onRemove={() => set({ filters: spec.filters.filter((x) => x.field !== f.field) })}
                    />
                  ))}
                </DropZone>
              </div>
              <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
                <Field label="Metric" className="w-56">
                  {(id) => <Select id={id} aria-label="Metric" value={spec.metric} onValueChange={(metric) => set({ metric })} options={METRICS} />}
                </Field>
                <Field label="Date range" className="w-48">
                  {(id) => (
                    <Select
                      id={id}
                      aria-label="Date range"
                      value={DATE_PRESETS.some((p) => p.value === spec.date) ? spec.date : "custom"}
                      onValueChange={(v) => {
                        if (v !== "custom") return set({ date: v });
                        const r = rangeOf(spec.date);
                        set({ date: `${r.from}..${r.to}` });
                      }}
                      options={[...DATE_PRESETS, { value: "custom", label: "Custom range" }]}
                    />
                  )}
                </Field>
                {/* The calendar only appears for a custom range, on purpose. */}
                {DATE_PRESETS.some((p) => p.value === spec.date) ? null : (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium">From and to</span>
                    <DateRangePicker
                      value={rangeOf(spec.date)}
                      onChange={(r) => {
                        if (!r.from) return;
                        set({ date: `${r.from}..${r.to ?? r.from}` });
                      }}
                    />
                  </div>
                )}
                <span className="tabular ml-auto self-center text-xs text-ink-3">{(() => { const r = rangeOf(spec.date); return `${shortDate(r.from)} to ${date(r.to)}`; })()}</span>
              </div>
            </Card>

            <Card
              title={result.pivot ? `${g1?.label} by ${g2?.label?.toLowerCase()}` : g1 ? `${METRICS.find((m) => m.value === spec.metric)?.label} by ${g1.label.toLowerCase()}` : "Total"}
              description={result.pivot ? "Scroll sideways to see every column." : undefined}
              actions={
                <div role="radiogroup" aria-label="Chart type" className="inline-flex rounded-md bg-sunken p-0.5">
                  {(["bar", "line", "area", "pie", "table"] as const).map((c) => {
                    const Icon = CHART_ICON[c];
                    const label = c === "table" ? "Table only" : `${c[0].toUpperCase()}${c.slice(1)} chart`;
                    const disabled = !!result.pivot && c !== "table";
                    return (
                      <IconButton
                        key={c}
                        role="radio"
                        aria-checked={spec.chart === c}
                        icon={<Icon />}
                        label={disabled ? `${label} (not for pivots)` : label}
                        size="icon-sm"
                        disabled={disabled}
                        onClick={() => set({ chart: c })}
                        className={cn("rounded-[5px]", spec.chart === c && "bg-panel text-ink shadow-xs hover:bg-panel")}
                      />
                    );
                  })}
                </div>
              }
              bodyClassName={result.pivot || spec.chart === "table" ? "p-0" : undefined}
            >
              {!g1 ? (
                <div className="flex flex-col items-center gap-1 py-10">
                  <span className="text-[13px] text-ink-3">{METRICS.find((m) => m.value === spec.metric)?.label}</span>
                  <span className="tabular text-3xl font-semibold">{result.count ? new Intl.NumberFormat("en-US", spec.metric === "count" ? {} : { style: "currency", currency: "USD" }).format(result.total) : "0"}</span>
                  <span className="text-xs text-ink-3">Add a field to Group by to break it down.</span>
                </div>
              ) : result.pivot ? (
                <PivotTable result={result} metric={spec.metric} rowLabel={g1.label} />
              ) : spec.chart === "table" ? (
                <ResultTable result={result} metric={spec.metric} groupLabel={g1.label} />
              ) : (
                <ReportChart result={result} chart={spec.chart} metric={spec.metric} timeSeries={!!g1.time} />
              )}
            </Card>

            {g1 && !result.pivot && spec.chart !== "table" ? (
              <Card title="Results" description={`${result.rows.length} ${g1.label.toLowerCase()} groups`} bodyClassName="p-0">
                <ResultTable result={result} metric={spec.metric} groupLabel={g1.label} />
              </Card>
            ) : null}
          </div>
        </div>
        <DragOverlay>{dragging ? <span className="inline-flex h-8 items-center gap-2 rounded-md border border-brand bg-panel px-3 text-[13px] font-medium shadow-lg">{fieldOf(dragging)?.label}</span> : null}</DragOverlay>
      </DndContext>

      <SaveModal
        open={saveOpen}
        onOpenChange={setSaveOpen}
        name={spec.name}
        onSave={async (name, schedule) => {
          const report: SavedReport = { id: newId("rep"), ownerId: ME_ID, createdAt: new Date().toISOString(), schedule: "none", recipients: [], ...specToSaved({ ...spec, name }) };
          const ok = await act(
            () => {
              upsert("reports", report);
              return true;
            },
            { success: `Saved "${name}"` },
          );
          if (!ok) return false;
          const next = { ...spec, name };
          setSpec(next);
          setBaseline(JSON.stringify(next));
          setGoTo(`/reports/${report.id}${schedule ? "?schedule=1" : ""}`);
          return true;
        }}
      />
      {saved ? (
        <>
          <ShareModal report={saved} open={shareOpen} onOpenChange={setShareOpen} />
          <ScheduleSheet
            report={saved}
            open={scheduleOpen}
            onOpenChange={(v) => {
              setScheduleOpen(v);
              if (!v && params.get("schedule")) setParams({}, { replace: true });
            }}
          />
        </>
      ) : null}
    </>
  );
}

/** The fields you can drag. Each also has a + menu for people who don't drag. */
function FieldsPanel({ spec, advanced, onRows, onGroup, onFilter }: { spec: Spec; advanced: boolean; onRows: (k: FieldKey) => void; onGroup: (k: FieldKey) => void; onFilter: (k: FieldKey) => void }) {
  const groups = [...new Set(FIELDS.map((f) => f.group))];
  return (
    <Card title="Fields" description="Drag into Group by or Filters" className="self-start lg:sticky lg:top-20" bodyClassName="p-0">
      {/* Its own scroll area inside the page, on purpose. */}
      <div className="flex max-h-[calc(100vh-14rem)] flex-col gap-4 overflow-y-auto p-3">
        {groups.map((g) => {
          const locked = g === "Custom fields" && !advanced;
          return (
            <div key={g} className="flex flex-col gap-1">
              <span className="flex items-center justify-between px-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                {g}
                {locked ? <Lock className="size-3" /> : null}
              </span>
              {FIELDS.filter((f) => f.group === g).map((f) => (
                <FieldChip key={f.key} field={f.key} label={f.label} used={spec.groupBy.includes(f.key) || spec.filters.some((x) => x.field === f.key)} locked={locked} onRows={onRows} onGroup={onGroup} onFilter={onFilter} />
              ))}
              {locked ? (
                <div className="px-1 pt-1">
                  <UpgradePrompt title="Custom fields" needs="growth" compact />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function FieldChip({ field, label, used, locked, onRows, onGroup, onFilter }: { field: FieldKey; label: string; used: boolean; locked: boolean; onRows: (k: FieldKey) => void; onGroup: (k: FieldKey) => void; onFilter: (k: FieldKey) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `field:${field}`, disabled: locked });
  return (
    <div className={cn("group flex h-8 items-center gap-1 rounded-md border border-transparent pr-1 text-[13px] hover:border-line hover:bg-sunken/60", isDragging && "opacity-40", locked && "opacity-50")}>
      <span ref={setNodeRef} {...listeners} {...attributes} aria-label={`Drag ${label}`} className={cn("flex h-full flex-1 items-center gap-1.5 pl-1", locked ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing")}>
        <GripVertical className="size-3.5 text-ink-3" />
        <span className={cn("truncate", used && "font-medium text-brand")}>{label}</span>
      </span>
      <Menu
        label={`Add ${label}`}
        trigger={
          <button type="button" aria-label={`Add ${label}`} disabled={locked} className="grid size-6 cursor-pointer place-items-center rounded text-ink-3 opacity-60 group-hover:opacity-100 hover:bg-line hover:text-ink disabled:cursor-not-allowed">
            <Plus className="size-3.5" />
          </button>
        }
        items={[
          { label: `Group by ${label}`, onSelect: () => onRows(field) },
          { label: `Add ${label} as columns`, onSelect: () => onGroup(field) },
          { label: `Filter by ${label}`, onSelect: () => onFilter(field) },
        ]}
      />
    </div>
  );
}

function DropZone({ id, label, hint, children }: { id: string; label: string; hint: string; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  const empty = Array.isArray(children) ? children.length === 0 : !children;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      <div
        ref={setNodeRef}
        aria-label={`${label} drop zone`}
        className={cn("flex min-h-12 flex-wrap items-center gap-1.5 rounded-lg border-2 border-dashed border-line-strong p-2 transition-colors", isOver && "border-brand bg-brand-soft/60")}
      >
        {children}
        {empty ? <span className="px-1 text-[12.5px] text-ink-3">{hint}</span> : null}
      </div>
      {!empty ? <span className="text-xs text-ink-3">{hint}</span> : null}
    </div>
  );
}

function FilterChip({ filter, open, onOpenChange, onChange, onRemove }: { filter: Filter; open: boolean; onOpenChange: (v: boolean) => void; onChange: (v: string[]) => void; onRemove: () => void }) {
  const tx = useCollection("transactions");
  const ctx = useReportCtx();
  const def = fieldOf(filter.field)!;
  const [q, setQ] = useState("");
  const options = useMemo(() => (open ? valuesOf(filter.field, tx, ctx) : []), [open, filter.field, tx, ctx]);
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  const summary = filter.values.length === 0 ? "any" : filter.values.length === 1 ? def.label_(filter.values[0], ctx) : `${filter.values.length} selected`;
  return (
    <span className="inline-flex h-7 items-center rounded-md border border-line-strong bg-panel text-[12.5px]">
      <Popover
        open={open}
        onOpenChange={onOpenChange}
        className="w-72 max-w-[calc(100vw-1rem)] p-0"
        trigger={
          <button type="button" className="h-full cursor-pointer rounded-l-md pr-1.5 pl-2.5 hover:bg-sunken">
            <span className="text-ink-3">{def.label}:</span> <span className={cn("font-medium", !filter.values.length && "text-warn")}>{summary}</span>
          </button>
        }
      >
        <div className="border-b border-line p-2">
          <Input autoFocus aria-label={`Search ${def.label.toLowerCase()} values`} placeholder={`Search ${def.label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto p-3">
          {shown.map((o) => (
            <Checkbox
              key={o.value}
              checked={filter.values.includes(o.value)}
              onCheckedChange={(v) => onChange(v ? [...filter.values, o.value] : filter.values.filter((x) => x !== o.value))}
              label={o.label}
            />
          ))}
          {!shown.length ? <p className="text-[12.5px] text-ink-3">No values match.</p> : null}
        </div>
        <div className="flex justify-between border-t border-line px-3 py-2">
          <Button size="sm" variant="ghost" onClick={() => onChange([])}>
            Clear
          </Button>
          <Button size="sm" variant="primary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </Popover>
      <button type="button" aria-label={`Remove ${def.label} filter`} onClick={onRemove} className="grid h-full w-6 cursor-pointer place-items-center rounded-r-md border-l border-line text-ink-3 hover:bg-sunken hover:text-ink">
        <X className="size-3" />
      </button>
    </span>
  );
}

function SaveModal({ open, onOpenChange, name, onSave }: { open: boolean; onOpenChange: (v: boolean) => void; name: string; onSave: (name: string, schedule: boolean) => Promise<boolean> }) {
  const [value, setValue] = useState(name);
  const [schedule, setSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reports = useCollection("reports");
  const advanced = useFeature("advancedReports");
  useEffect(() => {
    if (open) {
      setValue(name === "Untitled report" ? "" : name);
      setError(null);
    }
  }, [open, name]);
  const submit = async () => {
    const n = value.trim();
    if (!n) return setError("Give the report a name.");
    if (reports.some((r) => r.name.toLowerCase() === n.toLowerCase())) return setError("You already have a report with this name.");
    setBusy(true);
    const ok = await onSave(n, schedule && advanced.enabled);
    setBusy(false);
    if (ok) onOpenChange(false);
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Save report"
      description="Saved reports show up on the Reports page for you and anyone you share them with."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Report name" error={error}>
          {(id) => <Input id={id} autoFocus value={value} aria-invalid={!!error} placeholder="Spend by merchant, Q3" onChange={(e) => (setValue(e.target.value), setError(null))} />}
        </Field>
        <Switch checked={schedule && advanced.enabled} disabled={!advanced.enabled} onCheckedChange={setSchedule} label="Schedule it next" description={advanced.enabled ? "Opens the schedule panel after saving." : "Scheduling is on the Growth plan."} />
      </form>
    </Modal>
  );
}
