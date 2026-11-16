import { formatISO } from "date-fns";
import { Check, CircleDot, Download, FileText, MapPin, MoreHorizontal, Pencil, Send, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ME_ID, get, patch, remove, useIndex, useRow } from "@/data/store";
import type { Reimbursement } from "@/data/types";
import { cn } from "@/lib/cn";
import { ago, date, dateTime, fullName, money } from "@/lib/format";
import { Button, Tooltip } from "@/ui/button";
import { Avatar, Badge, Callout, Card, DescriptionList, EmptyState, PageHeader, StatusBadge } from "@/ui/display";
import { Field, Textarea } from "@/ui/form";
import { act, Loader, RoleGate, toast } from "@/ui/flow";
import { FileDrop } from "@/ui/inputs";
import { ConfirmDialog, Menu, Modal } from "@/ui/overlay";
import { KIND_LABELS, KindIcon, MILEAGE_RATE, useExtras } from "./shared";

export function ReimbursementDetailPage() {
  const { id } = useParams();
  const r = useRow("reimbursements", id);
  if (!r)
    return (
      <>
        <PageHeader title="Reimbursement not found" crumbs={[{ label: "Reimbursements", to: "/reimbursements" }, { label: "Not found" }]} />
        <EmptyState
          title="This reimbursement doesn't exist"
          description="It may have been deleted, or the link is wrong."
          action={
            <Button asChild>
              <Link to="/reimbursements">Back to reimbursements</Link>
            </Button>
          }
        />
      </>
    );
  return (
    <Loader loadKey={["reimbursement", id]} rows={8}>
      {() => <Detail r={r} />}
    </Loader>
  );
}

function Detail({ r }: { r: Reimbursement }) {
  const navigate = useNavigate();
  const people = useIndex("employees");
  const categories = useIndex("categories");
  const extras = useExtras();
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const employee = people.get(r.employeeId);
  const mine = r.employeeId === ME_ID;
  const split = extras.splits[r.id] ?? [];
  const perDiem = extras.perDiem[r.id];
  const title = r.kind === "mileage" && r.origin ? `${r.origin} to ${r.destination}` : r.merchant;

  useEffect(() => {
    if (deleted) navigate("/reimbursements");
  }, [deleted, navigate]);

  const log = (label: string) => extras.log(r.id, { label, by: ME_ID, at: formatISO(new Date()) });
  const submit = () =>
    act(
      () => {
        patch("reimbursements", r.id, { status: "submitted", submittedAt: formatISO(new Date()) });
        log("Submitted for approval");
      },
      { success: "Submitted. Your manager will review it." },
    );
  const approve = () =>
    act(
      () => {
        patch("reimbursements", r.id, { status: "approved" });
        log("Approved");
      },
      { success: `Approved. ${employee?.firstName ?? "They"} will be paid with the next payroll.`, undo: () => patch("reimbursements", r.id, { status: "submitted" }) },
    );

  // The actions change with the status and with whose it is.
  const ownApproveReason = "You can't approve your own reimbursement. Your manager does.";
  let actions: React.ReactNode = null;
  if (mine && r.status === "draft")
    actions = (
      <>
        <Button asChild>
          <Link to={`/reimbursements/${r.id}/edit`}>
            <Pencil /> Edit
          </Link>
        </Button>
        <Button variant="primary" onClick={() => void submit()}>
          <Send /> Submit for approval
        </Button>
      </>
    );
  else if (mine && r.status === "submitted")
    actions = (
      <>
        <Button onClick={() => setWithdrawOpen(true)}>
          <Undo2 /> Withdraw
        </Button>
        {/* Disabled with a reason when it's your own. On purpose. */}
        <Tooltip content={ownApproveReason}>
          <span tabIndex={0} className="inline-flex">
            <Button variant="primary" disabled>
              <Check /> Approve
            </Button>
          </span>
        </Tooltip>
      </>
    );
  else if (mine && r.status === "rejected")
    actions = (
      <Button variant="primary" asChild>
        <Link to={`/reimbursements/${r.id}/edit`}>
          <Pencil /> Edit and resubmit
        </Link>
      </Button>
    );
  else if (!mine && r.status === "submitted")
    actions = (
      <>
        <RoleGate action="approvals.decide">
          {(allowed) => (
            <Button disabled={!allowed} onClick={() => setRejectOpen(true)}>
              <X /> Reject
            </Button>
          )}
        </RoleGate>
        <RoleGate action="approvals.decide">
          {(allowed) => (
            <Button variant="primary" disabled={!allowed} onClick={() => void approve()}>
              <Check /> Approve
            </Button>
          )}
        </RoleGate>
      </>
    );
  else if (r.status === "approved")
    actions = (
      <RoleGate action="bills.pay">
        {(allowed) => (
          <Button
            variant="primary"
            disabled={!allowed}
            onClick={() =>
              void act(
                () => {
                  patch("reimbursements", r.id, { status: "paid" });
                  log("Paid by direct deposit");
                },
                { success: "Marked as paid" },
              )
            }
          >
            Mark as paid
          </Button>
        )}
      </RoleGate>
    );

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Reimbursements", to: mine ? "/reimbursements" : "/reimbursements?tab=all" }, { label: title }]}
        title={title}
        meta={
          <>
            <StatusBadge status={r.status} />
            <Badge>
              <KindIcon kind={r.kind} className="size-3" /> {KIND_LABELS[r.kind]}
            </Badge>
            <span className="tabular text-[13px] font-medium text-ink">{money(r.amount, r.currency)}</span>
            <span className="text-[13px] text-ink-3">·</span>
            <span className="text-[13px] text-ink-3">
              {mine ? "Yours" : (
                <>
                  From{" "}
                  <Link to={`/people/${r.employeeId}`} className="text-brand hover:underline">
                    {fullName(employee)}
                  </Link>
                </>
              )}
            </span>
          </>
        }
        actions={
          <>
            {actions}
            <Menu
              label="More actions"
              items={[
                { label: "Download PDF", icon: <Download />, onSelect: () => toast.success("PDF downloaded") },
                { separator: true, label: "" },
                { label: "Delete draft", icon: <Trash2 />, danger: true, disabled: !(mine && r.status === "draft"), onSelect: () => setDeleteOpen(true) },
              ]}
              trigger={
                <Button size="icon" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              }
            />
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-5">
          {r.status === "rejected" ? (
            <Callout tone="danger" title="Sent back">
              {(extras.comments[r.id] ?? []).slice(-1)[0]?.body ?? "Your approver didn't leave a reason. Ask what needs to change in the comments."}
            </Callout>
          ) : r.status === "approved" ? (
            <Callout tone="ok" title="Approved">
              Paid by direct deposit with the next payroll.
            </Callout>
          ) : null}

          <Card title="Details">
            <DescriptionList
              items={[
                { label: r.kind === "per_diem" ? "First day" : "Date", value: date(r.date) },
                { label: "Amount", value: money(r.amount, r.currency) },
                ...(r.kind === "out_of_pocket" ? [{ label: "Merchant", value: r.merchant }] : []),
                { label: "Category", value: split.length ? "Split, see below" : r.categoryId ? categories.get(r.categoryId)?.name : "Uncategorized" },
                ...(r.kind === "mileage"
                  ? [
                      { label: "Route", value: `${r.origin} to ${r.destination}${extras.roundTrip[r.id] ? " and back" : ""}` },
                      { label: "Distance", value: `${r.miles} mi at ${money(MILEAGE_RATE)} a mile` },
                    ]
                  : []),
                ...(perDiem
                  ? [
                      { label: "Destination", value: perDiem.city },
                      { label: "Trip", value: `${date(perDiem.from)} to ${date(perDiem.to)}` },
                    ]
                  : []),
                { label: "Memo", value: r.memo || "None" },
                {
                  label: "Employee",
                  value: (
                    <Link to={`/people/${r.employeeId}`} className="text-brand hover:underline">
                      {fullName(employee)}
                    </Link>
                  ),
                },
                { label: "Submitted", value: r.submittedAt ? dateTime(r.submittedAt) : "Not yet" },
              ]}
            />
          </Card>

          {split.length ? (
            <Card title="Split" bodyClassName="p-0">
              <ul>
                {split.map((l, i) => (
                  <li key={i} className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[13px] last:border-0">
                    <span>
                      {categories.get(l.categoryId)?.name ?? "Uncategorized"} {l.memo ? <span className="text-ink-3">· {l.memo}</span> : null}
                    </span>
                    <span className="tabular">{money(l.amount, r.currency)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <ReceiptPanel r={r} />
        </div>

        <div className="flex flex-col gap-5">
          <Timeline r={r} />
          <Comments r={r} />
        </div>
      </div>

      <ConfirmDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        title="Withdraw this reimbursement?"
        description="It goes back to your drafts, and your approver stops seeing it. You can edit it and submit again."
        confirmLabel="Withdraw"
        onConfirm={async () => {
          await act(
            () => {
              patch("reimbursements", r.id, { status: "draft", submittedAt: null });
              log("Withdrawn");
            },
            { success: "Withdrawn. It's back in your drafts." },
          );
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        danger
        title="Delete this draft?"
        description="The draft and its receipt are deleted for good."
        confirmLabel="Delete draft"
        onConfirm={async () => {
          await act(() => remove("reimbursements", r.id), { success: "Draft deleted" });
          if (!get("reimbursements", r.id)) setDeleted(true);
        }}
      />
      <RejectModal
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        onReject={async (reason) => {
          await act(
            () => {
              patch("reimbursements", r.id, { status: "rejected" });
              extras.addComment(r.id, { authorId: ME_ID, body: reason, at: formatISO(new Date()) });
              log("Sent back");
            },
            { success: `Sent back to ${employee?.firstName ?? "them"}` },
          );
        }}
      />
    </>
  );
}

function RejectModal({ open, onOpenChange, onReject }: { open: boolean; onOpenChange: (v: boolean) => void; onReject: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Send back for changes"
      description="They'll see your reason and can fix it and submit again."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              if (reason.trim().length < 5) return setError("Say what needs to change.");
              setBusy(true);
              await onReject(reason.trim());
              setBusy(false);
              onOpenChange(false);
            }}
          >
            Reject
          </Button>
        </>
      }
    >
      <Field label="Reason" error={error}>
        {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The receipt is for a different amount" />}
      </Field>
    </Modal>
  );
}

function ReceiptPanel({ r }: { r: Reimbursement }) {
  const extras = useExtras();
  const mine = r.employeeId === ME_ID;
  if (r.kind === "mileage")
    return (
      <Card title="Route">
        <div className="flex items-center gap-4 rounded-lg bg-sunken/70 p-4">
          <svg viewBox="0 0 220 60" className="h-16 w-56 shrink-0" aria-hidden>
            <path d="M10 45 C 60 5, 120 60, 210 15" fill="none" stroke="var(--np-brand)" strokeWidth="2.5" strokeDasharray="5 4" />
            <circle cx="10" cy="45" r="5" fill="var(--np-brand)" />
            <circle cx="210" cy="15" r="5" fill="var(--np-ink)" />
          </svg>
          <div className="flex flex-col gap-1 text-[13px]">
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3.5 text-brand" /> {r.origin}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3.5 text-ink" /> {r.destination}
            </span>
            <span className="text-xs text-ink-3">
              {r.miles} mi, {money(r.amount)}
            </span>
          </div>
        </div>
      </Card>
    );
  if (r.kind === "per_diem")
    return (
      <Card title="Receipt">
        <p className="text-[13px] text-ink-3">Per diem doesn't need receipts. The daily rate covers meals and incidentals.</p>
      </Card>
    );
  const name = extras.receiptNames[r.id] ?? `receipt-${r.id.slice(-4)}.pdf`;
  if (r.receipt === "attached")
    return (
      <Card
        title="Receipt"
        actions={
          <Button size="sm" variant="ghost" onClick={() => toast.success(`${name} downloaded`)}>
            <Download /> Download
          </Button>
        }
      >
        <div className="flex gap-4">
          {/* A drawn receipt, not an image. */}
          <div className="w-48 shrink-0 rounded-sm border border-line bg-white p-3 font-mono text-[10.5px] leading-relaxed text-neutral-700 shadow-sm">
            <p className="text-center font-semibold uppercase">{r.merchant}</p>
            <p className="text-center text-neutral-400">{date(r.date)}</p>
            <div className="my-2 border-t border-dashed border-neutral-300" />
            <p className="flex justify-between">
              <span>Subtotal</span>
              <span>{(r.amount * 0.92).toFixed(2)}</span>
            </p>
            <p className="flex justify-between">
              <span>Tax</span>
              <span>{(r.amount * 0.08).toFixed(2)}</span>
            </p>
            <div className="my-2 border-t border-dashed border-neutral-300" />
            <p className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{r.amount.toFixed(2)}</span>
            </p>
            <p className="mt-2 text-center text-neutral-400">Thank you</p>
          </div>
          <div className="flex flex-col gap-1 text-[13px]">
            <span className="flex items-center gap-1.5 font-medium">
              <FileText className="size-4 text-ink-3" /> {name}
            </span>
            <span className="text-ink-3">Matched to {money(r.amount, r.currency)} on {date(r.date)}.</span>
          </div>
        </div>
      </Card>
    );
  return (
    <Card title="Receipt" description="Missing. Anything over $75 needs one before it can be approved.">
      {mine ? (
        <FileDrop
          label="Upload receipt"
          hint="Drop a file here, or click to browse. JPG, PNG or PDF."
          accept="image/*,.pdf"
          onFiles={(files) => {
            const file = files[0];
            if (!file) return;
            void act(
              () => {
                patch("reimbursements", r.id, { receipt: "attached" });
                extras.setExtra({ receiptNames: { [r.id]: file.name } });
                extras.log(r.id, { label: "Receipt added", by: ME_ID, at: formatISO(new Date()) });
              },
              { success: "Receipt attached" },
            );
          }}
        />
      ) : (
        <p className="text-[13px] text-ink-3">Only the employee can add the receipt. Ask for it in the comments.</p>
      )}
    </Card>
  );
}

function Timeline({ r }: { r: Reimbursement }) {
  const history = useExtras((s) => s.history[r.id]);
  const people = useIndex("employees");
  const employee = people.get(r.employeeId);
  const manager = employee?.managerId ? people.get(employee.managerId) : undefined;
  type StepState = "done" | "current" | "failed" | "todo";
  const reached = (s: Reimbursement["status"]) => ["draft", "submitted", "approved", "paid"].indexOf(s);
  const level = r.status === "rejected" ? 1 : reached(r.status);
  const steps: { label: string; detail: string; state: StepState }[] = [
    { label: "Created", detail: date(r.date), state: "done" },
    { label: "Submitted", detail: r.submittedAt ? date(r.submittedAt) : "Not yet", state: level >= 1 ? "done" : "current" },
    {
      label: r.status === "rejected" ? "Sent back" : "Manager approval",
      detail: manager ? fullName(manager) : "Finance",
      state: r.status === "rejected" ? "failed" : level >= 2 ? "done" : level === 1 ? "current" : "todo",
    },
    { label: "Paid", detail: r.status === "paid" ? "Direct deposit" : "With the next payroll", state: level >= 3 ? "done" : level === 2 ? "current" : "todo" },
  ];
  return (
    <Card title="Status">
      <ol className="flex flex-col">
        {steps.map((s, i) => (
          <li key={s.label} className="relative flex gap-3 pb-4 last:pb-0">
            {i < steps.length - 1 ? <span className={cn("absolute top-5 left-[9px] h-[calc(100%-12px)] w-px", s.state === "done" ? "bg-brand" : "bg-line-strong")} /> : null}
            <span
              className={cn(
                "relative z-10 grid size-[19px] shrink-0 place-items-center rounded-full border",
                s.state === "done" && "border-brand bg-brand text-brand-ink",
                s.state === "current" && "border-warn bg-warn-soft text-warn",
                s.state === "failed" && "border-danger bg-danger text-white",
                s.state === "todo" && "border-line-strong bg-panel",
              )}
            >
              {s.state === "done" ? <Check className="size-3" strokeWidth={3} /> : s.state === "failed" ? <X className="size-3" strokeWidth={3} /> : s.state === "current" ? <CircleDot className="size-3" /> : null}
            </span>
            <span className="flex flex-col">
              <span className={cn("text-[13px] font-medium", s.state === "todo" && "text-ink-3")}>{s.label}</span>
              <span className="text-xs text-ink-3">{s.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      {history?.length ? (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs font-medium text-ink-3">History</p>
          <ul className="flex flex-col gap-1.5">
            {history
              .slice()
              .reverse()
              .map((h, i) => (
                <li key={i} className="flex justify-between gap-2 text-[12.5px]">
                  <span>
                    {h.label} <span className="text-ink-3">by {h.by === ME_ID ? "you" : fullName(people.get(h.by))}</span>
                  </span>
                  <span className="text-ink-3">{ago(h.at)}</span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function Comments({ r }: { r: Reimbursement }) {
  const people = useIndex("employees");
  const stored = useExtras((s) => s.comments[r.id]);
  const addComment = useExtras((s) => s.addComment);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const employee = people.get(r.employeeId);
  // A starter comment on older claims, so the thread isn't always empty.
  const seeded = useMemo(
    () =>
      r.status === "rejected" && !stored?.length && employee?.managerId
        ? [{ authorId: employee.managerId, body: "The receipt total doesn't match the amount. Can you check it?", at: r.submittedAt ?? r.date }]
        : [],
    [r, stored, employee],
  );
  const thread = [...seeded, ...(stored ?? [])];
  return (
    <Card title="Comments" description={thread.length ? `${thread.length} ${thread.length === 1 ? "comment" : "comments"}` : "Ask a question or add context"}>
      <div className="flex flex-col gap-4">
        {thread.length ? (
          <ul className="flex flex-col gap-3">
            {thread.map((c, i) => {
              const author = people.get(c.authorId);
              return (
                <li key={i} className="flex gap-2.5">
                  <Avatar person={author} size={24} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[12.5px]">
                      <span className="font-medium">{c.authorId === ME_ID ? "You" : fullName(author)}</span> <span className="text-ink-3">{ago(c.at)}</span>
                    </span>
                    <p className="text-[13px] whitespace-pre-wrap text-ink-2">{c.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="flex flex-col gap-2">
          <Textarea aria-label="Add a comment" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment…" className="min-h-16" />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              disabled={!body.trim()}
              onClick={async () => {
                setBusy(true);
                const text = body.trim();
                await act(() => addComment(r.id, { authorId: ME_ID, body: text, at: formatISO(new Date()) }), { success: "Comment posted" });
                setBody("");
                setBusy(false);
              }}
            >
              Post comment
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
