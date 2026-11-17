import { Ban, Download, Eye, EyeOff, FilePlus2, FileText, MailQuestion, MoreHorizontal, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { patch, useCollection, useIndex, useRow } from "@/data/store";
import type { Vendor } from "@/data/types";
import { useCan } from "@/lib/access";
import { date, dateTime, fullName, masked, money } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { DataTable, type ColumnDef } from "@/ui/data-table";
import { Badge, Callout, Card, DescriptionList, EmptyState, PageHeader, Person, StatusBadge, TabPanel, Tabs } from "@/ui/display";
import { act, Loader, RoleGate, SaveBar, toast, UnsavedGuard } from "@/ui/flow";
import { Field, Input, NativeSelect, RadioCards, Select, Textarea } from "@/ui/form";
import { Combobox, FileDrop, InlineEdit } from "@/ui/inputs";
import { ConfirmDialog, Menu, Modal } from "@/ui/overlay";
import { bankName, billTotal, last4, METHOD_HINTS, METHOD_ICONS, METHOD_LABELS, TERMS_LABELS, VENDOR_CATEGORIES, VENDOR_STATUS_LABELS } from "./shared";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "bills", label: "Bills" },
  { value: "payment", label: "Payment details" },
  { value: "documents", label: "Documents" },
  { value: "activity", label: "Activity" },
];

export function VendorDetailPage() {
  const { id } = useParams();
  const vendor = useRow("vendors", id);
  if (!vendor)
    return (
      <EmptyState
        title="We couldn't find that vendor"
        description="It may have been removed, or the link is wrong."
        action={
          <Button asChild>
            <Link to="/bills/vendors">Back to vendors</Link>
          </Button>
        }
      />
    );
  return (
    <Loader loadKey={["vendor", id]} rows={8}>
      {() => <VendorDetail key={vendor.id} vendor={vendor} />}
    </Loader>
  );
}

function VendorDetail({ vendor }: { vendor: Vendor }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get("tab")) ? params.get("tab")! : "overview";
  const manage = useCan("vendors.manage");
  const [blockOpen, setBlockOpen] = useState(false);
  const bills = useCollection("bills");
  const vendorBills = useMemo(() => bills.filter((b) => b.vendorId === vendor.id), [bills, vendor.id]);
  const open = vendorBills.filter((b) => b.status !== "paid" && b.status !== "void");

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Vendors", to: "/bills/vendors" }, { label: vendor.name }]}
        title={
          manage.allowed ? (
            // Click-to-edit title, on purpose: the name only becomes an input after a click.
            <InlineEdit value={vendor.name} label="vendor name" className="-ml-1 min-w-max text-[22px] font-semibold" onSave={(v) => v.trim() && act(() => patch("vendors", vendor.id, { name: v.trim() }), { success: "Vendor renamed" })} />
          ) : (
            vendor.name
          )
        }
        meta={
          <>
            <StatusBadge status={vendor.status} />
            <span className="text-[12.5px] text-ink-3">{vendor.category}</span>
            <span className="text-[12.5px] text-ink-3">·</span>
            <span className="text-[12.5px] text-ink-3">{TERMS_LABELS[vendor.terms]}</span>
            {vendor.w9OnFile ? null : <Badge tone="warn">W-9 missing</Badge>}
          </>
        }
        actions={
          <>
            <Button variant="primary" asChild>
              <Link to={`/bills/new?vendor=${vendor.id}`}>
                <FilePlus2 /> New bill
              </Link>
            </Button>
            <Menu
              label="More vendor actions"
              trigger={
                <Button size="icon">
                  <MoreHorizontal />
                </Button>
              }
              items={[
                { label: "Request W-9", icon: <MailQuestion />, disabled: vendor.w9OnFile, onSelect: () => toast.success(`W-9 request sent to ${vendor.email}`) },
                { label: "Export bills", icon: <Download />, onSelect: () => toast.success(`${vendorBills.length} bills exported`) },
                { separator: true, label: "" },
                vendor.status === "blocked"
                  ? { label: "Unblock vendor", disabled: !manage.allowed, onSelect: () => act(() => patch("vendors", vendor.id, { status: "active" }), { success: `${vendor.name} unblocked` }) }
                  : { label: "Block vendor", icon: <Ban />, danger: true, disabled: !manage.allowed, onSelect: () => setBlockOpen(true) },
              ]}
            />
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card bodyClassName="p-4">
          <p className="text-[12.5px] text-ink-3">Open balance</p>
          <p className="tabular text-[20px] font-semibold">{money(open.reduce((s, b) => s + billTotal(b), 0))}</p>
          <p className="text-xs text-ink-3">{open.length} open bills</p>
        </Card>
        <Card bodyClassName="p-4">
          <p className="text-[12.5px] text-ink-3">Paid this year</p>
          <p className="tabular text-[20px] font-semibold">{money(vendorBills.filter((b) => b.status === "paid").reduce((s, b) => s + billTotal(b), 0))}</p>
          <p className="text-xs text-ink-3">{vendorBills.filter((b) => b.status === "paid").length} payments</p>
        </Card>
        <Card bodyClassName="p-4">
          <p className="text-[12.5px] text-ink-3">Pays by</p>
          <p className="text-[20px] font-semibold">{METHOD_LABELS[vendor.paymentMethod]}</p>
          <p className="text-xs text-ink-3">Vendor since {date(vendor.createdAt.slice(0, 10))}</p>
        </Card>
      </div>

      {vendor.status === "pending_review" ? (
        <div className="mb-5">
          <Callout tone="warn" title="Waiting for approval">
            You can enter bills for {vendor.name}, but payments are held until Finance approves this vendor in{" "}
            <Link to="/approvals" className="font-medium text-brand hover:underline">
              Approvals
            </Link>
            .
          </Callout>
        </div>
      ) : null}
      {vendor.status === "blocked" ? (
        <div className="mb-5">
          <Callout tone="danger" title="This vendor is blocked">
            No one can pay or add bills for {vendor.name} until it's unblocked.
          </Callout>
        </div>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = new URLSearchParams(params);
          if (v === "overview") next.delete("tab");
          else next.set("tab", v);
          setParams(next, { replace: true });
        }}
        tabs={TABS.map((t) => ({ value: t.value, label: t.value === "bills" ? `Bills (${vendorBills.length})` : t.label }))}
      >
        <TabPanel value="overview">
          <OverviewTab vendor={vendor} />
        </TabPanel>
        <TabPanel value="bills">
          <BillsTab bills={vendorBills} onOpen={(id) => navigate(`/bills/${id}`)} />
        </TabPanel>
        <TabPanel value="payment">
          <PaymentTab vendor={vendor} />
        </TabPanel>
        <TabPanel value="documents">
          <DocumentsTab vendor={vendor} />
        </TabPanel>
        <TabPanel value="activity">
          <ActivityTab vendor={vendor} />
        </TabPanel>
      </Tabs>

      <ConfirmDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        title={`Block ${vendor.name}?`}
        description="Scheduled payments to this vendor are cancelled and no one can add new bills for them."
        confirmLabel="Block vendor"
        danger
        onConfirm={async () => {
          await act(() => patch("vendors", vendor.id, { status: "blocked" }), { success: `${vendor.name} blocked` });
        }}
      />
    </>
  );
}

type OverviewDraft = Pick<Vendor, "legalName" | "email" | "phone" | "website" | "category" | "terms" | "address" | "ownerId">;
const overviewOf = (v: Vendor): OverviewDraft => ({ legalName: v.legalName, email: v.email, phone: v.phone, website: v.website, category: v.category, terms: v.terms, address: v.address, ownerId: v.ownerId });

function OverviewTab({ vendor }: { vendor: Vendor }) {
  const manage = useCan("vendors.manage");
  const employees = useCollection("employees");
  const [base, setBase] = useState(() => overviewOf(vendor));
  const [draft, setDraft] = useState(base);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(base) !== JSON.stringify(draft);
  const set = <K extends keyof OverviewDraft>(k: K, v: OverviewDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const owners = useMemo(() => employees.filter((e) => e.departmentId === "dep_finance").map((e) => ({ value: e.id, label: fullName(e), hint: e.title })), [employees]);
  const ro = !manage.allowed;

  const save = async () => {
    setSaving(true);
    const ok = await act(() => {
      patch("vendors", vendor.id, draft);
      return true;
    }, { success: "Vendor details saved" });
    setSaving(false);
    if (ok) setBase(draft);
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <UnsavedGuard when={dirty} />
      <Card title="Vendor details" description={ro ? manage.reason : "Changes are saved together with the bar at the bottom."} className="lg:col-span-2">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Legal name">{(id) => <Input id={id} disabled={ro} value={draft.legalName} onChange={(e) => set("legalName", e.target.value)} />}</Field>
          <Field label="Billing email">{(id) => <Input id={id} disabled={ro} type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} disabled={ro} value={draft.phone} onChange={(e) => set("phone", e.target.value)} />}</Field>
          <Field label="Website">{(id) => <Input id={id} disabled={ro} value={draft.website} onChange={(e) => set("website", e.target.value)} />}</Field>
          <Field label="Category">{(id) => <Select id={id} disabled={ro} value={draft.category} onValueChange={(v) => set("category", v)} options={VENDOR_CATEGORIES.map((c) => ({ value: c, label: c }))} />}</Field>
          <Field label="Payment terms">
            {(id) => (
              <NativeSelect id={id} disabled={ro} value={draft.terms} onChange={(e) => set("terms", e.target.value as Vendor["terms"])}>
                {(Object.keys(TERMS_LABELS) as Vendor["terms"][]).map((t) => (
                  <option key={t} value={t}>
                    {TERMS_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Vendor owner">{(id) => <Combobox id={id} disabled={ro} value={draft.ownerId} onChange={(v) => set("ownerId", v)} options={owners} />}</Field>
          <Field label="Address" className="sm:col-span-2">
            {(id) => <Textarea id={id} disabled={ro} className="min-h-14" value={draft.address} onChange={(e) => set("address", e.target.value)} />}
          </Field>
        </div>
      </Card>
      <Card title="At a glance">
        <DescriptionList
          columns={1}
          items={[
            { label: "Status", value: VENDOR_STATUS_LABELS[vendor.status] },
            { label: "Owner", value: <Person person={employees.find((e) => e.id === vendor.ownerId)} /> },
            { label: "Default payment", value: METHOD_LABELS[vendor.paymentMethod] },
            { label: "W-9", value: vendor.w9OnFile ? "On file" : "Missing" },
            { label: "Added", value: date(vendor.createdAt.slice(0, 10)) },
          ]}
        />
      </Card>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(base)} message="Unsaved changes to this vendor" />
    </div>
  );
}

function BillsTab({ bills, onOpen }: { bills: ReturnType<typeof useCollection<"bills">>; onOpen: (id: string) => void }) {
  const columns: ColumnDef<(typeof bills)[number], unknown>[] = [
    { id: "number", header: "Bill", accessorKey: "number", size: 140, cell: ({ row }) => <Link to={`/bills/${row.original.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-brand hover:underline">{row.original.number}</Link> },
    { id: "issued", header: "Issued", accessorKey: "issueDate", cell: ({ row }) => date(row.original.issueDate) },
    { id: "due", header: "Due", accessorKey: "dueDate", cell: ({ row }) => date(row.original.dueDate) },
    { id: "amount", header: "Amount", accessorFn: (b) => billTotal(b), cell: ({ row }) => <span className="tabular">{money(billTotal(row.original), row.original.currency)}</span> },
    { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  ];
  return <DataTable label="Bills from this vendor" data={bills} columns={columns} getRowId={(b) => b.id} height={480} initialSort={[{ id: "issued", desc: true }]} onRowClick={(b) => onOpen(b.id)} empty={<EmptyState title="No bills yet" description="Bills you add for this vendor show up here." />} />;
}

function PaymentTab({ vendor }: { vendor: Vendor }) {
  const manage = useCan("vendors.manage");
  const [revealed, setRevealed] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  // Revealed numbers hide again after 30 seconds.
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(false), 30000);
    return () => clearTimeout(t);
  }, [revealed]);
  const hasBank = vendor.paymentMethod === "ach" || vendor.paymentMethod === "wire";
  const show = (v: string) => (v ? (revealed ? <span className="font-mono">{v}</span> : <span className="font-mono">{masked(last4(v))}</span>) : <span className="text-ink-3">Not set</span>);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card
        title={hasBank ? "Bank account" : vendor.paymentMethod === "check" ? "Mailing address" : "Virtual card"}
        description={hasBank ? "Shown masked. Revealing is logged in the audit trail." : undefined}
        actions={
          <>
            {hasBank ? (
              <RoleGate action="vendors.manage">
                {(allowed) => (
                  <Button size="sm" disabled={!allowed} onClick={() => setRevealed((r) => !r)}>
                    {revealed ? <EyeOff /> : <Eye />} {revealed ? "Hide" : "Reveal"}
                  </Button>
                )}
              </RoleGate>
            ) : null}
            <Button size="sm" disabled={!manage.allowed} onClick={() => setEditOpen(true)}>
              <Pencil /> Edit payment details
            </Button>
          </>
        }
      >
        {/* Privacy bait: full routing and account numbers only after Reveal. */}
        <DescriptionList
          items={
            vendor.paymentMethod === "ach"
              ? [
                  { label: "Method", value: METHOD_LABELS.ach },
                  { label: "Bank", value: bankName(vendor.routingNumber || "0") },
                  { label: "Routing number", value: show(vendor.routingNumber) },
                  { label: "Account number", value: show(vendor.accountNumber) },
                ]
              : vendor.paymentMethod === "wire"
                ? [
                    { label: "Method", value: METHOD_LABELS.wire },
                    { label: "Bank", value: bankName(vendor.routingNumber || "0") },
                    { label: "SWIFT / routing", value: show(vendor.routingNumber) },
                    { label: "IBAN / account", value: show(vendor.accountNumber) },
                  ]
                : vendor.paymentMethod === "check"
                  ? [
                      { label: "Method", value: METHOD_LABELS.check },
                      { label: "Mail to", value: vendor.address || "Not set" },
                    ]
                  : [
                      { label: "Method", value: METHOD_LABELS.card },
                      { label: "Card sent to", value: vendor.email },
                    ]
          }
        />
      </Card>
      <Card
        title="Tax"
        actions={
          <RoleGate action="vendors.manage">
            {(allowed) => (
              <Button size="sm" disabled={!allowed || !vendor.taxId} onClick={() => setRevealed((r) => !r)}>
                {revealed ? <EyeOff /> : <Eye />} {revealed ? "Hide tax ID" : "Reveal tax ID"}
              </Button>
            )}
          </RoleGate>
        }
      >
        <DescriptionList
          items={[
            { label: "Tax ID (EIN)", value: vendor.taxId ? (revealed ? <span className="font-mono">{vendor.taxId}</span> : <span className="font-mono">•••••{last4(vendor.taxId)}</span>) : "Not set" },
            { label: "1099 eligible", value: vendor.category === "Professional services" ? "Yes" : "No" },
            { label: "W-9", value: vendor.w9OnFile ? "On file" : <Badge tone="warn">Missing</Badge> },
          ]}
        />
      </Card>
      <EditPaymentModal vendor={vendor} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}

function EditPaymentModal({ vendor, open, onOpenChange }: { vendor: Vendor; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [method, setMethod] = useState(vendor.paymentMethod);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [address, setAddress] = useState(vendor.address);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setMethod(vendor.paymentMethod);
      setA("");
      setB("");
      setAddress(vendor.address);
      setError(null);
    }
  }, [open, vendor]);
  const save = async () => {
    if ((method === "ach" || method === "wire") && (!a.trim() || !b.trim())) return setError("Fill in both bank fields.");
    if (method === "check" && !address.trim()) return setError("Enter a mailing address.");
    setBusy(true);
    const ok = await act(() => {
      patch("vendors", vendor.id, { paymentMethod: method, ...(method === "ach" || method === "wire" ? { routingNumber: a.trim(), accountNumber: b.trim() } : {}), ...(method === "check" ? { address } : {}) });
      return true;
    }, { success: `Payment details changed. We emailed ${vendor.email} to confirm.` });
    setBusy(false);
    if (ok) onOpenChange(false);
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Edit payment details"
      description="Changes to bank details are emailed to the vendor's billing contact."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save payment details
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <RadioCards value={method} onValueChange={setMethod} options={(Object.keys(METHOD_LABELS) as Vendor["paymentMethod"][]).map((m) => ({ value: m, label: METHOD_LABELS[m], description: METHOD_HINTS[m], icon: METHOD_ICONS[m] }))} />
        {method === "ach" || method === "wire" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={method === "ach" ? "Routing number" : "SWIFT / BIC code"}>{(id) => <Input id={id} autoComplete="off" value={a} onChange={(e) => setA(e.target.value)} />}</Field>
            <Field label={method === "ach" ? "Account number" : "IBAN"}>{(id) => <Input id={id} autoComplete="off" value={b} onChange={(e) => setB(e.target.value)} />}</Field>
          </div>
        ) : null}
        {method === "check" ? <Field label="Mailing address">{(id) => <Textarea id={id} value={address} onChange={(e) => setAddress(e.target.value)} />}</Field> : null}
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}

function DocumentsTab({ vendor }: { vendor: Vendor }) {
  const manage = useCan("vendors.manage");
  const docs = [
    ...(vendor.w9OnFile ? [{ name: `W-9 ${vendor.legalName}.pdf`, kind: "Tax form", at: vendor.createdAt }] : []),
    { name: "Master services agreement.pdf", kind: "Contract", at: vendor.createdAt },
    { name: "Certificate of insurance 2026.pdf", kind: "Insurance", at: vendor.createdAt },
  ];
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <Card title="Files" bodyClassName="p-0" className="lg:col-span-2">
        <ul>
          {docs.map((d) => (
            <li key={d.name} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              <FileText className="size-4 text-ink-3" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px]">{d.name}</span>
                <span className="text-xs text-ink-3">
                  {d.kind} · added {date(d.at.slice(0, 10))}
                </span>
              </span>
              <IconButton size="icon-sm" icon={<Download />} label={`Download ${d.name}`} onClick={() => toast.success(`Downloading ${d.name}`)} />
            </li>
          ))}
        </ul>
      </Card>
      <Card title="W-9">
        {vendor.w9OnFile ? (
          <p className="text-[13px] text-ink-2">A signed W-9 is on file. It's valid until the vendor's details change.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <Callout tone="warn">No W-9 on file. Payments over $600 this year are held until you add one.</Callout>
            <FileDrop
              label="Upload W-9"
              hint="PDF, signed"
              accept=".pdf"
              onFiles={(files) => files[0] && manage.allowed && act(() => patch("vendors", vendor.id, { w9OnFile: true }), { success: `${files[0].name} added` })}
            />
            <Button onClick={() => toast.success(`W-9 request sent to ${vendor.email}`)}>
              <MailQuestion /> Request W-9 from vendor
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function ActivityTab({ vendor }: { vendor: Vendor }) {
  const people = useIndex("employees");
  const bills = useCollection("bills");
  const events = useMemo(() => {
    const out: { at: string; text: string }[] = [{ at: vendor.createdAt, text: `${fullName(people.get(vendor.ownerId))} added ${vendor.name}` }];
    for (const b of bills) {
      if (b.vendorId !== vendor.id) continue;
      out.push({ at: `${b.issueDate}T09:12:00`, text: `Bill ${b.number} received for ${money(billTotal(b), b.currency)}` });
      if (b.paidAt) out.push({ at: b.paidAt, text: `Paid ${b.number} by ${METHOD_LABELS[vendor.paymentMethod]}` });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
  }, [bills, vendor, people]);
  return (
    <Card title="Activity" bodyClassName="p-0">
      <ul>
        {events.map((e, i) => (
          <li key={i} className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5 text-[13px] last:border-0">
            <span>{e.text}</span>
            <span className="text-xs whitespace-nowrap text-ink-3">{dateTime(e.at)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
