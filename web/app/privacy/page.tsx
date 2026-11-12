import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated="November 12, 2026">
      <p>
        {site.company} makes Haptic. This page says what we collect on this website, and what Haptic reads when it runs
        inside a product.
      </p>

      <h2>This website</h2>
      <p>We do not use analytics, advertising or tracking cookies on this site.</p>
      <p>
        If you request access, we keep the email address and company name you give us so we can reply. We do not sell
        them or share them for marketing.
      </p>

      <h2>Haptic inside a product</h2>
      <p>
        When someone asks Haptic for help, it reads the page they are on. That means the names of buttons, links and
        fields, the page title, and short pieces of visible text.
      </p>
      <p>
        Haptic never reads what people type into fields. It masks emails, phone numbers and long numbers in what it
        reads before anything leaves the browser.
      </p>
      <p>
        To work out the next step, the question and that description of the page are sent to our server and to
        Anthropic, which provides the AI model. Our server does not save them. It logs only which site asked, the step
        number and how long the answer took.
      </p>
      <p>Progress through a guide is kept in the browser for that tab, and is cleared when the tab closes.</p>

      <h2>Contact</h2>
      <p>
        Questions, or want your details removed. Write to <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>
    </LegalPage>
  );
}
