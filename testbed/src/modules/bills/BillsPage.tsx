import { addDays, format } from "date-fns";
import { Copy, Download, FileText, MoreHorizontal, Paperclip, Plus, Store } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useEntityFilter } from "@/app/session";
import { patch, useCollection, useIndex } from "@/data/store";
import type { Bill } from "@/data/types";
import { useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { date, money } from "@/lib/format";
import { Button, IconButton, Tooltip } from "@/ui/button";
import { DataTable, Pager, type ColumnDef } from "@/ui/data-table";
import { Card, EmptyState, LinkTabs, PageHeader, Stat, StatusBadge } from "@/ui/display";
import { act, Loader, RoleGate, toast } from "@/ui/flow";
import { Field, Input, NativeSelect, Select } from "@/ui/form";
import { DatePicker, DateRangePicker, type Range } from "@/ui/inputs";
import { ConfirmDialog, Menu, Modal } from "@/ui/overlay";
import { PayBillModal } from "./PayBillModal";
import { BILL_TABS, billTotal, dueLabel, FORWARD_EMAIL } from "./shared";

const PAGE_SIZE = 20;

export function BillsPage() {
  return (
    <>
      <PageHeader
        title="Bills"
        description="Every invoice your vendors send, from inbox to paid."
        actions={
          <>
            <Button asChild>
              <Link to="/bills/vendors">
                <Store /> Vendors
              </Link>
            </Button>
            <RoleGate action="bills.create">
              {(allowed) =>
                allowed ? (
                  <Button variant="primary" asChild>
                    <Link to="/bills/new">
                      <Plus /> New bill
                    </Link>
                  </Button>
                ) : (
                  <Button variant="primary" disabled>
                    <Plus /> New bill
                  </Button>
                )
              }
            </RoleGate>
          </>
        }
      />
      <Loader loadKey="bills" rows={10}>
        {() => <BillsBody />}
      </Loader>
    </>
  );
}

function BillsBody() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const filter = useEntityFilter();
  const allBills = useCollection("bills");
  const bills = useMemo(() => filter(allBills), [allBills, filter]);
  const vendors = useIndex("vendors");
  const entities = useCollection("entities");

  const tabParam = params.get("status") ?? "inbox";
  const tab = BILL_TABS.find((t) => t.param === tabParam) ?? BILL_TABS[0];
  const q = params.get("q") ?? "";
  const vendorId = params.get("vendor") ?? "";
  const entityId = params.get("entity") ?? "";
  const [range, setRange] = useState<Range>({ from: null, to: null });
  const page = Math.max(1, Number(params.get("page") ?? 1));

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of bills) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [bills]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return bills
      .filter((b) => b.status === tab.status)
      .filter((b) => !vendorId || b.vendorId === vendorId)
      .filter((b) => !entityId || b.entityId === entityId)
      .filter((b) => !range.from || b.dueDate >= range.from)
      .filter((b) => !range.to || b.dueDate <= range.to)
      .filter((b) => !needle || b.number.toLowerCase().includes(needle) || (vendors.get(b.vendorId)?.name.toLowerCase().includes(needle) ?? false))
      .sort((a, b) => (tab.status === "paid" ? (b.paidAt ?? "").localeCompare(a.paidAt ?? "") : a.dueDate.localeCompare(b.dueDate)));
  }, [bills, tab.status, vendorId, entityId, range, q, vendors]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const overdueTotal = bills.filter((b) => b.status === "overdue").reduce((s, b) => s + billTotal(b), 0);
  const weekOut = format(addDays(new Date(), 7), "yyyy-MM-dd");
  const dueSoon = bills.filter((b) => (b.status === "awaiting_approval" || b.status === "scheduled") && b.dueDate <= weekOut);
  const scheduledTotal = bills.filter((b) => b.status === "scheduled").reduce((s, b) => s + billTotal(b), 0);

  const [payBill, setPayBill] = useState<Bill | null>(null);
  const [voidBill, setVoidBill] = useState<Bill | null>(null);
  const [scheduleIds, setScheduleIds] = useState<{ ids: string[]; clear: () => void } | null>(null);
  const pay = useCan("bills.pay");

  const columns = useMemo<ColumnDef<Bill, unknown>[]>(
    () => [
      {
        id: "number",
        header: "Bill",
        accessorKey: "number",
        size: 130,
        cell: ({ row }) => (
          <Link to={`/bills/${row.original.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-ink hover:text-brand hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        id: "vendor",
        header: "Vendor",
        accessorFn: (b) => vendors.get(b.vendorId)?.name ?? "",
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{vendors.get(row.original.vendorId)?.name}</span>
            <span className="truncate text-xs text-ink-3">{entities.find((e) => e.id === row.original.entityId)?.name}</span>
          </span>
        ),
      },
      { id: "issued", header: "Issued", accessorKey: "issueDate", size: 120, cell: ({ row }) => <span className="text-ink-2">{date(row.original.issueDate)}</span> },
      {
        id: "due",
        header: "Due",
        accessorKey: "dueDate",
        size: 150,
        cell: ({ row }) => {
          const d = dueLabel(row.original.dueDate, row.original.status);
          return (
            <span className="flex flex-col">
              <span>{date(row.original.dueDate)}</span>
              {d ? <span className={cn("text-xs", d.late ? "text-danger" : "text-ink-3")}>{d.text}</span> : null}
            </span>
          );
        },
      },
      {
        id: "scheduled",
        header: "Pays on",
        accessorFn: (b) => b.scheduledFor ?? b.paidAt ?? "",
        size: 120,
        cell: ({ row }) => <span className="text-ink-2">{row.original.scheduledFor ? date(row.original.scheduledFor) : row.original.paidAt ? date(row.original.paidAt.slice(0, 10)) : "Not set"}</span>,
      },
      { id: "po", header: "PO", accessorKey: "poNumber", size: 100, cell: ({ row }) => <span className="text-ink-3">{row.original.poNumber ?? "None"}</span> },
      {
        id: "attachment",
        header: "File",
        enableSorting: false,
        size: 60,
        cell: ({ row }) =>
          row.original.attachmentName ? (
            <Tooltip content={row.original.attachmentName}>
              <span className="text-ink-3">
                <Paperclip className="size-3.5" />
              </span>
            </Tooltip>
          ) : null,
      },
      {
        id: "amount",
        header: "Amount",
        accessorFn: (b) => billTotal(b),
        size: 130,
        cell: ({ row }) => <span className="tabular block text-right font-medium">{money(billTotal(row.original), row.original.currency)}</span>,
      },
      { id: "status", header: "Status", accessorKey: "status", size: 150, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [vendors, entities],
  );

  const tabs = BILL_TABS.map((t) => ({ to: t.param === "inbox" ? "/bills" : `/bills?status=${t.param}`, label: t.label, count: counts[t.status] ?? 0 }));
  const activeTab = tab.param === "inbox" ? "/bills" : `/bills?status=${tab.param}`;
  const filtersOn = !!(q || vendorId || entityId || range.from);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.35fr]">
        <Link to="/bills?status=overdue" className="block rounded-lg hover:ring-2 hover:ring-brand/20">
          <Stat label="Overdue" value={money(overdueTotal, "USD", { compact: true })} hint={`${counts.overdue ?? 0} bills`} delta={{ value: "Pay first", good: false }} />
        </Link>
        <Stat label="Due in the next 7 days" value={money(dueSoon.reduce((s, b) => s + billTotal(b), 0), "USD", { compact: true })} hint={`${dueSoon.length} bills`} />
        <Link to="/bills?status=scheduled" className="block rounded-lg hover:ring-2 hover:ring-brand/20">
          <Stat label="Scheduled" value={money(scheduledTotal, "USD", { compact: true })} hint={`${counts.scheduled ?? 0} payments`} />
        </Link>
        <ForwardingCard />
      </div>

      <LinkTabs tabs={tabs} active={activeTab} />

      <div className="flex flex-col gap-3">
        <DataTable
          label={`${tab.label} bills`}
          data={pageRows}
          columns={columns}
          getRowId={(b) => b.id}
          height="none"
          selectable
          columnPicker
          initialHidden={["po", "issued"]}
          onRowClick={(b) => navigate(`/bills/${b.id}`)}
          toolbar={
            <>
              <Input aria-label="Search bills" placeholder="Search vendor or bill number" className="w-full sm:w-64" value={q} onChange={(e) => setParam("q", e.target.value)} />
              <Select
                aria-label="Vendor"
                className="w-48"
                value={vendorId || "all"}
                onValueChange={(v) => setParam("vendor", v === "all" ? null : v)}
                options={[{ value: "all", label: "All vendors" }, ...[...vendors.values()].sort((a, b) => a.name.localeCompare(b.name)).map((v) => ({ value: v.id, label: v.name }))]}
              />
              <NativeSelect aria-label="Entity" className="w-44" value={entityId} onChange={(e) => setParam("entity", e.target.value || null)}>
                <option value="">All entities</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </NativeSelect>
              <DateRangePicker
                value={range}
                onChange={(r) => {
                  setRange(r);
                  setParam("page", null);
                }}
                presets={[
                  { label: "Due this week", range: { from: format(new Date(), "yyyy-MM-dd"), to: weekOut } },
                  { label: "Due in 30 days", range: { from: format(new Date(), "yyyy-MM-dd"), to: format(addDays(new Date(), 30), "yyyy-MM-dd") } },
                ]}
              />
              {filtersOn ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRange({ from: null, to: null });
                    const next = new URLSearchParams();
                    if (params.get("status")) next.set("status", params.get("status")!);
                    setParams(next, { replace: true });
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </>
          }
          bulkActions={(ids, clear) => (
            <>
              <Button size="sm" variant="primary" disabled={!pay.allowed} title={pay.reason || undefined} onClick={() => setScheduleIds({ ids, clear })}>
                Schedule payment
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  toast.success(`Exported ${ids.length} bills to CSV`);
                  clear();
                }}
              >
                <Download /> Export
              </Button>
            </>
          )}
          // Hover-only, like most dashboards. "Pay" is there twice per page: here and on the bill.
          rowActions={(b) =>
            b.status === "paid" ? null : (
              <>
                <Button size="sm" variant="primary" disabled={!pay.allowed} onClick={() => setPayBill(b)}>
                  Pay
                </Button>
                <Menu
                  // Icon-only with no accessible name, on purpose. Only the lucide class says "ellipsis".
                  trigger={
                    <Button variant="ghost" size="icon-sm">
                      <MoreHorizontal />
                    </Button>
                  }
                  items={[
                    { label: "Open bill", icon: <FileText />, onSelect: () => navigate(`/bills/${b.id}`) },
                    { label: "View vendor", icon: <Store />, onSelect: () => navigate(`/bills/vendors/${b.vendorId}`) },
                    { label: "Download invoice", icon: <Download />, disabled: !b.attachmentName, onSelect: () => toast.success(`Downloading ${b.attachmentName}`) },
                    { separator: true, label: "" },
                    { label: "Void bill", danger: true, disabled: b.status === "void", onSelect: () => setVoidBill(b) },
                  ]}
                />
              </>
            )
          }
          empty={
            <EmptyState
              title={filtersOn ? "No bills match these filters" : tab.status === "draft" ? "Your inbox is empty" : `No ${tab.label.toLowerCase()} bills`}
              description={tab.status === "draft" && !filtersOn ? `Forward invoices to ${FORWARD_EMAIL} and they'll land here.` : "Try another tab or clear the filters."}
            />
          }
        />
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] text-ink-3">
            {filtered.length ? `Showing ${(page - 1) * PAGE_SIZE + 1} to ${Math.min(page * PAGE_SIZE, filtered.length)} of ${filtered.length}` : "No bills"}
          </span>
          <Pager page={page} pageCount={pageCount} onPage={(p) => setParam("page", String(p))} />
        </div>
      </div>

      {payBill ? <PayBillModal bill={payBill} open onOpenChange={(v) => !v && setPayBill(null)} /> : null}
      <ConfirmDialog
        open={!!voidBill}
        onOpenChange={(v) => !v && setVoidBill(null)}
        title={`Void ${voidBill?.number}?`}
        description="The bill stays on record but can't be paid or edited again."
        confirmLabel="Void bill"
        danger
        onConfirm={async () => {
          if (voidBill) await act(() => patch("bills", voidBill.id, { status: "void" }), { success: `${voidBill.number} voided` });
        }}
      />
      <BulkScheduleModal
        ids={scheduleIds?.ids ?? []}
        open={!!scheduleIds}
        onOpenChange={(v) => !v && setScheduleIds(null)}
        onDone={() => {
          scheduleIds?.clear();
          setScheduleIds(null);
        }}
      />
    </div>
  );
}

function ForwardingCard() {
  return (
    <Card bodyClassName="flex h-full flex-col justify-between gap-2 p-4" className="h-full">
      <span className="text-[12.5px] text-ink-3">Forward bills to</span>
      <span className="flex items-center gap-2">
        <code className="truncate rounded bg-sunken px-2 py-1 font-mono text-[12.5px] text-ink">{FORWARD_EMAIL}</code>
        <IconButton
          size="icon-sm"
          icon={<Copy />}
          label="Copy forwarding address"
          onClick={() => {
            navigator.clipboard?.writeText(FORWARD_EMAIL).catch(() => undefined);
            toast.success("Address copied");
          }}
        />
      </span>
      <span className="text-xs text-ink-3">PDFs sent here show up in Inbox within a minute.</span>
    </Card>
  );
}

function BulkScheduleModal({ ids, open, onOpenChange, onDone }: { ids: string[]; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const bills = useIndex("bills");
  const [day, setDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = ids.map((id) => bills.get(id)).filter((b): b is Bill => !!b && b.status !== "paid" && b.status !== "void");
  const skipped = ids.length - chosen.length;
  const total = chosen.reduce((s, b) => s + billTotal(b), 0);
  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setDay(null);
          setError(null);
        }
        onOpenChange(v);
      }}
      title={`Schedule ${chosen.length} payment${chosen.length === 1 ? "" : "s"}`}
      description={`${money(total)} in total. Each vendor is paid with their default method.`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!chosen.length}
            onClick={async () => {
              if (!day) {
                setError("Pick a payment date.");
                return;
              }
              setBusy(true);
              const before = chosen.map((b) => ({ id: b.id, status: b.status, scheduledFor: b.scheduledFor }));
              const ok = await act(() => chosen.forEach((b) => patch("bills", b.id, { status: "scheduled", scheduledFor: day })), {
                success: `${chosen.length} payments scheduled for ${date(day)}`,
                undo: () => before.forEach((b) => patch("bills", b.id, { status: b.status, scheduledFor: b.scheduledFor })),
              });
              setBusy(false);
              if (ok !== undefined) {
                setDay(null);
                onDone();
              }
            }}
          >
            Schedule payments
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Payment date" error={error}>
          {(id) => (
            <DatePicker
              id={id}
              value={day}
              onChange={(v) => {
                setDay(v);
                setError(null);
              }}
              disabledBefore={addDays(new Date(), 1)}
            />
          )}
        </Field>
        {skipped ? <p className="text-[12.5px] text-ink-3">{skipped} selected bills are already paid or void and will be skipped.</p> : null}
      </div>
    </Modal>
  );
}
