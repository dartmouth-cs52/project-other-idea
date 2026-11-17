import type { RouteObject } from "react-router";
import { HandbookPage } from "./HandbookPage";
import { PoliciesPage } from "./PoliciesPage";
import { RuleBuilderPage } from "./RuleBuilderPage";

export const routes: RouteObject[] = [
  { path: "policies", element: <PoliciesPage /> },
  { path: "policies/handbook", element: <HandbookPage /> },
  { path: "policies/new", element: <RuleBuilderPage /> },
  { path: "policies/:id", element: <RuleBuilderPage /> },
];
