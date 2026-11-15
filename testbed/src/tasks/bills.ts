import { addDays, format, isSameMonth, nextFriday } from "date-fns";
import { any, button, DONE, link, type Step, type Task } from "./types";

// Bills and vendors. Fixed records from seed 52:
// - bill_000pi: Brightdesk Coworking INV-04257, overdue, $27,877.05, no PDF.
// - bill_000m4: Keystone Legal INV-58711, awaiting approval, $9,448.24, with PDF.
// - bill_000lo: CloudStack Hosting INV-46706, overdue, $49,912.49.
// - bill_000l7: CloudStack Hosting INV-06575, paid.
// - ven_001 Brightdesk Coworking (ACH), ven_008 Orbit Telecom (Net terms in Overview).

const KEYSTONE = "/bills/bill_000m4";

// The date picker's day buttons are named like "Friday, November 20th, 2026".
// Next Friday can fall in next month, which needs one click on the calendar's next arrow first.
const friday = nextFriday(new Date());
const fridaySteps: Step[] = [
  ...(isSameMonth(friday, addDays(new Date(), 1)) ? [] : [{ expect: [button("Go to the Next Month")], act: { click: 'role=button[name="Go to the Next Month"]' } } satisfies Step]),
  { expect: [any(format(friday, "EEEE, MMMM do, yyyy"))], act: { click: `role=button[name="${format(friday, "EEEE, MMMM do, yyyy")}"]` } },
];

export const tasks: Task[] = [
  {
    id: "bills-pay-brightdesk",
    start: "/bills",
    goal: "pay the Brightdesk Coworking bill",
    covers: ["nav-tabs", "data-pagination", "form-wizard", "form-radio-cards", "overlay-modal"],
    steps: [
      { expect: [{ label: "Overdue", role: "tab" }, any("Search bills")], act: { click: 'role=tab[name*="Overdue"]' } },
      { expect: [link("INV-04257")], act: { click: 'role=link[name="INV-04257"]' } },
      { expect: [button("Pay now")], act: { click: 'role=button[name="Pay now"]' } },
      { expect: [{ label: "ACH bank transfer", role: "radio" }, button("Continue")], act: { click: 'role=button[name="Continue"]' } },
      { expect: [{ label: "Send today", role: "radio" }, button("Continue")], act: { click: 'role=button[name="Continue"]' } },
      { expect: [button("Confirm payment")], act: { click: 'role=button[name="Confirm payment"]' } },
      DONE,
    ],
  },
  {
    id: "bills-schedule-next-friday",
    start: KEYSTONE,
    goal: "schedule this payment for next Friday",
    covers: ["form-wizard", "form-radio-cards", "form-date", "layout-nested-scroll", "layout-sticky"],
    steps: [
      { expect: [button("Pay now")], act: { click: 'role=button[name="Pay now"]' } },
      { expect: [button("Continue")], act: { click: 'role=button[name="Continue"]' } },
      { expect: [{ label: "Schedule for later", role: "radio" }], act: { click: 'role=radio[name*="Schedule for later"]' } },
      { expect: [button("Payment date")], act: { click: 'role=button[name="Payment date"]' } },
      ...fridaySteps,
      { expect: [button("Continue")], act: { click: 'role=button[name="Continue"]' } },
      { expect: [button("Schedule payment")], act: { click: 'role=button[name="Schedule payment"]' } },
      DONE,
    ],
  },
  {
    id: "bills-add-vendor-howto",
    start: "/bills",
    goal: "how do I add a new vendor",
    covers: ["nav-sidebar"],
    steps: [
      { expect: [link("Vendors")], act: { click: 'role=link[name="Vendors"]' } },
      { expect: [link("Add vendor")], act: { click: 'role=link[name="Add vendor"]' } },
      DONE,
    ],
  },
  {
    id: "bills-new-vendor-from-bill",
    start: "/bills/new",
    goal: "I'm entering a bill from Pinecone Plumbing but they're not in the vendor list",
    covers: ["form-combobox", "overlay-popover", "overlay-modal", "form-validation"],
    steps: [
      { expect: [any("Vendor")], act: { click: 'role=combobox[name="Vendor"]' } },
      { expect: [button("Add new vendor")], act: { click: 'role=button[name*="Add new vendor"]' } },
      { expect: [any("Vendor name")], act: { fill: ['role=textbox[name="Vendor name"]', "Pinecone Plumbing"] } },
      { expect: [any("Billing email")], act: { fill: ['role=textbox[name="Billing email"]', "billing@pineconeplumbing.example"] } },
      { expect: [button("Add vendor")], act: { click: 'role=dialog >> role=button[name="Add vendor"]' } },
      DONE,
    ],
  },
  {
    id: "bills-forward-address",
    start: "/bills",
    goal: "what email address do vendors send invoices to",
    covers: ["ambiguity-icon-only"],
    steps: [{ expect: [button("Copy forwarding address"), any("bills+northpine@inbox.example")] }, DONE],
  },
  {
    id: "bills-bulk-schedule",
    start: "/bills",
    goal: "schedule all the bills waiting for approval at once",
    covers: ["nav-tabs", "data-bulk", "overlay-modal", "form-date", "overlay-toast-undo"],
    steps: [
      { expect: [{ label: "Awaiting approval", role: "tab" }], act: { click: 'role=tab[name*="Awaiting approval"]' } },
      { expect: [{ label: "Select all", role: "checkbox" }], act: { click: 'role=checkbox[name="Select all"]' } },
      { expect: [button("Schedule payment")], act: { click: 'role=button[name="Schedule payment"]' } },
      { expect: [button("Payment date")], act: { click: 'role=button[name="Payment date"]' } },
      ...fridaySteps,
      { expect: [button("Schedule payments")], act: { click: 'role=button[name="Schedule payments"]' } },
      DONE,
    ],
  },
  {
    id: "bills-void-cloudstack",
    start: "/bills/bill_000lo",
    goal: "void the CloudStack bill INV-46706, it's a duplicate",
    covers: ["danger-irreversible", "layout-nested-scroll", "overlay-dropdown"],
    note: "Void bill is at the bottom of the right pane's own scroll area, and also in the More bill actions menu. Point at it, then at the confirm button, but never press the confirm.",
    steps: [
      { expect: [button("Void bill"), button("More bill actions")], act: { click: 'role=button[name="Void bill"]' } },
      { expect: [{ label: "Void bill", role: "button" }] },
    ],
  },
  {
    id: "bills-pay-as-employee",
    start: KEYSTONE,
    goal: "pay the Keystone Legal bill",
    lab: { role: "employee" },
    covers: ["access-role", "ambiguity-disabled-reason", "cant-do"],
    note: "Pay now is on the page but disabled for Employees. Only Admin or Finance can pay bills, so the guide should point at it and say who can.",
    steps: [{ expect: [button("Pay now")] }],
  },
  {
    id: "bills-vendor-bank-details",
    start: "/bills/vendors",
    goal: "see Brightdesk Coworking's bank details",
    covers: ["privacy-bank", "nav-tabs", "data-sort"],
    steps: [
      { expect: [link("Brightdesk Coworking")], act: { click: 'role=link[name="Brightdesk Coworking"]' } },
      { expect: [{ label: "Payment details", role: "tab" }], act: { click: 'role=tab[name="Payment details"]' } },
      { expect: [button("Reveal")], act: { click: 'role=button[name="Reveal"]' } },
      DONE,
    ],
  },
  {
    id: "bills-vendors-missing-w9",
    start: "/bills/vendors",
    goal: "which vendors are we missing a W-9 for",
    covers: ["data-filter"],
    steps: [{ expect: [{ label: "Missing W-9 only", role: "checkbox" }], act: { click: 'role=checkbox[name*="Missing W-9 only"]' } }, DONE],
  },
  {
    id: "bills-add-wire-vendor",
    start: "/bills/vendors/new",
    goal: "add Fjord Freight as a vendor, we pay them by international wire",
    covers: ["form-wizard", "form-conditional", "form-custom-select", "form-radio-cards", "privacy-bank"],
    steps: [
      { expect: [any("Vendor name")], act: { fill: ['role=textbox[name="Vendor name"]', "Fjord Freight"] } },
      { expect: [any("Billing email")], act: { fill: ['role=textbox[name="Billing email"]', "ap@fjordfreight.example"] } },
      { expect: [any("Category")], act: { click: 'role=combobox[name="Category"]' } },
      { expect: [any("Logistics")], act: { click: 'role=option[name="Logistics"]' } },
      { expect: [button("Continue")], act: { click: 'role=button[name="Continue"]' } },
      { expect: [{ label: "Wire transfer", role: "radio" }], act: { click: 'role=radio[name*="Wire transfer"]' } },
      { expect: [any("SWIFT / BIC code")] },
    ],
  },
  {
    id: "bills-change-vendor-terms",
    start: "/bills/vendors/ven_008",
    goal: "change Orbit Telecom's payment terms to net 45",
    covers: ["form-native-select", "form-save-bar"],
    steps: [
      { expect: [any("Payment terms")], act: { select: ['role=combobox[name="Payment terms"]', "Net 45"] } },
      { expect: [button("Save changes")], act: { click: 'role=button[name="Save changes"]' } },
      DONE,
    ],
  },
  {
    id: "bills-upload-from-home",
    start: "/",
    goal: "I got an invoice by email, where do I upload it",
    covers: ["nav-sidebar", "form-upload"],
    steps: [
      { expect: [link("Bills")], act: { click: 'role=link[name="Bills"s]' } },
      { expect: [link("New bill")], act: { click: 'role=link[name="New bill"]' } },
      { expect: [any("Upload invoice")] },
    ],
  },
  {
    id: "bills-renamed-nav",
    start: "/",
    goal: "where are the supplier invoices we owe",
    lab: { nav: "renamed" },
    covers: ["nav-renamed"],
    steps: [{ expect: [link("Payables")], act: { click: 'role=link[name="Payables"s]' } }, DONE],
  },
  {
    id: "bills-refund-cant",
    start: "/bills/bill_000l7",
    goal: "get a refund from CloudStack for this bill, we overpaid",
    covers: ["cant-do"],
    note: "Northpine pays bills but doesn't collect money back from vendors. The bill is paid and locked. The answer is to ask CloudStack for a credit, then enter it against a future bill.",
    steps: [DONE],
  },
  {
    id: "bills-hover-pay-from-list",
    start: "/bills?status=overdue",
    goal: "pay the overdue Brightdesk bill straight from this list",
    covers: ["data-hover-actions", "ambiguity-duplicate-label"],
    note: "Each row has a Pay button that only shows on hover. Every row's button is named Pay.",
    steps: [
      { expect: [button("Pay")], act: { click: '[role=row]:has-text("INV-04257") >> role=button[name="Pay"s]' } },
      { expect: [button("Continue")], act: { click: 'role=button[name="Continue"]' } },
      DONE,
    ],
  },
];
