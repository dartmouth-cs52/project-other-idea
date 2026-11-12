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

export const faqs = [
  {
    q: "How is Haptic different from a chatbot or a product tour?",
    a: "A chatbot answers in text and leaves people to find the button themselves. A product tour plays the same fixed steps for everyone. Haptic works on the live page. It reads what is on screen, points to the next control, waits for the click, then carries on, across menus and pages.",
  },
  {
    q: "How do I add Haptic to my product?",
    a: "Today it is one script tag in your app. During onboarding we read your site and your help docs, so Haptic knows your product before it meets your users.",
  },
  {
    q: "Does Haptic click things for my users?",
    a: "No. Haptic points and explains, and the person does the clicking. They stay in control, and they learn where things are.",
  },
  {
    q: "Does it work in apps behind a login?",
    a: "Yes. Haptic runs in the browser on the page your user is looking at, so it works on signed in pages and on pages built with JavaScript. It also follows people from one page to the next.",
  },
  {
    q: "What does Haptic see on the page?",
    a: "The names of buttons, links and fields, plus short pieces of visible text, so it knows what to point at. It never reads what people type into fields, and it masks emails, phone numbers and long numbers before anything leaves the browser.",
  },
  {
    q: "How much does it cost?",
    a: "Haptic is in early access and pricing is not set yet. Request access and we will talk through what fits your product.",
  },
  {
    q: "Is Haptic ready for enterprise?",
    a: "Not yet. Haptic is early, and we would rather say so than overpromise. If you have security or compliance needs, tell us and we will be clear about what we support today.",
  },
] as const;
