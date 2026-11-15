import { any, button, DONE, link, type Task } from "./types";

// Budgets. The seed gives each of the 14 departments one budget, named after
// the department ("Platform travel" is bud_3, "Finance events" is bud_11).
// Budgets need the Growth plan, and creating or editing one needs Admin or Finance.

export const tasks: Task[] = [
  {
    id: "budgets-new-marketing",
    start: "/budgets",
    goal: "set a budget for marketing, $50,000 a month",
    covers: ["form-combobox", "form-validation"],
    steps: [
      { expect: [button("New budget")], act: { click: 'role=button[name="New budget"]' } },
      { expect: [any("Budget name")], act: { fill: ['role=textbox[name="Budget name"]', "Marketing programs"] }, say: "Name the budget." },
      { expect: [any("Department")], act: { click: 'role=combobox[name="Department"]' } },
      { expect: [any("Marketing")], act: { click: 'role=option[name="Marketing"s]' } },
      // The owner fills in with the department's manager.
      { expect: [any("Amount")], act: { fill: ['role=textbox[name="Amount"]', "50000"] }, say: "Type 50000 as the amount." },
      { expect: [button("Create budget")], act: { click: 'role=button[name="Create budget"]' } },
      DONE,
    ],
  },
  {
    id: "budgets-from-home-on-starter",
    start: "/",
    lab: { plan: "starter" },
    goal: "set up a budget for the sales team",
    covers: ["nav-sidebar", "access-plan"],
    note: "Budgets are on the Growth plan. The page shows an upgrade prompt, so the answer is that the plan needs upgrading first.",
    steps: [{ expect: [link("Budgets")], act: { click: 'role=link[name="Budgets"s]' } }, { expect: [button("Upgrade to Growth")] }, DONE],
  },
  {
    id: "budgets-which-are-over",
    start: "/budgets",
    goal: "which budgets are over",
    covers: ["data-filter", "form-custom-select"],
    steps: [{ expect: [button("Show only these"), any("Status")], act: { click: 'role=button[name="Show only these"]' } }, DONE],
  },
  {
    id: "budgets-raise-platform-travel",
    start: "/budgets",
    goal: "raise the Platform travel budget to $75,000",
    covers: ["ambiguity-div-button", "overlay-drawer"],
    note: "Budget cards are clickable divs with no role or link.",
    steps: [
      { expect: [any("Platform travel")], act: { click: "text=Platform travel" } },
      { expect: [button("Edit budget")], act: { click: 'role=button[name="Edit budget"]' } },
      { expect: [any("Amount")], act: { fill: ['role=dialog >> role=textbox[name="Amount"]', "75000"] }, say: "Change the amount to 75000." },
      { expect: [button("Save budget")], act: { click: 'role=button[name="Save budget"]' } },
      DONE,
    ],
  },
  {
    id: "budgets-rollover",
    start: "/budgets/new",
    goal: "can leftover budget carry over to next month",
    covers: ["form-switch", "form-conditional"],
    steps: [{ expect: [any("Roll over unused budget")], act: { click: 'role=switch[name="Roll over unused budget"]' } }, DONE],
  },
  {
    id: "budgets-archive-finance-events",
    start: "/budgets/bud_11",
    goal: "we don't need this budget anymore, get rid of it",
    covers: ["danger-delete", "ambiguity-duplicate-label", "overlay-toast-undo"],
    steps: [
      { expect: [button("Archive budget")], act: { click: 'role=button[name="Archive budget"]' } },
      // The dialog's confirm button has the same label as the one that opened it.
      { expect: [button("Archive budget")], act: { click: 'role=dialog >> role=button[name="Archive budget"]' } },
      DONE,
    ],
  },
  {
    id: "budgets-employee-cant-create",
    start: "/budgets",
    lab: { role: "employee" },
    goal: "create a budget for my team's offsite",
    covers: ["access-role", "ambiguity-disabled-reason", "cant-do"],
    note: 'Only Admin and Finance can create budgets. "New budget" is disabled with the reason in a tooltip.',
    steps: [{ expect: [button("New budget")] }, DONE],
  },
  {
    id: "budgets-this-quarter",
    start: "/budgets",
    goal: "how are we doing against budget this quarter",
    covers: ["form-radio-cards"],
    steps: [{ expect: [{ label: "This quarter", role: "radio" }], act: { click: 'role=radio[name="This quarter"]' } }, DONE],
  },
];
