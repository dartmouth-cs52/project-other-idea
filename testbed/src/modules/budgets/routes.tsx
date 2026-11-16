import type { RouteObject } from "react-router";
import { BudgetDetailPage } from "./BudgetDetail";
import { BudgetNewPage } from "./BudgetNew";
import { BudgetsPage } from "./BudgetsPage";

export const routes: RouteObject[] = [
  { path: "budgets", element: <BudgetsPage /> },
  { path: "budgets/new", element: <BudgetNewPage /> },
  { path: "budgets/:id", element: <BudgetDetailPage /> },
];
