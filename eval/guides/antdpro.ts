import { any, button, DONE, type Guide, type GuideSet } from "../guide.ts";
import type { Matcher } from "../cases.ts";

// Ant Design Pro's public preview (React 19, antd 6): an enterprise admin
// console with dashboards, a search table, forms, profile and account pages.
//
// Language. The app picks its language from the browser, and the recorder's
// browser reports en-US, so every guide runs in English with nothing stored
// between guides. In English the side menu, the page titles, the search table
// and the login page are translated. Most other pages (forms, profile, account
// settings, the avatar menu) are written in Chinese in the app's source and
// stay Chinese in every language. That is what a visitor gets, so the guides
// ask in English and match the controls as they are.
//
// Dropdowns. An antd Select is listed as its hidden <input role="combobox">.
// The widget treats that as a field, so a click on it is not counted, and a
// click on an option is either ignored (a plain <div>) or taken for a wrong
// click (role="option"): after pointing at a Select the widget does not ask
// for the next step. To record what comes after, the scripted visitor opens
// the Select with the keyboard (Enter), which the widget does notice. See the
// two guides that use `press`.
//
// Data. The rules table is made up afresh on every load (statuses and counts
// change, names do not), and nothing a visitor saves is kept. Guides anchor on
// rule names and row positions only.

const TABLE = "/list/table-list";

/** The avatar at the top right. Its menu holds the settings and sign-out. */
const AVATAR: Matcher = { label: "ProUser", role: "clickable" };
/** The checkbox at the start of a table row. They have no label, so only the position tells them apart. */
const rowBox = (row: number): Matcher => ({ label: "", role: "checkbox", nth: row });
/** A field of the basic form. The page marks these as required; the others say "（选填）", optional. */
const field = (label: string): Matcher => ({ label, role: "textbox", context: "form" });
const TITLE = field("标题");
const DATE_FROM = field("起止日期");
const DATE_TO = field("结束日期");
const GOAL = field("目标描述");
const MEASURE = field("衡量标准");

const guides: Guide[] = [
  // A nested side menu, then a tab far down a long page.
  {
    id: "operation-log",
    start: "/welcome",
    goal: "Where's the second operation log on the advanced profile page?",
    steps: [
      { expect: [{ label: "Profile", role: "menuitem" }], act: { click: '.ant-menu-submenu-title:has-text("Profile")' } },
      { expect: [any("Advanced Profile")], act: { click: 'a[href="/profile/advanced"]' } },
      { expect: [{ label: "操作日志二", role: "tab" }], act: { click: '[role="tab"]:has-text("操作日志二")' } },
      DONE,
    ],
    reached: { url: "/profile/advanced", selector: '[role="tab"][aria-selected="true"]:has-text("操作日志二")' },
  },

  // A dialog whose two fields have no label, only the same placeholder.
  {
    id: "new-rule",
    start: TABLE,
    goal: "I need to add a rule called Test rule to this table, with a line describing it",
    steps: [
      { expect: [button("New")], act: { click: 'button:has-text("New")' } },
      { expect: [{ label: "Please enter", role: "textbox" }], act: { fill: [".ant-modal #name", "Test rule"] }, say: "Type the rule's name in the first box." },
      { expect: [{ label: "Please enter", role: "textbox", nth: 2 }], act: { fill: [".ant-modal #desc", "Test description"] }, say: "Type a description in the second box." },
      { expect: [button("OK")], act: { click: '.ant-modal button:has-text("OK")' } },
      DONE,
    ],
    reached: { text: "Added successfully" },
  },

  // The same action on every row, a dialog in three steps, and a dropdown inside the dialog.
  // It ends on Finish, unpressed, once the dialog is TradeCode 97's, holds 规则模板二 and has the required
  // Starting Time. Finish only says "Configuration is successful", whichever template was chosen, so pressing
  // it would prove less than this: the dialog keeps each page's fields after it moves on, so they can be read.
  // A recording stops at the option: the widget does not send which option a Select shows, so when the visitor
  // has picked it themselves and asks again, nothing on its list says the template is already chosen.
  {
    id: "rule-template",
    start: TABLE,
    goal: "Rule TradeCode 97 is on the wrong template. How do I move it to 规则模板二?",
    steps: [
      // Both ways in are an <a> with a click handler and no href: Configuration at the end of the row, and
      // the rule's name, which opens a drawer that has Configuration too. The widget lists neither.
      {
        expect: [{ label: "Configuration", role: "link", context: "the TradeCode 97 row" }, { label: "TradeCode 97", role: "link" }],
        unlisted: true,
        act: { click: 'tr:has-text("TradeCode 97") >> text=Configuration' },
      },
      { expect: [button("Next")], act: { click: '.ant-modal button:has-text("Next")' } },
      { expect: [{ label: "Rule Template", role: "combobox" }], act: { press: ['.ant-modal [id="1_template"]', "Enter"] }, say: "Open Rule Template and choose 规则模板二." },
      // The list of options is drawn outside the dialog, and with a dialog open the widget lists only the dialog.
      { expect: [{ label: "规则模板二", role: "option" }], unlisted: true, act: { click: '.ant-select-dropdown .ant-select-item-option[title="规则模板二"]' } },
      { expect: [button("Next")], act: { click: '.ant-modal button:has-text("Next")' } },
      { expect: [any("Starting Time")], act: { fill: ['[id="2_time"]', "2026-12-01 09:00:00"] }, say: "Pick a starting time." },
      {
        expect: [button("Finish")],
        given: { selector: '.ant-modal:has([id="0_name"][value="TradeCode 97"]):has([title="规则模板二"]):has([id="2_time"][value]:not([value=""])) button:has-text("Finish")' },
      },
    ],
  },

  // Search: a field and the button beside it.
  {
    id: "find-rule",
    start: TABLE,
    goal: "I'm looking for the rule named TradeCode 57. Can I search for it?",
    steps: [
      { expect: [{ label: "Rule Name", role: "textbox" }], act: { fill: [".ant-pro-query-filter #name", "TradeCode 57"] }, say: "Type the rule's name." },
      { expect: [button("Query")], act: { click: '.ant-pro-query-filter button:has-text("Query")' } },
      DONE,
    ],
    reached: { text: "1-1 of 1 items" },
  },

  // Pagination: the page-size dropdown below the table, off screen when the question is asked.
  {
    id: "page-size",
    start: TABLE,
    goal: "can I see more rows at once? 50 on a page would be good",
    steps: [
      // A visitor looks down the page for it first. Scrolling is not a step: a widget that asks again because of it is counted.
      {
        expect: [{ label: "Page Size", role: "combobox" }],
        act: { press: ['.ant-pagination-options input[role="combobox"]', "Enter"] },
        scrollFirst: 400,
        say: "Open the page size list below the table and choose 50 / page.",
      },
      { expect: [{ label: "50 / page", role: "option" }], act: { click: '.ant-pagination-options .ant-select-item-option[title="50 / page"]' } },
      DONE,
    ],
    reached: { text: "1-50 of 100 items" },
  },

  // A form with several fields and a date range, all labelled in Chinese. Any required field still empty is
  // right. It stops at Submit: the preview has no backend for this form, and Submit answers "Response status:404".
  {
    id: "basic-form",
    start: "/form/basic-form",
    goal: "What do I have to fill in on this form before I can submit it?",
    steps: [
      { expect: [TITLE, DATE_FROM, DATE_TO, GOAL, MEASURE], act: { fill: ["#basic_title", "Test goal"] }, say: "Type a title." },
      { expect: [DATE_FROM, DATE_TO, GOAL, MEASURE], act: { fill: ["#basic_date", "2026-12-01"] }, say: "Type or pick the start date." },
      { expect: [DATE_TO, GOAL, MEASURE], act: { fill: ['input[date-range="end"]', "2026-12-31"] }, say: "Type or pick the end date." },
      { expect: [GOAL, MEASURE], act: { fill: ["#basic_goal", "Test description"] }, say: "Describe the goal." },
      { expect: [MEASURE], act: { fill: ["#basic_standard", "Test standard"] }, say: "Say how it will be measured." },
      { expect: [button("Submit")] },
    ],
    // The question asks which fields must be filled in. The page marks each required field's label, so a sentence that
    // names every one of them answers it, wherever the visitor is. The labels are read from the page when the guide
    // starts, in the words the page uses: an answer that gives the fields only in translation does not pass.
    says: { shown: { selector: ".ant-form-item-required", when: "start" } },
  },

  // Settings two levels down, then three switches that all read "开 关".
  {
    id: "notifications",
    kind: "awkward",
    start: "/account/center",
    goal: "how do i stop geting notifcations about todo tasks??",
    steps: [
      { expect: [any("Account Settings"), AVATAR], act: { click: 'a[href="/account/settings"]' } },
      { expect: [{ label: "新消息通知", role: "menuitem" }], act: { click: '.ant-menu-item:has-text("新消息通知")' } },
      { expect: [{ label: "开 关", role: "switch", nth: 3 }], act: { click: '.ant-list-item:nth-child(3) button[role="switch"]' }, say: "Turn off the third switch, the one for to-do tasks." },
      DONE,
    ],
    reached: { url: "/account/settings", selector: '.ant-list-item:nth-child(3) button[role="switch"][aria-checked="false"]' },
  },

  // Asked in Spanish. The switcher is an icon whose only name is Chinese.
  {
    id: "language-es",
    kind: "awkward",
    start: "/dashboard/workplace",
    goal: "¿Cómo cambio el idioma? Lo quiero en portugués.",
    steps: [
      { expect: [{ label: "语言切换", role: "button", icon: "global" }], act: { click: '[aria-label="语言切换"]' }, say: "Click the globe at the top right." },
      { expect: [{ label: "🇧🇷 Português", role: "menuitem" }], act: { click: '.ant-dropdown-menu-item:has-text("Português")' } },
      DONE,
    ],
    reached: { text: "Formulário" },
  },

  // The visitor is pointed at the avatar and clicks the globe beside it.
  {
    id: "sign-out-wrong-click",
    kind: "wrong-click",
    start: "/list/card-list",
    goal: "log me out",
    steps: [
      { expect: [AVATAR], act: { click: '[aria-label="语言切换"]' }, say: "Click ProUser at the top right." },
      { expect: [AVATAR], act: { click: "text=ProUser" }, say: "Not that one. Click ProUser, to the right of the globe.", sayStartsWith: "Not that one." },
      { expect: [{ label: "退出登录", role: "menuitem" }], act: { click: '.ant-dropdown-menu-item:has-text("退出登录")' } },
      DONE,
    ],
    reached: { url: "/user/login" },
  },

  // Batch selection, then the button that deletes. It is pointed at and never clicked.
  {
    id: "batch-delete",
    kind: "risky",
    start: TABLE,
    goal: "I want to get rid of the rules TradeCode 97 and TradeCode 96",
    steps: [
      { expect: [rowBox(3), rowBox(4)], act: { click: 'tr:has-text("TradeCode 97") .ant-checkbox-input' }, say: "Tick the box at the start of the TradeCode 97 row." },
      { expect: [rowBox(4)], act: { click: 'tr:has-text("TradeCode 96") .ant-checkbox-input' }, say: "Tick the box at the start of the TradeCode 96 row." },
      { expect: [button("batch deletion")] },
    ],
  },

  // The table has reload, density and column settings, and no export.
  { id: "export-excel", kind: "no-answer", start: TABLE, goal: "How do I export this table to Excel?", steps: [DONE] },
];

export default {
  siteId: "site_bench_antdpro",
  origin: "https://preview.pro.ant.design",
  hasTag: false,
  about: "Ant Design Pro's public preview: a React and Ant Design admin console (dashboards, search table, forms, profile, account settings), standing for the internal consoles large companies build on a component library.",
  sandbox: true,
  guides,
} satisfies GuideSet;
