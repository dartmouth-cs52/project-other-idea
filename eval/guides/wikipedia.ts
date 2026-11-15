import { createRequire } from "node:module";
import type { Matcher } from "../cases.ts";
import { any, button, DONE, link, type Guide, type GuideSet, type Step } from "../guide.ts";

// English Wikipedia as a reader who is not signed in. It is here for one
// reason above all: its pages are very large. An article has 800 to 1,200
// links, so the widget's list is cut at 300 on every article and on most
// special pages, and what a reader needs is sometimes not in it.
//
// It is a live site. No guide edits, publishes, signs in or downloads. The
// only forms sent are read-only queries (the site search and the filter on
// "What links here"), and the three guides that end on a link leaving the
// site (a cited source, the German edition, Donate) stop on it.
//
// How the widget names this site's controls, which the matchers follow:
// - The Tools and Main menu buttons are invisible checkboxes with role
//   "button". Their entries are listed only once the menu is open.
// - Contents entries carry their number: "4.2.2 Mobile devices".
// - A footnote marker is listed as "[ 3]", with a space.
// - Appearance has two radios called "Standard" (text size and width), told
//   apart only by their order.
// - Links through /w/index.php (history, edit, page information, permanent
//   link, cite, PDF, every "prev", "cur" and "undo") all read "to /w/index.php":
//   the query that tells them apart is dropped.
//
// What the cut leaves out when a long article is read from the top: the body
// after about its first 215 links (of 830), the whole reference list, the
// categories and the footer. The boxes of related links at the foot of an
// article count as "nav", so their fifty links are kept ahead of all of those.

// Three workarounds for the recorder, kept in this file because nothing else
// may be edited. All are switched on only for the recorder and the look tool,
// so whole-guide runs still show what the widget really does.
//
// 1. Leaving a page. Wikipedia is a multi-page site and its uncached pages
// (history, special pages, search results) take 300 ms to over a second to
// start arriving. The widget asks for the next step 300 ms after a click, so
// after a click that loads a new page it often asks from the page the visitor
// is leaving. The recorder (eval/browser.ts) leaves such a request unanswered.
// That is not enough here: when the page then goes, the request fails while
// the old page can still run, the widget takes that for an error, gives up
// and clears the guide it had saved, and so does not pick the guide up on the
// new page ("the widget never asked for step 3"). This keeps the request from
// being sent at all once the page has started to unload.
//
// 2. Arriving on a page. The widget picks a guide up about 300 ms after its
// script starts on the new page. Wikipedia's own scripts are often still at
// work then: the Appearance panel is not drawn yet, and on special pages a
// plain <select> has not yet been swapped for the custom dropdown that
// replaces it. So the same step is listed one way on one visit and another
// way on the next (and a pointer put on the plain <select> is left on nothing
// when it goes). The recorder already waits for the start page to finish;
// this makes the widget wait the same way on the pages a guide moves to, by
// holding its first request until the page has loaded and stopped changing.
const STEADY_PAGES = `(() => {
  if (window.top !== window) return;
  let leaving = false;
  addEventListener("beforeunload", () => { leaving = true; });
  const steady = () => new Promise((resolve) => {
    const started = Date.now();
    let timer;
    const done = () => { observer.disconnect(); clearTimeout(timer); resolve(); };
    const wait = () => {
      clearTimeout(timer);
      timer = setTimeout(() => (document.readyState === "complete" || Date.now() - started > 8000 ? done() : wait()), 700);
    };
    const observer = new MutationObserver(() => (Date.now() - started > 8000 ? done() : wait()));
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    wait();
  });
  const send = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    if (leaving && /^https:\\/\\/widget\\.joinhaptic\\.com\\/v1\\/turn$/.test(url)) return new Promise(() => {});
    if (/^https:\\/\\/widget\\.joinhaptic\\.com\\/v1\\/sites\\//.test(url)) return steady().then(() => send.call(this, input, init));
    return send.call(this, input, init);
  };
})();`;

// 3. Two things in one step. A script step has one "act", but once a visitor
// does two things before the widget hears of either: see "links-here". A click
// selector written "A >> then >> B" clicks A, waits a moment as a visitor
// would, and clicks B.
const THEN = " >> then >> ";

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
        await context.addInitScript(STEADY_PAGES);
        const newPage = context.newPage.bind(context);
        context.newPage = async () => {
          const page = await newPage();
          const locator = page.locator.bind(page);
          page.locator = (selector: string, ...rest: unknown[]) => {
            const parts = selector.split(THEN);
            if (parts.length === 1) return locator(selector, ...rest);
            const inTurn = {
              first: () => inTurn,
              click: async () => {
                for (const [index, part] of parts.entries()) {
                  if (index) await page.waitForTimeout(1000);
                  await locator(part).first().click();
                }
              },
            };
            return inTurn;
          };
          return page;
        };
        return context;
      };
      return browser;
    };
  } catch {
    // Playwright isn't installed, so there is nothing to record with.
  }
}

/** A long article: about 830 links on a page 13,700 pixels tall. */
const ARTICLE = "/wiki/Haptic_technology";

const TOOLS: Step = { expect: [button("Tools")], act: { click: "#vector-page-tools-dropdown-checkbox" }, say: "Open the Tools menu: the three dots at the top right of the article." };
const MAIN_MENU: Step = { expect: [button("Main menu")], act: { click: "#vector-main-menu-dropdown-checkbox" }, say: "Open the main menu: the three lines at the top left." };
/** The article's own history tab. Rows of the history page have a "talk" link each, so the tab is told apart by where it leads. */
const HISTORY_TAB: Matcher = { label: "View history", role: "link", context: "nav" };

const guides: Guide[] = [
  // The Tools menu, then a special page with a form: a custom dropdown (OOUI),
  // its options, and the button that runs the query.
  {
    id: "links-here",
    start: ARTICLE,
    goal: "Which other Wikipedia articles mention this one? I only want proper articles, not talk pages or user pages.",
    steps: [
      TOOLS,
      { expect: [link("What links here")], act: { click: "#t-whatlinkshere a" } },
      { expect: [{ label: "Namespace: all", role: "combobox" }], act: { click: "#namespace .oo-ui-dropdownWidget-handle" }, say: "Open the Namespace list." },
      // Choosing an entry of this dropdown fires no click event (OOUI acts on mouse-down and mouse-up, and hides
      // the list before a click can happen), so the widget never hears that the visitor did what it showed, and
      // never asks for the next step. The visitor picks (Article), hears nothing more, and presses Go unprompted.
      {
        expect: [{ label: "(Article)", role: "option" }],
        act: { click: `.oo-ui-menuSelectWidget [role="option"]:has-text("(Article)"):visible${THEN}#mw-content-text form button[type="submit"]` },
        say: "Pick (Article).",
      },
      DONE,
    ],
    reached: { url: "Special:WhatLinksHere.*namespace=0" },
  },

  // The Appearance panel: three settings asked for at once, with typos. Any order is right.
  {
    id: "appearance",
    start: ARTICLE,
    goal: "txt is way too small 4 me, and the white backround hurts my eyes at nite.. also why is there so much empty space on the sides, cant the page use the hole screen??",
    kind: "awkward",
    steps: [
      { expect: [any("Large"), any("Wide"), any("Dark")], act: { check: "#skin-client-pref-vector-feature-custom-font-size-value-2" }, say: "Choose Large under Text." },
      { expect: [any("Wide"), any("Dark")], act: { check: "#skin-client-pref-vector-feature-limited-width-value-0" }, say: "Choose Wide under Width." },
      { expect: [any("Dark")], act: { check: "#skin-client-pref-skin-theme-value-night" }, say: "Choose Dark under Color." },
      DONE,
    ],
    reached: { selector: "html.vector-feature-custom-font-size-clientpref-2.vector-feature-limited-width-clientpref-0.skin-theme-clientpref-night" },
  },

  // The table of contents: the section is two levels down and its branch starts closed.
  // The arrow opens the branch; the section's own link opens it too, and scrolls there.
  {
    id: "contents-section",
    start: ARTICLE,
    goal: "Where does it talk about phones buzzing and vibrating? I don't want to scroll through the whole thing.",
    steps: [
      {
        expect: [button("Toggle Applications subsection"), link("4 Applications")],
        point: button("Toggle Applications subsection"),
        act: { click: "#toc-Applications > button.vector-toc-toggle" },
        say: "Open Applications in the contents.",
      },
      { expect: [link("4.2.2 Mobile devices")], act: { click: "#toc-Mobile_devices > a" } },
      DONE,
    ],
    reached: { url: "#Mobile_devices$" },
  },

  // The article body, then the references. The footnote jumps 11,000 pixels
  // down, where about eighty links from the reference list are on screen at
  // once. The guide stops at the source, which is on another site.
  {
    id: "footnote-source",
    start: ARTICLE,
    goal: "The first paragraph says these technologies let you feel virtual objects, with a little 3 after it. What's the source for that? I'd like to open it.",
    steps: [
      // The marker jumps straight to the source. References in the contents leads to the top of the same list, where number 3 is in view.
      { expect: [link("[ 3]"), link("6 References")], point: link("[ 3]"), act: { click: "#cite_ref-3 a" }, say: "Click the small [3] in the first paragraph." },
      {
        expect: [
          { label: '"International Society for Haptics: Haptic technology, an animated explanation"', role: "link" },
          { label: "the original", role: "link", href: "external:www.isfh.org" },
        ],
      },
    ],
  },

  // The footer. On a long article it is not in the cut list at all, so the
  // first step cannot be pointed at. The visitor finds the link, and asks again
  // on the page it leads to.
  {
    id: "footer-disclaimer",
    start: ARTICLE,
    goal: "Does Wikipedia have some kind of disclaimer about medical advice? Where would I find it?",
    steps: [
      { expect: [{ label: "Disclaimers", role: "link", context: "footer" }], unlisted: true, act: { click: "#footer-places-disclaimers a" } },
      { expect: [link("Medical disclaimer")], act: { click: '#mw-content-text a[href$="Wikipedia:Medical_disclaimer"]' } },
      DONE,
    ],
    reached: { url: "/wiki/Wikipedia:Medical_disclaimer$" },
  },

  // A wrong click that lands on a page with a look-alike. On the talk page
  // "View history" is the history of the discussion, not of the article, so
  // the way back is the Article tab. Then the history table: fifty rows with
  // the same "prev" and "cur" on each.
  {
    id: "last-change-wrong-click",
    start: ARTICLE,
    goal: "What was the most recent change somebody made to this article?",
    kind: "wrong-click",
    steps: [
      // The visitor is pointed at View history and clicks Talk, two tabs to its left.
      { expect: [HISTORY_TAB], act: { click: "#ca-talk a" } },
      { expect: [link("Article")], trap: [HISTORY_TAB], act: { click: "#ca-nstab-main a" }, say: "Not that one. Click Article to go back to the article.", sayStartsWith: "Not that one." },
      { expect: [HISTORY_TAB], act: { click: "#ca-history a" } },
      // The top row's "prev", the second row's "cur" and the button all show the latest change.
      {
        expect: [{ label: "prev", role: "link", nth: 1 }, { label: "cur", role: "link", nth: 1 }, button("Compare selected revisions")],
        point: { label: "prev", role: "link", nth: 1 },
        act: { click: '#pagehistory li >> nth=0 >> a:text-is("prev")' },
        say: "Click prev on the top row.",
      },
      DONE,
    ],
    // Any of the three leads to a diff of the article, not of its talk page.
    reached: { url: "title=Haptic_technology&(.*&)?diff=" },
  },

  // The one control here that takes money. It leads to another site, so the guide stops on it.
  // Asked from a third long article (about 1,060 links).
  {
    id: "donate",
    start: "/wiki/Touchscreen",
    goal: "I'd like to chip in a few dollars to keep this site running. Where do I pay?",
    kind: "risky",
    steps: [{ expect: [link("Donate")] }],
  },

  // Wikipedia has no read-aloud button, and this article has no spoken version.
  { id: "read-aloud", start: ARTICLE, goal: "can it read the article out loud to me?", kind: "no-answer", steps: [DONE] },

  // The search box, the results page, then a second long article and its
  // sortable table. A column is sorted by clicking its header cell, which the
  // widget does not list. It lists only the link inside the cell, and that
  // link leaves the page. The guide ends on that click: the widget cannot see
  // whether a table is sorted, so asking again there would prove nothing.
  {
    id: "find-and-sort",
    start: ARTICLE,
    goal: "I'm trying to find that big table of every chemical element. I want it ordered by melting point, lowest first.",
    steps: [
      { expect: [any("Search Wikipedia")], act: { fill: ['input[name="search"]', "chemical elements list"] }, say: "Type what you're looking for in the search box." },
      // The suggestions under the box load a moment after typing, when the site's rate limit lets them: one of
      // them is the list itself and another runs the same search, so both are right when they are there.
      {
        expect: [button("Search"), any("List of chemical elements (Redirected from Chemical element list)"), any("Search for pages containing chemical elements list")],
        point: button("Search"),
        act: { click: "#searchform button.cdx-search-input__end-button" },
      },
      { expect: [{ label: "List of chemical elements", role: "link", href: "/wiki/List_of_chemical_elements" }], act: { click: '.mw-search-result-heading a[href$="/wiki/List_of_chemical_elements"]' } },
      {
        expect: [{ label: "Melting point", role: "columnheader" }],
        unlisted: true,
        trap: [{ label: "Melting point", role: "link", href: "/wiki/Melting_point" }],
        act: { click: 'th.headerSort:has-text("Melting")' },
        say: "Click the Melting point column heading, beside the words, not on them.",
      },
    ],
    reached: { url: "/wiki/List_of_chemical_elements$", selector: 'th.headerSortUp:has-text("Melting")' },
  },

  // The language picker, asked in German. The guide stops at the link, which leads to de.wikipedia.org.
  {
    id: "auf-deutsch",
    start: ARTICLE,
    goal: "Gibt es diesen Artikel auch auf Deutsch?",
    kind: "awkward",
    steps: [
      // The label counts the languages, so it changes when a translation is added.
      { expect: [button("23 languages")], act: { click: "#p-lang-btn-checkbox" } },
      { expect: [any("Deutsch")] },
    ],
  },

  // The main menu, then Recent changes: a live special page with a filter box
  // that opens a long menu of checkboxes.
  {
    id: "recent-changes",
    start: ARTICLE,
    goal: "Where can I watch edits coming in across the whole site? I only care about the ones from people who aren't logged in.",
    steps: [
      MAIN_MENU,
      { expect: [link("Recent changes")], act: { click: "#n-recentchanges a" } },
      {
        expect: [any("Filter changes (use menu or search for filter name)"), { label: "", role: "clickable", context: "main", nth: 1 }],
        point: any("Filter changes (use menu or search for filter name)"),
        act: { fill: [".mw-rcfilters-ui-filterTagMultiselectWidget input", "Unregistered"] },
        say: "Type Unregistered in the filter box.",
      },
      // The menu entry and the checkbox inside it are listed as two controls. The checkbox's label runs the name and the description together.
      {
        expect: [
          { label: "Unregistered Editors who aren't logged-in and editors who are using temporary a…", role: "option" },
          { label: "UnregisteredEditors who aren't logged-in and editors who are using temporary ac…", role: "checkbox" },
        ],
        act: { click: '.mw-rcfilters-ui-menuSelectWidget [role="option"]:has-text("Unregistered"):visible' },
        say: "Tick Unregistered.",
      },
      DONE,
    ],
    reached: { url: "userExpLevel=unregistered" },
  },
];

export default {
  siteId: "site_bench_wikipedia",
  origin: "https://en.wikipedia.org",
  hasTag: false,
  about: "English Wikipedia as a logged-out reader: very long, link-dense pages that overflow the widget's 300-control list. It stands for content-heavy enterprise sites: knowledge bases, intranets, long tables.",
  // In November about one article view in six gets a full-screen fundraising
  // banner, picked at random. It pushes the whole page down and adds eighteen
  // controls, so two recordings would not agree. This is the address
  // Wikipedia's banners use to remember that a reader closed them (it sets a
  // one-week cookie and returns a one-pixel image), so every guide starts as a
  // reader who has already closed the banner once. "dismiss" is the banner's
  // own close button, in case one still shows.
  before: { path: "/wiki/Special:HideBanners?category=fundraising&reason=close&duration=604800", acts: [] },
  dismiss: ["#centralNotice .frb-close"],
  // A live site: a whole-guide run must not open the editor (it types into any field it is shown), sign in,
  // download or wander off to the donation form. "donate" still ends on the Donate link, which is where it stops.
  never: "^(edit|view source|add topic|undo|log in|create account|download|upload file|donate)\\b",
  guides,
} satisfies GuideSet;
