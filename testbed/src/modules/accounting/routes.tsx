import type { RouteObject } from "react-router";
import { ChartPage } from "./ChartPage";
import { ClosePage } from "./ClosePage";
import { MappingsPage } from "./MappingsPage";
import { SyncPage } from "./SyncPage";

export const routes: RouteObject[] = [
  { path: "accounting", element: <ClosePage /> },
  { path: "accounting/chart", element: <ChartPage /> },
  { path: "accounting/sync", element: <SyncPage /> },
  { path: "accounting/mappings", element: <MappingsPage /> },
];
