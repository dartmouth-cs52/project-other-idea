import assert from "node:assert/strict";
import { after, test } from "node:test";
import { lines, startBrowser } from "./page.ts";

// What the widget lists on pages built the way Northpine, the spend app made
// for testing Haptic, builds them with Radix and a table of its own: switches
// and tick boxes named by a <label>, controls a visitor's role disables, rows
// that open a record, and a toaster's empty region. Each page is the smallest
// one that shows a fault found there. Run with: npm run test:browser

const started = await startBrowser();
if (process.env.CI && typeof started === "string") throw new Error(started);
const browser = typeof started === "string" ? undefined : started;
const skip = typeof started === "string" ? started : false;
after(() => browser?.close());
const read = (...args: Parameters<NonNullable<typeof browser>["read"]>) => browser!.read(...args);

/** Words only a screen reader reads, the way Tailwind's sr-only hides them. */
const SR_ONLY = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap";

// Controls named by a <label> ---------------------------------------------------

test("a switch drawn as a button is named by the <label> that points at it, not by the words after it", { skip }, async () => {
  const snapshot = await read(`<main><h1>Trip</h1>
    <div><label for="s1" style="cursor:pointer">Round trip</label><p>Counts the miles twice</p><button type="button" role="switch" aria-checked="false" id="s1" style="width:36px;height:20px"></button></div></main>`);
  assert.deepEqual(lines(snapshot), ['switch "Round trip" [main › Trip]']);
});

test("a tick box is named by a <label> only a screen reader can read", { skip }, async () => {
  const snapshot = await read(`<main><h1>Bills</h1><table><thead><tr>
    <th><span><button type="button" role="checkbox" aria-checked="false" id="c1" style="width:16px;height:16px"></button><label for="c1"><span style="${SR_ONLY}">Select all</span></label></span></th><th>Vendor</th>
  </tr></thead></table></main>`);
  assert.deepEqual(lines(snapshot), ['checkbox "Select all" [main › Bills]']);
});

test("a date picker's button is named by its <label>, and not by the words it shows, which become the date chosen", { skip }, async () => {
  const snapshot = await read(`<main><h1>Pay</h1><label for="d1">Payment date</label><button type="button" id="d1" aria-haspopup="dialog">Nov 20, 2026</button></main>`);
  assert.deepEqual(lines(snapshot), ['button "Payment date" (opens a dialog) [main › Pay]']);
});

test("a control that is one by its role alone is named by a <label for>, and the label is not listed beside it", { skip }, async () => {
  const snapshot = await read(`<main><h1>Trip</h1><label for="s2" style="cursor:pointer">Split across categories</label>
    <div role="switch" tabindex="0" aria-checked="false" id="s2" style="width:36px;height:20px"></div></main>`);
  assert.deepEqual(lines(snapshot), ['switch "Split across categories" [main › Trip]']);
});

// Controls the visitor's role disables -------------------------------------------

test("a box the keyboard reaches around a disabled switch is folded into it, and the reason printed in it goes with the switch", { skip }, async () => {
  const snapshot = await read(`<main><h1>Security</h1><section><h2>Two-factor authentication</h2>
    <span tabindex="0" style="display:inline-flex"><div style="width:600px"><div style="display:flex;justify-content:space-between">
      <div><label for="sw" style="cursor:pointer">Require two-factor for everyone</label><p>Only Admin can do this. You're signed in as Employee.</p></div>
      <button type="button" role="switch" aria-checked="false" id="sw" disabled style="width:36px;height:20px"></button>
    </div></div></span></section></main>`);
  assert.deepEqual(lines(snapshot), [
    `switch "Require two-factor for everyone" (disabled) [main › Two-factor authentication › disabled: Only Admin can do this. You're signed in as Employee.]`,
  ]);
});

test("a disabled control carries the reason its tooltip, aria-describedby or aria-description gives, on itself or on the box around it", { skip }, async () => {
  const snapshot = await read(`<main><h1>Bill</h1>
    <span tabindex="0" aria-describedby="tip" style="display:inline-flex"><button disabled>Pay now</button></span>
    <div role="tooltip" id="tip" style="position:absolute;top:0;left:400px">Only Admin or Finance can do this.</div>
    <button disabled title="Only Admin can do this.">Delete</button>
    <button disabled aria-describedby="why">Export</button><p id="why">Only Finance can export.</p>
    <button disabled aria-description="Locked while the bill is paid.">Edit</button>
    <span tabindex="0" style="display:inline-flex"><button disabled>Reject</button><button disabled>Approve</button></span>
    <button disabled title="Archive">Archive</button></main>`);
  assert.deepEqual(lines(snapshot), [
    'button "Pay now" (disabled) [main › Bill › disabled: Only Admin or Finance can do this.]',
    'button "Delete" (disabled) [main › Bill › disabled: Only Admin can do this.]',
    'button "Export" (disabled) [main › Bill › disabled: Only Finance can export.]',
    'button "Edit" (disabled) [main › Bill › disabled: Locked while the bill is paid.]',
    // Listed once each, with no reason the page did not give, and no box of their own around them.
    'button "Reject" (disabled) [main › Bill]',
    'button "Approve" (disabled) [main › Bill]',
    // A tooltip that only says the name again is no reason.
    'button "Archive" (disabled) [main › Bill]',
  ]);
});

test("a box the keyboard reaches around a control that can be used is not folded for this, and gives it no reason", { skip }, async () => {
  const snapshot = await read(`<main><h1>Reports</h1><span tabindex="0" title="Exports everything" style="display:inline-flex"><button>Export</button><button disabled>Print</button></span></main>`);
  assert.deepEqual(lines(snapshot), ['clickable "Export Print" [main › Reports]', 'button "Export" [main › Reports]', 'button "Print" (disabled) [main › Reports]']);
});

// A region with nothing in it ----------------------------------------------------

test("an empty region named for screen readers, like a toaster's, is not the surroundings of what comes after it", { skip }, async () => {
  const snapshot = await read(`<div id="root"><main><h1>Home</h1><button>Inside main</button></main></div>
    <section aria-label="Notifications alt+T" tabindex="-1" aria-live="polite"></section>
    <div style="position:fixed;bottom:10px;left:10px"><button>Open test panel</button></div>`);
  assert.deepEqual(lines(snapshot), ['button "Inside main" [main › Home]', 'button "Open test panel"']);
});

test("a toaster's region showing a message is still not the surroundings of what comes after it", { skip }, async () => {
  const snapshot = await read(`<main><h1>Home</h1></main>
    <section aria-label="Notifications alt+T"><ol><li>Bill paid</li></ol></section>
    <button>Open test panel</button>`);
  assert.deepEqual(lines(snapshot), ['button "Open test panel"']);
});

test("a section of words with a title of its own still introduces what comes after it", { skip }, async () => {
  const snapshot = await read(`<section aria-label="Intro"><h2>Billing</h2><p>Pay your bills on time.</p></section><button>Pay a bill</button>`);
  assert.deepEqual(lines(snapshot), ['button "Pay a bill" [Billing]']);
});

// Rows that open a record ----------------------------------------------------------

/** A row of a table drawn in boxes, each row alone in a box of its own, as Northpine's table draws them: a tick box, an invoice's link, words, and actions that show on hover. */
const BILL_ROW = (n: number, invoice: string, vendor: string, amount: string) =>
  `<div class="row-box"><div role="row" style="display:grid;grid-template-columns:36px 1fr 1fr 1fr 1fr;position:relative;cursor:pointer">
    <div role="cell"><span><button type="button" role="checkbox" aria-checked="false" id="r${n}" style="width:16px;height:16px"></button><label for="r${n}"><span style="${SR_ONLY}">Select row</span></label></span></div>
    <div role="cell"><a href="/bills/bill_000p${n}">${invoice}</a></div><div role="cell">${vendor}</div><div role="cell">${amount}</div><div role="cell">Due Nov 18</div>
    <div role="cell" style="position:absolute;right:0;top:0;opacity:0;display:flex"><button type="button">Pay</button><button type="button" aria-label="More"><svg class="lucide lucide-ellipsis" width="16" height="16"></svg></button></div>
  </div></div>`;

test("a table row that opens its record is listed though it holds a tick box and buttons, and its actions and links carry its name", { skip }, async () => {
  const snapshot = await read(`<main><h1>Bills</h1><div role="table" aria-label="Bills"><div role="rowgroup">
    ${BILL_ROW(1, "INV-04257", "Brightdesk Coworking", "$1,200.00")}${BILL_ROW(2, "INV-04312", "Keystone Legal", "$880.00")}
  </div></div></main>`);
  assert.deepEqual(lines(snapshot), [
    'clickable "INV-[number] Brightdesk Coworking $1,200.00 Due Nov 18" [main › Bills]',
    'checkbox "Select row" [main › Bills › row: Brightdesk Coworking $1,200.00 Due Nov…]',
    // Two links that read the same once their numbers are masked are told apart by their rows.
    'link "INV-[number]" [main › Bills › row: Brightdesk Coworking $1,200.00 Due Nov…] → /bills/:id',
    'button "Pay" [main › Bills › row: Brightdesk Coworking $1,200.00 Due Nov…]',
    'button "More" icon:ellipsis [main › Bills › row: Brightdesk Coworking $1,200.00 Due Nov…]',
    'clickable "INV-[number] Keystone Legal $880.00 Due Nov 18" [main › Bills]',
    'checkbox "Select row" [main › Bills › row: Keystone Legal $880.00 Due Nov 18]',
    'link "INV-[number]" [main › Bills › row: Keystone Legal $880.00 Due Nov 18] → /bills/:id',
    'button "Pay" [main › Bills › row: Keystone Legal $880.00 Due Nov 18]',
    'button "More" icon:ellipsis [main › Bills › row: Keystone Legal $880.00 Due Nov 18]',
  ]);
});

test("an employee's row as OrangeHRM draws it is listed, without the pictures of its tick box and buttons, and its buttons carry its name", { skip }, async () => {
  const row = (id: string, name: string) => `<div class="card"><div role="row" style="display:flex;cursor:pointer">
    <div role="cell" style="width:40px"><label><input type="checkbox" style="opacity:0;position:absolute"><span style="display:inline-block;width:14px;height:14px"><i class="oxd-icon bi-check"></i></span></label></div>
    <div role="cell" style="width:80px"><div>${id}</div></div><div role="cell" style="width:160px"><div>${name}</div></div>
    <div role="cell" style="width:80px"><div style="display:flex"><button type="button" style="width:24px;height:24px"><i class="oxd-icon bi-pencil-fill"></i></button><button type="button" style="width:24px;height:24px"><i class="oxd-icon bi-trash"></i></button></div></div>
  </div></div>`;
  const snapshot = await read(`<main><h1>Employees</h1><div role="table"><div role="rowgroup">${row("0042", "Peter Mac Anderson")}${row("0043", "Linda Jane Anderson")}</div></div></main>`);
  const listed = lines(snapshot);
  assert.ok(listed.includes('clickable "0042 Peter Mac Anderson" [main › Employees]'), listed.join("\n"));
  assert.ok(listed.includes('button icon:pencil-fill [main › Employees › row: 0042 Peter Mac Anderson]'), listed.join("\n"));
  assert.ok(listed.includes('button icon:trash [main › Employees › row: 0043 Linda Jane Anderson]'), listed.join("\n"));
});

test("a table row whose only words are its link's is no control of its own", { skip }, async () => {
  const snapshot = await read(`<main><h1>Orders</h1><table><tbody><tr style="cursor:pointer"><td><a href="/orders/1">Order 1</a></td></tr><tr style="cursor:pointer"><td><a href="/orders/2">Order 2</a></td></tr></tbody></table></main>`);
  assert.deepEqual(lines(snapshot), ['link "Order 1" [main › Orders] → /orders/:id', 'link "Order 2" [main › Orders] → /orders/:id']);
});

// A button with no name -------------------------------------------------------------

/** An account button that shows the visitor's initials, hidden from screen readers, as Northpine's header draws it. */
const AVATAR = (attributes = "") =>
  `<button type="button" id="avatar" aria-haspopup="menu" aria-expanded="false" ${attributes} style="width:30px;height:30px;border-radius:50%"><span aria-hidden="true">AS</span></button>`;

test("a button that shows only initials hidden from screen readers is listed as a menu button with no name, where it sits", { skip }, async () => {
  const snapshot = await read(`<header style="display:flex;justify-content:space-between;align-items:center;height:48px"><a href="/">Home</a>${AVATAR()}</header><main><h1>Dashboard</h1></main>`);
  assert.deepEqual(lines(snapshot), ['link "Home" [header] → /', "button (opens a menu, collapsed) [header › top right]"]);
});

test("a button with no name is named by the menu it opens, or by the box around it, when the page names either", { skip }, async () => {
  const snapshot = await read(`<header style="display:flex;justify-content:flex-end;height:48px">
    ${AVATAR('aria-controls="account-menu"')}<div role="menu" id="account-menu" aria-label="Your account" style="display:none"></div>
    <div aria-label="Workspace switcher"><button type="button" aria-haspopup="menu" style="width:30px;height:30px"><span aria-hidden="true">NP</span></button></div></header>`);
  assert.deepEqual(lines(snapshot), ['button "Your account" (opens a menu, collapsed) [header]', 'button "Workspace switcher" (opens a menu) [header]']);
});

// Words in boxes of their own ---------------------------------------------------------

test("the words of separate boxes are kept apart, as the accessibility tree keeps them, and words styled within a line are not", { skip }, async () => {
  const snapshot = await read(`<div role="tablist"><a role="tab" href="/cards?view=mine" style="display:flex;gap:6px">My cards<span style="padding:0 6px">3</span></a>
    <a role="tab" href="/expenses?review=needs" style="display:flex">Needs review<span style="display:inline-block">2067</span></a></div>
    <div role="menu"><div role="menuitem" tabindex="-1" style="display:flex">Theme<span style="margin-left:auto">›</span></div></div>
    <button>Re<b>view</b> all</button>`);
  assert.deepEqual(lines(snapshot), [
    'tab "My cards 3" [tabs] → /cards?view=mine',
    'tab "Needs review 2067" [tabs] → /expenses?review=needs',
    'menuitem "Theme ›" [menu]',
    'button "Review all"',
  ]);
});
