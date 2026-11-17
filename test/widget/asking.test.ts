import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, start, words } from "./harness.ts";

after(closeBrowser);

// Typing a long question. The ask box was one line, so a question longer than
// it scrolled out of sight as it was typed, and the visitor could not read
// back what they had written before sending it.

/**
 * A page with keyboard shortcuts of its own, heard on the window as an app's are: a letter typed anywhere but in one of
 * the page's own fields is acted on. Every key the page hears is kept, and "n" goes to another view.
 */
const SHORTCUTS = `<h1>Orders</h1><p id="where">Orders</p>
  <button id="export" type="button" style="margin:120px 0 0 200px">Export</button>
  <script>
    window.heard = [];
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      window.heard.push(event.key);
      if (event.key === 'n') document.getElementById('where').textContent = 'New order';
    });
  </script>`;

test("a long question is read whole while it is typed: the ask box grows to three lines, and Enter still sends it on one", async () => {
  const session = await start(SHORTCUTS, () => words("Done."));
  const box = () =>
    session.page.evaluate(() => {
      const root = document.querySelector("haptic-root")!.shadowRoot!;
      const field = root.querySelector(".ask textarea") as HTMLTextAreaElement;
      const rect = field.getBoundingClientRect();
      const panel = root.querySelector(".panel")!.getBoundingClientRect();
      return { height: Math.round(rect.height), hidden: field.scrollHeight - field.clientHeight, lineHeight: parseFloat(getComputedStyle(field).lineHeight), panelTop: panel.top, value: field.value };
    });
  const question = "Issue Malika Cummerata a virtual card called Ads with a $500 monthly limit.";
  try {
    await session.page.locator("haptic-root .launcher").click();
    const empty = await box();
    assert.equal(empty.height, 40);
    await session.page.keyboard.type("Lock my card", { delay: 2 });
    assert.equal((await box()).height, 40, "a short question made the box taller");
    await session.page.keyboard.press("Control+A");
    await session.page.keyboard.type(question, { delay: 2 });
    const typed = await box();
    // Every line of it is on show: two or three lines, and nothing scrolled out of the box. One line is 40 px, as the
    // box was when it was a single line, and each line more adds its height.
    const lines = (height: number, lineHeight: number) => Math.round((height - 40) / lineHeight) + 1;
    assert.ok(lines(typed.height, typed.lineHeight) >= 2 && lines(typed.height, typed.lineHeight) <= 3, `the box is ${typed.height} px tall`);
    assert.ok(typed.hidden <= 1, `${typed.hidden} px of the question are out of sight`);
    assert.ok(typed.panelTop >= 0);
    // A question longer than three lines scrolls inside the box, which grows no further.
    await session.page.keyboard.type(` ${question} ${question}`, { delay: 1 });
    const long = await box();
    assert.equal(lines(long.height, long.lineHeight), 3, `the box grew to ${long.height} px`);
    assert.ok(long.hidden > 0);
    await session.page.keyboard.press("Control+A");
    await session.page.keyboard.type(question, { delay: 1 });
    await session.page.keyboard.press("Enter");
    const asked = await session.untilAsked(1);
    assert.equal(asked.goal, question);
    await session.untilState("finished");
    // Back to one line for the next question.
    await session.until(async () => (await box()).value === "", "the ask box to empty");
    assert.equal((await box()).height, 40);
  } finally {
    await session.close();
  }
});
