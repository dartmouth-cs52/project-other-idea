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

// What a visitor typed ---------------------------------------------------------

/** A page of fields and editors that hold a person's own words. */
const RECORDS = `<body style="font:16px sans-serif;padding:40px">
<h1>Records</h1>
<button id="target">Save</button>
<div id="editor" role="textbox" contenteditable="true" style="border:1px solid #999;padding:8px;width:420px">My private draft about the merger with Initech</div>
<div id="bare" contenteditable="true" style="border:1px solid #999;padding:8px;width:420px">Bare editor text: fire Dana on Friday <a href="https://secret.example/plan">the plan for Dana</a></div>
<p><textarea id="area" rows="2" cols="50">Patient note: John Smith has diabetes</textarea></p>
<p><input id="typed" type="text"></p>
<p><input id="prefilled" type="text" value="Prefilled value: 221B Baker Street"></p>
<p><select id="sel"><option>Choice one</option><option selected>Chosen: HIV clinic</option></select></p>
<h2 contenteditable="true">Title typed by the visitor: Layoffs</h2>
<div role="combobox" contenteditable="true" style="border:1px solid #999;width:200px">searching for Okafor</div>
<table>
  <tr><td><div contenteditable="true">Cell note: overdue again</div></td><td><button>Remove</button></td></tr>
  <tr><td><textarea>Second cell note</textarea></td><td><button>Remove</button></td></tr>
</table>
<div role="dialog" aria-labelledby="draft-title" style="border:1px solid #999"><div id="draft-title" contenteditable="true">Untitled: severance letter</div><button>Close</button></div>
</body>`;
/** Nothing here may reach the server, whatever the visitor asks or clicks. */
const TYPED = ["merger with Initech", "fire Dana", "plan for Dana", "secret.example", "John Smith", "Typed by the visitor", "078-05", "Baker Street", "Layoffs", "Okafor", "overdue again", "Second cell note", "severance"];

test("nothing a visitor typed is sent: not as a name, a caption, a row name, a heading, page text or what was clicked", { skip }, async () => {
  const shown = await browser!.widget(RECORDS, (request, index) => {
    const save = request.snapshot.elements.find((element) => element.label === "Save");
    return index === 0 ? { target: save?.id ?? null, status: "continue", say: "Click Save." } : { target: null, status: "done", say: "That is all." };
  });
  try {
    await shown.page.locator("#typed").click();
    await shown.page.keyboard.type("Typed by the visitor: my SSN is 078-05-1120");
    await shown.ask("how do I save");
    // The visitor clicks into an editor, then a link written inside one, instead of the button they were shown.
    await shown.page.locator("#editor").click();
    await shown.waitFor(2);
    for (const body of shown.sent) for (const secret of TYPED) assert.ok(!body.includes(secret), `"${secret}" was sent: ${body.slice(Math.max(0, body.indexOf(secret) - 80), body.indexOf(secret) + 60)}`);
    // The choices of a dropdown are the page's own words and are sent. Nothing says which one is chosen.
    const select = (JSON.parse(shown.sent[0] ?? "{}") as { snapshot: { elements: { role: string; label: string; state?: string[]; options?: string[] }[] } }).snapshot.elements.find((element) => element.role === "select");
    assert.deepEqual(select?.options, ["Choice one", "Chosen: HIV clinic"]);
    assert.equal(select?.label, "");
    assert.equal(select?.state, undefined);
    assert.match(shown.sent[1] ?? "", /The user clicked [^.]*instead of button \\"Save\\"/);
  } finally {
    await shown.close();
  }
});

test("an editor is listed once, by the name its page gives it, and nothing inside it is listed", { skip }, async () => {
  const snapshot = await read(`<h1>Notes</h1>
    <div contenteditable="true" aria-label="Message body">Dear Dana, <a href="/secret">this link</a> <button contenteditable="false">Mention: Priya</button></div>
    <label id="subject-label">Subject</label><div role="textbox" contenteditable="true" aria-labelledby="subject-label">Typed subject</div>
    <div contenteditable="true" data-placeholder="Write a comment">Typed comment</div>
    <div contenteditable="plaintext-only" title="Summary">Typed summary</div>
    <div role="textbox" tabindex="0" aria-label="Formula"><span>=SUM(typed)</span><a href="/typed-link">typed link</a></div>
    <p>Words on the page.</p>`);
  assert.deepEqual(lines(snapshot), [
    'textbox "Message body" [Notes]',
    'textbox "Subject" [Notes]',
    'textbox "Write a comment" [Notes]',
    'textbox "Summary" [Notes]',
    'textbox "Formula" [Notes]',
  ]);
  assert.deepEqual(snapshot.text, ["Subject", "Words on the page."]);
});

test("a dialog whose title is being edited is not named by what was typed there", { skip }, async () => {
  const snapshot = await read(
    `<dialog aria-labelledby="draft-title"><h2 id="draft-title" contenteditable="true">Untitled: severance letter</h2><button>Close</button></dialog>`,
    { before: (page) => page.evaluate(() => document.querySelector("dialog")?.showModal()) },
  );
  assert.equal(snapshot.dialog, "");
  assert.deepEqual(lines(snapshot), ["textbox [dialog]", "button \"Close\" [dialog]"]);
  assert.deepEqual(snapshot.headings, []);
});

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

// Names -----------------------------------------------------------------------

test("a name for screen readers that leaves out the words on the control is given with those words", { skip }, async () => {
  const snapshot = await read(`<main>
    <div role="button" tabindex="0" aria-label="Edit filter with key alertstate"><span>alertstate = firing</span><button aria-label="Remove filter with key alertstate"><svg aria-hidden="true"></svg></button></div>
    <button aria-label="All series selected">A-series</button>
    <button aria-label="All series selected">B-series</button>
    <button aria-label="Time range selected: Last 1 hour">Last 1 hour</button>
    <button aria-label="Close"><svg></svg></button>
    <button aria-label="Next page">›</button>
    <button aria-label="Edit">Edit profile</button>
    <div role="combobox" tabindex="0" aria-label="Type">Component</div>
  </main>`);
  assert.deepEqual(lines(snapshot), [
    'button "alertstate = firing (Edit filter with key alertstate)" [main]',
    'button "Remove filter with key alertstate" [main]',
    'button "A-series (All series selected)" [main]',
    'button "B-series (All series selected)" [main]',
    'button "Time range selected: Last 1 hour" [main]',
    'button "Close" [main]',
    'button "Next page" [main]',
    'button "Edit profile" [main]',
    'combobox "Type" [main]',
  ]);
});

// Telling same-named controls apart --------------------------------------------

/** Dropdowns built from boxes. Each chosen value sits beside a "Remove" button, inside a box that takes clicks. */
const VARIABLES = `<main>${["datacenter:A", "server:All", "pod:All", "zone:Everything here"]
  .map((pair, index) => {
    const [name, value] = pair.split(":");
    return `<div><label for="v${index}">${name}</label><div style="cursor:pointer"><div><div><div>${value}</div>[<button aria-label="Remove"><svg width="12" height="12"></svg></button>]</div><div><input id="v${index}" role="combobox"></div></div></div></div>`;
  })
  .join("")}</main>`;

test("same-named controls with no row around them are named by the words beside each", { skip }, async () => {
  const snapshot = await read(VARIABLES);
  assert.deepEqual(lines(snapshot), [
    'button "Remove" [main › row: A]',
    'combobox "datacenter" [main]',
    // Two of them stand beside "All", so each takes in the next box out, which holds its caption.
    'button "Remove" [main › row: server All]',
    'combobox "server" [main]',
    'button "Remove" [main › row: pod All]',
    'combobox "pod" [main]',
    'button "Remove" [main › row: Everything here]',
    'combobox "zone" [main]',
  ]);
});

test("controls that some heading or address already tells apart are not given the words beside them", { skip }, async () => {
  const snapshot = await read(`<main><h2>History</h2><p>Long ago [<a href="/edit?section=1">edit</a>] things were made by hand.</p>
    <h2>Design</h2><p>Today [<a href="/edit?section=2">edit</a>] they are not.</p>
    <p>See <a href="/a">this</a> and also <a href="/b">this</a>.</p></main>`);
  assert.deepEqual(lines(snapshot), ['link "edit" [main › History] → /edit', 'link "edit" [main › Design] → /edit', 'link "this" [main › Design] → /a', 'link "this" [main › Design] → /b']);
});

test("the words in a box that took clicks, and was then left out as a wrapper, are still sent as page text", { skip }, async () => {
  const snapshot = await read(VARIABLES);
  assert.ok(snapshot.text.includes("Everything here"), JSON.stringify(snapshot.text));
});

test("controls that are still listed the same are numbered, and the number is no part of what identifies one", { skip }, async () => {
  const snapshot = await read(`<form><input placeholder="Please enter"><input placeholder="Please enter"><button>OK</button></form>
    <ul><li>$100.00 <button>Remove</button></li><li>$100.00 <button>Remove</button></li><li>$250.00 <button>Remove</button></li></ul>`);
  assert.deepEqual(lines(snapshot), [
    'textbox "Please enter" [form › 1 of 2]',
    'textbox "Please enter" [form › 2 of 2]',
    'button "OK" [form]',
    'button "Remove" [row: $100.00 › 1 of 2]',
    'button "Remove" [row: $100.00 › 2 of 2]',
    'button "Remove" [row: $250.00]',
  ]);
});
