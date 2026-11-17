import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser, Page } from "playwright";
import { ask, BROWSERS, done, launch, page, startHarness, type Harness } from "./harness.ts";

// "Did this help?" sits in the panel, under a caption that has nothing to
// point at. The caption sits a fixed gap above the panel. When the question
// shows, the panel grows and the caption moves up with it. When the question
// goes, the caption has to come back down, or a hole is left where it was.

/** The space between the foot of the caption and the top of the panel under it. */
const gap = (tab: Page) =>
  tab.evaluate(() => {
    const root = document.querySelector("haptic-root")!.shadowRoot!;
    return Math.round(root.querySelector(".dock")!.getBoundingClientRect().top - root.querySelector(".caption")!.getBoundingClientRect().bottom);
  });

for (const name of BROWSERS) {
  describe(`the caption above "Did this help?" in ${name}`, () => {
    let harness: Harness;
    let browser: Browser;
    let tab: Page;
    before(async () => {
      harness = await startHarness();
      harness.pages.set("/", page(`<h1>People</h1><button>Invite people</button>`));
      harness.script = () => done("This page lists everyone in your company.");
      browser = await launch(name);
      tab = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      await tab.goto(`${harness.url}/`);
      await tab.locator("haptic-root .launcher").waitFor();
    });
    after(async () => {
      await browser.close();
      await harness.close();
    });

    test("stays the same gap above the panel once Yes is pressed and the question goes", async () => {
      await ask(tab, "what is on this page?");
      const yes = tab.locator("haptic-root .helped button", { hasText: "Yes" });
      await yes.waitFor();
      const asked = await gap(tab);
      assert.ok(asked > 0 && asked <= 24, `the caption should sit just above the panel while the question shows, and is ${asked}px away`);

      await yes.click();
      // "Thanks." stands in for a moment, then the row goes and the panel is shorter by it.
      await tab.locator("haptic-root .helped").waitFor({ state: "hidden", timeout: 5000 });
      assert.equal(await gap(tab), asked, "the caption did not come back down with the panel");
    });
  });
}
