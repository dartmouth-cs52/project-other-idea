import type { Metadata } from "next";
import { HeroDemo } from "@/components/demo/hero-demo";
import { Faq } from "@/components/faq";
import { Features } from "@/components/features";
import { Pointer } from "@/components/pointer";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { site } from "@/lib/site";

export const metadata: Metadata = { alternates: { canonical: "/" } };

/** Tells search engines the site's name, so a result is headed "Haptic" and not the bare address. */
const siteName = { "@context": "https://schema.org", "@type": "WebSite", name: site.name, url: `${site.url}/` };

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteName).replace(/</g, "\\u003c") }} />
      <SiteNav />
      <main>
        <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 py-12 text-center">
          <h1 className="flex flex-wrap items-center justify-center gap-x-[0.2em] text-4xl font-medium tracking-[-0.04em] sm:text-6xl">
            Meet
            <Pointer bordered className="pointer-shadow size-[0.8em] text-pointer" />
            Haptic
          </h1>
          <p className="mt-6 max-w-xl text-lg text-balance text-muted-foreground">
            The AI guide that lives in your product. People say what they want to do, and Haptic points to exactly where
            to click, step by step.
          </p>
        </section>
        <HeroDemo />
        <Features />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
