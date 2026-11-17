import type { Kit } from "../types.ts";

// Material UI, from mui.com. Each demo on a page follows an empty element whose
// id is the demo's name, like "BasicSelect": that name is the demo here.

const kit: Kit = {
  id: "mui",
  name: "MUI",
  origin: "https://mui.com",
  container: (page, demo) => page.locator(`[id="${demo}"] + div`),
  // Every demo starts with a button the documentation site uses to test keyboard focus.
  chrome: [{ role: "button", name: /programmatically focused to test keyboard navigation/ }],
  // The cookie notice is a dialog that the widget can take for an open modal (see the report), so it is answered first, as a visitor would.
  dismiss: [{ role: "button", name: "Essential only" }],
  demos: [
    { kind: "button", path: "/material-ui/react-button/", demo: "BasicButtons", steps: [{ click: { role: "button", name: "Contained" } }] },
    { kind: "icon-button", path: "/material-ui/react-button/", demo: "IconButtons", steps: [{ click: { role: "button", name: "add an alarm" } }] },
    { kind: "tooltip-icon-button", path: "/material-ui/react-tooltip/", demo: "BasicTooltip", steps: [{ click: { role: "button", name: "Delete" } }] },
    { kind: "text-field", path: "/material-ui/react-text-field/", demo: "BasicTextFields", steps: [{ type: { role: "textbox", name: "Outlined" }, text: "Hello" }] },
    {
      kind: "native-select",
      path: "/material-ui/react-select/",
      demo: "NativeSelectDemo",
      steps: [{ keys: { role: "combobox", name: "Age" }, press: ["ArrowDown", "Enter"] }],
    },
    {
      kind: "select",
      path: "/material-ui/react-select/",
      demo: "BasicSelect",
      overlay: true,
      steps: [{ click: { role: "combobox", name: "Age" } }, { click: { role: "option", name: "Twenty", where: "page" } }],
    },
    {
      kind: "combobox",
      path: "/material-ui/react-autocomplete/",
      demo: "ComboBox",
      overlay: true,
      steps: [{ type: { role: "combobox", name: "Movie" }, text: "godf" }, { click: { role: "option", name: "The Godfather", exact: true, where: "page" } }],
    },
    {
      kind: "multi-select",
      path: "/material-ui/react-select/",
      demo: "MultipleSelectChip",
      overlay: true,
      steps: [
        { click: { role: "combobox", name: "Chip" } },
        { click: { role: "option", name: "Van Henry", where: "page" } },
        { click: { role: "option", name: "April Tucker", where: "page" } },
      ],
    },
    { kind: "checkbox", path: "/material-ui/react-checkbox/", demo: "CheckboxLabels", steps: [{ click: { role: "checkbox", name: "Required" } }] },
    { kind: "radio", path: "/material-ui/react-radio-button/", demo: "RadioButtonsGroup", steps: [{ click: { role: "radio", name: "Male" } }] },
    { kind: "switch", path: "/material-ui/react-switch/", demo: "SwitchLabels", steps: [{ click: { role: "switch", name: "Required" } }] },
    {
      kind: "menu",
      path: "/material-ui/react-menu/",
      demo: "BasicMenu",
      overlay: true,
      steps: [{ click: { role: "button", name: "Dashboard" } }, { click: { role: "menuitem", name: "My account", where: "page" } }],
    },
    { kind: "nested-menu", path: "/material-ui/react-menu/", demo: "", steps: [], skip: "MUI's documentation has no nested menu" },
    { kind: "tabs", path: "/material-ui/react-tabs/", demo: "BasicTabs", steps: [{ click: { role: "tab", name: "Item Two" } }] },
    { kind: "accordion", path: "/material-ui/react-accordion/", demo: "AccordionUsage", steps: [{ click: { role: "button", name: "Accordion 1" } }] },
    {
      kind: "dialog",
      path: "/material-ui/react-dialog/",
      demo: "AlertDialog",
      overlay: true,
      steps: [{ click: { role: "button", name: "Open alert dialog" } }, { click: { role: "button", name: "Disagree", where: "page" } }],
    },
    {
      kind: "drawer",
      path: "/material-ui/react-drawer/",
      demo: "TemporaryDrawer",
      overlay: true,
      steps: [{ click: { role: "button", name: "Open drawer" } }, { click: { role: "button", name: "Starred", where: "page" } }],
    },
    {
      kind: "date-picker",
      path: "/x/react-date-pickers/date-picker/",
      demo: "BasicDatePicker",
      overlay: true,
      steps: [{ click: { role: "button", name: "Choose date" } }, { click: { role: "gridcell", name: "15", exact: true, where: "page" } }],
    },
    {
      kind: "date-range-picker",
      path: "/x/react-date-pickers/date-range-picker/",
      demo: "BasicDateRangePicker",
      overlay: true,
      steps: [
        { click: { role: "button", name: "Choose range" } },
        { click: { role: "gridcell", name: "10", exact: true, where: "page" } },
        { click: { role: "gridcell", name: "14", exact: true, where: "page" } },
      ],
    },
    {
      kind: "table",
      path: "/material-ui/react-table/",
      demo: "EnhancedTable",
      steps: [
        { click: { role: "button", name: "Fat (g)" } },
        { click: { role: "checkbox", nth: 1 } },
        { click: { role: "button", name: "Go to next page" } },
      ],
    },
    {
      kind: "table",
      path: "/x/react-data-grid/column-definition/",
      demo: "ActionsWithModalGrid",
      overlay: true,
      steps: [{ click: { role: "button", name: "more", nth: 1 } }, { click: { role: "menuitem", nth: 0, where: "page" } }],
    },
    {
      kind: "tree",
      path: "/x/react-tree-view/simple-tree-view/items/",
      demo: "BasicSimpleTreeView",
      steps: [{ click: { role: "treeitem", name: "Data Grid" } }, { click: { role: "treeitem", name: "@mui/x-data-grid-pro" } }],
    },
    { kind: "slider", path: "/material-ui/react-slider/", demo: "ContinuousSlider", steps: [{ drag: { role: "slider", name: "Volume" }, by: [60, 0] }] },
    { kind: "iframe", path: "/material-ui/react-drawer/", demo: "ResponsiveDrawer", steps: [], unreadable: "iframe" },
    { kind: "iframe", path: "/material-ui/react-drawer/", demo: "PersistentDrawerLeft", steps: [], unreadable: "iframe" },
    { kind: "iframe", path: "/material-ui/react-dialog/", demo: "CookiesBanner", steps: [], unreadable: "iframe" },
    { kind: "shadow-root", path: "/", demo: "", steps: [], skip: "MUI does not use shadow roots" },
  ],
};

export default kit;
