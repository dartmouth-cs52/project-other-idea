import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy", alternates: { canonical: "/privacy/" } };

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated="November 15, 2026">
      <p>
        {site.company} makes Haptic. This page says what we collect on this website, and what Haptic reads when it runs
        inside a product.
      </p>

      <h2>This website</h2>
      <p>We do not use analytics, advertising or tracking cookies on this site.</p>
      <p>
        If you request access, we keep what you put in the form so we can reply. That is your name, work email and
        company, and anything you add about your product. A copy is emailed to our team. We do not sell these details
        or share them for marketing.
      </p>
      <p>
        If you sign in, we keep your email address, your name if you give one, and the company you belong to, so you
        can reach your dashboard. Signing in sets cookies that keep you signed in, and they are used for nothing else.
        Sign in is run for us by Neon, which also sends the sign in email. If you choose to sign in with Google,
        Google tells us your name and email address.
      </p>
      <p>
        When you add a site, we read its public pages the way a visitor would, to learn what your product calls
        things. We do not sign in to anything and we do not send forms.
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
        Haptic is an AI guide and can be wrong, so check anything that matters before relying on it. To work out the
        next step, the question and that description of the page are sent to our server and to Anthropic, which
        provides the AI model.
      </p>
      <p>
        We keep the question that was asked, what Haptic said and the names of the controls it pointed at, which page
        of the product each step was on, what was clicked along the way, how the guide ended, and whether the person
        said it helped. Emails, phone numbers and long numbers are masked first. The company whose product it is can
        see these in its Haptic dashboard. We do not keep the description of the page, anything typed into the page,
        or pictures of the page.
      </p>
      <p>
        From visits where nobody asks Haptic anything, we keep only a count of how often it loaded on each site. To
        limit how much one visitor can ask, our server uses their network address. It is not kept with their
        questions.
      </p>
      <p>
        We keep this for as long as the company uses Haptic, and delete it when the company asks. Nothing in it says
        who asked, unless they put that in their question. We do not use it to train AI models.
      </p>
      <p>Progress through a guide is kept in the browser for that tab, and is cleared when the tab closes.</p>

      <h2>Contact</h2>
      <p>
        Questions, or want your details removed. Write to <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>
    </LegalPage>
  );
}
