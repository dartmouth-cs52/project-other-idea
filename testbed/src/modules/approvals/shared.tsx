import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ME_ID, get, patch, upsert, useCollection } from "@/data/store";
import type { Approval, ApprovalKind } from "@/data/types";
import { Badge } from "@/ui/display";
import { act } from "@/ui/flow";
import { Field, Switch, Textarea } from "@/ui/form";
import { Combobox, DateRangePicker, type Range } from "@/ui/inputs";
import { Modal, Sheet } from "@/ui/overlay";
import { Button } from "@/ui/button";
import { date } from "@/lib/format";

// What every approvals page shares: labels, the decisions, the reject dialog
// and the delegation panel.

export const KIND_LABELS: Record<ApprovalKind, string> = {
  card_request: "Card request",
  reimbursement: "Reimbursement",
  bill: "Bill",
  limit_increase: "Limit increase",
  vendor: "New vendor",
  purchase_order: "Purchase order",
};

export const KIND_PLURAL: Record<ApprovalKind, string> = {
  card_request: "Card requests",
  reimbursement: "Reimbursements",
  bill: "Bills",
  limit_increase: "Limit increases",
  vendor: "Vendors",
  purchase_order: "Purchase orders",
};

export type Stage = Approval["stage"];
export const STAGES: { id: Stage; label: string; who: string }[] = [
  { id: "manager", label: "Manager", who: "The requester's manager" },
  { id: "finance", label: "Finance", who: "Anyone with the Finance role" },
  { id: "controller", label: "Controller", who: "Avery Stone, Controller" },
  { id: "done", label: "Done", who: "" },
];
export const stageLabel = (s: Stage) => STAGES.find((x) => x.id === s)!.label;
export const isOpen = (a: Approval) => a.status === "pending" || a.status === "escalated";
/** The seed leaves escalated requests at "done". They're waiting on the controller. */
export const stageOf = (a: Approval): Stage => (isOpen(a) && a.stage === "done" ? "controller" : !isOpen(a) ? "done" : a.stage);

export function KindBadge({ kind }: { kind: ApprovalKind }) {
  const tone = kind === "bill" || kind === "purchase_order" ? "info" : kind === "reimbursement" ? "brand" : "neutral";
  return <Badge tone={tone}>{KIND_LABELS[kind]}</Badge>;
}

/** Where the record an approval is about lives. */
export function subjectHref(a: Approval): { href: string; label: string } | null {
  switch (a.kind) {
    case "reimbursement": {
      const r = get("reimbursements", a.subjectId);
      return { href: `/reimbursements/${a.subjectId}`, label: r ? `${r.merchant} reimbursement` : "Reimbursement" };
    }
    case "bill": {
      const b = get("bills", a.subjectId);
      return { href: `/bills/${a.subjectId}`, label: b ? `Bill ${b.number}` : "Bill" };
    }
    case "vendor": {
      const v = get("vendors", a.subjectId);
      return { href: `/bills/vendors/${a.subjectId}`, label: v ? v.name : "Vendor" };
    }
    default: {
      const c = get("cards", a.subjectId);
      return { href: `/cards/${a.subjectId}`, label: c ? `${c.nickname} •••• ${c.last4}` : "Card" };
    }
  }
}

const comment = (body: string) => ({ authorId: ME_ID, body, at: new Date().toISOString() });

export function approveMany(items: Approval[]) {
  const before = items;
  return act(() => upsert("approvals", ...items.map((a) => ({ ...a, status: "approved" as const, stage: "done" as const }))), {
    success: items.length === 1 ? `Approved "${items[0].title}"` : `Approved ${items.length} requests`,
    undo: () => upsert("approvals", ...before),
  });
}

export function reject(a: Approval, reason: string) {
  return act(() => patch("approvals", a.id, { status: "rejected", stage: "done", comments: [...a.comments, comment(`Rejected: ${reason}`)] }), {
    success: `Rejected "${a.title}"`,
    undo: () => upsert("approvals", a),
  });
}

export function moveTo(a: Approval, stage: Stage) {
  if (stage === "done") return approveMany([a]);
  const order = STAGES.findIndex((s) => s.id === stage) > STAGES.findIndex((s) => s.id === stageOf(a));
  return act(() => patch("approvals", a.id, { stage, status: order ? "escalated" : "pending", comments: [...a.comments, comment(`${order ? "Escalated" : "Sent back"} to ${stageLabel(stage)}`)] }), {
    success: `Moved to ${stageLabel(stage)}`,
    undo: () => upsert("approvals", a),
  });
}

export function escalate(a: Approval) {
  const next: Stage = stageOf(a) === "manager" ? "finance" : "controller";
  return moveTo(a, next);
}

export function addComment(a: Approval, body: string) {
  return act(() => patch("approvals", a.id, { comments: [...a.comments, comment(body)] }), { success: "Comment posted" });
}

/** Asks why before rejecting. The reason is required. */
export function RejectModal({ items, onOpenChange }: { items: Approval[]; onOpenChange: (open: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = items.length > 0;
  useEffect(() => {
    if (open) {
      setReason("");
      setTried(false);
    }
  }, [open]);
  const error = reason.trim().length < 4 ? "Add a reason so the requester knows what to change." : null;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={items.length === 1 ? `Reject "${items[0].title}"?` : `Reject ${items.length} requests?`}
      description="The requester gets your reason by email and can resubmit."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setTried(true);
              if (error) return;
              setBusy(true);
              for (const a of items) await reject(a, reason.trim());
              setBusy(false);
              onOpenChange(false);
            }}
          >
            Reject
          </Button>
        </>
      }
    >
      <Field label="Reason" error={tried ? error : null}>
        {(id) => <Textarea id={id} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="This should go on the team's card instead." aria-invalid={tried && !!error} />}
      </Field>
    </Modal>
  );
}

interface Delegation {
  delegateId: string;
  from: string;
  to: string;
  note: string;
  notify: boolean;
}
interface DelegationStore {
  delegation: Delegation | null;
  set: (d: Delegation | null) => void;
}
export const useDelegation = create<DelegationStore>()(persist((set) => ({ delegation: null, set: (delegation) => set({ delegation }) }), { name: "northpine-approval-delegation" }));

/** Hand your approvals to someone else for a while, like before a vacation. */
export function DelegateSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const people = useCollection("employees");
  const current = useDelegation((s) => s.delegation);
  const setDelegation = useDelegation((s) => s.set);
  const [who, setWho] = useState<string | null>(null);
  const [range, setRange] = useState<Range>({ from: null, to: null });
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setWho(current?.delegateId ?? null);
    setRange(current ? { from: current.from, to: current.to } : { from: null, to: null });
    setNote(current?.note ?? "");
    setNotify(current?.notify ?? true);
    setTried(false);
  }, [open, current]);
  const options = people
    .filter((e) => e.id !== ME_ID && e.status === "active" && (e.role === "finance" || e.role === "admin" || e.role === "manager"))
    .map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName}`, hint: e.title }));
  const errors = { who: who ? null : "Pick who approves while you're away.", range: range.from && range.to ? null : "Pick a start and end date." };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Delegate approvals"
      description="Someone else approves on your behalf for a set time. You can still approve too."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              setTried(true);
              if (errors.who || errors.range) return;
              await act(() => setDelegation({ delegateId: who!, from: range.from!, to: range.to!, note, notify }), { success: "Approvals delegated" });
              onOpenChange(false);
            }}
          >
            Save delegation
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Delegate to" error={tried ? errors.who : null} hint="Managers, Finance and Admins can take approvals.">
          {(id) => <Combobox id={id} value={who} onChange={setWho} options={options} placeholder="Choose a person" searchPlaceholder="Search people…" />}
        </Field>
        <Field label="Dates" error={tried ? errors.range : null} hint={range.from && range.to ? `${date(range.from)} to ${date(range.to)}` : undefined}>
          <div>
            <DateRangePicker value={range} onChange={setRange} />
          </div>
        </Field>
        <Field label="Note for the delegate" optional>
          {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything over $5,000 can wait for me." />}
        </Field>
        <Switch checked={notify} onCheckedChange={setNotify} label="Email the delegate" description="They get a summary of what's waiting." />
      </div>
    </Sheet>
  );
}
