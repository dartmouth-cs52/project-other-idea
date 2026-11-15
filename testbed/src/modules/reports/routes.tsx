import type { RouteObject } from "react-router";
import { ReportBuilderPage } from "./ReportBuilder";
import { ReportsPage } from "./ReportsPage";

export const routes: RouteObject[] = [
  { path: "reports", element: <ReportsPage /> },
  { path: "reports/new", element: <ReportBuilderPage /> },
  { path: "reports/:id", element: <ReportBuilderPage /> },
];
