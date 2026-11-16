import { any, button, DONE, link, type Task } from "./types";

// The help center (full page loads), contact form, sign in and onboarding.

export const tasks: Task[] = [
  {
    id: "help-find-mileage-article",
    start: "/",
    goal: "is there a help article about claiming mileage",
    steps: [
      // Help center reloads the whole page.
      { expect: [link("Help center")], act: { click: 'role=link[name="Help center"]' } },
      { expect: [any("Search help articles")], act: { fill: ['role=searchbox[name="Search help articles"]', "mileage"] } },
      { expect: [link("Claim mileage")], act: { click: 'role=link[name^="Claim mileage"]' } },
      DONE,
    ],
    covers: ["nav-full-reload", "data-filter"],
  },
  {
    id: "help-browse-security",
    start: "/help",
    goal: "show me the help articles about security",
    steps: [
      // The topic tiles are plain divs with click handlers.
      { expect: [any("Security and access")], act: { click: "text=Security and access" } },
      DONE,
    ],
    covers: ["ambiguity-div-button"],
  },
  {
    id: "help-related-article",
    start: "/help/two-factor",
    goal: "how do I make two-factor mandatory for the whole team",
    steps: [
      // Two links with this name: a plain <a> in Related and a router link below it.
      { expect: [link("Require two-factor for everyone")], act: { click: 'role=link[name="Require two-factor for everyone"] >> nth=0' } },
      { expect: [link("Open Security settings")], act: { click: 'role=link[name="Open Security settings"]' } },
      { expect: [any("Require two-factor for everyone")], act: { click: 'role=switch[name="Require two-factor for everyone"]' } },
      { expect: [button("Require two-factor")], act: { click: 'role=button[name="Require two-factor"]' } },
      DONE,
    ],
    covers: ["nav-full-reload", "ambiguity-duplicate-label", "form-switch"],
  },
  {
    id: "help-whats-new",
    start: "/cards",
    goal: "what changed in Northpine recently",
    steps: [
      // The help icon's only label is its tooltip. The menu trigger drops its aria-label.
      { expect: [any("Help")], act: { click: 'header button[aria-haspopup="menu"] >> nth=1' } },
      { expect: [any("What's new")], act: { click: `role=menuitem[name="What's new"]` } },
      DONE,
    ],
    covers: ["overlay-dropdown", "ambiguity-icon-only", "overlay-tooltip-only"],
  },
  {
    id: "help-contact-declined-card",
    start: "/help",
    goal: "tell support my card keeps getting declined",
    steps: [
      { expect: [link("Contact support")], act: { click: 'role=link[name="Contact support"] >> nth=0' } },
      { expect: [any("What's it about?")], act: { click: `role=combobox[name="What's it about?"]` } },
      { expect: [any("A card problem")], act: { click: 'role=option[name="A card problem"]' } },
      { expect: [any("Last 4 digits of the card")], act: { fill: ['role=textbox[name="Last 4 digits of the card"]', "4417"] } },
      { expect: [any("Subject")], act: { fill: ['role=textbox[name="Subject"]', "Card declined at every merchant"] } },
      { expect: [any("Message")], act: { fill: ['role=textbox[name="Message"]', "My card has been declined three times today, at a hotel and two restaurants."] } },
      { expect: [button("Send message")], act: { click: 'role=button[name="Send message"]' } },
      DONE,
    ],
    covers: ["form-custom-select", "form-conditional", "form-validation", "privacy-card"],
  },
  {
    id: "help-chat",
    start: "/help/contact",
    goal: "can I chat with a person",
    steps: [{ expect: [button("Chat with us")], act: { click: 'role=button[name="Chat with us"]' } }, DONE],
    covers: ["overlay-drawer"],
  },
  {
    id: "help-forgot-password",
    start: "/signin",
    goal: "I forgot my password",
    steps: [
      // A link that opens a dialog instead of navigating.
      { expect: [link("Forgot password?")], act: { click: "text=Forgot password?" } },
      { expect: [any("Email")], act: { fill: ['role=dialog >> role=textbox[name="Email"]', "avery.stone@northpine.example"] } },
      { expect: [button("Send reset link")], act: { click: 'role=button[name="Send reset link"]' } },
      DONE,
    ],
    covers: ["ambiguity-link-as-button", "overlay-modal", "privacy-email"],
  },
  {
    id: "help-sso-signin",
    start: "/signin",
    goal: "sign in with our company login",
    steps: [
      { expect: [button("Continue with SSO")], act: { click: 'role=button[name="Continue with SSO"]' } },
      { expect: [any("Work email")], act: { fill: ['role=textbox[name="Work email"]', "avery.stone@northpine.example"] } },
      { expect: [button("Continue")], act: { click: 'role=button[name="Continue"]' } },
      DONE,
    ],
    covers: ["form-conditional"],
  },
  {
    id: "help-onboarding-skip-bank",
    start: "/onboarding",
    goal: "set up our workspace, but I'll connect the bank later",
    steps: [
      { expect: [any("Company name")], act: { fill: ['role=textbox[name="Company name"]', "Fernhill Outdoor"] } },
      { expect: [any("Industry")], act: { click: 'role=combobox[name="Industry"]' } },
      { expect: [any("Retail")], act: { click: 'role=option[name="Retail"]' } },
      { expect: [button("Continue")], act: { click: 'role=button[name="Continue"]' } },
      { expect: [button("Skip for now")], act: { click: 'role=button[name="Skip for now"]' } },
      DONE,
    ],
    covers: ["form-wizard", "form-custom-select", "form-radio-cards", "form-validation"],
  },
];
