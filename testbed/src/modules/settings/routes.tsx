import { Navigate, type RouteObject } from "react-router";
import { AuditPage } from "./AuditPage";
import { BillingPage } from "./BillingPage";
import { CompanyPage } from "./CompanyPage";
import { DangerPage } from "./DangerPage";
import { DeveloperPage } from "./DeveloperPage";
import { EntitiesPage } from "./EntitiesPage";
import { IntegrationsPage } from "./IntegrationsPage";
import { NotificationsPage } from "./NotificationsPage";
import { ProfilePage } from "./ProfilePage";
import { SecurityPage } from "./SecurityPage";
import { SettingsLayout } from "./SettingsLayout";

export const routes: RouteObject[] = [
  {
    path: "settings",
    element: <SettingsLayout />,
    children: [
      // /settings has no page of its own and redirects.
      { index: true, element: <Navigate to="/settings/company" replace /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "notifications", element: <NotificationsPage /> },
      { path: "company", element: <CompanyPage /> },
      { path: "entities", element: <EntitiesPage /> },
      { path: "billing", element: <BillingPage /> },
      { path: "security", element: <SecurityPage /> },
      { path: "integrations", element: <IntegrationsPage /> },
      { path: "developer", element: <DeveloperPage /> },
      { path: "developers", element: <Navigate to="/settings/developer" replace /> },
      { path: "audit", element: <AuditPage /> },
      { path: "danger", element: <DangerPage /> },
      { path: "*", element: <Navigate to="/settings/company" replace /> },
    ],
  },
];
