import { any, button, DONE, link, type Task } from "./types";

// Reports. Three saved reports come with the seed: "Spend by department"
// (rep_1, emailed monthly), "Top merchants this quarter" (rep_2, not scheduled)
// and "Missing receipts by person" (rep_3, weekly). The builder lives at
// /reports/new and /reports/:id.

export const tasks: Task[] = [
  {
    id: "reports-merchant-last-quarter",
    start: "/reports",
    goal: "build a report of spend by merchant for last quarter",
    covers: ["overlay-dropdown", "form-custom-select", "viz-svg", "ambiguity-icon-only"],
    steps: [
      { expect: [button("New report")], act: { click: 'role=button[name="New report"]' } },
      // Each field has a small + button named "Add <field>". Dragging works too.
      { expect: [button("Add Merchant")], act: { click: 'role=button[name="Add Merchant"]' } },
      { expect: [any("Group by Merchant")], act: { click: 'role=menuitem[name="Group by Merchant"]' } },
      { expect: [any("Date range")], act: { click: 'role=combobox[name="Date range"]' } },
      { expect: [any("Last quarter")], act: { click: 'role=option[name="Last quarter"]' } },
      DONE,
    ],
  },
  {
    id: "reports-email-me-monday",
    start: "/reports/rep_2",
    goal: "email me this report every Monday",
    covers: ["overlay-drawer", "form-multiselect", "form-conditional"],
    steps: [
      { expect: [button("Schedule")], act: { click: 'role=button[name="Schedule"]' } },
      // Weekly on Monday is already picked. Only the recipient is missing.
      { expect: [any("Add recipients")], act: { click: 'role=button[name="Add recipients"]' } },
      { expect: [any("Avery Stone avery.stone@northpine.example"), any("Avery Stone")], act: { click: "role=option[name=/^Avery Stone/]" } },
      { expect: [button("Save schedule")], act: { click: 'role=button[name="Save schedule"]' } },
      DONE,
    ],
  },
  {
    id: "reports-schedule-on-starter",
    start: "/reports/rep_2",
    lab: { plan: "starter" },
    goal: "send this report to the finance team every week",
    covers: ["access-plan", "overlay-drawer"],
    note: "Scheduled reports are on the Growth plan. The schedule panel opens with an upgrade prompt instead of the form, so the answer is that the plan has to change first.",
    steps: [{ expect: [button("Schedule")], act: { click: 'role=button[name="Schedule"]' } }, { expect: [button("Upgrade to Growth")] }, DONE],
  },
  {
    id: "reports-merchants-by-month",
    start: "/reports",
    goal: "show me every merchant's spend month by month for the past year",
    covers: ["ambiguity-duplicate-label", "layout-horizontal-scroll", "layout-sticky"],
    steps: [
      // Eight template cards, each with its own "Use template" button.
      { expect: [button("Use template")], act: { click: 'div.rounded-lg:has(h3:text-is("Merchants by month")) >> role=button[name="Use template"]' } },
      DONE,
    ],
  },
  {
    id: "reports-delete-missing-receipts",
    start: "/reports",
    goal: "delete the missing receipts report, we don't use it",
    covers: ["ambiguity-icon-only", "overlay-tooltip-only", "overlay-dropdown", "danger-delete", "overlay-toast-undo"],
    note: 'The row\'s menu button has no accessible name. Its only label is the tooltip "More".',
    steps: [
      { expect: [any("More")], act: { click: 'li:has-text("Missing receipts by person") >> button[aria-haspopup="menu"]' } },
      { expect: [any("Delete")], act: { click: 'role=menuitem[name="Delete"]' } },
      { expect: [button("Delete report")], act: { click: 'role=button[name="Delete report"]' } },
      DONE,
    ],
  },
  {
    id: "reports-download-spreadsheet",
    start: "/reports/rep_1",
    goal: "can I get this as a spreadsheet",
    covers: ["overlay-dropdown"],
    steps: [
      { expect: [button("Export")], act: { click: 'role=button[name="Export"]' } },
      { expect: [any("Download CSV")], act: { click: 'role=menuitem[name="Download CSV"]' } },
      DONE,
    ],
  },
  {
    id: "reports-send-to-slack",
    start: "/reports/rep_1",
    goal: "post this report in our finance Slack channel",
    covers: ["overlay-dropdown", "ambiguity-disabled-reason", "cant-do"],
    note: '"Send to Slack" is in the Export menu but disabled until Slack is connected in Settings, Integrations. The right answer says so rather than pressing it.',
    steps: [{ expect: [button("Export")], act: { click: 'role=button[name="Export"]' } }, { expect: [any("Send to Slack Connect Slack in Settings first"), any("Send to Slack")] }, DONE],
  },
  {
    id: "reports-employee-cant-create",
    start: "/reports",
    lab: { role: "employee" },
    goal: "I want to build a report of my team's spend",
    covers: ["access-role", "ambiguity-disabled-reason", "cant-do"],
    note: 'Employees can\'t create reports. "New report" and every "Use template" button are disabled, with the reason in a tooltip.',
    steps: [{ expect: [button("New report")] }, DONE],
  },
  {
    id: "reports-from-cards-page",
    start: "/cards",
    goal: "where can I see how much each department spent",
    covers: ["nav-sidebar"],
    steps: [
      { expect: [link("Reports")], act: { click: 'role=link[name="Reports"s]' } },
      { expect: [link("Spend by department")], act: { click: 'role=link[name="Spend by department"]' } },
      DONE,
    ],
  },
];
