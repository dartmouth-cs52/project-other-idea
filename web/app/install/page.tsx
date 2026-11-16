import type { Metadata } from "next";
import { Suspense } from "react";
import { InstallPage } from "@/components/app/install-page";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = { title: "Install Haptic", robots: { index: false, follow: false } };

export default function Install() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-12">
        <Suspense>
          <InstallPage />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
