import { TASKS, type Task } from "../../testbed/src/tasks/index.ts";
import { any, button, DONE as TASK_DONE, type Step as TaskStep } from "../../testbed/src/tasks/types.ts";
import type { Kind } from "../cases.ts";
import { DONE, type Guide, type GuideSet, type Reached, type Says, type Step } from "../guide.ts";

// Northpine, the made-up spend management app in testbed/, served on this
// machine by its own dev server (cd testbed && npm run dev). Its 179 tasks are
// written beside its pages, in testbed/src/tasks, in nearly the shape of a
// guide. This file turns each one into a guide:
//
// - The task's test panel settings (role, plan, layout) go on the start
//   address as ?lab.<name>=<value>, as the task file says they should. So does
//   where the app loads Haptic from: the app adds the script tag itself, the
//   way a customer would, and here it points at the app's own origin, where
//   eval/browser.ts answers it. The test panel's own button is hidden, since a
//   customer's page would not have it.
// - A task that stops at a control that must not be pressed ends there. The
//   task files write a DONE after such a step, which no run would reach.
// - A few steps are put in place of the task's own (REPLACED): a pick the
//   task leaves without a control, a click on a heading that only leaves a
//   field, and a fact that is answered in words rather than pointed at.
// - A task that ends with DONE is given a `reached` below: what the page
//   shows once the visitor has got there. The task files do not carry one.
//   Several are toasts, which go after a few seconds; a lasting change is
//   used wherever the page has one.
//
// Recording needs the site's context first: npm run tag -- --url <origin>
// --id site_testbed --name Northpine --notes testbed/haptic-notes.md
//
// NORTHPINE_SITE names another site id to run them as, like one built with the
// help docs as testbed/README.md has it, so that Answers is on.
//
// Three more guides, in FORMS below, are about what a form needs before its
// submit button. They are the ones eval/cases/northpine.json was recorded from.

const ORIGIN = process.env.NORTHPINE_URL || "http://localhost:4200";
const SITE = process.env.NORTHPINE_SITE || "site_testbed";

/** The app as a task finds it, before the task's own settings. */
const BASE: Record<string, string> = { role: "admin", plan: "growth", nav: "classic", locale: "en", labButton: "0" };

/**
 * Steps put in place of a task's own, by step number. Where the visitor only
 * picks from what the step before opened, the task leaves the step empty; here
 * it names what is picked. Where the task clicks a heading to leave an inline
 * field, the visitor presses Enter in the field instead, which a guide can say.
 */
const REPLACED: Record<string, Record<number, Step[]>> = {
  "approvals-delegate-vacation": {
    // The task picks whoever the list shows first. Here the visitor looks for someone by name, as the transfer-ownership task does.
    3: [
      { expect: [{ label: "Search people…", role: "combobox" }], act: { fill: ["[cmdk-input]", "Lilly"] } },
      { expect: [{ label: "Lilly O'Keefe", role: "option" }], act: { click: `role=option[name^="Lilly O'Keefe"]` } },
    ],
    // Day buttons show the day and are named by the whole date, so the widget lists them as "20 (Friday, November 20th, 2026)".
    5: [{ expect: [{ label: "20 (Friday, November 20th, 2026)", role: "button" }], act: { click: 'role=button[name*="November 20th"]' } }],
    6: [{ expect: [{ label: "27 (Friday, November 27th, 2026)", role: "button" }], act: { click: 'role=button[name*="November 27th"]' } }],
  },
  "policies-meal-receipt-threshold": {
    3: [{ expect: [{ label: "Receipt threshold for Meals", role: "textbox" }], act: { press: ['role=textbox[name="Receipt threshold for Meals"]', "Enter"] }, say: "Press Enter to save it." }],
  },
  "policies-per-diem-edit": {
    3: [{ expect: [{ label: "Meals rate for New York, NY", role: "textbox" }], act: { press: ['role=textbox[name="Meals rate for New York, NY"]', "Enter"] }, say: "Press Enter to save it." }],
  },
  // The task stops once the new name is typed, which leaves the old name on the page. Pressing Enter saves it.
  "cards-rename": {
    3: [{ expect: [{ label: "nickname", role: "textbox" }], act: { press: ['role=textbox[name="nickname"]', "Enter"] }, say: "Press Enter to save it." }, DONE],
  },
  // The answer is a code on the page, not a control: the guide ends when the sentence says it.
  "acct-find-lodging-code": { 2: [DONE] },
};

/** What the last sentence has to say, for a task whose answer is a fact on the page. */
const SAYS: Record<string, Says> = {
  "acct-find-lodging-code": { all: ["6120"] },
};

/** How to tell that a guide which ends with DONE got there. */
const REACHED: Record<string, Reached> = {
  "shell-palette-vendor": { url: "/bills/vendors/[^/?]+", selector: 'h1:has-text("Keystone Legal")' },
  "shell-entity-uk": { url: "/expenses", selector: 'button[aria-label="Switch entity"]:has-text("Northpine Ltd")' },
  "shell-renamed-expenses": { url: "/expenses(\\?|$)" },
  "shell-spanish-approvals": { url: "/approvals(\\?|$)" },
  "shell-rail-approvals": { url: "/approvals(\\?|$)" },
  "shell-dark-mode": { selector: "html.dark" },
  "shell-sign-out": { url: "/signin" },
  "shell-shortcuts": { selector: ":is(dialog[open], [role=dialog]) >> text=Keyboard shortcuts" },
  "shell-shortcuts-native": { selector: ":is(dialog[open], [role=dialog]) >> text=Keyboard shortcuts" },
  "shell-notification-bill": { url: "/bills/[^/?]+", text: "Keystone Legal" },
  "shell-redirect-review": { url: "review=needs_review" },
  "shell-banner-new-bill": { url: "/bills/new" },
  "shell-contact-support": { url: "/help/contact" },
  "shell-live-feed": { url: "/expenses(\\?|$)" },
  "shell-help-center": { url: "/help(\\?|$)" },
  "shell-chart-year": { selector: 'role=radio[name="12 months"][checked=true]' },
  "shell-breadcrumb-back": { url: "/cards(\\?|$)" },
  "shell-slow-issue-card": { url: "/cards/new" },
  "shell-change-phone": { url: "/settings/profile" },
  "cards-freeze-mine": { url: "/cards/[^/?]+", selector: 'role=button[name="Unfreeze card"]' },
  "cards-freeze-wrong-page": { url: "/cards/[^/?]+", selector: 'role=button[name="Unfreeze card"]' },
  "cards-declined-frozen": { url: "/cards/[^/?]+", selector: 'role=button[name="Freeze card"]' },
  "cards-see-cvc": { selector: 'role=button[name="Hide"]' },
  "cards-number-from-home": { selector: 'role=button[name="Hide"]' },
  "cards-lost-teammate": { text: "Replacement ordered" },
  "cards-software-subscription-employee": { text: "Request sent" },
  "cards-issue-virtual": { url: "/cards/[^/?]+", selector: 'h1:has-text("Ads budget")' },
  "cards-physical-for-me": { text: "Limits and controls" },
  "cards-raise-limit": { text: "$2,500.00" },
  "cards-raise-limit-employee": { text: "Limit increase requested" },
  "cards-rename": { selector: 'h1:has-text("Q1 offsite")' },
  "cards-cancel": { text: "cancelled" },
  "cards-freeze-department": { text: "cards frozen" },
  "cards-reveal-someone-else-cant": { url: "/cards/[^/?]+", selector: `h1:has-text("Malika's card")` },
  "rmb-mileage-client-visit": { url: "/reimbursements/[^/?]+", selector: 'h1:has-text("Portland, OR to Salem, OR")' },
  "rmb-mileage-wrong-page": { url: "kind=mileage" },
  "rmb-mileage-manual-miles": { url: "kind=mileage", selector: 'role=textbox[name="Miles one way"]' },
  "rmb-team-lunch": { url: "/reimbursements/[^/?]+", selector: 'h1:has-text("Basil Street Bistro")' },
  "rmb-split-hotel": { url: "/reimbursements/[^/?]+", selector: 'h1:has-text("Harborview Hotels")' },
  "rmb-per-diem": { selector: "role=dialog" },
  "rmb-per-diem-starter-cant": { selector: "role=button[name=/Upgrade/]" },
  "rmb-fix-rejected": { url: "/reimbursements/[^/?]+", text: "Submitted" },
  "rmb-filter-rejected": { url: "status=rejected" },
  "rmb-expand-row": { selector: 'role=button[name="Collapse row"]' },
  "rmb-approve-team": { url: "/reimbursements/[^/?]+", text: "Approved" },
  "rmb-reject-with-reason": { url: "/reimbursements/[^/?]+", text: "Rejected" },
  "rmb-comment": { text: "Which conference was this for?" },
  "rmb-withdraw-approved-cant": { url: "/reimbursements/[^/?]+", selector: 'h1:has-text("Seattle, WA to Corvallis, OR")' },
  "expenses-split": { url: "/expenses/[^/?]+", selector: 'h1:has-text("$150.00")' },
  "expenses-export-last-month-csv": { text: "as CSV" },
  "expenses-lost-receipt": { text: "Affidavit filed" },
  "expenses-old-address-missing": { url: "receipt=missing" },
  "expenses-bulk-categorize": { text: "to Equipment" },
  "expenses-show-gl-column": { selector: 'role=columnheader[name="GL account"]' },
  "expenses-recategorize-autosave": { text: "Saved" },
  "expenses-mark-personal": { text: "Personal" },
  "approvals-approve-all-reimbursements": { text: "requests" },
  "approvals-reject-with-reason": { url: "/approvals/[^/?]+", text: "Rejected" },
  "approvals-delegate-vacation": { text: "delegated" },
  "approvals-board-escalate": { text: "Moved to Finance" },
  "approvals-open-linked-bill": { url: "/bills/[^/?]+" },
  "approvals-comment": { text: "Which PO is this for?" },
  "approvals-board-view": { url: "view=board" },
  "policies-meal-approver": { selector: 'role=combobox[name="Approver role"] >> text=Finance team' },
  "policies-turn-on-weekend": { selector: 'role=switch[name="Flag weekend spend enabled"][checked=true]' },
  "policies-meal-receipt-threshold": { selector: 'role=button[name="Edit Receipt threshold for Meals"] >> text=$10' },
  "policies-new-block-hotels": { url: "/policies/[^/?]+", selector: 'h1:has-text("Block hotels over $400")' },
  "policies-per-diem-edit": { selector: 'role=button[name="Edit Meals rate for New York, NY"] >> text=$85' },
  "policies-publish-handbook": { text: "Version 4" },
  "bills-pay-brightdesk": { text: "sent to Brightdesk Coworking" },
  "bills-schedule-next-friday": { text: "scheduled for" },
  "bills-add-vendor-howto": { url: "/bills/vendors/new" },
  "bills-new-vendor-from-bill": { selector: 'role=combobox[name="Vendor"] >> text=Pinecone Plumbing' },
  "bills-bulk-schedule": { text: "payments scheduled" },
  "bills-vendor-bank-details": { selector: 'role=button[name="Hide"]' },
  "bills-vendors-missing-w9": { url: "w9=missing" },
  "bills-change-vendor-terms": { text: "Net 45" },
  "bills-renamed-nav": { url: "/bills(\\?|$)" },
  "bills-hover-pay-from-list": { selector: "role=dialog >> text=Send today" },
  "acct-sync-from-home": { url: "/accounting/sync" },
  "acct-retry-copperpot": { text: "Copperpot Catering" },
  "acct-gl-for-software": { selector: "role=listbox" },
  "acct-map-data-department": { text: "Mappings saved" },
  "acct-add-subaccount": { text: "Conferences" },
  "acct-turn-off-telecom": { selector: 'role=switch[name="Active: Telecom"][checked=false]' },
  "acct-tick-receipts-task": { selector: 'role=checkbox[name="Chase missing receipts"][checked=true]' },
  "reports-merchant-last-quarter": { selector: 'role=combobox[name="Date range"] >> text=Last quarter' },
  "reports-email-me-monday": { text: "Emailed weekly" },
  "reports-merchants-by-month": { url: "template=merchant-by-month" },
  "reports-delete-missing-receipts": { absent: 'li:has-text("Missing receipts by person")' },
  "reports-download-spreadsheet": { text: "CSV downloaded" },
  "reports-from-cards-page": { url: "/reports/rep_1" },
  "budgets-new-marketing": { url: "/budgets/[^/?]+", selector: 'h1:has-text("Marketing programs")' },
  "budgets-which-are-over": { url: "/budgets", text: "over" },
  "budgets-raise-platform-travel": { url: "/budgets/[^/?]+", text: "$75K" },
  "budgets-rollover": { selector: 'role=switch[name="Roll over unused budget"][checked=true]' },
  "budgets-archive-finance-events": { text: "Archived" },
  "budgets-this-quarter": { selector: 'role=radio[name="This quarter"][checked=true]' },
  "people-invite-new-hire": { text: "Invite sent" },
  "people-make-roma-manager": { text: "access" },
  "people-who-is-in-platform": { url: "department=" },
  "people-offboard-jaren": { text: "offboarded" },
  "people-reset-two-factor": { text: "Two-factor reset" },
  "people-reactivate-willa": { text: "can sign in again" },
  "people-move-brand-under-sales": { text: "Saved Brand" },
  "people-who-are-admins": { url: "role=admin" },
  "people-roles-from-expenses": { url: "/people/roles" },
  "settings-create-api-key": { text: "Warehouse export" },
  "settings-api-key-from-home": { selector: "role=dialog >> text=Create API key" },
  "settings-revoke-key": { text: "revoked" },
  "settings-two-factor": { text: "Two-factor is on" },
  "settings-two-factor-from-expenses": { selector: "role=dialog >> text=Set up two-factor" },
  "settings-change-password": { text: "Password updated" },
  "settings-change-email": { text: "Email changed" },
  "settings-stop-receipt-emails": { selector: 'role=checkbox[name="Email for Receipt missing"][checked=false]' },
  "settings-approvals-in-chat": { selector: 'role=checkbox[name="Chatter for Approval needed"][checked=true]' },
  "settings-require-2fa": { selector: 'role=switch[name="Require two-factor for everyone"][checked=true]' },
  "settings-session-timeout": { selector: 'role=combobox[name="Sign out after"] >> text=30 minutes' },
  "settings-sign-out-ipad": { absent: 'tr:has-text("iPad Air")' },
  "settings-upgrade-plan": { text: "You're on Growth" },
  "settings-reconnect-hris": { text: "reconnected" },
  "settings-connect-bank": { text: "Cascade Federal" },
  "settings-erp-mapping": { text: "Field mappings saved" },
  "settings-add-entity": { text: "Northpine SAS" },
  "settings-who-changed-limit": { selector: 'role=combobox[name="Action"] >> text=Changed a card limit' },
  "settings-export-audit": { text: "Exported" },
  "settings-export-all-data": { text: "Export started" },
  "settings-transfer-ownership": { text: "is now the owner" },
  "help-find-mileage-article": { url: "/help/[^/?]+", text: "mileage" },
  "help-browse-security": { url: "category=security" },
  "help-related-article": { selector: 'role=switch[name="Require two-factor for everyone"][checked=true]' },
  "help-whats-new": { url: "/help/whats-new" },
  "help-contact-declined-card": { text: "Message sent" },
  "help-chat": { selector: "role=dialog >> text=Chat with support" },
  "help-forgot-password": { text: "Check your email" },
  "help-sso-signin": { url: "://[^/]+/(\\?|$)" },
  "help-onboarding-skip-bank": { text: "Invite your team" },
  invite: { text: "Invite sent" },
  "invite-turned-back": { text: "Invite sent" },
  "company-website": { text: "Company details saved" },
};

/** Every department in the invite's list, and the box that searches it. The question names none, so any of them is a right answer. */
const A_DEPARTMENT = [
  "Search departments…",
  "Executive",
  "Engineering",
  "Platform in Engineering",
  "Mobile in Engineering",
  "Data in Engineering",
  "Sales",
  "Enterprise Sales in Sales",
  "Sales Development in Sales",
  "Marketing",
  "Brand in Marketing",
  "Finance",
  "People",
  "Customer Success",
  "Legal",
].map(any);

const OPEN_INVITE: TaskStep = { expect: [button("Invite people")], act: { click: 'role=button[name="Invite people"]' } };
const DEPARTMENT: TaskStep = { expect: [any("Department")], act: { click: 'role=dialog >> role=combobox[name="Department"]' }, say: "Choose the department they'll join." };
const PICK_ONE: TaskStep = { expect: A_DEPARTMENT, act: { click: "role=option[name=/^Platform/]" }, say: "Pick their department from the list." };
const SEND: TaskStep = { expect: [button("Send invite")], act: { click: 'role=button[name="Send invite"]' } };

/**
 * What a form needs before its submit button. Northpine marks a field that may
 * be left empty with "(optional)" and marks nothing on the ones it needs, as
 * most products do. These check that Haptic takes the visitor through what
 * the invite needs before it points at Send invite, that it reads a form being
 * turned back, and that it does not then walk someone through a form that
 * already holds saved values. Not in testbed/src/tasks, so the testbed's own
 * checks of its tasks are left as they are.
 */
const FORMS: Task[] = [
  {
    // The question says nothing about a department. After the email, the next step is Department, not Send invite.
    id: "invite",
    start: "/people",
    goal: "how do I invite a new hire",
    covers: ["overlay-modal", "form-combobox"],
    steps: [
      OPEN_INVITE,
      { expect: [any("Email address 1")], act: { fill: ['role=textbox[name="Email address 1"]', "jamie.ortiz@northpine.example"] }, say: "Type their email address." },
      DEPARTMENT,
      PICK_ONE,
      SEND,
      TASK_DONE,
    ],
  },
  {
    // The visitor types half an address and presses Send invite early. The form turns them back with two messages,
    // and marks the email as invalid. The guide is not over: both fields have to be put right first.
    id: "invite-turned-back",
    start: "/people",
    goal: "invite someone to Northpine",
    covers: ["overlay-modal", "form-combobox", "form-validation"],
    steps: [
      OPEN_INVITE,
      { expect: [any("Email address 1")], act: { fill: ['role=textbox[name="Email address 1"]', "cas"] }, say: "Type their email address." },
      { expect: [any("Department")], act: { click: 'role=button[name="Send invite"]' }, say: "Choose the department they'll join." },
      { expect: [any("Email address 1"), any("Department")], act: { fill: ['role=textbox[name="Email address 1"]', "cas.lindgren@northpine.example"] }, say: "Type their full email address." },
      DEPARTMENT,
      PICK_ONE,
      SEND,
      TASK_DONE,
    ],
  },
  {
    // A form that already holds saved values, with one field marked optional. Asked to change one thing in it,
    // the guide points at that field and then at Save changes, and leaves Legal name and the address alone.
    id: "company-website",
    start: "/settings/company",
    goal: "change our company website",
    // Northpine draws a page's body a moment after its frame. A visitor asks once the form is there, so the wait is switched off.
    lab: { latency: "none" },
    covers: ["form-save-bar"],
    steps: [
      { expect: [any("Website")], act: { fill: ['role=textbox[name="Website"]', "https://www.northpine.example/company"] }, say: "Type the new address." },
      { expect: [button("Save changes")], act: { click: 'role=region[name="Unsaved changes"] >> role=button[name="Save changes"]' } },
      TASK_DONE,
    ],
  },
];

const RISKY = ["danger-delete", "danger-irreversible"];

function kindOf(task: Task): Kind {
  if (task.covers.includes("cant-do")) return "no-answer";
  if (task.covers.some((name) => RISKY.includes(name))) return "risky";
  return "task";
}

function startOf(task: Task): string {
  const url = new URL(task.start, ORIGIN);
  const settings = { ...BASE, ...task.lab, widget: "1", widgetSrc: `${ORIGIN}/widget.js`, widgetSite: SITE };
  for (const [name, value] of Object.entries(settings)) url.searchParams.set(`lab.${name}`, String(value));
  return url.pathname + url.search;
}

function stepsOf(task: Task): Step[] {
  const steps: Step[] = [];
  for (const [index, step] of task.steps.entries()) {
    const instead = REPLACED[task.id]?.[index + 1];
    if (instead) {
      steps.push(...instead);
      if (instead.at(-1) === DONE) break;
      continue;
    }
    steps.push(step);
    // A control that is pointed at and not pressed ends the guide.
    if (!step.act && step.expect.length) break;
  }
  return steps;
}

export function guideOf(task: Task): Guide {
  const kind = kindOf(task);
  const reached = REACHED[task.id];
  const says = SAYS[task.id];
  return {
    id: task.id,
    start: startOf(task),
    goal: task.goal,
    steps: stepsOf(task),
    ...(reached ? { reached } : {}),
    ...(says ? { says } : {}),
    ...(kind !== "task" ? { kind } : {}),
  };
}

export default {
  siteId: SITE,
  origin: ORIGIN,
  hasTag: true,
  about: "Northpine, a made-up spend management dashboard (cards, expenses, approvals, bill pay, accounting, people, settings) built to hold every pattern that has made a pointing guide fail. Its data lives in each visitor's own browser.",
  sandbox: true,
  guides: [...TASKS, ...FORMS].map(guideOf),
} satisfies GuideSet;
