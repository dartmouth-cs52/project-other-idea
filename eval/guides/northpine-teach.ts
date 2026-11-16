import { any, button, link, type Task } from "../../testbed/src/tasks/types.ts";
import northpine, { guideOf } from "./northpine.ts";

// The check for Teach Haptic (docs/corrections.md#teach-haptic): "how do I
// add a budget" asked from Northpine's home page, as a visitor would ask it,
// with the steps a person at the company taught by doing the task. Run once
// on a copy of Northpine's site without the taught route and once on one
// with it, against a server that runs this branch:
//
//   NORTHPINE_SITE=site_teach_test npm run eval:guides -- northpine-teach --server <address> --repeat 3
//
// It ends where the taught route leaves the click for the visitor: Create
// budget pointed at, not pressed.

const task: Task = {
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

export default { ...northpine, guides: [guideOf(task)] };
