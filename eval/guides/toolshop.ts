import type { Matcher } from "../cases.ts";
import { button, DONE, link, type Guide, type GuideSet } from "../guide.ts";

// Practice Software Testing's Toolshop (https://practicesoftwaretesting.com): an Angular demo
// store that exists to be driven by test automation. Its database is reset on a schedule, and
// product, invoice and cart ids change with every reset, so nothing here leans on an id: guides
// start on fixed paths and pick products by name.
//
// Every guide runs as one of the project's published test customers with one pair of pliers in the
// basket (see `before`), because most of what a shopper asks about needs a basket or an account.
//
// Five steps are marked `unlisted`. Two are markup: the control has no href, role or pointer
// cursor, so the widget never lists it. Three are timing: the shop fetches its data after the
// click (a preflight and then the request, about 0.8 s from where this was recorded) and shows
// no sign of loading, while the widget reads the page about 0.35 s after the click. It then
// sees the page before the click's result is on it. Recorded on a faster line, those three
// may be listed, and the recorder will say so. After any unlisted step the recorder asks again
// about 1.4 s after the click, so a guide goes on from there only where the next page is
// reliably drawn by then (a product page is, at about 0.9 s) and otherwise ends.

const checkbox = (label: string): Matcher => ({ label, role: "checkbox" });
const textbox = (label: string): Matcher => ({ label, role: "textbox" });
const select = (label: string): Matcher => ({ label, role: "select" });

// The header wraps each entry in <li role="menuitem">, so the widget lists the wrapper and the
// button inside it. The wrapper's label runs on into the words of its closed dropdown. Both sit
// in the same spot and a click on either opens the menu, so both are right.
const CATEGORIES: Matcher[] = [{ label: "Categories Hand Tools Power Tools Other Special Tools Rentals", role: "menuitem" }, button("Categories")];
const ACCOUNT_MENU: Matcher[] = [{ label: "Jane Doe My account My favorites My profile My invoices My messages Sign out", role: "menuitem" }, button("Jane Doe")];
// The basket in the header is an icon with a count: the wrapper is listed as "1", the link inside by its aria-label.
const BASKET: Matcher[] = [{ label: "1", role: "menuitem", icon: "cart-shopping" }, { label: "cart", role: "link", icon: "cart-shopping" }];

const PROCEED = button("Proceed to checkout");

const guides: Guide[] = [
  // Filters and the sort box in the sidebar. The three can be set in any order.
  {
    id: "filter-hammers",
    start: "/",
    goal: "I only want to see the hammers made by ForgeFlex, with the cheapest one first",
    steps: [
      { expect: [select("sort"), checkbox("Hammer"), checkbox("ForgeFlex Tools")], act: { select: ['[data-test="sort"]', "Price (Low - High)"] }, say: "Open this list and pick Price (Low - High)." },
      { expect: [checkbox("Hammer"), checkbox("ForgeFlex Tools")], act: { check: '#filters label:has-text("Hammer") input' }, say: "Tick Hammer." },
      { expect: [checkbox("ForgeFlex Tools")], act: { check: '#filters label:has-text("ForgeFlex Tools") input' }, say: "Tick ForgeFlex Tools." },
      DONE,
    ],
    reached: { selector: 'app-overview:has(label:has-text("ForgeFlex Tools") input:checked):has(label:has-text("Hammer") input:checked) a.card >> nth=0 >> text=Thor Hammer' },
  },
  // Search, asked with typos. The result arrives about a second after the click on Search and the
  // page shows no sign of loading, so the widget reads the list while it still holds the old products.
  {
    id: "find-goggles",
    kind: "awkward",
    start: "/",
    goal: "do u sell safty gogles?? cant find them anywere",
    steps: [
      { expect: [textbox("Search"), checkbox("Safety Gear")], act: { fill: ['[data-test="search-query"]', "goggles"] }, say: "Type goggles here." },
      { expect: [button("Search")], act: { click: '[data-test="search-submit"]' } },
      { expect: [link("ECO Safety Goggles A B C D E $24.26")], unlisted: true, act: { click: 'a.card:has-text("Safety Goggles")' } },
      DONE,
    ],
    reached: { url: "/product/[0-9A-Za-z]+$", text: "Safety Goggles" },
  },
  // Asked from a category page, where the product's card is the only way to it. The product page
  // is drawn only once its data has arrived, which is after the widget has looked.
  {
    id: "buy-circular-saw",
    start: "/category/power-tools",
    goal: "I'd like to order the circular saw",
    steps: [
      { expect: [link("Circular Saw A B C D E $80.19")], act: { click: 'a.card:has-text("Circular Saw")' } },
      { expect: [button("Add to cart")], unlisted: true, act: { click: "#btn-add-to-cart" } },
    ],
  },
  // Rentals sit at the bottom of the Categories menu. Each rental is a <div tabindex="0"> with a
  // click handler, no role and no pointer cursor, so the widget has nothing to list for it.
  // The hours are set by dragging a slider whose only name is the slider library's own.
  {
    id: "rent-excavator",
    start: "/",
    goal: "I need to hire an excavator for three hours. How do I book that?",
    steps: [
      { expect: [...CATEGORIES, textbox("Search")], act: { click: '[data-test="nav-categories"]' }, say: "Click Categories." },
      { expect: [link("Rentals"), textbox("Search")], act: { click: '[data-test="nav-rentals"]' } },
      { expect: [{ label: "Excavator" }], unlisted: true, act: { click: '[data-test^="product-"]:has-text("Excavator")' } },
      // Stops here: a visitor drags the handle, which a script of clicks and typing cannot do.
      { expect: [{ label: "ngx-slider", role: "slider" }], say: "Drag this handle to 3 hours." },
    ],
  },
  // The button that removes a line is <a class="btn btn-danger"> around an icon: no href, no role, no label.
  {
    id: "remove-from-basket",
    start: "/",
    goal: "How do I take the pliers back out of my basket?",
    steps: [
      { expect: BASKET, act: { click: '[data-test="nav-cart"]' }, say: "Click the basket icon at the top." },
      { expect: [{ label: "", icon: "xmark" }], unlisted: true, act: { click: "app-cart a.btn-danger" } },
    ],
  },
  // The whole checkout, from the basket to an order placed with one of the made-up payment methods.
  // The address step shows the street and city from the profile; country looks empty and the rest is.
  {
    id: "pay-in-instalments",
    start: "/checkout",
    goal: "Can I spread the cost of what's in my basket over a few months? How do I do that?",
    steps: [
      { expect: [PROCEED], act: { click: '[data-test="proceed-1"]' } },
      { expect: [PROCEED], act: { click: '[data-test="proceed-2"]' } },
      { expect: [select("Country"), textbox("Postal code"), textbox("House number"), textbox("State")], act: { select: ['[data-test="country"]', "Austria"] }, say: "Pick your country." },
      { expect: [textbox("Postal code"), textbox("House number"), textbox("State")], act: { fill: ["#postal_code", "1010"] }, say: "Type your postal code." },
      { expect: [textbox("House number"), textbox("State")], act: { fill: ["#house_number", "7"] }, say: "Type your house number." },
      // The shop looks the address up and fills in the state itself, which is what unlocks the button.
      { expect: [PROCEED], act: { click: '[data-test="proceed-3"]' } },
      { expect: [select("Payment Method")], act: { select: ['[data-test="payment-method"]', "Buy Now Pay Later"] }, say: "Open this list and pick Buy Now Pay Later." },
      { expect: [select("Monthly Installments")], act: { select: ["#monthly_installments", "3 Monthly Installments"] }, say: "Pick how many months." },
      { expect: [button("Check payment")], act: { click: '[data-test="finish"]' } },
      // The same button turns into Confirm once the payment check has come back, after the widget has looked.
      { expect: [button("Confirm")], unlisted: true, act: { click: 'button[data-test="finish"]:has-text("Confirm")' } },
    ],
  },
  // Leads up to Send and stops: the message is never sent.
  {
    id: "report-double-charge",
    kind: "risky",
    start: "/contact",
    goal: "I think I was charged twice for my last order. How do I let you know?",
    steps: [
      { expect: [select("Subject"), textbox("Message *"), button("Open chat")], act: { select: ['[data-test="subject"]', "Payments"] }, say: "Open this list and pick Payments." },
      { expect: [textbox("Message *")], act: { fill: ['[data-test="message"]', "Test message, please ignore: I believe one order was charged to me twice."] }, say: "Describe what happened." },
      { expect: [button("Send")] },
    ],
  },
  // The visitor is pointed at the account menu and opens the menu beside it.
  {
    id: "phone-wrong-click",
    kind: "wrong-click",
    start: "/account",
    goal: "I've got a new mobile number. Where do I update it?",
    steps: [
      { expect: [...ACCOUNT_MENU, link("Profile")], act: { click: '[data-test="nav-categories"]' }, say: "Click Jane Doe at the top." },
      { expect: [...ACCOUNT_MENU, link("Profile")], act: { click: '[data-test="nav-menu"]' }, say: "Not that one. Click Jane Doe.", sayStartsWith: "Not that one." },
      { expect: [link("My profile"), link("Profile")], act: { click: '[data-test="nav-my-profile"]' } },
      { expect: [textbox("Phone")], act: { fill: ['[data-test="phone"]', "555 0100"] }, say: "Type your new number." },
      // The account is shared with everyone who practises on this site, so its profile is left as it was.
      { expect: [button("Update Profile")] },
    ],
  },
  // Asked in German. The languages are listed by code only.
  {
    id: "sprache-deutsch",
    kind: "awkward",
    start: "/",
    goal: "Kann ich mir den Shop auch auf Deutsch anzeigen lassen?",
    steps: [
      { expect: [button("Select language")], act: { click: "#language" }, say: "Klicken Sie auf die Weltkugel." },
      { expect: [{ label: "DE", role: "menuitem" }], act: { click: '[data-test="lang-de"]' }, say: "Wählen Sie DE." },
      DONE,
    ],
    reached: { selector: '[data-test="nav-categories"]:has-text("Kategorien")' },
  },
  // The shop has no reviews or ratings anywhere.
  { id: "no-reviews", kind: "no-answer", start: "/", goal: "How do I leave a review for a tool I bought?", steps: [DONE] },
  // A table with the same link on every row. The newest invoice is the first row.
  {
    id: "latest-order",
    start: "/account/invoices",
    goal: "What exactly was in my most recent order?",
    steps: [{ expect: [{ label: "Details", role: "link", nth: 1 }], act: { click: "app-invoices tbody tr >> nth=0 >> a" }, say: "Click Details on the first row." }, DONE],
    reached: { url: "/account/invoices/[0-9A-Za-z]+$", selector: '[data-test="invoice-number"]' },
  },
];

export default {
  siteId: "site_bench_toolshop",
  origin: "https://practicesoftwaretesting.com",
  hasTag: false,
  about: "Practice Software Testing's Toolshop, an Angular demo store: catalogue filters, basket, a four-step checkout and a customer account. It stands for e-commerce and checkout flows.",
  // Signs in as one of the shop's published test customers, then puts one pair of pliers in the basket.
  // The two hovers only wait: for the sign-in to finish, and for the basket to show in the header.
  //
  // Which customer. The shop's README publishes three, and everyone who practises here shares them:
  // customer@ (Jane Doe), customer2@ (Jack Howe) and customer3@ (Bob Smith, password pass123).
  // An account is locked after three wrong passwords in a row, and anyone who sends the
  // forgot-password form for it sets its password to "welcome02". Both last until the database is
  // rebuilt, which happens every hour on the hour (UTC), and nothing a visitor can do undoes them
  // sooner. Watched for two hours on 15 November 2026 (UTC): customer@ was locked by 16:46 and
  // stayed locked until the rebuild at 17:00, then was locked again by 17:50. customer3@ was
  // locked by 16:49. customer2@ had no failed sign-in in either hour. Other people placed 5 orders
  // as customer@ and 4 as customer3@ in the first hour and none as customer2@. It is shared all
  // the same: someone placed 3 orders as customer2@ in the second hour.
  // customer3@ also has no past orders, which latest-order needs. So this signs in as customer2@,
  // the least used of the three, which has past orders and an address like Jane Doe's (street and
  // city filled in, the rest empty). It can still be locked by someone else in any given hour.
  // ACCOUNT_MENU above still names Jane Doe. Whole-guide runs never read it, but it has to name
  // Jack Howe before this file is recorded again.
  //
  // Which pliers. Every product starts the hour with 25 in stock, and a product with none has its
  // Add to cart button switched off, which is what stopped this block before. Combination Pliers
  // is the first card on the home page and is what everyone else's script buys: in that same hour
  // its stock was down to 6 by 16:40 and to 1 by 16:55, and no other pliers had sold at all. So the
  // basket gets the first pliers on the home page that are in stock and are not Combination
  // Pliers: "Pliers", and Slip Joint Pliers if those ever run out.
  //
  // Both risks grow as the hour goes on, so the safest time to run this set is just after the hour.
  before: {
    path: "/auth/login",
    acts: [
      { fill: ["#email", "customer2@practicesoftwaretesting.com"] },
      { fill: ["#password", "welcome01"] },
      { click: '[data-test="login-submit"]' },
      { hover: '[data-test="nav-menu"]' },
      { click: '[data-test="nav-home"]' },
      { click: 'a.card:has-text("Pliers"):not(:has-text("Combination")):not(:has([data-test="out-of-stock"]))' },
      { click: "#btn-add-to-cart" },
      { hover: '[data-test="nav-cart"]' },
    ],
  },
  sandbox: true,
  guides,
} satisfies GuideSet;
