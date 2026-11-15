import { button, DONE, type Guide, type GuideSet, type Step } from "../guide.ts";
import type { Matcher } from "../cases.ts";

// Grafana Play (play.grafana.org): the public playground of Grafana, used by anonymous visitors.
// A live site that other people use, so nothing here saves, creates, shares or deletes:
// guides that lead to such a control stop before it.

/** "Time series graphs": a demo dashboard that has been on Play for years, in the Examples folder. */
const GRAPHS = "/d/000000016/time-series-graphs";
/** A test-data dashboard with three chained variables, so its values never change. */
const NESTED = "/d/testdata-nested-variables-drilldown/templating-nested-variables-drilldown";

const role = (name: string, label: string, extra: Partial<Matcher> = {}): Matcher => ({ label, role: name, ...extra });

const TIME_BUTTON = button("Time range selected: Last 1 hour");
const OPEN_TIME: Step = { expect: [TIME_BUTTON], act: { click: '[data-testid="data-testid TimePicker Open Button"]' } };
/** The whole simple-graph panel, and the three-dot menu that only shows while the mouse is over it. */
const SIMPLE_GRAPH = '[data-testid="data-testid Panel header Simple graph"]';
const SIMPLE_GRAPH_MENU = button("Menu for panel Simple graph");

/** The command palette. It can jump to any page, so it is a right first step wherever the way is through the menu. */
const PALETTE = button("Search...");
// Grafana escapes the ampersand twice in these two labels, and the widget reads them as written.
const EXPAND_ALERTS = button("Expand section: Alerts &amp; IRM");
const EXPAND_ALERTING = button("Expand section: Alerting");

const guides: Guide[] = [
  {
    // Ends on the panel's menu, which is hidden until the mouse is over the panel, so the widget never lists it.
    // The recorder has no way to hover and then click, and asking again moves the mouse away, so the guide stops there.
    id: "find-panel-data",
    start: "/dashboards",
    goal: "I'm looking for the raw numbers behind the Simple graph chart on the Time series graphs dashboard",
    steps: [
      { expect: [PALETTE, role("textbox", "Search for dashboards and folders")], act: { click: 'button:has-text("Search...")' } },
      { expect: [role("combobox", "Search or jump to...")], act: { fill: ['input[placeholder="Search or jump to..."]', "time series graphs"] }, say: "Type the dashboard's name." },
      { expect: [role("option", "Dashboards: Time series graphs Examples")], act: { click: '[role="option"]:has-text("Time series graphs")' } },
      { expect: [SIMPLE_GRAPH_MENU], unlisted: true, act: { hover: SIMPLE_GRAPH } },
    ],
  },
  {
    id: "time-range-wrong-click",
    start: GRAPHS,
    goal: "these graphs only go back an hour, I need to see a full day",
    kind: "wrong-click",
    steps: [
      // The visitor is pointed at the time range and clicks the refresh button beside it.
      { expect: [TIME_BUTTON], act: { click: 'button[aria-label="Refresh"]' } },
      { ...OPEN_TIME, say: "Not that one. Click the time range, Last 1 hour.", sayStartsWith: "Not that one." },
      // The quick ranges are listed as checkboxes: invisible inputs, each with a label beside it. A visitor can only click the label.
      { expect: [role("checkbox", "Last 24 hours")], act: { click: 'label:text-is("Last 24 hours")' } },
      DONE,
    ],
    reached: { url: "from=now-24h" },
  },
  {
    id: "variable",
    start: NESTED,
    goal: "This is showing data center A. I only want to see data center B.",
    steps: [
      // Either order works: take A away first, or add B first. Three chips have a cross called "Remove", and A's is the first.
      { expect: [role("button", "Remove", { nth: 1 }), role("combobox", "datacenter")], act: { click: 'button[aria-label="Remove"] >> nth=0' }, say: "Remove A." },
      { expect: [role("combobox", "datacenter")], act: { fill: ['input[role="combobox"] >> nth=0', "B"] }, say: "Open the datacenter box and type B." },
      // The guide ends on the pick: the list handles it on pointerdown and redraws, so no click reaches the widget and it never asks again.
      { expect: [role("option", "B")], act: { click: '[role="option"]:has-text("B")' } },
    ],
    reached: { selector: '[data-testid="data-testid Dashboard template variables Variable Value DropDown value link text B"]' },
  },
  {
    id: "legend-then-fullscreen",
    start: GRAPHS,
    goal: "on the simple graph i only want teh b-series line, and after that can i make that one chart fill the hole screen?",
    kind: "awkward",
    steps: [
      // Every entry in a legend is listed as "All series selected". B-series is the second one in this panel.
      { expect: [role("button", "All series selected", { context: "Simple graph", nth: 2 })], act: { click: `${SIMPLE_GRAPH} button:has-text("B-series")` }, say: "Click B-series in the legend." },
      // The mouse is still on the panel after the click in its legend, so this time the menu button shows and is listed.
      { expect: [SIMPLE_GRAPH_MENU], act: { click: '[data-testid="data-testid Panel menu Simple graph"]' } },
      { expect: [role("menuitem", "View v")], act: { click: '[role="menuitem"]:has-text("View")' } },
      DONE,
    ],
    reached: { url: "viewPanel=" },
  },
  {
    // Stops at the menu entry. Opening "Share internally" already makes a short link on the server, before anything is copied.
    id: "share-link",
    start: GRAPHS,
    goal: "¿Cómo le mando a un compañero un enlace a este dashboard que siga mostrando la última hora, y no las horas exactas que estoy viendo ahora?",
    kind: "awkward",
    steps: [
      { expect: [button("Share")], act: { click: '[data-testid="data-testid new share button arrow menu"]' } },
      { expect: [role("menuitem", "Share internally")] },
    ],
  },
  {
    id: "explore-promql",
    start: "/explore",
    goal: "I need to write my own PromQL against the play Prometheus data source, looking at the last 6 hours. Where do I set that up?",
    steps: [
      { expect: [role("combobox", "Select a data source"), TIME_BUTTON], act: { fill: ['[data-testid="data-testid Select a data source"]', "prom"] }, say: "Type prom to find the Prometheus data source." },
      { expect: [role("option", "grafanacloud-play-prom")], act: { click: '[role="option"][aria-label="grafanacloud-play-prom"]' } },
      // The query editor is swapped a moment after the pick, and the widget sometimes looks before that, so Code may not be listed yet.
      { expect: [TIME_BUTTON, { label: "Code" }], act: { click: '[data-testid="data-testid TimePicker Open Button"]' } },
      { expect: [role("checkbox", "Last 6 hours")], act: { click: 'label:text-is("Last 6 hours")' } },
      { expect: [{ label: "Code" }], act: { click: '[data-testid="data-testid radio-button-option code"]' } },
      DONE,
    ],
    reached: { url: "grafanacloud-prom.*now-6h", selector: ".monaco-editor" },
  },
  {
    id: "firing-alerts",
    start: GRAPHS,
    goal: "Which of our alert rules are going off right now? I don't want to see the quiet ones.",
    steps: [
      { expect: [role("link", "Alerts & IRM"), EXPAND_ALERTS, PALETTE], act: { click: 'nav a[href="/alerts-and-incidents"]' } },
      // The section's page has a card for Alerting, and the arrow beside the menu entry opens the same list in the menu.
      { expect: [EXPAND_ALERTS, role("link", "Alerting"), PALETTE], act: { click: 'button[aria-label^="Expand section: Alerts"]' } },
      { expect: [role("link", "Alerting"), EXPAND_ALERTING, PALETTE], act: { click: 'nav a[href="/alerting"]' } },
      { expect: [EXPAND_ALERTING, role("link", "Manage alert rules"), PALETTE], act: { click: 'button[aria-label="Expand section: Alerting"]' } },
      { expect: [role("link", "Alert rules"), role("link", "Manage alert rules"), PALETTE], act: { click: 'nav a[href="/alerting/list"]' } },
      { expect: [role("radio", "Firing")], act: { click: '[role="radiogroup"][aria-labelledby="filter-label-state"] button:has-text("Firing")' } },
      DONE,
    ],
    reached: { url: "state:firing" },
  },
  {
    // Stops at Save: this is a public instance, and nothing is to be created on it.
    id: "new-dashboard",
    start: "/",
    goal: "I want to start a dashboard of my own with one empty panel on it, and then save it",
    steps: [
      { expect: [PALETTE, button("New")], act: { click: 'button:has-text("Search...")' } },
      { expect: [role("option", "Actions: New dashboard")], act: { click: '[role="option"]:has-text("New dashboard")' } },
      // The second "Add" is the plus in the side bar, which offers a panel too. The first one adds variables and links.
      { expect: [button("Add visualization"), role("button", "Add", { nth: 2 })], act: { click: 'button:has-text("Add visualization")' } },
      { expect: [button("Save")] },
    ],
  },
  {
    id: "hide-side-menu",
    start: GRAPHS,
    goal: "the menu down the left is eating half my screen, how do i hide it",
    steps: [{ expect: [button("Close menu"), button("Undock menu")], act: { click: 'button[aria-label="Close menu"]' } }, DONE],
    reached: { selector: "#mega-menu-toggle" },
  },
  // Grafana exports a dashboard as PDF, JSON or an image. There is no slide deck.
  { id: "no-powerpoint", start: GRAPHS, goal: "How do I export this dashboard as a PowerPoint presentation?", kind: "no-answer", steps: [DONE] },
  {
    id: "delete-panel",
    start: GRAPHS,
    goal: "How do I get rid of the box called The Basics on this dashboard?",
    kind: "risky",
    steps: [
      { expect: [button("Enter edit mode")], act: { click: '[data-testid="data-testid Edit dashboard button"]' } },
      // In edit mode a panel is selected by clicking it. The panel is not a control the widget lists.
      { expect: [{ label: "The Basics" }], unlisted: true, act: { click: '[data-testid="data-testid Panel header The Basics"] h2' } },
      { expect: [button("Delete")] },
    ],
  },
];

export default {
  siteId: "site_bench_grafana",
  origin: "https://play.grafana.org",
  hasTag: false,
  about: "Grafana Play, the public playground of Grafana, used without signing in. It stands for analytics and monitoring dashboards: dense, icon-heavy and full of custom controls.",
  // Opening either share panel creates a short link on the server straight away, and a snapshot is published.
  never: "Share internally|Share externally|Snapshot|Copy link|Copy URL|Shorten",
  // What a page has to send to draw itself: each panel's query (at its old address and its new one), the same for a
  // Prometheus data source's own read addresses, the search for dashboards, and the question of which features are
  // switched on. All of them only read.
  reads:
    "^POST play\\.grafana\\.org/(api/ds/query|ofrep/v1/evaluate/flags|api/datasources/uid/[^/]+/resources/api/v1/(query|query_range|query_exemplars|labels|series|metadata|label/[^/]+/values)|apis/query\\.grafana\\.app/[^/]+/namespaces/[^/]+/query|apis/dashboard\\.grafana\\.app/[^/]+/namespaces/[^/]+/(notebooks/search|dashboards/search/hybrid))$",
  // Usage counts, and the note Explore makes of every query it runs. The page sends these whoever is looking and works without them.
  chatter: "^POST play\\.grafana\\.org/api/(frontend-metrics|ma/events|query-history)$",
  guides,
} satisfies GuideSet;
