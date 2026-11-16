import type { RouteObject } from "react-router";
import { ExpenseDetailPage } from "./ExpenseDetailPage";
import { ExpensesPage } from "./ExpensesPage";

export const routes: RouteObject[] = [
  { path: "expenses", element: <ExpensesPage /> },
  { path: "expenses/:id", element: <ExpenseDetailPage /> },
];
