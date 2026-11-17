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
  // The FAQ's own answer, and an answer in words that says what it says: free in early access, then from the price of
  // the first paid plan. Both are read from the pricing section's first two plans when the guide starts ("Early
  // access", "Free", "$149 a month"), so a change of price changes the test with it. Naming the other plans as well is
  // right too, and is not needed. "Not free" is the right words the wrong way round.
  {
    id: "pricing",
    start: "/",
    goal: "How much does it cost?",
    // The Pricing link in the top bar and the FAQ's question both get there, so a reply pointing at either is right.
    // The recorder points at the first of them on the page, the Pricing link, so that is what it clicks.
    steps: [{ expect: [any("Pricing"), any("How much does it cost?")], act: { click: 'header a[href="/#pricing"]' } }, DONE],
    reached: [{ url: "#pricing$" }, { selector: 'button[aria-expanded="true"]:has-text("How much does it cost?")' }],
    says: {
      shown: { selector: "#pricing li:nth-child(1) > h3, #pricing li:nth-child(-n+2) > h3 + p", when: "start" },
      not: ["\\b(isn't|is not|not|never)\\s+free\\b"],
    },
  },
  // The answer is in the FAQ on the home page, and in words on the home page itself: "Haptic reads the names of
  // buttons and fields. What people type stays in the browser". An answer in words names what the home page says it
  // reads, read from there when the guide starts, and says that it never reads what people type. Pointing to where
  // the answer is, without saying it, is neither.
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
    says: {
      shown: { selector: 'article h3:has-text("Never reads what people type") + p', part: "(?<=\\bnames of )[^.]+", anyOrder: true, when: "start", from: "/" },
      all: ["\\b(never|not|doesn't|does not|won't|nothing)\\b[^.]*\\btyp(e|es|ed|ing)\\b"],
      not: ["(?<!\\b(never|not|n't)\\s+)\\b(reads|sees|records|captures|stores|sends)\\s+(everything|whatever|what)\\s+(you|people|users|visitors)\\s+(type|enter)"],
    },
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
  {
    id: "sign-in",
    start: "/",
    goal: "How do I log in to my account?",
    steps: [{ expect: [any("Sign in")], act: { click: 'header a[href="/sign-in/"]' } }, DONE],
    reached: { url: "/sign-in/?$" },
  },
  // Sign in is by an emailed link or Google, so there is no password to change, and the right answer points at nothing.
  { id: "no-such-feature", start: "/", goal: "How do I change my password?", steps: [DONE] },
];

// The site has its own tag now (web/components/haptic-tag.tsx), loaded from the same address as the one a run adds, so
// both are answered by the run (eval/browser.ts) and only one widget starts. No step reaches the live server.
export default {
  siteId: "site_joinhaptic",
  origin: "https://joinhaptic.com",
  hasTag: false,
  about: "Haptic's own public site: a simple marketing page with an accordion, a sign-in page and a two-step form.",
  // The site's pages report their loading times to the network in front of them. Nothing else here is sent but plain reads.
  chatter: "^POST joinhaptic\\.com/cdn-cgi/rum$",
  guides,
} satisfies GuideSet;
