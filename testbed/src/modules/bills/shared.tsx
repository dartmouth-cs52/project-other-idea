import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { Building2, CreditCard, Landmark, Mail } from "lucide-react";
import { ME_ID, newId, upsert } from "@/data/store";
import type { Approval, Bill, Vendor } from "@/data/types";
import { money } from "@/lib/format";

// Helpers shared by the bill and vendor pages.

export const FORWARD_EMAIL = "bills+northpine@inbox.example";

export const billTotal = (b: Pick<Bill, "lines">) => b.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

/** The list tabs, in order. "Inbox" holds drafts that arrived by email or upload. */
export const BILL_TABS: { status: Bill["status"]; label: string; param: string }[] = [
  { status: "draft", label: "Inbox", param: "inbox" },
  { status: "awaiting_approval", label: "Awaiting approval", param: "awaiting_approval" },
  { status: "scheduled", label: "Scheduled", param: "scheduled" },
  { status: "paid", label: "Paid", param: "paid" },
  { status: "overdue", label: "Overdue", param: "overdue" },
];

export const METHOD_LABELS: Record<Vendor["paymentMethod"], string> = {
  ach: "ACH bank transfer",
  wire: "Wire transfer",
  check: "Paper check",
  card: "Virtual card",
};

export const METHOD_HINTS: Record<Vendor["paymentMethod"], string> = {
  ach: "Free. Arrives in 2 to 3 business days.",
  wire: "$15 fee. Arrives the same day if sent before 3 PM ET.",
  check: "Free. Mailed in 5 to 7 business days.",
  card: "Single-use card emailed to the vendor. 2.9% fee.",
};

export const METHOD_ICONS: Record<Vendor["paymentMethod"], React.ReactNode> = {
  ach: <Landmark />,
  wire: <Building2 />,
  check: <Mail />,
  card: <CreditCard />,
};

export const TERMS_LABELS: Record<Vendor["terms"], string> = {
  due_on_receipt: "Due on receipt",
  net15: "Net 15",
  net30: "Net 30",
  net45: "Net 45",
  net60: "Net 60",
};

const TERMS_DAYS: Record<Vendor["terms"], number> = { due_on_receipt: 0, net15: 15, net30: 30, net45: 45, net60: 60 };

export const dueFromTerms = (issue: string, terms: Vendor["terms"]) => format(addDays(parseISO(issue), TERMS_DAYS[terms]), "yyyy-MM-dd");

export const VENDOR_CATEGORIES = ["Software", "Facilities", "Professional services", "Marketing", "Insurance", "Logistics"];

export const VENDOR_STATUS_LABELS: Record<Vendor["status"], string> = { active: "Active", pending_review: "Pending review", blocked: "Blocked" };

export const last4 = (s: string) => s.slice(-4);

/** "in 3 days", "today", "5 days late" */
export function dueLabel(due: string, status: Bill["status"]) {
  if (status === "paid" || status === "void") return null;
  const d = differenceInCalendarDays(parseISO(due), new Date());
  if (d === 0) return { text: "Due today", late: false };
  if (d > 0) return { text: `In ${d} day${d === 1 ? "" : "s"}`, late: false };
  return { text: `${-d} day${d === -1 ? "" : "s"} late`, late: true };
}

/** A made-up bank name for a routing number, so the detail pages look real. */
export function bankName(routing: string) {
  const banks = ["First Coastal Bank", "Harbor Federal Credit Union", "Summit National Bank", "Pioneer Savings", "Cascade Trust"];
  return banks[Number(routing.slice(-1)) % banks.length];
}

/** Puts a new approval in the queue for a bill or vendor. */
export function requestApproval(kind: Approval["kind"], subjectId: string, title: string, amount = 0) {
  const now = new Date();
  const approval: Approval = {
    id: newId("apr"),
    kind,
    title,
    requesterId: ME_ID,
    amount,
    currency: "USD",
    createdAt: now.toISOString(),
    dueAt: addDays(now, 3).toISOString(),
    status: "pending",
    stage: "finance",
    approverIds: [ME_ID],
    subjectId,
    comments: [],
  };
  upsert("approvals", approval);
  return approval;
}

export const billTitle = (b: Bill, v: Vendor | undefined) => `${v?.name ?? "Unknown vendor"} ${b.number}`;
export const billAmount = (b: Bill) => money(billTotal(b), b.currency);
