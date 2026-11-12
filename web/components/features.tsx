import Image from "next/image";
import type { ReactNode } from "react";
import { AnyQuestionDemo, DocsDemo, PrivacyDemo } from "@/components/demo/feature-demos";

// Each card answers one question a buyer has, with a small live demo beside
// the claim. The claims describe the product as it works today.

/**
 * A public domain painting that sits behind a demo. The three are hazy,
 * low-colour landscapes, each close to one colour, from the Art Institute of
 * Chicago's open access collection (CC0). `position` picks the part of the
 * picture that shows.
 */
interface Art {
  src: string;
  position: string;
}

const ART = {
  /** Martin Johnson Heade, York Harbor, Coast of Maine, 1877. */
  harbor: { src: "/art/heade-york-harbor.webp", position: "30% 40%" },
  /** George Inness, The Home of the Heron, 1893. */
  heron: { src: "/art/inness-home-of-the-heron.webp", position: "50% 35%" },
  /** James McNeill Whistler, Nocturne: Blue and Gold, Southampton Water, 1872. */
  nocturne: { src: "/art/whistler-nocturne.webp", position: "50% 45%" },
} satisfies Record<string, Art>;

export function Features() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-20 md:pt-32">
      <Feature
        title="Answers what people ask."
        description="No tours to script or maintain. Haptic reads the page as it is right now and points to the control that gets the job done."
        art={ART.harbor}
      >
        <AnyQuestionDemo />
      </Feature>
      <Feature
        title="Knows your product."
        description="During setup, Haptic reads your site and your help docs, so its directions match how your product really works."
        art={ART.heron}
      >
        <DocsDemo />
      </Feature>
      <Feature
        title="Never reads what people type."
        description="Haptic reads the names of buttons and fields. What people type stays in the browser, and emails and long numbers are masked before anything is sent."
        art={ART.nocturne}
      >
        <PrivacyDemo />
      </Feature>
    </section>
  );
}

/**
 * A card is the same surface everywhere on the site: Muted fill, hairline border, 14px corners.
 * The demo sits on a painting, toned down so the pointer stays the only strong colour.
 */
function Feature({ title, description, art, children }: { title: string; description: string; art: Art; children: ReactNode }) {
  return (
    <article className="grid items-center gap-6 rounded-xl border bg-muted p-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-4">
      <div className="px-2 pt-4 text-2xl leading-8 tracking-[-0.02em] lg:px-6 lg:py-6">
        <h3 className="font-medium">{title}</h3>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>
      <div data-art-panel className="relative overflow-hidden rounded-lg bg-secondary p-4 sm:p-8">
        <Image
          src={art.src}
          alt=""
          fill
          sizes="(min-width: 1024px) 560px, 100vw"
          draggable={false}
          data-art
          className="pointer-events-none object-cover opacity-80 saturate-[.6] select-none"
          style={{ objectPosition: art.position }}
        />
        <div className="relative">{children}</div>
      </div>
    </article>
  );
}
