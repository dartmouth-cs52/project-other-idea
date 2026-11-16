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
    // The FAQ answer and the Pricing link in the top bar both get there.
    steps: [{ expect: [any("How much does it cost?"), any("Pricing")], act: { click: 'button:has-text("How much does it cost?")' } }, DONE],
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
  },
  {
    id: "privacy",
    start: "/",
    goal: "Where is your privacy policy?",
    steps: [{ expect: [any("Privacy")], act: { click: 'footer a[href="/privacy/"]' } }, DONE],
  },
  {
    id: "terms",
    start: "/privacy/",
    goal: "terms of service",
    steps: [{ expect: [any("Terms")], act: { click: 'footer a[href="/terms/"]' } }, DONE],
  },
  {
    id: "sign-in",
    start: "/",
    goal: "How do I log in to my account?",
    steps: [{ expect: [any("Sign in")], act: { click: 'header a[href="/sign-in/"]' } }, DONE],
  },
  // Sign in is by an emailed link or Google, so there is no password to change, and the right answer points at nothing.
  { id: "no-such-feature", start: "/", goal: "How do I change my password?", steps: [DONE] },
];

// The site has its own tag now (web/components/haptic-tag.tsx), so recording uses
// the live widget script instead of adding a second. The recorder still answers
// every step itself, so the model is never called.
export default { siteId: "site_joinhaptic", origin: "https://joinhaptic.com", hasTag: true, guides } satisfies GuideSet;
