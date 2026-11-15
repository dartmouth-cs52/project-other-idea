import { createRequire } from "node:module";
import type { Matcher } from "../cases.ts";
import { any, button, DONE, type Act, type Guide, type GuideSet } from "../guide.ts";

// The public demo of Backstage (demo.backstage.io): a developer portal with a
// software catalogue, docs, an API explorer, a tech radar and templates. It is
// a live instance that anyone can use, so no guide here creates, registers or
// deletes anything: a guide stops, with no `act`, at the control that would.

// ---------------------------------------------------------------------------
// What a visitor does when the widget goes quiet
//
// Several controls here act on the press, not on the click: a Material UI
// select opens on mousedown and the new menus (React Aria) open on
// pointerdown. Their list then covers the control, so the click that follows
// lands on the page behind and the widget, which listens for clicks, never
// learns that anything opened. A radio button drawn as a label over a hidden
// input is the same: the click stays on the label and never reaches the input
// the widget was pointing at. In each case the pointer stays where it was and
// no next step is asked for until the visitor does something else.
//
// The recorder waits for the widget to ask before each `act`, so it cannot do
// "open the list" and "pick from it" as two acts. `alone` is a selector that
// does the first for the visitor and resolves to the second, so that one `act`
// covers both: the control is pressed (or clicked) exactly as far as the
// widget would see it, which is not at all, and then the real click goes to
// what the visitor picks on their own. The step the widget next asks for is
// what it truly sends in that state, with the visitor's choice reported as a
// click on something else. Two real clicks in a row give the same requests.
//
// The step the visitor does alone has no case, because the widget sends
// nothing for it. There are five in this file, one per use of `pressThen` or
// `clickThen`, and each is a step Haptic could not guide.
//
//   alone=press|<css of the control>|<css of what is clicked next>|<its exact text>
//   alone=click|<css of the control>|<css of what is clicked next>|<its exact text>
// ---------------------------------------------------------------------------
const ALONE = `(() => {
  const shown = (el) => el.getClientRects().length > 0;
  const queryAll = (root, body) => {
    const [how, first, second, text] = body.split("|");
    const doc = root.ownerDocument || root;
    const done = (window.__alone = window.__alone || {});
    if (!done[body]) {
      const control = Array.from(doc.querySelectorAll(first)).find(shown);
      if (!control) return [];
      done[body] = true;
      if (how === "click") control.click();
      else {
        const box = control.getBoundingClientRect();
        const at = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
        const pointer = { ...at, pointerId: 1, pointerType: "mouse", isPrimary: true, width: 1, height: 1, pressure: 0.5 };
        control.dispatchEvent(new PointerEvent("pointerdown", pointer));
        control.dispatchEvent(new MouseEvent("mousedown", at));
        // The press ends off the control, as it does for a visitor once the list covers it.
        doc.body.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0, pressure: 0 }));
        doc.body.dispatchEvent(new MouseEvent("mouseup", { ...at, buttons: 0 }));
      }
      return [];
    }
    return Array.from(doc.querySelectorAll(second)).filter((el) => shown(el) && (!text || (el.textContent || "").trim() === text));
  };
  return { queryAll, query: (root, body) => queryAll(root, body)[0] || null };
})()`;

try {
  // The same Playwright the recorder loads. An engine can be registered once per process.
  createRequire(import.meta.url)("playwright").selectors.register("alone", ALONE);
} catch {
  // Already registered, or Playwright is not installed: then nothing here is run anyway.
}

/** Presses a control that opens on the press, then clicks what the visitor picks from it. */
const pressThen = (control: string, next: string, text = ""): Act => ({ click: `alone=press|${control}|${next}|${text}` });
/** Clicks a control whose click the widget does not see, then clicks what the visitor does next. */
const clickThen = (control: string, next: string, text = ""): Act => ({ click: `alone=click|${control}|${next}|${text}` });

// Controls that come up in more than one guide, named the way the widget lists them.

/** The catalogue's Kind filter. A Material UI select is listed as a button that carries its value, not its name. */
const KIND: Matcher = { label: "Component", role: "button", context: "Backstage Catalog" };
/**
 * The catalogue's Owner filter: an autocomplete that the widget lists three
 * times over, as a box with no name, the text field inside it, and its arrow.
 * It is the first of several such boxes, so the nameless parts are counted.
 */
const OWNER: Matcher[] = [
  { label: "", role: "combobox", nth: 1 },
  { label: "Owner", role: "textbox" },
  { label: "Open", role: "button", nth: 1 },
];
/** The sidebar's link to the API explorer. An entity's own "APIs" tab has the same label and is also "in nav". */
const APIS: Matcher = { label: "APIs", role: "link", href: "/api-docs" };
const SEARCH: Matcher = { label: "Search", role: "button", context: "nav" };

// The template's first page. Every field on it is required, in any order.
const NAME: Matcher = { label: "What is your Name?(Required)", role: "textbox" };
const MODE: Matcher[] = [
  { label: "Light", role: "radio" },
  { label: "Dark", role: "radio" },
];
/** Each topic is listed twice: the hidden checkbox and the words beside it. Either is right. */
const TOPICS: Matcher[] = ["Writing Templates", "Input Examples", "Builtin Actions", "Writing Custom Actions", "Writing Custom Field Extensions", "Adding Your Own Templates"].map(any);

const APIS_TAB: Matcher = { label: "APIs", role: "link", href: "/catalog/default/component/www-artist/apis" };

// Where a guide has more than one right first step, the recorder's stand-in
// takes whichever comes first on the page, and the `act` follows it. Global
// search is counted as a right first step only where the visitor names the
// thing they are after and it is not already on the page in front of them.

const guides: Guide[] = [
  // Filters: a Material UI select (opens on the press) and an autocomplete.
  {
    id: "systems-of-team",
    start: "/catalog",
    goal: "This list only shows components. I want to see our systems instead, and only the ones Team B owns.",
    steps: [
      // The filters can be set in either order: the owner is kept when the kind changes.
      {
        expect: [KIND, ...OWNER],
        act: pressThen('[aria-label="Kind"] [role="button"]', '[role="option"]', "System"),
        say: "Open the Kind list, which says Component, and choose System.",
      },
      // The widget never saw the list open. It hears of the choice as a click on something else.
      { expect: OWNER, act: { click: 'button[aria-label="Open"]' }, say: "Open the Owner filter." },
      { expect: [{ label: "Team B", role: "option" }, { label: "Team B", role: "checkbox" }], act: { click: '[role="option"]:has-text("Team B")' } },
      DONE,
    ],
    reached: { url: "filters%5Bkind%5D=system.*filters%5Bowners%5D=group%3Adefault%2Fteam-b", text: "All Systems (1)" },
  },

  // The search dialog, then an entity page whose "Documentation" tab is a menu.
  {
    id: "api-raw-source",
    start: "/catalog",
    goal: "I need to copy the raw AsyncAPI source of the streetlights API. Where is it?",
    steps: [
      { expect: [SEARCH, APIS, KIND], act: { click: 'nav button:has-text("Search")' } },
      { expect: [{ label: "Search", role: "textbox" }], act: { fill: ['[role="dialog"] input', "streetlights"] }, say: "Type streetlights." },
      { expect: [{ label: "streetlights", role: "link", href: "/catalog/default/api/streetlights" }], act: { click: '[role="dialog"] a[href="/catalog/default/api/streetlights"]' } },
      // The definition is further down this page, with a Raw tab of its own, and on a page of its own under Documentation.
      {
        expect: [{ label: "Raw", role: "tab" }, { label: "Documentation", role: "button" }],
        act: pressThen('main nav button[aria-haspopup="true"]', '[role="menuitemradio"]', "Definition"),
        say: "Open Documentation and choose Definition.",
      },
      { expect: [{ label: "Raw", role: "tab" }], act: { click: '[role="tab"]:has-text("Raw")' } },
      DONE,
    ],
    reached: { url: "/catalog/default/api/streetlights/definition$", selector: '[role="tab"][aria-selected="true"]:has-text("Raw")' },
  },

  // Tabs on an entity page. The visitor clicks the tab next to the one they were shown.
  {
    id: "consumed-apis-wrong-tab",
    kind: "wrong-click",
    start: "/catalog/default/component/www-artist",
    goal: "which APIs does this website call?",
    steps: [
      { expect: [APIS_TAB], act: { click: 'main nav a[href$="/www-artist/docs"]' }, say: "Click the APIs tab under the component's name." },
      { expect: [APIS_TAB], act: { click: 'main nav a[href$="/www-artist/apis"]' }, say: "Not that one. Click the APIs tab, next to Docs.", sayStartsWith: "Not that one." },
      DONE,
    ],
    reached: { url: "/component/www-artist/apis$", text: "Consumed APIs" },
  },

  // Documentation: the docs index, then a page drawn inside a shadow root.
  // It starts on the index. Asked from the catalogue, with "Docs" in the sidebar as the first step,
  // it could not be recorded one time in three: the index and the docs themselves arrive late, and
  // the widget had already read the page without them.
  {
    id: "docs-page",
    start: "/docs",
    goal: "Somewhere in the backstage-demo documentation there's a page about Mermaid diagrams. How do I get to it?",
    steps: [
      { expect: [{ label: "backstage-demo", role: "link", href: "/docs/default/component/backstage-demo" }], act: { click: 'a[href="/docs/default/component/backstage-demo"]' } },
      // The same link is in the docs' own side menu, folded away under Examples. The widget lists that
      // one too when it reads the page before the docs' styles have folded it, so the click goes to
      // whichever is showing first.
      { expect: [{ label: "Mermaid", role: "link", href: "/docs/default/component/backstage-demo/examples/mermaid" }], act: { click: 'a[href$="/examples/mermaid/"]:visible' } },
      DONE,
    ],
    reached: { url: "/docs/default/component/backstage-demo/examples/mermaid/?$" },
  },

  // The tech radar is one SVG, and the widget skips SVG, so nothing on it is listed.
  // The guide ends on the entry and has no closing step: the entry opens a dialog that keeps the
  // keyboard focus, so the visitor cannot type a second question into the widget while it is open.
  {
    id: "radar-entry",
    start: "/catalog",
    goal: "Is Webpack still one of our recommended technologies? I'd like to see when its status last changed.",
    steps: [
      { expect: [{ label: "Tech Radar", role: "link", href: "/tech-radar" }], act: { click: 'nav a[href="/tech-radar"]' } },
      { expect: [{ label: "Webpack", role: "button" }], unlisted: true, act: { click: 'svg foreignObject span[role="button"]:has-text("Webpack")' } },
    ],
    reached: { selector: '[role="dialog"] h2:has-text("Webpack")' },
  },

  // A form with a text field, radio buttons and checkboxes, then a second page.
  // It stops at the owner: once one is typed the app asks the visitor to sign in to GitHub,
  // which no guide here does, and without that the repository cannot be created.
  {
    id: "new-site-from-template",
    start: "/create",
    goal: "How do I spin up a new website from the demo template?",
    steps: [
      { expect: [button("Choose")], act: { click: 'button:has-text("Choose")' } },
      { expect: [NAME, ...MODE, ...TOPICS], act: { fill: ["#root_name", "Sam Example"] }, say: "Type your name." },
      // A click on a radio's label never reaches the hidden input the widget points at, so the
      // widget waits. The visitor carries on alone and ticks a topic, which is what it hears of next.
      {
        expect: [...MODE, ...TOPICS],
        act: clickThen('label:has(input[name="root_mode"][value="0"])', 'label:has(input[value="writing-templates"])'),
        say: "Choose Light or Dark.",
      },
      { expect: [button("Next")], act: { click: 'form button[type="submit"]' } },
      {
        expect: [
          { label: "Owner(Required)", role: "combobox" },
          { label: "Owner(Required)", role: "button" },
          { label: "Repository(Required)", role: "combobox" },
          { label: "Repository(Required)", role: "button" },
        ],
        say: "Type the GitHub user or organisation that will own the repository.",
      },
    ],
  },

  // Deleting. The menu opens on the press, so the widget is silent while it is open, and the
  // confirmation is the next thing it sees. "Delete Entity" is never clicked.
  {
    id: "remove-from-catalog",
    kind: "risky",
    start: "/catalog/default/component/searcher",
    goal: "This service was shut down last year. How do I take it out of the catalog?",
    steps: [
      {
        expect: [button("More actions")],
        act: pressThen('button[aria-label="More actions"]', '[role="menuitem"]', "Unregister entity"),
        say: "Open the menu at the top right, the three dots, and choose Unregister entity.",
      },
      { expect: [button("Delete Entity")] },
    ],
  },

  // Icon-only buttons, and a filter that is listed as a menu item with a count in its name.
  {
    id: "star-and-filter",
    start: "/catalog/default/component/dice-roller",
    goal: "I keep coming back to this service. Can I bookmark it, and then see just my bookmarked ones in the catalog list?",
    steps: [
      { expect: [button("Add to favorites")], act: { click: 'button[aria-label="Add to favorites"]' }, say: "Click the star at the top right." },
      // The logo leads to the catalogue too, and comes first on the page. It is listed with no label.
      {
        expect: [{ label: "", role: "link", href: "/catalog" }, { label: "Catalog", role: "link", href: "/catalog" }],
        act: { click: 'nav a[href="/catalog"]' },
        say: "Click the Backstage logo to go to the catalogue.",
      },
      { expect: [{ label: "Starred 1", role: "menuitem" }], act: { click: '[data-testid="user-picker-starred"]' }, say: "Click Starred." },
      DONE,
    ],
    reached: { url: "filters%5Buser%5D=starred", text: "dice-roller" },
  },

  // Typos, and two things asked at once. Both are on the same settings page, in either order.
  {
    id: "dark-and-sidebar",
    kind: "awkward",
    start: "/catalog",
    goal: "how do i trun on drak mode?? and also the left menu shoudnt stay open all the time",
    steps: [
      { expect: [{ label: "Settings", role: "link", href: "/settings" }], act: { click: 'nav a[href="/settings"]' } },
      { expect: [button("Dark"), { label: "Pin Sidebar Switch", role: "checkbox" }], act: { click: 'button[value="dark"]' } },
      { expect: [{ label: "Pin Sidebar Switch", role: "checkbox" }], act: { click: 'input[name="pin"]' }, say: "Turn off Pin Sidebar." },
      DONE,
    ],
    reached: { selector: 'body:has(button[value="dark"][aria-pressed="true"]) input[name="pin"]:not(:checked)' },
  },

  // In Spanish: "How can I see only the APIs of type GraphQL?" The API explorer's Type filter is another select.
  {
    id: "graphql-apis-es",
    kind: "awkward",
    start: "/catalog",
    goal: "¿Cómo puedo ver solo las APIs que son de tipo GraphQL?",
    steps: [
      // The catalogue can list APIs as well, through its Kind filter.
      { expect: [APIS, KIND], act: { click: 'nav a[href="/api-docs"]' } },
      {
        expect: [{ label: "all", role: "button", context: "Backstage API Explorer" }],
        act: pressThen('[aria-label="Type"] [role="button"]', '[role="option"]', "graphql"),
        say: "Open the Type list, which says all, and choose graphql.",
      },
      DONE,
    ],
    reached: { url: "filters%5Btype%5D=graphql", text: "All graphql APIS (1)" },
  },

  // The catalogue's table has a filter box, sorting and paging, and no way to export or download it.
  { id: "export-list", kind: "no-answer", start: "/catalog", goal: "How do I export this list of components to a CSV or Excel file?", steps: [DONE] },
];

/** Matches nothing. See `dismiss` below. */
const PAUSE = "#backstage-has-nothing-to-dismiss";

export default {
  siteId: "site_bench_backstage",
  origin: "https://demo.backstage.io",
  hasTag: false,
  about: "The public demo of Backstage, a developer portal (catalogue, docs, API explorer, tech radar, templates) built with React, Material UI and React Aria. It stands for internal developer and IT portals.",
  // There is no banner to click away. These are here for the time the recorder gives each one.
  // The app's script is large: the network goes quiet while it is still starting, and after that
  // the catalogue's data can take a few seconds. A question asked at once is answered from an
  // empty or half-drawn page, which no visitor who has to type a question would be looking at.
  // The first entry is a divider in the sidebar, harmless to click, which is there once the app
  // has drawn. The others never match, and the recorder waits a second and a half for each.
  dismiss: ["nav hr", PAUSE, PAUSE, PAUSE],
  // The catalogue is read with a POST: its rows, the choices of its filters, and the entities a page names.
  reads: "^POST demo\\.backstage\\.io/api/catalog/(entities/by-query|entities/by-refs|entity-facets)$",
  guides,
} satisfies GuideSet;
