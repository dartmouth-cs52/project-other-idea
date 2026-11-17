import { TASKS, type Task } from "../../testbed/src/tasks/index.ts";
import { any, button, link } from "../../testbed/src/tasks/types.ts";
import { DONE, type Guide } from "../guide.ts";
import northpine, { guideOf } from "./northpine.ts";

// The checks for Teach Haptic (docs/corrections.md#teach-haptic): questions
// asked as a visitor would ask them, with the steps a person at the company
// teaches by doing the task. Each is run on a copy of Northpine's site without
// a taught route and on one with it, against a server that runs this branch:
//
//   NORTHPINE_SITE=site_teach_test npm run eval:guides -- northpine-teach --server <address> --repeat 5
//
// Each ends where the taught route leaves the click for the visitor: the
// control that saves or pays is pointed at, and never pressed.

/** "how do I add a budget", from the home page. */
const addBudget: Task = {
  id: "budgets-add-from-home",
  start: "/",
  goal: "how do I add a budget",
  covers: ["nav-sidebar", "form-combobox"],
  steps: [
    { expect: [link("Budgets")], act: { click: 'role=complementary[name="Main navigation"] >> role=link[name="Budgets"]' } },
    { expect: [button("New budget")], act: { click: 'role=button[name="New budget"]' } },
    { expect: [any("Budget name")], act: { fill: ['role=textbox[name="Budget name"]', "Offsite fund"] } },
    { expect: [any("Department")], act: { click: 'role=combobox[name="Department"]' } },
    { expect: [any("Marketing")], act: { click: 'role=option[name="Marketing"s]' } },
    { expect: [any("Amount")], act: { fill: ['role=textbox[name="Amount"]', "50000"] } },
    { expect: [button("Create budget")] },
  ],
};

/**
 * Adding a budget from its form, for Do it with me (eval/acts.ts with
 * ACTS_SET=northpine-teach): what the visitor fills in is theirs, and Create
 * budget is handed over, never pressed. Pressing New budget on the list sets
 * off acting's tripwire on Northpine, route or not, so this starts past it.
 */
const addBudgetInForm: Task = {
  id: "budgets-add-in-form",
  start: "/budgets/new",
  goal: "how do I add a budget",
  covers: ["form-combobox"],
  steps: [
    { expect: [any("Budget name")], act: { fill: ['role=textbox[name="Budget name"]', "Marketing programs"] } },
    { expect: [any("Department")], act: { click: 'role=combobox[name="Department"]' } },
    { expect: [any("Marketing")], act: { click: 'role=option[name="Marketing"s]' } },
    { expect: [any("Amount")], act: { fill: ['role=textbox[name="Amount"]', "50000"] } },
    { expect: [button("Create budget")] },
  ],
};

/**
 * One of Northpine's own tasks, ending at the control that commits instead of
 * pressing it. What the page shows once it is pressed is never reached, so a
 * run is over when that control is pointed at.
 */
function upToTheCommit(id: string): Guide {
  const task = TASKS.find((item) => item.id === id);
  if (!task) throw new Error(`Northpine has no task ${id}.`);
  const guide = guideOf(task);
  const at = guide.steps.findIndex((step) => step.expect.some((matcher) => /^(Confirm payment|Save changes|Create budget|Submit)/.test(matcher.label)));
  const steps = at < 0 ? guide.steps : [...guide.steps.slice(0, at), { expect: guide.steps[at]!.expect }];
  const { reached: _reached, ...rest } = guide;
  return { ...rest, steps };
}

/**
 * Near misses for the route taught for "how do I add a budget": the same
 * thing with another action, and a question about what it is. The route must
 * not be used for any of them (the server's count line says, as `taught`).
 */
const nearMisses: Task[] = [
  {
    id: "budgets-delete-near-miss",
    start: "/budgets",
    goal: "how do I delete a budget",
    covers: ["danger-delete"],
    // Any budget will do: the visitor opens the one the pointer shows, and the run ends at its Archive budget.
    steps: [{ expect: [any("Finance events")], act: { click: "text=Finance events" } }, { expect: [button("Archive budget")] }],
  },
  {
    id: "budgets-change-amount-near-miss",
    start: "/budgets/bud_3",
    goal: "how do I change a budget's amount",
    covers: ["overlay-drawer"],
    steps: [
      { expect: [button("Edit budget")], act: { click: 'role=button[name="Edit budget"]' } },
      { expect: [any("Amount")], act: { fill: ['role=dialog >> role=textbox[name="Amount"]', "75000"] } },
      { expect: [button("Save budget")] },
    ],
  },
];

/** "what is a budget": an explanation, never the steps to make one. */
const whatIsABudget: Guide = {
  ...guideOf({ id: "budgets-what-is-near-miss", start: "/budgets", goal: "what is a budget", covers: [], steps: [] }),
  // Answered on the page it is asked on: nothing to press, then done.
  steps: [{ expect: [any("Budgets")] }, DONE],
  says: { all: ["budget"], not: ["New budget", "Create budget"] },
};

export default {
  ...northpine,
  guides: [
    guideOf(addBudget),
    guideOf(addBudgetInForm),
    upToTheCommit("bills-pay-brightdesk"),
    upToTheCommit("policies-new-block-hotels"),
    upToTheCommit("bills-add-wire-vendor"),
    ...nearMisses.map(guideOf),
    whatIsABudget,
  ],
};
