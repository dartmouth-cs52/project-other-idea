import { any, button, DONE, type Guide, type GuideSet } from "../guide.ts";

// Haptic's own site, joinhaptic.com: a real public site with a navigation bar,
// an accordion, a footer and a two-step form. The form guide stops at the
// button that sends the request, so recording never submits it.

const guides: Guide[] = [
  {
    id: "request-access",
    start: "/",
    goal: "How do I request access?",
    steps: [
      { expect: [any("Request access")], act: { click: 'header a[href="/request-access/"]' } },
      { expect: [any("Work email")], act: { fill: ["#access-email", "sam@example.com"] }, say: "Type your work email." },
      { expect: [any("Company")], act: { fill: ["#access-company", "Example Inc"] }, say: "Type your company's name." },
      { expect: [button("Continue")], act: { click: 'form button[type="submit"]' } },
      { expect: [any("First name")], act: { fill: ["#access-first-name", "Sam"] }, say: "Type your first name." },
      { expect: [any("Last name")], act: { fill: ["#access-last-name", "Okafor"] }, say: "Type your last name." },
      // Recording stops here. The request is never sent.
      { expect: [button("Request access"), any("Additional details")] },
    ],
  },
  {
    id: "pricing",
    start: "/",
    goal: "How much does it cost?",
    steps: [{ expect: [any("How much does it cost?")], act: { click: 'button:has-text("How much does it cost?")' } }, DONE],
    reached: { selector: 'button[aria-expanded="true"]:has-text("How much does it cost?")' },
  },
  {
    id: "what-it-reads",
    start: "/request-access/",
    goal: "What does Haptic see on my page?",
    steps: [
      { expect: [any("FAQ")], act: { click: 'header a[href="/#faq"]' } },
      { expect: [any("What does Haptic see on the page?")], act: { click: 'button:has-text("What does Haptic see on the page?")' } },
      DONE,
    ],
    reached: { selector: 'button[aria-expanded="true"]:has-text("What does Haptic see on the page?")' },
  },
  {
    id: "privacy",
    start: "/",
    goal: "Where is your privacy policy?",
    steps: [{ expect: [any("Privacy")], act: { click: 'footer a[href="/privacy/"]' } }, DONE],
    reached: { url: "/privacy/?$" },
  },
  {
    id: "terms",
    start: "/privacy/",
    goal: "terms of service",
    steps: [{ expect: [any("Terms")], act: { click: 'footer a[href="/terms/"]' } }, DONE],
    reached: { url: "/terms/?$" },
  },
  // The site has no sign-in, so the right answer points at nothing.
  { id: "no-such-feature", start: "/", goal: "How do I log in to my account?", steps: [DONE] },
];

export default {
  siteId: "site_joinhaptic",
  origin: "https://joinhaptic.com",
  hasTag: false,
  about: "Haptic's own public site: a simple marketing page with an accordion and a two-step form.",
  guides,
} satisfies GuideSet;
