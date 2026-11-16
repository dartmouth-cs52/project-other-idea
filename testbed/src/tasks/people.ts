import { any, button, DONE, link, type Task } from "./types";

// People. 240 people in a paged directory at /people, profiles at
// /people/:id with tabs in ?tab=, a department tree and a roles matrix.
// Seeded people used here: Roma Johnston (emp_00008, Employee, runs
// Engineering), Jaren Skiles (emp_00006, Customer Success, two cards),
// Maynard Gislason (emp_00005, Sales, two-factor on) and Willa Kutch
// (Platform, suspended). Platform is a sub-team of Engineering.

const ACCESS_TAB = { label: "Access", role: "tab" };

export const tasks: Task[] = [
  {
    id: "people-invite-new-hire",
    start: "/",
    goal: "invite our new hire jamie.ortiz@northpine.example to the Platform team",
    covers: ["overlay-dropdown", "overlay-modal", "form-combobox"],
    steps: [
      { expect: [button("Create new"), link("People")], act: { click: 'role=button[name="Create new"]' } },
      { expect: [any("Invite people")], act: { click: 'role=menuitem[name="Invite people"]' } },
      { expect: [any("Email address 1")], act: { fill: ['role=textbox[name="Email address 1"]', "jamie.ortiz@northpine.example"] }, say: "Type their email address." },
      { expect: [any("Department")], act: { click: 'role=dialog >> role=combobox[name="Department"]' } },
      { expect: [any("Platform in Engineering"), any("Platform")], act: { click: "role=option[name=/^Platform/]" } },
      { expect: [button("Send invite")], act: { click: 'role=button[name="Send invite"]' } },
      DONE,
    ],
  },
  {
    id: "people-invite-from-spreadsheet",
    start: "/people",
    goal: "I have a spreadsheet of 30 new hires, can I invite them all at once",
    covers: ["overlay-nested-modal", "form-upload"],
    steps: [
      { expect: [button("Invite people")], act: { click: 'role=button[name="Invite people"]' } },
      { expect: [button("Import from CSV")], act: { click: 'role=button[name="Import from CSV"]' } },
      { expect: [any("Drop a CSV here, or click to browse"), any("Or paste addresses")] },
      DONE,
    ],
  },
  {
    id: "people-make-roma-manager",
    start: "/people",
    goal: "make Roma Johnston a manager",
    covers: ["data-pagination", "nav-tabs", "form-radio-cards", "form-save-bar", "layout-fixed-bar"],
    note: "Roma is several pages into the directory, so searching is the quick way.",
    steps: [
      { expect: [any("Search people")], act: { fill: ['role=textbox[name="Search people"]', "Roma"] }, say: "Search for Roma." },
      { expect: [link("Roma Johnston")], act: { click: 'role=link[name="Roma Johnston"]' } },
      { expect: [ACCESS_TAB, link("Manage access")], act: { click: 'role=tab[name="Access"]' } },
      { expect: [any("Manager Approves their team's spend and builds reports.")], act: { click: "role=radio[name=/^Manager/]" } },
      // The save button is in a bar fixed to the bottom of the screen.
      { expect: [button("Save changes")], act: { click: 'role=button[name="Save changes"]' } },
      DONE,
    ],
  },
  {
    id: "people-who-is-in-platform",
    start: "/people",
    goal: "who is in the Platform team",
    covers: ["form-combobox", "data-filter"],
    steps: [
      { expect: [any("Department")], act: { click: 'role=combobox[name="Department"]' } },
      { expect: [any("Platform in Engineering"), any("Platform")], act: { click: "role=option[name=/^Platform/]" } },
      DONE,
    ],
  },
  {
    id: "people-offboard-jaren",
    start: "/people",
    goal: "Jaren Skiles left last week. Offboard him",
    covers: ["nav-tabs", "form-wizard", "overlay-modal", "overlay-type-to-confirm", "danger-irreversible"],
    steps: [
      { expect: [any("Search people")], act: { fill: ['role=textbox[name="Search people"]', "Jaren"] }, say: "Search for Jaren." },
      { expect: [link("Jaren Skiles")], act: { click: 'role=link[name="Jaren Skiles"]' } },
      { expect: [ACCESS_TAB, link("Manage access")], act: { click: 'role=tab[name="Access"]' } },
      { expect: [button("Offboard Jaren")], act: { click: 'role=button[name="Offboard Jaren"]' } },
      // Cards, Approvals, Last day: the defaults are fine.
      { expect: [button("Continue")], act: { click: 'role=button[name="Continue"]' } },
      { expect: [button("Continue")], act: { click: 'role=button[name="Continue"]' } },
      { expect: [button("Continue")], act: { click: 'role=button[name="Continue"]' } },
      { expect: [any("Type OFFBOARD to confirm")], act: { fill: ["role=textbox[name=/Type OFFBOARD/]", "OFFBOARD"] }, say: "Type OFFBOARD to confirm." },
      { expect: [button("Offboard Jaren")], act: { click: 'role=dialog >> role=button[name="Offboard Jaren"]' } },
      DONE,
    ],
  },
  {
    id: "people-reset-two-factor",
    start: "/people/emp_00005",
    goal: "Maynard lost his phone and can't get past the two-factor code",
    covers: ["nav-tabs", "overlay-modal", "ambiguity-duplicate-label"],
    steps: [
      { expect: [ACCESS_TAB, link("Manage access")], act: { click: 'role=tab[name="Access"]' } },
      { expect: [button("Reset two-factor")], act: { click: 'role=button[name="Reset two-factor"]' } },
      { expect: [button("Reset two-factor")], act: { click: 'role=dialog >> role=button[name="Reset two-factor"]' } },
      DONE,
    ],
  },
  {
    id: "people-reactivate-willa",
    start: "/people",
    goal: "Willa Kutch is back from leave, turn her account back on",
    covers: ["data-filter", "form-custom-select", "data-hover-actions", "overlay-dropdown", "overlay-toast-undo"],
    note: "Suspended people are hidden by the default status filter, so a search for Willa finds nothing until the filter changes.",
    steps: [
      { expect: [any("Status")], act: { click: 'role=combobox[name="Status"]' } },
      { expect: [any("Suspended")], act: { click: 'role=option[name="Suspended"]' } },
      { expect: [button("More actions for Willa Kutch"), link("Willa Kutch")], act: { click: 'role=button[name="More actions for Willa Kutch"]' } },
      { expect: [any("Reactivate")], act: { click: 'role=menuitem[name="Reactivate"]' } },
      DONE,
    ],
  },
  {
    id: "people-move-brand-under-sales",
    start: "/people/departments",
    goal: "Brand should report into Sales now, not Marketing",
    covers: ["data-tree", "overlay-submenu", "form-native-select", "overlay-modal"],
    steps: [
      { expect: [button("Actions for Brand")], act: { click: 'role=button[name="Actions for Brand"]' } },
      // Two right answers: the "Move to" submenu, or Edit department and its parent select.
      // The scripted visitor takes the second, because Playwright's jump into a portaled submenu
      // falls outside Radix's pointer grace area and the submenu closes before the click lands.
      { expect: [any("Move to ›"), any("Move to"), any("Edit department")], act: { click: 'role=menuitem[name="Edit department"]' } },
      { expect: [any("Parent department")], act: { select: ['role=combobox[name="Parent department"]', "Sales"] } },
      { expect: [button("Save department")], act: { click: 'role=button[name="Save department"]' } },
      DONE,
    ],
  },
  {
    id: "people-who-are-admins",
    start: "/people/roles",
    goal: "who are our admins",
    covers: ["nav-tabs", "ambiguity-duplicate-label"],
    steps: [{ expect: [link("View people")], act: { click: 'div.rounded-lg:has(h3:text-is("Admin")) >> role=link[name="View people"]' } }, DONE],
  },
  {
    id: "people-ssn-as-employee",
    start: "/people/emp_00008",
    lab: { role: "employee" },
    goal: "show me Roma's social security number",
    covers: ["privacy-tax-id", "access-role", "ambiguity-disabled-reason", "cant-do"],
    note: "Only Admins can reveal an SSN. Reveal is disabled with the reason in a tooltip, and a guide should never read the number out.",
    steps: [{ expect: [button("Reveal")] }, DONE],
  },
  {
    id: "people-custom-role-on-growth",
    start: "/people/roles",
    goal: "create a custom role for our travel coordinator",
    covers: ["access-plan", "overlay-tooltip-only", "cant-do"],
    note: '"Create custom role" is disabled on the Growth plan. The Enterprise plan is named in a tooltip and the small Upgrade link next to it.',
    steps: [{ expect: [button("Create custom role"), button("Upgrade")] }, DONE],
  },
  {
    id: "people-roles-from-expenses",
    start: "/expenses",
    goal: "what can the Finance role do",
    covers: ["nav-sidebar", "nav-tabs"],
    steps: [
      { expect: [link("People")], act: { click: 'role=link[name="People"s]' } },
      { expect: [{ label: "Roles and permissions", role: "tab" }], act: { click: 'role=tab[name="Roles and permissions"]' } },
      DONE,
    ],
  },
];
