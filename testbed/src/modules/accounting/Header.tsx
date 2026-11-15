import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { LinkTabs, PageHeader } from "@/ui/display";

const TABS = [
  { to: "/accounting", label: "Month-end close" },
  { to: "/accounting/chart", label: "Chart of accounts" },
  { to: "/accounting/sync", label: "ERP sync" },
  { to: "/accounting/mappings", label: "Mappings" },
];

/** The Accounting title and its tabs, shared by every page in the area. */
export function AccountingHeader({ description, actions, meta }: { description: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  const { pathname } = useLocation();
  const active = TABS.find((t) => t.to === pathname.replace(/\/$/, ""))?.to ?? "/accounting";
  return <PageHeader title="Accounting" description={description} actions={actions} meta={meta} tabs={<LinkTabs tabs={TABS} active={active} />} />;
}
