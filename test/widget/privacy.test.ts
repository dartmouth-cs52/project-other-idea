import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words } from "./harness.ts";

after(closeBrowser);

// What the widget sends when a visitor clicks something other than the
// control it pointed at. The sentence names what was clicked, and that name
// must never be something a person wrote, or an email or a long number as
// the page shows it.
const PAGE = `
  <h1>Records</h1>
  <button id="target" style="position:absolute;right:80px;top:420px">Save</button>
  <p><a id="link" href="#x">Contact jane.doe@acme.com about card 4111111111111111</a></p>
  <div id="editor" role="textbox" contenteditable="true" style="border:1px solid #999;padding:8px;width:420px">My private draft about the merger with Initech</div>
  <p><textarea id="area" rows="2" cols="50">Patient note: John Smith has diabetes</textarea></p>
  <div id="region" role="article" onclick="void 0" style="border:1px solid #999;padding:8px;width:420px">Private message: salary is 185000 dollars for Dana</div>
  <div id="box" tabindex="0" style="border:1px solid #999;padding:8px;margin:8px 0;width:420px">
    <label>Reference <textarea id="ref" rows="1" cols="30">Invoice for Okafor and Daughters</textarea></label>
  </div>
  <p><button id="plain">Export report</button></p>
  <p><button id="labelled" aria-label="Email sam@corp.example">@</button></p>`;

const WRITTEN_OR_UNMASKED = ["jane.doe", "4111111111111111", "merger", "Initech", "John Smith", "diabetes", "185000", "Okafor", "sam@corp"];

const CASES: [what: string, id: string, event: RegExp][] = [
  ["a link that shows an email and a card number", "link", /clicked "Contact \[email\] about card \[number\]" instead of button "Save"/],
  ["a rich-text editor", "editor", /instead of button "Save"/],
  ["a text area that came filled in", "area", /instead of button "Save"/],
  ["a region of the page that takes clicks", "region", /instead of button "Save"/],
  ["a box around a filled-in field", "box", /instead of button "Save"/],
  ["an ordinary button", "plain", /clicked "Export report" instead of button "Save"/],
  ["a button whose label holds an email", "labelled", /clicked "Email \[email\]" instead of button "Save"/],
];

for (const [what, id, event] of CASES) {
  test(`a click on ${what} sends nothing written there and nothing unmasked`, async () => {
    const session = await start(PAGE, (request, index) => (index === 0 ? point(request, "Save", "Click Save.") : words("That is all.")));
    try {
      await session.ask("how do I save");
      await session.untilState("pointing");
      await session.page.locator(`#${id}`).click({ position: { x: 5, y: 5 } });
      const second = await session.untilAsked(2);
      assert.match(second.event ?? "", event);
      for (const secret of WRITTEN_OR_UNMASKED) assert.ok(!JSON.stringify(session.requests).includes(secret), `"${secret}" was sent. The event was: ${second.event}`);
    } finally {
      await session.close();
    }
  });
}

// A page that shows back what is typed into it: a card's preview with the name
// being typed, and a total with the amount. What it shows is the visitor's.
const ECHO = `
  <h1>New card</h1>
  <p><label for="nick">Card name</label> <input id="nick" type="text"></p>
  <p><label for="amount">Amount</label> <input id="amount" type="text"></p>
  <aside><p>Preview</p><div><span>northpine</span> <span id="name">New card</span></div><p id="total">Total $0.00</p></aside>
  <button id="issue">Issue card</button>
  <script>
    document.getElementById("nick").addEventListener("input", (e) => { document.getElementById("name").textContent = e.target.value || "New card"; });
    document.getElementById("amount").addEventListener("input", (e) => { document.getElementById("total").textContent = "Total $" + (e.target.value || "0") + ".00"; });
  </script>`;

test("what the page shows back of what was typed is not sent with the next question", async () => {
  const session = await start(ECHO, (request, index) => (index === 0 ? point(request, "Card name", "Type a name for the card.") : words("Now click Issue card.", "done")));
  try {
    await session.ask("issue a card");
    await session.untilState("pointing");
    await session.page.locator("#nick").click();
    await session.page.keyboard.type("Mergers offsite Zurich");
    await session.page.locator("#amount").click();
    await session.page.keyboard.type("7315");
    await session.page.locator("#issue").focus();
    await session.untilAsked(2);
    const sent = JSON.stringify(session.requests);
    for (const typed of ["Mergers offsite", "Zurich", "7315"]) assert.ok(!sent.includes(typed), `"${typed}" was sent: ${JSON.stringify(session.requests[1]?.snapshot.text)}`);
    assert.ok(session.requests[1]!.snapshot.text.includes("Preview"), "the page's own words around it are still sent");
  } finally {
    await session.close();
  }
});

// From the second review: a page that repeats what is typed in places other than its text. A heading greets the
// name being typed, the button to save says it, the title says it, and the search box's list offers a search for
// what is typed in it. Each reached the model.
const REPEATS = `
  <h1>Profile</h1>
  <p><label for="name">Full name</label> <input id="name" type="text"></p>
  <h2 id="hello">Hello</h2>
  <p><label for="q">Search</label> <input id="q" type="text" role="combobox" aria-expanded="true" aria-controls="suggestions"></p>
  <ul id="suggestions" role="listbox"><li role="option" id="option">Search</li><li role="option">Recent searches</li></ul>
  <p><label for="filter">Filter</label> <input id="filter" type="text"> <a id="results" href="/results">Results</a></p>
  <button id="save">Save</button>
  <script>
    document.getElementById("filter").addEventListener("input", (e) => { document.getElementById("results").href = "/results?filter=" + e.target.value; });
    document.getElementById("name").addEventListener("input", (e) => {
      document.getElementById("hello").textContent = "Hello, " + e.target.value;
      document.getElementById("save").textContent = "Save " + e.target.value;
      document.title = "Profile of " + e.target.value;
    });
    document.getElementById("q").addEventListener("input", (e) => { document.getElementById("option").textContent = "Search for \u201c" + e.target.value + "\u201d"; });
  </script>`;

test("what was typed is not sent where the page repeats it in a heading, a button's words, an option, the title or a link's query: [typed] stands in its place", async () => {
  const session = await start(REPEATS, (request, index) => (index === 0 ? point(request, "Full name", "Type your name.") : words("Now click Save.", "done")));
  try {
    await session.ask("how do I save my profile");
    await session.untilState("pointing");
    await session.page.locator("#name").click();
    await session.page.keyboard.type("Zebulon Quackenbush");
    await session.page.locator("#q").click();
    await session.page.keyboard.type("divorce lawyer near me");
    await session.page.locator("#filter").click();
    await session.page.keyboard.type("oncology");
    await session.page.locator("#save").focus();
    const second = await session.untilAsked(2);
    const sent = JSON.stringify(session.requests);
    for (const typed of ["Zebulon", "Quackenbush", "divorce", "lawyer near me", "oncology"]) assert.ok(!sent.includes(typed), `"${typed}" was sent: ${JSON.stringify(second.snapshot)}`);
    // The page's own words around it are still sent, so the model can tell what each one is.
    assert.ok(second.snapshot.headings.includes("Hello, [typed]"), JSON.stringify(second.snapshot.headings));
    assert.ok(second.snapshot.elements.some((element) => element.role === "button" && element.label === "Save [typed]"), JSON.stringify(second.snapshot.elements));
    assert.ok(second.snapshot.elements.some((element) => element.role === "option" && element.label === "Search for \u201c[typed]\u201d"), JSON.stringify(second.snapshot.elements));
    assert.equal(second.snapshot.title, "Profile of [typed]");
    // A link's address keeps a word of its query only when it is not what a field holds.
    assert.equal(second.snapshot.elements.find((element) => element.label === "Results")?.href, "/results");
    assert.ok(second.snapshot.elements.some((element) => element.role === "option" && element.label === "Recent searches"));
  } finally {
    await session.close();
  }
});
