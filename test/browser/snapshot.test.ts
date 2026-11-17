import assert from "node:assert/strict";
import { after, test } from "node:test";
import { lines, startBrowser } from "./page.ts";

// How the widget reads a page, checked in a real browser. Each test is a small
// page that shows one fault found on a real app, and what the widget has to
// list for it. Run with: npm run test:browser

const started = await startBrowser();
// On CI the browser is installed on purpose, so a missing one is a failure there and not a reason to skip.
if (process.env.CI && typeof started === "string") throw new Error(started);
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

test("a field the browser or the page will not accept is marked invalid, and one that is only empty is not (Northpine: the guide moved on from \"charlie\" in an email field)", { skip }, async () => {
  const snapshot = await read(
    `<form>
      <label>Typed wrong <input id="wrong" type="email"></label>
      <label>Typed right <input id="right" type="email"></label>
      <label>Still empty <input type="email" required></label>
      <label>Said wrong <input type="text" aria-invalid="true"></label>
      <label>Said fine <input type="text" aria-invalid="false"></label>
      <label>Locked wrong <input type="email" value="charlie" disabled></label>
      <button>Send</button>
    </form>`,
    {
      before: async (page) => {
        await page.fill("#wrong", "charlie");
        await page.fill("#right", "charlie@northpine.example");
      },
    },
  );
  const states = Object.fromEntries(snapshot.elements.map((element) => [element.label, element.state ?? []]));
  assert.ok(states["Typed wrong"]?.includes("invalid"), JSON.stringify(states));
  assert.ok(!states["Typed right"]?.includes("invalid"), JSON.stringify(states));
  assert.deepEqual(states["Still empty"], ["required"]);
  assert.ok(states["Said wrong"]?.includes("invalid"), JSON.stringify(states));
  assert.ok(!states["Said fine"]?.includes("invalid"), JSON.stringify(states));
  assert.ok(!states["Locked wrong"]?.includes("invalid"), JSON.stringify(states));
  // Only the mark is sent, never what was typed.
  assert.ok(!JSON.stringify(snapshot).includes("charlie"), "what was typed was sent");
});

test("an email address with no dot in its domain is marked invalid, though the browser takes it (Northpine: the guide pointed at \"Send invite\" after \"theochain@dad\")", { skip }, async () => {
  const typed: Record<string, string> = {
    "#no-dot": "theochain@dad",
    "#short": "theochain@dad.c",
    "#digits": "theochain@dad.123",
    "#whole": "theochain@dad.example",
    "#several": "ana@northpine.example, theochain@dad",
    "#all": "ana@northpine.example, theochain@dad.example",
    "#sign-in": "charlie",
  };
  const snapshot = await read(
    `<form>
      <label>No dot <input id="no-dot" type="email"></label>
      <label>One letter ending <input id="short" type="email"></label>
      <label>Digits ending <input id="digits" type="email"></label>
      <label>Whole <input id="whole" type="email"></label>
      <label>Several, one without a dot <input id="several" type="email" multiple></label>
      <label>Several, all whole <input id="all" type="email" multiple></label>
      <label>Email or user name <input id="sign-in" type="text" autocomplete="email"></label>
      <label>Still empty <input type="email"></label>
      <label>Locked <input type="email" value="theochain@dad" readonly></label>
      <button>Send</button>
    </form>`,
    {
      before: async (page) => {
        for (const [field, value] of Object.entries(typed)) await page.fill(field, value);
      },
    },
  );
  const states = Object.fromEntries(snapshot.elements.map((element) => [element.label, element.state ?? []]));
  for (const label of ["No dot", "One letter ending", "Digits ending", "Several, one without a dot"]) assert.ok(states[label]?.includes("invalid"), `${label}: ${JSON.stringify(states)}`);
  // Only a field typed as email is checked. A text field whose autocomplete says email may take a user name too, as many sign-in forms do.
  for (const label of ["Whole", "Several, all whole", "Email or user name", "Still empty", "Locked"]) assert.ok(!states[label]?.includes("invalid"), `${label}: ${JSON.stringify(states)}`);
  // Only the mark is sent, never what was typed.
  for (const secret of ["theochain", "charlie"]) assert.ok(!JSON.stringify(snapshot).includes(secret), `"${secret}" was sent`);
});

test("a form that marks only its optional fields has the others listed as required (Northpine: the guide called Department optional, and the invite asked for one)", { skip }, async () => {
  const snapshot = await read(
    `<form>
      <label for="email">Email address</label><input id="email" type="email">
      <label for="role">Role</label><select id="role"><option>Admin</option><option selected>Employee</option></select>
      <label for="team">Team</label><select id="team"><option value="">Choose a team</option><option value="t1">Sales</option></select>
      <label for="dept">Department</label><button type="button" id="dept" role="combobox" aria-label="Department" aria-expanded="false">Choose a department</button>
      <label for="seats">Seats</label><input id="seats" type="number">
      <label for="workspace">Workspace</label><input id="workspace" value="northpine" readonly>
      <label for="region">Region</label><input id="region" disabled>
      <label><input type="checkbox"> Send me a copy</label>
      <label for="note">Personal note<span style="margin-left:4px">(optional)</span></label><textarea id="note"></textarea>
      <button>Send invite</button>
    </form>
    <form>
      <label for="name">Name *</label><input id="name">
      <label for="company">Company</label><input id="company">
      <label for="phone">Phone (optional)</label><input id="phone">
      <button>Save contact</button>
    </form>
    <form>
      <label for="city">City</label><input id="city">
      <label><input type="checkbox"> Gift wrap (optional)</label>
      <button>Save address</button>
    </form>`,
  );
  const states = Object.fromEntries(snapshot.elements.map((element) => [element.label, element.state ?? []]));
  assert.deepEqual(states["Email address"], ["required"]);
  assert.deepEqual(states["Department"], ["required", "collapsed"]);
  // A dropdown can be left empty only when it offers an empty choice. One that cannot always has a choice made.
  assert.deepEqual(states["Team"], ["required"]);
  assert.deepEqual(states["Role"], []);
  assert.deepEqual(states["Seats"], ["required"]);
  // What the visitor cannot change is not theirs to fill in, and a tick box is left as the page says.
  assert.deepEqual(states["Workspace"], []);
  assert.deepEqual(states["Region"], ["disabled"]);
  assert.deepEqual(states["Send me a copy"], []);
  assert.deepEqual(states["Personal note(optional)"], []);
  // A form that marks what it requires has said which fields it requires, and the rest are not guessed at.
  assert.deepEqual(states["Name *"], ["required"]);
  assert.deepEqual(states["Company"], []);
  assert.deepEqual(states["Phone (optional)"], []);
  // A tick box marked optional says nothing of the fields around it.
  assert.deepEqual(states["City"], []);
});

test("in a dialog with no form, the fields not marked optional are required, and nothing outside it is (Northpine's invite)", { skip }, async () => {
  const snapshot = await read(
    `<label for="search">Search people</label><input id="search">
    <div role="dialog" aria-modal="true" aria-labelledby="invite-title" style="position:fixed;inset:40px;background:#fff;border:1px solid #999">
      <h2 id="invite-title">Invite people</h2>
      <input type="email" aria-label="Email address 1">
      <label for="dept">Department</label><button type="button" id="dept" role="combobox" aria-label="Department" aria-expanded="false">Choose a department</button>
      <label for="note">Personal note<span>(optional)</span></label><textarea id="note"></textarea>
      <button>Cancel</button><button>Send invite</button>
    </div>`,
  );
  assert.equal(snapshot.dialog, "Invite people");
  const states = Object.fromEntries(snapshot.elements.map((element) => [element.label, element.state ?? []]));
  assert.deepEqual(states["Email address 1"], ["required"]);
  assert.deepEqual(states["Department"], ["required", "collapsed"]);
  assert.deepEqual(states["Personal note(optional)"], []);
});

test("after the visitor types an address with no dot in its domain and pauses, the next step is asked for with the field marked invalid (Northpine's invite)", { skip }, async () => {
  const shown = await browser!.widget(
    `<div role="dialog" aria-modal="true" aria-labelledby="invite-title" style="position:fixed;inset:40px;background:#fff;border:1px solid #999;padding:16px">
      <h2 id="invite-title">Invite people</h2>
      <input id="email" type="email" aria-label="Email address 1" aria-invalid="false">
      <label for="dept">Department</label><button type="button" id="dept" role="combobox" aria-label="Department" aria-expanded="false">Choose a department</button>
      <label for="note">Personal note<span>(optional)</span></label><textarea id="note"></textarea>
      <button>Cancel</button><button>Send invite</button>
    </div>`,
    (request, index) => {
      const email = request.snapshot.elements.find((element) => element.label === "Email address 1");
      return index === 0 ? { target: email?.id ?? null, status: "continue", say: "Type their email address." } : { target: null, status: "done", say: "That is all." };
    },
  );
  try {
    await shown.ask("invite theo");
    await shown.page.locator("#email").click();
    await shown.page.keyboard.type("theochain@dad");
    await shown.waitFor(2);
    const request = JSON.parse(shown.sent[1] ?? "{}") as { event?: string; snapshot: { elements: { label: string; state?: string[] }[] } };
    const states = Object.fromEntries(request.snapshot.elements.map((element) => [element.label, element.state ?? []]));
    assert.match(request.event ?? "", /filled in/);
    assert.deepEqual(states["Email address 1"], ["required", "invalid"]);
    assert.deepEqual(states["Department"], ["required", "collapsed"]);
    for (const body of shown.sent) assert.ok(!body.includes("theochain"), "what was typed was sent");
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
    <tr><td><a href="/activity?id=23344">23344</a></td><td>$40.00</td></tr>
    <tr><td><a href="/activity?id=1334455">1334455</a></td><td>$50.00</td></tr>
  </table>
  <p>Account Number: 13344</p>
  <select aria-label="From account"><option>12345</option><option>13344</option></select>`;

test("a number the visitor named is left as it is, and every other long number stays masked", { skip }, async () => {
  const snapshot = await read(ACCOUNTS, { goal: "Show me the deposits that came into account 13344 in October" });
  const links = snapshot.elements.filter((element) => element.role === "link").map((element) => element.label);
  // 133440 and 1334455 contain it, and 23344 ends the same way. They are other accounts, and stay masked.
  assert.deepEqual(links, ["[number]", "13344", "[number]", "[number]", "[number]"]);
  assert.ok(!JSON.stringify(snapshot).match(/23344|1334455|133440|12345/), JSON.stringify(snapshot));
  assert.ok(snapshot.text.includes("Account Number: 13344"));
  assert.deepEqual(snapshot.elements.find((element) => element.role === "select")?.options, ["[number]", "13344"]);
});

test("with no number in the question every long number is masked", { skip }, async () => {
  const snapshot = await read(ACCOUNTS, { goal: "Show me my deposits" });
  assert.deepEqual(snapshot.elements.filter((element) => element.role === "link").map((element) => element.label), ["[number]", "[number]", "[number]", "[number]", "[number]"]);
  assert.ok(snapshot.text.includes("Account Number: [number]"));
});

test("phone numbers of eight digits are masked wherever the page shows them, and a birth date is left readable", { skip }, async () => {
  // From the review: a Norwegian patient page, where every phone number has eight digits.
  const snapshot = await read(`<h1>Patient Kari Nordmann</h1><p>Mobile 912 34 567, home 22 33 44 55</p><p>Born 1984-03-07</p>
    <table><tr style="cursor:pointer"><td>Ola</td><td>+47 4123 4567</td></tr></table><button>Call 9123 4567</button>`);
  const sent = JSON.stringify(snapshot);
  for (const phone of ["912 34 567", "22 33 44 55", "4123 4567", "9123 4567"]) assert.ok(!sent.includes(phone), `${phone} was sent: ${sent}`);
  assert.ok(snapshot.text.includes("Mobile [number], home [number]"), JSON.stringify(snapshot.text));
  assert.ok(snapshot.elements.some((element) => element.label === "Call [number]"), sent);
  // A date in figures is not masked: "my latest invoice" needs it. The privacy page says so.
  assert.ok(snapshot.text.includes("Born 1984-03-07"), JSON.stringify(snapshot.text));
});

test("numbers written like a date that is not one, and digits glued to a word that run into a number, are masked wherever the page shows them", { skip }, async () => {
  // From the second review: each of these reached the model in /v1/turn.
  const snapshot = await read(`<h1>Account</h1><p>Your account 12.34.5678 and phone 12-34-5678 and ssn SSN123-45-6789</p>
    <p>Card4111 1111 1111 1111, licence D1234-56789-01234</p><button>Galaxy S II I9100 1.249,00 EUR</button><p>Born 07.03.1984</p>`);
  const sent = JSON.stringify(snapshot);
  for (const secret of ["12.34.5678", "12-34-5678", "123-45-6789", "4111", "1234-56789"]) assert.ok(!sent.includes(secret), `${secret} was sent: ${sent}`);
  assert.ok(snapshot.text.includes("Your account [number] and phone [number] and ssn SSN[number]"), JSON.stringify(snapshot.text));
  assert.ok(snapshot.text.includes("Card[number], licence D[number]"), JSON.stringify(snapshot.text));
  assert.ok(snapshot.elements.some((element) => element.label === "Galaxy S II I9100 1.249,00 EUR"), sent);
  assert.ok(snapshot.text.includes("Born 07.03.1984"), JSON.stringify(snapshot.text));
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
    <div role="button" tabindex="0" aria-labelledby="card-title"><b id="card-title">Sales</b><p>Up four percent on the week before.</p></div>
    <div role="button" tabindex="0" aria-label="Open report"><p>Open the report for the week, which is up four percent on the week before.</p></div>
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
    // Named by a part of itself, or by a short form of a long text: the name is the page's own summary.
    'button "Sales" [main]',
    'button "Open report" [main]',
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

// Headings ---------------------------------------------------------------------

test("a heading of any level is a control's surroundings", { skip }, async () => {
  const snapshot = await read(`<main><h2>Applications</h2><h3>Electronic devices</h3><a href="/a">Consoles</a>
    <h4>Mobile devices</h4><a href="/b">Vibration</a>
    <div role="heading" aria-level="5">Tablets</div><a href="/c">Screens</a>
    <h6>Watches</h6><a href="/d">Taps</a></main>`);
  assert.deepEqual(lines(snapshot), [
    'link "Consoles" [main › Electronic devices] → /a',
    'link "Vibration" [main › Mobile devices] → /b',
    'link "Screens" [main › Tablets] → /c',
    'link "Taps" [main › Watches] → /d',
  ]);
  assert.deepEqual(snapshot.headings, ["Applications", "Electronic devices", "Mobile devices", "Tablets", "Watches"]);
});

test("on a long page the headings sent are the ones on screen and the page's main ones, in page order", { skip }, async () => {
  const sections = Array.from({ length: 8 }, (_, s) => `<h2>Part ${s + 1}</h2>` + Array.from({ length: 4 }, (_, d) => `<h3>Detail ${s + 1}.${d + 1}</h3><p style="height:300px">Words.</p>`).join("")).join("");
  const snapshot = await read(`<main><h1>Long page</h1>${sections}</main>`, { before: (page) => page.evaluate(() => document.querySelector("h2:nth-of-type(5)")?.scrollIntoView()) });
  assert.equal(snapshot.headings.length, 12);
  // Part 5 and two details under it are on screen. The title and the other parts are the page's outline, and one place is left over.
  assert.deepEqual(snapshot.headings, ["Long page", "Part 1", "Detail 1.1", "Part 2", "Part 3", "Part 4", "Part 5", "Detail 5.1", "Detail 5.2", "Part 6", "Part 7", "Part 8"]);
});

test("a control inside a box that has its own heading is listed under that heading, and the heading stays with its box", { skip }, async () => {
  const snapshot = await read(`<main><h1>Dashboard</h1>
    <section aria-labelledby="t1" tabindex="0"><div><button aria-label="Menu"></button><div><h2 id="t1">The Basics</h2></div></div><p>Words.</p><button>Explore</button></section>
    <section tabindex="0"><div><button aria-label="Menu"></button><div><h2>Description</h2></div></div><button>Explore</button></section>
    <fieldset><legend>Delivery</legend><label><input type="radio" name="d"> Post</label></fieldset>
    <div role="group" aria-label="Zoom"><button>In</button></div>
    <div><button>Delete</button></div>
    <section><h2>Other things</h2><p>A section that is only words introduces what comes after it.</p></section>
    <button>More</button>
  </main>
  <nav aria-label="Breadcrumb"><a href="/home">Home</a></nav>`);
  assert.deepEqual(lines(snapshot), [
    'clickable "The Basics" [main › Dashboard]',
    'button "Menu" [main › The Basics]',
    'button "Explore" [main › The Basics]',
    'clickable "Description Explore" [main › Dashboard]',
    'button "Menu" [main › Description]',
    'button "Explore" [main › Description]',
    'radio "Post" [main › Delivery]',
    'button "In" [main › Zoom]',
    'button "Delete" [main › Dashboard]',
    'button "More" [main › Other things]',
    'link "Home" [nav › Breadcrumb] → /home',
  ]);
});

// Shown only while the mouse is over a box ---------------------------------------

const HOVER_STYLES = `
  .panel { position: relative; width: 400px; height: 120px; border: 1px solid #ccc; }
  .panel .menu, .panel .tools { visibility: hidden; opacity: 0; }
  .panel:focus-visible .menu, .panel:hover .menu { visibility: visible; opacity: 1; }
  .panel:focus-within:not(:focus) .tools { visibility: visible; opacity: 1; }
  .nav li { position: relative; display: inline-block; }
  .nav li ul { visibility: hidden; position: absolute; top: 40px; left: 0; }
  .nav li:hover ul { visibility: visible; }
  .gone { visibility: hidden; }
  .trigger:hover + .tip button { visibility: visible; }
  .tip button { visibility: hidden; }
  .card { width: 300px; height: 60px; }
  .card .fade { opacity: 0; }
  .card:hover .fade { opacity: 1; }
  .card .half { visibility: hidden; opacity: 0; }
  .card:hover .half { visibility: visible; }`;
const HOVER_PAGE = `<main>
    <section class="panel"><h2>Simple graph</h2><button class="menu" aria-label="Menu for panel Simple graph">⋮</button>
      <div class="tools"><button>Zoom</button><p>Words in a hidden box are not page text.</p></div></section>
    <ul class="nav"><li><a href="/products">Products</a><ul><li><a href="/products/secret">Entry of a closed menu</a></li></ul></li></ul>
    <button class="gone">Never shown</button>
    <span class="trigger">What is this?</span><span class="tip"><button>Shown beside, not inside</button></span>
    <div class="card"><button class="fade">Pin</button><button class="half">Still see-through when shown</button></div>
  </main>`;
const HOVER_LINES = [
  'button "Menu for panel Simple graph" (shows on hover) [main › Simple graph]',
  'button "Zoom" (shows on hover) [main › Simple graph]',
  'link "Products" [main] → /products',
  'button "Pin" (shows on hover) [main]',
];

test("a control hidden until the mouse is over the box around it is listed, and says so", { skip }, async () => {
  const snapshot = await read(`<style>${HOVER_STYLES}</style>${HOVER_PAGE}`);
  assert.deepEqual(lines(snapshot), HOVER_LINES);
  assert.ok(!snapshot.text.some((text) => text.includes("hidden box")), JSON.stringify(snapshot.text));
});

test("the rule that shows it can be in a linked stylesheet, and a stylesheet that cannot be read is passed over", { skip }, async () => {
  const snapshot = await read(`<link rel="stylesheet" href="https://elsewhere.test/theirs.css"><link rel="stylesheet" href="/ours.css">${HOVER_PAGE}`, {
    styles: { "/ours.css": HOVER_STYLES, "https://elsewhere.test/theirs.css": ".panel:hover .gone { visibility: visible; }" },
  });
  assert.deepEqual(lines(snapshot), HOVER_LINES);
});

test("a row's action that a see-through box around it hides until the mouse is over the row says so, in the way Tailwind 4 writes it", { skip }, async () => {
  // Tailwind 4 writes `group-hover/row:opacity-100` as `:is(:where(.group\/row):hover .x)`, inside `@media (hover: hover)`
  // and a layer. Dashboards fade in the cell that holds a row's actions, not each button in it.
  const styles = `@layer utilities {
    .opacity-0 { opacity: 0 }
    .focus-within\\:opacity-100:focus-within { opacity: 1 }
    @media (hover: hover) { :is(:where(.group\\/row):hover .group-hover\\/row\\:opacity-100) { opacity: 1 } }
  }
  .row { position: relative; display: flex; width: 600px; height: 36px; align-items: center }
  .actions { position: absolute; right: 0; top: 0; bottom: 0; display: flex; gap: 4px }
  .old .tools { opacity: 0 } .old:hover .tools { opacity: 1 }
  .self { opacity: 0 } .self:hover { opacity: 1 }
  .keys { opacity: 0 } .keys:focus-within { opacity: 1 }`;
  const snapshot = await read(`<style>${styles}</style><main><h1>Bills</h1>
    <div class="group/row"><div role="row" class="row"><span role="cell">Linden Logistics, due Friday</span>
      <div role="cell" class="actions opacity-0 group-hover/row:opacity-100 focus-within:opacity-100"><button>Pay</button><button aria-label="More"></button></div></div></div>
    <div class="old" style="width:400px"><span>Quarterly plan</span><span class="tools"><span><button>Pin</button></span></span></div>
    <div class="self"><button>Zoom</button></div>
    <div class="keys"><button>Shown only to the keyboard</button></div>
  </main>`);
  assert.deepEqual(lines(snapshot), [
    'button "Pay" (shows on hover) [main › Bills]',
    'button "More" (shows on hover) [main › Bills]',
    'button "Pin" (shows on hover) [main › Bills]',
    'button "Zoom" (shows on hover) [main › Bills]',
    // The keyboard inside it shows it, and the mouse never does: it is listed as the page has it, with nothing said.
    'button "Shown only to the keyboard" [main › Bills]',
  ]);
});

test("every row of a long table says its actions show on hover, not only the first rows", { skip }, async () => {
  const styles = `.row { position: relative; display: flex; width: 600px; height: 28px } .actions { position: absolute; right: 0; top: 0; opacity: 0 }
    :is(:where(.group):hover .group-hover\\:opacity-100) { opacity: 1 }`;
  const rows = Array.from({ length: 150 }, (_, i) => `<div class="group"><div role="row" class="row"><span>Bill ${i + 1}</span><div class="actions group-hover:opacity-100"><button>Pay</button><button>Hold</button></div></div></div>`);
  const snapshot = await read(`<style>${styles}</style><main><h1>Bills</h1>${rows.join("")}</main>`);
  const actions = snapshot.elements.filter((element) => element.label === "Pay" || element.label === "Hold");
  assert.ok(actions.length >= 250, `only ${actions.length} listed`);
  assert.deepEqual(actions.filter((element) => !element.state?.includes("shows on hover")).map((element) => element.label), []);
});

// What is on top ---------------------------------------------------------------

test("a list opened from a dialog is still listed when Haptic's own caption sits over it", { skip }, async () => {
  const snapshot = await read(`<button>Behind the dialog</button>
    <div style="position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.4);z-index:5"></div>
    <div role="dialog" aria-modal="true" aria-label="New rule" style="position:fixed;left:100px;top:100px;width:400px;height:300px;background:#fff;z-index:10">
      <div role="combobox" tabindex="0" aria-label="Type">Pick one</div><button>OK</button>
    </div>
    <div style="position:fixed;left:120px;top:160px;width:200px;z-index:20;background:#eee">
      <div role="option" style="height:30px">Daily</div><div role="option" style="height:30px">Weekly</div>
    </div>
    <haptic-root style="position:fixed;left:110px;top:150px;width:260px;height:50px;z-index:2147483647"></haptic-root>`);
  assert.equal(snapshot.dialog, "New rule");
  assert.deepEqual(lines(snapshot), ['combobox "Type" [dialog]', 'button "OK" [dialog]', 'option "Daily"', 'option "Weekly"']);
});

// Boxes around boxes -------------------------------------------------------------

test("a clickable panel stays listed when the clickable inside it says something else", { skip }, async () => {
  const snapshot = await read(`<main>
    <section tabindex="0" aria-labelledby="t2"><h2 id="t2">Simple graph</h2><div tabindex="0" style="width:300px;height:80px"></div><div tabindex="0">A-series B-series</div></section>
    <div tabindex="0" style="cursor:pointer"><span tabindex="0">Open the weekly report</span></div>
  </main>`);
  assert.deepEqual(lines(snapshot), [
    'clickable "Simple graph" [main]',
    'clickable "part of Simple graph" [main › Simple graph]',
    'clickable "A-series B-series" [main › Simple graph]',
    // A box that says what the box inside it says is only its wrapper.
    'clickable "Open the weekly report" [main]',
  ]);
});

// Captions guessed from the words beside a field --------------------------------

test("a field is named by the nearest words before it, never by another field or what lies beyond one", { skip }, async () => {
  const snapshot = await read(`<form>
    <p><b>Amount:</b> $<input id="amount"></p>
    <div>From account #<select><option>12345</option></select> to account #<select><option>13344</option></select></div>
    <table><tr><td>Find by Date:</td><td><input></td></tr><tr><td>Between</td><td><input> and <input></td></tr></table>
    <h2>Notes</h2><div role="textbox" contenteditable="true">Typed words</div>
  </form>`);
  assert.deepEqual(lines(snapshot), [
    'textbox "Amount" [form]',
    'select "From account #" [form] choices: [number]',
    'select "to account #" [form] choices: [number]',
    'textbox "Find by Date" [form]',
    'textbox "Between" [form]',
    'textbox "and" [form]',
    // A heading is the name of the part of the page, not of the field under it.
    'textbox [form › Notes]',
  ]);
});

// Required fields -----------------------------------------------------------------

test("a field the page requires says so, however the page marks it", { skip }, async () => {
  const snapshot = await read(`<style>.star::before { content: "*"; color: red; }</style><form>
    <label for="n">Name</label><input id="n" required>
    <label for="e">Email *</label><input id="e">
    <label for="p" class="star">Phone</label><input id="p">
    <div role="radiogroup" aria-labelledby="mode"><span id="mode">Mode<span aria-hidden="true">(Required)</span></span>
      <label><input type="radio" name="m"> Light</label><label><input type="radio" name="m"> Dark</label></div>
    <div role="group" data-required="true" aria-label="Topics"><label><input type="checkbox"> One</label></div>
    <fieldset><legend>Size *</legend><label><input type="radio" name="s"> Small</label></fieldset>
    <fieldset><legend>Extras</legend><label><input type="checkbox"> Gift wrap</label></fieldset>
    <label for="o">Comment (not required)</label><textarea id="o">Typed: a star at the end *</textarea>
    <label>Typed in a field inside its label <textarea>(Required)</textarea></label>
  </form>`);
  assert.deepEqual(lines(snapshot), [
    'textbox "Name" (required) [form]',
    'textbox "Email *" (required) [form]',
    'textbox "Phone" (required) [form]',
    'radio "Light" (required) [form › Mode]',
    'radio "Dark" (required) [form › Mode]',
    'checkbox "One" (required) [form › Topics]',
    'radio "Small" (required) [form › Size *]',
    'checkbox "Gift wrap" [form › Extras]',
    'textbox "Comment (not required)" [form]',
    'textbox "Typed in a field inside its label" [form]',
  ]);
});

// Page text ------------------------------------------------------------------------

test("a sentence is sent whole, with the words styled or linked within it", { skip }, async () => {
  const snapshot = await read(`<main>
    <p><b>Haptic technology</b> (also <i>kinaesthetic communication</i> or <a href="/3d">3D touch</a>) is technology that can create an experience of <a href="/touch">touch</a>.<sup><a href="#n1"><span>[</span>1<span>]</span></a></sup></p>
    <p><a href="/only">A paragraph that is only a link</a></p>
    <p>Fill in <input value="Typed: Sam Smith"> and <span contenteditable="true">Typed: a note</span> before you go.</p>
    <div><span class="count">+1</span></div>
  </main>`);
  assert.deepEqual(snapshot.text, [
    "Haptic technology (also kinaesthetic communication or 3D touch) is technology that can create an experience of touch.[1]",
    "Fill in and before you go.",
    "+1",
  ]);
});

test("a table row is one line, with its short cells and its repeats", { skip }, async () => {
  const snapshot = await read(`<table>
    <tr><th>Product</th><th>Qty</th><th>Price</th></tr>
    <tr><td>Hammer</td><td>2</td><td>$14.50</td></tr>
    <tr><td>Saw</td><td>2</td><td>$14.50</td></tr>
    <tr><td>Drill <button>Remove</button></td><td>1</td><td><input value="Typed: 99"></td></tr>
  </table>`);
  assert.deepEqual(snapshot.text, ["Product | Qty | Price", "Hammer | 2 | $14.50", "Saw | 2 | $14.50", "Drill | 1 |"]);
});

test("on a long page, the text sent is what is on screen, then what is near the control last used", { skip }, async () => {
  const paragraphs = Array.from({ length: 120 }, (_, i) => `<p style="height:120px">Paragraph ${i + 1} ${"of the article goes on for a while. ".repeat(3)}</p>`).join("");
  const snapshot = await read(`<main>${paragraphs}<button id="used">Used</button><p>Right after the control that was used, ${"and it goes on for a while too. ".repeat(3)}</p></main>`, {
    before: (page) => page.evaluate(() => {
      const host = document.createElement("haptic-root");
      (host as Element & { pointedAt?: Element }).pointedAt = document.getElementById("used")!;
      document.body.append(host);
    }),
  });
  assert.ok(snapshot.text[0]?.startsWith("Paragraph 1 "), JSON.stringify(snapshot.text.map((t) => t.slice(0, 14))));
  assert.ok(snapshot.text.some((text) => text.startsWith("Right after the control")), JSON.stringify(snapshot.text.map((text) => text.slice(0, 14))));
  assert.ok(!snapshot.text.some((text) => text.startsWith("Paragraph 60 ")));
});

// Row names --------------------------------------------------------------------------

test("a row is named by what it alone says: not by what every row says, a bare number or a neighbour's words", { skip }, async () => {
  const snapshot = await read(`<main><ul>
    <li>(<a href="/d?x=cur">cur</a> | <a href="/d?x=prev">prev</a>) <a href="/r/1">19:55, 20 September 2026</a> <a href="/u/Ann">Ann</a> (<a href="/t/Ann">talk</a>) <b>+875</b></li>
    <li>(<a href="/d?x=cur">cur</a> | <a href="/d?x=prev">prev</a>) <a href="/r/2">10:02, 18 September 2026</a> <a href="/u/Bob">Bob</a> (<a href="/t/Bob">talk</a>) <b>-12</b></li>
  </ul>
  <table>
    <tr><td>INV-2026000007</td><td>2026-11-15 17:14:15</td><td>Hallie Wall</td><td><a href="/invoice/7">Details</a></td></tr>
    <tr><td>INV-2026000008</td><td>2026-11-16 09:01:00</td><td>Hallie Wall</td><td><a href="/invoice/8">Details</a></td></tr>
  </table></main>`);
  const named = (label: string) => lines(snapshot).filter((text) => text.startsWith(`link "${label}"`));
  assert.deepEqual(named("talk"), ['link "talk" [main › row: 19:55, 20 September 2026] → /t/Ann', 'link "talk" [main › row: 10:02, 18 September 2026] → /t/Bob']);
  assert.deepEqual(named("cur"), ['link "cur" [main › row: 19:55, 20 September 2026] → /d?x=cur', 'link "cur" [main › row: 10:02, 18 September 2026] → /d?x=cur']);
  assert.deepEqual(named("Details"), ['link "Details" [main › row: 2026-11-15 17:14:15] → /invoice/:id', 'link "Details" [main › row: 2026-11-16 09:01:00] → /invoice/:id']);
});

test("an entry of a numbered list is named with its number, and a box that does not repeat is no row", { skip }, async () => {
  const snapshot = await read(`<main>
    <ol><li>Mobile devices <a href="/edit?n=1">edit</a></li><li>Video games <a href="/edit?n=2">edit</a></li></ol>
    <article><span class="subtitle">Personal</span>
      <div><label>Owner</label><div><input role="combobox"><button aria-label="Open"></button></div></div>
      <div><label>Lifecycle</label><div><input role="combobox"><button aria-label="Open"></button></div></div>
    </article>
    <table><tr><th><button>Name</button></th><th><button>System</button></th></tr><tr><td>Backstage API</td><td>backstage</td></tr><tr><th><button>Name</button></th><th><button>System</button></th></tr></table>
  </main>`);
  assert.deepEqual(lines(snapshot), [
    'link "edit" [main › row: 1. Mobile devices] → /edit',
    'link "edit" [main › row: 2. Video games] → /edit',
    'combobox "Owner" [main]',
    'button "Open" [main › row: Owner]',
    'combobox "Lifecycle" [main]',
    'button "Open" [main › row: Lifecycle]',
    'button "Name" [main › 1 of 2]',
    'button "System" [main › 1 of 2]',
    'button "Name" [main › 2 of 2]',
    'button "System" [main › 2 of 2]',
  ]);
});

test("words out of sight, meant for screen readers, are left out of what a control and its row are called", { skip }, async () => {
  const hidden = "position:absolute;clip:rect(1px,1px,1px,1px);font-size:0";
  const snapshot = await read(`<main><ul>
    <li><a href="/p/1">Astro Laptop <span style="${hidden}">Emphasized</span> 989,00 EUR</a> <span>Available</span> <button>Compare</button></li>
    <li><a href="/p/2">Benda Laptop <span style="${hidden}">Emphasized</span> 976,00 EUR</a> <span>Out of stock</span> <button>Compare</button></li>
  </ul>
  <button><svg width="10" height="10"></svg><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Close</span></button>
  <ul><li tabindex="0" aria-labelledby="say1"><span id="say1" style="${hidden}">Notebook Basic 15 Emphasized 956,00 EUR Object Status Out of stock</span>Notebook Basic 15 956,00 EUR Out of stock <button>Compare</button></li>
    <li tabindex="0" aria-labelledby="say2"><span id="say2" style="${hidden}">Notebook Basic 17 Emphasized 1.249,00 EUR Object Status Available</span>Notebook Basic 17 1.249,00 EUR Available <button>Compare</button></li></ul></main>`);
  assert.deepEqual(lines(snapshot), [
    'link "Astro Laptop 989,00 EUR" [main] → /p/:id',
    'button "Compare" [main › row: Astro Laptop]',
    'link "Benda Laptop 976,00 EUR" [main] → /p/:id',
    'button "Compare" [main › row: Benda Laptop]',
    // A name that only screen readers get is still the control's name when it shows none.
    'button "Close" [main]',
    // A row's own name is for screen readers. The row is called by what it shows, cut at a word.
    'clickable "Notebook Basic 15 Emphasized 956,00 EUR Object Status Out of stock" [main]',
    'button "Compare" [main › row: Notebook Basic 15 956,00 EUR Out of…]',
    'clickable "Notebook Basic 17 Emphasized 1.249,00 EUR Object Status Available" [main]',
    'button "Compare" [main › row: Notebook Basic 17 1.249,00 EUR…]',
  ]);
});

// What counts as a control with a box ---------------------------------------------------

test("a control hidden from screen readers but there for the mouse is listed, and a box of no size is not", { skip }, async () => {
  const snapshot = await read(`<form>
    <input aria-label="Search"><div aria-hidden="true" style="display:inline-block;cursor:pointer;width:32px;height:26px;background:#ccc"></div>
    <button><span aria-hidden="true" style="cursor:pointer;display:inline-block;width:16px;height:16px"></span>Go</button>
    <span style="cursor:pointer"><span aria-hidden="true" style="display:inline-block;width:16px;height:16px"></span></span>
    <div style="position:relative;width:40px;height:40px"><div aria-hidden="true" style="cursor:pointer;width:30px;height:30px"></div><div style="position:absolute;inset:0;background:#fff"></div></div>
    <div tabindex="0" style="height:0;overflow:hidden">Nothing to see</div>
    <button style="position:absolute;width:1px;height:1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0)">For screen readers</button>
    <label><input type="checkbox" style="position:absolute;opacity:0;width:1px;height:1px"> Remember me</label>
  </form>`);
  // The glass, then the box whose own pointer cursor the hidden icon inside it shows. The icon itself, and the one under a cover, are not listed.
  assert.deepEqual(lines(snapshot), ['textbox "Search" [form]', "clickable [form › 1 of 2]", 'button "Go" [form]', "clickable [form › 2 of 2]", 'checkbox "Remember me" [form]']);
});

test("with a list open over a layer that covers the window, what lies under the layer is not listed", { skip }, async () => {
  const snapshot = await read(`<button>Under the layer</button><input id="field" aria-label="Pick a letter">
    <div><div style="position:fixed;inset:0;z-index:5"></div>
      <div role="listbox" style="position:relative;z-index:6;width:200px;height:64px;overflow:auto;background:#fff">
        <div role="option" style="height:30px">A</div><div role="option" style="height:30px">B</div><div role="option" style="height:30px">C, scrolled out of the list</div>
      </div>
    </div>`, { before: (page) => page.focus("#field") });
  // The field the list belongs to has the keyboard, and is typed in to narrow the list.
  assert.deepEqual(lines(snapshot), ['textbox "Pick a letter"', 'option "A" [list]', 'option "B" [list]', 'option "C, scrolled out of the list" [list]']);
});

// Names taken from the right place ---------------------------------------------------------

test("a dialog is not named by a button in its title bar, and a select is named by its box, not by its choice or its tags", { skip }, async () => {
  const snapshot = await read(`<div role="dialog" aria-modal="true" style="position:fixed;inset:40px;background:#fff">
      <h2><input aria-label="Search"><button>Clear</button></h2>
      <h3>Results</h3><button>View Full Results</button>
      <div aria-label="Type"><div role="button" tabindex="0" aria-haspopup="listbox">all</div></div>
      <div><div>Owner</div><div><div><div><span>Sam Smith</span><span style="cursor:pointer">x</span></div><div><input role="combobox"></div></div></div></div>
      <section aria-label="Sales chart"><div tabindex="0" style="width:200px;height:60px"></div></section>
    </div>`);
  assert.equal(snapshot.dialog, "Results");
  assert.deepEqual(lines(snapshot), [
    'textbox "Search" [dialog]',
    'button "Clear" [dialog]',
    'button "View Full Results" [dialog › Results]',
    'button "Type" (opens a list) [dialog › Results]',
    'clickable "x" [dialog › Results]',
    'combobox "Owner" [dialog › Results]',
    'clickable "part of Sales chart" [dialog › Sales chart]',
  ]);
});

// Options in a list a combobox opened ----------------------------------------------------

/** One of cmdk's options, as cmdk 1.x draws it: what it says of being selected is that the keys are on it. */
const cmdkItem = (id: string, name: string, hint: string, on: boolean) =>
  `<div cmdk-item="" id="${id}" role="option" aria-disabled="false" aria-selected="${on}" data-disabled="false" data-selected="${on}" style="display:flex;gap:8px"><svg width="14" height="14" style="opacity:0"><path d="M2 7l3 3 7-7"/></svg><span>${name}</span><span>${hint}</span></div>`;

/** Northpine's Owner field on /budgets/new, opened: a Radix popover with cmdk in it. The field still shows its placeholder. */
const OWNER = `<main><h1>New budget</h1><form>
  <label for="owner">Owner</label>
  <button type="button" id="owner" role="combobox" aria-haspopup="dialog" aria-expanded="true" aria-controls="radix-r1" data-state="open"><span>Choose a person</span></button>
</form></main>
<div id="radix-r1" role="dialog" data-state="open" style="position:absolute;top:120px;left:20px;width:280px;background:#fff">
  <div cmdk-root="" tabindex="-1">
    <label cmdk-label="" for="cmdk-input" id="cmdk-label" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)"></label>
    <input cmdk-input="" id="cmdk-input" role="combobox" type="text" placeholder="Search…" aria-autocomplete="list" aria-expanded="true" aria-controls="cmdk-list" aria-labelledby="cmdk-label" aria-activedescendant="cmdk-item-1">
    <div cmdk-list="" id="cmdk-list" role="listbox" tabindex="-1" aria-label="Suggestions"><div cmdk-list-sizer=""><div cmdk-group="" role="presentation"><div cmdk-group-items="" role="group">
      ${cmdkItem("cmdk-item-1", "Avery Stone", "Controller", true)}
      ${cmdkItem("cmdk-item-2", "Blake Ito", "Analyst", false)}
    </div></div></div></div>
  </div>
</div>`;

test("an option cmdk highlights is not said to be selected (Northpine: \"Avery Stone is already selected as Owner\" while Owner showed \"Choose a person\")", { skip }, async () => {
  assert.deepEqual(lines(await read(OWNER)), [
    'combobox "Owner" (expanded) [form]',
    'combobox "Search…" (expanded)',
    'option "Avery Stone Controller" [list › Suggestions]',
    'option "Blake Ito Analyst" [list › Suggestions]',
  ]);
  // A command menu of its own, opened by no field: cmdk is all there is to go by.
  const palette = await read(`<div cmdk-root="">
    <input cmdk-input="" role="combobox" aria-expanded="true" aria-controls="palette" aria-activedescendant="go-budgets" placeholder="Type a command…">
    <div cmdk-list="" id="palette" role="listbox" aria-label="Suggestions">${cmdkItem("go-budgets", "Go to", "Budgets", true)}${cmdkItem("go-bills", "Go to", "Bills", false)}</div>
  </div>`);
  assert.deepEqual(lines(palette), ['combobox "Type a command…" (expanded)', 'option "Go to Budgets" [list › Suggestions]', 'option "Go to Bills" [list › Suggestions]']);
});

test("an option a combobox's list says is selected is not the chosen one when the combobox shows other words", { skip }, async () => {
  // As the ARIA practices' combobox examples do it: aria-selected goes with aria-activedescendant, the option the keys are on.
  // The class name that marks the same option does not make it the current one either.
  const snapshot = await read(`<label id="owner-label">Owner</label>
    <div role="combobox" tabindex="0" aria-labelledby="owner-label" aria-expanded="true" aria-controls="people" aria-activedescendant="p1">Choose a person</div>
    <ul role="listbox" id="people" aria-labelledby="owner-label"><li role="option" id="p1" class="option option-current" aria-selected="true">Avery Stone</li><li role="option" id="p2" class="option" aria-selected="false">Blake Ito</li></ul>`);
  assert.deepEqual(lines(snapshot), ['combobox "Owner" (expanded)', 'option "Avery Stone" [list › Owner]', 'option "Blake Ito" [list › Owner]']);
});

test("an option that is chosen is still selected: one its combobox shows, one of several chosen, one in a list of its own, a tab and a grid's cell", { skip }, async () => {
  const snapshot = await read(`<div style="display:flex;gap:40px">
    <div><button type="button" role="combobox" aria-label="Approver" aria-expanded="true" aria-controls="approvers"><span>Avery Stone</span></button>
      <div role="listbox" id="approvers"><div role="option" aria-selected="true" style="display:flex;gap:8px"><span>Avery Stone</span><small>Controller</small></div><div role="option" aria-selected="false" style="display:flex;gap:8px"><span>Blake Ito</span><small>Analyst</small></div></div></div>
    <div><button type="button" role="combobox" aria-label="Tags" aria-expanded="true" aria-controls="tags">Add tags</button>
      <div role="listbox" id="tags" aria-multiselectable="true"><div role="option" aria-selected="true">Travel</div><div role="option" aria-selected="true">Meals</div><div role="option" aria-selected="false">Software</div></div></div>
    <div role="listbox" aria-label="Currency" tabindex="0" aria-activedescendant="eur"><div role="option" id="usd" aria-selected="false">USD</div><div role="option" id="eur" aria-selected="true">EUR</div></div>
    <div role="tablist" aria-label="Budget"><button role="tab" aria-selected="true">Overview</button><button role="tab" aria-selected="false">History</button></div>
    <div role="grid" aria-label="March"><div role="row"><div role="gridcell" tabindex="0" aria-selected="true">14</div><div role="gridcell" tabindex="-1" aria-selected="false">15</div></div></div>
  </div>`);
  assert.deepEqual(lines(snapshot), [
    'combobox "Approver" (expanded)',
    // The option says more than the combobox shows of it.
    'option "Avery Stone Controller" (selected) [list]',
    'option "Blake Ito Analyst" [list]',
    'combobox "Tags" (expanded)',
    'option "Travel" (selected) [list]',
    'option "Meals" (selected) [list]',
    'option "Software" [list]',
    'option "USD" [list › Currency]',
    'option "EUR" (selected) [list › Currency]',
    'tab "Overview" (selected) [tabs › Budget]',
    'tab "History" [tabs › Budget]',
    'clickable "14" (selected)',
  ]);
});

// What changed ---------------------------------------------------------------------------

test("scrolling a long page alone changes no control, though it changes which are listed", { skip }, async () => {
  const links = Array.from({ length: 450 }, (_, i) => `<p><a href="/page/${i}">Link number ${i + 1}</a></p>`).join("");
  const change = async (between: (page: { evaluate: (script: string) => Promise<unknown> }) => Promise<unknown>) =>
    browser!.change(`<main>${links}<button id="more" onclick="this.insertAdjacentHTML('afterend', '<button>Added</button>')">More</button></main>`, async (page) => void (await between(page)));
  assert.equal(await change((page) => page.evaluate("window.scrollTo(0, document.body.scrollHeight)")), "Nothing visible on the page changed.");
  assert.match(await change((page) => page.evaluate("window.scrollTo(0, document.body.scrollHeight); document.getElementById('more').click()")), /^New: button "Added"\.$/m);
});

test("scrolling a page with more headings than are sent brings in no new text", { skip }, async () => {
  // Only twelve headings are sent, the ones on screen first, so a scroll changes which.
  const parts = Array.from({ length: 40 }, (_, i) => `<h3>Part ${i + 1}</h3><p>Words of part ${i + 1} that make a sentence.</p><div style="height:300px"></div>`).join("");
  const change = await browser!.change(`<main>${parts}</main>`, async (page) => void (await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")));
  assert.equal(change, "Nothing visible on the page changed.");
});

// Forms built from boxes, with captions in labels tied to nothing (OrangeHRM) --------------------------

/** OrangeHRM's markup: captions in <label>s tied to no field, custom selects, date fields, chips, sortable headings, a pager and a dialog. */
const BOXES = `<style>
  .oxd-label.required::after { content: " *"; }
  .oxd-select-text, .oxd-icon, .oxd-pagination-page-item, .sort-item { cursor: pointer; }
  .oxd-table-header-sort-dropdown { display: none; }
  .oxd-icon { display: inline-block; width: 12px; height: 12px; }
</style>
<form class="oxd-form">
  <div class="oxd-input-group"><div class="oxd-input-group__label-wrapper"><label class="oxd-label">Employee Name</label></div>
    <div><div class="oxd-autocomplete-wrapper"><div class="oxd-autocomplete-text-input"><input placeholder="Type for hints..."></div></div></div></div>
  <div class="oxd-input-group"><div class="oxd-input-group__label-wrapper"><label class="oxd-label">Job Title</label></div>
    <div><div class="oxd-select-wrapper"><div tabindex="0" class="oxd-select-text oxd-select-text--active"><div class="oxd-select-text-input">-- Select --</div><div class="oxd-select-text--after"><i class="oxd-icon bi-caret-down-fill"></i></div></div></div></div></div>
  <div class="oxd-input-group"><div class="oxd-input-group__label-wrapper"><label class="oxd-label">Vacancy</label></div>
    <div><div class="oxd-select-wrapper"><div tabindex="0" class="oxd-select-text oxd-select-text--active"><div class="oxd-select-text-input">-- Select --</div><div class="oxd-select-text--after"><i class="oxd-icon bi-caret-down-fill"></i></div></div></div></div></div>
  <div class="oxd-input-group"><div class="oxd-input-group__label-wrapper"><label class="oxd-label required">From Date</label></div>
    <div><div class="oxd-date-wrapper"><div class="oxd-date-input"><input placeholder="yyyy-dd-mm"><i class="oxd-icon bi-calendar"></i></div></div></div></div>
  <div class="oxd-input-group"><div class="oxd-input-group__label-wrapper"><label class="oxd-label">To Date</label></div>
    <div><div class="oxd-date-wrapper"><div class="oxd-date-input"><input placeholder="yyyy-dd-mm"><i class="oxd-icon bi-calendar"></i></div></div></div></div>
  <div class="oxd-multiselect-chips-area"><span class="oxd-chip">Pending Approval<i class="oxd-icon bi-x --clear"></i></span><span class="oxd-chip">Scheduled<i class="oxd-icon bi-x --clear"></i></span></div>
</form>
<div role="table"><div role="rowgroup"><div role="row">
  <div role="columnheader"><div class="oxd-checkbox-wrapper"><label><input type="checkbox"><span class="oxd-checkbox-input"></span></label></div></div>
  <div role="columnheader">Id<div class="oxd-table-header-sort"><i class="oxd-icon bi-arrow-down-up"></i><div role="dropdown" class="oxd-table-header-sort-dropdown"><ul><li class="sort-item"><span>Ascending</span></li><li class="sort-item"><span>Descending</span></li></ul></div></div></div>
  <div role="columnheader">Last Name<div class="oxd-table-header-sort"><i class="oxd-icon bi-arrow-down-up"></i><div role="dropdown" class="oxd-table-header-sort-dropdown"><ul><li class="sort-item"><span>Ascending</span></li><li class="sort-item"><span>Descending</span></li></ul></div></div></div>
</div></div></div>
<nav aria-label="Pagination Navigation"><ul class="oxd-pagination__ul">
  <li class="oxd-pagination-page-item"><button type="button" class="oxd-pagination-page-item oxd-pagination-page-item--page oxd-pagination-page-item--page-selected">1</button></li>
  <li class="oxd-pagination-page-item"><button type="button" class="oxd-pagination-page-item oxd-pagination-page-item--page">2</button></li>
  <li class="oxd-pagination-page-item"><button type="button" class="oxd-pagination-page-item oxd-pagination-page-item--page">3</button></li>
  <li class="oxd-pagination-page-item"><button type="button" class="oxd-pagination-page-item oxd-pagination-page-item--previous-next"><i class="oxd-icon bi-chevron-right"></i></button></li>
</ul></nav>
<div role="dialog" aria-modal="true" style="position:fixed;left:300px;top:200px;width:400px;height:200px;background:#fff">
  <div role="document"><button class="oxd-dialog-close-button">×</button><p class="oxd-text oxd-text--card-title">Add Organization Unit</p><hr>
  <form><div class="oxd-input-group"><div class="oxd-input-group__label-wrapper"><label class="oxd-label">Name</label></div><div><input></div></div><button type="submit">Save</button></form></div>
</div>
`;

test("a field or a custom select under a label tied to nothing is named by that label, with a placeholder as a hint after it", { skip }, async () => {
  const snapshot = await read(BOXES.replace(/<div role="dialog"[\s\S]*$/, ""));
  assert.deepEqual(lines(snapshot), [
    'textbox "Employee Name (Type for hints...)" [form]',
    'clickable "Job Title" icon:caret-down-fill [form]',
    'clickable "Vacancy" icon:caret-down-fill [form]',
    'textbox "From Date (yyyy-dd-mm)" (required) [form]',
    'clickable icon:calendar [form › row: From Date]',
    'textbox "To Date (yyyy-dd-mm)" [form]',
    'clickable icon:calendar [form › row: To Date]',
    'clickable icon:x [form › row: Pending Approval]',
    'clickable icon:x [form › row: Scheduled]',
    // A column heading names its column, not the tick box in the heading before it, and a closed sort menu's words are not read.
    "checkbox",
    'clickable icon:arrow-down-up [row: Id]',
    'clickable icon:arrow-down-up [row: Last Name]',
    'button "1" (current) [nav › Pagination Navigation]',
    'button "2" [nav › Pagination Navigation]',
    'button "3" [nav › Pagination Navigation]',
    'button icon:chevron-right [nav › Pagination Navigation]',
  ]);
});

test("a dialog with no name and no heading is named by its first words", { skip }, async () => {
  const snapshot = await read(BOXES);
  assert.equal(snapshot.dialog, "Add Organization Unit");
});

test("the current one of a row is marked only when one alone carries such a class name", { skip }, async () => {
  const snapshot = await read(`<ul><li class="tab"><a href="/a">A</a></li><li class="tab is-active"><a href="/b">B</a></li><li class="tab"><a href="/c">C</a></li></ul>
    <div><button class="step">One</button><button class="step inactive">Two</button><button class="step">Three</button></div>
    <div><button class="chip selected">Red</button><button class="chip selected">Blue</button><button class="chip">Green</button></div>
    <div><button aria-pressed="true" class="opt">Bold</button><button class="opt active">Italic</button></div>`);
  assert.deepEqual(lines(snapshot), [
    'link "A" → /a',
    'link "B" (current) → /b',
    'link "C" → /c',
    'button "One"',
    'button "Two"',
    'button "Three"',
    'button "Red"',
    'button "Blue"',
    'button "Green"',
    // The page has said which with an attribute, so a class name is not read.
    'button "Bold" (pressed)',
    'button "Italic"',
  ]);
});

test("a label that takes clicks for its field is not listed beside the field, unless the field cannot be seen", { skip }, async () => {
  const snapshot = await read(`<form style="font:16px sans-serif">
    <label style="cursor:pointer"><span><input type="radio" name="p"></span><span>Strong</span></label>
    <label style="cursor:pointer"><span><input type="radio" name="p"></span><span>Weak</span></label>
    <input type="checkbox" id="t1" style="position:absolute;opacity:0"><label for="t1" style="cursor:pointer"><span>Writing Templates</span></label>
    <input type="checkbox" id="t2" style="display:none"><label for="t2" style="cursor:pointer"><span>Only the label shows</span></label>
  </form>`);
  assert.deepEqual(lines(snapshot), ['radio "Strong" [form]', 'radio "Weak" [form]', 'checkbox "Writing Templates" [form]', 'clickable "Only the label shows" [form]']);
});

test("a field is never named by the words that come after it", { skip }, async () => {
  const snapshot = await read(`<main><h1>Records</h1>
<p><textarea rows="2" cols="40"></textarea></p>
<div role="article" onclick="void 0">Private message: salary is high for Dana</div>
<p><input type="text"></p>
<p>Weekly report for the team</p>
<p><label><input type="checkbox"> Remember me</label></p>
<p><input type="checkbox" id="terms"><span>I agree to the terms</span></p>
</main>`);
  const named = (role: string) => snapshot.elements.filter((element) => element.role === role).map((element) => element.label);
  // Words that come after a text field belong to whatever comes next on the page.
  assert.deepEqual(named("textbox"), ["", ""]);
  // A tick box's caption does come after it.
  assert.deepEqual(named("checkbox"), ["Remember me", "I agree to the terms"]);
});

test("a field is not named by a box before it that is listed as a control because it takes clicks", { skip }, async () => {
  const snapshot = await read(`<main><h1>Records</h1>
<div onclick="void 0">Open the inbox</div><p><input type="text"></p>
<div style="cursor:pointer">Show archived</div><p><input type="text"></p>
<div tabindex="0">Weekly summary</div><p><input type="text"></p>
<div>Reference number</div><p><input type="text"></p>
<p><input type="checkbox"><span style="cursor:pointer">Send me a copy</span></p>
</main>`);
  assert.deepEqual(lines(snapshot), [
    'clickable "Open the inbox" [main › Records]',
    'textbox [main › Records › 1 of 3]',
    'clickable "Show archived" [main › Records]',
    'textbox [main › Records › 2 of 3]',
    'clickable "Weekly summary" [main › Records]',
    'textbox [main › Records › 3 of 3]',
    // Words before a field that are only words still name it.
    'textbox "Reference number" [main › Records]',
    // Words after a tick box that are pressed to tick it are its caption.
    'checkbox "Send me a copy" [main › Records]',
    'clickable "Send me a copy" [main › Records]',
  ]);
});

test("a link in an app that keeps its place after '#/' keeps its route, and the page's path does too", { skip }, async () => {
  const snapshot = await read(
    `<nav>
      <a href="#/products">Products</a>
      <a href="#/orders/8812?tab=lines">Latest order</a>
      <a href="/app/index.html#/cart">Cart</a>
      <a href="#/">Home</a>
      <a href="#reviews">Reviews</a>
    </nav>`,
    { path: "/app/index.html#/products/8812" },
  );
  assert.equal(snapshot.path, "/app/index.html#/products/:id");
  assert.deepEqual(lines(snapshot), [
    'link "Products" [nav] → /app/index.html#/products',
    'link "Latest order" [nav] → /app/index.html#/orders/:id',
    'link "Cart" [nav] → /app/index.html#/cart',
    // The app's first screen, and a place further down this page, which is not somewhere else to go.
    'link "Home" [nav] → /app/index.html',
    'link "Reviews" [nav]',
  ]);
});

// Rows a visitor clicks as a whole ---------------------------------------------

test("a clickable row with nothing inside it to point at is listed by its words, and a header row is not", { skip }, async () => {
  const snapshot = await read(`<style>.go{cursor:pointer}</style>
    <h1>Orders</h1>
    <div role="table">
      <div role="row"><div role="columnheader">Order</div><div role="columnheader">State</div></div>
      <div role="row" class="go"><div role="cell">Order A100</div><div role="cell">Shipped</div></div>
    </div>
    <x-list-item class="go">Custom element row</x-list-item>
    <x-list-item class="go"><button>Open</button> Row with a button</x-list-item>
    <x-list-item>No pointer, no row</x-list-item>`);
  const listed = snapshot.elements.map((element) => `${element.role} ${element.label}`);
  assert.ok(listed.includes("clickable Order A100 Shipped"), listed.join(" | "));
  assert.ok(listed.includes("clickable Custom element row"), listed.join(" | "));
  // A row with a control in it is that control; one with no pointer is no control; a header row is never one.
  assert.ok(listed.includes("button Open"), listed.join(" | "));
  assert.ok(!listed.some((line) => /Row with a button|No pointer|columnheader|Order State/.test(line)), listed.join(" | "));
});
