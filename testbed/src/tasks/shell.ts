import { button, DONE, link, type Task } from "./types";

// The shell: sidebar, top bar, command palette, menus, and the test panel's
// layout settings. Most of these are about finding a way in, not the page.

const menuitem = (label: string) => ({ label, role: "menuitem" });

export const tasks: Task[] = [
  {
    id: "shell-palette-vendor",
    start: "/",
    goal: "find the Keystone Legal vendor",
    covers: ["nav-command-palette", "overlay-modal"],
    steps: [
      { expect: [button("Search…⌘K"), link("Vendors")], act: { click: "role=button[name=/Search/]" } },
      { expect: [{ label: "Search pages, people, vendors, cards…", role: "combobox" }], act: { fill: ["[cmdk-input]", "Keystone"] }, say: "Type Keystone." },
      { expect: [{ label: "Keystone Legal", role: "option" }], act: { click: "role=option[name=/Keystone Legal/]" } },
      DONE,
    ],
  },
  {
    id: "shell-entity-uk",
    start: "/expenses",
    goal: "only show me spending for the UK company",
    lab: { plan: "enterprise" },
    covers: ["nav-entity-switcher", "overlay-dropdown", "access-plan"],
    steps: [
      { expect: [button("Switch entity")], act: { click: 'role=button[name="Switch entity"]' } },
      { expect: [menuitem("Northpine Ltd (GBP)")], act: { click: "role=menuitem[name=/Northpine Ltd/]" } },
      DONE,
    ],
  },
  {
    id: "shell-entity-starter",
    start: "/",
    goal: "switch to the German entity",
    lab: { plan: "starter" },
    covers: ["nav-entity-switcher", "access-plan", "cant-do"],
    note: "Starter has one entity and no switcher. The right answer says that, or points at Billing and plan to upgrade.",
    steps: [DONE],
  },
  {
    id: "shell-renamed-expenses",
    start: "/",
    goal: "where are my expenses",
    lab: { nav: "renamed" },
    covers: ["nav-renamed", "nav-sidebar"],
    steps: [{ expect: [link("Spend")], act: { click: "role=link[name=/^Spend/]" } }, DONE],
  },
  {
    id: "shell-spanish-approvals",
    start: "/",
    goal: "where do I approve things",
    lab: { locale: "es" },
    covers: ["nav-renamed", "nav-sidebar"],
    steps: [{ expect: [link("Aprobaciones")], act: { click: "role=link[name=/^Aprobaciones/]" } }, DONE],
  },
  {
    id: "shell-rail-approvals",
    start: "/cards",
    goal: "go to approvals",
    lab: { nav: "rail" },
    covers: ["nav-rail", "ambiguity-icon-only", "overlay-tooltip-only"],
    steps: [{ expect: [link("Approvals")], act: { click: 'role=link[name="Approvals"]' } }, DONE],
  },
  {
    id: "shell-dark-mode",
    start: "/",
    goal: "turn on dark mode",
    covers: ["nav-account-menu", "overlay-submenu", "ambiguity-icon-only"],
    steps: [
      // The avatar button shows "AS" and has no accessible name, on purpose.
      { expect: [button("AS")], act: { click: 'header button[aria-haspopup="menu"] >> nth=-1' } },
      { expect: [menuitem("Theme")], act: { click: "role=menuitem[name=/Theme/]" } },
      { expect: [menuitem("Dark")], act: { click: 'role=menuitem[name="Dark"]' } },
      DONE,
    ],
  },
  {
    id: "shell-sign-out",
    start: "/reports",
    goal: "how do I log out",
    covers: ["nav-account-menu", "ambiguity-icon-only"],
    steps: [
      { expect: [button("AS")], act: { click: 'header button[aria-haspopup="menu"] >> nth=-1' } },
      { expect: [menuitem("Sign out")], act: { click: 'role=menuitem[name="Sign out"]' } },
      DONE,
    ],
  },
  {
    id: "shell-shortcuts",
    start: "/",
    goal: "is there a keyboard shortcut for search",
    covers: ["overlay-dropdown", "ambiguity-icon-only"],
    steps: [
      { expect: [button("Help"), button("AS")], act: { click: 'role=button[name="Help"]' } },
      { expect: [menuitem("Keyboard shortcuts")], act: { click: "role=menuitem[name=/Keyboard shortcuts/]" } },
      DONE,
    ],
  },
  {
    id: "shell-shortcuts-native",
    start: "/cards",
    goal: "show me the keyboard shortcuts",
    lab: { nativeDialogs: "1" },
    covers: ["overlay-native-dialog", "overlay-dropdown"],
    steps: [
      { expect: [button("Help")], act: { click: 'role=button[name="Help"]' } },
      { expect: [menuitem("Keyboard shortcuts")], act: { click: "role=menuitem[name=/Keyboard shortcuts/]" } },
      DONE,
    ],
  },
  {
    id: "shell-notification-bill",
    start: "/",
    goal: "which bill is due soon",
    covers: ["overlay-popover", "ambiguity-icon-only"],
    steps: [
      { expect: [button("Notifications"), link("All bills")], act: { click: 'role=button[name="Notifications"]' } },
      { expect: [button("Bill due soon")], act: { click: "role=button[name=/Bill due soon/]" } },
      DONE,
    ],
  },
  {
    id: "shell-redirect-review",
    start: "/transactions",
    goal: "show me the transactions that still need review",
    covers: ["nav-redirect", "nav-tabs"],
    steps: [{ expect: [{ label: "Needs review", role: "tab" }], act: { click: "role=tab[name=/Needs review/]" } }, DONE],
  },
  {
    id: "shell-banner-new-bill",
    start: "/",
    goal: "I want to add a bill",
    lab: { banner: "1" },
    covers: ["layout-banner", "layout-covered", "overlay-dropdown"],
    steps: [
      // The maintenance banner covers the top of the header, where New sits.
      { expect: [button("Create new"), link("All bills")], act: { click: 'role=button[name="Create new"]' } },
      { expect: [menuitem("Bill")], act: { click: 'role=menuitem[name="Bill"]' } },
      DONE,
    ],
  },
  {
    id: "shell-contact-support",
    start: "/cards",
    goal: "how do I talk to a person at Northpine",
    lab: { chatBubble: "1" },
    covers: ["layout-chat-bubble", "overlay-dropdown"],
    steps: [
      { expect: [button("Help"), button("Open support chat")], act: { click: 'role=button[name="Help"]' } },
      { expect: [menuitem("Contact support")], act: { click: 'role=menuitem[name="Contact support"]' } },
      DONE,
    ],
  },
  {
    id: "shell-live-feed",
    start: "/",
    goal: "show me all the latest card charges",
    lab: { liveFeed: "1" },
    covers: ["async-live"],
    steps: [{ expect: [link("See all"), link("Expenses")], act: { click: 'role=link[name="See all"]' } }, DONE],
  },
  {
    id: "shell-help-center",
    start: "/approvals",
    goal: "where are the help articles",
    covers: ["nav-full-reload", "nav-sidebar"],
    steps: [{ expect: [link("Help center"), button("Help")], act: { click: 'role=link[name="Help center"]' } }, DONE],
  },
  {
    id: "shell-transfer-personal",
    start: "/",
    goal: "send $500 from the company account to my personal bank",
    covers: ["cant-do"],
    note: "Northpine has no transfers. The right answer says so, and may point at Reimbursements for money the person spent.",
    steps: [DONE],
  },
  {
    id: "shell-chart-year",
    start: "/",
    goal: "show me spending over the whole year",
    covers: ["viz-canvas"],
    // The chart is a canvas. Only the range buttons above it are in the DOM.
    steps: [{ expect: [{ label: "12 months", role: "radio" }], act: { click: 'role=radio[name="12 months"]' } }, DONE],
  },
  {
    id: "shell-breadcrumb-back",
    start: "/cards/card_0006q",
    goal: "take me back to the list of cards",
    covers: ["nav-breadcrumb", "ambiguity-duplicate-label"],
    // The breadcrumb and the sidebar both have a "Cards" link. Either is right.
    steps: [{ expect: [link("Cards")], act: { click: 'nav[aria-label="Breadcrumb"] >> role=link[name="Cards"]' } }, DONE],
  },
  {
    id: "shell-slow-issue-card",
    start: "/cards",
    goal: "issue a new card",
    lab: { latency: "slow" },
    covers: ["data-loading", "async-latency"],
    // The page shows a skeleton for about two seconds before the list appears.
    steps: [{ expect: [link("Issue card")], act: { click: 'role=link[name="Issue card"]' } }, DONE],
  },
  {
    id: "shell-change-phone",
    start: "/expenses",
    goal: "update my phone number",
    covers: ["nav-account-menu", "privacy-phone"],
    steps: [
      { expect: [button("AS")], act: { click: 'header button[aria-haspopup="menu"] >> nth=-1' } },
      { expect: [menuitem("Profile")], act: { click: 'role=menuitem[name="Profile"]' } },
      { expect: [{ label: "Mobile phone", role: "textbox" }], act: { fill: ['role=textbox[name="Mobile phone"]', "(503) 555-0199"] }, say: "Type your new number." },
      DONE,
    ],
  },
];
