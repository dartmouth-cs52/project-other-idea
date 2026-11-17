import type { Metadata } from "next";
import { Suspense } from "react";
import { SignIn } from "@/components/app/sign-in";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = { title: "Sign in", alternates: { canonical: "/sign-in/" } };

export default function SignInPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto grid grid-cols-1 w-full max-w-5xl items-start gap-10 px-6 py-12 sm:py-20 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-medium tracking-[-0.03em] text-balance">Sign in to Haptic.</h1>
          <p className="text-lg leading-7 text-muted-foreground">
            Haptic is in early access. Once your company is approved, sign in here to add your site and see what your users ask.
          </p>
        </div>
        <Suspense>
          <SignIn />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
