import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { routes as accounting } from "@/modules/accounting/routes";
import { routes as approvals } from "@/modules/approvals/routes";
import { publicRoutes as auth } from "@/modules/auth/routes";
import { routes as bills } from "@/modules/bills/routes";
import { routes as budgets } from "@/modules/budgets/routes";
import { routes as cards } from "@/modules/cards/routes";
import { routes as expenses } from "@/modules/expenses/routes";
import { routes as help } from "@/modules/help/routes";
import { routes as home } from "@/modules/home/routes";
import { routes as people } from "@/modules/people/routes";
import { routes as policies } from "@/modules/policies/routes";
import { routes as reimbursements } from "@/modules/reimbursements/routes";
import { routes as reports } from "@/modules/reports/routes";
import { routes as settings } from "@/modules/settings/routes";
import { NotFound } from "./NotFound";
import { Shell } from "./Shell";

// Each area of the app owns its routes in src/modules/<area>/routes.tsx.

const inShell: RouteObject[] = [
  ...home,
  ...cards,
  ...expenses,
  ...reimbursements,
  ...approvals,
  ...policies,
  ...bills,
  ...accounting,
  ...reports,
  ...budgets,
  ...people,
  ...settings,
  ...help,
  // Old addresses that redirect, like a real app that renamed pages.
  { path: "transactions", element: <Navigate to="/expenses" replace /> },
  { path: "expenses/review", element: <Navigate to="/expenses?review=needs_review" replace /> },
  { path: "team", element: <Navigate to="/people" replace /> },
  { path: "payables", element: <Navigate to="/bills" replace /> },
  { path: "*", element: <NotFound /> },
];

export const router = createBrowserRouter([
  ...auth,
  { path: "/", element: <Shell />, children: inShell },
]);
