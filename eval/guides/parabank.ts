import { createRequire } from "node:module";
import type { Matcher } from "../cases.ts";
import { button, DONE, type Guide, type GuideSet } from "../guide.ts";

// ParaBank (parabank.parasoft.com): Parasoft's demo online bank. Every page is
// rendered by the server, the forms are plain HTML tables with the caption in
// one cell and the field in the next, and several pages fill part of
// themselves in after they load.
//
// How the widget lists this app, as seen with eval:look:
// - A field's caption is a <b> in the neighbouring table cell, so the widget
//   never sees it. A field is listed by its `name` attribute when it has one
//   ("customer.phoneNumber", "input") and with an empty label when it has not.
// - Account numbers have five digits, so the widget masks them: every account
//   link on the overview is listed as "[number]".
// - The left-hand menu is the only way between the account pages.

// ---------------------------------------------------------------------------
// A workaround for the recorder, kept in this file because shared code is not
// ours to edit. Every multi-page app in the benchmark needs it, so it belongs
// in eval/browser.ts. It is switched on only for the recorder and the look
// tool, so whole-guide runs still show what the widget really does.
//
// Every link in ParaBank loads a new document, and the server takes 200 to
// 400 ms to start sending it. The widget asks for its next step 300 ms after a
// click, so about one time in two it asks from the page that is being left. A
// real server needs a second or more to answer, so that request dies with the
// old page and the widget on the new page asks again ("A new page loaded: …").
// The recorder answers at once: it would take the request from the old page for
// the script's next step, and the recording would fail, or worse, keep a "done"
// case that shows the wrong page.
//
// So, while a page is loading a new document, a step asked from the old one is
// left unanswered, as a server that has not replied yet would leave it. Nothing
// is added to the page, and what the widget sends from the new page is untouched.
// ---------------------------------------------------------------------------

/** How long to wait, after the widget asks, for a page load that the same click set off. */
const LOAD_GRACE_MS = 400;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

function leaveStepsFromAPageBeingLeftUnanswered(): void {
  let chromium: Loose;
  try {
    // The same Playwright the recorder loads.
    chromium = createRequire(import.meta.url)("playwright").chromium;
  } catch {
    return; // No browser here, so nothing is being recorded.
  }
  // Once per process, whoever asks.
  if (chromium.__stepsWaitForPageLoads) return;
  chromium.__stepsWaitForPageLoads = true;

  /** Pages with a new document on its way, and how many documents each has loaded. */
  const leaving = new WeakSet<object>();
  const loads = new WeakMap<object, number>();
  const watch = (page: Loose) => {
    const main = (request: Loose) => request.isNavigationRequest() && request.frame() === page.mainFrame();
    page.on("request", (request: Loose) => {
      if (main(request)) leaving.add(page);
    });
    page.on("requestfailed", (request: Loose) => {
      if (main(request)) leaving.delete(page);
    });
    page.on("framenavigated", (frame: Loose) => {
      if (frame !== page.mainFrame()) return;
      leaving.delete(page);
      loads.set(page, (loads.get(page) ?? 0) + 1);
    });
  };

  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...launchArgs: Loose[]) => {
    const browser = await launch(...launchArgs);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...contextArgs: Loose[]) => {
      const context = await newContext(...contextArgs);
      context.on("page", watch);
      const route = context.route.bind(context);
      context.route = (url: Loose, handler: Loose, ...rest: Loose[]) => {
        if (typeof url !== "string" || !url.endsWith("/v1/turn")) return route(url, handler, ...rest);
        return route(
          url,
          async (intercepted: Loose) => {
            const page = intercepted.request().frame().page();
            const loaded = loads.get(page);
            if (leaving.has(page)) return;
            await new Promise((resolve) => setTimeout(resolve, LOAD_GRACE_MS));
            if (leaving.has(page) || loads.get(page) !== loaded) return;
            return handler(intercepted);
          },
          ...rest,
        );
      };
      return context;
    };
    return browser;
  };
}
if (/[\\/]eval[\\/](record|look)\.ts$/.test(process.argv[1] ?? "")) leaveStepsFromAPageBeingLeftUnanswered();

const MENU = "#leftPanel";

/** A link in the left-hand "Account Services" menu, by the page it opens. */
const menu = (label: string, page: string): Matcher => ({ label, role: "link", href: `/parabank/${page}` });
const menuClick = (page: string) => ({ click: `${MENU} a[href*="${page}"]` });

/** A field the widget lists under its `name` attribute, which is all it can see of it. */
const named = (name: string): Matcher => ({ label: name, role: "textbox" });

/** The nth field of its kind that the widget lists with no label at all. */
const unnamed = (role: "textbox" | "select", nth: number): Matcher => ({ label: "", role, nth });

/** An account's link in the overview table, counted from the top. The widget lists each one as "[number]". */
const account = (nth: number): Matcher => ({ label: "[number]", role: "link", href: "/parabank/activity.htm", nth });

const OVERVIEW = menu("Accounts Overview", "overview.htm");
/** The transfer form's amount box. Its only name is name="input". */
const AMOUNT = named("input");

const guides: Guide[] = [
  {
    // Asked on the signed-in home page, which also has a "Check Balances" link under "ATM Services". That one opens
    // a web-service description, not the balances.
    id: "balances-wrong-click",
    start: "/parabank/index.htm",
    goal: "How much money have I got right now?",
    kind: "wrong-click",
    steps: [
      // The visitor is pointed at Accounts Overview and clicks the link just above it.
      { expect: [OVERVIEW], act: menuClick("openaccount.htm") },
      { expect: [OVERVIEW], act: menuClick("overview.htm"), say: "Not that one. Click Accounts Overview.", sayStartsWith: "Not that one." },
      DONE,
    ],
    reached: { url: "/parabank/overview\\.htm", text: "Balance includes deposits" },
  },
  {
    id: "open-savings",
    start: "/parabank/overview.htm",
    goal: "I'd like to start a savings account with you",
    steps: [
      { expect: [menu("Open New Account", "openaccount.htm")], act: menuClick("openaccount.htm") },
      // Two dropdowns with no label: the kind of account, then the account the opening deposit comes from, which has a default.
      { expect: [unnamed("select", 1), unnamed("select", 2)], act: { select: ["#type", "SAVINGS"] }, say: "Pick Savings in the first list." },
      { expect: [button("Open New Account"), unnamed("select", 2)], point: button("Open New Account"), act: { click: '#openAccountForm input[type="button"]' } },
      DONE,
    ],
    reached: { text: "Account Opened!" },
  },
  {
    id: "transfer",
    start: "/parabank/activity.htm?id=12456",
    goal: "I need to move $25 out of account 12456 and into 13344",
    steps: [
      { expect: [menu("Transfer Funds", "transfer.htm")], act: menuClick("transfer.htm") },
      // The amount and the two account lists can be filled in any order, so each step allows whatever is still to do.
      // The script does the amount between the two lists, not first as the page has it. The two lists have the same
      // (empty) label, and the widget takes two such fields, pointed at one straight after the other with nothing on
      // the page changing in between, for one field pointed at twice: it asks again and then stops the guide. The
      // recorder cannot walk through that.
      { expect: [AMOUNT, unnamed("select", 1), unnamed("select", 2)], point: unnamed("select", 1), act: { select: ["#fromAccountId", "12456"] }, say: "Pick the account the money comes out of." },
      { expect: [AMOUNT, unnamed("select", 2)], act: { fill: ["#amount", "25"] }, say: "Type the amount." },
      { expect: [unnamed("select", 2)], act: { select: ["#toAccountId", "13344"] }, say: "Pick the account the money goes into." },
      { expect: [button("Transfer")], act: { click: '#transferForm input[type="submit"]' } },
      DONE,
    ],
    reached: { text: "Transfer Complete!" },
  },
  {
    // The search page has five text boxes with no label and four buttons that all say "Find Transactions".
    id: "find-by-amount",
    start: "/parabank/overview.htm",
    goal: "There was a payment of exactly $100 from account 12345. How do I look it up?",
    steps: [
      // 12345 is the first account in the table, and its own page lists every transaction, so that link is a way there too.
      { expect: [menu("Find Transactions", "findtrans.htm"), account(1)], act: menuClick("findtrans.htm") },
      { expect: [unnamed("select", 1), unnamed("textbox", 5)], act: { select: ["#accountId", "12345"] }, say: "Pick the account." },
      { expect: [unnamed("textbox", 5)], act: { fill: ["#amount", "100"] }, say: "Type the amount in the last box." },
      { expect: [{ label: "Find Transactions", role: "button", nth: 4 }], act: { click: "#findByAmount" }, say: "Click the last Find Transactions button." },
      DONE,
    ],
    reached: { text: "Transaction Results" },
  },
  {
    // 13344 is the tenth account in the table. The widget masks every account number, so the links cannot be told apart by name.
    id: "activity-filter",
    start: "/parabank/overview.htm",
    goal: "Show me only the deposits that came into account 13344 in October",
    steps: [
      { expect: [account(10)], act: { click: '#accountTable a[href="activity.htm?id=13344"]' }, say: "Click account 13344." },
      { expect: [{ label: "month", role: "select" }, { label: "transactionType", role: "select" }], act: { select: ["#month", "October"] }, say: "Pick October." },
      { expect: [{ label: "transactionType", role: "select" }], act: { select: ["#transactionType", "Credit"] }, say: "Pick Credit." },
      { expect: [button("Go")], act: { click: '#activityForm input[type="submit"]' } },
      DONE,
    ],
    // After Go, what is listed has no debit in it: either only credits, or nothing at all.
    reached: { selector: "#noTransactions:visible, #transactionTable tbody:not(:has(td:nth-child(3):not(:empty))):visible" },
  },
  {
    // Spanish: "Where can I change my phone number?" It ends on Update Profile, unpressed, once the visitor has typed
    // the new number. Pressing it fails on ParaBank's side, whatever was typed: the site answers "An internal error
    // has occurred and has been logged", also for the form sent back unchanged (seen on 16 November 2026, and in every
    // run before). Ending there leaves Haptic's whole walk to the form judged, and the site's fault out of it.
    id: "update-phone",
    start: "/parabank/billpay.htm",
    goal: "¿Dónde puedo cambiar mi número de teléfono?",
    kind: "awkward",
    steps: [
      { expect: [menu("Update Contact Info", "updateprofile.htm")], act: menuClick("updateprofile.htm") },
      { expect: [named("customer.phoneNumber")], act: { fill: ['input[name="customer.phoneNumber"]', "310-555-0142"] }, say: "Type the new phone number." },
      { expect: [button("Update Profile")], given: { url: "/parabank/updateprofile\\.htm", typedInto: 'input[name="customer.phoneNumber"]' } },
    ],
  },
  {
    // Typos. The form is two text boxes and a dropdown, none with a label the widget can see. A loan this size is
    // turned down, so nothing is added to the customer's accounts.
    id: "loan",
    start: "/parabank/transfer.htm",
    goal: "how do i aply for a lone? i need 50000 dolars for a car and can put 500 down from acount 13344",
    kind: "awkward",
    steps: [
      { expect: [menu("Request Loan", "requestloan.htm")], act: menuClick("requestloan.htm") },
      { expect: [unnamed("textbox", 1), unnamed("textbox", 2), unnamed("select", 1)], act: { fill: ["#amount", "50000"] }, say: "Type how much you want to borrow." },
      // The account is picked between the two amounts for the same reason as in "transfer": the two boxes have the same (empty) label.
      { expect: [unnamed("textbox", 2), unnamed("select", 1)], point: unnamed("select", 1), act: { select: ["#fromAccountId", "13344"] }, say: "Pick the account the down payment comes from." },
      { expect: [unnamed("textbox", 2)], act: { fill: ["#downPayment", "500"] }, say: "Type the down payment." },
      { expect: [button("Apply Now")], act: { click: 'input[value="Apply Now"]' } },
      DONE,
    ],
    reached: { text: "Loan Request Processed" },
  },
  {
    // Ends on the button that sends the message, which is never pressed. The round envelope button in the header
    // and "Contact Us" in the footer open the same form.
    id: "contact",
    start: "/parabank/findtrans.htm",
    goal: "I think there's a mistake on my account. How do I write to someone at the bank about it?",
    kind: "risky",
    steps: [
      { expect: [{ label: "contact", role: "link", href: "/parabank/contact.htm" }, { label: "Contact Us", role: "link", href: "/parabank/contact.htm" }], act: { click: '#headerPanel a[href*="contact.htm"]' } },
      { expect: [named("name"), named("email"), named("phone"), named("message")], act: { fill: ["#name", "Sam Example"] }, say: "Type your name." },
      { expect: [named("email"), named("phone"), named("message")], act: { fill: ["#email", "sam@example.com"] }, say: "Type your email address." },
      { expect: [named("phone"), named("message")], act: { fill: ["#phone", "555-0100"] }, say: "Type your phone number." },
      { expect: [named("message")], act: { fill: ["#message", "Test message, please ignore."] }, say: "Type your message." },
      { expect: [button("Send to Customer Care")] },
    ],
  },
  // ParaBank has no export of any kind, so the right answer points at nothing.
  { id: "no-export", start: "/parabank/activity.htm?id=12345", goal: "How do I download these transactions as a spreadsheet?", kind: "no-answer", steps: [DONE] },
];

export default {
  siteId: "site_bench_parabank",
  origin: "https://parabank.parasoft.com",
  hasTag: false,
  about: "ParaBank, Parasoft's demo online bank: server-rendered pages and table forms whose fields have no labels. Stands for online banking and other old-style form applications.",
  // The demo's standing customer, john / demo. Signing in is one address, so if the site is wiped and the customer has
  // to be another, only this line changes. The home page's own form is not used because, to a visitor with no cookie
  // yet, it posts to "login.htm;jsessionid=…", and the proxy this was recorded behind refuses addresses with ";" in them.
  before: { path: "/parabank/login.htm?username=john&password=demo", acts: [] },
  sandbox: true,
  // Every page links to an Admin Page whose buttons wipe, reset or stop the demo for everyone who uses it.
  never: "Admin Page|admin\\.htm|Initialize|Clean|Shutdown|Startup",
  guides,
} satisfies GuideSet;
