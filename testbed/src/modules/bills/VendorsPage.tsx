import { AlertTriangle, Download, FilePlus2, MailQuestion, Plus } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useCollection } from "@/data/store";
import type { Vendor } from "@/data/types";
import { money } from "@/lib/format";
import { Button, IconButton, Tooltip } from "@/ui/button";
import { DataTable, type ColumnDef } from "@/ui/data-table";
import { Badge, Callout, EmptyState, PageHeader, StatusBadge } from "@/ui/display";
import { Loader, RoleGate, toast } from "@/ui/flow";
import { Checkbox, Input, Select } from "@/ui/form";
import { billTotal, METHOD_LABELS, TERMS_LABELS, VENDOR_CATEGORIES } from "./shared";

export function VendorsPage() {
  return (
    <>
      <PageHeader
        title="Vendors"
        description="Everyone you pay by bill. Bank and tax details stay masked until you reveal them."
        actions={
          <>
            <Button onClick={() => toast.success("Vendor list exported to CSV")}>
              <Download /> Export
            </Button>
            <RoleGate action="vendors.manage">
              {(allowed) =>
                allowed ? (
                  <Button variant="primary" asChild>
                    <Link to="/bills/vendors/new">
                      <Plus /> Add vendor
                    </Link>
                  </Button>
                ) : (
                  <Button variant="primary" disabled>
                    <Plus /> Add vendor
                  </Button>
                )
              }
            </RoleGate>
          </>
        }
      />
      <Loader loadKey="vendors" rows={10}>
        {() => <VendorsBody />}
      </Loader>
    </>
  );
}

interface VendorRow extends Vendor {
  open: number;
  openCount: number;
  lastBill: string | null;
}

function VendorsBody() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const vendors = useCollection("vendors");
  const bills = useCollection("bills");
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "all";
  const category = params.get("category") ?? "all";
  const w9 = params.get("w9") === "missing";
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const rows = useMemo<VendorRow[]>(() => {
    const byVendor = new Map<string, { open: number; openCount: number; lastBill: string | null }>();
    for (const b of bills) {
      const cur = byVendor.get(b.vendorId) ?? { open: 0, openCount: 0, lastBill: null };
      if (b.status !== "paid" && b.status !== "void") {
        cur.open += billTotal(b);
        cur.openCount++;
      }
      if (!cur.lastBill || b.issueDate > cur.lastBill) cur.lastBill = b.issueDate;
      byVendor.set(b.vendorId, cur);
    }
    return vendors.map((v) => ({ ...v, ...(byVendor.get(v.id) ?? { open: 0, openCount: 0, lastBill: null }) }));
  }, [vendors, bills]);

  const needle = q.trim().toLowerCase();
  const filtered = rows
    .filter((v) => status === "all" || v.status === status)
    .filter((v) => category === "all" || v.category === category)
    .filter((v) => !w9 || !v.w9OnFile)
    .filter((v) => !needle || v.name.toLowerCase().includes(needle) || v.legalName.toLowerCase().includes(needle) || v.email.toLowerCase().includes(needle));

  const pending = vendors.filter((v) => v.status === "pending_review").length;
  const missingW9 = vendors.filter((v) => !v.w9OnFile && v.status !== "blocked").length;

  const columns: ColumnDef<VendorRow, unknown>[] = [
    {
      id: "name",
      header: "Vendor",
      accessorKey: "name",
      size: 260,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <Link to={`/bills/vendors/${row.original.id}`} onClick={(e) => e.stopPropagation()} className="truncate font-medium text-ink hover:text-brand hover:underline">
            {row.original.name}
          </Link>
          <span className="truncate text-xs text-ink-3">{row.original.email}</span>
        </span>
      ),
    },
    { id: "category", header: "Category", accessorKey: "category", size: 150 },
    { id: "method", header: "Pays by", accessorFn: (v) => METHOD_LABELS[v.paymentMethod], size: 150 },
    { id: "terms", header: "Terms", accessorFn: (v) => TERMS_LABELS[v.terms], size: 120 },
    {
      id: "open",
      header: "Open balance",
      accessorKey: "open",
      size: 140,
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="tabular">{money(row.original.open)}</span>
          <span className="text-xs text-ink-3">{row.original.openCount} open bills</span>
        </span>
      ),
    },
    {
      id: "w9",
      header: "W-9",
      accessorKey: "w9OnFile",
      size: 120,
      cell: ({ row }) =>
        row.original.w9OnFile ? (
          <span className="text-[12.5px] text-ink-3">On file</span>
        ) : (
          <Tooltip content="Collect a W-9 before paying this vendor more than $600 this year.">
            <span>
              <Badge tone="warn">
                <AlertTriangle className="size-3" /> Missing
              </Badge>
            </span>
          </Tooltip>
        ),
    },
    { id: "status", header: "Status", accessorKey: "status", size: 140, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      {pending ? (
        <Callout
          tone="info"
          title={`${pending} vendors are waiting for approval`}
          action={
            <Button size="sm" onClick={() => set("status", "pending_review")}>
              Show them
            </Button>
          }
        >
          Bills from these vendors can be entered but not paid until Finance approves them.
        </Callout>
      ) : null}
      <DataTable
        label="Vendors"
        data={filtered}
        columns={columns}
        getRowId={(v) => v.id}
        height="none"
        columnPicker
        initialSort={[{ id: "name", desc: false }]}
        onRowClick={(v) => navigate(`/bills/vendors/${v.id}`)}
        toolbar={
          <>
            <Input aria-label="Search vendors" placeholder="Search by name or email" className="w-full sm:w-64" value={q} onChange={(e) => set("q", e.target.value || null)} />
            <Select
              aria-label="Status"
              className="w-40"
              value={status}
              onValueChange={(v) => set("status", v === "all" ? null : v)}
              options={[
                { value: "all", label: "All statuses" },
                { value: "active", label: "Active" },
                { value: "pending_review", label: "Pending review" },
                { value: "blocked", label: "Blocked" },
              ]}
            />
            <Select aria-label="Category" className="w-48" value={category} onValueChange={(v) => set("category", v === "all" ? null : v)} options={[{ value: "all", label: "All categories" }, ...VENDOR_CATEGORIES.map((c) => ({ value: c, label: c }))]} />
            <Checkbox checked={w9} onCheckedChange={(v) => set("w9", v ? "missing" : null)} label={`Missing W-9 only (${missingW9})`} className="ml-1" />
          </>
        }
        rowActions={(v) => (
          <>
            <Button size="sm" asChild>
              <Link to={`/bills/new?vendor=${v.id}`}>
                <FilePlus2 /> New bill
              </Link>
            </Button>
            {v.w9OnFile ? null : <IconButton size="icon-sm" icon={<MailQuestion />} label={`Request W-9 from ${v.name}`} onClick={() => toast.success(`W-9 request sent to ${v.email}`)} />}
          </>
        )}
        empty={<EmptyState title="No vendors match" description="Try a different search or clear the filters." />}
      />
    </div>
  );
}
