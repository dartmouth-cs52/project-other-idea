import { subDays } from "date-fns";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ME_ID } from "@/data/store";
import type { ApprovalKind, PolicyRule, Role } from "@/data/types";
import { money } from "@/lib/format";

// Rule wording, and the parts of Policies the seed doesn't hold: the handbook,
// per diem rates and second approval steps. Those live in localStorage.

export type Condition = PolicyRule["conditions"][number];
export type FieldName = Condition["field"];

export const FIELD_LABELS: Record<FieldName, string> = {
  amount: "Amount",
  category: "Category",
  department: "Department",
  merchant: "Merchant",
  entity: "Entity",
  kind: "Request type",
};

export const OPS: Record<FieldName, Condition["op"][]> = {
  amount: ["gt", "lt", "eq"],
  category: ["eq", "neq"],
  department: ["eq", "neq"],
  merchant: ["eq", "neq"],
  entity: ["eq", "neq"],
  kind: ["eq", "neq"],
};

export const OP_LABELS: Record<Condition["op"], string> = { gt: "is over", lt: "is under", eq: "is", neq: "is not", in: "is one of" };

export const ACTION_LABELS: Record<PolicyRule["action"], string> = {
  require_approval: "Require approval",
  require_receipt: "Require a receipt",
  block: "Block the charge",
  flag: "Flag for review",
  notify: "Notify finance",
};

export const APPROVER_ROLES: { value: Role; label: string }[] = [
  { value: "manager", label: "The requester's manager" },
  { value: "finance", label: "Finance team" },
  { value: "admin", label: "Controller" },
];

export const KIND_NAMES: Record<ApprovalKind, string> = {
  card_request: "Card request",
  reimbursement: "Reimbursement",
  bill: "Bill",
  limit_increase: "Limit increase",
  vendor: "New vendor",
  purchase_order: "Purchase order",
};

export interface Lookups {
  category: (id: string) => string | undefined;
  department: (id: string) => string | undefined;
  entity: (id: string) => string | undefined;
  person: (id: string) => string | undefined;
}

function valueText(c: Condition, l: Lookups) {
  if (!c.value) return c.field === "merchant" ? "blank" : "…";
  switch (c.field) {
    case "amount":
      return money(Number(c.value) || 0).replace(/\.00$/, "");
    case "category":
      return l.category(c.value) ?? "a category";
    case "department":
      return l.department(c.value) ?? "a department";
    case "entity":
      return l.entity(c.value) ?? "an entity";
    case "kind":
      return KIND_NAMES[c.value as ApprovalKind] ?? c.value;
    default:
      return `"${c.value}"`;
  }
}

/** "When amount is over $150 and category is Meals, require approval from the Manager." */
export function describeRule(rule: Pick<PolicyRule, "conditions" | "action" | "approverRole" | "approverId">, l: Lookups, secondStep?: Role | null) {
  const when = rule.conditions.length
    ? `When ${rule.conditions.map((c) => `${FIELD_LABELS[c.field].toLowerCase()} ${OP_LABELS[c.op]} ${valueText(c, l)}`).join(" and ")}`
    : "For every charge";
  const roleName = (r: Role) => (r === "manager" ? "the Manager" : r === "finance" ? "Finance" : r === "admin" ? "the Controller" : r);
  let then: string;
  switch (rule.action) {
    case "require_approval": {
      const who = rule.approverId ? (l.person(rule.approverId) ?? "a person") : rule.approverRole ? roleName(rule.approverRole) : "someone";
      then = `require approval from ${who}${secondStep ? `, then ${roleName(secondStep)}` : ""}`;
      break;
    }
    case "require_receipt":
      then = "require a receipt";
      break;
    case "block":
      then = "block the charge";
      break;
    case "flag":
      then = "flag it for review";
      break;
    default:
      then = "notify finance";
  }
  return `${when}, ${then}.`;
}

interface PolicyExtras {
  /** A second approval step per rule, on plans with custom approval chains. */
  chains: Record<string, Role | null>;
  perDiem: { id: string; city: string; lodging: number; meals: number }[];
  setChain: (ruleId: string, role: Role | null) => void;
  setPerDiem: (id: string, f: Partial<{ lodging: number; meals: number }>) => void;
}

export const usePolicyExtras = create<PolicyExtras>()(
  persist(
    (set) => ({
      chains: {},
      perDiem: [
        { id: "pd_nyc", city: "New York, NY", lodging: 282, meals: 79 },
        { id: "pd_sf", city: "San Francisco, CA", lodging: 268, meals: 79 },
        { id: "pd_pdx", city: "Portland, OR", lodging: 189, meals: 74 },
        { id: "pd_aus", city: "Austin, TX", lodging: 176, meals: 69 },
        { id: "pd_ldn", city: "London", lodging: 245, meals: 85 },
        { id: "pd_ber", city: "Berlin", lodging: 170, meals: 62 },
        { id: "pd_std", city: "Everywhere else", lodging: 110, meals: 59 },
      ],
      setChain: (ruleId, role) => set((s) => ({ chains: { ...s.chains, [ruleId]: role } })),
      setPerDiem: (id, f) => set((s) => ({ perDiem: s.perDiem.map((r) => (r.id === id ? { ...r, ...f } : r)) })),
    }),
    { name: "northpine-policy-extras" },
  ),
);

export interface HandbookVersion {
  n: number;
  html: string;
  at: string;
  authorId: string;
  note: string;
}

const V1 = `<h2>Northpine expense policy</h2><p>Spend Northpine's money the way you would spend your own. If you aren't sure whether something is allowed, ask in #finance before you buy it.</p><h2>Receipts</h2><p>Attach a receipt to every card charge over $75, and to every meal over $25. Upload it within 7 days.</p>`;
const V2 = `${V1}<h2>Meals</h2><p>Team and client meals are capped at $150 per charge. Anything over that needs your manager's approval.</p>`;
const V3 = `${V2}<h2>Travel</h2><ul><li>Book economy for flights under 6 hours.</li><li>Hotels should stay under the per diem rate for the city.</li><li>Rideshare is fine. Rental cars need a reason in the memo.</li></ul><h2>Lost receipts</h2><p>If you can't get a copy, open the charge in Expenses and choose <strong>I lost this receipt</strong>. You'll sign a short affidavit instead.</p>`;

interface HandbookStore {
  versions: HandbookVersion[];
  publish: (html: string, note: string) => void;
}

export const useHandbook = create<HandbookStore>()(
  persist(
    (set) => ({
      versions: [
        { n: 3, html: V3, at: subDays(new Date(), 12).toISOString(), authorId: ME_ID, note: "Added travel and lost receipts" },
        { n: 2, html: V2, at: subDays(new Date(), 96).toISOString(), authorId: ME_ID, note: "Meal limit" },
        { n: 1, html: V1, at: subDays(new Date(), 240).toISOString(), authorId: ME_ID, note: "First version" },
      ],
      publish: (html, note) => set((s) => ({ versions: [{ n: s.versions[0].n + 1, html, at: new Date().toISOString(), authorId: ME_ID, note }, ...s.versions] })),
    }),
    { name: "northpine-handbook" },
  ),
);
