import type { Kit } from "../types.ts";

// Fluent UI React v9, from its Storybook. The documentation pages show each
// story inside an iframe, which the widget does not read, so each story is
// opened on its own page, as an app built with it would show it: the
// Storybook's iframe.html with the story's id. The demo here is that id.

const story = (id: string) => `/react/iframe.html?id=${id}&viewMode=story`;

const kit: Kit = {
  id: "fluent",
  name: "Fluent UI",
  origin: "https://storybooks.fluentui.dev",
  container: (page) => page.locator("#storybook-root"),
  demos: [
    { kind: "button", path: story("components-button-button--default"), demo: "components-button-button--default", steps: [{ click: { role: "button", name: "Example" } }] },
    { kind: "icon-button", path: story("components-button-button--icon"), demo: "components-button-button--icon", steps: [{ click: { role: "button", name: "With calendar icon only" } }] },
    // Buttons that show only an icon, named by the tooltip that shows on hover.
    { kind: "tooltip-icon-button", path: story("components-tooltip--relationship-label"), demo: "components-tooltip--relationship-label", steps: [{ click: { role: "button", name: "Italic" } }] },
    { kind: "text-field", path: story("components-input--default"), demo: "components-input--default", steps: [{ type: { role: "textbox", name: "Sample input" }, text: "Hello" }] },
    { kind: "native-select", path: story("components-select--default"), demo: "components-select--default", steps: [{ keys: { role: "combobox", name: "Color" }, press: ["ArrowDown", "Enter"] }] },
    {
      kind: "select",
      path: story("components-dropdown--default"),
      demo: "components-dropdown--default",
      overlay: true,
      steps: [{ click: { role: "combobox", name: "Best pet" } }, { click: { role: "option", name: "Dog", where: "page" } }],
    },
    {
      kind: "combobox",
      path: story("components-combobox--default"),
      demo: "components-combobox--default",
      overlay: true,
      steps: [{ type: { role: "combobox", name: "Best pet" }, text: "fe" }, { click: { role: "option", name: "Ferret", where: "page" } }],
    },
    {
      kind: "multi-select",
      path: story("components-combobox--multiselect"),
      demo: "components-combobox--multiselect",
      overlay: true,
      steps: [
        { click: { role: "button", name: "Open Best pets" } },
        { click: { role: "option", name: "Cat", where: "page" } },
        { click: { role: "option", name: "Fish", where: "page" } },
      ],
    },
    { kind: "checkbox", path: story("components-checkbox--default"), demo: "components-checkbox--default", steps: [{ click: { role: "checkbox", nth: 0 } }] },
    { kind: "radio", path: story("components-radiogroup--default"), demo: "components-radiogroup--default", steps: [{ click: { role: "radio", name: "Pear" } }] },
    { kind: "switch", path: story("components-switch--default"), demo: "components-switch--default", steps: [{ click: { role: "switch", name: "This is a switch" } }] },
    {
      kind: "menu",
      path: story("components-menu-menu--default"),
      demo: "components-menu-menu--default",
      overlay: true,
      steps: [{ click: { role: "button", name: "Toggle menu" } }, { click: { role: "menuitem", name: "New Window", where: "page" } }],
    },
    {
      kind: "nested-menu",
      path: story("components-menu-menu--nested-submenus"),
      demo: "components-menu-menu--nested-submenus",
      overlay: true,
      steps: [
        { click: { role: "button", name: "Toggle menu" } },
        { hover: { role: "menuitem", name: "Preferences", where: "page" } },
        { click: { role: "menuitem", name: "Theme", where: "page" } },
      ],
    },
    { kind: "tabs", path: story("components-tablist--default"), demo: "components-tablist--default", steps: [{ click: { role: "tab", name: "Second Tab" } }] },
    { kind: "accordion", path: story("components-accordion--default"), demo: "components-accordion--default", steps: [{ click: { role: "button", name: "Accordion Header 2" } }] },
    {
      kind: "dialog",
      path: story("components-dialog--default"),
      demo: "components-dialog--default",
      overlay: true,
      steps: [{ click: { role: "button", name: "Open dialog" } }, { click: { role: "button", name: "Close", where: "page" } }],
    },
    {
      kind: "drawer",
      path: story("components-drawer--default"),
      demo: "components-drawer--default",
      overlay: true,
      steps: [{ click: { role: "button", name: "Open" } }, { click: { role: "button", name: "Close", where: "page" } }],
    },
    {
      kind: "date-picker",
      path: story("compat-components-datepicker--default"),
      demo: "compat-components-datepicker--default",
      overlay: true,
      steps: [{ click: { role: "combobox", name: "Select a date" } }, { click: { role: "gridcell", name: /^15, /, where: "page" } }],
    },
    { kind: "date-range-picker", path: "/", demo: "", steps: [], skip: "Fluent UI v9 has no date-range picker" },
    {
      kind: "table",
      path: story("components-datagrid--sort"),
      demo: "components-datagrid--sort",
      steps: [{ click: { role: "button", name: "Author" } }, { click: { role: "button", name: "Last updated" } }],
    },
    {
      kind: "tree",
      path: story("components-tree--default"),
      demo: "components-tree--default",
      steps: [{ click: { role: "treeitem", name: "level 1, item 1" } }, { click: { role: "treeitem", name: "level 2, item 1" } }],
    },
    { kind: "slider", path: story("components-slider--default"), demo: "components-slider--default", steps: [{ drag: { role: "slider", name: "Basic Example" }, by: [80, 0] }] },
    {
      kind: "iframe",
      path: "/react/?path=/docs/components-button-button--docs",
      demo: "",
      steps: [],
      unreadable: "iframe",
    },
    { kind: "shadow-root", path: "/", demo: "", steps: [], skip: "Fluent UI React does not use shadow roots" },
  ],
};

export default kit;
