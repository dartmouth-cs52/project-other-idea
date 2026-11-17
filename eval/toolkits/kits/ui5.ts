import type { Kit } from "../types.ts";

// SAP's UI5 Web Components. Every component draws itself inside an open
// shadow root, and what it opens is shown inside that root too.
//
// The samples on the documentation pages run inside an iframe served by a
// service worker, which the widget cannot read and which cannot be opened on
// its own. UI5 publishes its test pages on the same site, with the components
// at the top of the page, so those are used: the demo is the id of one
// component on the test page.

const page = (name: string) => `/webcomponents/packages/main/test/pages/${name}.html`;

const kit: Kit = {
  id: "ui5",
  name: "UI5 Web Components",
  origin: "https://ui5.github.io",
  container: (p, demo) => p.locator(`[id="${demo}"]`),
  demos: [
    { kind: "button", path: page("Button"), demo: "button1", steps: [{ click: { role: "button", nth: 0 } }] },
    { kind: "icon-button", path: page("Button"), demo: "icon-only-comment", steps: [{ click: { role: "button", nth: 0 } }] },
    { kind: "tooltip-icon-button", path: page("Button"), demo: "icon-only-blank-text", steps: [{ click: { role: "button", nth: 0 } }] },
    { kind: "text-field", path: page("Input"), demo: "myInput", steps: [{ type: { role: "textbox", nth: 0 }, text: "Hello" }] },
    { kind: "native-select", path: "/", demo: "", steps: [], skip: "UI5 Web Components have no native select" },
    {
      kind: "select",
      path: page("Select"),
      demo: "mySelect",
      overlay: true,
      steps: [{ click: { role: "combobox", nth: 0 } }, { click: { role: "option", nth: 1, where: "page" } }],
    },
    {
      kind: "combobox",
      path: page("ComboBox"),
      demo: "combo",
      overlay: true,
      steps: [{ type: { role: "combobox", nth: 0 }, text: "Ar" }, { click: { role: "option", nth: 0, where: "page" } }],
    },
    {
      kind: "multi-select",
      path: page("MultiComboBox"),
      demo: "multi1",
      overlay: true,
      steps: [
        { click: { role: "button", nth: 0 } },
        { click: { role: "option", nth: 0, where: "page" } },
        { click: { role: "option", nth: 1, where: "page" } },
      ],
    },
    { kind: "checkbox", path: page("CheckBox"), demo: "cb1", steps: [{ click: { role: "checkbox", nth: 0 } }] },
    { kind: "radio", path: page("RadioButton"), demo: "testRbtn1", steps: [{ click: { role: "radio", nth: 0 } }] },
    { kind: "switch", path: page("Switch"), demo: "sw", steps: [{ click: { role: "switch", nth: 0 } }] },
    {
      kind: "menu",
      path: page("Menu"),
      demo: "btnOpen",
      overlay: true,
      steps: [{ click: { role: "button", nth: 0 } }, { click: { role: "menuitem", nth: 0, where: "page" } }],
    },
    { kind: "tabs", path: page("TabContainer"), demo: "tabContainer1", steps: [{ click: { role: "tab", nth: 1 } }] },
    { kind: "accordion", path: page("Panel"), demo: "panel-expandable", steps: [{ click: { role: "button", nth: 0 } }] },
    {
      kind: "dialog",
      path: page("Dialog"),
      demo: "btnOpenDialog",
      overlay: true,
      steps: [{ click: { role: "button", nth: 0 } }, { click: { role: "button", name: /close|cancel|ok/i, where: "page" } }],
    },
    { kind: "drawer", path: "/", demo: "", steps: [], skip: "UI5 Web Components have no drawer in their main package" },
    {
      kind: "date-picker",
      path: page("DatePicker"),
      demo: "dp5",
      overlay: true,
      // The calendar's button is hidden from the accessibility tree, so the visitor opens it the keyboard's way.
      steps: [{ keys: { role: "textbox", nth: 0 }, press: ["F4"] }, { click: { role: "gridcell", name: /\b15\b/, where: "page" } }],
    },
    {
      kind: "date-range-picker",
      path: page("DateRangePicker"),
      demo: "daterange-picker1",
      overlay: true,
      steps: [
        { keys: { role: "textbox", nth: 0 }, press: ["F4"] },
        { click: { role: "gridcell", name: /\b10\b/, where: "page" } },
        { click: { role: "gridcell", name: /\b14\b/, where: "page" } },
      ],
    },
    { kind: "table", path: "/", demo: "", steps: [], skip: "The table is in a separate UI5 package whose test pages were not used" },
    { kind: "tree", path: page("Tree"), demo: "tree", steps: [{ click: { role: "treeitem", nth: 0 } }, { click: { role: "treeitem", nth: 1 } }] },
    { kind: "slider", path: page("Slider"), demo: "basic-slider", steps: [{ drag: { role: "slider", nth: 0 }, by: [80, 0] }] },
    { kind: "iframe", path: "/webcomponents/components/Button/", demo: "", steps: [], unreadable: "iframe" },
    // Every control in this toolkit is in a shadow root. This one opens a list inside its own.
    {
      kind: "shadow-root",
      path: page("Select"),
      demo: "errorSelect",
      overlay: true,
      steps: [{ click: { role: "combobox", nth: 0 } }, { click: { role: "option", nth: 1, where: "page" } }],
    },
  ],
};

export default kit;
