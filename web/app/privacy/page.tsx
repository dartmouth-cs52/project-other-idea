import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy", alternates: { canonical: "/privacy/" } };

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated="November 16, 2026">
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
      <p>
        Haptic runs on this website too, so you can try it. If you ask it something here, it works as the next part
        of this page describes, and we are the company that sees your questions.
      </p>

      <h2>Haptic inside a product</h2>
      <p>
        When someone asks Haptic for help, it reads the page they are on. That means the names of buttons, links and
        fields, where each link leads, whether a box is ticked or a section is open, which option is chosen in lists
        and menus the page draws itself, the page title and headings, the page&apos;s address within the product, and
        short pieces of visible text. While it is guiding someone it also notes which control they used and what
        changed on the page.
      </p>
      <p>
        Haptic does not read what people type into fields, or anything inside an area the page marks as one they
        write in, and it takes no pictures of the page. Two kinds of page can still show it typed words. A product may
        show what someone typed somewhere else, such as in a preview, a confirmation or the page title, and Haptic
        reads it there. And some code editors draw what is typed as ordinary text beside a hidden field, which Haptic
        cannot tell from the rest of the page.
      </p>
      <p>
        In what it reads, in the page&apos;s address and in the question itself, Haptic masks most email addresses,
        phone numbers and long numbers before anything leaves the browser. It does not mask names or other words, so
        text that shows on the page can still hold personal details.
      </p>
      <p>
        Haptic is an AI guide and can be wrong, so check anything that matters before relying on it. To work out the
        next step, the question, that description of the page and what has happened so far in the guide are sent to
        our server and to Anthropic, which provides the AI model.
      </p>
      <p>
        We keep the question that was asked, what Haptic said, the names of the controls it pointed at and where on
        the page they sit, which page of the product each step was on, the product&apos;s web address, what was
        clicked along the way, when each step happened and how long it took, which AI model answered and what the step
        cost, how the guide ended, and whether the person said it helped. The company whose product it is can see the
        questions, the steps and their timings in its Haptic dashboard, so it can tell what people ask and where a
        guide fell short. We do not keep the rest of the description of the page. This record is stored in a database
        run for us by Neon.
      </p>
      <p>
        With each question we also keep a scrambled form of the random id described below, so the company can see how
        many different people asked something, and one person asking ten times counts once. It is made differently for
        each product, cannot be turned back into the id, and says nothing about who the person is. It does let the
        company see that two questions came from the same browser.
      </p>
      <p>
        Haptic does not ask who a visitor is. But a name that shows on the page, in its address or on a control can
        be in what we keep, along with the time of each step, so the company may be able to tell who asked.
      </p>
      <p>
        To learn the product as it is used, and not only from its public pages, Haptic also sends an outline of each
        page of the product it loads on, once per page in each browser tab, whether or not anyone asks it anything.
        The outline is the page&apos;s title and headings, the names of its links and buttons, and where each link
        leads. When a click leads straight to another page, it also sends the name of what was clicked and where it
        led. When someone opens a menu, a tab or a section that unfolds, it sends the names of what appeared, with the
        name of what opened it. Nothing a text box suggests is sent. It never includes what people type, what is inside a table&apos;s cells, or the rest of the text on the
        page. A name that holds anything that looks like an email address, a phone number or a long number is left
        out whole.
      </p>
      <p>
        To count how many different people have seen a name, or asked a question, the browser keeps a random id for
        that product, made by Haptic and tied to nothing else. Our server keeps only a scrambled form of it, made differently for each
        product, and at most ten of those for each name. A name is used to guide anyone only once several different
        people have seen it, so a name that only one person sees, like the title of their own document, is never
        used. The names, with when each was first and last seen and how often, are kept until the company asks us to
        delete them. The company can switch this off.
      </p>
      <p>
        From a visit where nobody asks Haptic anything, we keep nothing else about the visitor. For each web address
        the script loads on, we keep when it was first and last seen there and a rough count.
      </p>
      <p>
        Our server uses a visitor&apos;s network address to limit how fast they can ask. Where a company also limits
        how much each visitor can ask in a day, a scrambled form of the address is kept with that day&apos;s count, by
        Cloudflare, which runs our server. It is scrambled with a random value made for that day, and both are cleared
        when the day ends. The address is not kept with their questions.
      </p>
      <p>
        When Haptic cannot help, it may offer a way to reach the company. If you use its form, the email address and
        note you type are passed to that company with the conversation so far, as you typed it, so that a person
        there can reply. We do not keep the email address or the note. The company can tell which guide in its
        dashboard the message came from.
      </p>
      <p>
        We keep the record of each guide until the company asks us to delete it. Nothing deletes it on a schedule yet:
        a person at {site.company} does it on request. We do not use it to train AI models.
      </p>
      <p>
        Progress through a guide, and which pages have been outlined, is kept in the browser for that tab, and is
        cleared when the tab closes. The random id stays in the browser until its storage for that product is cleared.
      </p>

      <h2>Contact</h2>
      <p>
        Questions, or want your details removed. Write to <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>
    </LegalPage>
  );
}
