import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useCollection } from "@/data/store";
import type { Department, Employee, Role } from "@/data/types";
import { ROLE_LABELS, type Action } from "@/lib/access";
import { Badge, LinkTabs } from "@/ui/display";

// Things the People pages share: the area's tabs, plain-language names for
// every permission, and custom roles, which the Role type has no room for.

export const ROLES: Role[] = ["admin", "finance", "manager", "employee", "auditor"];

export const ROLE_SUMMARY: Record<Role, string> = {
  admin: "Everything, including billing, security and people.",
  finance: "Cards, expenses, bills, accounting and reports. Not people or company settings.",
  manager: "Approves their team's spend and builds reports.",
  employee: "Uses their own cards and submits expenses.",
  auditor: "Read-only access, plus exporting expenses.",
};

export const ACTION_GROUPS: { area: string; actions: { action: Action; label: string }[] }[] = [
  {
    area: "Cards",
    actions: [
      { action: "cards.issue", label: "Issue cards" },
      { action: "cards.manage", label: "Freeze, cancel and change limits" },
      { action: "cards.reveal", label: "See their own full card number" },
    ],
  },
  {
    area: "Expenses and approvals",
    actions: [
      { action: "expenses.review", label: "Review expenses" },
      { action: "expenses.export", label: "Export expenses" },
      { action: "approvals.decide", label: "Approve or reject requests" },
      { action: "policies.edit", label: "Edit spend policies" },
    ],
  },
  {
    area: "Bill pay",
    actions: [
      { action: "bills.create", label: "Create bills" },
      { action: "bills.pay", label: "Pay bills" },
      { action: "vendors.manage", label: "Add and edit vendors" },
    ],
  },
  {
    area: "Finance",
    actions: [
      { action: "accounting.manage", label: "Manage accounting and budgets" },
      { action: "reports.create", label: "Build and save reports" },
    ],
  },
  {
    area: "People",
    actions: [
      { action: "people.invite", label: "Invite people" },
      { action: "people.manage", label: "Change roles, suspend and offboard" },
    ],
  },
  {
    area: "Company settings",
    actions: [
      { action: "settings.company", label: "Edit company details" },
      { action: "settings.billing", label: "Manage plan and billing" },
      { action: "settings.security", label: "Security and sign-in rules" },
      { action: "settings.developer", label: "API keys and webhooks" },
      { action: "settings.danger", label: "Close the account" },
    ],
  },
];

export const ALL_ACTIONS = ACTION_GROUPS.flatMap((g) => g.actions);

export interface CustomRole {
  id: string;
  name: string;
  actions: Action[];
}

export const useCustomRoles = create<{ roles: CustomRole[]; save: (r: CustomRole) => void; remove: (id: string) => void }>()(
  persist(
    (set) => ({
      roles: [],
      save: (r) => set((s) => ({ roles: s.roles.some((x) => x.id === r.id) ? s.roles.map((x) => (x.id === r.id ? r : x)) : [...s.roles, r] })),
      remove: (id) => set((s) => ({ roles: s.roles.filter((x) => x.id !== id) })),
    }),
    { name: "northpine-custom-roles" },
  ),
);

export function PeopleTabs({ active }: { active: string }) {
  return (
    <LinkTabs
      active={active}
      tabs={[
        { to: "/people", label: "Directory" },
        { to: "/people/departments", label: "Departments" },
        { to: "/people/roles", label: "Roles and permissions" },
      ]}
    />
  );
}

/** Departments as options, with the parent as a hint. */
export function departmentOptions(deps: Department[]) {
  return deps.map((d) => ({ value: d.id, label: d.name, hint: d.parentId ? `in ${deps.find((p) => p.id === d.parentId)?.name}` : undefined }));
}

/** True when `id` is `ancestor` or sits somewhere under it. */
export function isUnder(id: string, ancestor: string, deps: Map<string, Department>) {
  let d = deps.get(id);
  while (d) {
    if (d.id === ancestor) return true;
    d = d.parentId ? deps.get(d.parentId) : undefined;
  }
  return false;
}

export const STATUS_LABELS: Record<Employee["status"], string> = { active: "Active", invited: "Invited", suspended: "Suspended", offboarded: "Offboarded" };

export function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={role === "admin" ? "brand" : role === "finance" ? "info" : "neutral"}>{ROLE_LABELS[role]}</Badge>;
}

/** People who can own things: managers, approvers, recipients. Their title is the hint. */
export function usePeopleOptions(exclude?: string) {
  const employees = useCollection("employees");
  return useMemo(
    () => employees.filter((e) => e.status === "active" && e.id !== exclude).map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName}`, hint: e.title })),
    [employees, exclude],
  );
}

/** "Avery" from "avery.stone@x", for invited people who haven't told us their name yet. */
export function namesFromEmail(email: string) {
  const parts = email.split("@")[0].split(/[._-]+/).filter(Boolean);
  const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : "");
  return { firstName: cap(parts[0] ?? email), lastName: cap(parts.slice(1).join(" ")) };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Masks all but the last four digits of an SSN. */
export const maskedSsn = (ssn: string) => `•••-••-${ssn.slice(-4)}`;
