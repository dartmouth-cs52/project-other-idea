import { formatISO } from "date-fns";
import { Car, Lock, Plus, Search, Send, Wallet, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ME_ID, patch, useCollection, useIndex } from "@/data/store";
import type { Reimbursement } from "@/data/types";
import { useCan } from "@/lib/access";
import { date, fullName, money } from "@/lib/format";
import { Button } from "@/ui/button";
import { DataTable, type ColumnDef } from "@/ui/data-table";
import { Badge, DescriptionList, EmptyState, LinkTabs, PageHeader, Person, Stat, StatusBadge } from "@/ui/display";
import { Input, NativeSelect, Select } from "@/ui/form";
import { act, Loader } from "@/ui/flow";
import { KIND_LABELS, KindIcon, useExtras } from "./shared";

type Tab = "mine" | "team" | "all";
const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "paid", label: "Paid" },
];

export function ReimbursementsPage() {
  const [params] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "mine";
  const rows = useCollection("reimbursements");
  const people = useIndex("employees");
  const canTeam = useCan("approvals.decide").allowed;
  const canAll = useCan("expenses.review").allowed;
  const counts = useMemo(
    () => ({
      mine: rows.filter((r) => r.employeeId === ME_ID).length,
      team: rows.filter((r) => people.get(r.employeeId)?.managerId === ME_ID && r.status !== "draft").length,
      all: rows.filter((r) => r.status !== "draft" || r.employeeId === ME_ID).length,
    }),
    [rows, people],
  );
  return (
    <>
      <PageHeader
        title="Reimbursements"
        description="Get paid back for things you bought with your own money, and for driving your own car for work."
        actions={
          <>
            <Button asChild>
              <Link to="/reimbursements/new?kind=mileage">
                <Car /> Log mileage
              </Link>
            </Button>
            <Button variant="primary" asChild>
              <Link to="/reimbursements/new">
                <Plus /> New reimbursement
              </Link>
            </Button>
          </>
        }
        tabs={
          <LinkTabs
            active={`/reimbursements?tab=${tab}`}
            tabs={[
              { to: "/reimbursements?tab=mine", label: "Mine", count: counts.mine },
              { to: "/reimbursements?tab=team", label: "Team", count: canTeam ? counts.team : undefined },
              { to: "/reimbursements?tab=all", label: "All", count: canAll ? counts.all : undefined },
            ]}
          />
        }
      />
      <Loader loadKey={["reimbursements", tab]} rows={8}>
        {() => <Body tab={tab} />}
      </Loader>
    </>
  );
}

function Body({ tab }: { tab: Tab }) {
  const decide = useCan("approvals.decide");
  const review = useCan("expenses.review");
  const all = useCollection("reimbursements");
  const people = useIndex("employees");
  const categories = useIndex("categories");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const [kind, setKind] = useState<"" | Reimbursement["kind"]>("");
  const [q, setQ] = useState("");
  const receiptNames = useExtras((s) => s.receiptNames);
  const log = useExtras((s) => s.log);

  // Seeing other people's claims needs a role. The tab stays, and says why it's empty.
  const blocked = tab === "team" && !decide.allowed ? decide.reason : tab === "all" && !review.allowed ? review.reason : null;

  const scoped = useMemo(() => {
    if (blocked) return [];
    if (tab === "mine") return all.filter((r) => r.employeeId === ME_ID);
    if (tab === "team") return all.filter((r) => people.get(r.employeeId)?.managerId === ME_ID && r.status !== "draft");
    return all.filter((r) => r.status !== "draft" || r.employeeId === ME_ID);
  }, [all, tab, people, blocked]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scoped.filter((r) => {
      if (status && r.status !== status) return false;
      if (kind && r.kind !== kind) return false;
      if (needle && !`${r.merchant} ${r.memo} ${fullName(people.get(r.employeeId))}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [scoped, status, kind, q, people]);

  const mine = all.filter((r) => r.employeeId === ME_ID);
  const owed = mine.filter((r) => r.status === "approved").reduce((s, r) => s + r.amount, 0);
  const inReview = mine.filter((r) => r.status === "submitted");
  const drafts = mine.filter((r) => r.status === "draft");
  const paid = mine.filter((r) => r.status === "paid").reduce((s, r) => s + r.amount, 0);

  const setStatus = (v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set("status", v);
    else next.delete("status");
    setParams(next, { replace: true });
  };
  const filtered = !!(status || kind || q);

  const columns = useMemo<ColumnDef<Reimbursement, unknown>[]>(
    () => [
      { id: "date", header: "Date", accessorFn: (r) => r.date, size: 120, cell: ({ getValue }) => <span className="tabular text-ink-2">{date(getValue() as string)}</span> },
      {
        id: "description",
        header: "Description",
        accessorFn: (r) => r.merchant,
        size: 280,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="flex min-w-0 items-center gap-2.5">
              <KindIcon kind={r.kind} />
              <span className="flex min-w-0 flex-col">
                <Link to={`/reimbursements/${r.id}`} onClick={(e) => e.stopPropagation()} className="truncate font-medium hover:underline">
                  {r.kind === "mileage" && r.origin ? `${r.origin} to ${r.destination}` : r.merchant}
                </Link>
                <span className="truncate text-xs text-ink-3">{r.memo || KIND_LABELS[r.kind]}</span>
              </span>
            </span>
          );
        },
      },
      ...(tab === "mine"
        ? []
        : [
            {
              id: "employee",
              header: "Employee",
              accessorFn: (r: Reimbursement) => fullName(people.get(r.employeeId)),
              cell: ({ row }: { row: { original: Reimbursement } }) => <Person person={people.get(row.original.employeeId)} />,
            } as ColumnDef<Reimbursement, unknown>,
          ]),
      { id: "category", header: "Category", accessorFn: (r) => (r.categoryId ? categories.get(r.categoryId)?.name : "") ?? "", cell: ({ getValue }) => <span className="text-ink-2">{(getValue() as string) || "Uncategorized"}</span> },
      { id: "amount", header: "Amount", accessorFn: (r) => r.amount, size: 130, cell: ({ row }) => <span className="tabular font-medium">{money(row.original.amount, row.original.currency)}</span> },
      { id: "status", header: "Status", accessorFn: (r) => r.status, size: 120, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: "receipt",
        header: "Receipt",
        accessorFn: (r) => r.receipt,
        size: 110,
        cell: ({ row }) => (row.original.kind !== "out_of_pocket" ? <span className="text-xs text-ink-3">Not needed</span> : row.original.receipt === "attached" ? <Badge tone="ok">Attached</Badge> : <Badge tone="warn">Missing</Badge>),
      },
    ],
    [tab, people, categories],
  );

  return (
    <div className="flex flex-col gap-5">
      {tab === "mine" ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Owed to you" value={money(owed)} hint="approved, paid with the next payroll" />
          <Stat label="In review" value={inReview.length} hint={money(inReview.reduce((s, r) => s + r.amount, 0))} />
          <Stat label="Drafts" value={drafts.length} hint={drafts.length ? "not sent yet" : "nothing waiting"} />
          <Stat label="Paid back this year" value={money(paid)} />
        </div>
      ) : null}

      {blocked ? (
        <div className="rounded-lg border border-line bg-panel">
          <EmptyState icon={<Lock />} title={tab === "team" ? "Only managers see their team's reimbursements" : "Only Finance sees everyone's reimbursements"} description={blocked} />
        </div>
      ) : (
        <DataTable
          label="Reimbursements"
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          selectable
          columnPicker
          onRowClick={(r) => navigate(`/reimbursements/${r.id}`)}
          initialSort={[{ id: "date", desc: true }]}
          renderExpanded={(r) => (
            <div className="flex flex-col gap-3">
              <DescriptionList
                columns={3}
                items={[
                  { label: "Type", value: KIND_LABELS[r.kind] },
                  ...(r.kind === "mileage"
                    ? [
                        { label: "Route", value: `${r.origin} to ${r.destination}` },
                        { label: "Distance", value: `${r.miles} mi` },
                      ]
                    : [{ label: "Receipt", value: r.receipt === "attached" ? (receiptNames[r.id] ?? "receipt.pdf") : "Missing" }]),
                  { label: "Memo", value: r.memo || "None" },
                  { label: "Submitted", value: r.submittedAt ? date(r.submittedAt) : "Not yet" },
                ]}
              />
              <Link to={`/reimbursements/${r.id}`} className="text-[13px] font-medium text-brand hover:underline">
                Open reimbursement
              </Link>
            </div>
          )}
          toolbar={
            <>
              <div className="relative w-full sm:w-60">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
                <Input aria-label="Search reimbursements" placeholder="Search merchant, memo or person" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
              </div>
              <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
              <Select
                aria-label="Type"
                className="w-40"
                value={kind}
                placeholder="All types"
                onValueChange={(v) => setKind(v === "any" ? "" : v)}
                options={[
                  { value: "any", label: "All types" },
                  { value: "out_of_pocket", label: "Out of pocket" },
                  { value: "mileage", label: "Mileage" },
                  { value: "per_diem", label: "Per diem" },
                ]}
              />
              {filtered ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQ("");
                    setKind("");
                    setStatus("");
                  }}
                >
                  <X /> Clear filters
                </Button>
              ) : null}
            </>
          }
          empty={
            filtered ? (
              <EmptyState
                title="No reimbursements match"
                description={`Nothing ${status ? `with the status "${STATUS_OPTIONS.find((o) => o.value === status)?.label}"` : "fits these filters"} on this tab.`}
                action={
                  <Button
                    size="sm"
                    onClick={() => {
                      setQ("");
                      setKind("");
                      setStatus("");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Wallet />}
                title="No reimbursements yet"
                description="Paid for something yourself? Add it here and get it back with your next paycheck."
                action={
                  <Button size="sm" variant="primary" asChild>
                    <Link to="/reimbursements/new">New reimbursement</Link>
                  </Button>
                }
              />
            )
          }
          bulkActions={(ids, clear) => {
            const chosen = ids.map((id) => all.find((r) => r.id === id)).filter((r): r is Reimbursement => !!r);
            const submittable = chosen.filter((r) => r.status === "draft" && r.employeeId === ME_ID);
            return (
              <Button
                size="sm"
                variant="primary"
                disabled={!submittable.length}
                onClick={async () => {
                  const at = formatISO(new Date());
                  await act(
                    () =>
                      submittable.forEach((r) => {
                        patch("reimbursements", r.id, { status: "submitted", submittedAt: at });
                        log(r.id, { label: "Submitted for approval", by: ME_ID, at });
                      }),
                    { success: `${submittable.length} ${submittable.length === 1 ? "draft" : "drafts"} submitted` },
                  );
                  clear();
                }}
              >
                <Send /> Submit {submittable.length} {submittable.length === 1 ? "draft" : "drafts"}
              </Button>
            );
          }}
        />
      )}
    </div>
  );
}
