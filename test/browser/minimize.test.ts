import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { Browser, Page } from "playwright";
import { BROWSERS, launch, page, startHarness, type Harness } from "./harness.ts";

// The launcher can be put away: a small button on its corner turns it into a
// dot, the dot opens up a little under the pointer, and a click brings the
// launcher back. It stays put away on the next page.

const size = (tab: Page, selector: string) =>
  tab.locator(selector).evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  });
const settled = (tab: Page) => tab.waitForTimeout(450);

for (const name of BROWSERS) {
  describe(`minimizing the launcher in ${name}`, () => {
    let harness: Harness;
    let browser: Browser;
    let tab: Page;
    before(async () => {
      harness = await startHarness();
      harness.pages.set("/", page(`<h1>Home</h1><a href="/next">Next</a>`));
      harness.pages.set("/next", page(`<h1>Next</h1>`));
      browser = await launch(name);
    });
    after(async () => {
      await browser.close();
      await harness.close();
    });
    beforeEach(async () => {
      tab = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
      await tab.goto(`${harness.url}/`);
      await tab.locator("haptic-root .launcher").waitFor();
      await settled(tab);
    });

    test("shows the minimize button only while the pointer is over the launcher", async () => {
      const hide = tab.locator("haptic-root .hide");
      assert.equal(await hide.evaluate((el) => getComputedStyle(el).opacity), "0");
      await tab.locator("haptic-root .launcher").hover();
      await settled(tab);
      assert.equal(await hide.evaluate((el) => getComputedStyle(el).opacity), "1");
      // It sits on the launcher's top left corner, so it never covers the word.
      const [button, launcher] = await Promise.all([hide.boundingBox(), tab.locator("haptic-root .launcher").boundingBox()]);
      assert.ok(button!.x < launcher!.x && button!.y < launcher!.y, JSON.stringify({ button, launcher }));
    });

    test("turns the launcher into a dot, which opens up a little under the pointer and comes back on a click", async () => {
      const full = await size(tab, "haptic-root .launcher");
      await tab.locator("haptic-root .launcher").hover();
      await tab.locator("haptic-root .hide").click();
      await tab.mouse.move(10, 10);
      await settled(tab);
      assert.deepEqual(await size(tab, "haptic-root .launcher"), { width: 14, height: 14 });
      assert.equal(await tab.locator("haptic-root .launcher").getAttribute("aria-label"), "Show Ask");
      assert.equal(await tab.locator("haptic-root .panel").isHidden(), true);

      await tab.locator("haptic-root .launcher").hover();
      await settled(tab);
      assert.deepEqual(await size(tab, "haptic-root .launcher"), { width: 32, height: 32 });

      await tab.locator("haptic-root .launcher").click();
      await tab.mouse.move(10, 10);
      await settled(tab);
      assert.deepEqual(await size(tab, "haptic-root .launcher"), full);
      // Bringing it back doesn't open the panel as well. The next click does.
      assert.equal(await tab.locator("haptic-root .panel").isHidden(), true);
      assert.equal(await tab.locator("haptic-root .launcher").getAttribute("aria-label"), null);
    });

    test("stays minimized on the next page, and comes back for good once restored", async () => {
      await tab.locator("haptic-root .launcher").hover();
      await tab.locator("haptic-root .hide").click();
      await tab.goto(`${harness.url}/next`);
      await tab.locator("haptic-root .launcher").waitFor();
      assert.equal(await tab.locator("haptic-root .launcher").evaluate((el) => el.classList.contains("mini")), true);
      await tab.locator("haptic-root .launcher").click();
      await tab.goto(`${harness.url}/`);
      await tab.locator("haptic-root .launcher").waitFor();
      assert.equal(await tab.locator("haptic-root .launcher").evaluate((el) => el.classList.contains("mini")), false);
    });

    test("can be minimized and brought back from the keyboard", async () => {
      await tab.locator("haptic-root .launcher").focus();
      // Safari leaves buttons out of the Tab order unless the visitor turns that on, so there it is focused directly.
      if (name === "webkit") await tab.locator("haptic-root .hide").focus();
      else await tab.keyboard.press("Tab");
      assert.equal(await tab.evaluate(() => document.querySelector("haptic-root")!.shadowRoot!.activeElement?.className), "hide");
      await tab.keyboard.press("Enter");
      assert.equal(await tab.locator("haptic-root .launcher").evaluate((el) => el.classList.contains("mini")), true);
      // Focus goes back to the dot, so Enter brings the launcher back.
      await tab.keyboard.press("Enter");
      assert.equal(await tab.locator("haptic-root .launcher").evaluate((el) => el.classList.contains("mini")), false);
    });
  });
}
