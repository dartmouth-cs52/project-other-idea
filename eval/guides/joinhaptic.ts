import { any, button, DONE, type Guide, type GuideSet } from "../guide.ts";

// Haptic's own site, joinhaptic.com: a real public site with a navigation bar,
// an accordion, a footer, a sign-in page and a two-step form. The form and
// sign-in guides stop before the button that would send anything, so recording
// never submits the request, sends a sign-in link or opens Google.

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
    // The Pricing link in the top bar and the FAQ question both answer it, so either is right.
    // The recorder points at the first of them on the page, the Pricing link, so that is what it clicks:
    // clicking the FAQ question instead would record the next step as a wrong click.
    steps: [{ expect: [any("Pricing"), any("How much does it cost?")], act: { click: 'header a[href="/#pricing"]' } }, DONE],
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
    steps: [
      { expect: [any("Sign in")], act: { click: 'header a[href="/sign-in/"]' } },
      // Reaching the sign-in page is not logging in, so the guide goes on to either way in.
      // Recording stops here. No sign-in link is sent and Google is never opened.
      { expect: [button("Continue with Google"), any("Work email")] },
    ],
  },
  // The site has no blog, and nothing on it stands in for one, so the right answer points at nothing.
  // Paying and live chat are missing too, but are poor tests: Pricing says Haptic is free during early
  // access, and the email link in the footer is how to reach the team, so pointing at either is fair.
  { id: "no-such-feature", start: "/", goal: "Where is your blog?", steps: [DONE] },
];

// joinhaptic.com does not carry Haptic's tag yet, so the recorder adds the live
// widget script, as the tag would. Set this to true once the site's own tag is
// live, so that a page never has two. The recorder answers every step itself,
// so the model is never called.
export default { siteId: "site_joinhaptic", origin: "https://joinhaptic.com", hasTag: false, guides } satisfies GuideSet;
