import type { Matcher } from "../cases.ts";
import { any, button, DONE, type Guide, type GuideSet } from "../guide.ts";

// SAP's OpenUI5 demo apps on sdk.openui5.org: the Shopping Cart and Browse Orders. They are built
// with the same controls as SAP Fiori, so they stand for SAP-style enterprise software. The data is
// mocked inside the browser and nothing leaves the page, so a guide may finish what it starts.
//
// Both apps route by #hash, so the path the widget reports never changes between views.

const CART = "/test-resources/sap/m/demokit/cart/webapp/index.html";
const ORDERS = "/test-resources/sap/m/demokit/orderbrowser/webapp/test/mockServer.html";

/** The round cart button at the top right. It has no words, only a tooltip. */
const OPEN_CART = { expect: [button("Show Shopping Cart")], act: { click: 'button[title="Show Shopping Cart"]' } };

/**
 * A category on the home page is listed twice: its name, and the number of products beside it as
 * "Counter 11". Both are the same row.
 */
const LAPTOPS = any("Laptops");
const LAPTOPS_COUNTER = any("Counter 11");
const LAPTOPS_ROW = '[id$="homeView--categoryList"] li:has-text("Laptops") .sapMSLITitleOnly';

/** One "Compare" link per laptop, all with the same label and nothing listed beside them. They are counted in the list's order, which is by name. */
const compare = (nth: number): Matcher => ({ label: "Compare", role: "link", nth });
const COMPARE_BASIC_17 = compare(8);
const COMPARE_BASIC_19 = compare(10);

// The cash-on-delivery form. Every field is required, so any one still empty is a right next step.
const FIRST_NAME = any("First Name");
const LAST_NAME = any("Last Name");
const PHONE = any("Phone Number");
const EMAIL = any("E-mail Address");
const EMAIL_FIELD = 'input[id$="cashOnDeliveryEmail-inner"]';

/**
 * An order's row is listed with everything in it as its label, cut at 80 characters, and it starts
 * with the order date. The dates in the mock data are midnight in Germany, so a browser set to
 * central European time or further east shows the next day: 9/18/16 for the order that reads
 * 9/17/16 in London or New York.
 */
const ORDER_7918 = [
  any("9/17/16 Emphasized Order 7918 Tortuga Restaurante Urgent Object Status Warning…"),
  any("9/18/16 Emphasized Order 7918 Tortuga Restaurante Urgent Object Status Warning…"),
];

const guides: Guide[] = [
  // Through a category to a product. On a category's product list each row opens the product, but
  // the widget lists only the row's "Compare" link: the row is dropped as a wrapper around that
  // link, and its text with it. Searching for the name is the other way there, and the widget lists it.
  {
    id: "add-to-cart",
    start: CART,
    goal: "I want the Notebook Basic 17. How do I put it in my basket?",
    steps: [
      { expect: [LAPTOPS, LAPTOPS_COUNTER, any("Search")], point: LAPTOPS, act: { click: LAPTOPS_ROW } },
      {
        expect: [{ label: "Notebook Basic 17", role: "clickable" }],
        unlisted: true,
        act: { click: '[id$="category--productList"] li:has-text("Notebook Basic 17") .sapMObjLTitle' },
      },
      { expect: [button("Add to Cart")], act: { click: 'button:has-text("Add to Cart")' } },
      DONE,
    ],
    // The only sign that it went in is a message that stays for four seconds.
    reached: { url: "#/category/LT/product/HT-1001$", text: 'Product "Notebook Basic 17" added to your shopping cart' },
  },
  // Search as you type. The category would get there too, for someone who knows what a Gladiator MX is.
  {
    id: "search-product",
    start: CART,
    goal: "I can't find the Gladiator MX. Where can I see its details?",
    steps: [
      {
        expect: [any("Search"), any("Graphics Card"), { label: "Counter 4", nth: 1 }],
        act: { fill: ['input[type="search"]', "Gladiator MX"] },
        say: "Type the product's name here.",
      },
      {
        expect: [any("81,70 EUR Emphasized Gladiator MX Ultrasonic United Available Object Status Ent…")],
        act: { click: '[id$="homeView--productList"] li:has-text("Gladiator MX")' },
      },
      DONE,
    ],
    reached: { url: "#/category/GC/product/HT-1071$" },
  },
  // A filter two levels down in a dialog, behind a button with no words, asked in German:
  // "Which laptops are out of stock at the moment?"
  {
    id: "filter-out-of-stock",
    kind: "awkward",
    start: `${CART}#/category/LT`,
    goal: "Welche Laptops sind im Moment nicht auf Lager?",
    steps: [
      { expect: [button("Filter")], act: { click: '[id$="category--masterListFilterButton"]' } },
      { expect: [any("Availability")], act: { click: '[role="dialog"] li:has-text("Availability")' } },
      {
        // The row's checkbox and the row's text are listed apart, and all three checkboxes are called "Item Selection".
        expect: [{ label: "Item Selection", role: "checkbox", nth: 2 }, any("Out of Stock")],
        act: { click: '[role="dialog"] li:has-text("Out of Stock") [role="checkbox"]' },
        say: "Tick Out of Stock.",
      },
      { expect: [button("OK")], act: { click: '[role="dialog"] button:has-text("OK")' } },
      DONE,
    ],
    reached: { text: "Filtered by Availability" },
    // The question asks for a fact, and the laptop list it is asked from marks each laptop In Stock or Out of Stock.
    // A sentence that names every laptop marked out of stock and none that is not gives the visitor what they asked
    // for, whether or not they ever open the filter, which is only one way to find out. Both lists are read from that
    // page when the guide starts, so the answer is never written here.
    says: {
      shown: { selector: '[id$="category--productList"] li:has-text("Out of Stock") .sapMObjLTitle', when: "start" },
      notShown: { selector: '[id$="category--productList"] li:not(:has-text("Out of Stock")) .sapMObjLTitle', when: "start" },
    },
  },
  // The same link on every row of the laptop list, and nothing in the widget's list or text says which row is which.
  {
    id: "compare-laptops",
    start: `${CART}#/category/LT`,
    goal: "I can't decide between the Notebook Basic 17 and the Notebook Basic 19. Can I see the two next to each other?",
    steps: [
      {
        expect: [COMPARE_BASIC_17, COMPARE_BASIC_19],
        act: { click: '[id$="category--productList"] li:has-text("Notebook Basic 17") [role="link"]' },
        say: "Click Compare under the Notebook Basic 17.",
      },
      {
        expect: [COMPARE_BASIC_19],
        act: { click: '[id$="category--productList"] li:has-text("Notebook Basic 19") [role="link"]' },
        say: "Click Compare under the Notebook Basic 19.",
      },
      DONE,
    ],
    reached: { url: "#/category/LT/compare/HT-1001/HT-1003$" },
  },
  // Stops at the button that removes the item. It is never pressed.
  {
    id: "remove-from-cart",
    kind: "risky",
    start: CART,
    goal: "I added the Media Keyboard by mistake. How do I take it out of my basket again?",
    steps: [
      OPEN_CART,
      { expect: [button("Edit your cart")], act: { click: 'button[title="Edit your cart"]' } },
      {
        // One "Delete" per item, in the cart's order: Internet Keyboard, then Media Keyboard.
        expect: [{ label: "Delete", role: "button", nth: 2 }],
        trap: [{ label: "Delete", role: "button", nth: 1 }],
        act: { click: '[id$="cartView--entryList"] li:has-text("Media Keyboard") button[aria-label="Delete"]' },
        say: "Click Delete beside the Media Keyboard.",
      },
      // The confirmation's own "Delete". The rows' buttons are listed "in main", this one "in toolbar".
      { expect: [{ label: "Delete", role: "button", context: "toolbar" }] },
    ],
  },
  // The visitor is pointed at the cart button and clicks the one beside it, which only shows a message.
  {
    id: "cart-wrong-click",
    kind: "wrong-click",
    start: CART,
    goal: "what's in my basket right now?",
    steps: [
      { expect: [button("Show Shopping Cart")], act: { click: 'button[title="Login"]' } },
      { ...OPEN_CART, say: "Not that one. Click the cart button at the top right.", sayStartsWith: "Not that one." },
      DONE,
    ],
    reached: { url: "#/cart$", text: "Items in Shopping Cart" },
  },
  // The checkout wizard: a choice of payment, then a form with four required fields.
  {
    id: "pay-on-delivery",
    start: `${CART}#/checkout`,
    goal: "I'd rather not pay online. Can I give the money to the driver when the parcel arrives?",
    steps: [
      { expect: [button("Step 2")], act: { click: 'button:has-text("Step 2")' } },
      { expect: [any("Cash on Delivery")], act: { click: 'li[role="option"]:has-text("Cash on Delivery")' } },
      { expect: [button("Step 3")], act: { click: 'button:has-text("Step 3")' } },
      { expect: [FIRST_NAME, LAST_NAME, PHONE, EMAIL], act: { fill: ['input[id$="cashOnDeliveryName-inner"]', "Sam"] }, say: "Type your first name." },
      { expect: [LAST_NAME, PHONE, EMAIL], act: { fill: ['input[id$="cashOnDeliveryLastName-inner"]', "Sample"] }, say: "Type your last name." },
      { expect: [PHONE, EMAIL], act: { fill: ['input[id$="cashOnDeliveryPhoneNumber-inner"]', "0301234567"] }, say: "Type your phone number." },
      { expect: [EMAIL], act: { fill: [EMAIL_FIELD, "sam@example.com"] }, say: "Type your e-mail address." },
      {
        // The wizard shows its next button only once the last field has been left (Tab, Enter or a
        // click elsewhere). The widget asks for the next step when typing pauses, with the cursor
        // still in the field, so the button is not on the page yet and nothing can be pointed at.
        // The visitor has to leave the field themselves. The guide ends here, with the button showing.
        expect: [button("Step 4")],
        unlisted: true,
        act: { press: [EMAIL_FIELD, "Tab"] },
      },
    ],
    reached: { selector: 'button:has-text("Step 4")' },
    // "Can I give the money to the driver?" is answered by yes and the name of the option: Cash on Delivery is one of
    // the app's payment types, which is part of the app and not of its data, so it is written here. A sentence that
    // names it while saying it is not offered, or that only hedges, is the wrong answer.
    says: {
      all: ["\\bcash.on.delivery\\b"],
      not: [
        "\\b(isn't|is not|aren't|are not|not|no longer)( be)? (offered|available|possible|supported|accepted|an option)\\b",
        "\\b(can't|cannot|can not|don't|doesn't|do not|does not) (offer|support|accept|pay (the driver|on delivery|in cash))\\b",
        "^\\W*no\\b",
      ],
    },
  },
  // The shop has one currency and nowhere to change it.
  {
    id: "no-such-feature",
    kind: "no-answer",
    start: CART,
    goal: "Can I see the prices in US dollars instead of euros?",
    steps: [DONE],
  },
  // A row with a long label, then a tab that has an icon and no words. The widget lists both tabs with an empty label.
  {
    id: "order-processor",
    start: ORDERS,
    goal: "Who was the employee that took care of order 7918?",
    steps: [
      { expect: ORDER_7918, act: { click: 'li:has-text("Order 7918")' }, say: "Click order 7918 in the list." },
      {
        expect: [{ label: "", role: "tab", nth: 2 }],
        act: { click: '[id$="detail--iconTabFilterProcessor"]' },
        say: "Click the second tab, the one with the person on it.",
      },
      DONE,
    ],
    reached: { url: "tab=processor", text: "Processor Information" },
  },
  // A dialog behind a button with no words, with a list of radio buttons that are all called "Item Selection".
  {
    id: "group-orders",
    start: ORDERS,
    goal: "show the orders customer by customer",
    steps: [
      { expect: [button("Group")], act: { click: 'button[title="Group"]' } },
      {
        expect: [{ label: "Item Selection", role: "radio", nth: 3 }, any("Group by Customer")],
        act: { click: '[role="dialog"] li:has-text("Group by Customer") [role="radio"]' },
        say: "Pick Group by Customer.",
      },
      { expect: [button("OK")], act: { click: '[role="dialog"] button:has-text("OK")' } },
      DONE,
    ],
    reached: { selector: '.sapMGHLI:has-text("Tortuga Restaurante")' },
  },
  // This search does nothing until Enter is pressed or the magnifying glass in the field is clicked.
  // The glass is a <div aria-hidden="true"> with a click handler, so the widget does not list it.
  {
    id: "search-orders",
    start: ORDERS,
    goal: "I only want to see the orders from Tortuga Restaurante, not the whole list",
    steps: [
      { expect: [any("Search")], act: { fill: ['input[type="search"]', "Tortuga Restaurante"] }, say: "Type the customer's name here." },
      {
        expect: [{ label: "Search", role: "button" }],
        unlisted: true,
        act: { click: '[id$="master--searchField-search"]' },
      },
    ],
    reached: { text: "Orders (2)" },
  },
];

export default {
  siteId: "site_bench_ui5",
  origin: "https://sdk.openui5.org",
  hasTag: false,
  about: "SAP's OpenUI5 demo apps (Shopping Cart and Browse Orders), built with the same controls as SAP Fiori: stands for SAP-style enterprise software.",
  sandbox: true,
  // A visitor who has been shopping: two keyboards are already in the cart. The cart is kept in the
  // browser's local storage, and this address differs from every guide's start by its query, so each
  // guide starts from a fresh page load with that cart in it.
  before: {
    path: `${CART}?sap-ui-language=en#/category/KB/product/HT-1064`,
    acts: [
      { hover: '.sapMOH:has-text("Internet Keyboard")' },
      { click: 'button:has-text("Add to Cart")' },
      { click: 'li:has-text("Media Keyboard") .sapMObjLTitle' },
      { hover: '.sapMOH:has-text("Media Keyboard")' },
      { click: 'button:has-text("Add to Cart")' },
      { hover: '.sapMMessageToast:has-text("Media Keyboard")' },
    ],
  },
  // Nothing to click away. These match nothing and are tried for 1.5 seconds each: the apps get their
  // data from a mock server inside the page, half a second after the network has gone quiet, and the
  // recorder would otherwise ask before the lists are there.
  dismiss: ["#no-banner-wait-1", "#no-banner-wait-2"],
  guides,
} satisfies GuideSet;
