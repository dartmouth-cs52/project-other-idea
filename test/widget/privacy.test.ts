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
