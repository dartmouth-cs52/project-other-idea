import type { RouteObject } from "react-router";
import { NewReimbursementPage } from "./NewReimbursementPage";
import { ReimbursementDetailPage } from "./ReimbursementDetailPage";
import { ReimbursementsPage } from "./ReimbursementsPage";

export const routes: RouteObject[] = [
  { path: "reimbursements", element: <ReimbursementsPage /> },
  { path: "reimbursements/new", element: <NewReimbursementPage /> },
  { path: "reimbursements/:id", element: <ReimbursementDetailPage /> },
  { path: "reimbursements/:id/edit", element: <NewReimbursementPage /> },
];
