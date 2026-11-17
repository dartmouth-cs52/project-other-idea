import { startOfMonth } from "date-fns";
import { Copy, CreditCard, Eye, EyeOff, Mail, Plus } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ME_ID, patch, useCollection, useIndex, useRow } from "@/data/store";
import type { Approval, Employee, Reimbursement, Transaction } from "@/data/types";
import { ROLE_LABELS, useCan } from "@/lib/access";
import { ago, date, fullName, masked, money, shortDate, titleCase } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { DataTable, type ColumnDef } from "@/ui/data-table";
import { Avatar, Badge, Card, DescriptionList, EmptyState, LinkTabs, PageHeader, Person, Progress, Stat, StatusBadge } from "@/ui/display";
import { act, Loader, RoleGate, toast } from "@/ui/flow";
import { InlineEdit } from "@/ui/inputs";
import { AccessTab } from "./AccessTab";
import { maskedSsn, RoleBadge } from "./shared";

const TABS = ["overview", "cards", "expenses", "reimbursements", "approvals", "access"] as const;
type Tab = (typeof TABS)[number];

export function PersonPage() {
  const { id } = useParams();
  const person = useRow("employees", id);
  const [params] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "overview";
  const deps = useIndex("departments");
  const cards = useCollection("cards");
  const reimbursements = useCollection("reimbursements");
  const approvals = useCollection("approvals");

  if (!person)
    return (
      <>
        <PageHeader title="Person not found" crumbs={[{ label: "People", to: "/people" }, { label: "Not found" }]} />
        <EmptyState
          title="We couldn't find this person"
          description="They may have been removed, or the link is wrong."
          action={
            <Button asChild>
              <Link to="/people">Back to people</Link>
            </Button>
          }
        />
      </>
    );

  const base = `/people/${person.id}`;
  const cardCount = cards.filter((c) => c.holderId === person.id && c.status !== "cancelled").length;
  const reimbCount = reimbursements.filter((r) => r.employeeId === person.id).length;
  const approvalCount = approvals.filter((a) => a.requesterId === person.id || (a.status === "pending" && a.approverIds.includes(person.id))).length;
  const dep = deps.get(person.departmentId);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "People", to: "/people" }, { label: fullName(person) }]}
        title={
          <span className="flex items-center gap-3">
            <Avatar person={person} size={40} />
            <span>
              {fullName(person)}
              {person.id === ME_ID ? <span className="ml-2 text-[15px] font-normal text-ink-3">(you)</span> : null}
            </span>
          </span>
        }
        description={`${person.title}, ${dep?.name ?? "No department"}. ${person.location}.`}
        meta={
          <>
            <StatusBadge status={person.status} />
            <RoleBadge role={person.role} />
            {!person.twoFactor && person.status === "active" ? <Badge tone="warn">No two-factor</Badge> : null}
          </>
        }
        actions={
          <>
            <Button asChild>
              <a href={`mailto:${person.email}`}>
                <Mail /> Email
              </a>
            </Button>
            <Button asChild>
              <Link to={`${base}?tab=access`}>Manage access</Link>
            </Button>
          </>
        }
        tabs={
          <LinkTabs
            active={`${base}?tab=${tab}`}
            tabs={[
              { to: `${base}?tab=overview`, label: "Overview" },
              { to: `${base}?tab=cards`, label: "Cards", count: cardCount },
              { to: `${base}?tab=expenses`, label: "Expenses" },
              { to: `${base}?tab=reimbursements`, label: "Reimbursements", count: reimbCount },
              { to: `${base}?tab=approvals`, label: "Approvals", count: approvalCount },
              { to: `${base}?tab=access`, label: "Access" },
            ]}
          />
        }
      />
      <Loader loadKey={["person", person.id, tab]} rows={8}>
        {() =>
          tab === "overview" ? (
            <Overview person={person} />
          ) : tab === "cards" ? (
            <CardsTab person={person} />
          ) : tab === "expenses" ? (
            <ExpensesTab person={person} />
          ) : tab === "reimbursements" ? (
            <ReimbursementsTab person={person} />
          ) : tab === "approvals" ? (
            <ApprovalsTab person={person} />
          ) : (
            <AccessTab person={person} />
          )
        }
      </Loader>
    </>
  );
}

function Overview({ person }: { person: Employee }) {
  const deps = useIndex("departments");
  const people = useIndex("employees");
  const entities = useIndex("entities");
  const employees = useCollection("employees");
  const tx = useCollection("transactions");
  const cards = useCollection("cards");
  const reimbursements = useCollection("reimbursements");
  const manage = useCan("people.manage");
  const manager = person.managerId ? people.get(person.managerId) : undefined;
  const reports = useMemo(() => employees.filter((e) => e.managerId === person.id && e.status !== "offboarded"), [employees, person.id]);
  const monthStart = startOfMonth(new Date()).toISOString();
  const spend = useMemo(() => tx.filter((t) => t.employeeId === person.id && t.date >= monthStart && t.status !== "declined").reduce((s, t) => s + (t.status === "refunded" ? -t.amount : t.amount), 0), [tx, person.id, monthStart]);
  const activeCards = cards.filter((c) => c.holderId === person.id && c.status === "active");
  const openReimb = reimbursements.filter((r) => r.employeeId === person.id && (r.status === "submitted" || r.status === "approved"));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="flex flex-col gap-5 lg:col-span-2">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Card spend this month" value={money(spend, "USD", { compact: true })} />
          <Stat label="Active cards" value={activeCards.length} />
          <Stat label="Open reimbursements" value={openReimb.length} hint={openReimb.length ? money(openReimb.reduce((s, r) => s + r.amount, 0)) : undefined} />
        </div>
        <Card title="Contact and identity" description="Only Admins can see a person's full Social Security number.">
          <DescriptionList
            items={[
              {
                label: "Work email",
                value: (
                  <span className="flex items-center gap-1">
                    <span className="truncate">{person.email}</span>
                    <IconButton
                      icon={<Copy />}
                      label="Copy email address"
                      size="icon-sm"
                      className="size-6"
                      onClick={() => {
                        navigator.clipboard?.writeText(person.email).catch(() => undefined);
                        toast.success("Email copied");
                      }}
                    />
                  </span>
                ),
              },
              { label: "Phone", value: person.phone || <span className="text-ink-3">Not added</span> },
              { label: "Social Security number", value: <SsnValue ssn={person.ssn} /> },
              { label: "Location", value: person.location },
            ]}
          />
        </Card>
        <Card title="Employment">
          <DescriptionList
            items={[
              {
                label: "Job title",
                // Click-to-edit for Admins, plain text for everyone else.
                value: manage.allowed ? (
                  <InlineEdit value={person.title} label="Job title" className="-ml-1" onSave={(title) => act(() => patch("employees", person.id, { title: title.trim() || person.title }), { success: "Title updated" })} />
                ) : (
                  person.title
                ),
              },
              {
                label: "Department",
                value: (
                  <Link to={`/people?department=${person.departmentId}`} className="text-brand hover:underline">
                    {deps.get(person.departmentId)?.name}
                  </Link>
                ),
              },
              {
                label: "Manager",
                value: manager ? (
                  <Link to={`/people/${manager.id}`} className="hover:underline">
                    {fullName(manager)}
                  </Link>
                ) : (
                  <span className="text-ink-3">No manager</span>
                ),
              },
              { label: "Role", value: ROLE_LABELS[person.role] },
              { label: "Entity", value: entities.get(person.entityId)?.name },
              { label: "Start date", value: date(person.startDate) },
            ]}
          />
        </Card>
      </div>
      <div className="flex flex-col gap-5">
        <Card title="Security">
          <DescriptionList
            columns={1}
            items={[
              { label: "Two-factor authentication", value: person.twoFactor ? <Badge tone="ok">On</Badge> : <Badge tone="warn">Off</Badge> },
              { label: "Last active", value: person.status === "invited" ? "Hasn't signed in yet" : ago(person.lastActive) },
              { label: "Status", value: <StatusBadge status={person.status} /> },
            ]}
          />
        </Card>
        <Card title="Direct reports" description={reports.length ? `${reports.length} ${reports.length === 1 ? "person" : "people"}` : undefined} bodyClassName="p-0">
          {reports.length ? (
            <ul className="max-h-80 overflow-y-auto">
              {reports.map((r) => (
                <li key={r.id}>
                  <Link to={`/people/${r.id}`} className="flex items-center border-b border-line px-4 py-2 last:border-0 hover:bg-sunken/60">
                    <Person person={r} sub={r.title} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-[13px] text-ink-3">No one reports to {person.firstName}.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Masked until an Admin presses Reveal, then hidden again after 30 seconds. */
function SsnValue({ ssn }: { ssn: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(false), 30_000);
    return () => clearTimeout(t);
  }, [shown]);
  if (!ssn) return <span className="text-ink-3">Not provided yet</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="tabular font-mono text-[12.5px]">{shown ? ssn : maskedSsn(ssn)}</span>
      <RoleGate action="people.manage">
        {(ok) => (
          <Button variant="link" size="sm" disabled={!ok} onClick={() => setShown((v) => !v)}>
            {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {shown ? "Hide" : "Reveal"}
          </Button>
        )}
      </RoleGate>
    </span>
  );
}

function CardsTab({ person }: { person: Employee }) {
  const cards = useCollection("cards");
  const mine = useMemo(() => cards.filter((c) => c.holderId === person.id), [cards, person.id]);
  return (
    <Card
      title="Cards"
      description={`Cards ${person.firstName} holds. Freeze or change limits from the card's page.`}
      actions={
        <RoleGate action="cards.issue">
          {(ok) =>
            ok ? (
              <Button size="sm" asChild>
                <Link to="/cards/new">
                  <Plus /> Issue card
                </Link>
              </Button>
            ) : (
              <Button size="sm" disabled>
                <Plus /> Issue card
              </Button>
            )
          }
        </RoleGate>
      }
      bodyClassName="p-0"
    >
      {mine.length ? (
        <ul>
          {mine.map((c) => {
            const p = (c.spentThisPeriod / c.limitAmount) * 100;
            return (
              <li key={c.id} className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-0">
                <span className="grid h-8 w-12 shrink-0 place-items-center rounded-[5px] bg-brand text-[10px] font-semibold text-white">{c.last4}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <Link to={`/cards/${c.id}`} className="truncate text-[13.5px] font-medium hover:underline">
                    {c.nickname}
                  </Link>
                  <span className="text-xs text-ink-3">
                    {c.kind === "virtual" ? "Virtual" : "Physical"} {masked(c.last4)}, expires {c.expiry}
                  </span>
                </span>
                <span className="hidden w-48 flex-col gap-1 md:flex">
                  <span className="tabular text-xs text-ink-2">
                    {money(c.spentThisPeriod, "USD", { compact: true })} of {money(c.limitAmount, "USD", { compact: true })} {c.limitInterval}
                  </span>
                  <Progress value={p} tone={p > 90 ? "danger" : p > 75 ? "warn" : "brand"} />
                </span>
                <StatusBadge status={c.status} />
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={<CreditCard />} title={`${person.firstName} has no cards`} description="Issue a virtual card and they can use it right away." />
      )}
    </Card>
  );
}

function ExpensesTab({ person }: { person: Employee }) {
  const tx = useCollection("transactions");
  const cats = useIndex("categories");
  const rows = useMemo(() => tx.filter((t) => t.employeeId === person.id).slice(0, 200), [tx, person.id]);
  const columns = useMemo<ColumnDef<Transaction, unknown>[]>(
    () => [
      { id: "date", header: "Date", size: 90, accessorFn: (t) => t.date, cell: ({ row }) => <span className="text-ink-2">{shortDate(row.original.date)}</span> },
      {
        id: "merchant",
        header: "Merchant",
        accessorFn: (t) => t.merchant,
        cell: ({ row }) => (
          <Link to={`/expenses/${row.original.id}`} className="font-medium hover:underline">
            {row.original.merchant}
          </Link>
        ),
      },
      { id: "category", header: "Category", accessorFn: (t) => (t.categoryId ? cats.get(t.categoryId)?.name : "") ?? "", cell: ({ getValue }) => <span className="text-ink-2">{String(getValue() || "Uncategorized")}</span> },
      { id: "receipt", header: "Receipt", size: 120, accessorFn: (t) => t.receipt, cell: ({ row }) => <StatusBadge status={row.original.receipt} /> },
      { id: "status", header: "Status", size: 110, accessorFn: (t) => t.status, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { id: "amount", header: "Amount", size: 120, accessorFn: (t) => t.amount, cell: ({ row }) => <span className="tabular block text-right">{money(row.original.amount, row.original.currency)}</span> },
    ],
    [cats],
  );
  return (
    <DataTable
      label={`${fullName(person)}'s expenses`}
      data={rows}
      columns={columns}
      getRowId={(t) => t.id}
      height={520}
      initialSort={[{ id: "date", desc: true }]}
      toolbar={
        <span className="flex w-full items-center justify-between">
          <span className="text-[13px] font-medium">Card transactions</span>
          <Button variant="link" size="sm" asChild>
            <Link to="/expenses">Open in Expenses</Link>
          </Button>
        </span>
      }
      empty={<EmptyState title="No card spend yet" description={`Charges on ${person.firstName}'s cards show up here.`} />}
    />
  );
}

function ReimbursementsTab({ person }: { person: Employee }) {
  const all = useCollection("reimbursements");
  const rows = useMemo(() => all.filter((r) => r.employeeId === person.id), [all, person.id]);
  const columns = useMemo<ColumnDef<Reimbursement, unknown>[]>(
    () => [
      { id: "date", header: "Date", size: 100, accessorFn: (r) => r.date, cell: ({ row }) => <span className="text-ink-2">{shortDate(row.original.date)}</span> },
      {
        id: "what",
        header: "Description",
        accessorFn: (r) => r.merchant,
        cell: ({ row }) => (
          <Link to={`/reimbursements/${row.original.id}`} className="font-medium hover:underline">
            {row.original.kind === "mileage" ? `Mileage, ${row.original.miles} mi` : row.original.merchant}
          </Link>
        ),
      },
      { id: "kind", header: "Type", size: 130, accessorFn: (r) => r.kind, cell: ({ row }) => <span className="text-ink-2">{titleCase(row.original.kind)}</span> },
      { id: "status", header: "Status", size: 120, accessorFn: (r) => r.status, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { id: "amount", header: "Amount", size: 120, accessorFn: (r) => r.amount, cell: ({ row }) => <span className="tabular block text-right">{money(row.original.amount, row.original.currency)}</span> },
    ],
    [],
  );
  return (
    <DataTable
      label={`${fullName(person)}'s reimbursements`}
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      height={520}
      initialSort={[{ id: "date", desc: true }]}
      empty={<EmptyState title="No reimbursements" description={`${person.firstName} hasn't asked to be paid back for anything.`} />}
    />
  );
}

function ApprovalsTab({ person }: { person: Employee }) {
  const all = useCollection("approvals");
  const requested = useMemo(() => all.filter((a) => a.requesterId === person.id), [all, person.id]);
  const waiting = useMemo(() => all.filter((a) => a.status === "pending" && a.approverIds.includes(person.id)), [all, person.id]);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <ApprovalList title={`Waiting on ${person.firstName}`} description="Requests they need to approve or reject." items={waiting} empty={`Nothing is waiting on ${person.firstName}.`} />
      <ApprovalList title={`Requested by ${person.firstName}`} description="Cards, limits and reimbursements they asked for." items={requested} empty={`${person.firstName} hasn't requested anything.`} />
    </div>
  );
}

function ApprovalList({ title, description, items, empty }: { title: string; description: string; items: Approval[]; empty: ReactNode }) {
  return (
    <Card title={title} description={description} bodyClassName="p-0">
      {items.length ? (
        <ul className="max-h-[480px] overflow-y-auto">
          {items.map((a) => (
            <li key={a.id}>
              <Link to={`/approvals/${a.id}`} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0 hover:bg-sunken/60">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium">{a.title}</span>
                  <span className="text-xs text-ink-3">
                    {titleCase(a.kind)}, due {shortDate(a.dueAt)}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="tabular text-[13px]">{money(a.amount, a.currency)}</span>
                  <StatusBadge status={a.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-[13px] text-ink-3">{empty}</p>
      )}
    </Card>
  );
}
