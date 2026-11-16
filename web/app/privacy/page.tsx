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
        Sign in is run for us by Neon. The sign in email is sent for us by Resend, which gets your email address
        and the link, and nothing else. If you choose to sign in with Google, Google tells us your name and email
        address.
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
        To work out the next step, the question and that description of the page are sent to our server and to
        Anthropic, which provides the AI model.
      </p>
      <p>
        Our server keeps a record of each guide for the company whose product it is, so they can see what people ask
        and where a guide fell short. The record holds the question, the page it was asked on, the name of each
        control Haptic pointed at and what it said, any click on something else, how the guide ended, whether the
        person said it helped, and how long each step took. Emails, phone numbers and long numbers are masked first.
        The description of the page is not kept, and the record does not say who asked. It is stored in a database
        run for us by Neon.
      </p>
      <p>Progress through a guide is kept in the browser for that tab, and is cleared when the tab closes.</p>

      <h2>Contact</h2>
      <p>
        Questions, or want your details removed. Write to <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>
    </LegalPage>
  );
}
