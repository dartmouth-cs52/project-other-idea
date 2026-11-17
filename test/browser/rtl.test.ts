import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import type { Browser, BrowserContext, Page } from "playwright";
import { ask, BROWSERS, ends, idOf, launch, page, point, startHarness, type Harness } from "./harness.ts";

// The widget on a page written right to left. The `all: initial` on its host
// leaves `direction` alone, so without a direction of its own the widget would
// take the page's and come out mirrored: the chat's × on the left, the send
// button on the left, the full stop at the start of the line about AI. Its own
// words are English, so it is left to right on every page and drawn exactly as
// on any other. What the visitor or the model wrote reads in its own
// direction, inside a bubble that stays where it is.

const BODY = `<main style="font:14px system-ui;padding:40px"><h1>الفريق</h1><button id="invite">دعوة زميل</button></main>`;
// The same Arabic page twice, differing only in its direction. The language a page declares can change the font a
// browser draws the widget's words in (Firefox does), which is not what is compared here.
const LTR = page(BODY).replace("<html>", '<html lang="ar">');
const RTL = page(BODY).replace("<html>", '<html dir="rtl" lang="ar">');
const QUESTION = "كيف أدعو زميلًا؟";
const ANSWER = "افتح صفحة الفريق ثم اضغط على دعوة زميل.";
const STEP = "اضغط على دعوة زميل.";

/** The parts of the open chat whose places are compared between the two pages. */
const PARTS = [".panel", ".dismiss", ".ask", ".ask input", ".send", ".about", ".about a", ".launcher", ".launcher svg", ".launcher span"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const part = (tab: Page, selector: string) => tab.locator(`haptic-root ${selector}`);
const direction = (tab: Page, selector: string) => part(tab, selector).evaluate((el) => getComputedStyle(el).direction);

/** Where each part of the chat is drawn, to the pixel. */
const layout = (tab: Page) =>
  tab.evaluate((parts) => {
    const root = document.querySelector("haptic-root")!.shadowRoot!;
    return Object.fromEntries(
      parts.map((selector) => {
        const box = root.querySelector(selector)!.getBoundingClientRect();
        return [selector, [box.left, box.top, box.width, box.height].map(Math.round)];
      }),
    );
  }, PARTS);

const box = async (tab: Page, selector: string) => (await part(tab, selector).boundingBox())!;

for (const name of BROWSERS) {
  describe(`on a right-to-left page in ${name}`, () => {
    let browser: Browser;
    let harness: Harness;
    let context: BrowserContext | undefined;
    before(async () => {
      browser = await launch(name);
      harness = await startHarness();
      harness.pages.set("/ltr", LTR);
      harness.pages.set("/rtl", RTL);
    });
    after(async () => {
      await browser.close();
      await harness.close();
    });
    afterEach(async () => {
      await context?.close();
      context = undefined;
      harness.turns.length = 0;
    });

    /** A fresh visit to one of the two pages, with the launcher on show. */
    const visit = async (path: "/ltr" | "/rtl") => {
      await context?.close();
      context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      const tab = await context.newPage();
      await tab.goto(`${harness.url}${path}`);
      await part(tab, ".launcher").waitFor();
      return tab;
    };
    /** Opens the chat and waits for it to be drawn where it stays. */
    const openChat = async (tab: Page) => {
      await part(tab, ".launcher").click();
      await part(tab, ".panel").waitFor();
      await sleep(350);
    };

    test("the open chat is drawn exactly as it is on a left-to-right page", async () => {
      const ltr = await visit("/ltr");
      await openChat(ltr);
      const there = await layout(ltr);

      const tab = await visit("/rtl");
      // The page itself is right to left, and the widget sits in it.
      assert.deepEqual(await tab.evaluate(() => [document.documentElement.dir, getComputedStyle(document.body).direction]), ["rtl", "rtl"]);
      await openChat(tab);
      assert.deepEqual(await layout(tab), there);

      // And in so many words. The × is on the panel's top right.
      const [panel, dismiss] = [await box(tab, ".panel"), await box(tab, ".dismiss")];
      assert.ok(panel.x + panel.width - (dismiss.x + dismiss.width) <= 8 && dismiss.x > panel.x + panel.width / 2, JSON.stringify({ panel, dismiss }));
      // Send is on the right of the ask box, and the empty box's placeholder is on the left.
      const [askBox, send] = [await box(tab, ".ask"), await box(tab, ".send")];
      assert.ok(askBox.x + askBox.width - (send.x + send.width) <= 12 && send.x > askBox.x + askBox.width / 2, JSON.stringify({ askBox, send }));
      assert.equal(await direction(tab, ".ask input"), "ltr");
      // The line about AI ends with its full stop.
      const about = await ends(part(tab, ".about"));
      assert.equal(about.first.char, "H");
      assert.equal(about.last.char, ".");
      assert.ok(about.last.left >= about.first.right, JSON.stringify(about));
      // The launcher shows its mark, then its word, and stays in the window's right corner with the chat open.
      const [mark, word, launcher] = [await box(tab, ".launcher svg"), await box(tab, ".launcher span"), await box(tab, ".launcher")];
      assert.ok(mark.x + mark.width <= word.x, JSON.stringify({ mark, word }));
      assert.equal(Math.round(1000 - (launcher.x + launcher.width)), 20);
    });

    test("an Arabic question and its answer read right to left, in bubbles that stay where they are", async () => {
      harness.script = () => ({
        reply: { target: null, status: "done", say: ANSWER, mode: "answer", sources: [{ title: "دعوة الزملاء", url: "https://example.com/help/invite" }] },
      });
      const tab = await visit("/rtl");
      await openChat(tab);
      // The ask box turns with the first letter typed.
      const input = part(tab, ".ask input");
      await input.fill("invite someone");
      assert.equal(await direction(tab, ".ask input"), "ltr");
      await input.fill(QUESTION);
      assert.equal(await direction(tab, ".ask input"), "rtl");
      await input.press("Enter");
      await part(tab, ".reply").waitFor();

      assert.equal(await part(tab, ".question").textContent(), QUESTION);
      assert.equal(await direction(tab, ".question"), "rtl");
      assert.equal(await direction(tab, ".reply p:not(.missing)"), "rtl");
      // The answer's full stop is at its left end, where an Arabic sentence ends.
      const answer = await ends(part(tab, ".reply p:not(.missing)"));
      assert.equal(answer.last.char, ".");
      assert.ok(answer.last.right <= answer.first.left, JSON.stringify(answer));
      // The question is on the right of the chat and the answer on its left, as on any page.
      const [thread, question, reply] = [await box(tab, ".thread"), await box(tab, ".question"), await box(tab, ".reply")];
      assert.ok(thread.x + thread.width - (question.x + question.width) <= 6, JSON.stringify({ thread, question }));
      assert.ok(reply.x - thread.x <= 6, JSON.stringify({ thread, reply }));
      // The widget's own words beside them stay left to right, and so does the ask box, empty again.
      assert.equal(await direction(tab, ".sources .from"), "ltr");
      assert.equal(await direction(tab, ".ask input"), "ltr");
    });

    test("a step's caption in Arabic reads right to left, with its × still after the words", async () => {
      harness.script = (request) => point(idOf(request, "دعوة زميل"), STEP);
      const tab = await visit("/rtl");
      await ask(tab, QUESTION);
      await part(tab, ".caption").waitFor();
      assert.equal(await part(tab, ".caption span").textContent(), STEP);
      assert.equal(await direction(tab, ".caption span"), "rtl");
      assert.equal(await direction(tab, ".caption"), "ltr");
      const [words, close] = [await box(tab, ".caption span"), await box(tab, ".caption .close")];
      assert.ok(words.x + words.width <= close.x, JSON.stringify({ words, close }));
      const step = await ends(part(tab, ".caption span"));
      assert.ok(step.last.right <= step.first.left, JSON.stringify(step));
    });
  });
}
