import assert from "node:assert/strict";
import { after, test } from "node:test";
import { lines, startBrowser } from "./page.ts";

// How the widget reads a page, checked in a real browser. Each test is a small
// page that shows one fault found on a real app, and what the widget has to
// list for it. Run with: npm run test:browser

const started = await startBrowser();
const browser = typeof started === "string" ? undefined : started;
const skip = typeof started === "string" ? started : false;
after(() => browser?.close());
const read = (...args: Parameters<NonNullable<typeof browser>["read"]>) => browser!.read(...args);

// Masking ---------------------------------------------------------------------

const ACCOUNTS = `<h1>Accounts Overview</h1>
  <table>
    <tr><th>Account</th><th>Balance</th></tr>
    <tr><td><a href="/activity?id=12345">12345</a></td><td>$10.00</td></tr>
    <tr><td><a href="/activity?id=13344">13344</a></td><td>$20.00</td></tr>
    <tr><td><a href="/activity?id=133440">133440</a></td><td>$30.00</td></tr>
  </table>
  <p>Account Number: 13344</p>
  <select aria-label="From account"><option>12345</option><option>13344</option></select>`;

test("a number the visitor named is left as it is, and every other long number stays masked", { skip }, async () => {
  const snapshot = await read(ACCOUNTS, { goal: "Show me the deposits that came into account 13344 in October" });
  const links = snapshot.elements.filter((element) => element.role === "link").map((element) => element.label);
  assert.deepEqual(links, ["[number]", "13344", "[number]"]);
  assert.ok(snapshot.text.includes("Account Number: 13344"));
  assert.deepEqual(snapshot.elements.find((element) => element.role === "select")?.options, ["[number]", "13344"]);
});

test("with no number in the question every long number is masked", { skip }, async () => {
  const snapshot = await read(ACCOUNTS, { goal: "Show me my deposits" });
  assert.deepEqual(snapshot.elements.filter((element) => element.role === "link").map((element) => element.label), ["[number]", "[number]", "[number]"]);
  assert.ok(snapshot.text.includes("Account Number: [number]"));
});

test("a date is not masked, and a row is named by it", { skip }, async () => {
  const snapshot = await read(`<table>
    <tr><th>Date</th><th>Transaction</th></tr>
    <tr><td>11-15-2026</td><td><a href="/t?id=1">Funds Transfer Received</a></td></tr>
    <tr><td>10-02-2026</td><td><a href="/t?id=2">Funds Transfer Received</a></td></tr>
  </table>`);
  assert.deepEqual(lines(snapshot), [
    'link "Funds Transfer Received" [row: 11-15-2026] → /t',
    'link "Funds Transfer Received" [row: 10-02-2026] → /t',
  ]);
});

// Menus -----------------------------------------------------------------------

test("a link that opens a menu is listed as opening one, without the address it carries", { skip }, async () => {
  const snapshot = await read(`<nav>
    <a href="/help/shortcuts" aria-haspopup="true" aria-expanded="false">Help</a>
    <a href="/dashboards" role="button" aria-haspopup="menu" aria-expanded="true">Dashboards</a>
    <a href="/more" aria-expanded="false">More</a>
    <input type="checkbox" role="button" aria-haspopup="true" aria-label="Tools">
    <button aria-haspopup="dialog">Share</button>
    <a href="/docs">Docs</a>
  </nav>`);
  assert.deepEqual(lines(snapshot), [
    'link "Help" (opens a menu, collapsed) [nav]',
    'button "Dashboards" (opens a menu, expanded) [nav]',
    'link "More" (collapsed) [nav]',
    'button "Tools" (opens a menu) [nav]',
    'button "Share" (opens a dialog) [nav]',
    'link "Docs" [nav] → /docs',
  ]);
});
