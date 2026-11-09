import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Layout, OrganizationLayout, SettingsLayout } from "./App";
import {
  Billing,
  defineStatusWidget,
  DeveloperSettings,
  GeneralSettings,
  OrganizationProfile,
  Overview,
  Profile,
  ProjectDetail,
  Projects,
  SecuritySettings,
  TeamSettings,
} from "./pages";
import "./styles.css";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "status-widget": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

defineStatusWidget();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="billing" element={<Billing />} />
          <Route path="profile" element={<Profile />} />
          <Route path="settings" element={<SettingsLayout />}>
            <Route index element={<GeneralSettings />} />
            <Route path="team" element={<TeamSettings />} />
            <Route path="organization" element={<OrganizationLayout />}>
              <Route index element={<OrganizationProfile />} />
              <Route path="developer" element={<DeveloperSettings />} />
              <Route path="security" element={<SecuritySettings />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
