import {
  BarChart3,
  BookOpen,
  Building2,
  CheckSquare,
  CreditCard,
  FileText,
  Home,
  Landmark,
  LifeBuoy,
  PiggyBank,
  Receipt,
  ScrollText,
  Settings,
  Store,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { NavVariant } from "@/lab/lab";

// The sidebar. The "renamed" variant swaps some labels for synonyms real apps
// use, so a guide that learned "Expenses" has to find "Spend".

export interface NavItem {
  to: string;
  label: string;
  renamed?: string;
  icon: LucideIcon;
  /** Key into the badge counts the shell computes. */
  badge?: "approvals" | "receipts";
  /** Keyboard shortcut after pressing g. */
  key?: string;
  /** Opens with a full page load instead of client-side routing. */
  reload?: boolean;
}

export interface NavGroup {
  label: string;
  renamed?: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "",
    items: [{ to: "/", label: "Home", icon: Home, key: "h" }],
  },
  {
    label: "Spending",
    items: [
      { to: "/cards", label: "Cards", icon: CreditCard, key: "c" },
      { to: "/expenses", label: "Expenses", renamed: "Spend", icon: Receipt, badge: "receipts", key: "e" },
      { to: "/reimbursements", label: "Reimbursements", renamed: "Out of pocket", icon: Wallet, key: "r" },
      { to: "/approvals", label: "Approvals", renamed: "Inbox", icon: CheckSquare, badge: "approvals", key: "a" },
    ],
  },
  {
    label: "Bill pay",
    renamed: "Payables",
    items: [
      { to: "/bills", label: "Bills", renamed: "Payables", icon: FileText, key: "b" },
      { to: "/bills/vendors", label: "Vendors", renamed: "Suppliers", icon: Store, key: "v" },
    ],
  },
  {
    label: "Finance",
    items: [
      { to: "/accounting", label: "Accounting", renamed: "Ledger", icon: Landmark, key: "l" },
      { to: "/reports", label: "Reports", renamed: "Insights", icon: BarChart3, key: "i" },
      { to: "/budgets", label: "Budgets", icon: PiggyBank },
      { to: "/policies", label: "Policies", renamed: "Rules", icon: ScrollText },
    ],
  },
  {
    label: "Company",
    renamed: "Organization",
    items: [
      { to: "/people", label: "People", renamed: "Team", icon: Users, key: "p" },
      { to: "/settings", label: "Settings", icon: Settings, key: "s" },
    ],
  },
];

export const NAV_FOOTER: NavItem[] = [
  { to: "/help", label: "Help center", icon: LifeBuoy, reload: true },
  { to: "/settings/developer", label: "API docs", icon: BookOpen },
];

export const ENTITY_ICON = Building2;

export function navLabel(item: { label: string; renamed?: string }, variant: NavVariant) {
  return variant === "renamed" && item.renamed ? item.renamed : item.label;
}

export const ALL_NAV_ITEMS = NAV.flatMap((g) => g.items);
