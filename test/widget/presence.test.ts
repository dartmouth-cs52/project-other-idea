import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// Haptic's own presence on a page: what it does to the page's open lists and
// menus when the visitor goes to its box, and what of it runs when no guide is.

/**
 * A menu that closes on a press outside it, heard the way the toolkits hear
 * one: `how` is the event, `on` and `capture` where it is listened for. Ant
 * Design listens for the mouse going down on the window, in the capture
 * phase; Material UI for the click on the document; Fluent UI for the click
 * on the document, in the capture phase; others for the pointer going down,
 * or for the keyboard going somewhere else.
 */
const menuClosingOn = (how: string, on: "window" | "document", capture: boolean) => `<h1>Orders</h1>
  <button id="more" type="button">More actions</button><button type="button">Export</button>
  <ul id="menu" role="menu" hidden style="position:absolute;top:80px;left:24px;margin:0;padding:4px;list-style:none;background:#fff;border:1px solid #999">
    <li role="menuitem" tabindex="-1">Archive</li><li role="menuitem" tabindex="-1">Duplicate</li>
  </ul>
  <script>
    const menu = document.getElementById('menu'), more = document.getElementById('more');
    more.addEventListener('click', () => { menu.hidden = false; });
    ${on}.addEventListener(${JSON.stringify(how)}, (event) => {
      const into = event.composedPath()[0];
      if (!menu.hidden && !menu.contains(into) && !more.contains(into)) menu.hidden = true;
    }, ${capture});
  </script>`;

/** Clicks Haptic's launcher and types a question with the real mouse and keyboard, as a visitor does. */
async function askByHand(session: Session, question: string): Promise<void> {
  const box = await session.page.evaluate(() => {
    const rect = document.querySelector("haptic-root")!.shadowRoot!.querySelector(".launcher")!.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await session.page.mouse.click(box.x, box.y);
  await session.page.waitForTimeout(150);
  await session.page.keyboard.type(question, { delay: 15 });
}

for (const [how, on, capture] of [
  ["mousedown", "window", true],
  ["click", "document", false],
  ["click", "document", true],
  ["pointerdown", "document", false],
  ["focusin", "document", false],
] as const) {
  test(`going to Haptic's box leaves open a menu that closes on a ${how} outside it, heard on the ${on}${capture ? " in the capture phase" : ""}`, async () => {
    const session = await start(menuClosingOn(how, on, capture), () => words("Choose Archive."));
    try {
      await session.page.locator("#more").click();
      await askByHand(session, "which one archives it");
      assert.equal(await session.page.evaluate(() => (document.getElementById("menu") as HTMLElement).hidden), false, "the menu closed when the visitor went to Haptic's box");
      await session.page.keyboard.press("Enter");
      const first = await session.untilAsked(1, 5000);
      assert.equal(first.goal, "which one archives it");
      assert.ok(first.snapshot.elements.some((element) => element.role === "menuitem" && element.label === "Archive"), "the open menu was not in the list sent");
    } finally {
      await session.close();
    }
  });
}

test("the ask box still takes the cursor where it is pressed, and text can be selected in it", async () => {
  const session = await start(menuClosingOn("mousedown", "window", true), () => words("Choose Archive."));
  try {
    await askByHand(session, "archive it");
    const input = session.page.locator("haptic-root .panel input");
    const box = (await input.boundingBox())!;
    // Press near the start of the words, then type: the letter goes where the press was.
    await session.page.mouse.click(box.x + 14, box.y + box.height / 2);
    await session.page.keyboard.type("X");
    const value = await input.inputValue();
    assert.notEqual(value, "archive itX", "the press did not move the cursor");
    assert.ok(value.includes("X"), "nothing was typed");
    await input.dblclick();
    const selected = await input.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!);
    assert.ok(selected > 0, "a double click selects nothing in the ask box");
  } finally {
    await session.close();
  }
});

/**
 * A page that counts, from before the widget loads, every timer and frame
 * callback the widget's script sets that runs, every observer it leaves
 * watching, and every listener it leaves on the document or the window. What
 * the test's browser adds of its own is not the widget's, and is told apart by
 * where it was set from.
 */
const COUNTED = `<h1>Account</h1><button id="save" type="button">Save</button>
  <script>
    const counts = (window.__counts = { calls: 0, observers: 0, listeners: 0 });
    const ours = () => /widget\\.js/.test(new Error().stack || '');
    for (const name of ['setTimeout', 'setInterval', 'requestAnimationFrame']) {
      const original = window[name];
      window[name] = function (callback, ...rest) {
        const counted = typeof callback === 'function' && ours() ? function (...args) { counts.calls++; return callback.apply(this, args); } : callback;
        return original.call(window, counted, ...rest);
      };
    }
    for (const Observer of [MutationObserver, PerformanceObserver]) {
      const observe = Observer.prototype.observe, disconnect = Observer.prototype.disconnect;
      Observer.prototype.observe = function (...args) { if (!this.__on && ours()) { this.__on = true; counts.observers++; } return observe.apply(this, args); };
      Observer.prototype.disconnect = function () { if (this.__on) { this.__on = false; counts.observers--; } return disconnect.apply(this); };
    }
    const kept = new Set();
    for (const target of [window, document]) {
      const add = target.addEventListener, remove = target.removeEventListener;
      const key = (type, listener, options) => [target === window ? 'w' : 'd', type, typeof options === 'boolean' ? options : !!(options && options.capture), listener && (listener.__id ??= Math.random())].join(':');
      target.addEventListener = function (type, listener, options) { const k = key(type, listener, options); if (!kept.has(k) && ours()) { kept.add(k); counts.listeners++; } return add.call(this, type, listener, options); };
      target.removeEventListener = function (type, listener, options) { const k = key(type, listener, options); if (kept.delete(k)) counts.listeners--; return remove.call(this, type, listener, options); };
    }
  </script>`;

/** How many of our callbacks run in two quiet seconds, and how many observers and listeners are left. */
async function quietCounts(session: Session): Promise<{ calls: number; observers: number; listeners: number }> {
  await session.page.waitForTimeout(1500);
  const before = await session.page.evaluate(() => (window as unknown as { __counts: { calls: number } }).__counts.calls);
  await session.page.waitForTimeout(2000);
  return session.page.evaluate((calls: number) => {
    const counts = (window as unknown as { __counts: { calls: number; observers: number; listeners: number } }).__counts;
    return { calls: counts.calls - calls, observers: counts.observers, listeners: counts.listeners };
  }, before);
}

test("nothing of Haptic's runs on a page where no guide is running: no timer, no frame, no observer, no listener", async () => {
  const session = await start(COUNTED, () => words("Saving is done with the Save button at the top."));
  try {
    // The widget's own start-up listener for the page to finish loading is gone once it has.
    const idle = await quietCounts(session);
    assert.deepEqual(idle, { calls: 0, observers: 0, listeners: 0 }, "before any question");
    await session.ask("how do I save");
    await session.untilState("finished");
    await session.page.locator("haptic-root .caption .close").click();
    const after = await quietCounts(session);
    assert.deepEqual(after, { calls: 0, observers: 0, listeners: 0 }, "after a guide is over and put away");
  } finally {
    await session.close();
  }
});

test("a dialog that keeps the keyboard, opened while nothing of Haptic's was running, still lets a question be asked", async () => {
  const page = `<h1>Projects</h1><button id="new" type="button">New project</button>
    <div id="dialog" role="dialog" aria-modal="true" aria-label="New project" hidden style="position:fixed;inset:20% 30%;background:#fff;border:1px solid #333;padding:16px">
      <label>Project name <input id="name"></label><button type="button">Create</button>
    </div>
    <script>
      const dialog = document.getElementById('dialog');
      document.getElementById('new').addEventListener('click', () => { dialog.hidden = false; document.getElementById('name').focus(); });
      // The keyboard is kept inside the dialog, as focus traps do it: whenever it goes anywhere else, it is taken back.
      document.addEventListener('focus', () => { if (!dialog.hidden && !dialog.contains(document.activeElement)) document.getElementById('name').focus(); }, true);
    </script>`;
  const session = await start(page, () => words("Type a name, then click Create."));
  try {
    await session.page.waitForTimeout(1500);
    await session.page.locator("#new").click();
    await askByHand(session, "what goes in here");
    await session.page.keyboard.press("Enter");
    const first = await session.untilAsked(1, 5000).catch(() => undefined);
    assert.ok(first, "the question never reached the ask box");
    assert.equal(first.goal, "what goes in here");
  } finally {
    await session.close();
  }
});

test("Haptic's buttons work with the mouse and with the keyboard, and a question is sent with its button or with Enter", async () => {
  const session = await start(menuClosingOn("click", "document", true), () => words("Choose Archive."));
  try {
    const panelOpen = () => session.page.evaluate(() => !(document.querySelector("haptic-root")!.shadowRoot!.querySelector(".panel") as HTMLElement).hidden);
    // The launcher from the keyboard: Tab to it, then Enter.
    await session.page.evaluate(() => (document.querySelector("haptic-root")!.shadowRoot!.querySelector(".launcher") as HTMLElement).focus());
    await session.page.keyboard.press("Enter");
    await session.until(panelOpen, "the launcher to open the box from the keyboard");
    await session.page.keyboard.type("first question");
    // The send button with the mouse.
    await session.page.locator("haptic-root .send").click();
    const first = await session.untilAsked(1, 5000);
    assert.equal(first.goal, "first question");
    await session.untilState("finished");
    // The caption's close button with the mouse puts the sentence away.
    await session.page.locator("haptic-root .caption .close").click();
    assert.equal(await session.caption(), "", "the close button did not put the sentence away");
    // The launcher with the mouse closes the box and opens it again, once for each click.
    const before = await panelOpen();
    await session.page.locator("haptic-root .launcher").click();
    assert.equal(await panelOpen(), !before, "one click on the launcher did not open or close the box once");
    await session.page.locator("haptic-root .launcher").click();
    assert.equal(await panelOpen(), before);
  } finally {
    await session.close();
  }
});
