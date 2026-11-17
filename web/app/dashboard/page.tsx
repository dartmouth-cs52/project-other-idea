import type { Metadata } from "next";
import { Suspense } from "react";
import { Dashboard } from "@/components/app/dashboard";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false, follow: false } };

export default function DashboardPage() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
