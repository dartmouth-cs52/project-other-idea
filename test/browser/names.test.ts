import assert from "node:assert/strict";
import { after, test } from "node:test";
import { lines, startBrowser } from "./page.ts";

// What the widget lists, and what it calls each thing, on pages built the way
// the UI toolkits customers use build them (UI5 Web Components, Ant Design,
// Fluent UI, Carbon, MUI, and OrangeHRM's own). Each page is the smallest one
// that shows a fault found in the toolkits' own demos. Run with: npm run test:browser

const started = await startBrowser();
if (process.env.CI && typeof started === "string") throw new Error(started);
const browser = typeof started === "string" ? undefined : started;
const skip = typeof started === "string" ? started : false;
after(() => browser?.close());
const read = (...args: Parameters<NonNullable<typeof browser>["read"]>) => browser!.read(...args);

// Calendars ---------------------------------------------------------------------

/** A week of days, each a cell that shows the pointer and says which day it is, as UI5's calendar draws them. */
const UI5_WEEK = (days: number[], today = -1) =>
  `<div role="row">${days
    .map(
      (day) =>
        `<div role="gridcell" tabindex="${day === today ? 0 : -1}" aria-selected="false" aria-label="November ${day}, 2026" style="cursor:pointer;display:inline-block;width:30px;height:24px"><span>${day}</span></div>`,
    )
    .join("")}</div>`;

test("a calendar's days are listed one by one, not merged into one entry for each week", { skip }, async () => {
  const snapshot = await read(`<h1>Delivery</h1><div role="grid">${UI5_WEEK([1, 2, 3, 4, 5, 6, 7])}${UI5_WEEK([8, 9, 10, 11, 12, 13, 14], 9)}</div>`);
  const days = lines(snapshot).filter((line) => line.includes("2026"));
  assert.equal(days.length, 14);
  assert.equal(days[0], 'clickable "November 1, 2026" [Delivery]');
  assert.equal(days[13], 'clickable "November 14, 2026" [Delivery]');
});

/**
 * Ant Design's date panel: a box the keyboard can reach, with no pointer of its
 * own, around a table of days that each show the pointer and carry their date
 * as a tooltip. The days of the months before and after repeat some numbers.
 */
const day = (month: number, date: number) => `<td title="2026-${month}-${String(date).padStart(2, "0")}" style="cursor:pointer"><div>${date}</div></td>`;
const ANTD_PANEL = `<h1>Dates</h1><input placeholder="Select date">
<div class="panel" tabindex="0" style="width:280px">
  <div><button type="button" aria-label="Previous month">‹</button><button type="button">Nov</button><button type="button">2026</button><button type="button" aria-label="Next month">›</button></div>
  <table><thead><tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr></thead><tbody>
    <tr>${[26, 27, 28, 29, 30, 31].map((date) => day(10, date)).join("")}${day(11, 1)}</tr>
    <tr>${[2, 3, 4, 5, 6, 7, 8].map((date) => day(11, date)).join("")}</tr>
    <tr>${[29, 30].map((date) => day(11, date)).join("")}${[1, 2, 3, 4, 5].map((date) => day(12, date)).join("")}</tr>
  </tbody></table>
  <button type="button">Today</button>
</div>`;

test("a day in a panel the keyboard moves through is a control of its own, and the panel is not one", { skip }, async () => {
  const snapshot = await read(ANTD_PANEL);
  const listed = lines(snapshot);
  // The panel is not listed as one control named by all its words.
  assert.ok(!listed.some((line) => line.includes("Su Mo")), listed.join("\n"));
  // Each day is, and two days that show the same number are told apart by the date each carries.
  assert.ok(listed.includes('clickable "6" [Dates]'), listed.join("\n"));
  assert.ok(listed.includes('clickable "1" [Dates › row: 2026-11-01]'), listed.join("\n"));
  assert.ok(listed.includes('clickable "1" [Dates › row: 2026-12-01]'), listed.join("\n"));
  assert.equal(listed.filter((line) => line.startsWith("clickable")).length, 21);
  assert.ok(listed.includes('button "Today" [Dates]'));
  // The days of the week are words on the page.
  assert.ok(snapshot.text.includes("Su | Mo | Tu | We | Th | Fr | Sa"), JSON.stringify(snapshot.text));
});

test("a step the keyboard moves to, around one drawing that shows the pointer, is still one entry", { skip }, async () => {
  // OpenUI5's wizard: each step takes the keyboard and has no pointer, and the circle and title inside it show the pointer.
  const step = (n: number, title: string) =>
    `<li role="listitem" tabindex="${n === 1 ? 0 : -1}" aria-label="Step ${n} ${title} Active"><div style="cursor:pointer"><span>${n}</span><span>${title}</span></div></li>`;
  const snapshot = await read(`<nav aria-label="Wizard Progress Bar"><ul role="list">${step(1, "Items")}${step(2, "Payment Type")}</ul></nav>`);
  assert.deepEqual(lines(snapshot), ['clickable "Step 1 Items Active" [nav › Wizard Progress Bar]', 'clickable "Step 2 Payment Type Active" [nav › Wizard Progress Bar]']);
});

test("the cells of a table row that opens what it shows are still one entry", { skip }, async () => {
  const snapshot = await read(`<h1>Employees</h1><table><tbody>
    <tr><td style="cursor:pointer">Ada Lovelace</td><td style="cursor:pointer">Engineering</td><td style="cursor:pointer">London</td></tr>
    <tr><td style="cursor:pointer">Alan Turing</td><td style="cursor:pointer">Research</td><td style="cursor:pointer">Manchester</td></tr>
  </tbody></table>`);
  assert.deepEqual(lines(snapshot), ['clickable "Ada Lovelace Engineering London" [Employees]', 'clickable "Alan Turing Research Manchester" [Employees]']);
});

// Names --------------------------------------------------------------------------

test("words a component puts through a slot are its words", { skip }, async () => {
  const snapshot = await read(`<h1>Content size</h1><div id="list" role="listbox"></div>
    <script>
      for (const word of ["Cozy", "Compact"]) {
        const option = document.createElement("x-option");
        option.textContent = word;
        option.attachShadow({ mode: "open" }).innerHTML = '<li role="option" tabindex="-1" style="display:block;padding:8px"><div><span><slot></slot></span></div></li>';
        document.getElementById("list").append(option);
      }
    </script>`);
  assert.deepEqual(lines(snapshot), ['option "Cozy" [list]', 'option "Compact" [list]']);
});

test("a control named by a field is named by what the page calls that field, never by what is in it", { skip }, async () => {
  const snapshot = await read(`<main><label id="date-label" for="date">Select a date</label>
    <span><input id="date" role="combobox" aria-expanded="false" aria-haspopup="dialog" readonly placeholder="Select a date..." aria-labelledby="date-label">
    <span role="button" tabindex="0" aria-expanded="false" aria-labelledby="date" style="display:inline-block;width:20px;height:20px"></span></span>
    <input id="typed" value="Typed by the visitor"><span role="button" tabindex="0" aria-labelledby="typed" style="display:inline-block;width:20px;height:20px"></span></main>`);
  assert.deepEqual(lines(snapshot), [
    'combobox "Select a date" (collapsed) [main]',
    'button "Select a date" (collapsed) [main]',
    "textbox [main]",
    "button [main]",
  ]);
});

/** Selects that show the visitor's choice, the way four toolkits draw them. Nothing on the page names them otherwise. */
const CHOSEN = `<h1>Settings</h1>
<div class="ant-select" style="cursor:pointer;display:inline-block;width:120px"><div class="content" title="Lucy" style="position:relative">Lucy<input role="combobox" readonly aria-expanded="false" aria-haspopup="listbox" style="position:absolute;inset:0;opacity:0"></div></div>
<label id="age-label">Age</label><div role="combobox" tabindex="0" aria-expanded="false" aria-haspopup="listbox" aria-labelledby="age-label age-select" id="age-select">Twenty</div>
<div class="root" style="cursor:pointer;width:200px"><div role="combobox" tabindex="0" aria-haspopup="listbox" aria-expanded="false">Condensed</div><span class="icon" style="display:inline-block;width:16px;height:16px"></span></div>
<button type="button" aria-haspopup="listbox"><img alt="France" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="16" height="16"> Paris</button>`;

test("a select is never named by the choice it shows, and its choice is not sent as words on the page either", { skip }, async () => {
  const snapshot = await read(CHOSEN);
  const sent = JSON.stringify(snapshot);
  for (const choice of ["Lucy", "Twenty", "Condensed", "France", "Paris"]) assert.ok(!sent.includes(choice), `"${choice}" was sent: ${sent}`);
  assert.deepEqual(lines(snapshot), [
    'combobox (collapsed) [Settings › 1 of 2]',
    'combobox "Age" (collapsed) [Settings]',
    'combobox (collapsed) [Settings › 2 of 2]',
    'button (opens a list) [Settings]',
  ]);
});

test("a field is not named by a caption that belongs to another field beside it, nor by a script", { skip }, async () => {
  const snapshot = await read(`<main><h1>Sliders</h1><div id="demo">
    <div style="cursor:pointer;width:200px;height:12px;position:relative"><div style="height:4px"></div><div role="slider" tabindex="0" aria-valuenow="30" style="position:absolute;left:60px;top:0;width:12px;height:12px"></div></div>
    Disabled: <button type="button" role="switch" aria-checked="false" style="width:28px;height:16px"></button>
    <p>Volume: <button type="button" role="switch" aria-checked="true" style="width:28px;height:16px"></button> <span role="slider" tabindex="0" aria-valuenow="5" style="display:inline-block;width:100px;height:12px"></span></p>
  </div><script>window.mirror = function createMirrorModal() { return "SIGN"; };</script></main>`);
  assert.deepEqual(lines(snapshot), [
    // The track a slider's handle runs along says nothing of its own, and is the slider's frame.
    'slider [main › Sliders]',
    'switch "Disabled" [main › Sliders]',
    'switch "Volume" (checked) [main › Sliders]',
    // The words beside it may still tell it from the other slider. They are not its name.
    'slider [main › Sliders › row: Volume:]',
  ]);
});

test("a box the page names itself, around a button that shows only an arrow, is not taken for the button's frame", { skip }, async () => {
  const snapshot = await read(`<nav aria-label="Pages"><ul><li title="Next Page" tabindex="0" style="cursor:pointer;display:inline-block">
    <button type="button" tabindex="-1"><span role="img" aria-label="right" class="anticon anticon-right" style="display:inline-block;width:12px;height:12px"></span></button></li></ul></nav>`);
  assert.ok(lines(snapshot).some((line) => line.startsWith('clickable "Next Page"')), lines(snapshot).join("\n"));
});

test("the same day shown in two months' panels is told apart from other days by its date, and from itself by its place", { skip }, async () => {
  const cell = (date: string) => `<td title="${date}" style="cursor:pointer"><div>${Number(date.slice(-2))}</div></td>`;
  const panel = (rows: string[][]) => `<table><tbody>${rows.map((row) => `<tr>${row.map(cell).join("")}</tr>`).join("")}</tbody></table>`;
  const snapshot = await read(`<h1>Range</h1><div tabindex="0" class="panels">
    ${panel([["2026-12-01", "2026-12-02", "2026-12-03"], ["2027-01-01", "2027-01-02", "2027-01-03"]])}
    ${panel([["2027-01-01", "2027-01-02", "2027-01-03"], ["2027-02-01", "2027-02-02", "2027-02-03"]])}</div>`);
  const ones = lines(snapshot).filter((line) => line.startsWith('clickable "1"'));
  assert.deepEqual(ones, [
    'clickable "1" [Range › row: 2026-12-01]',
    'clickable "1" [Range › row: 2027-01-01 › 1 of 2]',
    'clickable "1" [Range › row: 2027-01-01 › 2 of 2]',
    'clickable "1" [Range › row: 2027-02-01]',
  ]);
});

test("a custom select inside a box that shows the same words is listed once, by its caption, with the box's arrow", { skip }, async () => {
  // OrangeHRM: the box shows the pointer, the box inside it takes the keyboard, and the caption is a label tied to nothing.
  const group = (caption: string, shown: string) => `<div class="group"><div><label>${caption}</label></div>
    <div><div class="wrapper"><div class="select-text" style="cursor:pointer"><div tabindex="0">${shown}</div><div><i class="bi-caret-down-fill" style="display:inline-block;width:12px;height:12px"></i></div></div></div></div></div>`;
  const snapshot = await read(`<form>${group("Employment Status", "-- Select --")}${group("Include", "Current Employees Only")}</form>`);
  assert.deepEqual(lines(snapshot), ['clickable "Employment Status" icon:caret-down-fill [form]', 'clickable "Include" icon:caret-down-fill [form]']);
  assert.ok(!JSON.stringify(snapshot).includes("Current Employees Only"));
});

test("a switch drawn by its label, around a button the size of a pixel, is listed as the switch, and the drawing is not", { skip }, async () => {
  // Carbon's toggle: the label holds the drawing, which shows the pointer, and the switch itself is clipped to nothing.
  const snapshot = await read(`<h1>Settings</h1><div class="toggle">
    <button id="toggle-3" role="switch" type="button" aria-checked="true" aria-labelledby="toggle-3_label" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);padding:0;border:0"></button>
    <label id="toggle-3_label" for="toggle-3"><span>Label</span><div style="cursor:pointer;width:72px;height:24px"><div style="width:48px;height:24px;background:#0f62fe"></div><span aria-hidden="true">On</span></div></label></div>`);
  assert.deepEqual(lines(snapshot), ['switch "Label" (checked) [Settings]']);
});

test("an entry of a tree is named by its own words, not by the entries under it", { skip }, async () => {
  const snapshot = await read(`<ul role="tree" aria-label="Topics">
    <li role="treeitem" aria-expanded="true" tabindex="0"><div>Cloud computing</div>
      <ul role="group"><li role="treeitem" tabindex="-1"><div>Containers</div></li><li role="treeitem" tabindex="-1"><div>Databases</div></li></ul></li>
  </ul>`);
  assert.deepEqual(lines(snapshot), ['treeitem "Cloud computing" (expanded)', 'treeitem "Containers"', 'treeitem "Databases"']);
});

// What cannot be used --------------------------------------------------------------

test("a control inside an entry that cannot be used is listed as disabled, and a menu is not a control of its own", { skip }, async () => {
  const snapshot = await read(`<h1>Actions</h1>
    <ul role="menu" tabindex="0">
      <li role="menuitem" tabindex="-1"><span><a href="https://example.com/first">1st menu item</a></span></li>
      <li role="menuitem" aria-disabled="true"><span><a href="https://example.com/second">2nd menu item</a></span></li>
      <li role="menuitem" tabindex="-1">a danger item</li>
    </ul>
    <ul role="listbox" aria-label="Options">
      <li role="option" aria-disabled="true" aria-label="Option 3"><input type="checkbox" id="o3"><label for="o3">Option 3</label></li>
    </ul>
    <fieldset disabled><legend>Address</legend><input placeholder="Street"></fieldset>`);
  assert.deepEqual(lines(snapshot), [
    // An entry the keyboard moves to is listed beside its link, as it always was. Only the menu around them is not.
    'menuitem "1st menu item" [menu]',
    'link "1st menu item" [menu] → external:example.com',
    'link "2nd menu item" (disabled) [menu] → external:example.com',
    'menuitem "a danger item" [menu]',
    'checkbox "Option 3" (disabled) [list › Options]',
    'textbox "Street" (disabled) [Address]',
  ]);
});

// Twins ----------------------------------------------------------------------------

test("two tick boxes with the same label are not told apart by that label again", { skip }, async () => {
  const snapshot = await read(`<fieldset><legend>Group label</legend>
    <div><input type="checkbox" id="c1"><label for="c1">Checkbox label</label></div>
    <div><input type="checkbox" id="c2"><label for="c2">Checkbox label</label></div></fieldset>`);
  assert.deepEqual(lines(snapshot), ['checkbox "Checkbox label" [Group label › 1 of 2]', 'checkbox "Checkbox label" [Group label › 2 of 2]']);
});

// Dialogs --------------------------------------------------------------------------

test("a notice that says it is not modal is not taken for the open dialog, even with a list open over the page", { skip }, async () => {
  const snapshot = await read(`<main><h1>Select</h1><div role="combobox" aria-expanded="true" aria-label="Age" tabindex="0">Age</div></main>
    <div role="dialog" aria-modal="false" aria-labelledby="cookie-title" style="position:fixed;right:16px;bottom:16px;width:320px;height:180px;background:#fff">
      <h2 id="cookie-title">Cookie preferences</h2><button>Essential only</button><button>Allow all</button></div>
    <div style="position:fixed;inset:0;z-index:10"><div style="position:fixed;inset:0"></div>
      <ul role="listbox" style="position:absolute;left:40px;top:120px;z-index:11;background:#fff;margin:0;padding:0;list-style:none">
        <li role="option" tabindex="-1">Ten</li><li role="option" tabindex="-1">Twenty</li></ul></div>`);
  assert.equal(snapshot.dialog, undefined);
  assert.deepEqual(lines(snapshot), ['option "Ten" [list]', 'option "Twenty" [list]']);
});

test("a dialog that never says whether it is modal, and sits under a layer another list put over the page, is not the open one", { skip }, async () => {
  const snapshot = await read(`<main><h1>Select</h1><div role="combobox" aria-expanded="true" aria-label="Age" tabindex="0">Age</div></main>
    <div role="dialog" aria-labelledby="note-title" style="position:fixed;left:0;right:0;top:0;bottom:0;margin:auto;width:400px;height:200px;background:#fff">
      <h2 id="note-title">A note</h2><button>Close</button></div>
    <div style="position:fixed;inset:0;z-index:10"><div style="position:fixed;inset:0"></div>
      <ul role="listbox" style="position:absolute;left:40px;top:120px;z-index:11;background:#fff;margin:0;padding:0;list-style:none">
        <li role="option" tabindex="-1">Ten</li></ul></div>`);
  assert.equal(snapshot.dialog, undefined);
});
