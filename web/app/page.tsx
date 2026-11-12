import Link from "next/link";
import { HeroDemo } from "@/components/demo/hero-demo";
import { Faq } from "@/components/faq";
import { Features } from "@/components/features";
import { Pointer } from "@/components/pointer";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { buttonVariants } from "@/components/ui/button";
import { accessHref } from "@/lib/site";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main>
        <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 pt-12 pb-12 text-center sm:pt-20 sm:pb-16">
          <h1 className="flex flex-wrap items-center justify-center gap-x-[0.2em] text-4xl font-medium tracking-[-0.04em] sm:text-6xl">
            Meet
            <Pointer bordered className="pointer-shadow size-[0.8em] text-pointer" />
            Haptic
          </h1>
          <p className="mt-6 max-w-xl text-lg text-balance text-muted-foreground">
            The AI guide that lives in your product. People say what they want to do, and Haptic points to exactly where
            to click, step by step.
          </p>
          <Link href={accessHref} className={buttonVariants({ size: "xl", className: "mt-8" })}>
            Request access
          </Link>
        </section>
        <HeroDemo />
        <Features />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
