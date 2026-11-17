import type { Kit } from "../types.ts";

// AG Grid, from its public showcase: one large grid of made-up players with
// sorting, filters and row selection. Every demo is a part of that one grid.
//
// The site draws nothing until the browser has passed a bot check that posts a
// token to AWS. This suite lets no request but GET leave the browser, so the
// page stays blank and every demo is reported as not tested, with this reason.
// The demos are kept so that they run if the site ever shows the grid without it.
const BLOCKED = "the site shows nothing until the browser posts a bot-check token to AWS WAF, and this suite sends nothing but GET requests";

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
      skip: BLOCKED,
      steps: [{ click: { role: "columnheader", name: "Name" } }, { click: { role: "columnheader", name: "Country" } }],
    },
    // Every row's tick box has the same name in the accessibility tree too.
    { kind: "checkbox", path: "/example/", demo: "row selection", skip: BLOCKED, steps: [{ click: { role: "checkbox", name: /toggle row selection/, nth: 1 } }] },
    { kind: "text-field", path: "/example/", demo: "filter field", skip: BLOCKED, steps: [{ type: { role: "spinbutton", name: "Bank Balance Filter Input" }, text: "5000" }] },
    {
      kind: "menu",
      path: "/example/",
      demo: "filter menu",
      skip: BLOCKED,
      overlay: true,
      // The third column's filter: a list of tick boxes, one for each language.
      steps: [{ click: { role: "button", name: "Open Filter Menu", nth: 1 } }, { click: { role: "checkbox", name: /^English/, where: "page" } }],
    },
  ],
};

export default kit;
