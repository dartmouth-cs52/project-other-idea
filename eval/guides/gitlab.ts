import { button, DONE, link, type Guide, type GuideSet } from "../guide.ts";
import type { Matcher } from "../cases.ts";

// GitLab.com as a visitor who is not signed in, on the public project
// gitlab-org/gitlab. A live production site, so everything here only browses,
// searches, filters, sorts and opens menus. Nothing is downloaded, and no guide
// goes to a sign-in page: where a task ends on such a control, the script stops
// before it.
//
// The project changes by the minute (commits, issues, pipelines, branches), so
// the guides hold on to GitLab's own chrome and to things that stay put: the
// LICENSE file, config/gitlab.yml.example, the tags v17.0.0-ee and v17.0.1-ee
// (May 2024), the pipeline that ran for v17.0.0-ee, and the long-lived label
// "Seeking community contributions".

const PROJECT = "/gitlab-org/gitlab";

/** The left sidebar. Its links are also in the main part of some pages, so the sidebar's are named by where they are. */
const sidebar = (label: string, role: "link" | "button"): Matcher => ({ label, role, context: "Primary navigation" });

/** The dropdown above the file list, not the "Code" section of the sidebar. */
const CODE_DROPDOWN: Matcher = { label: "Code", role: "button", context: "main" };

const STRAIGHT_DIFF = "Include changes to target after source was created";

const guides: Guide[] = [
  {
    id: "find-file",
    start: PROJECT,
    goal: "I need to open gitlab.yml.example but I have no idea which folder it's in",
    steps: [
      // The search box in the top bar opens the same palette, where "Filters" offers the search by file name.
      { expect: [button("Find file"), button("Search or go to… /")], point: button("Find file"), act: { click: 'main button:has-text("Find file")' } },
      // Opened this way, the palette has "~" already typed, which is what makes it search file names.
      { expect: [{ label: "Type to search…", role: "searchbox" }], act: { fill: ["#search", "~gitlab.yml.example"] }, say: "Type the file's name here, after the ~." },
      { expect: [link("config/ gitlab.yml.example")], act: { click: '#super-sidebar-search-modal a[href$="/config/gitlab.yml.example"]' } },
      DONE,
    ],
    reached: { selector: '[data-testid="blame-button"]', text: "gitlab.yml.example" },
  },
  {
    id: "blame",
    start: `${PROJECT}/-/blob/master/LICENSE`,
    goal: "who last touched each line of this file, and when?",
    steps: [
      // The numbered "View blame for line N" links open the same view on its own page.
      { expect: [button("Blame"), link("View blame for line 1")], point: button("Blame"), act: { click: '[data-testid="blame-button"]' } },
      DONE,
    ],
    reached: { url: "blame=1", selector: '[data-testid="blame-button"][aria-pressed="true"]' },
  },
  {
    id: "zip-wrong-click",
    kind: "wrong-click",
    start: PROJECT,
    goal: "I just want the source as a zip, I don't want to clone anything",
    steps: [
      // The visitor is pointed at the Code dropdown and opens the sidebar's "Code" section, which has the same name.
      { expect: [CODE_DROPDOWN], act: { click: "#menu-section-button-code" } },
      { expect: [CODE_DROPDOWN], act: { click: '[data-testid="code-dropdown"] button' }, say: "Not that one. Click the Code button above the file list.", sayStartsWith: "Not that one." },
      // Recording stops here. Nothing is downloaded.
      { expect: [link("zip")] },
    ],
  },
  {
    id: "issues-sort",
    start: `${PROJECT}/-/work_items`,
    goal: "Sort this list so the issues nobody has touched for the longest come first",
    steps: [
      { expect: [button("Display")], act: { click: '[data-testid="display-settings-icon-button"]' } },
      // What to sort by and which way round are two controls, and either can come first.
      {
        expect: [{ label: "Sort by: Created date", role: "combobox" }, button("Sort direction: Descending")],
        point: { label: "Sort by: Created date", role: "combobox" },
        act: { click: '[data-testid="display-settings-sort"] button[role="combobox"]' },
      },
      {
        expect: [{ label: "Updated date", role: "option" }, button("Sort direction: Descending")],
        point: { label: "Updated date", role: "option" },
        act: { click: '[data-testid="display-settings-sort"] [role="option"]:has-text("Updated date")' },
      },
      { expect: [button("Sort direction: Descending")], act: { click: '[data-testid="display-settings-sort"] button:not([role="combobox"])' } },
      DONE,
    ],
    reached: { selector: '[data-testid="display-settings-sort"]:has(button[role="combobox"]:has-text("Updated date")):has(button[aria-label="Sort direction: Ascending"])' },
  },
  {
    id: "shortcuts",
    kind: "awkward",
    start: PROJECT,
    goal: "is ther a list of keybord shortcuts somwhere",
    steps: [
      { expect: [sidebar("Help", "button")], act: { click: '[data-testid="sidebar-help-button"]' } },
      { expect: [sidebar("Keyboard shortcuts", "button")], act: { click: '#super-sidebar button:has-text("Keyboard shortcuts")' } },
      DONE,
    ],
    reached: { text: "Toggle keyboard shortcuts help dialog" },
  },
  {
    id: "merged-mrs",
    kind: "awkward",
    start: `${PROJECT}/-/merge_requests`,
    goal: "Wo sehe ich die schon gemergten Merge Requests, und wie bekomme ich die zuletzt gemergten nach oben?",
    steps: [
      {
        expect: [{ label: "Merged 999+", role: "tab" }, { label: "Sort by: Created date", role: "combobox" }],
        point: { label: "Merged 999+", role: "tab" },
        act: { click: '[role="tab"]:has-text("Merged")' },
      },
      { expect: [{ label: "Sort by: Created date", role: "combobox" }], act: { click: 'main button[role="combobox"]:has-text("Created date")' } },
      { expect: [{ label: "Merged date", role: "option" }], act: { click: '[role="option"]:has-text("Merged date")' } },
      DONE,
    ],
    reached: { url: "state=merged", selector: 'main button[role="combobox"]:has-text("Merged date")' },
  },
  {
    id: "tag-pipeline",
    start: `${PROJECT}/-/tags?search=v17.0.0-ee`,
    goal: "Which job failed in the pipeline that ran for this tag?",
    steps: [
      // The pipeline is the status icon in the tag's row: a link with no words. The tag's own page has the same icon.
      {
        expect: [{ label: "", role: "link", href: `${PROJECT}/-/pipelines/:id`, context: "v17.0.0-ee" }, { label: "v17.0.0-ee", role: "link", href: `${PROJECT}/-/tags/:id` }],
        point: { label: "", role: "link", href: `${PROJECT}/-/pipelines/:id`, context: "v17.0.0-ee" },
        act: { click: 'a[data-testid="ci-icon"]' },
        say: "Click the pipeline status icon in the tag's row.",
      },
      { expect: [{ label: "Failed Jobs 1", role: "tab" }], act: { click: '[role="tab"]:has-text("Failed Jobs")' } },
      DONE,
    ],
    reached: { url: "/pipelines/1291418400/failures", text: "brakeman-sast" },
  },
  {
    id: "older-version",
    start: `${PROJECT}/-/blob/master/LICENSE`,
    goal: "How do I see this file as it was in the 17.0.0 release?",
    steps: [
      // The switcher is named after the branch it is on. Going by way of the tags list also gets there.
      { expect: [button("master"), sidebar("Tags", "link")], point: button("master"), act: { click: '.ref-selector button, [data-testid="ref-dropdown-container"] button' } },
      // An old tag is not among the forty revisions the list opens with, so it has to be searched for. The script ends on the search box.
      { expect: [{ label: "Search by Git revision", role: "combobox" }] },
    ],
  },
  {
    id: "label-issues",
    start: `${PROJECT}/-/labels`,
    goal: "Which issues carry the label Seeking community contributions? I can't find it in this endless list",
    steps: [
      // Filtering the work items list by label is the other way there.
      {
        expect: [{ label: "Search labels", role: "textbox" }, sidebar("Work items", "link"), sidebar("Plan", "button")],
        point: { label: "Search labels", role: "textbox" },
        act: { fill: ['input[aria-label="Search labels"], #label-search', "Seeking community contributions"] },
        say: "Type the label's name here.",
      },
      { expect: [button("Submit search")], act: { click: 'button[aria-label="Submit search"]' } },
      // Every row ends in the same two links, and the first row is the label that was searched for.
      {
        expect: [{ label: "Work items", role: "link", context: "Labels", nth: 1 }],
        act: { click: 'a[href*="label_name"][href*="Seeking+community+contributions"]:has-text("Work items")' },
      },
      DONE,
    ],
    reached: { selector: '.vue-filtered-search-bar-container:has-text("Seeking community contributions")' },
  },
  {
    id: "compare-flip",
    start: `${PROJECT}/-/compare?from=v17.0.0-ee&to=v17.0.1-ee`,
    goal: "I've got these two the wrong way round, and I want the complete diff between them, not just the commits that are new in the source",
    steps: [
      // Either can be done first. The radio button's words are a control of their own.
      {
        expect: [button("Swap"), { label: STRAIGHT_DIFF, role: "radio" }, { label: STRAIGHT_DIFF, role: "clickable" }],
        point: button("Swap"),
        act: { click: 'button[aria-label="Swap"], button[title="Swap"]' },
      },
      {
        expect: [{ label: STRAIGHT_DIFF, role: "radio" }, { label: STRAIGHT_DIFF, role: "clickable" }],
        point: { label: STRAIGHT_DIFF, role: "clickable" },
        act: { click: `label:has-text("${STRAIGHT_DIFF}") span` },
      },
      // Recording stops here: the diff of a whole release is a heavy page to ask the server for.
      { expect: [button("Compare")] },
    ],
  },
  // GitLab has nothing for calling people, so the right answer points at nothing.
  { id: "no-video-call", kind: "no-answer", start: PROJECT, goal: "How do I start a video call with the maintainers from here?", steps: [DONE] },
];

export default {
  siteId: "site_bench_gitlab",
  origin: "https://gitlab.com",
  hasTag: false,
  about: "GitLab.com, signed out, on the public project gitlab-org/gitlab (repository, work items, merge requests, pipelines, tags, labels): stands for the DevOps platforms large engineering organisations run.",
  heldOut: true,
  // GitLab's cookie banner (OneTrust), where it is shown. It was not shown where these were recorded, and
  // then each of the two is waited for and given up on, which also gives a page time to finish filling in:
  // the file list, the README and the lists of issues and merge requests arrive after the network goes quiet.
  dismiss: ["#onetrust-reject-all-handler", "#onetrust-accept-btn-handler"],
  guides,
} satisfies GuideSet;
