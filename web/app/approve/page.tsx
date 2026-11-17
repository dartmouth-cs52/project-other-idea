import type { Metadata } from "next";
import { Suspense } from "react";
import { ApproveView } from "@/components/app/approve-view";
import { TopBar } from "@/components/app/shell";

export const metadata: Metadata = { title: "Approve access", robots: { index: false, follow: false } };

export default function ApprovePage() {
  return (
    <>
      <TopBar />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-12">
        <Suspense>
          <ApproveView />
        </Suspense>
      </main>
    </>
  );
}
