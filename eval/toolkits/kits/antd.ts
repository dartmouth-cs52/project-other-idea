import type { Kit } from "../types.ts";

// Ant Design, from ant.design. Every demo there has a page of its own, linked
// from the demo as "open in new tab": /~demos/<the demo's anchor>. The demo is
// all that page shows, in its root element; what a control opens is put at
// the end of the body, outside it.

const kit: Kit = {
  id: "antd",
  name: "Ant Design",
  origin: "https://ant.design",
  container: (page) => page.locator("#root"),
  demos: [
    { kind: "button", path: "/~demos/button-demo-basic", demo: "button-demo-basic", steps: [{ click: { role: "button", name: "Default Button" } }] },
    // The circle buttons in this demo show only an icon. The first sits in a tooltip that says what it does.
    { kind: "icon-button", path: "/~demos/button-demo-icon", demo: "button-demo-icon", steps: [{ click: { role: "button", name: "search", exact: true, nth: 1 } }] },
    { kind: "tooltip-icon-button", path: "/~demos/button-demo-icon", demo: "button-demo-icon", steps: [{ click: { role: "button", name: "search", exact: true } }] },
    { kind: "text-field", path: "/~demos/input-demo-basic", demo: "input-demo-basic", steps: [{ type: { role: "textbox", name: "Basic usage" }, text: "Hello" }] },
    { kind: "native-select", path: "/", demo: "", steps: [], skip: "Ant Design has no native select" },
    {
      kind: "select",
      path: "/~demos/select-demo-basic",
      demo: "select-demo-basic",
      overlay: true,
      steps: [{ click: { role: "combobox", nth: 0 } }, { click: { text: "Jack", where: "page" } }],
    },
    {
      kind: "combobox",
      path: "/~demos/auto-complete-demo-basic",
      demo: "auto-complete-demo-basic",
      overlay: true,
      // The demo offers what was typed, repeated: "ab" offers "ab", "abab" and "ababab".
      steps: [{ type: { role: "combobox", nth: 0 }, text: "ab" }, { click: { text: "abab", where: "page" } }],
    },
    {
      kind: "multi-select",
      path: "/~demos/select-demo-multiple",
      demo: "select-demo-multiple",
      overlay: true,
      steps: [
        { click: { role: "combobox", nth: 0 } },
        { click: { text: "b11", where: "page" } },
        { click: { text: "d13", where: "page" } },
      ],
    },
    { kind: "checkbox", path: "/~demos/checkbox-demo-basic", demo: "checkbox-demo-basic", steps: [{ click: { role: "checkbox", name: "Checkbox" } }] },
    { kind: "radio", path: "/~demos/radio-demo-radiogroup", demo: "radio-demo-radiogroup", steps: [{ click: { role: "radio", name: "dot-chart DotChart" } }] },
    { kind: "switch", path: "/~demos/switch-demo-basic", demo: "switch-demo-basic", steps: [{ click: { role: "switch", nth: 0 } }] },
    {
      kind: "menu",
      path: "/~demos/dropdown-demo-basic",
      demo: "dropdown-demo-basic",
      overlay: true,
      // The menu opens when the mouse is over "Hover me", which the page gives no role.
      steps: [{ hover: { text: "Hover me" } }, { click: { role: "menuitem", name: /2nd menu item/, where: "page" } }],
    },
    {
      kind: "nested-menu",
      path: "/~demos/dropdown-demo-sub-menu",
      demo: "dropdown-demo-sub-menu",
      overlay: true,
      steps: [
        { hover: { text: "Cascading menu" } },
        { hover: { role: "menuitem", name: /sub menu/, where: "page" } },
        { click: { role: "menuitem", name: /3rd menu item/, where: "page" } },
      ],
    },
    { kind: "tabs", path: "/~demos/tabs-demo-basic", demo: "tabs-demo-basic", steps: [{ click: { role: "tab", name: "Tab 2" } }] },
    { kind: "accordion", path: "/~demos/collapse-demo-accordion", demo: "collapse-demo-accordion", steps: [{ click: { role: "tab", name: "This is panel header 2" } }] },
    {
      kind: "dialog",
      path: "/~demos/modal-demo-basic",
      demo: "modal-demo-basic",
      overlay: true,
      steps: [{ click: { role: "button", name: "Open Modal" } }, { click: { role: "button", name: "Cancel", where: "page" } }],
    },
    {
      kind: "drawer",
      path: "/~demos/components-drawer-demo-basic-right",
      demo: "components-drawer-demo-basic-right",
      overlay: true,
      steps: [{ click: { role: "button", name: "Open" } }, { click: { role: "button", name: "Close", where: "page" } }],
    },
    {
      kind: "date-picker",
      path: "/~demos/date-picker-demo-basic",
      demo: "date-picker-demo-basic",
      overlay: true,
      // A day in the calendar has no role. Its words are its number.
      steps: [{ click: { role: "textbox", name: "Select date" } }, { click: { text: "15", exact: true, where: "page" } }],
    },
    {
      kind: "date-range-picker",
      path: "/~demos/date-picker-demo-range-picker",
      demo: "date-picker-demo-range-picker",
      overlay: true,
      steps: [
        { click: { role: "textbox", name: "Start date" } },
        { click: { text: "10", exact: true, where: "page" } },
        { click: { text: "14", exact: true, where: "page" } },
      ],
    },
    {
      kind: "table",
      path: "/~demos/table-demo-head",
      demo: "table-demo-head",
      overlay: true,
      steps: [
        { click: { role: "button", name: "filter", nth: 0 } },
        { click: { role: "menuitem", name: /Joe/, where: "page" } },
        { click: { role: "button", name: "OK", where: "page" } },
        { click: { role: "columnheader", name: "Age" } },
      ],
    },
    // Each row ends in actions that are links with no address, which the accessibility tree does not call links.
    { kind: "table", path: "/~demos/table-demo-basic", demo: "table-demo-basic", steps: [{ click: { text: "Invite Jim Green" } }] },
    {
      kind: "tree",
      path: "/~demos/tree-demo-basic",
      demo: "tree-demo-basic",
      // The arrow that folds a branch is an icon with no role of its own.
      steps: [{ click: { role: "img", name: "caret-down", nth: 2 } }, { click: { text: "leaf", exact: true, nth: 1 } }],
    },
    { kind: "slider", path: "/~demos/slider-demo-basic", demo: "slider-demo-basic", steps: [{ drag: { role: "slider", nth: 0 }, by: [80, 0] }] },
    { kind: "iframe", path: "/", demo: "", steps: [], skip: "Ant Design's documentation has no demo in an iframe" },
    { kind: "shadow-root", path: "/", demo: "", steps: [], skip: "Ant Design does not use shadow roots" },
  ],
};

export default kit;
