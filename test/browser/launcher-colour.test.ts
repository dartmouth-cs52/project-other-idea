import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser, Page } from "playwright";
import { DEFAULT_APPEARANCE } from "../../src/shared/types.ts";
import { BROWSERS, launch, page, startHarness, type Harness } from "./harness.ts";

// A company can give the launcher its own site's colour, so the button looks
// like it belongs there. The pointer keeps its own colour, because it has to
// be seen against the site, not blend into it.

const INK = "rgb(28, 25, 23)";
const PAPER = "rgb(250, 250, 249)";

for (const name of BROWSERS) {
  describe(`the launcher's colour in ${name}`, () => {
    let harness: Harness;
    let browser: Browser;
    before(async () => {
      harness = await startHarness();
      harness.pages.set("/", page(`<h1>Home</h1><button>Billing</button>`));
      browser = await launch(name);
    });
    after(async () => {
      await browser?.close();
      await harness?.close();
    });

    /** The launcher's fill and the colour of its words, with the site's look set to `launcher`. */
    async function drawn(launcher: string | undefined): Promise<{ tab: Page; fill: string; words: string }> {
      harness.config = { ...harness.config, appearance: { ...DEFAULT_APPEARANCE, ...(launcher === undefined ? {} : { launcher }) } };
      const tab = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
      await tab.goto(`${harness.url}/`);
      const button = tab.locator("haptic-root .launcher");
      await button.waitFor();
      const style = await button.evaluate((el) => {
        const computed = getComputedStyle(el);
        return { fill: computed.backgroundColor, words: computed.color };
      });
      return { tab, ...style };
    }

    test("is Ink with Paper words when the company chose none", async () => {
      const { fill, words } = await drawn(undefined);
      assert.deepEqual({ fill, words }, { fill: INK, words: PAPER });
    });

    test("takes the site's colour, with whichever of Paper and Ink reads better on it", async () => {
      const dark = await drawn("#17633A");
      assert.deepEqual({ fill: dark.fill, words: dark.words }, { fill: "rgb(23, 99, 58)", words: PAPER }, "a dark green takes Paper words");
      const light = await drawn("#FACC15");
      assert.deepEqual({ fill: light.fill, words: light.words }, { fill: "rgb(250, 204, 21)", words: INK }, "a yellow takes Ink words");
    });

    test("stays Ink when what was saved is not a colour a browser can read", async () => {
      const { fill, words } = await drawn("green; background: url(x)");
      assert.deepEqual({ fill, words }, { fill: INK, words: PAPER });
    });

    test("leaves the pointer its own colour", async () => {
      const { tab } = await drawn("#17633A");
      const accent = await tab.evaluate(() => getComputedStyle(document.querySelector("haptic-root")!).getPropertyValue("--accent").trim());
      assert.equal(accent.toUpperCase(), DEFAULT_APPEARANCE.accent, "the pointer is still Haptic's blue");
    });
  });
}
