import { any, button, DONE, link, type Guide, type GuideSet } from "../guide.ts";

// Refine's public example admin, Finefoods, in its Material UI build: the back
// office of a food-delivery business (orders, customers, products, categories,
// stores, couriers). It opens signed in as a demo user, with no password. Its
// data comes from a demo API that other visitors use too, so it is not a
// sandbox: no guide here saves, deletes or exports, and a guide that leads to
// such a control stops on it. Guides are anchored on menus, columns and the
// seeded dishes, never on an order or a person, which change.
//
// Held out: Haptic's prompt and widget are never adjusted against it.

/** The count under the order list, "1–10 of 1201", once the rows have come. */
const COUNT = ".MuiDataGrid-root:has(.MuiDataGrid-row) .MuiTablePagination-displayedRows";

const guides: Guide[] = [
  // Two steps, ending on a control that is not pressed here.
  // Still fails: the Export on the Customers list.
  {
    id: "export-orders",
    start: "/",
    goal: "Our accountant wants every order in a spreadsheet. How do I get them out of here?",
    steps: [
      { expect: [link("Orders")], act: { click: 'nav a[href="/orders"]' } },
      { expect: [button("Export")], given: { url: "/orders(\\?|$)" } },
    ],
  },

  // A form in a drawer: the name and the required category. Stops before Save.
  // Still fails: Save with the name left empty, or with no category chosen.
  {
    id: "add-dessert",
    start: "/products",
    goal: "We're adding a new dessert called Lemon Tart to the menu. Where do I enter it?",
    steps: [
      { expect: [link("Add new product"), button("Add new product")], act: { click: 'a[href="/products/new"]' } },
      // The name and the category can be filled in either order.
      { expect: [any("Name"), any("Category")], act: { fill: ['.MuiDrawer-paper input[name="name"]', "Lemon Tart"] }, say: 'Type "Lemon Tart" as the name.' },
      { expect: [any("Category")], act: { click: ".MuiDrawer-paper .MuiAutocomplete-root input" }, say: "Open Category." },
      { expect: [{ label: "🍩 Deserts", role: "option" }], act: { click: '[role="option"]:has-text("Deserts")' } },
      {
        expect: [button("Save")],
        given: { url: "/products/new", typedInto: '.MuiDrawer-paper input[name="name"]', selector: '.MuiDrawer-paper .MuiAutocomplete-root input[value*="Deserts"]' },
      },
    ],
  },

  // A switch of two buttons. The visitor presses the one beside the one they were shown.
  // Still fails: the table, still showing.
  {
    id: "card-view-wrong-click",
    kind: "wrong-click",
    start: "/products",
    goal: "Can I see the dishes as picture cards instead of this table?",
    steps: [
      { expect: [button("card view")], act: { click: 'button[value="table"]' }, say: "Click the grid button above the table, on the right." },
      { expect: [button("card view")], act: { click: 'button[value="card"]' }, say: "Not that one. Click the grid button beside it.", sayStartsWith: "Not that one." },
      DONE,
    ],
    reached: { url: "/products", selector: 'button[value="card"][aria-pressed="true"]' },
  },

  // A page from the side menu, then its own switch.
  // Still fails: the stores' table; the dashboard's delivery map, which shows orders.
  {
    id: "stores-map",
    start: "/",
    goal: "Where can I see all our stores on a map?",
    steps: [
      { expect: [link("Stores")], act: { click: 'nav a[href="/stores"]' } },
      { expect: [button("map view")], act: { click: 'button[value="map"]' } },
      DONE,
    ],
    reached: { url: "/stores", selector: 'button[value="map"][aria-pressed="true"]' },
  },

  // A fact on another page: the order list's count, under the table.
  // Still fails: the dashboard's "Daily Orders", a number of orders that is not the total, or a hedge.
  {
    id: "orders-total",
    start: "/",
    goal: "How many orders have we taken in total so far?",
    steps: [{ expect: [link("Orders")], act: { click: 'nav a[href="/orders"]' } }, DONE],
    reached: { url: "/orders(\\?|$)", selector: COUNT },
    says: { shown: { selector: COUNT, part: "\\d+$", when: "start", from: "/orders" } },
  },

  // Asked with typos, and two things at once: the theme switch and the language list in the top bar, in either order.
  // Still fails: dark and still in English; German and still light.
  {
    id: "dark-and-german",
    kind: "awkward",
    start: "/",
    goal: "how do i make the screen dark?? and can the menus be in german pls",
    steps: [
      { expect: [button("Switch theme"), any("English")], act: { click: 'header button:has(svg[data-testid="Brightness4Icon"])' }, say: "Click the sun button at the top right." },
      { expect: [any("English")], act: { click: 'header [aria-label="Without label"]' }, say: "Open the language list, which says English." },
      { expect: [{ label: "German", role: "option" }], act: { click: '[role="option"][data-value="de"]' } },
      DONE,
    ],
    reached: { selector: 'header svg[data-testid="BrightnessHighIcon"]', text: "Bestellungen" },
  },

  // A fact in a table on another page, read from that page as the guide starts.
  // Still fails: another dish's price, no price, or a hedge.
  {
    id: "tiramisu-price",
    start: "/",
    goal: "How much do we charge for the tiramisu?",
    steps: [{ expect: [link("Products")], act: { click: 'nav a[href="/products"]' } }, DONE],
    reached: { url: "/products(\\?|$)", selector: '[role="row"]:has-text("Tiramisu") [data-field="price"]' },
    says: { shown: { selector: '[role="row"]:has-text("Tiramisu") [data-field="price"]', when: "start", from: "/products" } },
  },

  // A page from the side menu, then the button that opens a blank form.
  // Still fails: the couriers' list; the form for a new store or product.
  {
    id: "new-courier",
    start: "/",
    goal: "We've just hired a new delivery driver. How do I add them?",
    steps: [
      { expect: [link("Couriers")], act: { click: 'nav a[href="/couriers"]' } },
      { expect: [link("Add new courier"), button("Add new courier")], act: { click: 'a[href="/couriers/new"]' } },
      DONE,
    ],
    reached: { url: "/couriers/new" },
  },

  // Sorting a column, high to low: the column's own heading twice, or its menu.
  // Still fails: sorted low to high, or by another column.
  {
    id: "biggest-orders",
    start: "/orders",
    goal: "Can I have the biggest orders at the top of this list?",
    steps: [
      { expect: [any("Amount")], act: { click: '[role="columnheader"][data-field="amount"] .MuiDataGrid-columnHeaderTitleContainer' }, say: "Click the Amount heading." },
      { expect: [any("Amount")], act: { click: '[role="columnheader"][data-field="amount"] .MuiDataGrid-columnHeaderTitleContainer' }, say: "Click Amount again, to put the biggest first." },
      DONE,
    ],
    reached: { url: "sorters\\[0\\]\\[field\\]=amount&sorters\\[0\\]\\[order\\]=desc" },
  },

  // A row's edit button, then Delete in the drawer it opens. Delete is not pressed.
  // Still fails: Delete in another dish's drawer.
  {
    id: "delete-dish",
    kind: "risky",
    start: "/products",
    goal: "We've taken the onion rings off the menu for good. How do I delete them?",
    steps: [
      { expect: [{ label: "Edit", role: "button", context: "Onion Rings" }], act: { click: '[role="row"]:has-text("Onion Rings") button' }, say: "Click the pencil on the Onion Rings row." },
      { expect: [button("Delete")], given: { url: "/products/\\d+/edit", selector: '.MuiDrawer-paper input[name="name"][value="Onion Rings"]' } },
    ],
  },

  // The admin has no discounts, vouchers or promotions anywhere.
  { id: "no-discount-codes", kind: "no-answer", start: "/", goal: "How do I send all our customers a 10% discount code for next week?", steps: [DONE] },
];

export default {
  siteId: "site_bench_finefoods",
  origin: "https://example.mui.admin.refine.dev",
  hasTag: false,
  about: "Refine's Finefoods example admin, in its Material UI build: the back office of a food-delivery business (orders, customers, products, stores, couriers), standing for the internal admin dashboards companies build on a component library.",
  heldOut: true,
  guides,
} satisfies GuideSet;
