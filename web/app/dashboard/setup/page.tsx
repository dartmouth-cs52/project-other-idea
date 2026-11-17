import type { Metadata } from "next";
import { Suspense } from "react";
import { SetupFlow } from "@/components/app/setup/setup-flow";

export const metadata: Metadata = { title: "Add your app", robots: { index: false, follow: false } };

export default function SetupPage() {
  return (
    <Suspense>
      <SetupFlow />
    </Suspense>
  );
}
