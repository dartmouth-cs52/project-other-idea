import { Copy, CreditCard, Download, ExternalLink, Filter, LayoutGrid, List, Plus, Search, Snowflake, Sun, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useEntityFilter } from "@/app/session";
import { ME_ID, useCollection, useIndex } from "@/data/store";
import type { Card, CardStatus } from "@/data/types";
import { useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { date, fullName, masked, money } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { DataTable, type ColumnDef } from "@/ui/data-table";
import { Badge, Callout, EmptyState, LinkTabs, PageHeader, Person, Progress, Stat, StatusBadge } from "@/ui/display";
import { Checkbox, Input, NativeSelect, Select } from "@/ui/form";
import { act, Loader, RoleGate, toast } from "@/ui/flow";
import { Combobox } from "@/ui/inputs";
import { ContextMenu, Popover } from "@/ui/overlay";
import { patch } from "@/data/store";
import { CardArt, freezeCard, intervalShort, unfreezeCard, useFreezeRule } from "./shared";

type View = "mine" | "all" | "virtual" | "physical" | "frozen";
const STATUSES: CardStatus[] = ["active", "frozen", "shipping", "pending", "cancelled"];

export function CardsPage() {
  const manage = useCan("cards.manage");
  const issue = useCan("cards.issue");
  const [params] = useSearchParams();
  const view = (params.get("view") as View | null) ?? (manage.allowed ? "all" : "mine");
  const cards = useCollection("cards");
  const filterEntity = useEntityFilter();
  const scoped = useMemo(() => filterEntity(manage.allowed ? cards : cards.filter((c) => c.holderId === ME_ID)), [cards, filterEntity, manage.allowed]);
  const counts = useMemo(
    () => ({
      mine: scoped.filter((c) => c.holderId === ME_ID && c.status !== "cancelled").length,
      all: scoped.filter((c) => c.status !== "cancelled").length,
      virtual: scoped.filter((c) => c.kind === "virtual" && c.status !== "cancelled").length,
      physical: scoped.filter((c) => c.kind === "physical" && c.status !== "cancelled").length,
      frozen: scoped.filter((c) => c.status === "frozen").length,
    }),
    [scoped],
  );

  return (
    <>
      <PageHeader
        title="Cards"
        description="Every Northpine card in your company, virtual and physical. Freeze a card the moment something looks wrong."
        actions={
          <>
            <Button onClick={() => toast.success("Card list exported. Check your downloads.")}>
              <Download /> Export
            </Button>
            {issue.allowed ? null : (
              <Button asChild>
                <Link to="/cards/request">Request a card</Link>
              </Button>
            )}
            {/* Disabled with a reason for employees, who get "Request a card" next to it. On purpose. */}
            <RoleGate action="cards.issue">
              {(allowed) =>
                allowed ? (
                  <Button variant="primary" asChild>
                    <Link to="/cards/new">
                      <Plus /> Issue card
                    </Link>
                  </Button>
                ) : (
                  <Button variant="primary" disabled>
                    <Plus /> Issue card
                  </Button>
                )
              }
            </RoleGate>
          </>
        }
        tabs={
          <LinkTabs
            active={`/cards?view=${view}`}
            tabs={[
              { to: "/cards?view=mine", label: "My cards", count: counts.mine },
              { to: "/cards?view=all", label: "All cards", count: counts.all },
              { to: "/cards?view=virtual", label: "Virtual", count: counts.virtual },
              { to: "/cards?view=physical", label: "Physical", count: counts.physical },
              { to: "/cards?view=frozen", label: "Frozen", count: counts.frozen },
            ]}
          />
        }
      />
      <Loader loadKey={["cards", view]} rows={10}>
        {() => <CardsBody view={view} scoped={scoped} />}
      </Loader>
    </>
  );
}

interface Filters {
  q: string;
  statuses: CardStatus[];
  holder: string | null;
  department: string;
  entity: string;
}
const NO_FILTERS: Filters = { q: "", statuses: [], holder: null, department: "", entity: "" };

function CardsBody({ view, scoped }: { view: View; scoped: Card[] }) {
  const manage = useCan("cards.manage");
  const navigate = useNavigate();
  const people = useIndex("employees");
  const departments = useIndex("departments");
  const entities = useIndex("entities");
  const freezeRule = useFreezeRule();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [layout, setLayout] = useState<"table" | "grid">(() => {
    try {
      return localStorage.getItem("northpine-cards-layout") === "grid" ? "grid" : "table";
    } catch {
      return "table";
    }
  });
  const chooseLayout = (l: "table" | "grid") => {
    setLayout(l);
    try {
      localStorage.setItem("northpine-cards-layout", l);
    } catch {
      // ignore
    }
  };

  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return scoped.filter((c) => {
      if (view === "mine" && c.holderId !== ME_ID) return false;
      if (view === "virtual" && c.kind !== "virtual") return false;
      if (view === "physical" && c.kind !== "physical") return false;
      if (view === "frozen" && c.status !== "frozen") return false;
      if (view !== "frozen" && !filters.statuses.length && c.status === "cancelled") return false;
      if (filters.statuses.length && !filters.statuses.includes(c.status)) return false;
      if (filters.holder && c.holderId !== filters.holder) return false;
      if (filters.department && c.departmentId !== filters.department) return false;
      if (filters.entity && c.entityId !== filters.entity) return false;
      if (q) {
        const holder = people.get(c.holderId);
        const hay = `${c.nickname} ${c.last4} ${holder ? fullName(holder) : ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scoped, view, filters, people]);

  const mineAll = scoped.filter((c) => c.holderId === ME_ID);
  const active = rows.filter((c) => c.status === "active");
  const spent = rows.reduce((s, c) => s + (c.status === "cancelled" ? 0 : c.spentThisPeriod), 0);
  const limit = active.reduce((s, c) => s + c.limitAmount, 0);
  const nearLimit = active.filter((c) => c.spentThisPeriod / c.limitAmount > 0.8).length;

  const columns = useMemo<ColumnDef<Card, unknown>[]>(
    () => [
      {
        id: "card",
        header: "Card",
        accessorFn: (c) => c.nickname,
        size: 260,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <span className="flex min-w-0 items-center gap-3">
              <span className={cn("grid h-7 w-11 shrink-0 place-items-center rounded-[5px] text-[10px] font-semibold text-white", c.kind === "physical" ? "bg-brand" : "bg-slate-600", (c.status === "frozen" || c.status === "cancelled") && "grayscale opacity-70")}>
                {c.last4}
              </span>
              <span className="flex min-w-0 flex-col">
                <Link to={`/cards/${c.id}`} onClick={(e) => e.stopPropagation()} className="truncate font-medium text-ink hover:underline">
                  {c.nickname}
                </Link>
                <span className="text-xs text-ink-3">
                  {c.kind === "virtual" ? "Virtual" : "Physical"} {masked(c.last4)}
                </span>
              </span>
            </span>
          );
        },
      },
      {
        id: "holder",
        header: "Cardholder",
        accessorFn: (c) => fullName(people.get(c.holderId)),
        cell: ({ row }) => {
          const p = people.get(row.original.holderId);
          return (
            <Link to={`/people/${row.original.holderId}`} onClick={(e) => e.stopPropagation()} className="block hover:underline">
              <Person person={p} sub={row.original.holderId === ME_ID ? "You" : p?.title} />
            </Link>
          );
        },
      },
      { id: "status", header: "Status", accessorFn: (c) => c.status, size: 120, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: "limit",
        header: "Spent / limit",
        accessorFn: (c) => c.spentThisPeriod / c.limitAmount,
        size: 200,
        cell: ({ row }) => {
          const c = row.original;
          const p = (c.spentThisPeriod / c.limitAmount) * 100;
          return (
            <span className="flex flex-col gap-1">
              <span className="tabular text-[12.5px]">
                {money(c.spentThisPeriod)} <span className="text-ink-3">of {money(c.limitAmount, "USD", { compact: true })}{intervalShort(c.limitInterval)}</span>
              </span>
              <Progress value={p} tone={p > 90 ? "danger" : p > 75 ? "warn" : "brand"} />
            </span>
          );
        },
      },
      { id: "department", header: "Department", accessorFn: (c) => departments.get(c.departmentId)?.name ?? "", cell: ({ getValue }) => <span className="text-ink-2">{getValue() as string}</span> },
      { id: "entity", header: "Entity", accessorFn: (c) => entities.get(c.entityId)?.name ?? "", cell: ({ getValue }) => <span className="text-ink-2">{getValue() as string}</span> },
      { id: "merchant", header: "Merchant lock", accessorFn: (c) => c.merchantLock ?? "", cell: ({ getValue }) => <span className="text-ink-2">{(getValue() as string) || "Any merchant"}</span> },
      { id: "created", header: "Issued", accessorFn: (c) => c.createdAt, size: 120, cell: ({ getValue }) => <span className="text-ink-2">{date(getValue() as string)}</span> },
    ],
    [people, departments, entities],
  );

  const activeFilterCount = filters.statuses.length + (filters.holder ? 1 : 0) + (filters.department ? 1 : 0) + (filters.entity ? 1 : 0);

  const toolbar = (
    <>
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
        <Input aria-label="Search cards" placeholder="Search by name, holder or last 4" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} className="pl-8" />
      </div>
      <FilterPopover filters={filters} onChange={setFilters} count={activeFilterCount} />
      {activeFilterCount ? (
        <Button variant="ghost" size="sm" onClick={() => setFilters({ ...NO_FILTERS, q: filters.q })}>
          <X /> Clear filters
        </Button>
      ) : null}
      <div className="ml-auto flex items-center rounded-md border border-line-strong p-0.5">
        {/* The two layout toggles are icon-only. Only the tooltip says which is which. On purpose. */}
        <IconButton icon={<List />} label="Table view" size="icon-sm" named={false} className={cn(layout === "table" && "bg-sunken text-ink")} onClick={() => chooseLayout("table")} />
        <IconButton icon={<LayoutGrid />} label="Card view" size="icon-sm" named={false} className={cn(layout === "grid" && "bg-sunken text-ink")} onClick={() => chooseLayout("grid")} />
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active cards" value={active.length} hint={view === "mine" ? "held by you" : `${mineAll.length} are yours`} />
        <Stat label="Spent this period" value={short(spent)} hint="across the cards below" />
        <Stat label="Available to spend" value={short(Math.max(0, limit - active.reduce((s, c) => s + c.spentThisPeriod, 0)))} hint="on active cards" />
        <Stat label="Close to their limit" value={nearLimit} hint="over 80% used" delta={nearLimit ? { value: "Check limits", good: false } : undefined} />
      </div>

      {!manage.allowed && view !== "mine" ? (
        <Callout tone="info" title="You see only your own cards">
          Admins and Finance see everyone's. Ask them if you need a card for your team.
        </Callout>
      ) : null}

      {layout === "grid" ? (
        <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-xs">
          <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-line px-3 py-2">{toolbar}</div>
          {rows.length === 0 ? (
            <NoCards onClear={() => setFilters(NO_FILTERS)} />
          ) : (
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {rows.slice(0, 48).map((c) => {
                const rule = freezeRule(c);
                return (
                  // Right-click a card for its menu. On purpose: the actions exist only there in this view.
                  <ContextMenu
                    key={c.id}
                    items={[
                      { label: "Open card", icon: <ExternalLink />, onSelect: () => navigate(`/cards/${c.id}`) },
                      { label: "Copy last 4", icon: <Copy />, onSelect: () => copyLast4(c) },
                      { separator: true, label: "" },
                      c.status === "frozen"
                        ? { label: "Unfreeze card", icon: <Sun />, disabled: !rule.allowed, onSelect: () => void unfreezeCard(c) }
                        : { label: "Freeze card", icon: <Snowflake />, disabled: !rule.allowed, onSelect: () => void freezeCard(c) },
                    ]}
                  >
                    <Link to={`/cards/${c.id}`} className="group flex flex-col gap-2 rounded-xl p-1 hover:bg-sunken/70">
                      <CardArt card={c} holderName={fullName(people.get(c.holderId))} size="sm" />
                      <span className="flex items-center justify-between gap-2 px-1 text-[12.5px]">
                        <span className="truncate text-ink-2">{fullName(people.get(c.holderId))}</span>
                        <span className="tabular text-ink-3">
                          {money(c.spentThisPeriod, "USD", { compact: true })} / {money(c.limitAmount, "USD", { compact: true })}
                        </span>
                      </span>
                    </Link>
                  </ContextMenu>
                );
              })}
            </div>
          )}
          <div className="border-t border-line px-3 py-2 text-xs text-ink-3">
            {rows.length > 48 ? `Showing 48 of ${rows.length} cards. Switch to the table to see all, or narrow the filters.` : `${rows.length} cards`} Right-click a card for more.
          </div>
        </div>
      ) : (
        <DataTable
          label="Cards"
          data={rows}
          columns={columns}
          getRowId={(c) => c.id}
          virtual={rows.length > 40}
          height={560}
          selectable={manage.allowed}
          columnPicker
          initialHidden={["entity", "merchant", "created"]}
          onRowClick={(c) => navigate(`/cards/${c.id}`)}
          toolbar={toolbar}
          empty={<NoCards onClear={() => setFilters(NO_FILTERS)} />}
          rowActions={(c) => {
            const rule = freezeRule(c);
            return (
              <>
                {c.status === "frozen" ? (
                  <IconButton icon={<Sun />} label="Unfreeze card" size="icon-sm" disabled={!rule.allowed} onClick={() => void unfreezeCard(c)} />
                ) : (
                  <IconButton icon={<Snowflake />} label="Freeze card" size="icon-sm" disabled={!rule.allowed} onClick={() => void freezeCard(c)} />
                )}
                {/* Icon-only with no accessible name, on purpose. The tooltip says "Copy last 4". */}
                <IconButton icon={<Copy />} label="Copy last 4" size="icon-sm" named={false} onClick={() => copyLast4(c)} />
              </>
            );
          }}
          bulkActions={(ids, clear) => <BulkActions ids={ids} clear={clear} />}
        />
      )}
    </div>
  );
}

/** Compact only once the number is big enough to need it. */
const short = (n: number) => (n >= 10000 ? money(n, "USD", { compact: true }) : money(n));

function copyLast4(c: Card) {
  try {
    void navigator.clipboard?.writeText(c.last4);
  } catch {
    // ignore
  }
  toast.success(`Copied ${c.last4}`);
}

function NoCards({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      icon={<CreditCard />}
      title="No cards match"
      description="Nothing fits this tab and these filters. Clear the filters or pick another tab."
      action={
        <Button size="sm" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  );
}

function BulkActions({ ids, clear }: { ids: string[]; clear: () => void }) {
  const cards = useIndex("cards");
  const selected = ids.map((id) => cards.get(id)).filter((c): c is Card => !!c);
  const freezable = selected.filter((c) => c.status === "active");
  const unfreezable = selected.filter((c) => c.status === "frozen");
  return (
    <>
      <Button
        size="sm"
        disabled={!freezable.length}
        onClick={async () => {
          const prev = freezable.map((c) => [c.id, c.status] as const);
          await act(() => freezable.forEach((c) => patch("cards", c.id, { status: "frozen" })), {
            success: `${freezable.length} ${freezable.length === 1 ? "card" : "cards"} frozen`,
            undo: () => prev.forEach(([id, s]) => patch("cards", id, { status: s })),
          });
          clear();
        }}
      >
        <Snowflake /> Freeze {freezable.length || ""}
      </Button>
      <Button
        size="sm"
        disabled={!unfreezable.length}
        onClick={async () => {
          await act(() => unfreezable.forEach((c) => patch("cards", c.id, { status: "active" })), {
            success: `${unfreezable.length} ${unfreezable.length === 1 ? "card" : "cards"} unfrozen`,
            undo: () => unfreezable.forEach((c) => patch("cards", c.id, { status: "frozen" })),
          });
          clear();
        }}
      >
        <Sun /> Unfreeze {unfreezable.length || ""}
      </Button>
    </>
  );
}

function FilterPopover({ filters, onChange, count }: { filters: Filters; onChange: (f: Filters) => void; count: number }) {
  const people = useCollection("employees");
  const departments = useCollection("departments");
  const entities = useCollection("entities");
  const holderOptions = useMemo(() => people.filter((p) => p.status !== "offboarded").map((p) => ({ value: p.id, label: fullName(p), hint: p.title })), [people]);
  return (
    <Popover
      align="start"
      className="w-80 max-w-[calc(100vw-1rem)]"
      trigger={
        <Button size="sm">
          <Filter /> Filter
          {count ? <Badge tone="brand">{count}</Badge> : null}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-ink-3">Status</p>
          <div className="grid grid-cols-2 gap-2">
            {STATUSES.map((s) => (
              <Checkbox
                key={s}
                checked={filters.statuses.includes(s)}
                onCheckedChange={(v) => onChange({ ...filters, statuses: v ? [...filters.statuses, s] : filters.statuses.filter((x) => x !== s) })}
                label={s[0].toUpperCase() + s.slice(1)}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-ink-3">Cardholder</p>
          <Combobox aria-label="Cardholder" value={filters.holder} onChange={(v) => onChange({ ...filters, holder: v })} options={holderOptions} placeholder="Anyone" searchPlaceholder="Search people…" />
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-ink-3">Department</p>
          <Select
            aria-label="Department"
            value={filters.department}
            onValueChange={(v) => onChange({ ...filters, department: v === "any" ? "" : v })}
            placeholder="Any department"
            options={[{ value: "any", label: "Any department" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cards-entity-filter" className="text-xs font-medium text-ink-3">
            Entity
          </label>
          <NativeSelect id="cards-entity-filter" value={filters.entity} onChange={(e) => onChange({ ...filters, entity: e.target.value })}>
            <option value="">Any entity</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex justify-between border-t border-line pt-3">
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...NO_FILTERS, q: filters.q })}>
            Reset
          </Button>
        </div>
      </div>
    </Popover>
  );
}
