import type { RouteObject } from "react-router";
import { DepartmentsPage } from "./DepartmentsPage";
import { DirectoryPage } from "./DirectoryPage";
import { PersonPage } from "./PersonPage";
import { RolesPage } from "./RolesPage";

export const routes: RouteObject[] = [
  { path: "people", element: <DirectoryPage /> },
  { path: "people/departments", element: <DepartmentsPage /> },
  { path: "people/roles", element: <RolesPage /> },
  { path: "people/:id", element: <PersonPage /> },
];
