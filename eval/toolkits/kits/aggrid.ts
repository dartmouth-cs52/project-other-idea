import type { Kit } from "../types.ts";

// AG Grid, from its public showcase: one large grid of made-up players with
// sorting, filters and row selection. Every demo is a part of that one grid.

const kit: Kit = {
  id: "aggrid",
  name: "AG Grid",
  origin: "https://www.ag-grid.com",
  container: (page) => page.getByRole("grid"),
  demos: [
    {
      kind: "table",
      path: "/example/",
      demo: "sort",
      steps: [{ click: { role: "columnheader", name: "Name" } }, { click: { role: "columnheader", name: "Country" } }],
    },
    // Every row's tick box has the same name in the accessibility tree too.
    { kind: "checkbox", path: "/example/", demo: "row selection", steps: [{ click: { role: "checkbox", name: /toggle row selection/, nth: 1 } }] },
    { kind: "text-field", path: "/example/", demo: "filter field", steps: [{ type: { role: "spinbutton", name: "Bank Balance Filter Input" }, text: "5000" }] },
    {
      kind: "menu",
      path: "/example/",
      demo: "filter menu",
      overlay: true,
      // The third column's filter: a list of tick boxes, one for each language.
      steps: [{ click: { role: "button", name: "Open Filter Menu", nth: 1 } }, { click: { role: "checkbox", name: /^English/, where: "page" } }],
    },
  ],
};

export default kit;
