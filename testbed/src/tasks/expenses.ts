import { any, button, DONE, link, type Task } from "./types";

// tx_00012 is a Tandem Bikes Rental charge with a missing receipt in the
// default seed, so the split and lost receipt tasks start there.

export const tasks: Task[] = [
  {
    id: "expenses-upload-receipt-skyline",
    start: "/expenses",
    goal: "where do I upload a receipt for the Skyline Air charge",
    steps: [
      { expect: [link("Missing receipts")], act: { click: 'role=tab[name^="Missing receipts"]' } },
      { expect: [any("Search expenses")], act: { fill: ['role=textbox[name="Search expenses"]', "Skyline Air"] } },
      { expect: [any("Skyline Air")], act: { click: "text=Skyline Air >> nth=0" } },
      { expect: [button("Drop the receipt here, or click to browse")] },
      DONE,
    ],
    covers: ["nav-tabs", "data-filter", "data-virtual", "overlay-drawer", "form-upload"],
  },
  {
    id: "expenses-split",
    start: "/expenses/tx_00012",
    goal: "split this transaction, $150 is transport and the rest was a meal",
    steps: [
      { expect: [button("Split transaction")], act: { click: 'main >> role=button[name="Split transaction"]' } },
      { expect: [any("Line 1 amount")], act: { fill: ['role=spinbutton[name="Line 1 amount"]', "150"] } },
      { expect: [any("Line 2 category")], act: { click: 'role=combobox[name="Line 2 category"]' } },
      { expect: [any("Meals")], act: { click: "role=option[name=/Meals/]" } },
      { expect: [any("Line 2 amount")], act: { fill: ['role=spinbutton[name="Line 2 amount"]', "67.26"] } },
      { expect: [button("Split transaction")], act: { click: 'role=dialog >> role=button[name="Split transaction"]' } },
      DONE,
    ],
    covers: ["overlay-modal", "form-combobox", "form-validation", "nav-deep-route"],
  },
  {
    id: "expenses-export-last-month-csv",
    start: "/expenses",
    goal: "export last month's expenses to CSV",
    steps: [
      { expect: [button("Any date")], act: { click: 'role=button[name="Any date"]' } },
      { expect: [button("Last month")], act: { click: 'role=button[name="Last month"]' } },
      { expect: [button("Export")], act: { click: 'role=button[name="Export"]' } },
      { expect: [{ label: "Download CSV", role: "menuitem" }], act: { click: 'role=menuitem[name="Download CSV"]' } },
      DONE,
    ],
    covers: ["form-date-range", "overlay-popover", "overlay-dropdown", "ambiguity-duplicate-label"],
  },
  {
    id: "expenses-lost-receipt",
    start: "/expenses/tx_00012",
    goal: "I lost the receipt for this, what do I do",
    steps: [
      { expect: [button("I lost this receipt")], act: { click: 'main >> role=button[name="I lost this receipt"]' } },
      { expect: [any("What did you buy?")], act: { fill: ['role=textbox[name="What did you buy?"]', "Bike rental for the offsite"] } },
      { expect: [any("I confirm this was a business expense and I can't get a copy of the receipt.")], act: { click: "text=I confirm this was a business expense" } },
      { expect: [button("Continue")], act: { click: 'role=button[name="Continue"]' } },
      { expect: [button("Sign and submit")], act: { click: 'role=button[name="Sign and submit"]' } },
      DONE,
    ],
    covers: ["overlay-modal", "overlay-nested-modal", "form-validation"],
  },
  {
    id: "expenses-old-address-missing",
    start: "/transactions",
    goal: "show me the charges that are missing receipts",
    steps: [{ expect: [link("Missing receipts")], act: { click: 'role=tab[name^="Missing receipts"]' } }, DONE],
    covers: ["nav-redirect", "nav-tabs"],
  },
  {
    id: "expenses-bulk-categorize",
    start: "/expenses",
    goal: "mark all the Volt Electronics charges as Equipment",
    steps: [
      { expect: [any("Search expenses")], act: { fill: ['role=textbox[name="Search expenses"]', "Volt Electronics"] } },
      { expect: [any("Select all")], act: { click: 'role=checkbox[name="Select all"]' } },
      { expect: [button("Categorize")], act: { click: 'role=button[name="Categorize"]' } },
      { expect: [any("Equipment")], act: { click: "role=option[name=/Equipment/]" } },
      DONE,
    ],
    covers: ["data-filter", "data-bulk", "overlay-popover", "form-combobox"],
  },
  {
    id: "expenses-attach-from-row",
    start: "/expenses?receipt=missing",
    goal: "can I attach a receipt right from the list without opening the charge",
    steps: [
      // The paperclip has no accessible name. Only its tooltip says "Attach receipt".
      { expect: [any("Attach receipt")], act: { click: "[role=row]:has([role=cell]) >> nth=0 >> button:has(svg.lucide-paperclip)" } },
      { expect: [button("Drop the receipt here, or click to browse")] },
      DONE,
    ],
    covers: ["data-hover-actions", "ambiguity-icon-only", "overlay-tooltip-only", "overlay-modal"],
  },
  {
    id: "expenses-show-gl-column",
    start: "/expenses",
    goal: "how do I see which GL account each expense posts to",
    steps: [
      { expect: [button("Columns")], act: { click: 'role=button[name="Columns"]' } },
      { expect: [any("GL account")], act: { click: 'role=checkbox[name="GL account"]' } },
      DONE,
    ],
    covers: ["data-columns", "overlay-popover"],
  },
  {
    id: "expenses-recategorize-autosave",
    start: "/expenses",
    goal: "the Summit Conferences charge should be Marketing, how do I change it",
    steps: [
      { expect: [any("Search expenses")], act: { fill: ['role=textbox[name="Search expenses"]', "Summit Conferences"] } },
      { expect: [any("Summit Conferences")], act: { click: "text=Summit Conferences >> nth=0" } },
      { expect: [any("Category")], act: { click: 'role=combobox[name="Category"]' } },
      // No Save button after this. The change saves itself and shows "Saved".
      { expect: [any("Marketing")], act: { click: "role=option[name=/Marketing/]" } },
      DONE,
    ],
    covers: ["overlay-drawer", "form-combobox", "form-autosave"],
  },
  {
    id: "expenses-employee-approve-own",
    start: "/expenses",
    lab: { role: "employee" },
    goal: "how do I approve my own expenses",
    steps: [{ expect: [] }],
    covers: ["access-role", "ambiguity-disabled-reason", "cant-do"],
    note: "Employees can't approve charges. Approve is disabled with a tooltip saying only Admin or Finance can review expenses.",
  },
  {
    id: "expenses-delete-charge",
    start: "/expenses/tx_00012",
    goal: "delete this charge, it was a mistake",
    steps: [{ expect: [] }],
    covers: ["cant-do"],
    note: "Card charges can't be deleted. The closest actions are Mark as personal or Flag.",
  },
  {
    id: "expenses-mark-personal",
    start: "/expenses/tx_00012",
    goal: "I put a personal purchase on my company card by accident",
    steps: [{ expect: [button("Mark as personal")], act: { click: 'role=button[name="Mark as personal"]' } }, DONE],
    covers: ["overlay-toast-undo"],
  },
];
