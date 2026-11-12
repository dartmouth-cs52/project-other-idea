import type { ReactNode } from "react";
import { AnyQuestionDemo, DocsDemo, PrivacyDemo } from "@/components/demo/feature-demos";

// Each card answers one question a buyer has, with a small live demo beside
// the claim. The claims describe the product as it works today.

export function Features() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-20 md:pt-32">
      <Feature
        title="Answers the question in front of it."
        description="No tours to script or maintain. Haptic reads the page as it is right now and points to the control that gets the job done."
      >
        <AnyQuestionDemo />
      </Feature>
      <Feature
        title="Knows your product from day one."
        description="During setup, Haptic reads your site and your help docs. Its directions match how your product really works, down to the details only your docs mention."
      >
        <DocsDemo />
      </Feature>
      <Feature
        title="Sees labels, never what people type."
        description="Haptic reads the names of buttons and fields. What people type stays in the browser, and emails and long numbers are masked before anything is sent."
      >
        <PrivacyDemo />
      </Feature>
    </section>
  );
}

function Feature({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <article className="grid items-center gap-6 rounded-3xl bg-muted p-4 md:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] md:gap-4 md:p-4">
      <div className="px-2 pt-4 text-2xl leading-8 tracking-[-0.02em] md:px-6 md:py-6">
        <h3 className="font-medium text-balance">{title}</h3>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-2xl bg-secondary p-4 sm:p-6">{children}</div>
    </article>
  );
}
