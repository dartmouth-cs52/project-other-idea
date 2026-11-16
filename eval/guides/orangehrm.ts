import { createRequire } from "node:module";
import type { Matcher } from "../cases.ts";
import { any, button, DONE, link, type Guide, type GuideSet, type Step } from "../guide.ts";

// OrangeHRM's public open-source demo, signed in with the demo account the
// login page itself shows. It is a shared, live site: strangers use it at the
// same moment and edit its records. So no guide here saves, submits, adds or
// deletes anything (each stops before that button), and none is anchored on a
// person or a table row that a stranger could rename: only on menus, tabs,
// filters, form fields and buttons.
//
// How the widget names this app's controls, which the matchers follow:
// - Field captions are plain <label>s that are not tied to their inputs, so a
//   text field is listed by its placeholder or, more often, with no label at
//   all. Such a field can only be told apart by its position in the form.
// - A custom dropdown is listed as a clickable whose label is its current
//   value, so every empty one is "-- Select --".
// - Top tabs that open a menu are clickables in "nav"; their entries are menuitems.
//
// Two things an employee would ask about are not here, because they cannot be
// recorded the same way twice on this demo:
// - Anything through the user menu (change password, log out, About). The
//   widget lists that menu by the signed-in user's display name, strangers
//   rewrite that name every few minutes, and a matcher needs the exact label.
// - Applying for leave. The demo account has no leave balance, so the page
//   shows "No Leave Types with Leave Balance" in place of the form.

// Three workarounds for the recorder, kept in this file because nothing else
// may be edited. Each stands in for something the widget gets wrong on this
// app, so each is a fault a visitor would meet. They are switched on only for
// the recorder and the look tool, so anything else that runs these guides
// still shows the faults, and none changes what the widget lists on a page
// that has finished loading. Without them not one guide here that crosses a
// page load or picks from a dropdown can be recorded.
//
// OrangeHRM is a multi-page app: almost every click loads a new page, the page
// takes about a second to arrive, and its Vue app draws itself about half a
// second after that. The widget waits only 300 ms of quiet before it reads a
// page, which is too short on both sides of a page load. Measured without the
// aids, on 8 page loads out of 8:
//
// 1. About 350 ms after a click on a link, the widget asked for the next step
//    from the page the visitor was leaving. With a real model that reply
//    usually comes back after the page has gone and is lost, and the widget
//    picks the guide up on the new page. The recorder answers at once, so it
//    would take the old page for the next step and the script would fail (or,
//    worse, record a case from the wrong page). So a step asked for by a page
//    that is already unloading is held back, which is what losing that race
//    looks like.
// 2. On the new page the widget picked the guide up before the app had drawn
//    anything, and sent an empty list of controls. (In the recorder the
//    widget's own start is instant. Over a real network it takes longer, so a
//    visitor may not meet this on every page.) So the widget is held back from
//    starting until the app has mounted and its loaders have gone.
//
// And the app's dropdowns take an entry on mousedown and remove the list before
// mouseup, so the page never gets a click event:
//
// 3. The widget listens only for clicks, so after the visitor picks the entry
//    it pointed at, it waits for ever with a stale caption on screen. A visitor
//    left like that asks again, which is what the recorder itself does after a
//    step the widget could not point at. So when four seconds pass after a pick
//    with no new step asked for, the guide is stopped and the same question is
//    put again. The step after a pick is therefore recorded as a fresh question.
const RECORDING_AIDS = `(() => {
  if (window.top !== window || !/orangehrmlive\\.com$/.test(location.hostname)) return;
  let leaving = false;
  let asked = 0;
  addEventListener("beforeunload", () => { leaving = true; });
  const loaded = () => new Promise((resolve) => {
    const started = Date.now();
    let steadySince = 0;
    const check = () => {
      const mounted = document.querySelector(".oxd-layout, .orangehrm-login-layout");
      const loading = document.querySelector(".oxd-loading-spinner");
      steadySince = mounted && !loading ? steadySince || Date.now() : 0;
      if ((steadySince && Date.now() - steadySince >= 500) || Date.now() - started > 15000) resolve();
      else setTimeout(check, 100);
    };
    check();
  });
  const send = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    if (/\\/v1\\/turn$/.test(url)) {
      if (leaving) return new Promise(() => {});
      asked++;
    }
    if (/\\/v1\\/sites\\//.test(url)) return loaded().then(() => send.call(this, input, init));
    return send.call(this, input, init);
  };
  addEventListener("mousedown", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[role="option"]')) return;
    const before = asked;
    setTimeout(() => {
      const root = document.querySelector("haptic-root") && document.querySelector("haptic-root").shadowRoot;
      let goal = "";
      try { goal = JSON.parse(sessionStorage.getItem("haptic.guide") || "{}").goal || ""; } catch (error) {}
      if (asked !== before || leaving || !root || !goal) return;
      root.querySelector(".stop").click();
      const input = root.querySelector(".ask input");
      input.value = goal;
      input.form.requestSubmit();
    }, 4000);
  }, true);
})();`;

if (/[\\/]eval[\\/](record|look)\.ts$/.test(process.argv[1] ?? "")) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { chromium } = createRequire(import.meta.url)("playwright") as any;
    const launch = chromium.launch.bind(chromium);
    chromium.launch = async (...args: unknown[]) => {
      const browser = await launch(...args);
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...options: unknown[]) => {
        const context = await newContext(...options);
        await context.addInitScript(RECORDING_AIDS);
        return context;
      };
      return browser;
    };
  } catch {
    // Playwright isn't installed, so there is nothing to record with.
  }
}

const DASHBOARD = "/web/index.php/dashboard/index";

/** A link in the side menu. */
const side = (module: string) => `a.oxd-main-menu-item[href$="/${module}"]`;
/** A tab in the bar under the header, whether it is a link or opens a menu. */
const topTab = (label: string) => `.oxd-topbar-body-nav-tab-item:has-text("${label}")`;
/** The form field under a given caption. */
const field = (caption: string, control = "input") => `.oxd-input-group:has(label:text-is("${caption}")) ${control}`;
/** An entry of whichever custom dropdown is open. */
const option = (label: string) => `.oxd-select-dropdown [role="option"]:has-text("${label}")`;

/** The nth dropdown still showing "-- Select --" in the page's form. */
const emptySelect = (nth: number): Matcher => ({ label: "-- Select --", role: "clickable", context: "form", nth });
/** The nth text field in the page's form that the widget lists with no label. */
const unnamedField = (nth: number): Matcher => ({ label: "", role: "textbox", context: "form", nth });

const SEARCH: Step = { expect: [{ label: "Search", role: "button", context: "form" }], act: { click: '.oxd-form button[type="submit"]' } };

const guides: Guide[] = [
  // A form with several fields, reached two ways. Stops before Save.
  {
    id: "new-hire",
    start: DASHBOARD,
    goal: "We have a new starter on Monday. How do I set up their record in the system?",
    steps: [
      { expect: [link("PIM")], act: { click: side("pim/viewPimModule") } },
      // The tab and the button above the table both open the same form.
      { expect: [link("Add Employee"), { label: "Add", role: "button", icon: "plus" }], act: { click: topTab("Add Employee") } },
      { expect: [any("First Name"), any("Last Name")], act: { fill: ['input[name="firstName"]', "Test"] }, say: "Type their first name." },
      // The middle name is optional, and next in the row.
      { expect: [any("Middle Name"), any("Last Name")], act: { fill: ['input[name="middleName"]', "Sample"] }, say: "Type their middle name, if they have one." },
      { expect: [any("Last Name")], act: { fill: ['input[name="lastName"]', "Employee"] }, say: "Type their last name." },
      { expect: [button("Save")] },
    ],
  },
  // A multi-select filter. The status that is on by default can only be taken
  // off with the cross on its chip, which the widget does not list.
  //
  // It ends on Search, unpressed, with the filter set. Nothing on the page can
  // show that Search was pressed: the demo has no leave requests this year, so
  // the table says "No Records Found" before the search and after it, and the
  // same notice pops up on both. Testing the filter alone passed the guide a
  // step early, before the visitor had been shown Search.
  {
    id: "rejected-leave",
    start: DASHBOARD,
    goal: "I only want to look at the leave requests we turned down. How do I narrow the list to just those?",
    steps: [
      { expect: [link("Leave"), button("Leave List")], act: { click: side("leave/viewLeaveModule") } },
      { expect: [emptySelect(1)], act: { click: ".oxd-multiselect-wrapper .oxd-select-text" }, say: "Open Show Leave with Status." },
      { expect: [{ label: "Rejected", role: "option" }], act: { click: option("Rejected") } },
      {
        expect: [{ label: "Pending Approval", role: "button", icon: "x" }],
        unlisted: true,
        act: { click: '.oxd-chip:has-text("Pending Approval") i' },
        say: "Click the cross on Pending Approval to take it off.",
      },
      {
        expect: SEARCH.expect,
        given: { url: "/leave/viewLeaveList$", selector: '.oxd-multiselect-chips-area:not(:has-text("Pending Approval")) .oxd-chip:has-text("Rejected")' },
      },
    ],
  },
  // Tabs, and a form whose fields the widget lists with no labels at all.
  {
    id: "mobile-number-wrong-click",
    start: "/web/index.php/pim/viewMyDetails",
    goal: "I got a new mobile number. Where do I change it on my profile?",
    kind: "wrong-click",
    steps: [
      // The visitor is pointed at Contact Details and clicks the tab below it.
      { expect: [any("Contact Details")], act: { click: 'a.orangehrm-tabs-item:has-text("Emergency Contacts")' } },
      { expect: [any("Contact Details")], act: { click: 'a.orangehrm-tabs-item:has-text("Contact Details")' }, say: "Not that one. Click Contact Details.", sayStartsWith: "Not that one." },
      // Mobile is the seventh unlabelled text field: Street 1, Street 2, City, State, Zip, Home, Mobile.
      { expect: [unnamedField(7)], act: { fill: [field("Mobile"), "5550100"] }, say: "Type your new number under Mobile." },
      { expect: [{ label: "Save", role: "button", nth: 1 }] },
    ],
  },
  // A switch that has to be turned on before the button appears, then a dialog
  // the widget does not notice (role="dialog" without aria-modal), so its
  // fields are listed after everything on the page behind it.
  //
  // The widget now lists the dialog's fields by their captions, Unit Id and
  // Name, so the guide goes on to Save and stops there: Save would add the unit
  // to a structure other people use.
  {
    id: "new-department",
    start: "/web/index.php/admin/viewCompanyStructure",
    goal: "We're creating a new department. How do I get it into the company structure?",
    steps: [
      // The checkbox and the switch drawn beside it are one control.
      { expect: [{ label: "Edit", role: "checkbox" }, { label: "", role: "clickable", nth: 1 }], act: { click: ".oxd-switch-input" }, say: "Turn on Edit." },
      { expect: [{ label: "Add", role: "button", icon: "plus" }], act: { click: 'button:has-text("Add")' } },
      // Unit Id comes first and is optional. Name is required. Either is a fair place to start.
      { expect: [any("Name"), any("Unit Id")], act: { fill: ['.oxd-dialog-sheet .oxd-input-group:has(label:text-is("Name")) input', "Test department"] }, say: "Type the unit's name." },
      { expect: [button("Save")] },
    ],
  },
  // A setting two levels down, then the same icon-only button on every row.
  {
    id: "rejection-emails",
    start: DASHBOARD,
    goal: "Where can I check who gets an email when someone's leave request is rejected?",
    steps: [
      { expect: [link("Admin")], act: { click: side("admin/viewAdminModule") } },
      { expect: [{ label: "Configuration", role: "clickable", context: "nav" }], act: { click: topTab("Configuration") } },
      { expect: [{ label: "Email Subscriptions", role: "menuitem" }], act: { click: '[role="menuitem"]:has-text("Email Subscriptions")' } },
      // Five fixed rows, each with the same unlabelled button. Leave Rejections is the fifth.
      {
        expect: [{ label: "", role: "button", icon: "person-plus-fill", nth: 5 }],
        act: { click: '.oxd-table-card:has-text("Leave Rejections") button:has(i.bi-person-plus-fill)' },
        say: "Click the subscribers button on the Leave Rejections row.",
      },
      DONE,
    ],
    // The Email Subscriptions page answers the question too: its Leave Rejections row has a Subscribers column, the
    // same people the row's own page lists (both empty on 16 November 2026). There it counts once the sentence says
    // which row, since the page has five.
    reached: [
      { url: "/admin/saveSubscriber/5$", text: "Subscribers: Leave Rejections" },
      { url: "/admin/viewEmailNotification$", selector: '.oxd-table-card:has-text("Leave Rejections")', said: "\\bleave rejections\\b" },
    ],
  },
  // Asked in French. Five dropdowns that all read "-- Select --"; Status is the fourth.
  {
    id: "shortlisted-candidates",
    start: DASHBOARD,
    goal: "Bonjour, je cherche les candidats qui ont été présélectionnés. Comment afficher seulement ceux-là ?",
    kind: "awkward",
    steps: [
      { expect: [link("Recruitment")], act: { click: side("recruitment/viewRecruitmentModule") } },
      { expect: [emptySelect(4)], act: { click: field("Status", ".oxd-select-text") }, say: "Open Status." },
      { expect: [{ label: "Shortlisted", role: "option" }], act: { click: option("Shortlisted") } },
      SEARCH,
      DONE,
    ],
    // The list shows the result of a search for shortlisted candidates and nothing else: the page's last request
    // for candidates asked for status 2, Shortlisted, with no other filter, and no row says another status. An empty
    // list is a true answer: on 16 November 2026 the demo had no candidates at all, so the list read "No Records
    // Found" before any search and after it. The request tells the two apart, so the filter set and not yet run,
    // another status, or another filter as well, does not pass.
    reached: {
      url: "/recruitment/viewCandidates$",
      request: { to: "/api/v2/recruitment/candidates\\?", has: "\\?(?=(?:[^#]*&)?status=2(?:&|$))(?:(?:limit|offset|status|model|sortField|sortOrder)=[^&#]*(?:&|$))+$" },
      absent: '.oxd-table-card:not(:has-text("Shortlisted"))',
    },
  },
  // Asked with typos. A tab that opens a menu. Stops before the button that
  // records the punch. That button reads In or Out depending on whether the
  // demo account is clocked in, which strangers change, so the question asks
  // about both and either button is right.
  {
    id: "clock-in",
    start: DASHBOARD,
    goal: "wher do i clokc in and out each day??",
    kind: "awkward",
    steps: [
      // The stopwatch button on the Time at Work card goes straight to the same page.
      { expect: [link("Time"), { label: "", role: "button", icon: "stopwatch" }], act: { click: side("time/viewTimeModule") } },
      { expect: [{ label: "Attendance", role: "clickable", context: "nav" }], act: { click: topTab("Attendance") } },
      { expect: [{ label: "Punch In/Out", role: "menuitem" }], act: { click: '[role="menuitem"]:has-text("Punch In/Out")' } },
      { expect: [button("In"), button("Out")] },
    ],
  },
  // Leads up to the button that posts to the whole company, and stops there.
  {
    id: "announce",
    start: DASHBOARD,
    goal: "I'd like to share some good news with everyone at the company. How do I put a message on the news feed?",
    kind: "risky",
    steps: [
      { expect: [link("Buzz")], act: { click: side("buzz/viewBuzz") } },
      { expect: [{ label: "What's on your mind?", role: "textbox" }], act: { fill: ["textarea.oxd-buzz-post-input", "Test post"] }, say: "Type your message." },
      { expect: [button("Post")] },
    ],
  },
  // OrangeHRM's open-source edition has no payroll: there are no payslips anywhere in it.
  { id: "payslip", start: DASHBOARD, goal: "Where can I download my payslip for last month?", kind: "no-answer", steps: [DONE] },
  // Pagination at the foot of a table long enough that the widget's list is cut at its limit.
  {
    id: "more-employees",
    start: "/web/index.php/pim/viewEmployeeList",
    goal: "The table only shows 50 people. How do I get to the next 50?",
    steps: [
      {
        expect: [{ label: "2", role: "button", context: "nav" }, { label: "", role: "button", icon: "chevron-right", context: "nav" }],
        act: { click: '.oxd-pagination-page-item--page:text-is("2")' },
      },
      DONE,
    ],
    reached: { selector: '.oxd-pagination-page-item--page-selected:text-is("2")' },
  },
  // Sorting a table. The arrows beside each column heading are bare <i> icons
  // with a click handler, which the widget does not list, so it has nothing to
  // point at. The script ends there: the menu the arrows open (Ascending,
  // Descending) closes as soon as the visitor clicks anywhere else, so asking
  // again, as the recorder does after a step like this, only shuts it.
  {
    id: "sort-by-surname",
    start: "/web/index.php/pim/viewEmployeeList",
    goal: "sort employees by surname, Z to A",
    steps: [
      {
        expect: [{ label: "Last Name", role: "button", icon: "arrow-down-up" }],
        unlisted: true,
        act: { click: '.oxd-table-header-cell:has-text("Last Name") .oxd-table-header-sort-icon' },
        say: "Click the arrows beside Last Name.",
      },
    ],
  },
];

export default {
  siteId: "site_bench_orangehrm",
  origin: "https://opensource-demo.orangehrmlive.com",
  hasTag: false,
  about: "OrangeHRM's open-source demo: a human-resources system (employees, leave, time, recruitment, administration), standing for the HR software every large company runs.",
  // The dashboard reports on the installation to its maker each time it loads. Everything else the pages read is a plain GET.
  chatter: "^POST opensource-demo\\.orangehrmlive\\.com/web/index\\.php/events/push$",
  before: {
    path: "/web/index.php/auth/login",
    acts: [
      { fill: ['input[name="username"]', "Admin"] },
      { fill: ['input[name="password"]', "admin123"] },
      { click: 'button[type="submit"]' },
    ],
  },
  guides,
} satisfies GuideSet;
