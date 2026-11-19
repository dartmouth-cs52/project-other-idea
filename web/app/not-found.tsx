import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

/**
 * What an address that isn't on the site shows, in the site's own frame, with the way back home. The export writes
 * it to out/404.html, which the Worker serves with status 404 for any address it has no file for. The way home is a
 * secondary button, since Request access in the bar is the one primary button on every page.
 */
export default function NotFound() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto flex w-full max-w-5xl flex-col items-start gap-6 px-6 py-12 sm:py-20">
        <h1 className="text-4xl font-medium tracking-[-0.03em] text-balance">Page not found.</h1>
        <p className="max-w-[65ch] text-lg leading-7 text-muted-foreground">The address may be mistyped, or the page has moved.</p>
        <Link href="/" className={buttonVariants({ variant: "secondary", size: "xl" })}>
          Go to the home page
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
