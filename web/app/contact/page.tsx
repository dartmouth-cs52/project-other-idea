import { Suspense } from "react";
import type { Metadata } from "next";
import { ContactForm, ContactFormFallback } from "@/components/contact-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = { title: "Request access" };

export default function Contact() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto grid w-full max-w-5xl items-start gap-10 px-6 py-12 sm:py-20 md:grid-cols-2">
        <div className="flex flex-col gap-8">
          <h1 className="text-4xl font-medium tracking-[-0.03em] text-balance">The AI guide that lives in your product.</h1>
          <div className="flex flex-col gap-4 rounded-2xl border bg-muted p-6 text-base leading-7">
            <p>
              Most help lives in docs and chat windows, away from the screen where people get stuck. Haptic works on the
              page itself. It points to the next control, waits for the click, then carries on until the job is done.
            </p>
            <p>Haptic is in early access. Tell us about your product and we will be in touch.</p>
          </div>
        </div>
        <Suspense fallback={<ContactFormFallback />}>
          <ContactForm />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
