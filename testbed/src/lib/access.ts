import { useLab } from "@/lab/lab";
import type { Plan, Role } from "@/data/types";

// What each role may do and what each plan includes. Pages use these to
// disable buttons with a reason, so a guide meets "You need the Finance role"
// instead of a missing button.

export type Action =
  | "cards.issue"
  | "cards.manage"
  | "cards.reveal"
  | "expenses.review"
  | "expenses.export"
  | "approvals.decide"
  | "policies.edit"
  | "bills.create"
  | "bills.pay"
  | "vendors.manage"
  | "accounting.manage"
  | "reports.create"
  | "people.invite"
  | "people.manage"
  | "settings.company"
  | "settings.billing"
  | "settings.security"
  | "settings.developer"
  | "settings.danger";

const ROLE_ACTIONS: Record<Role, Action[] | "all"> = {
  admin: "all",
  finance: [
    "cards.issue",
    "cards.manage",
    "cards.reveal",
    "expenses.review",
    "expenses.export",
    "approvals.decide",
    "policies.edit",
    "bills.create",
    "bills.pay",
    "vendors.manage",
    "accounting.manage",
    "reports.create",
  ],
  manager: ["approvals.decide", "reports.create", "cards.reveal"],
  employee: ["cards.reveal"],
  auditor: ["expenses.export"],
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  finance: "Finance",
  manager: "Manager",
  employee: "Employee",
  auditor: "Auditor",
};

export function roleCan(role: Role, action: Action) {
  const allowed = ROLE_ACTIONS[role];
  return allowed === "all" || allowed.includes(action);
}

/** Whether the signed-in person may do this, and the reason when not. */
export function useCan(action: Action): { allowed: boolean; reason: string } {
  const role = useLab((s) => s.role);
  const allowed = roleCan(role, action);
  const needed = (Object.keys(ROLE_ACTIONS) as Role[]).filter((r) => r !== "admin" && roleCan(r, action)).map((r) => ROLE_LABELS[r]);
  return {
    allowed,
    reason: allowed ? "" : `Only ${["Admin", ...needed].join(" or ")} can do this. You're signed in as ${ROLE_LABELS[role]}.`,
  };
}

export type Feature =
  | "multiEntity"
  | "customApprovalChains"
  | "procurement"
  | "advancedReports"
  | "erpSync"
  | "sso"
  | "auditLog"
  | "apiAccess"
  | "budgets"
  | "billPay"
  | "perDiem"
  | "customRoles";

const PLAN_FEATURES: Record<Plan, Feature[]> = {
  starter: ["billPay"],
  growth: ["billPay", "erpSync", "budgets", "advancedReports", "perDiem", "apiAccess", "customApprovalChains"],
  enterprise: ["billPay", "erpSync", "budgets", "advancedReports", "perDiem", "apiAccess", "customApprovalChains", "multiEntity", "procurement", "sso", "auditLog", "customRoles"],
};

export const PLAN_LABELS: Record<Plan, string> = { starter: "Starter", growth: "Growth", enterprise: "Enterprise" };

export function planHas(plan: Plan, feature: Feature) {
  return PLAN_FEATURES[plan].includes(feature);
}

export function useFeature(feature: Feature): { enabled: boolean; needs: Plan } {
  const plan = useLab((s) => s.plan);
  const needs: Plan = planHas("starter", feature) ? "starter" : planHas("growth", feature) ? "growth" : "enterprise";
  return { enabled: planHas(plan, feature), needs };
}
