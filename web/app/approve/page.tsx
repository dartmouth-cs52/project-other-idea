import type { Metadata } from "next";
import { Suspense } from "react";
import { ApproveView } from "@/components/app/approve-view";
import { AppNav } from "@/components/app/parts";

export const metadata: Metadata = { title: "Approve access", robots: { index: false, follow: false } };

export default function ApprovePage() {
  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-12">
        <Suspense>
          <ApproveView />
        </Suspense>
      </main>
    </>
  );
}
