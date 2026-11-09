import { Faq, FinalCta, Footer, Install, Questions } from "./_landing/Closing";
import { Demo } from "./_landing/Demo";
import { Hero, Nav } from "./_landing/Hero";
import { Heading } from "./_landing/primitives";
import { Features, Privacy, ShowDontTell, StackBand } from "./_landing/Sections";
import "./_landing/landing.css";

export default function Home() {
  return (
    <div className="landing min-h-screen">
      <Nav />
      <main>
        <Hero />
        <StackBand />
        <ShowDontTell />
        <section className="px-4 pb-24 sm:pb-32">
          <Heading eyebrow="See it work" sub="Pick a kind of app. Haptic takes the question, then points at each step as the user clicks through.">
            Built around how <em>your users</em> work.
          </Heading>
          <div className="mt-12">
            <Demo />
          </div>
        </section>
        <Features />
        <Privacy />
        <Questions />
        <Install />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
