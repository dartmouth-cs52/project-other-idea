import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

/** Shared frame for the plain text pages. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-5xl px-6 py-12 sm:py-20">
        <article className="max-w-2xl">
          <h1 className="text-4xl font-medium tracking-[-0.03em]">{title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated {updated}</p>
          <div className="mt-10 flex flex-col gap-4 text-base leading-7 [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-medium [&_p]:text-muted-foreground">
            {children}
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
