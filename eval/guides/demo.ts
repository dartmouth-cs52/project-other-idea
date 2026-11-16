import { any, button, DONE, type Guide, type GuideSet, type Step } from "../guide.ts";

// The demo app in demo/, served by the local server at /demo/.

const ACCOUNT: Step = { expect: [button("A")], act: { click: "#account-button" }, say: "Click the round A button at the top right." };

const guides: Guide[] = [
  {
    id: "billing",
    start: "/demo/",
    goal: "How do I change my billing info?",
    steps: [
      ACCOUNT,
      { expect: [any("Plan and billing")], act: { click: '#account-menu a[href="/demo/settings-billing"]' } },
      { expect: [button("Update payment method")], act: { click: "#edit-payment" } },
      { expect: [any("Name on card"), any("Billing postcode")], act: { fill: ['input[name="cardname"]', "Avery Stone"] }, say: "Type the name on the card." },
      { expect: [any("Billing postcode")], act: { fill: ['input[name="postcode"]', "03755"] }, say: "Type the billing postcode." },
      { expect: [button("Save payment method")], act: { click: 'button[value="save"]' } },
      DONE,
    ],
    reached: { text: "Payment method updated." },
  },
  {
    id: "invite",
    start: "/demo/",
    goal: "I want to invite a teammate",
    steps: [
      { expect: [any("Team")], act: { click: 'nav a[href="/demo/team"]' } },
      { expect: [any("Email address")], act: { fill: ['input[name="email"]', "sam@example.com"] }, say: "Type their email address." },
      { expect: [button("Send invite")], act: { click: "#invite button" } },
      DONE,
    ],
    reached: { text: "Invite sent." },
  },
  {
    id: "invite-here",
    start: "/demo/team",
    goal: "invite a teammate",
    steps: [
      { expect: [any("Email address")], act: { fill: ['input[name="email"]', "priya@example.com"] }, say: "Type their email address." },
      { expect: [button("Send invite")], act: { click: "#invite button" } },
      DONE,
    ],
    reached: { text: "Invite sent." },
  },
  {
    id: "invite-wrong-click",
    start: "/demo/",
    goal: "add someone to my team",
    steps: [
      // The visitor is pointed at Team and clicks Projects.
      { expect: [any("Team")], act: { click: 'nav a[href="/demo/projects"]' } },
      { expect: [any("Team")], act: { click: 'nav a[href="/demo/team"]' }, say: "Not that one. Click Team.", sayStartsWith: "Not that one." },
      { expect: [any("Email address")], act: { fill: ['input[name="email"]', "jo@example.com"] }, say: "Type their email address." },
      { expect: [button("Send invite")], act: { click: "#invite button" } },
      DONE,
    ],
    reached: { text: "Invite sent." },
  },
  {
    id: "new-project",
    start: "/demo/",
    goal: "create a new project",
    steps: [
      { expect: [any("Projects"), any("View projects")], act: { click: 'nav a[href="/demo/projects"]' } },
      { expect: [button("New project")], act: { click: "#new-project" } },
      { expect: [any("Project name")], act: { fill: ['#project-dialog input[name="name"]', "billing-service"] }, say: "Type a name for the project." },
      { expect: [button("Create project"), any("Region")], act: { click: 'button[value="create"]' } },
      DONE,
    ],
    reached: { selector: '#projects li:text-is("billing-service")' },
  },
  {
    id: "api-key",
    start: "/demo/projects",
    goal: "Where do I get an API key?",
    steps: [
      ACCOUNT,
      { expect: [any("Settings")], act: { click: '#account-menu a[href="/demo/settings"]' } },
      { expect: [any("Security")], act: { click: '.tabs a[href="/demo/settings-security"]' } },
      { expect: [button("Create API key")], act: { click: "#new-key" } },
      DONE,
    ],
    reached: { text: "API key created." },
  },
  {
    id: "two-factor",
    start: "/demo/team",
    goal: "turn on two-factor authentication",
    steps: [
      ACCOUNT,
      { expect: [any("Settings")], act: { click: '#account-menu a[href="/demo/settings"]' } },
      { expect: [any("Security")], act: { click: '.tabs a[href="/demo/settings-security"]' } },
      { expect: [any("Require two-factor authentication")], act: { check: "#two-factor" }, say: "Tick Require two-factor authentication." },
      DONE,
    ],
    reached: { text: "Two-factor authentication is now required." },
  },
  {
    id: "rename-workspace",
    start: "/demo/",
    goal: "How can I rename my workspace?",
    steps: [
      ACCOUNT,
      { expect: [any("Settings")], act: { click: '#account-menu a[href="/demo/settings"]' } },
      { expect: [any("Workspace name")], act: { fill: ['input[name="workspace"]', "Acme Labs"] }, say: "Type the new name." },
      { expect: [button("Save changes")], act: { click: "#general button" } },
      DONE,
    ],
    reached: { text: "Settings saved." },
  },
  {
    id: "time-zone",
    start: "/demo/settings-billing",
    goal: "change the time zone",
    steps: [
      { expect: [any("General")], act: { click: '.tabs a[href="/demo/settings"]' } },
      { expect: [any("Time zone")], act: { select: ["#general select", "Pacific"] }, say: "Pick your time zone." },
      { expect: [button("Save changes")], act: { click: "#general button" } },
      DONE,
    ],
    reached: { text: "Settings saved." },
  },
  {
    id: "invoice",
    start: "/demo/",
    goal: "download my latest invoice",
    steps: [
      ACCOUNT,
      { expect: [any("Plan and billing")], act: { click: '#account-menu a[href="/demo/settings-billing"]' } },
      // The link leads back to the same page, so nothing would show it had been used. The guide ends on it.
      { expect: [any("Download latest invoice")] },
    ],
  },
  {
    id: "upgrade",
    start: "/demo/",
    goal: "I want to upgrade my plan",
    steps: [
      ACCOUNT,
      { expect: [any("Plan and billing")], act: { click: '#account-menu a[href="/demo/settings-billing"]' } },
      { expect: [button("Change plan")], act: { click: "#change-plan" } },
      DONE,
    ],
    reached: { text: "Plan changes are switched off in this demo." },
  },
  {
    id: "sign-out",
    start: "/demo/team",
    goal: "sign out",
    steps: [ACCOUNT, { expect: [any("Sign out")], act: { click: '#account-menu a[href="/demo/"]' } }, DONE],
    reached: { url: "/demo/$" },
  },
  {
    id: "usage",
    start: "/demo/team",
    goal: "where can I see my usage this month?",
    steps: [{ expect: [any("Overview"), any("Acme Console")], act: { click: 'nav a[href="/demo/"]' } }, DONE],
    reached: { url: "/demo/$", text: "Usage this month" },
  },
  // The demo has no way to delete a project, so the right answer points at nothing.
  { id: "no-such-feature", start: "/demo/projects", goal: "How do I delete a project?", steps: [DONE] },
];

export default {
  siteId: "site_demo",
  origin: process.env.HAPTIC_PUBLIC_URL || "http://localhost:4000",
  hasTag: true,
  about: "Haptic's own demo app: a small, tidy console. Scores here are a ceiling, not a forecast.",
  sandbox: true,
  guides,
} satisfies GuideSet;
