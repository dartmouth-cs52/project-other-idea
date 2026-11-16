export const site = {
  name: "Haptic",
  company: "Haptic Labs",
  url: "https://joinhaptic.com",
  email: "hello@joinhaptic.com",
  tagline: "The AI guide that lives in your product.",
  /** The line under the picture when a link to the site is shared, and the end of the browser tab title. */
  headline: "The AI guide that lives in your product",
  /**
   * The lines under the title in a search result or a shared link. It does not repeat the
   * headline, which sits right above it, and it stays under 155 characters so it is not cut off.
   */
  description:
    "In-app guidance for your web app. People say what they want to do, and Haptic points to exactly where to click, step by step, on the live page.",
} as const;

export const accessHref = "/request-access/";

/** Where the request access form posts. The handler is added when the site is deployed. */
export const accessEndpoint = process.env.NEXT_PUBLIC_ACCESS_ENDPOINT ?? "/api/request-access";

/**
 * What Haptic costs. The pricing section is drawn from this, so a price is
 * changed here and nowhere else. Billing is not built yet: these are the
 * plans it will have to match.
 *
 * The unit is a finished guide. `includedGuides` is how many a month the plan
 * covers and `overageUsd` is the price of each one after that. A plan with no
 * monthly price is agreed case by case.
 */
export const pricing = {
  lead: "You pay for guides that finish. If someone stops, gets lost, or Haptic cannot find the way, that guide is free.",
  plans: [
    {
      id: "early-access",
      name: "Early access",
      monthlyUsd: 0,
      includedGuides: 1000,
      overageUsd: null,
      detail: "For the first companies in, while we set Haptic up with you.",
    },
    {
      id: "team",
      name: "Team",
      monthlyUsd: 149,
      includedGuides: 1000,
      overageUsd: 0.12,
      detail: "For one product.",
    },
    {
      id: "scale",
      name: "Scale",
      monthlyUsd: 499,
      includedGuides: 5000,
      overageUsd: 0.08,
      detail: "For several products, with staging sites.",
    },
    {
      id: "enterprise",
      name: "Enterprise",
      monthlyUsd: null,
      includedGuides: null,
      overageUsd: null,
      detail: "For larger rollouts.",
    },
  ],
} as const;

export const faqs = [
  {
    q: "How is Haptic different from a chatbot or a product tour?",
    a: "A chatbot answers in text and leaves people to find the button themselves. A product tour plays the same fixed steps for everyone. Haptic works on the live page. It reads what is on screen, points to the next control, waits for the click, then carries on, across menus and pages.",
  },
  {
    q: "How do I add Haptic to my product?",
    a: "Once your company has access, sign in, paste your site's address, and add one script tag. While you set up, Haptic reads your public pages to learn what your product calls things. On pages behind your login it reads the screen live, as your user sees it.",
  },
  {
    q: "Does Haptic click things for my users?",
    a: "Not unless you turn it on. By default Haptic points and explains, and the person does the clicking, so they stay in control and learn where things are. With Do it with me turned on, a person can ask Haptic to do the steps while they watch, and the final click is always theirs. It never presses anything that saves, sends, pays or deletes, and never types passwords or payment details.",
  },
  {
    q: "Does it work in apps behind a login?",
    a: "Yes. Haptic runs in the browser on the page your user is looking at, so it works on signed in pages and on pages built with JavaScript. It also follows people from one page to the next.",
  },
  {
    q: "What does Haptic see on the page?",
    a: "The names of buttons, links and fields, plus short pieces of visible text, so it knows what to point at. It never reads what people type into fields. Before anything leaves the browser it masks anything that looks like an email address, any run of five or more digits, and any eight or more digits written in groups, like a phone or card number. It does not mask real dates written in figures, shorter numbers like prices, or names, so text on the page can still hold personal details. One exception: an email address or a number of five or more digits that a person writes in their own question stays readable where exactly that value stands on its own on the page, so Haptic can find what they asked about. In the question itself it stays readable only when the page shows it that way, and is masked otherwise. Each question also carries the person's date, not their time zone or location, so Haptic knows what day it is. In Do it with me, Haptic checks that its own typing took by reading that field inside the browser, and never sends what it reads.",
  },
  {
    q: "How much does it cost?",
    a: "Haptic is free during early access. After that, plans start at $149 a month, and you pay only for guides that finish. The pricing section above has the details.",
  },
  {
    q: "Is Haptic ready for enterprise?",
    a: "Not yet. Haptic is early, and we would rather say so than overpromise. If you have security or compliance needs, tell us and we will be clear about what we support today.",
  },
] as const;

/** The widget's script, as it goes in every customer's tag. It must never change. */
export const widgetScriptUrl = `${(process.env.NEXT_PUBLIC_WIDGET_URL ?? "https://widget.joinhaptic.com").replace(/\/$/, "")}/widget.js`;

/**
 * This site's own id on the widget server, so people can try Haptic here. Its context
 * is built from haptic-notes.md (see README.md, "Haptic on this site"). Set
 * NEXT_PUBLIC_HAPTIC_SITE to another id to try a local server, or to nothing to leave it off.
 */
export const hapticSiteId = process.env.NEXT_PUBLIC_HAPTIC_SITE ?? "site_joinhaptic";

export const signInHref = "/sign-in/";
