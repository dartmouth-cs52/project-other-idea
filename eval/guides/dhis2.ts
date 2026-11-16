import { any, button, DONE, link, type Guide, type GuideSet, type Step } from "../guide.ts";

// DHIS2's public play instance of version 2.41 (play.im.dhis2.org), signed in
// with the account its login page publishes. DHIS2 is the health information
// system ministries and large NGOs run: each of its apps (dashboards, data
// entry, users, reports, import and export) is a React page of its own, built
// on DHIS2's own component library. The login page says changes are welcome
// and the database is reset every night, but strangers use the same account at
// the same moment, so it is treated like any shared site: no guide saves,
// deletes or sends anything, and a guide that leads to such a control stops on
// it. Versions 2.42 and later show every app inside a frame, which no script
// in the page can read, so this instance is the one a customer's tag would see.
//
// Held out: Haptic's prompt and widget are never adjusted against it.

const BASE = "/stable-2-41-11";
const DASHBOARD = `${BASE}/dhis-web-dashboard/`;
/** Matches nothing. See `dismiss` below. */
const PAUSE = "#dhis2-has-nothing-to-dismiss";

/** The header's grid of apps, then one app in it, by the page its link opens. */
const APPS: Step = { expect: [button("Apps")], act: { click: '[data-test="headerbar-apps-icon"]' }, say: "Click the grid of squares at the top right." };
const app = (label: string, path: string): Step => ({ expect: [link(label)], act: { click: `a[href*="/${path}/index.action"]` } });
/** The header's profile button, with the account's initials. */
const PROFILE: Step = { expect: [button("Profile menu")], act: { click: '[data-test="headerbar-profile"] button, [data-test="headerbar-profile-icon"]' }, say: "Click your initials at the top right." };

const guides: Guide[] = [
  // The dashboard switcher: a list with a search box.
  // Still fails: "Immunization data", the dashboard beside it in the list; the one already open.
  {
    id: "open-immunization",
    start: DASHBOARD,
    goal: "Can you take me to the Immunization dashboard?",
    steps: [
      { expect: [button("Dashboards")], act: { click: 'button:has-text("Dashboards")' } },
      { expect: [any("Immunization")], act: { click: 'text="Immunization"' } },
      DONE,
    ],
    reached: { selector: '[data-test="view-dashboard-title"]:text-is("Immunization")' },
  },

  // The header's apps, an app's home, and the card that adds a user. The list of users has its own New, which opens the same form.
  // Still fails: the list of users, a new user role or user group.
  {
    id: "new-user",
    start: DASHBOARD,
    goal: "A new nurse is joining the district team. How do I create a login for her?",
    steps: [APPS, app("Users", "dhis-web-user"), { expect: [{ label: "Add", role: "button", context: "User", nth: 1 }, button("New")], act: { click: 'button:has-text("Add") >> nth=0' } }, DONE],
    reached: { url: "dhis-web-user/.*#/users/new" },
  },

  // The profile menu: the account's own settings, not the system's.
  // Still fails: System Settings, which changes the language for everyone; the profile page.
  {
    id: "own-language",
    start: DASHBOARD,
    goal: "How do I change the language the menus are shown in, just for my own account?",
    steps: [PROFILE, { expect: [link("Settings")], act: { click: 'a[href$="dhis-web-user-profile/#/settings"]' } }, DONE],
    reached: { url: "dhis-web-user-profile/.*#/settings" },
  },

  // A fact the profile menu shows at its foot, and the About page shows too. It cannot change on this instance.
  // Still fails: the dashboard app's own version alone, another version, or a hedge.
  {
    id: "which-version",
    start: DASHBOARD,
    goal: "Which version of DHIS2 are we running?",
    steps: [PROFILE, DONE],
    reached: [{ text: "DHIS2 2.41.11" }, { url: "dhis-web-user-profile/.*#/aboutPage" }],
    says: { all: ["\\b2\\.41\\b"] },
  },

  // The header's apps: the app for typing in a period's figures. Either of its two versions.
  // Still fails: Capture or Tracker Capture, which take individual records and events.
  {
    id: "monthly-figures",
    start: DASHBOARD,
    goal: "Where do I type in this month's numbers for a health facility?",
    steps: [APPS, app("Data Entry", "dhis-web-dataentry"), DONE],
    reached: { url: "/dhis-web-(dataentry|aggregate-data-entry)/" },
  },

  // Asked in French: "How do I export data as CSV?" An app, then its own side menu.
  // Still fails: event export, metadata export, or data import.
  {
    id: "export-csv-fr",
    kind: "awkward",
    start: DASHBOARD,
    goal: "Comment est-ce que j'exporte des données en CSV ?",
    steps: [APPS, app("Import/Export", "dhis-web-import-export"), { expect: [any("Data export")], act: { click: 'a[href="#/export/data"]' } }, DONE],
    reached: { url: "dhis-web-import-export/.*#/export/data" },
  },

  // The profile menu. The visitor opens the entry below the one they were shown, then finds the right page
  // in the side menu of the app that opened.
  // Still fails: the account's settings or account pages.
  {
    id: "phone-wrong-click",
    kind: "wrong-click",
    start: DASHBOARD,
    goal: "I've got a new phone number. Where do I update it in my profile?",
    steps: [
      PROFILE,
      { expect: [link("Edit profile")], act: { click: 'a[href$="dhis-web-user-profile/#/settings"]' } },
      { expect: [any("User profile")], act: { click: ':text-is("User profile")' }, say: "Not that one. Click User profile on the left.", sayStartsWith: "Not that one." },
      DONE,
    ],
    reached: { url: "dhis-web-user-profile/.*#/profile" },
  },

  // Edit mode, then Delete, which would delete the dashboard for everyone. It is never pressed.
  // Still fails: Delete on one item of the dashboard; Delete outside edit mode.
  {
    id: "delete-dashboard",
    kind: "risky",
    start: DASHBOARD,
    goal: "This dashboard is out of date. How do I delete it?",
    steps: [
      { expect: [button("Edit")], act: { click: 'button:has-text("Edit")' } },
      { expect: [button("Delete")], given: { url: "dhis-web-dashboard/#/[A-Za-z0-9]+/edit$" } },
    ],
  },

  // A menu behind the dashboard's "more" button, then a submenu. Either print layout will do, and so will the print
  // preview that edit mode shows.
  // Still fails: the dashboard as it is, or Slideshow.
  {
    id: "print-dashboard",
    start: DASHBOARD,
    goal: "I need a printed copy of this dashboard for a meeting. How do I print it?",
    steps: [
      { expect: [button("More")], act: { click: 'button:has-text("···"), [data-test="more-actions-button"]' }, say: "Click the three dots at the top right of the dashboard." },
      { expect: [any("Print")], act: { click: 'li:has-text("Print")' } },
      { expect: [any("Dashboard layout"), any("One item per page")], act: { click: 'li:has-text("Dashboard layout")' } },
      DONE,
    ],
    reached: [{ url: "dhis-web-dashboard/#/[A-Za-z0-9]+/print(layout|oipp)" }, { url: "dhis-web-dashboard/#/[A-Za-z0-9]+/edit$", text: "Exit print preview" }],
  },

  // The header's apps, an app's home, and one of its reports. The Reporting Rates dashboard answers it too.
  // Still fails: the data set report, or the reports app's home.
  {
    id: "reporting-rates",
    start: DASHBOARD,
    goal: "Where can I see which facilities have sent in their monthly reports on time?",
    steps: [APPS, app("Reports", "dhis-web-reports"), { expect: [any("Get Report")], act: { click: 'a[href="#/reporting-rate-summary"], [href$="reporting-rate-summary"]' } }, DONE],
    reached: [{ url: "dhis-web-reports/.*#/reporting-rate-summary" }, { selector: '[data-test="view-dashboard-title"]:text-is("Reporting Rates")' }],
  },

  // DHIS2 keeps health data. It has no invoices or payments.
  { id: "no-supplier-payments", kind: "no-answer", start: DASHBOARD, goal: "How do I pay an invoice from one of our medicine suppliers?", steps: [DONE] },
];

export default {
  siteId: "site_bench_dhis2",
  origin: "https://play.im.dhis2.org",
  hasTag: false,
  about: "DHIS2's public play instance, version 2.41: the health information system ministries of health and large NGOs run (dashboards, data entry, users, reports, import and export), each app a React page built on DHIS2's own component library.",
  heldOut: true,
  before: {
    path: `${BASE}/dhis-web-login/`,
    acts: [
      { fill: ['input[name="username"]', "admin"] },
      { fill: ['input[name="password"]', "district"] },
      { click: 'button[type="submit"]' },
      // Signed in once an app's header has drawn.
      { hover: '[data-test="headerbar-apps-icon"]' },
    ],
  },
  // The login page draws its form a moment after it loads. These match nothing: each is a pause of a second and a half.
  dismiss: [PAUSE, PAUSE],
  // Translations are looked up with a POST, and the older Data Entry app asks for its tree of places with one.
  reads: "^POST play\\.im\\.dhis2\\.org/stable-2-41-11/(api/(\\d+/)?i18n|dhis-web-commons-ajax-json/getOrganisationUnitTree\\.action)$",
  // Every dashboard that opens reports a view, and the older Data Entry app clears its tree's selection as it opens.
  chatter: "^POST play\\.im\\.dhis2\\.org/stable-2-41-11/(api/\\d+/dataStatistics|dhis-web-commons/ouwt/clearselected\\.action)$",
  guides,
} satisfies GuideSet;
