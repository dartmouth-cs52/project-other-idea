import type { Kit } from "../types.ts";

// IBM's Carbon, from its React Storybook. As with Fluent UI, the documentation
// shows each story inside an iframe, so each story is opened on its own page.

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story`;

const kit: Kit = {
  id: "carbon",
  name: "Carbon",
  origin: "https://react.carbondesignsystem.com",
  container: (page) => page.locator("#storybook-root"),
  demos: [
    { kind: "button", path: story("components-button--default"), demo: "components-button--default", steps: [{ click: { role: "button", name: "Button" } }] },
    { kind: "icon-button", path: story("components-overflowmenu--default"), demo: "components-overflowmenu--default", steps: [{ click: { role: "button", name: "Options" } }] },
    // An icon button whose only words are in the tooltip that shows on hover.
    { kind: "tooltip-icon-button", path: story("components-iconbutton--default"), demo: "components-iconbutton--default", steps: [{ click: { role: "button", name: "Custom label" } }] },
    { kind: "text-field", path: story("components-textinput--default"), demo: "components-textinput--default", steps: [{ type: { role: "textbox", name: "Label text" }, text: "Hello" }] },
    { kind: "native-select", path: story("components-select--default"), demo: "components-select--default", steps: [{ keys: { role: "combobox", name: "Deployment region" }, press: ["ArrowDown", "Enter"] }] },
    {
      kind: "select",
      path: story("components-dropdown--default"),
      demo: "components-dropdown--default",
      overlay: true,
      steps: [{ click: { role: "combobox", name: "Label" } }, { click: { role: "option", name: "Option 2", where: "page" } }],
    },
    {
      kind: "combobox",
      path: story("components-combobox--default"),
      demo: "components-combobox--default",
      overlay: true,
      steps: [{ type: { role: "combobox", name: "Label" }, text: "Option 2" }, { click: { role: "option", name: "Option 2", where: "page" } }],
    },
    {
      kind: "multi-select",
      path: story("components-multiselect--default"),
      demo: "components-multiselect--default",
      overlay: true,
      steps: [
        { click: { role: "combobox", name: "Label" } },
        { click: { role: "option", name: /^Option 1/, where: "page" } },
        { click: { role: "option", name: /^Option 2/, where: "page" } },
      ],
    },
    // Both boxes in this demo have the same label, as forms often do.
    { kind: "checkbox", path: story("components-checkbox--default"), demo: "components-checkbox--default", steps: [{ click: { role: "checkbox", name: "Checkbox label", nth: 1 } }] },
    { kind: "radio", path: story("components-radiobutton--default"), demo: "components-radiobutton--default", steps: [{ click: { role: "radio", name: "Radio button label", nth: 0 } }] },
    { kind: "switch", path: story("components-toggle--default"), demo: "components-toggle--default", steps: [{ click: { role: "switch", name: "Label" } }] },
    {
      kind: "menu",
      path: story("components-overflowmenu--default"),
      demo: "components-overflowmenu--default",
      overlay: true,
      steps: [{ click: { role: "button", name: "Options" } }, { click: { role: "menuitem", nth: 1, where: "page" } }],
    },
    {
      kind: "nested-menu",
      path: story("components-menubutton--with-nested-menu"),
      demo: "components-menubutton--with-nested-menu",
      overlay: true,
      steps: [
        { click: { role: "button", name: "Actions" } },
        { hover: { role: "menuitem", name: "Export as", where: "page" } },
        { click: { role: "menuitem", nth: 0, name: /^(PDF|JPG|PNG|CSV|XML|Word|Excel)/i, where: "page" } },
      ],
    },
    { kind: "tabs", path: story("components-tabs--default"), demo: "components-tabs--default", steps: [{ click: { role: "tab", name: "Monitoring" } }] },
    { kind: "accordion", path: story("components-accordion--default"), demo: "components-accordion--default", steps: [{ click: { role: "button", name: "Add team members" } }] },
    {
      kind: "dialog",
      path: story("components-modal--with-state-manager"),
      demo: "components-modal--with-state-manager",
      overlay: true,
      steps: [{ click: { role: "button", name: "Launch modal" } }, { click: { role: "button", name: "Close", where: "page" } }],
    },
    { kind: "drawer", path: "/", demo: "", steps: [], skip: "Carbon's React components have no drawer" },
    {
      kind: "date-picker",
      path: story("components-datepicker--single-with-calendar"),
      demo: "components-datepicker--single-with-calendar",
      overlay: true,
      steps: [{ click: { role: "textbox", nth: 0 } }, { click: { role: "button", name: /, \w+ 15, \d{4}$/, where: "page" } }],
    },
    {
      kind: "date-range-picker",
      path: story("components-datepicker--range-with-calendar"),
      demo: "components-datepicker--range-with-calendar",
      overlay: true,
      steps: [
        { click: { role: "textbox", nth: 0 } },
        { click: { role: "button", name: /, \w+ 10, \d{4}$/, where: "page" } },
        { click: { role: "button", name: /, \w+ 14, \d{4}$/, where: "page" } },
      ],
    },
    {
      kind: "table",
      path: story("components-datatable-sorting--default"),
      demo: "components-datatable-sorting--default",
      steps: [{ click: { role: "button", name: "Port" } }, { click: { role: "button", name: "Name" } }],
    },
    {
      kind: "table",
      path: story("components-datatable-batch-actions--default"),
      demo: "components-datatable-batch-actions--default",
      steps: [{ click: { role: "checkbox", name: "Select row", nth: 1 } }, { click: { role: "button", name: "Cancel" } }],
    },
    {
      kind: "tree",
      path: story("components-treeview--default"),
      demo: "components-treeview--default",
      steps: [{ click: { role: "treeitem", name: "Blockchain" } }, { click: { role: "treeitem", name: "Containers" } }],
    },
    { kind: "slider", path: story("components-slider--default"), demo: "components-slider--default", steps: [{ drag: { role: "slider", name: "Storage allocation" }, by: [80, 0] }] },
    { kind: "iframe", path: "/?path=/story/components-button--default", demo: "", steps: [], unreadable: "iframe" },
    { kind: "shadow-root", path: "/", demo: "", steps: [], skip: "Carbon's React components do not use shadow roots (its web components are a separate library, not covered here)" },
  ],
};

export default kit;
