import { any, button, DONE, link, type Guide, type GuideSet } from "../guide.ts";
import type { Matcher } from "../cases.ts";

// EspoCRM's public demo, signed in as its one demo user. A shared, live site:
// nothing here saves, creates, sends, posts, converts or deletes. A guide that
// leads to such a control stops on it.

/** A control listed with no label, told apart by its kind, its surroundings and its place among the others like it. */
const unnamed = (role: string, context: string, nth: number): Matcher => ({ label: "", role, context, nth });

// The top bar's icon buttons, on every page.
const QUICK_CREATE: Matcher = { label: "", role: "button", icon: "plus", context: "nav" };
/**
 * The same plus button, as the widget now names it. Without it a run that is pointed at the
 * script's own first control is cut short there, since "Create" is a word a run on a live site never presses
 * unless the script itself does. It opens a menu and creates nothing. Any other "Create" (the list's
 * "Create Account", a panel's "Create" with no plus, a dialog's) is still not this one.
 */
const QUICK_CREATE_NAMED: Matcher = { label: "Create", role: "button", icon: "plus", context: "nav" };
const USER_MENU: Matcher = { label: "", role: "button", icon: "ellipsis-v", context: "nav" };
const MORE_TABS: Matcher = { label: "", role: "button", icon: "ellipsis-h", context: "nav" };
const EMAILS_TAB: Matcher = { label: "Emails", role: "link", context: "nav" };

/** The seeded contact the email guide starts on. */
const CONTACT = "/#Contact/view/5f6078ed99f136515";

const guides: Guide[] = [
  // A list's view switch: two icon-only buttons above the table.
  {
    id: "tasks-board",
    start: "/",
    goal: "Can I see my to-dos as cards in columns instead of a table?",
    steps: [
      { expect: [{ label: "Tasks", role: "link", context: "nav" }], act: { click: '#navbar li[data-name="Task"] > a' } },
      // Above the list, in order: search, add filter, list view, board view.
      { expect: [unnamed("button", "Tasks", 4)], act: { click: 'button[data-action="switchViewMode"][data-name="kanban"]' }, say: "Click the board icon above the list, on the right." },
      DONE,
    ],
    reached: { selector: ".list-kanban" },
  },

  // The full create form: three required fields and a date picker. Stops before Save.
  {
    id: "new-deal",
    start: "/#Opportunity/create",
    goal: "I'm adding a deal: Test Deal, closing on the 20th of this month, worth 5000 dollars. What do I fill in here?",
    steps: [
      // The form's textboxes, in order: Name, Stage, Amount, its currency, Probability, Close Date.
      {
        expect: [unnamed("textbox", "Opportunities", 1), unnamed("textbox", "Opportunities", 3), unnamed("textbox", "Opportunities", 6), { label: "", role: "button", icon: "calendar" }],
        point: unnamed("textbox", "Opportunities", 1),
        act: { fill: ['.field[data-name="name"] input', "Test Deal"] },
        say: "Type the deal's name.",
      },
      {
        expect: [{ label: "", role: "button", icon: "calendar" }, unnamed("textbox", "Opportunities", 6), unnamed("textbox", "Opportunities", 3)],
        point: { label: "", role: "button", icon: "calendar" },
        act: { click: '.field[data-name="closeDate"] button' },
        say: "Open the calendar beside Close Date.",
      },
      { expect: [any("20")], unlisted: true, act: { click: '.datepicker td.day:not(.old):not(.new):text-is("20")' } },
      { expect: [unnamed("textbox", "Opportunities", 3)], act: { fill: ['.field[data-name="amount"] input.main-element', "5000"] }, say: "Type the amount." },
      // Not pressed: it would add a record to a demo other people use.
      { expect: [button("Save")] },
    ],
  },

  // A record page's own action. Stops on it: the lead is never converted, and its conversion form is never opened.
  // Opening that form makes the page send POST Lead/action/getConvertAttributes, which copies any attachments the
  // lead has (EspoCRM's ConvertService::getValues), so it cannot be vouched for as a read. A run on this site stops
  // it and ends "cut short" there, which made every run that followed the script end that way at its second step.
  // The button is told apart by its page: the record's own headings name Nina Thomson, another lead's do not.
  {
    id: "convert-lead",
    start: "/#Lead",
    goal: "Nina Thomson has agreed to buy. How do I turn her from a lead into a contact?",
    steps: [
      { expect: [link("Nina Thomson")], act: { click: '.list a.link[title="Nina Thomson"]' } },
      // Not pressed: it opens the conversion form, whose request is stopped on a demo other people use.
      { expect: [{ label: "Convert", role: "button", context: "Nina Thomson" }], given: { url: "#Lead/view/" } },
    ],
  },

  // The same tick box on every row, and an Actions menu that is only there once a row is ticked. Stops before Remove.
  {
    id: "bulk-delete",
    kind: "risky",
    start: "/#Contact",
    goal: "How do I delete several contacts in one go?",
    steps: [
      // The first tick box is the header's, which ticks the whole page. The rows' follow: twenty to a page.
      {
        expect: Array.from({ length: 20 }, (_, row) => unnamed("checkbox", "Contacts", row + 2)),
        act: { check: ".list tbody tr:nth-child(1) input.record-checkbox" },
        say: "Tick the box beside each contact you want to delete.",
      },
      {
        expect: [button("Actions"), ...Array.from({ length: 19 }, (_, row) => unnamed("checkbox", "Contacts", row + 3))],
        point: button("Actions"),
        act: { click: ".list-buttons-container button.actions-button" },
      },
      { expect: [button("Remove")] },
    ],
  },

  // Asked in German. The calendar's views sit in a menu named after the one that is showing.
  {
    id: "calendar-month",
    kind: "awkward",
    start: "/#Calendar",
    goal: "Wie stelle ich den Kalender auf die Monatsansicht um?",
    steps: [
      { expect: [button("Week")], act: { click: ".mode-buttons button.dropdown-toggle" } },
      { expect: [button("Month")], act: { click: '.mode-buttons a[data-mode="month"]' } },
      DONE,
    ],
    reached: { selector: ".fc-dayGridMonth-view" },
  },

  // From a contact's page: the address opens a compose dialog with To filled in. Stops before Send.
  {
    id: "email-contact",
    start: CONTACT,
    goal: "How do I send this contact a quick email? Just a subject line saying Call me back, no message.",
    steps: [
      // The address itself, the envelope in the Activities panel, the quick-create menu and the Emails tab all lead to a new email.
      {
        expect: [{ label: "[email]", role: "button", nth: 1 }, unnamed("button", "Bradley Wyatt", 9), QUICK_CREATE, QUICK_CREATE_NAMED, EMAILS_TAB],
        point: { label: "[email]", role: "button", nth: 1 },
        act: { click: '.field[data-name="emailAddress"] a[data-action="mailTo"]' },
        say: "Click the contact's email address.",
      },
      // The dialog's textboxes, in order: To, CC, BCC, the parent's type, the template, Subject, the message.
      { expect: [unnamed("textbox", "Bradley Wyatt", 6)], act: { fill: ['.modal .field[data-name="subject"] input', "Call me back"] }, say: "Type the subject." },
      { expect: [{ label: "Send", role: "button", context: "footer" }] },
    ],
  },

  // Reports are behind the three dots at the foot of the side menu.
  // The visitor first opens the menu just above the dots.
  {
    id: "report-wrong-click",
    kind: "wrong-click",
    start: "/",
    goal: "My manager set up a report of new leads. Where do I find it?",
    steps: [
      { expect: [MORE_TABS], act: { click: '#navbar a.nav-link-group:has-text("Sales & Purchases")' }, say: "Click the three dots at the bottom of the menu on the left." },
      { expect: [MORE_TABS], act: { click: "#nav-more-tabs-dropdown" }, say: "Not that one. Click the three dots below it.", sayStartsWith: "Not that one." },
      { expect: [{ label: "Reports", role: "link", context: "menu" }], act: { click: '#navbar li[data-name="Report"] > a' } },
      { expect: [link("New Leads")], act: { click: '.list a.link[title="New Leads"]' } },
      DONE,
    ],
    reached: { url: "#Report/view/", text: "New Leads" },
  },

  // A setting two levels down: the top bar's menu, Preferences, a tab, then a dropdown. Stops before Save.
  {
    id: "dark-mode",
    start: "/",
    goal: "is there a dark mode?",
    steps: [
      { expect: [USER_MENU], act: { click: "#nav-menu-dropdown" }, say: "Click the three dots at the top right." },
      { expect: [{ label: "Preferences", role: "link", context: "menu" }], act: { click: '#navbar a[data-name="preferences"]' } },
      { expect: [button("User Interface")], act: { click: '.record .tabs button:has-text("User Interface")' } },
      // The Theme dropdown. The visitor types in it to narrow its choices.
      { expect: [unnamed("textbox", "Preferences", 1)], act: { fill: ['.field[data-name="theme"] .selectize-input input', "Dark"] }, say: "Open the Theme dropdown." },
      { expect: [any("Dark")], unlisted: true, act: { click: '.field[data-name="theme"] .selectize-dropdown .option[data-value="Dark"]' } },
      // Not pressed: it would change the demo user's settings for everyone.
      { expect: [button("Save")] },
    ],
    // The question asks whether there is one, so a sentence that says there is, a theme called Dark among the
    // themes in Preferences, is the answer too. It cannot change: Dark is one of the themes EspoCRM ships. A
    // sentence that says there is none, that sends the visitor anywhere but the themes, or that hedges, does not pass.
    says: {
      all: ["\\bdark\\b", "\\b(themes?|preferences|user interface)\\b"],
      not: ["\\b(no|not|isn't|isn’t|doesn't|doesn’t|don't|don’t|can't|can’t|cannot|couldn't|couldn’t|unable|unavailable|lacks?|without)\\b"],
    },
  },

  // A CRM has no payroll.
  { id: "no-payslip", kind: "no-answer", start: "/", goal: "Where can I download my payslip for last month?", steps: [DONE] },

  // Asked with typos. The list's own search box and the magnifier beside it.
  {
    id: "find-contact",
    kind: "awkward",
    start: "/#Contact",
    goal: "how do i serch this list for a contcat called Phillips",
    steps: [
      { expect: [unnamed("textbox", "Contacts", 1)], act: { fill: ["input.text-filter", "Phillips"] }, say: "Type the name here." },
      // Enter in the box does the same as the magnifier beside it.
      {
        expect: [unnamed("button", "Contacts", 1), unnamed("textbox", "Contacts", 1)],
        point: unnamed("button", "Contacts", 1),
        act: { click: '.search-container button[data-action="search"]' },
        say: "Click the magnifying glass, or press Enter.",
      },
      DONE,
    ],
    // He is the twenty-first contact, so he is not on the list until it is searched.
    reached: { selector: '.list tbody a.link[title="Joseph Phillips"]' },
  },

  // The quick-create menu behind the plus in the top bar, and the dialog it opens. Stops before Save.
  {
    id: "quick-task",
    start: "/#Account",
    goal: "What's the quickest way to jot down a to-do for myself without leaving this page? Just a title: Call Sam back.",
    steps: [
      { expect: [QUICK_CREATE, QUICK_CREATE_NAMED], act: { click: "#nav-quick-create-dropdown" }, say: "Click the plus at the top right." },
      { expect: [{ label: "Task", role: "link", context: "menu" }], act: { click: '#navbar a[data-action="quickCreate"][data-name="Task"]' } },
      // The first unnamed textbox is the list's search, behind the dialog. The task's name is the next.
      { expect: [unnamed("textbox", "Accounts", 2)], act: { fill: ['.modal .field[data-name="name"] input', "Call Sam back"] }, say: "Type the title." },
      // Not pressed: it would add a record to a demo other people use.
      { expect: [{ label: "Save", role: "button", context: "footer" }] },
    ],
  },
];

export default {
  siteId: "site_bench_espocrm",
  origin: "https://demo.us.espocrm.com",
  hasTag: false,
  about: "EspoCRM's public demo: a customer-relationship system (accounts, contacts, leads, opportunities, cases, calendar, email, reports), standing for the CRM software every large sales organisation runs.",
  before: {
    path: "/?l=en_US",
    acts: [
      { click: "#btn-login" },
      // As for anyone who has used the app before today, the browser has already shown a lead, the task list and the report list once.
      { click: '#navbar li[data-name="Lead"] > a' },
      { click: '.list tbody tr:first-child a.link[href^="#Lead/view/"]' },
      { hover: '.detail-button-container button[data-action="edit"]' },
      { click: '#navbar li[data-name="Task"] > a' },
      { hover: '.list a.link[href^="#Task/view/"]' },
      { click: "#nav-more-tabs-dropdown" },
      { click: '#navbar li[data-name="Report"] > a' },
      { hover: '.list a.link[href^="#Report/view/"]' },
    ],
  },
  // Beyond the save, send and delete buttons a whole-guide run already leaves alone on a live site, these change
  // what other visitors of the demo see: stream posts, mass updates, status and follow changes, and the admin area.
  never: "\\b(post|update|unlink|trash|follow|followed|unfollow|lock|unlock|recalculate formula|complete|set held|set not held|reset|convert currency|administration|yes)\\b",
  heldOut: true,
  guides,
} satisfies GuideSet;
