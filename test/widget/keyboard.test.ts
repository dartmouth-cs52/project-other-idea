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

test("a menu that takes the keyboard a while after the visitor began typing a question does not take the question's keys", async () => {
  // UI5's menu: an entry the mouse crossed on its way to Haptic's launcher opens its submenu a moment later, and that takes the keyboard.
  const page = `<h1>Files</h1><button id="open" type="button">Open menu</button>
    <ul id="menu" role="menu" hidden style="position:absolute;top:60px;left:24px;margin:0;padding:4px;list-style:none;background:#fff;border:1px solid #999">
      <li role="menuitem" tabindex="-1">New file</li><li id="sub" role="menuitem" tabindex="-1">Open from the cloud</li>
    </ul>
    <script>
      const menu = document.getElementById('menu');
      document.getElementById('open').addEventListener('click', () => {
        menu.hidden = false;
        setTimeout(() => document.getElementById('sub').focus(), 1200);
      });
      menu.addEventListener('keydown', (event) => { if (event.key === ' ') menu.hidden = true; });
    </script>`;
  const session = await start(page, () => words("Choose New file."));
  try {
    await session.page.locator("#open").click();
    await session.page.locator("haptic-root .launcher").click();
    await session.page.keyboard.type("what can I do here", { delay: 90 });
    const typed = await session.page.evaluate(() => (document.querySelector("haptic-root")!.shadowRoot!.querySelector(".ask textarea") as HTMLTextAreaElement).value);
    assert.equal(typed, "what can I do here");
    assert.equal(await session.page.evaluate(() => (document.getElementById("menu") as HTMLElement).hidden), false, "a key meant for the question reached the menu");
    await session.page.keyboard.press("Enter");
    const first = await session.untilAsked(1, 5000);
    assert.equal(first.goal, "what can I do here");
  } finally {
    await session.close();
  }
});

test("an element of a toolkit that takes the keyboard, and shows nothing put inside it, does not swallow the widget", async () => {
  // UI5's menu entries: custom elements whose shadow root has no slot, so a child put in them is never drawn.
  const page = `<h1>Files</h1><button id="open" type="button">Open menu</button>
    <div id="menu" role="menu" hidden style="position:absolute;top:60px;left:24px;padding:4px;background:#fff;border:1px solid #999"><x-item id="sub"></x-item></div>
    <script>
      customElements.define('x-item', class extends HTMLElement {
        connectedCallback() { this.attachShadow({ mode: 'open' }).innerHTML = '<li role="menuitem" tabindex="-1">Open from the cloud</li>'; }
        focus() { this.shadowRoot.querySelector('li').focus(); }
      });
      document.getElementById('open').addEventListener('click', () => {
        document.getElementById('menu').hidden = false;
        setTimeout(() => document.getElementById('sub').focus(), 1200);
      });
    </script>`;
  const session = await start(page, () => words("Choose Open from the cloud."));
  try {
    await session.page.locator("#open").click();
    await session.page.locator("haptic-root .launcher").click();
    await session.page.keyboard.type("what can I do here", { delay: 90 });
    const state = await session.page.evaluate(() => {
      const host = document.querySelector("haptic-root") ?? document.querySelector("x-item haptic-root");
      return { drawn: !!host && host.getClientRects().length > 0, typed: (host!.shadowRoot!.querySelector(".ask textarea") as HTMLTextAreaElement).value };
    });
    assert.ok(state.drawn, "the widget is not drawn");
    assert.equal(state.typed, "what can I do here");
  } finally {
    await session.close();
  }
});
