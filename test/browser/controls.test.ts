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
