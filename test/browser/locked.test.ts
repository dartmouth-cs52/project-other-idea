import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { Browser, BrowserContext, Page } from "playwright";
import { ask, BROWSERS, idOf, launch, page, point, ringAround, startHarness, type Harness } from "./harness.ts";

// The ring, the pointer and its caption stay on the control they point at
// when the page moves under them and nothing of ours gets to run. A Mac's
// trackpad does that: pulled past the top of the page, the page springs down
// and back while the scroll position stays at 0, so no script sees it move.
// On Northpine's Issue a card, the ring stayed where the Cardholder field had
// been and went round its label instead. A scroll the browser does on its own,
// between two of our frames, moves the page in the same way. Neither browser
// here draws the pull, so each test stops our frames and scrolls the page.

const PAGE = page(`
  <main style="font:14px system-ui;padding:40px;height:2400px">
    <h1>Issue a card</h1>
    <div style="height:260px"></div>
    <button id="owner" style="width:320px;height:36px">Choose a person</button>
    <button id="draft" style="position:fixed;left:520px;top:12px">Save draft</button>
  </main>
  <footer><a id="all" href="#all" style="display:block;padding:12px;background:#eee">See all cards</a></footer>`, '<style>body{margin:0}</style>');

const part = (tab: Page, selector: string) => tab.locator(`haptic-root ${selector}`);

/** How far down the window the control, the pointer and the caption are, to the pixel. */
const places = (tab: Page, control: string) =>
  tab.evaluate((control) => {
    // Written out in one piece: a helper function in here would not survive the trip into the page.
    const root = document.querySelector("haptic-root")!.shadowRoot!;
    const [at, pointer, caption] = [document.querySelector(control)!, root.querySelector(".cursor")!, root.querySelector(".caption")!].map((el) => Math.round(el.getBoundingClientRect().top));
    return { control: at!, pointer: pointer!, caption: caption! };
  }, control);

/** Stops the widget's frames, as the page moving on its own leaves them, once the one already asked for has run. */
const stopFrames = async (tab: Page) => {
  await tab.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await tab.waitForTimeout(100);
};

for (const name of BROWSERS) {
  describe(`what points stays on what it points at, in ${name}`, () => {
    let browser: Browser;
    let harness: Harness;
    let context: BrowserContext;
    let tab: Page;
    before(async () => {
      browser = await launch(name);
      harness = await startHarness();
      harness.pages.set("/", PAGE);
    });
    after(async () => {
      await browser.close();
      await harness.close();
    });
    beforeEach(async () => {
      await context?.close();
      harness.turns.length = 0;
      context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      tab = await context.newPage();
      await tab.goto(`${harness.url}/`);
      await part(tab, ".launcher").waitFor();
    });

    test("the ring, the pointer and the caption move with the page when it moves under them (Northpine: the ring went round Cardholder's label)", async () => {
      harness.script = (request) => point(idOf(request, "Choose a person"), "Pick who holds the card.");
      await ask(tab, "issue a card");
      assert.ok(await ringAround(tab, "#owner"), "the ring lands around the field");
      await part(tab, ".caption").waitFor();
      await tab.waitForTimeout(700);
      await stopFrames(tab);
      const before = await places(tab, "#owner");

      await tab.evaluate(() => window.scrollTo({ top: 120, behavior: "instant" }));
      const after = await places(tab, "#owner");
      assert.equal(after.control, before.control - 120, "the page should have moved");
      assert.ok(await ringAround(tab, "#owner", 500), "the ring was left where the field had been");
      assert.deepEqual({ pointer: after.pointer - before.pointer, caption: after.caption - before.caption }, { pointer: -120, caption: -120 }, "the pointer and the caption should move with the field");
    });

    test("for a control fixed to the window, they stay with the control and not the page", async () => {
      harness.script = (request) => point(idOf(request, "Save draft"), "Save it as a draft.");
      await ask(tab, "save a draft");
      assert.ok(await ringAround(tab, "#draft"));
      await tab.waitForTimeout(700);
      await stopFrames(tab);
      await tab.evaluate(() => window.scrollTo({ top: 120, behavior: "instant" }));
      assert.ok(await ringAround(tab, "#draft", 500), "the ring moved off a control that stayed where it was");
    });

    test("pointing at the foot of the page, at a row as wide as the window, makes the page no longer and no wider", async () => {
      const size = () => tab.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, across: document.documentElement.clientWidth }));
      const start = await size();
      assert.equal(start.width, start.across, "the page itself is no wider than the window");
      harness.script = (request) => point(idOf(request, "See all cards"), "Open the list of cards.");
      await tab.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await ask(tab, "see every card");
      assert.ok(await ringAround(tab, "#all"));
      await tab.waitForTimeout(700);
      assert.deepEqual(await size(), start);
    });
  });
}
