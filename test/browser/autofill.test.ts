import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright";
import { ask, BROWSERS, idOf, launch, page, point, startHarness, turns, type Harness } from "./harness.ts";

// A visitor's browser filling in a form for them. On the request access form,
// with the pointer on First name, a visitor picked one of Chrome's suggestions:
// Chrome wrote First name and Last name at once, and they clicked Additional
// details straight after. That click was heard as a wrong one, and the guide
// said "Not that one" about a form that was filled in.
//
// Chrome's own autofill is driven here through the DevTools protocol
// (Autofill.trigger), so the events are the ones Chrome really sends: on each
// field a focus, a keydown with no key, an input that is a plain Event, a
// change, a keyup and a blur, with the field already in the :autofill state.
// Firefox and WebKit have no such switch, so this runs in Chromium only, and
// in the whole of Chromium: the headless shell Playwright runs by default has
// no autofill, and answers "'Autofill.trigger' wasn't found".

const FORM = page(`
  <main style="font:16px system-ui;padding:40px;max-width:640px">
    <h2>Request access</h2>
    <form onsubmit="return false" style="display:grid;gap:16px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label for="first">First name</label><input id="first" type="text" required autocomplete="given-name"></div>
        <div><label for="last">Last name</label><input id="last" type="text" required autocomplete="family-name"></div>
      </div>
      <div><label for="details">Additional details</label><textarea id="details" rows="4"></textarea></div>
      <button type="submit">Request access</button>
    </form>
  </main>`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fills the form in from the field `selector`, as picking one of Chrome's suggestions there does. */
async function autofill(cdp: CDPSession, selector: string) {
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  const { node } = await cdp.send("DOM.describeNode", { nodeId });
  // Not in Playwright's types yet: an address to fill with, kept by nobody.
  await (cdp.send as (method: string, params: object) => Promise<unknown>)("Autofill.trigger", {
    fieldId: node.backendNodeId,
    address: { fields: [{ name: "NAME_FIRST", value: "Ada" }, { name: "NAME_LAST", value: "Lovelace" }, { name: "NAME_FULL", value: "Ada Lovelace" }] },
  });
}

describe("the browser's autofill", { skip: !BROWSERS.includes("chromium") && "only Chromium can be told to autofill" }, () => {
  let browser: Browser;
  let harness: Harness;
  let context: BrowserContext;
  let tab: Page;
  let cdp: CDPSession;
  before(async () => {
    browser = await launch("chromium", { full: true });
    harness = await startHarness();
    harness.pages.set("/", FORM);
  });
  after(async () => {
    await browser.close();
    await harness.close();
  });
  beforeEach(async () => {
    await context?.close();
    harness.turns.length = 0;
    harness.posts.length = 0;
    harness.script = (request, index) => (index === 0 ? point(idOf(request, "First name"), "Type your first name.") : point(idOf(request, "Request access"), "Click Request access."));
    context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    tab = await context.newPage();
    cdp = await context.newCDPSession(tab);
    await tab.goto(`${harness.url}/`);
    await tab.locator("haptic-root .launcher").waitFor();
    await ask(tab, "request access");
    await tab.waitForFunction(() => (document.querySelector("haptic-root") as (Element & { guideState?: string }) | null)?.guideState === "pointing", undefined, { timeout: 8000 });
  });

  test("filling in the pointed field is heard at once, as the browser's doing, and a click on the next field after it is not a wrong click", async () => {
    await tab.click("#first");
    const filledAt = Date.now();
    await autofill(cdp, "#first");
    assert.deepEqual(await tab.evaluate(() => [(document.getElementById("first") as HTMLInputElement).value, (document.getElementById("last") as HTMLInputElement).value]), ["Ada", "Lovelace"]);
    // What the visitor did on the request access form: straight on to the next box.
    await sleep(250);
    await tab.click("#details");
    const [, second] = await turns(harness, 2, 4000);
    assert.ok(Date.now() - filledAt < 1200, "asked without waiting for typing to pause");
    assert.match(second!.event ?? "", /^The user filled in .*"First name" with the browser's autofill, which may have filled in other fields of the form too\./);
    assert.notEqual(second!.offTrack, true, "not off track");
  });

  test("typing in the pointed field and clicking the next one before the pause is filling it in, and says what was clicked", async () => {
    await tab.click("#first");
    await tab.keyboard.type("Ada", { delay: 30 });
    await tab.click("#last");
    const [, second] = await turns(harness, 2, 4000);
    assert.match(second!.event ?? "", /^The user filled in .*"First name", then clicked "Last name"\. You can't see what they entered\./);
    assert.notEqual(second!.offTrack, true, "not off track");
  });

  test("clicking another field before anything is in the pointed one is still a wrong click", async () => {
    await tab.click("#details");
    const [, second] = await turns(harness, 2, 4000);
    assert.match(second!.event ?? "", /instead of .*"First name"/);
    assert.equal(second!.offTrack, true);
  });
});
