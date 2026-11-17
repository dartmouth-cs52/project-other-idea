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
        If you ask us to email the install steps to your developer, we send them one email through Resend, from
        install@joinhaptic.com, with your email address so they can reply to you. Resend gets their address
        and the email, and nothing else. We do not keep their address. So that no address gets more than a few of
        these emails, and no one can keep trying to send them, we keep a scrambled form of it with the site, your company, who sent it and when, and delete
        that record once it is a day old, always within two days.
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
        Haptic does not send what people type into fields, or anything inside an area the page marks as one they
        write in, and it takes no pictures of the page. It looks at what fields hold only inside the browser, to leave
        it out wherever the page repeats it while it is there, in the page&apos;s text, headings, title, buttons, links
        and lists. The one exception is words a person also wrote in their question to Haptic. The question is sent as
        they wrote it, so where the page repeats those same words, as a list of search results does with a name they
        asked about, Haptic can read them. Three kinds of page can still show it typed words. A product may show what someone typed on a later
        page, such as in a confirmation, and Haptic reads it there. A page may write a search into an address, its own or a
        link&apos;s, which Haptic sends with ids and numbers masked. And some code editors draw what is typed as
        ordinary text beside a hidden field, which Haptic cannot tell from the rest of the page.
      </p>
      <p>
        Before anything leaves the browser, in what it reads, in the page&apos;s address and in the question itself,
        Haptic masks anything that looks like an email address, any run of five or more digits, such as an account or
        order number, and any eight or more digits written in groups with spaces, dashes, dots or brackets between
        them, such as a phone or card number. Digits that follow straight after a letter, like the model number I9100,
        count as part of that word, unless more of a number follows them, as in SSN123-45-6789: then the whole
        number is masked. Our server masks the same again before it stores anything.
      </p>
      <p>
        Haptic does not mask real dates written in figures, such as 07.03.1984 or 2026-11-16, with a month from 1 to
        12 and a day from 1 to 31. Digits written like a date that is not one, such as 12.34.5678, are masked.
        Questions like &ldquo;my latest invoice&rdquo; need dates, and a date says no more about a person than the
        names a page already shows.
        But a date on the page can be a date of birth, and it is read and sent like any other text. Nor does Haptic
        mask shorter numbers, such as prices and quantities, or names and other words, so text that shows on the page
        can still hold personal details.
      </p>
      <p>
        One exception: when someone writes an email address, or a number of five or more digits, in their question,
        that exact value is left readable wherever it stands on its own on the page, so Haptic can find the order or
        account they asked about. In the question itself it is left readable only when the page shows it standing on
        its own like that, and masked otherwise.
      </p>
      <p>
        With each question the widget also sends the person&apos;s date, as their device shows it, so the AI knows what
        day it is. It does not send their time zone or location.
      </p>
      <p>
        Haptic is an AI guide and can be wrong, so check anything that matters before relying on it. To work out the
        next step, the question, that description of the page and what has happened so far in the guide are sent to
        our server and to Anthropic, which provides the AI model.
      </p>
      <p>
        A company can turn on Do it with me, which is off unless it does. Then a person can ask Haptic to do the steps
        with them: it clicks, types and chooses on the page while they watch, and the final click is always theirs. It
        types only what the person wrote in their question. It never presses anything that saves, sends, pays or
        deletes, and never types passwords or payment details. To check that its own typing took, it reads that
        field&apos;s value inside the person&apos;s browser, and never sends it.
      </p>
      <p>
        We keep the question that was asked, what Haptic said, the names of the controls it pointed at and where on
        the page they sit, which page of the product each step was on, the product&apos;s web address, what was
        clicked along the way, what Haptic typed in Do it with me (only ever words from the question), when each step happened and how long it took, which AI model answered and what the step
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
        cleared when the tab closes. The random id stays in the browser until its storage for that product is cleared, and so
        does a note that you put the launcher away, if you did. That note is never sent to us.
      </p>

      <h2>Contact</h2>
      <p>
        Questions, or want your details removed. Write to <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>
    </LegalPage>
  );
}
