import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words } from "./harness.ts";

after(closeBrowser);

const PAGE = `
  <h1>New message</h1>
  <div id="editor" role="textbox" contenteditable="true" style="border:1px solid #999;padding:8px;min-height:60px">Dear Priya, my card ends 4417 and the door code is seven-two-nine.</div>
  <p><textarea id="note" rows="3" cols="50">Tell nobody that Sam is leaving in March.</textarea></p>
  <div id="card" tabindex="0" style="border:1px solid #999;padding:8px;margin:8px 0">
    <label>Reference <textarea id="ref" rows="1" cols="40">Invoice for Okafor and Daughters</textarea></label>
  </div>
  <button id="send" type="button">Send</button>`;

/** Everything a request carries, as one string, so nothing has to be known about where text could hide. */
const sent = (requests: unknown[]) => JSON.stringify(requests);

for (const [what, selector] of [
  ["a rich-text editor", "#editor"],
  ["a text area that came filled in", "#note"],
  ["a box around a filled-in field", "#card"],
] as const) {
  test(`a click in ${what} sends none of what is written there`, async () => {
    const session = await start(PAGE, (request, index) => (index === 0 ? point(request, "Send", "Click Send.") : words("Not that one.")));
    try {
      await session.ask("send this");
      await session.untilAsked(1);
      await session.page.locator("haptic-root .cursor").waitFor({ state: "visible" });
      await session.page.locator(selector).click({ position: { x: 4, y: 4 } });
      const second = await session.untilAsked(2);
      assert.match(second.event ?? "", /instead of button "Send"/);
      for (const secret of ["Priya", "4417", "seven-two-nine", "Sam is leaving", "Okafor"]) {
        assert.ok(!sent(session.requests).includes(secret), `"${secret}" was sent: ${second.event}`);
      }
    } finally {
      await session.close();
    }
  });
}
