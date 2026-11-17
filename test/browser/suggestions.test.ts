import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser, Page } from "playwright";
import { DEFAULT_APPEARANCE } from "../../src/shared/types.ts";
import { BROWSERS, launch, page, startHarness, turns, type Harness } from "./harness.ts";

// Suggested questions in each browser: the pills above an open, empty ask
// box, gone once the visitor types, a press that asks exactly that question,
// and the keyboard reaching them before the box. test/widget/suggestions.test.ts
// covers the rest in Chromium.

const SUGGESTED = [{ text: "Lock my Team offsite card" }, { text: "Who approves meals over $150?" }];
const TEXTS = SUGGESTED.map((one) => one.text);

for (const name of BROWSERS) {
  describe(`suggested questions in ${name}`, () => {
    let harness: Harness;
    let browser: Browser;
    before(async () => {
      harness = await startHarness();
      harness.pages.set("/", page(`<h1>Cards</h1><button>Lock card</button>`));
      harness.script = () => ({ reply: { target: null, status: "done", say: "Cards are under Cards." } });
      browser = await launch(name);
    });
    after(async () => {
      await browser.close();
      await harness.close();
    });

    async function open(suggestions?: typeof SUGGESTED): Promise<Page> {
      harness.config = { name: "Test", appearance: DEFAULT_APPEARANCE, ...(suggestions ? { suggestions } : {}) };
      harness.turns.length = 0;
      const tab = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
      await tab.goto(`${harness.url}/`);
      await tab.locator("haptic-root .launcher").click();
      await tab.locator('haptic-root [aria-label="Ask a question"]').waitFor();
      return tab;
    }
    /** The pills on show, top to bottom, and whether each sits above the panel, lined up with its right edge. */
    const shown = (tab: Page) =>
      tab.evaluate(() => {
        const root = document.querySelector("haptic-root")!.shadowRoot!;
        for (const animation of root.querySelector(".suggest")?.getAnimations() ?? []) animation.finish();
        const panel = root.querySelector(".panel")!.getBoundingClientRect();
        const pills = Array.from(root.querySelectorAll<HTMLElement>(".suggest .pill")).filter((pill) => pill.getClientRects().length > 0);
        return {
          texts: pills.map((pill) => pill.textContent ?? ""),
          placed: pills.every((pill) => {
            const box = pill.getBoundingClientRect();
            return box.bottom < panel.top && Math.abs(box.right - panel.right) <= 1;
          }),
        };
      });
    const focused = (tab: Page) => tab.evaluate(() => document.querySelector("haptic-root")!.shadowRoot!.activeElement?.textContent ?? "");

    test("they show over the open, empty ask box and go once the visitor types; a press asks exactly that question", async () => {
      const tab = await open(SUGGESTED);
      try {
        assert.deepEqual(await shown(tab), { texts: TEXTS, placed: true });
        const box = tab.locator('haptic-root [aria-label="Ask a question"]');
        await box.pressSequentially("lo");
        assert.deepEqual((await shown(tab)).texts, []);
        await box.fill("");
        assert.deepEqual((await shown(tab)).texts, TEXTS);
        await tab.locator("haptic-root .suggest .pill", { hasText: "Who approves meals over $150?" }).click();
        const [asked] = await turns(harness, 1);
        assert.equal(asked!.goal, "Who approves meals over $150?");
        assert.equal(asked!.mode, undefined);
      } finally {
        await tab.context().close();
      }
    });

    test("the keyboard reaches them before the ask box, Enter asks one, and Escape on one closes the panel", async () => {
      const tab = await open(SUGGESTED);
      try {
        assert.deepEqual(
          await tab.locator("haptic-root").getByRole("group", { name: "Suggested questions" }).getByRole("button").allTextContents(),
          TEXTS,
        );
        await tab.waitForTimeout(600);
        await tab.keyboard.press("Shift+Tab");
        assert.equal(await focused(tab), "Who approves meals over $150?");
        await tab.keyboard.press("Escape");
        assert.equal(await tab.locator("haptic-root .panel").isVisible(), false);
        await tab.locator("haptic-root .launcher").click();
        await tab.waitForTimeout(600);
        await tab.keyboard.press("Shift+Tab");
        await tab.keyboard.press("Shift+Tab");
        assert.equal(await focused(tab), "Lock my Team offsite card");
        await tab.keyboard.press("Enter");
        const [asked] = await turns(harness, 1);
        assert.equal(asked!.goal, "Lock my Team offsite card");
      } finally {
        await tab.context().close();
      }
    });

    test("a site with none draws nothing more", async () => {
      const tab = await open();
      try {
        assert.equal(await tab.evaluate(() => document.querySelector("haptic-root")!.shadowRoot!.querySelector(".suggest")), null);
      } finally {
        await tab.context().close();
      }
    });
  });
}
