import type { ReactNode } from "react";
import { AnyQuestionDemo, DocsDemo, PrivacyDemo } from "@/components/demo/feature-demos";

// Each card answers one question a buyer has, with a small live demo beside
// the claim. The claims describe the product as it works today.

export function Features() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-20 md:pt-32">
      <Feature
        title="Answers what people ask."
        description="No tours to script or maintain. Haptic reads the page as it is right now and points to the control that gets the job done."
      >
        <AnyQuestionDemo />
      </Feature>
      <Feature
        title="Knows your product."
        description="During setup, Haptic reads your site and your help docs, so its directions match how your product really works."
      >
        <DocsDemo />
      </Feature>
      <Feature
        title="Never reads what people type."
        description="Haptic reads the names of buttons and fields. What people type stays in the browser, unread. In Do it with me it reads back only its own typing, inside the browser, to check it took. Emails, long numbers and phone numbers are masked before anything is sent, except where the page shows the very one a person asked about."
      >
        <PrivacyDemo />
      </Feature>
    </section>
  );
}

/**
 * A card is the same surface everywhere on the site: Muted fill, hairline border, 14px corners.
 * The demo's white window sits straight on that fill, with no panel of its own behind it.
 */
function Feature({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <article className="grid items-center gap-6 rounded-xl border bg-muted p-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-4">
      <div className="px-2 pt-4 text-2xl leading-8 tracking-[-0.02em] lg:px-6 lg:py-6">
        <h3 className="font-medium">{title}</h3>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>
      <div>{children}</div>
    </article>
  );
}
