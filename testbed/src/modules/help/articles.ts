// The help center's articles. Written the way a real product's docs would be:
// short, task first, naming the buttons people will see.

export interface Category {
  id: string;
  label: string;
  blurb: string;
}

export interface Article {
  slug: string;
  title: string;
  category: string;
  summary: string;
  intro: string;
  steps: string[];
  tip?: string;
  /** In-app page the article is about, linked as a button. */
  action?: { label: string; to: string };
  related: string[];
  updated: string;
}

export const CATEGORIES: Category[] = [
  { id: "cards", label: "Cards", blurb: "Issue, freeze and set limits on cards." },
  { id: "expenses", label: "Expenses and receipts", blurb: "Receipts, memos and reviewing spend." },
  { id: "reimbursements", label: "Reimbursements", blurb: "Out-of-pocket costs and mileage." },
  { id: "approvals", label: "Approvals", blurb: "Who approves what, and how to decide." },
  { id: "bills", label: "Bill pay", blurb: "Vendors, bills and payments." },
  { id: "accounting", label: "Accounting", blurb: "Sync spend to your ledger." },
  { id: "security", label: "Security and access", blurb: "Two-factor, SSO and roles." },
  { id: "developers", label: "Developers", blurb: "API keys and webhooks." },
];

export const ARTICLES: Article[] = [
  {
    slug: "issue-a-card",
    title: "Issue a card to a teammate",
    category: "cards",
    summary: "Give someone a virtual card right away, or ship them a physical one.",
    intro: "Admins and the Finance role can issue cards. Virtual cards work the moment you create them. Physical cards arrive in 5 to 7 business days.",
    steps: [
      "Go to Cards in the sidebar and press Issue card.",
      "Pick the cardholder. If they aren't in Northpine yet, invite them from People first.",
      "Choose Virtual or Physical, then set a limit and how often it resets.",
      "Optionally lock the card to one merchant or a few categories.",
      "Press Issue card. The cardholder gets an email with how to use it.",
    ],
    tip: "To give a contractor a card for one purchase, set the limit interval to Total and turn on auto-lock.",
    action: { label: "Go to Cards", to: "/cards" },
    related: ["freeze-a-card", "upload-receipts"],
    updated: "2026-10-28",
  },
  {
    slug: "freeze-a-card",
    title: "Freeze or cancel a card",
    category: "cards",
    summary: "Stop new charges for a while, or for good.",
    intro: "Freezing is temporary and you can unfreeze any time. Cancelling is permanent. Charges already pending still go through either way.",
    steps: [
      "Open Cards and click the card.",
      "Press Freeze card. New charges are declined right away.",
      "To undo it, open the card again and press Unfreeze.",
      "To close it for good, open the More menu on the card and choose Cancel card.",
    ],
    tip: "Cardholders can freeze their own cards. Only admins and Finance can cancel.",
    action: { label: "Go to Cards", to: "/cards" },
    related: ["issue-a-card"],
    updated: "2026-09-14",
  },
  {
    slug: "upload-receipts",
    title: "Add a receipt to a charge",
    category: "expenses",
    summary: "Attach a photo or PDF so the charge can be approved and exported.",
    intro: "Charges over your company's receipt threshold need a receipt before they can be exported. You'll get a reminder after 3 days.",
    steps: [
      "Go to Expenses and filter by Receipt missing.",
      "Click the charge to open it.",
      "Drop the file on the receipt area, or click it to browse.",
      "Add a memo if the charge needs one, then press Save.",
    ],
    tip: "Lost the receipt? Open the charge's More menu and choose Lost receipt to fill in an affidavit.",
    action: { label: "Go to Expenses", to: "/expenses?receipt=missing" },
    related: ["approvals", "notifications"],
    updated: "2026-11-02",
  },
  {
    slug: "mileage",
    title: "Claim mileage",
    category: "reimbursements",
    summary: "Get paid back for driving your own car for work.",
    intro: "Northpine works out the amount from the distance and your company's rate per mile.",
    steps: [
      "Press New in the top bar and choose Mileage claim.",
      "Enter where you started and where you went. Tick Round trip if you came back.",
      "Pick the date and add a short reason.",
      "Press Submit. Your manager gets an approval request.",
    ],
    action: { label: "Start a mileage claim", to: "/reimbursements/new?kind=mileage" },
    related: ["approvals"],
    updated: "2026-08-30",
  },
  {
    slug: "approvals",
    title: "Approve or reject requests",
    category: "approvals",
    summary: "Decide on card requests, reimbursements and bills waiting for you.",
    intro: "Anything waiting for you shows in Approvals with a count in the sidebar.",
    steps: [
      "Go to Approvals.",
      "Click a request to see the details, receipts and policy notes.",
      "Press Approve, or Reject and give a reason.",
      "To decide on several at once, tick them and use the bar that appears at the top.",
    ],
    action: { label: "Go to Approvals", to: "/approvals" },
    related: ["approval-chains"],
    updated: "2026-10-05",
  },
  {
    slug: "approval-chains",
    title: "Change who approves what",
    category: "approvals",
    summary: "Route big purchases to Finance, meals over a limit to a manager, and so on.",
    intro: "Approval rules live in Policies. Rules run from top to bottom and the first match decides. Custom chains need the Growth plan.",
    steps: [
      "Go to Policies.",
      "Press New rule, or click a rule to edit it.",
      "Add conditions, like Category is Meals and Amount is more than $150.",
      "Choose Require approval and pick the approver or role.",
      "Drag the rule up or down to set its order, then press Save.",
    ],
    action: { label: "Go to Policies", to: "/policies" },
    related: ["approvals"],
    updated: "2026-09-21",
  },
  {
    slug: "pay-a-bill",
    title: "Pay a bill",
    category: "bills",
    summary: "Upload a vendor's invoice and schedule the payment.",
    intro: "Bills can be paid by ACH, wire, check or card. Bills over your approval limit wait for an approver first.",
    steps: [
      "Go to Bills and press New bill, or drop the invoice PDF on the page.",
      "Pick the vendor and check the amount and due date.",
      "Code each line to an account and department.",
      "Press Schedule payment and choose the date.",
    ],
    action: { label: "Go to Bills", to: "/bills" },
    related: ["accounting-sync"],
    updated: "2026-10-19",
  },
  {
    slug: "accounting-sync",
    title: "Connect your accounting system",
    category: "accounting",
    summary: "Send coded spend to Ledgerbook or Summa automatically.",
    intro: "Admins connect accounting from Settings. After that, cleared charges, bills and reimbursements export on the schedule you set.",
    steps: [
      "Go to Settings, then Integrations.",
      "Find your accounting system and press Connect.",
      "Sign in to it and allow access.",
      "Press Configure to map each kind of spend to an account.",
    ],
    tip: "If a sync fails, the Accounting page lists which transactions didn't export and why.",
    action: { label: "Open Integrations", to: "/settings/integrations" },
    related: ["pay-a-bill"],
    updated: "2026-07-12",
  },
  {
    slug: "two-factor",
    title: "Turn on two-factor for your account",
    category: "security",
    summary: "Ask for a code from your phone when you sign in.",
    intro: "You'll need an authenticator app on your phone. Setup takes about a minute.",
    steps: [
      "Open your account menu at the top right and choose Profile.",
      "Under Two-factor authentication, press Set up two-factor.",
      "Scan the QR code with your app and press Next.",
      "Enter the 6-digit code and press Verify.",
      "Save your backup codes somewhere safe, then press I've saved these.",
    ],
    action: { label: "Open your profile", to: "/settings/profile" },
    related: ["require-2fa"],
    updated: "2026-10-01",
  },
  {
    slug: "require-2fa",
    title: "Require two-factor for everyone",
    category: "security",
    summary: "Make every person in the workspace use two-factor.",
    intro: "Only admins can change this. People who haven't set it up are asked to the next time they sign in.",
    steps: [
      "Go to Settings, then Security.",
      "Turn on Require two-factor for everyone.",
      "Confirm in the dialog.",
    ],
    action: { label: "Open Security settings", to: "/settings/security" },
    related: ["two-factor"],
    updated: "2026-10-01",
  },
  {
    slug: "api-keys",
    title: "Create an API key",
    category: "developers",
    summary: "Call the Northpine API from your own scripts and tools.",
    intro: "API access is on the Growth and Enterprise plans. Only admins can create keys. The full key is shown once, so copy it before you close the dialog.",
    steps: [
      "Go to Settings, then Developers.",
      "Press Create API key.",
      "Name the key and tick only the scopes it needs.",
      "Press Create key, copy the key, then press I've copied it.",
    ],
    tip: "Lost a key? You can't see it again. Revoke it and create a new one.",
    action: { label: "Open Developers", to: "/settings/developer" },
    related: ["accounting-sync"],
    updated: "2026-11-06",
  },
  {
    slug: "notifications",
    title: "Choose which notifications you get",
    category: "expenses",
    summary: "Turn off emails about missing receipts, or get approvals in Chatter.",
    intro: "Each person picks their own notifications. Changes save as you click.",
    steps: [
      "Open your account menu and choose Profile, then Notifications in the settings list.",
      "Find the event, like Receipt missing.",
      "Untick the channels you don't want, such as Email.",
    ],
    action: { label: "Open Notifications", to: "/settings/notifications" },
    related: ["upload-receipts"],
    updated: "2026-10-22",
  },
  {
    slug: "change-plan",
    title: "Change your plan",
    category: "security",
    summary: "Upgrade for SSO and multiple entities, or downgrade.",
    intro: "Admins can change the plan from Billing. Upgrades apply right away and are prorated.",
    steps: ["Go to Settings, then Billing and plan.", "In Compare plans, press Upgrade or Downgrade under the plan you want.", "Confirm the change."],
    tip: "To cancel Northpine entirely, contact support. It can't be done from the app.",
    action: { label: "Open Billing", to: "/settings/billing" },
    related: ["require-2fa"],
    updated: "2026-09-02",
  },
];

export const findArticle = (slug: string | undefined) => ARTICLES.find((a) => a.slug === slug);
export const categoryOf = (id: string) => CATEGORIES.find((c) => c.id === id);

export interface Release {
  date: string;
  title: string;
  tag: "New" | "Improved" | "Fixed";
  body: string;
}

export const RELEASES: Release[] = [
  { date: "2026-11-10", title: "Per diem rates for 2027", tag: "New", body: "Travelers get next year's per diem rates automatically on January 1. Review them in Policies." },
  { date: "2026-11-03", title: "Bulk approve from the Approvals inbox", tag: "Improved", body: "Tick several requests and approve them together. Each still gets its own audit entry." },
  { date: "2026-10-27", title: "Webhook signing secrets can be rolled", tag: "New", body: "Roll a secret from Settings, then Developers. The old one keeps working for 24 hours." },
  { date: "2026-10-20", title: "Receipts matched from email", tag: "New", body: "Forward a receipt to receipts@northpine.example and we'll match it to the charge." },
  { date: "2026-10-13", title: "Ledgerbook sync retries", tag: "Fixed", body: "Transactions that failed to export because of a timeout now retry on their own." },
  { date: "2026-10-06", title: "Card limits by week", tag: "Improved", body: "Card limits can reset weekly, as well as daily, monthly, yearly or never." },
  { date: "2026-09-29", title: "Dark theme", tag: "New", body: "Pick Light, Dark or Match system in your profile." },
];
