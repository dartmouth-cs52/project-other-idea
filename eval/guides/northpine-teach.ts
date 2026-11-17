import { TASKS, type Task } from "../../testbed/src/tasks/index.ts";
import { any, button, link } from "../../testbed/src/tasks/types.ts";
import type { Guide } from "../guide.ts";
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

export default {
  ...northpine,
  guides: [guideOf(addBudget), upToTheCommit("bills-pay-brightdesk"), upToTheCommit("policies-new-block-hotels"), upToTheCommit("bills-add-wire-vendor")],
};
