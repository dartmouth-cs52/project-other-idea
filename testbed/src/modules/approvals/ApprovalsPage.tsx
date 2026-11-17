import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { parseISO } from "date-fns";
import { ArrowUpRight, Check, Clock, Columns3, Copy, GripVertical, List, UserRoundCog, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useSession } from "@/app/session";
import { useCollection, useIndex } from "@/data/store";
import type { Approval, ApprovalKind, Employee } from "@/data/types";
import { useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { ago, date, fullName, money, shortDate } from "@/lib/format";
import { Button } from "@/ui/button";
import { Avatar, Callout, EmptyState, PageHeader, Person, StatusBadge } from "@/ui/display";
import { DataTable, type ColumnDef } from "@/ui/data-table";
import { Loader, RoleGate, toast } from "@/ui/flow";
import { NativeSelect } from "@/ui/form";
import { ContextMenu } from "@/ui/overlay";
import { approveMany, DelegateSheet, isOpen, KIND_LABELS, KIND_PLURAL, moveTo, RejectModal, STAGES, stageLabel, stageOf, useDelegation, type Stage } from "./shared";

// The approvals inbox, as a list or as a board you drag cards across.

const KINDS = Object.keys(KIND_LABELS) as ApprovalKind[];

export function ApprovalsPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "board" ? "board" : "list";
  const [delegateOpen, setDelegateOpen] = useState(false);
  const setParam = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );
  return (
    <>
      <PageHeader
        title="Approvals"
        description="Requests waiting on you and the rest of the approval chain."
        actions={
          <>
            <div role="radiogroup" aria-label="Layout" className="inline-flex rounded-md bg-sunken p-0.5">
              {(
                [
                  ["list", "List", <List key="l" className="size-4" />],
                  ["board", "Board", <Columns3 key="b" className="size-4" />],
                ] as const
              ).map(([v, label, icon]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  onClick={() => setParam("view", v === "list" ? null : v)}
                  className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[13px] font-medium text-ink-3", view === v && "bg-panel text-ink shadow-xs")}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
            <Button onClick={() => setDelegateOpen(true)}>
              <UserRoundCog /> Delegate approvals
            </Button>
          </>
        }
      />
      <DelegationBanner onEdit={() => setDelegateOpen(true)} />
      <Loader loadKey={["approvals", view]} rows={8}>
        {() => <Body view={view} kind={(params.get("kind") as ApprovalKind | null) ?? null} show={params.get("show") ?? "open"} setParam={setParam} />}
      </Loader>
      <DelegateSheet open={delegateOpen} onOpenChange={setDelegateOpen} />
    </>
  );
}

function DelegationBanner({ onEdit }: { onEdit: () => void }) {
  const d = useDelegation((s) => s.delegation);
  const set = useDelegation((s) => s.set);
  const people = useIndex("employees");
  if (!d) return null;
  return (
    <div className="mb-4">
      <Callout
        tone="info"
        title={`${fullName(people.get(d.delegateId))} is approving for you`}
        action={
          <span className="flex gap-2">
            <Button size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => set(null)}>
              End delegation
            </Button>
          </span>
        }
      >
        {date(d.from)} to {date(d.to)}
        {d.note ? `. "${d.note}"` : ""}
      </Callout>
    </div>
  );
}

function Body({ view, kind, show, setParam }: { view: "list" | "board"; kind: ApprovalKind | null; show: string; setParam: (k: string, v: string | null) => void }) {
  const all = useCollection("approvals");
  const people = useIndex("employees");
  const entity = useSession((s) => s.entity);
  const [rejecting, setRejecting] = useState<Approval[]>([]);
  const withEntity = useMemo(() => (entity === "all" ? all : all.filter((a) => people.get(a.requesterId)?.entityId === entity)), [all, people, entity]);
  const byKind = useMemo(() => (kind ? withEntity.filter((a) => a.kind === kind) : withEntity), [withEntity, kind]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of withEntity) if (isOpen(a)) c[a.kind] = (c[a.kind] ?? 0) + 1;
    return c;
  }, [withEntity]);
  const totalOpen = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-1.5">
          <KindChip active={!kind} onClick={() => setParam("kind", null)} label="All types" count={totalOpen} />
          {KINDS.map((k) => (
            <KindChip key={k} active={kind === k} onClick={() => setParam("kind", k)} label={KIND_PLURAL[k]} count={counts[k] ?? 0} />
          ))}
        </div>
        {view === "list" ? (
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            Show
            <NativeSelect aria-label="Show" value={show} onChange={(e) => setParam("show", e.target.value === "open" ? null : e.target.value)} className="w-52">
              <option value="open">Waiting for approval</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="all">Everything</option>
            </NativeSelect>
          </label>
        ) : null}
      </div>
      {view === "list" ? <InboxList items={byKind} show={show} people={people} onReject={setRejecting} /> : <Board items={byKind} people={people} onReject={setRejecting} />}
      <RejectModal items={rejecting} onOpenChange={(v) => !v && setRejecting([])} />
    </div>
  );
}

function KindChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium",
        active ? "border-brand bg-brand-soft text-brand" : "border-line-strong bg-panel text-ink-2 hover:bg-sunken",
      )}
    >
      {label}
      <span className={cn("tabular text-[11px]", active ? "text-brand" : "text-ink-3")}>{count}</span>
    </button>
  );
}

function Due({ a }: { a: Approval }) {
  const overdue = isOpen(a) && parseISO(a.dueAt) < new Date();
  return (
    <span className={cn("inline-flex items-center gap-1 tabular", overdue ? "text-danger" : "text-ink-2")}>
      {overdue ? <Clock className="size-3.5" /> : null}
      {isOpen(a) ? (overdue ? `Overdue ${ago(a.dueAt).replace(" ago", "")}` : `Due ${shortDate(a.dueAt)}`) : shortDate(a.dueAt)}
    </span>
  );
}

function InboxList({ items, show, people, onReject }: { items: Approval[]; show: string; people: Map<string, Employee>; onReject: (a: Approval[]) => void }) {
  const navigate = useNavigate();
  const can = useCan("approvals.decide");
  const rows = useMemo(
    () =>
      items
        .filter((a) => (show === "open" ? isOpen(a) : show === "all" ? true : a.status === show))
        .sort((a, b) => (isOpen(a) === isOpen(b) ? a.dueAt.localeCompare(b.dueAt) : isOpen(a) ? -1 : 1)),
    [items, show],
  );
  const columns = useMemo<ColumnDef<Approval, unknown>[]>(
    () => [
      {
        id: "title",
        header: "Request",
        accessorKey: "title",
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.title}</span>
            <span className="text-xs text-ink-3">{KIND_LABELS[row.original.kind]}</span>
          </span>
        ),
      },
      {
        id: "requester",
        header: "Requested by",
        accessorFn: (a) => fullName(people.get(a.requesterId)),
        cell: ({ row }) => <Person person={people.get(row.original.requesterId)} sub={ago(row.original.createdAt)} />,
      },
      { id: "amount", header: "Amount", accessorKey: "amount", size: 120, cell: ({ row }) => <span className="tabular">{row.original.kind === "vendor" ? <span className="text-ink-3">No amount</span> : money(row.original.amount, row.original.currency)}</span> },
      { id: "stage", header: "Stage", accessorFn: (a) => stageOf(a), size: 110, cell: ({ row }) => stageLabel(stageOf(row.original)) },
      { id: "due", header: "Due", accessorKey: "dueAt", size: 160, cell: ({ row }) => <Due a={row.original} /> },
      { id: "status", header: "Status", accessorKey: "status", size: 110, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: "decide",
        header: "",
        size: 190,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          isOpen(row.original) ? (
            // Every row has its own "Approve" and "Reject". Same label, many buttons, like a real inbox.
            <span className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              <RoleGate action="approvals.decide">
                {(allowed) => (
                  <Button size="sm" variant="ghost" disabled={!allowed} onClick={() => onReject([row.original])}>
                    Reject
                  </Button>
                )}
              </RoleGate>
              <RoleGate action="approvals.decide">
                {(allowed) => (
                  <Button size="sm" disabled={!allowed} onClick={() => approveMany([row.original])}>
                    <Check /> Approve
                  </Button>
                )}
              </RoleGate>
            </span>
          ) : null,
      },
    ],
    [people, onReject],
  );
  return (
    <DataTable
      label="Approval requests"
      data={rows}
      columns={columns}
      getRowId={(a) => a.id}
      height="calc(100vh - 300px)"
      selectable={can.allowed}
      rowHeight={52}
      onRowClick={(a) => navigate(`/approvals/${a.id}`)}
      bulkActions={(ids, clear) => {
        const picked = rows.filter((a) => ids.includes(a.id) && isOpen(a));
        return (
          <>
            <Button
              size="sm"
              variant="primary"
              disabled={!picked.length}
              onClick={async () => {
                await approveMany(picked);
                clear();
              }}
            >
              <Check /> Approve {picked.length}
            </Button>
            <Button
              size="sm"
              disabled={!picked.length}
              onClick={() => {
                onReject(picked);
                clear();
              }}
            >
              <X /> Reject {picked.length}
            </Button>
          </>
        );
      }}
      empty={<EmptyState icon={<Check />} title="You're all caught up" description="Nothing is waiting for approval with these filters." />}
    />
  );
}

function Board({ items, people, onReject }: { items: Approval[]; people: Map<string, Employee>; onReject: (a: Approval[]) => void }) {
  const can = useCan("approvals.decide");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dragging, setDragging] = useState<Approval | null>(null);
  const columns = useMemo(() => {
    const out: Record<Stage, Approval[]> = { manager: [], finance: [], controller: [], done: [] };
    for (const a of items) {
      out[stageOf(a)].push(a);
    }
    out.done = out.done.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
    return out;
  }, [items]);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const a = items.find((x) => x.id === e.active.id);
    const to = e.over?.id as Stage | undefined;
    if (!a || !to || !isOpen(a) || to === stageOf(a)) return;
    if (!can.allowed) {
      toast.error(can.reason);
      return;
    }
    moveTo(a, to);
  };
  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDragging(items.find((x) => x.id === e.active.id) ?? null)} onDragCancel={() => setDragging(null)} onDragEnd={onDragEnd}>
      {/* Scrolls sideways on narrow screens. */}
      <div className="relative -mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
        {STAGES.map((s) => (
          <Column key={s.id} stage={s.id} label={s.label} hint={s.who} count={columns[s.id].length}>
            {columns[s.id].length === 0 ? <p className="px-2 py-6 text-center text-[12.5px] text-ink-3">{s.id === "done" ? "Nothing decided yet." : "Nothing at this stage."}</p> : null}
            {columns[s.id].map((a) => (
              <BoardCard key={a.id} a={a} person={people.get(a.requesterId)} canDecide={can.allowed} onReject={onReject} />
            ))}
          </Column>
        ))}
      </div>
      <DragOverlay>{dragging ? <CardFace a={dragging} person={people.get(dragging.requesterId)} lifted /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ stage, label, hint, count, children }: { stage: Stage; label: string; hint: string; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <section ref={setNodeRef} aria-label={`${label} column`} className={cn("flex w-72 shrink-0 flex-col rounded-lg border border-line bg-sunken/60 lg:w-0 lg:min-w-52 lg:flex-1 lg:shrink", isOver && "border-brand bg-brand-soft/40")}>
      <header className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="flex flex-col">
          <span className="text-[13px] font-semibold">
            {label} <span className="font-normal text-ink-3 tabular">{count}</span>
          </span>
          {hint ? <span className="text-[11.5px] text-ink-3">{hint}</span> : <span className="text-[11.5px] text-ink-3">Drop here to approve</span>}
        </span>
      </header>
      {/* Each column scrolls on its own. */}
      <div className="flex max-h-[calc(100vh-320px)] min-h-40 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  );
}

function CardFace({ a, person, lifted }: { a: Approval; person: Employee | undefined; lifted?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-md border border-line bg-panel p-3 shadow-xs", lifted && "rotate-1 shadow-xl")}>
      <span className="flex items-center justify-between gap-2 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
        {KIND_LABELS[a.kind]}
        {isOpen(a) ? null : <StatusBadge status={a.status} />}
      </span>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] leading-snug font-medium">{a.title}</span>
        {a.kind !== "vendor" ? <span className="tabular text-[13px] whitespace-nowrap">{money(a.amount, a.currency, { compact: a.amount >= 10000 })}</span> : null}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs whitespace-nowrap text-ink-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <Avatar person={person} size={18} />
          <span className="truncate">{person?.firstName}</span>
        </span>
        <Due a={a} />
      </div>
    </div>
  );
}

function BoardCard({ a, person, canDecide, onReject }: { a: Approval; person: Employee | undefined; canDecide: boolean; onReject: (a: Approval[]) => void }) {
  const navigate = useNavigate();
  const open = isOpen(a);
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: a.id, disabled: !open || !canDecide });
  const otherStages = STAGES.filter((s) => s.id !== "done" && s.id !== stageOf(a));
  return (
    // Right-click for more. The menu has the only "Move to" controls besides dragging.
    <ContextMenu
      items={[
        { label: "Open request", icon: <ArrowUpRight />, onSelect: () => navigate(`/approvals/${a.id}`) },
        { label: "", separator: true },
        { label: "Approve", icon: <Check />, disabled: !open || !canDecide, onSelect: () => approveMany([a]) },
        { label: "Reject…", icon: <X />, disabled: !open || !canDecide, danger: true, onSelect: () => onReject([a]) },
        { label: "Move to", disabled: !open || !canDecide, items: otherStages.map((s) => ({ label: s.label, onSelect: () => moveTo(a, s.id) })) },
        { label: "", separator: true },
        {
          label: "Copy link",
          icon: <Copy />,
          onSelect: () => {
            navigator.clipboard?.writeText(`${location.origin}/approvals/${a.id}`).catch(() => undefined);
            toast.success("Link copied");
          },
        },
      ]}
    >
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        aria-roledescription="Draggable request"
        aria-label={a.title}
        onClick={() => navigate(`/approvals/${a.id}`)}
        className={cn("group relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand/40", isDragging && "opacity-40", open && canDecide && "cursor-grab")}
      >
        <CardFace a={a} person={person} />
        {open && canDecide ? <GripVertical aria-hidden className="absolute top-1/2 -left-0.5 size-3.5 -translate-y-1/2 text-ink-3 opacity-0 group-hover:opacity-100" /> : null}
      </div>
    </ContextMenu>
  );
}

