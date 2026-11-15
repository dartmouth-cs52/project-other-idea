import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, start, words } from "./harness.ts";

after(closeBrowser);

// Asking while something on the page holds on to the keyboard. Material UI's
// open select list is not a dialog, but it pulls the keyboard back to itself
// whenever it goes anywhere else, and it closes on Escape.

const TRAP = `<h1>Catalog</h1>
  <button id="kind" type="button">Kind: Component</button><button type="button">Create</button>
  <div id="pop" role="presentation" hidden style="position:fixed;inset:0">
    <ul id="menu" role="listbox" tabindex="-1" style="position:absolute;top:60px;left:24px;margin:0;padding:4px;list-style:none;background:#fff;border:1px solid #999">
      <li role="option" tabindex="-1">Component</li><li role="option" tabindex="-1">System</li><li role="option" tabindex="-1">API</li>
    </ul>
  </div>
  <script>
    const pop = document.getElementById('pop'), menu = document.getElementById('menu');
    document.getElementById('kind').addEventListener('click', () => { pop.hidden = false; menu.focus(); });
    // The keyboard is kept inside the open list, as Material UI's trap does it: on every focus, in the capture phase, and every 50 ms.
    const contain = () => { if (!pop.hidden && !pop.contains(document.activeElement)) menu.focus(); };
    document.addEventListener('focus', contain, true);
    setInterval(contain, 50);
    pop.addEventListener('keydown', (event) => { if (event.key === 'Escape') { pop.hidden = true; document.getElementById('kind').focus(); } });
  </script>`;

test("a question can be typed while an open list keeps the keyboard, and Escape still closes the list afterwards", async () => {
  const session = await start(TRAP, () => words("Press Escape to close the list, then click Create.", "continue"));
  try {
    await session.page.locator("#kind").click();
    await session.page.locator("haptic-root .launcher").click();
    await session.page.waitForTimeout(200);
    await session.page.keyboard.type("how do I add a component", { delay: 20 });
    await session.page.keyboard.press("Enter");
    const first = await session.untilAsked(1, 4000).catch(() => undefined);
    assert.ok(first, "the question never reached the ask box");
    assert.equal(first.goal, "how do I add a component");
    assert.ok(await session.page.evaluate(() => !!document.querySelector("#pop haptic-root")), "the widget is not inside the list that took the keyboard");
    await session.untilState("watching");
    await session.page.keyboard.press("Escape");
    await session.until(() => session.page.evaluate(() => (document.getElementById("pop") as HTMLElement).hidden), "Escape to close the list");
    // With the list closed the widget goes back to its own place on the page.
    await session.until(() => session.page.evaluate(() => document.querySelector("haptic-root")?.parentNode === document.documentElement), "the widget to come back out");
  } finally {
    await session.close();
  }
});

test("a visitor who clicks from the ask box into the page is not followed there", async () => {
  const session = await start(`<h1>Form</h1><input id="name" aria-label="Name"><button type="button">Save</button>`, () => words("Done."));
  try {
    await session.page.locator("haptic-root .launcher").click();
    await session.page.waitForTimeout(100);
    await session.page.locator("#name").click();
    await session.page.waitForTimeout(700);
    assert.equal(await session.page.evaluate(() => document.querySelector("haptic-root")?.parentNode === document.documentElement), true);
    assert.equal(await session.page.evaluate(() => document.activeElement?.id), "name");
  } finally {
    await session.close();
  }
});
