import type { Matcher } from "../cases.ts";
import { button, DONE, link, type Guide, type GuideSet } from "../guide.ts";

// The Apache Software Foundation's public Jira, read without signing in. It is
// a live production tracker, so every guide here only searches, filters, sorts
// and opens menus, tabs and dialogs. The two that lead towards something that
// would download a file or set up emails stop before that control.
//
// The issues change by the minute, so nothing is anchored on what a search
// returns. Guides anchor on Jira's own chrome (menus, filters, tabs, dialogs),
// on the Kafka project, and on KAFKA-1, a ticket resolved in 2015.
//
// How the widget names this app's controls, which the matchers follow:
// - A search criterion is a button whose label carries its value: "Project: All".
// - An entry in a criterion's dropdown is a checkbox, labelled by its <label>.
// - The date criterion's form has two fields called "Timespan", two selects
//   called "Time measurement" and two pairs of "Start date"/"End date", so a
//   field is told apart only by its position.
// - A sortable column header is a button whose label is a sentence:
//   "Created: no sorting applied to the column. Activate to apply an ascending sort".
// - Three controls on the filter search page are called "Search": the box in
//   the header, the tab and the form's button. The form's text field has no
//   <label for>, so it is listed by its name attribute, "searchName".
// - Detail view shows two "Export" buttons: the search's and the open issue's.

const KAFKA_ISSUES = "/jira/projects/KAFKA/issues";
/** The issue search with nothing chosen: every project on the server. */
const SEARCH_ALL = "/jira/issues/?jql=";
/** The issue search, already narrowed to the Kafka project. */
const SEARCH_KAFKA = "/jira/issues/?jql=project%20%3D%20KAFKA";

/** The box at the top right of every page. */
const QUICK_SEARCH: Matcher = { label: "Search", role: "searchbox" };
/** A link in the project's sidebar. */
const side = (name: string) => `.aui-sidebar a[aria-label="${name} of Kafka"]`;
/** The button at the foot of whichever criterion dropdown is open. */
const UPDATE = 'input[type="submit"][value="Update"]:visible';
/**
 * The switch to the query language. A query typed there ("project = KAFKA",
 * "created >= -7d") does what the dropdowns do, so it is a right first step
 * wherever a search is being narrowed, though not the one a visitor is shown here.
 */
const ADVANCED = link("Advanced");

/** A day this many days before the run, as JQL writes a date: 2026-11-09. */
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
/**
 * The address of the Kafka search narrowed to issues created in the last seven days, and to nothing else, in the
 * ways Jira and a visitor write it: 'project = "12311720" AND created >= -7d' from the form, "project = KAFKA AND
 * created >= -7d" typed, "-1w" from a week, the date a week ago from "Between", either clause first, and an order
 * after. A search of every project ("created >= -7d" alone, or the sidebar's "Created recently", which is Project:
 * All), a clause joined by OR, and a clause more ("AND status = Open") are not it.
 */
const KAFKA_THIS_WEEK = (() => {
  // Jira writes the project back by its id once the form has been used: project = "12311720" is Kafka.
  const project = `project\\s*(?:=|in\\s*\\()\\s*"?(?:kafka|12311720)"?\\s*\\)?`;
  const since = [7, 6].flatMap((days) => [daysAgo(days), daysAgo(days).replace(/-/g, "/")]).join("|");
  const created = `created(?:date)?\\s*>=?\\s*"?(?:-(?:7d|1w|168h)|${since})"?`;
  return `[?&]jql=\\s*(?:${project}\\s+and\\s+${created}|${created}\\s+and\\s+${project})\\s*(?:order\\s+by\\s[^&#]*)?(?:[&#]|$)`;
})();
/** The first of two same-named controls in the date criterion's form: the "Within the last" row. */
const first = (label: string, role: string): Matcher => ({ label, role, nth: 1 });

const guides: Guide[] = [
  // The quick search and its suggestions, then a tab under the issue.
  {
    id: "ticket-history",
    start: KAFKA_ISSUES,
    goal: "Pull up ticket KAFKA-1 for me, I need to see everything that was edited on it and by whom",
    steps: [
      { expect: [QUICK_SEARCH], act: { fill: ["#quickSearchInput", "KAFKA-1"] }, say: "Type KAFKA-1 into the search box." },
      // The suggestion opens the ticket. Pressing Enter in the box does not: it runs Jira's quick search, which sends a
      // visitor who is not signed in to the sign-in page (seen on 15 November 2026). The ticket and its History tab
      // need no account.
      {
        expect: [link("The log4j appender still uses the SyncProducer API KAFKA-1"), QUICK_SEARCH],
        point: link("The log4j appender still uses the SyncProducer API KAFKA-1"),
        act: { click: '.quicksearch-dropdown a[href$="/browse/KAFKA-1"]' },
      },
      // "All" shows the same edits, mixed in with the comments.
      { expect: [{ label: "History", role: "tab" }, { label: "All", role: "tab" }], point: { label: "History", role: "tab" }, act: { click: "#changehistory-tabpanel a" } },
      DONE,
    ],
    reached: { url: "/browse/KAFKA-1", text: "made changes" },
  },
  // A dropdown that lists only the first hundred of the server's projects: the one wanted has to be typed for.
  {
    id: "only-one-project",
    start: SEARCH_ALL,
    goal: "This is showing tickets from every project on the server. How do I cut it down to just Kafka?",
    steps: [
      { expect: [button("Project: All"), ADVANCED], point: button("Project: All"), act: { click: 'button.criteria-selector[data-id="project"]' } },
      { expect: [{ label: "Find Projects...", role: "textbox" }], act: { fill: ["#searcher-pid-input", "Kafka"] }, say: "Type Kafka to find the project." },
      { expect: [{ label: "Kafka (KAFKA)", role: "checkbox" }], act: { click: 'label:has-text("Kafka (KAFKA)")' }, say: "Tick Kafka (KAFKA)." },
      { expect: [button("Update")], act: { click: UPDATE } },
      DONE,
    ],
    reached: { url: "jql=project", selector: 'button.criteria-selector[aria-label="Project: Kafka"]' },
  },
  // A criterion that has to be added first, then a form whose fields share their names.
  {
    id: "opened-this-week",
    start: SEARCH_KAFKA,
    goal: "can I narrow these down to the ones that were opened in the last 7 days?",
    steps: [
      { expect: [button("More"), ADVANCED], point: button("More"), act: { click: "button.add-criteria" } },
      // The list has 69 entries. Ticking the one wanted is right, and so is typing in the list's own search box to find it.
      {
        expect: [{ label: "Created Date", role: "checkbox" }, { label: "Search", role: "textbox" }],
        point: { label: "Created Date", role: "checkbox" },
        act: { click: 'label:has(input[value="created"])' },
        say: "Tick Created Date.",
      },
      // In the "Within the last" row the number, the unit and the row's radio button can be done in any order.
      // The form has two other ways to say the same thing: "-7d" typed as the start of "In range", or the
      // date a week ago as the start of "Between", typed or picked from the calendar its button opens.
      {
        expect: [
          first("Timespan", "textbox"),
          first("Time measurement", "select"),
          { label: "Within the last Timespan Time measurement", role: "radio" },
          { label: "Start date", role: "textbox" },
          { label: "Select a start date", role: "button" },
        ],
        point: first("Timespan", "textbox"),
        act: { fill: ["#withinTheLastValue", "7"] },
        say: "Type 7 in the first box, next to Within the last.",
      },
      // The unit starts on minutes.
      { expect: [first("Time measurement", "select")], act: { select: ["select.js-measurement", "days"] }, say: "Change minutes to days." },
      { expect: [button("Update")], act: { click: UPDATE } },
      DONE,
    ],
    // "These" are the Kafka issues the visitor is looking at, so the project has to stay.
    reached: { url: KAFKA_THIS_WEEK },
  },
  // Asked in German: where can I type a query myself? The answer is a place, so the guide ends by pointing at the query box.
  {
    id: "advanced-search-german",
    kind: "awkward",
    start: SEARCH_KAFKA,
    goal: "Wo kann ich hier eine JQL-Abfrage selbst eintippen, statt die Filter einzeln anzuklicken?",
    steps: [{ expect: [ADVANCED], act: { click: 'a.switcher-item:has-text("Advanced")' } }, { expect: [{ label: "Advanced Query", role: "combobox" }], say: "Type your query here." }],
    // The answer is a place: once the query box is on show the visitor is where they can type, pointed at or not.
    reached: { selector: "textarea#advanced-search" },
  },
  // Two things asked at once. An icon-only button, a menu, a page load, then a column header on a page of over 300 controls.
  {
    id: "table-view-and-sort",
    kind: "awkward",
    start: SEARCH_KAFKA,
    goal: "how do i get a normal table instead of this split screen thing?? and can it be sorted by when the tickets were created",
    steps: [
      // Either half may come first: the split view has its own "Order by" menu.
      {
        expect: [button("Switch search results view"), link("Order by")],
        point: button("Switch search results view"),
        act: { click: "#layout-switcher-button" },
        say: "Click the view button at the far right of the search bar.",
      },
      { expect: [link("List View")], act: { click: 'a[data-layout-key="list-view"]' } },
      { expect: [button("Created: no sorting applied to the column. Activate to apply an ascending sort")], act: { click: 'th[data-id="created"] button' }, say: "Click the Created column heading." },
      DONE,
    ],
    reached: { url: "ORDER(%20|\\+)BY(%20|\\+)created", selector: "#issuetable" },
  },
  // Two buttons say Export: this one is for the whole search, the other for the single issue open beside it.
  // A CSV entry opens a dialog, whose Export button starts the download. An Excel CSV entry starts it at once.
  // Either is where the guide ends, unpressed. It starts from a search that cannot grow, Kafka's tickets from
  // 2011 (229 of them), because Jira refuses to export more than 1,000 and the whole project has far more:
  // an Excel entry on that search ended on Jira's error page.
  {
    id: "export-spreadsheet",
    start: "/jira/issues/?jql=project%20%3D%20KAFKA%20AND%20created%20%3C%20%222012-01-01%22%20ORDER%20BY%20created%20ASC",
    goal: "get these tickets into excel",
    steps: [
      { expect: [{ label: "Export", role: "button", context: "header › Search" }], act: { click: "button.header-views" } },
      {
        expect: [
          { label: "CSV (Current fields)", role: "menuitem" },
          { label: "CSV (All fields)", role: "menuitem" },
          { label: "Excel CSV (Current fields)", role: "menuitem" },
          { label: "Excel CSV (All fields)", role: "menuitem" },
        ],
        point: { label: "CSV (Current fields)", role: "menuitem" },
        act: { click: "#currentCsvFields" },
      },
      // The dialog is not marked as modal, so the page behind it is listed too, with its two other Export buttons. The dialog's is the one in a footer.
      {
        expect: [
          { label: "Export", role: "button", context: "footer" },
          { label: "Excel CSV (Current fields)", role: "menuitem" },
          { label: "Excel CSV (All fields)", role: "menuitem" },
        ],
      },
    ],
  },
  // The visitor is pointed at Components and clicks Reports, the link above it.
  {
    id: "components-wrong-click",
    kind: "wrong-click",
    start: KAFKA_ISSUES,
    goal: "What areas is the Kafka project split into, and who looks after each one?",
    steps: [
      { expect: [link("Components of Kafka")], act: { click: side("Reports") } },
      { expect: [link("Components of Kafka")], act: { click: side("Components") }, say: "Not that one. Click Components.", sayStartsWith: "Not that one." },
      DONE,
    ],
    reached: { url: "components-page", selector: "#components-table" },
  },
  // A report picked from a page of them, then a form field with a sentence for a label.
  {
    id: "backlog-chart",
    start: KAFKA_ISSUES,
    goal: "Is Kafka's backlog growing or shrinking? I'd like a chart of tickets opened against tickets closed over the past 90 days.",
    steps: [
      { expect: [link("Reports of Kafka")], act: { click: side("Reports") } },
      { expect: [link("Created vs Resolved Issues Report")], act: { click: 'a:has-text("Created vs Resolved Issues Report")' } },
      // The form starts on 30 days.
      {
        expect: [{ label: "Days Previously Days (including today) to show in the graph.", role: "textbox" }],
        act: { fill: ["#daysprevious", "90"] },
        say: "Change Days Previously to 90.",
      },
      { expect: [button("Next")], act: { click: "#next_submit" } },
      DONE,
    ],
    reached: { url: "ConfigureReport\\.jspa\\?.*daysprevious=90", text: "Data Table" },
  },
  // A menu behind a question-mark icon, then a dialog.
  {
    id: "hotkeys",
    start: "/jira/secure/Dashboard.jspa",
    goal: "is there a cheat sheet of hotkeys?",
    steps: [
      { expect: [link("Help")], act: { click: "#help_menu" }, say: "Click the question mark at the top right." },
      { expect: [link("Keyboard Shortcuts")], act: { click: "#keyshortscuthelp" } },
      DONE,
    ],
    reached: { selector: "#keyboard-shortcuts-dialog", text: "Global Shortcuts" },
  },
  // Subscribing to a saved filter sets up emails, and needs an account. The guide ends on the link and never follows it.
  // The search finds every filter with "MLlib" in its name: four rows, each with its own Subscribe, sorted by name.
  // The one wanted is the last. If a re-recording finds more rows, count again: the recorder cannot tell.
  {
    id: "filter-by-email",
    kind: "risky",
    start: SEARCH_ALL,
    goal: "Someone shared a saved search called MLlib starter tasks. I want its results emailed to me every week.",
    steps: [
      // The sidebar link goes straight to the filter search. The Issues menu gets there through Manage filters.
      { expect: [link("Find filters"), button("Issues")], point: link("Find filters"), act: { click: "a.find-filters" } },
      { expect: [{ label: "searchName", role: "textbox" }], act: { fill: ['input[name="searchName"]', "MLlib"] }, say: "Type the filter's name." },
      { expect: [{ label: "Search", role: "button", context: "form" }], act: { click: "#filterSearchForm-submit" } },
      { expect: [{ label: "Subscribe", role: "link", nth: 4 }] },
    ],
  },
  // Jira has comments and @mentions, but no calls of any kind.
  { id: "no-video-call", kind: "no-answer", start: KAFKA_ISSUES, goal: "How do I start a video call with the person a ticket is assigned to?", steps: [DONE] },
];

export default {
  siteId: "site_bench_jira",
  origin: "https://issues.apache.org",
  hasTag: false,
  about: "The Apache Software Foundation's public Jira, read without signing in: a real production install of the issue tracker most large companies run. It stands for issue tracking and work management.",
  // Jira asks for a good deal with a POST that only reads: the scripts and styles a page needs, the rows of a search,
  // the form of a search criterion, the entries of the sort and export menus, the rules a form checks itself against,
  // and the ticket shown beside a search.
  reads:
    "^POST issues\\.apache\\.org/jira/(rest/wrm/2\\.0/resources|rest/issueNav/1/issueTable(/stable)?|rest/issueNav/1/issueNav/operations/views|rest/orderbycomponent/latest/orderByOptions/primary|rest/scriptrunner/behaviours/latest/validators\\.json|secure/QueryComponent(RendererEdit|RendererValue)?!(Default|Jql)\\.jspa|secure/AjaxIssueAction!default\\.jspa)$",
  // A dashboard's report on itself, and three notes Jira keeps about this visitor: how they like to search (split or
  // list, basic or advanced) and which project they last opened. The notes are stopped, and the page carries on all the same.
  chatter:
    "^(POST issues\\.apache\\.org/jira/(plugins/servlet/gadgets/dashboard-diagnostics|rest/issueNav/latest/preferredSearchLayout|rest/querycomponent/latest/userSearchMode)|PUT issues\\.apache\\.org/jira/rest/projects/1\\.0/project/[^/]+/lastVisited)$",
  guides,
} satisfies GuideSet;
