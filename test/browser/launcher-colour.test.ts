import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser, Page } from "playwright";
import { launcherColour, POINTER_BLUE } from "../../src/shared/colour.ts";
import { DEFAULT_APPEARANCE } from "../../src/shared/types.ts";
import { BROWSERS, launch, page, startHarness, type Harness } from "./harness.ts";

// The launcher takes the site's own colour, so the button looks like it
// belongs there, darkened when that colour is too light to see. The pointer is
// Haptic's blue on every site, whatever the site saved, because it has to be
// seen against the site, not blend into it.

const INK = "rgb(28, 25, 23)";
const PAPER = "rgb(250, 250, 249)";
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;

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
      await browser.close();
      await harness.close();
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
    });

    test("darkens a colour too light to see on a white page, keeping its hue", async () => {
      const light = await drawn("#FACC15");
      assert.notEqual(light.fill, "rgb(250, 204, 21)", "the yellow as saved would be lost on a white page");
      assert.deepEqual({ fill: light.fill, words: light.words }, { fill: rgb(launcherColour("#FACC15")), words: INK }, "drawn darker, with Ink words");
    });

    test("stays Ink when what was saved is not a colour a browser can read", async () => {
      const { fill, words } = await drawn("green; background: url(x)");
      assert.deepEqual({ fill, words }, { fill: INK, words: PAPER });
    });

    test("draws the pointer in Haptic's blue, even on a site that saved another colour for it", async () => {
      // Back when the pointer's colour was a setting, a site could save green. That is not used.
      harness.config = { ...harness.config, appearance: { ...DEFAULT_APPEARANCE, accent: "#16A34A", launcher: "#17633A" } };
      const tab = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
      await tab.goto(`${harness.url}/`);
      await tab.locator("haptic-root .launcher").waitFor();
      const accent = await tab.evaluate(() => getComputedStyle(document.querySelector("haptic-root")!).getPropertyValue("--accent").trim());
      assert.equal(accent.toUpperCase(), POINTER_BLUE);
    });
  });
}
