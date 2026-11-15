import type { RouteObject } from "react-router";
import { ApprovalDetailPage } from "./ApprovalDetailPage";
import { ApprovalsPage } from "./ApprovalsPage";

export const routes: RouteObject[] = [
  { path: "approvals", element: <ApprovalsPage /> },
  { path: "approvals/:id", element: <ApprovalDetailPage /> },
];
