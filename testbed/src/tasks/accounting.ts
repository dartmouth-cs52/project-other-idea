import { format, subMonths } from "date-fns";
import { any, button, DONE, link, type Task } from "./types";

// Accounting. The month being closed is last month, so goals name it.
const closing = format(subMonths(new Date(), 1), "MMMM");

export const tasks: Task[] = [
  {
    id: "acct-close-month",
    start: "/accounting",
    goal: `close the books for ${closing}`,
    covers: ["overlay-type-to-confirm", "danger-irreversible"],
    note: "Point at Lock period, then at the LOCK field and the confirm button. Typing LOCK and confirming is the user's call.",
    steps: [
      { expect: [button("Lock period")], act: { click: 'role=button[name="Lock period"]' } },
      { expect: [any("Type LOCK to confirm.")] },
    ],
  },
  {
    id: "acct-sync-from-home",
    start: "/",
    goal: "sync to the ERP",
    covers: ["nav-sidebar", "nav-tabs", "async-job-progress"],
    steps: [
      { expect: [link("Accounting")], act: { click: 'role=link[name="Accounting"s]' } },
      { expect: [button("Sync now"), { label: "ERP sync", role: "tab" }], act: { click: 'role=tab[name="ERP sync"]' } },
      { expect: [button("Sync now")], act: { click: 'role=button[name="Sync now"]' } },
      DONE,
    ],
  },
  {
    id: "acct-retry-copperpot",
    start: "/accounting/sync",
    goal: "retry the Copperpot Catering export that failed",
    covers: ["ambiguity-duplicate-label", "data-error"],
    steps: [{ expect: [button("Retry")], act: { click: 'li:has-text("Copperpot Catering") >> role=button[name="Retry"]' } }, DONE],
  },
  {
    id: "acct-gl-for-software",
    start: "/accounting",
    goal: "where do I change which GL account software goes to",
    covers: ["nav-tabs", "form-combobox"],
    steps: [
      { expect: [{ label: "Mappings", role: "tab" }], act: { click: 'role=tab[name="Mappings"]' } },
      { expect: [any("GL account for Software")], act: { click: 'role=combobox[name="GL account for Software"]' } },
      DONE,
    ],
  },
  {
    id: "acct-map-data-department",
    start: "/accounting/sync",
    goal: "the mileage reimbursement keeps failing to sync, fix it",
    covers: ["form-combobox", "form-save-bar", "ambiguity-link-as-button"],
    steps: [
      { expect: [link("Fix mapping")], act: { click: 'role=link[name="Fix mapping"]' } },
      { expect: [any("Class for Data")], act: { click: 'role=combobox[name="Class for Data"]' } },
      { expect: [any("Research and development")], act: { click: 'role=option[name="Research and development"]' } },
      { expect: [button("Save changes")], act: { click: 'role=button[name="Save changes"]' } },
      DONE,
    ],
  },
  {
    id: "acct-add-subaccount",
    start: "/accounting/chart",
    goal: "add a Conferences sub-account under Travel",
    covers: ["data-tree", "layout-horizontal-scroll", "overlay-tooltip-only", "ambiguity-icon-only", "overlay-modal"],
    note: "The add button is icon-only, named only in its tooltip, in the last column of a table that scrolls sideways.",
    steps: [
      { expect: [any("Add sub-account")], act: { click: '[data-account="gl_6100"] [data-action="add-sub"]' } },
      { expect: [any("Account name")], act: { fill: ['role=textbox[name="Account name"]', "Conferences"] } },
      { expect: [button("Add account")], act: { click: 'role=dialog >> role=button[name="Add account"]' } },
      DONE,
    ],
  },
  {
    id: "acct-turn-off-telecom",
    start: "/accounting/chart",
    goal: "stop people from picking the Telecom account",
    covers: ["form-switch", "overlay-toast-undo", "layout-horizontal-scroll"],
    steps: [{ expect: [{ label: "Active: Telecom", role: "switch" }], act: { click: 'role=switch[name="Active: Telecom"]' } }, DONE],
  },
  {
    id: "acct-find-lodging-code",
    start: "/accounting/chart",
    goal: "what's the GL code for lodging",
    covers: ["data-tree", "data-filter"],
    steps: [{ expect: [any("Search accounts")], act: { fill: ['role=textbox[name="Search accounts"]', "lodging"] } }, { expect: [any("6120")] }, DONE],
  },
  {
    id: "acct-iframe-frequency-cant",
    start: "/accounting/sync",
    goal: "change the Ledgerbook sync frequency to daily",
    covers: ["layout-iframe", "cant-do"],
    note: "Sync frequency is inside Ledgerbook's own settings panel, a sandboxed cross-origin iframe. The guide can't see or point inside it. It should say the setting is in the Ledgerbook connection settings panel at the bottom of the page.",
    steps: [DONE],
  },
  {
    id: "acct-summa-starter",
    start: "/accounting/sync",
    goal: "connect Summa Accounting for our UK entity",
    lab: { plan: "starter" },
    covers: ["access-plan"],
    steps: [{ expect: [button("Upgrade to Growth")] }],
  },
  {
    id: "acct-lock-as-employee",
    start: "/accounting",
    goal: `lock ${closing}`,
    lab: { role: "employee" },
    covers: ["access-role", "ambiguity-disabled-reason", "cant-do"],
    note: "Lock period is disabled for Employees. Only Admin or Finance can lock a period.",
    steps: [{ expect: [button("Lock period")] }],
  },
  {
    id: "acct-tick-receipts-task",
    start: "/accounting",
    goal: "mark chasing missing receipts as done on the close checklist",
    covers: ["form-autosave"],
    steps: [{ expect: [{ label: "Chase missing receipts", role: "checkbox" }], act: { click: 'role=checkbox[name="Chase missing receipts"]' } }, DONE],
  },
  {
    id: "acct-last-failed-sync",
    start: "/accounting",
    goal: "when did the ERP sync last fail completely",
    covers: ["nav-tabs", "data-sort"],
    steps: [{ expect: [{ label: "ERP sync", role: "tab" }, link("View sync details")], act: { click: 'role=tab[name="ERP sync"]' } }, { expect: [any("Failed")] }, DONE],
  },
  {
    id: "acct-journal-entry-cant",
    start: "/accounting",
    goal: "post a manual journal entry for the October rent accrual",
    covers: ["cant-do"],
    note: "Northpine has no journal entries. Accruals are booked in Ledgerbook. The checklist has a task for it, but no way to post one here.",
    steps: [DONE],
  },
];
