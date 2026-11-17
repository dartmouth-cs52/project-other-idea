import { CheckCircle2, Circle, Clock, Copy, Download, FileText, Minus, MoreHorizontal, Plus, Send, Store, XCircle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ME_ID, patch, useCollection, useIndex, useRow } from "@/data/store";
import type { Bill, Vendor } from "@/data/types";
import { useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { date, dateTime, fullName, money } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { Callout, EmptyState, PageHeader, StatusBadge } from "@/ui/display";
import { act, Loader, RoleGate, SaveBar, toast, UnsavedGuard } from "@/ui/flow";
import { Field, Input, NativeSelect, Textarea } from "@/ui/form";
import { Combobox, DatePicker } from "@/ui/inputs";
import { ConfirmDialog, Menu } from "@/ui/overlay";
import { PayBillModal } from "./PayBillModal";
import { billTotal, dueLabel, METHOD_LABELS, requestApproval } from "./shared";

export function BillDetailPage() {
  const { id } = useParams();
  const bill = useRow("bills", id);
  const vendor = useRow("vendors", bill?.vendorId);
  if (!bill)
    return (
      <EmptyState
        title="We couldn't find that bill"
        description="It may have been deleted, or the link is wrong."
        action={
          <Button asChild>
            <Link to="/bills">Back to bills</Link>
          </Button>
        }
      />
    );
  return (
    <Loader loadKey={["bill", id]} rows={10}>
      {() => <BillDetail key={bill.id} bill={bill} vendor={vendor} />}
    </Loader>
  );
}

interface Draft {
  number: string;
  issueDate: string;
  dueDate: string;
  entityId: string;
  poNumber: string;
  memo: string;
  lineGl: Record<string, string>;
}

const draftOf = (b: Bill): Draft => ({
  number: b.number,
  issueDate: b.issueDate,
  dueDate: b.dueDate,
  entityId: b.entityId,
  poNumber: b.poNumber ?? "",
  memo: b.memo,
  lineGl: Object.fromEntries(b.lines.map((l) => [l.id, l.glAccountId])),
});

function BillDetail({ bill, vendor }: { bill: Bill; vendor: Vendor | undefined }) {
  const navigate = useNavigate();
  const entities = useCollection("entities");
  const glAccounts = useCollection("glAccounts");
  const glIndex = useIndex("glAccounts");
  const departments = useIndex("departments");
  const approvalsCan = useCan("approvals.decide");
  const editCan = useCan("bills.create");
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [base, setBase] = useState(() => draftOf(bill));
  const [draft, setDraft] = useState(base);
  const [saving, setSaving] = useState(false);
  const locked = bill.status === "paid" || bill.status === "void";
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const total = billTotal(bill);
  const entity = entities.find((e) => e.id === bill.entityId);
  const due = dueLabel(bill.dueDate, bill.status);

  const glOptions = useMemo(() => glAccounts.filter((g) => g.active && g.parentId && (g.type === "expense" || g.type === "asset")).map((g) => ({ value: g.id, label: `${g.code} ${g.name}` })), [glAccounts]);

  const save = async () => {
    setSaving(true);
    const ok = await act(
      () => {
        patch("bills", bill.id, {
          number: draft.number,
          issueDate: draft.issueDate,
          dueDate: draft.dueDate,
          entityId: draft.entityId,
          poNumber: draft.poNumber || null,
          memo: draft.memo,
          lines: bill.lines.map((l) => ({ ...l, glAccountId: draft.lineGl[l.id] ?? l.glAccountId })),
        });
        return true;
      },
      { success: "Bill updated" },
    );
    setSaving(false);
    if (ok) setBase(draft);
  };

  const approve = async () => {
    await act(
      () => {
        patch("bills", bill.id, { status: "scheduled", scheduledFor: bill.dueDate });
        for (const a of approvalsFor) if (a.status === "pending") patch("approvals", a.id, { status: "approved", stage: "done" });
      },
      { success: `Approved. Payment scheduled for ${date(bill.dueDate)}.` },
    );
  };
  const reject = async () => {
    await act(
      () => {
        patch("bills", bill.id, { status: "draft" });
        for (const a of approvalsFor) if (a.status === "pending") patch("approvals", a.id, { status: "rejected", stage: "done" });
      },
      { success: "Sent back to the inbox" },
    );
  };
  const submit = async () => {
    await act(
      () => {
        patch("bills", bill.id, { status: "awaiting_approval" });
        requestApproval("bill", bill.id, `Bill from ${vendor?.name}`, total);
      },
      { success: "Sent for approval" },
    );
  };
  const cancelSchedule = async () => {
    const before = bill.scheduledFor;
    await act(() => patch("bills", bill.id, { status: "awaiting_approval", scheduledFor: null }), {
      success: "Scheduled payment cancelled",
      undo: () => patch("bills", bill.id, { status: "scheduled", scheduledFor: before }),
    });
  };

  const allApprovals = useCollection("approvals");
  const approvalsFor = useMemo(() => allApprovals.filter((a) => a.kind === "bill" && a.subjectId === bill.id), [allApprovals, bill.id]);

  return (
    <>
      <UnsavedGuard when={dirty} />
      <PageHeader
        crumbs={[{ label: "Bills", to: "/bills" }, { label: bill.number }]}
        title={
          <span className="flex items-center gap-3">
            {vendor?.name ?? "Unknown vendor"}
            <span className="tabular text-ink-3">{money(total, bill.currency)}</span>
          </span>
        }
        meta={
          <>
            <StatusBadge status={bill.status} />
            <span className="text-[12.5px] text-ink-3">{bill.number}</span>
            <span className="text-[12.5px] text-ink-3">·</span>
            <span className={cn("text-[12.5px]", due?.late ? "text-danger" : "text-ink-3")}>
              Due {date(bill.dueDate)}
              {due ? ` (${due.text.toLowerCase()})` : ""}
            </span>
          </>
        }
        actions={
          <>
            <Button disabled={!bill.attachmentName} onClick={() => toast.success(`Downloading ${bill.attachmentName}`)}>
              <Download /> Download PDF
            </Button>
            <Menu
              label="More bill actions"
              trigger={
                <Button size="icon">
                  <MoreHorizontal />
                </Button>
              }
              items={[
                { label: "View vendor", icon: <Store />, onSelect: () => navigate(`/bills/vendors/${bill.vendorId}`) },
                {
                  label: "Copy link",
                  icon: <Copy />,
                  onSelect: () => {
                    navigator.clipboard?.writeText(location.href).catch(() => undefined);
                    toast.success("Link copied");
                  },
                },
                { separator: true, label: "" },
                { label: "Void bill", danger: true, disabled: bill.status === "void" || bill.status === "paid", onSelect: () => setVoidOpen(true) },
              ]}
            />
          </>
        }
      />

      {/* Two panes that each scroll on their own, inside a page that also scrolls. On purpose. */}
      <div className="grid grid-cols-1 h-[calc(100vh-13.5rem)] min-h-[520px] gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <InvoicePreview bill={bill} vendor={vendor} />

        <div className="relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-xs">
          <div className="min-h-0 flex-1 overflow-y-auto" data-pane="bill-form">
            <section className="border-b border-line p-5">
              <h2 className="mb-4 text-[14px] font-semibold">Details</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Bill number">{(id) => <Input id={id} disabled={locked || !editCan.allowed} value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value })} />}</Field>
                <Field label="Vendor">
                  <Link to={`/bills/vendors/${bill.vendorId}`} className="flex h-8 items-center truncate text-[13px] font-medium text-brand hover:underline">
                    {vendor?.name}
                  </Link>
                </Field>
                <Field label="Invoice date">{(id) => (locked ? <Input id={id} disabled value={date(draft.issueDate)} /> : <DatePicker id={id} value={draft.issueDate} onChange={(v) => setDraft({ ...draft, issueDate: v })} />)}</Field>
                <Field label="Due date">{(id) => (locked ? <Input id={id} disabled value={date(draft.dueDate)} /> : <DatePicker id={id} value={draft.dueDate} onChange={(v) => setDraft({ ...draft, dueDate: v })} />)}</Field>
                <Field label="Entity">
                  {(id) => (
                    <NativeSelect id={id} disabled={locked || !editCan.allowed} value={draft.entityId} onChange={(e) => setDraft({ ...draft, entityId: e.target.value })}>
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field label="PO number" optional>
                  {(id) => <Input id={id} disabled={locked || !editCan.allowed} value={draft.poNumber} onChange={(e) => setDraft({ ...draft, poNumber: e.target.value })} placeholder="None" />}
                </Field>
                <Field label="Memo" optional className="sm:col-span-2">
                  {(id) => <Textarea id={id} disabled={locked || !editCan.allowed} className="min-h-16" value={draft.memo} onChange={(e) => setDraft({ ...draft, memo: e.target.value })} placeholder="Add a note for approvers" />}
                </Field>
              </div>
            </section>

            <section className="border-b border-line p-5">
              <h2 className="mb-3 text-[14px] font-semibold">Line items</h2>
              <div className="flex flex-col gap-3">
                {bill.lines.map((l, i) => (
                  <div key={l.id} className="rounded-md border border-line p-3">
                    <div className="mb-2 flex items-start justify-between gap-3 text-[13px]">
                      <span className="flex flex-col">
                        <span className="font-medium">{l.description}</span>
                        <span className="text-xs text-ink-3">
                          {l.quantity} × {money(l.unitPrice, bill.currency)} · {departments.get(l.departmentId)?.name ?? "No department"}
                        </span>
                      </span>
                      <span className="tabular font-medium">{money(l.quantity * l.unitPrice, bill.currency)}</span>
                    </div>
                    <Combobox
                      aria-label={`GL account for line ${i + 1}`}
                      disabled={locked || !editCan.allowed}
                      value={draft.lineGl[l.id] ?? l.glAccountId}
                      onChange={(v) => setDraft({ ...draft, lineGl: { ...draft.lineGl, [l.id]: v } })}
                      options={glOptions}
                      placeholder={glIndex.get(l.glAccountId)?.name ?? "Choose account"}
                    />
                  </div>
                ))}
                <dl className="ml-auto grid w-60 grid-cols-[1fr_auto] gap-y-1 text-[13px]">
                  <dt className="text-ink-3">Subtotal</dt>
                  <dd className="tabular text-right">{money(total, bill.currency)}</dd>
                  <dt className="text-ink-3">Tax</dt>
                  <dd className="tabular text-right">{money(0, bill.currency)}</dd>
                  <dt className="font-semibold">Total</dt>
                  <dd className="tabular text-right font-semibold">{money(total, bill.currency)}</dd>
                </dl>
              </div>
            </section>

            <section className="border-b border-line p-5">
              <h2 className="mb-3 text-[14px] font-semibold">Approval and payment</h2>
              <Timeline bill={bill} vendor={vendor} approvals={approvalsFor} />
            </section>

            <section className="p-5">
              <h2 className="mb-1 text-[14px] font-semibold text-danger">Danger zone</h2>
              <p className="mb-3 text-[12.5px] text-ink-3">Voiding keeps the bill on record but it can't be paid, edited or un-voided.</p>
              <RoleGate action="bills.pay">
                {(allowed) => (
                  <Button variant="danger" disabled={!allowed || bill.status === "void" || bill.status === "paid"} onClick={() => setVoidOpen(true)}>
                    <XCircle /> Void bill
                  </Button>
                )}
              </RoleGate>
            </section>

            {/* Sticky to the bottom of its own scroll pane, not the window. The save bar covers it while there are unsaved edits. */}
            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel/95 px-5 py-3 backdrop-blur">
              <span className="flex flex-col">
                <span className="text-xs text-ink-3">{entity?.name}</span>
                <span className="tabular text-[15px] font-semibold">{money(total, bill.currency)}</span>
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {bill.status === "draft" ? (
                  <Button disabled={!editCan.allowed} onClick={submit}>
                    <Send /> Submit for approval
                  </Button>
                ) : null}
                {bill.status === "awaiting_approval" ? (
                  <RoleGate action="approvals.decide">
                    {(allowed) => (
                      <>
                        <Button disabled={!allowed} onClick={reject}>
                          Reject
                        </Button>
                        <Button disabled={!allowed} onClick={approve}>
                          <CheckCircle2 /> Approve
                        </Button>
                      </>
                    )}
                  </RoleGate>
                ) : null}
                {bill.status === "scheduled" ? (
                  <Button disabled={!approvalsCan.allowed} onClick={cancelSchedule}>
                    Cancel payment
                  </Button>
                ) : null}
                {locked ? null : (
                  <RoleGate action="bills.pay">
                    {(allowed) => (
                      <Button variant="primary" disabled={!allowed} onClick={() => setPayOpen(true)}>
                        {bill.status === "scheduled" ? "Reschedule" : "Pay now"}
                      </Button>
                    )}
                  </RoleGate>
                )}
                {bill.status === "paid" ? <span className="text-[13px] text-ok">Paid {bill.paidAt ? date(bill.paidAt.slice(0, 10)) : ""}</span> : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(base)} message="Unsaved changes to this bill" />
      <PayBillModal bill={bill} open={payOpen} onOpenChange={setPayOpen} />
      <ConfirmDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        title={`Void ${bill.number}?`}
        description={`This removes ${money(total, bill.currency)} from payables. It can't be undone.`}
        confirmLabel="Void bill"
        danger
        onConfirm={async () => {
          await act(() => patch("bills", bill.id, { status: "void", scheduledFor: null }), { success: `${bill.number} voided` });
        }}
      />
    </>
  );
}

/** A drawn invoice, standing in for the uploaded PDF. */
function InvoicePreview({ bill, vendor }: { bill: Bill; vendor: Vendor | undefined }) {
  const [zoom, setZoom] = useState(100);
  const entity = useRow("entities", bill.entityId);
  const total = billTotal(bill);
  if (!bill.attachmentName)
    return (
      <div className="grid min-h-0 place-items-center rounded-lg border border-dashed border-line-strong bg-sunken">
        <EmptyState icon={<FileText />} title="No invoice attached" description="This bill was entered by hand." />
      </div>
    );
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-sunken shadow-xs">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-panel px-3 py-1.5">
        <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-ink-2">
          <FileText className="size-4 shrink-0 text-ink-3" />
          <span className="truncate">{bill.attachmentName}</span>
        </span>
        <span className="flex items-center gap-1">
          <IconButton size="icon-sm" icon={<Minus />} label="Zoom out" onClick={() => setZoom((z) => Math.max(60, z - 10))} />
          <span className="tabular w-10 text-center text-xs text-ink-3">{zoom}%</span>
          <IconButton size="icon-sm" icon={<Plus />} label="Zoom in" onClick={() => setZoom((z) => Math.min(160, z + 10))} />
        </span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto p-6" data-pane="invoice-preview">
        <div className="mx-auto flex flex-col gap-6" style={{ width: `${(zoom / 100) * 520}px` }}>
          <article aria-label="Invoice page 1" className="flex aspect-[8.5/11] flex-col gap-6 bg-white p-[7%] text-[11px] text-neutral-800 shadow-md" style={{ fontSize: `${(zoom / 100) * 11}px` }}>
            <header className="flex items-start justify-between">
              <div>
                <p className="text-[1.6em] font-bold tracking-tight">{vendor?.name}</p>
                <p className="text-neutral-500">{vendor?.address}</p>
              </div>
              <div className="text-right">
                <p className="text-[1.4em] font-semibold tracking-widest text-neutral-400">INVOICE</p>
                <p>{bill.number}</p>
              </div>
            </header>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="font-semibold text-neutral-500 uppercase">Bill to</p>
                <p>{entity?.name}</p>
                <p className="text-neutral-500">{entity?.address}</p>
              </div>
              <div>
                <p className="font-semibold text-neutral-500 uppercase">Invoice date</p>
                <p>{date(bill.issueDate)}</p>
                <p className="mt-2 font-semibold text-neutral-500 uppercase">Due</p>
                <p>{date(bill.dueDate)}</p>
              </div>
              <div>
                <p className="font-semibold text-neutral-500 uppercase">PO</p>
                <p>{bill.poNumber ?? "None"}</p>
              </div>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-neutral-300 text-left text-neutral-500">
                  <th className="py-1 font-semibold">Item</th>
                  <th className="py-1 text-right font-semibold">Qty</th>
                  <th className="py-1 text-right font-semibold">Rate</th>
                  <th className="py-1 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {bill.lines.map((l) => (
                  <tr key={l.id} className="border-b border-neutral-100">
                    <td className="py-1.5">{l.description}</td>
                    <td className="py-1.5 text-right">{l.quantity}</td>
                    <td className="py-1.5 text-right">{money(l.unitPrice, bill.currency)}</td>
                    <td className="py-1.5 text-right">{money(l.quantity * l.unitPrice, bill.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-auto flex justify-end">
              <div className="w-1/2 border-t-2 border-neutral-800 pt-2 text-right">
                <p className="text-neutral-500">Amount due</p>
                <p className="text-[1.6em] font-bold">{money(total, bill.currency)}</p>
              </div>
            </div>
          </article>
          <article aria-label="Invoice page 2" className="flex aspect-[8.5/11] flex-col gap-4 bg-white p-[7%] text-neutral-800 shadow-md" style={{ fontSize: `${(zoom / 100) * 11}px` }}>
            <p className="text-[1.2em] font-semibold">Payment instructions</p>
            <p className="text-neutral-600">Please pay by {METHOD_LABELS[vendor?.paymentMethod ?? "ach"].toLowerCase()} and include {bill.number} in the reference.</p>
            <p className="text-neutral-600">Questions about this invoice? Email {vendor?.email}.</p>
            <div className="mt-4 flex flex-col gap-2">
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} className="h-[0.7em] rounded bg-neutral-100" style={{ width: `${90 - ((i * 23) % 40)}%` }} />
              ))}
            </div>
            <p className="mt-auto text-center text-neutral-400">Page 2 of 2</p>
          </article>
        </div>
      </div>
    </div>
  );
}

function Timeline({ bill, vendor, approvals }: { bill: Bill; vendor: Vendor | undefined; approvals: ReturnType<typeof useCollection<"approvals">> }) {
  const people = useIndex("employees");
  const items: { icon: ReactNode; title: ReactNode; at?: string; tone: "done" | "current" | "next" }[] = [];
  items.push({ icon: <CheckCircle2 />, title: bill.attachmentName ? `Received by email from ${vendor?.name}` : "Entered by hand", at: dateTime(`${bill.issueDate}T09:12:00`), tone: "done" });
  for (const a of approvals) {
    items.push({ icon: <CheckCircle2 />, title: `Submitted for approval by ${fullName(people.get(a.requesterId))}`, at: dateTime(a.createdAt), tone: "done" });
    if (a.status === "approved") items.push({ icon: <CheckCircle2 />, title: `Approved by ${fullName(people.get(a.approverIds.at(-1) ?? ME_ID))}`, tone: "done" });
    if (a.status === "rejected") items.push({ icon: <XCircle />, title: `Rejected by ${fullName(people.get(a.approverIds.at(-1) ?? ME_ID))}`, tone: "done" });
    if (a.status === "pending" || a.status === "escalated") items.push({ icon: <Clock />, title: `Waiting on ${a.stage === "controller" ? "the controller" : a.stage === "manager" ? "a manager" : "Finance"}`, at: `Due ${dateTime(a.dueAt)}`, tone: "current" });
  }
  if (!approvals.length && bill.status === "awaiting_approval") items.push({ icon: <Clock />, title: "Waiting on Finance", tone: "current" });
  if (!approvals.length && (bill.status === "scheduled" || bill.status === "paid" || bill.status === "overdue")) items.push({ icon: <CheckCircle2 />, title: "Approved by policy (under $10,000 from a known vendor)", tone: "done" });
  if (bill.status === "draft") items.push({ icon: <Circle />, title: "Submit for approval", tone: "next" });
  if (bill.status === "scheduled" && bill.scheduledFor) items.push({ icon: <Clock />, title: `Payment scheduled for ${date(bill.scheduledFor)} by ${METHOD_LABELS[vendor?.paymentMethod ?? "ach"]}`, tone: "current" });
  if (bill.status === "overdue") items.push({ icon: <Clock />, title: `Payment overdue since ${date(bill.dueDate)}`, tone: "current" });
  if (bill.status === "paid") items.push({ icon: <CheckCircle2 />, title: `Paid by ${METHOD_LABELS[vendor?.paymentMethod ?? "ach"]}`, at: bill.paidAt ? dateTime(bill.paidAt) : undefined, tone: "done" });
  if (bill.status === "void") items.push({ icon: <XCircle />, title: "Voided", tone: "done" });
  if (bill.status !== "paid" && bill.status !== "void") items.push({ icon: <Circle />, title: "Paid", tone: "next" });

  return (
    <ol className="flex flex-col">
      {items.map((it, i) => (
        <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
          {i < items.length - 1 ? <span className="absolute top-5 bottom-0 left-[9px] w-px bg-line" /> : null}
          <span className={cn("relative z-[1] mt-0.5 grid size-[19px] place-items-center rounded-full bg-panel [&_svg]:size-[18px]", it.tone === "done" ? "text-brand" : it.tone === "current" ? "text-warn" : "text-ink-3")}>{it.icon}</span>
          <span className="flex flex-col">
            <span className={cn("text-[13px]", it.tone === "next" ? "text-ink-3" : "text-ink")}>{it.title}</span>
            {it.at ? <span className="text-xs text-ink-3">{it.at}</span> : null}
          </span>
        </li>
      ))}
      {bill.status === "overdue" ? (
        <li className="mt-3">
          <Callout tone="danger">This bill is past due. Pay it now or contact {vendor?.name} about the delay.</Callout>
        </li>
      ) : null}
    </ol>
  );
}
