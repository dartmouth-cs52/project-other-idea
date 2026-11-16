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
    const input = session.page.locator("haptic-root .ask input");
    const box = (await input.boundingBox({ timeout: 5000 }))!;
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
 * watching, and every listener it leaves on the document or the window, by
 * where it is, its type and its phase ("d:toggle:true"). What the test's
 * browser adds of its own is not the widget's, and is told apart by where it
 * was set from.
 */
const COUNTED = `<h1>Account</h1><button id="save" type="button">Save</button>
  <dialog id="native"><p>Native dialog</p><button id="close-native" type="button">Close</button></dialog>
  <div id="layer" popover="manual" style="position:fixed;inset:0;margin:0;width:100vw;height:100vh;max-width:none;max-height:none;border:0;background:rgba(0,0,0,.4)">
    <div role="dialog" aria-label="Order" style="position:absolute;left:30%;top:30%;width:40%;background:#fff;padding:16px"><button id="close-layer" type="button">Close</button></div>
  </div>
  <script>
    document.getElementById('close-native').addEventListener('click', () => document.getElementById('native').close());
    document.getElementById('close-layer').addEventListener('click', () => document.getElementById('layer').hidePopover());
    const counts = (window.__counts = { calls: 0, observers: 0, listeners: 0, kept: [] });
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
    // Where, of what type and in which phase each listener of ours is, without its own number.
    counts.kept = () => [...kept].map((k) => k.split(':').slice(0, 3).join(':')).sort();
  </script>`;

/** How many of our callbacks run in two quiet seconds, how many observers are left, and the listeners left, by where, type and phase. */
async function quietCounts(session: Session, during?: () => Promise<void>): Promise<{ calls: number; observers: number; listeners: string[] }> {
  await session.page.waitForTimeout(1500);
  const before = await session.page.evaluate(() => (window as unknown as { __counts: { calls: number } }).__counts.calls);
  await during?.();
  await session.page.waitForTimeout(2000);
  return session.page.evaluate((calls: number) => {
    const counts = (window as unknown as { __counts: { calls: number; observers: number; kept: () => string[] } }).__counts;
    return { calls: counts.calls - calls, observers: counts.observers, listeners: counts.kept() };
  }, before);
}

/**
 * The listeners of Haptic's allowed while nothing is in use: a page's dialog
 * or popover opening on the top layer, heard on the document in the capture
 * phase, and the window changing size, which can bring a control of the
 * page's under the launcher. And, while the site learns from visits
 * (learn.ts), a passive click listener and the address watcher's popstate and
 * hashchange (navigation.ts, which in Chromium watches through the Navigation
 * API, with no timer). No timer, frame or observer of Haptic's runs.
 */
const IDLE = { calls: 0, observers: 0, listeners: ["d:click:true", "d:toggle:true", "w:hashchange:false", "w:popstate:false", "w:resize:false"] };

test("nothing of Haptic's runs on a page where no guide is running: no timer, no frame, no observer, and no listener but those for the top layer, the window's size and learning the site", async () => {
  const session = await start(COUNTED, () => words("Saving is done with the Save button at the top."));
  try {
    // The widget's own start-up listener for the page to finish loading is gone once it has.
    const idle = await quietCounts(session);
    assert.deepEqual(idle, IDLE, "before any question");
    await session.ask("how do I save");
    await session.untilState("finished");
    await session.page.locator("haptic-root .caption .close").click();
    // The ask box stays open after a guide, asking whether it helped: in use until the visitor puts it away too.
    assert.equal(await session.page.locator("haptic-root .helped").isVisible(), true, "Did this help? was not asked");
    await session.page.locator("haptic-root .launcher").click();
    const after = await quietCounts(session);
    assert.deepEqual(after, IDLE, "after a guide is over and put away");
    // The page opens and closes its dialogs while nothing is in use: the one listener places the widget, and leaves nothing running.
    const dialogs = await quietCounts(session, async () => {
      await session.page.evaluate(() => (document.getElementById("native") as HTMLDialogElement).showModal());
      await session.page.waitForTimeout(300);
      await session.page.evaluate(() => (document.getElementById("native") as HTMLDialogElement).close());
      await session.page.evaluate(() => (document.getElementById("layer") as HTMLElement).showPopover());
      await session.page.waitForTimeout(300);
      await session.page.evaluate(() => (document.getElementById("layer") as HTMLElement).hidePopover());
    });
    assert.deepEqual(dialogs, IDLE, "after the page opened and closed its dialogs");
    // A resize while nothing is in use: the launcher's corner is looked at once a frame at most, and nothing is left running.
    const resized = await quietCounts(session, async () => {
      for (const width of [1200, 1000, 900]) {
        await session.page.setViewportSize({ width, height: 800 });
        await session.page.waitForTimeout(50);
      }
    });
    assert.ok(resized.calls >= 1 && resized.calls <= 3, `the launcher's corner was looked at ${resized.calls} times for three sizes`);
    assert.deepEqual({ ...resized, calls: 0 }, IDLE, "after the window was resized");
    assert.deepEqual(await quietCounts(session), IDLE, "once the window was left alone");
  } finally {
    await session.close();
  }
});

/** What a press at the middle of Haptic's launcher would land on. */
async function onLauncher(session: Session): Promise<string | undefined> {
  return session.page.evaluate(() => {
    const rect = document.querySelector("haptic-root")!.shadowRoot!.querySelector(".launcher")!.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.tagName.toLowerCase();
  });
}

test("a dialog the page opens on the top layer while no guide runs does not cover the launcher, which still opens the ask box", async () => {
  const session = await start(COUNTED, () => words("Click Close."));
  try {
    await session.page.waitForTimeout(1500);
    // The browser's own modal dialog: everything outside it is inert, so the widget goes inside it.
    await session.page.evaluate(() => (document.getElementById("native") as HTMLDialogElement).showModal());
    await session.until(async () => (await onLauncher(session)) === "haptic-root", "the launcher to be on top of the modal dialog", 3000);
    await session.ask("how do I close this");
    const first = await session.untilAsked(1, 5000);
    assert.equal(first.goal, "how do I close this");
    assert.equal(first.snapshot.dialog, "Native dialog", "the question was not asked about the open dialog");
    await session.untilState("finished");
    await session.page.locator("haptic-root .caption .close").click();
    await session.page.evaluate(() => (document.getElementById("native") as HTMLDialogElement).close());
    await session.until(() => session.page.evaluate(() => document.querySelector("haptic-root")?.parentElement === document.documentElement), "the widget to be back on the page once the dialog closed", 3000);
    // A UI5 dialog: a popover of its own with a layer that blocks the page behind it.
    await session.page.evaluate(() => (document.getElementById("layer") as HTMLElement).showPopover());
    await session.until(async () => (await onLauncher(session)) === "haptic-root", "the launcher to be on top of the page's popover", 3000);
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

const parentOfHaptic = (session: Session) => session.page.evaluate(() => {
  const parent = document.querySelector("haptic-root")?.parentElement ?? (document.querySelector("*:not(html) haptic-root") as Element | null)?.parentElement;
  return parent ? parent.id || parent.tagName.toLowerCase() : "";
});

test("a calendar drawn as a dialog over part of the page, which shuts nothing out, is not where the widget goes", async () => {
  // Material UI's and Fluent UI's date pickers: role "dialog", no aria-modal, no backdrop, often in the middle of the window.
  const page = `<h1>Booking</h1><button id="pick" type="button">Choose date</button>
    <div id="calendar" role="dialog" aria-label="Choose date" hidden style="position:fixed;left:25%;top:20%;width:50%;height:60%;background:#fff;border:1px solid #999">
      ${Array.from({ length: 28 }, (_, day) => `<button type="button">${day + 1}</button>`).join("")}
    </div>
    <script>document.getElementById('pick').addEventListener('click', () => { document.getElementById('calendar').hidden = false; });</script>`;
  const session = await start(page, () => words("Click 15."));
  try {
    await session.page.locator("#pick").click();
    await askByHand(session, "which day is free");
    await session.page.waitForTimeout(700);
    assert.equal(await parentOfHaptic(session), "html", "the widget moved into the calendar");
    await session.page.keyboard.press("Enter");
    const first = await session.untilAsked(1, 5000);
    assert.equal(first.goal, "which day is free");
  } finally {
    await session.close();
  }
});

test("a question being typed is not lost when the list the widget moved into goes away", async () => {
  // A list that keeps the keyboard to itself takes the widget in. The page then takes the list away while the visitor types.
  const page = `<h1>Filters</h1><button id="open" type="button">Status</button>
    <div id="pop" hidden style="position:fixed;inset:0">
      <ul id="menu" role="listbox" tabindex="-1" style="position:absolute;top:60px;left:24px;margin:0;padding:4px;list-style:none;background:#fff;border:1px solid #999"><li role="option">Open</li><li role="option">Closed</li></ul>
    </div>
    <script>
      const pop = document.getElementById('pop'), menu = document.getElementById('menu');
      document.getElementById('open').addEventListener('click', () => { pop.hidden = false; menu.focus(); });
      document.addEventListener('focus', () => { if (pop.isConnected && !pop.hidden && !pop.contains(document.activeElement)) menu.focus(); }, true);
      window.takeAway = () => pop.remove();
    </script>`;
  const session = await start(page, () => words("Choose Open."));
  try {
    await session.page.locator("#open").click();
    await askByHand(session, "which status ");
    assert.ok(await session.page.evaluate(() => !!document.querySelector("#pop haptic-root")), "the widget did not move into the list that keeps the keyboard");
    await session.page.evaluate(() => (window as unknown as { takeAway: () => void }).takeAway());
    await session.page.keyboard.type("is open", { delay: 15 });
    await session.page.keyboard.press("Enter");
    const first = await session.untilAsked(1, 5000).catch(() => undefined);
    assert.ok(first, "the question was lost");
    assert.equal(first.goal, "which status is open");
    assert.equal(await parentOfHaptic(session), "html");
  } finally {
    await session.close();
  }
});

test("a dialog the page puts on the top layer after the widget does not cover the widget while it is in use", async () => {
  // UI5's dialog: a popover of its own, shown over everything with a layer that blocks the page behind it.
  const page = `<h1>Orders</h1><button id="open" type="button">Open dialog</button>
    <div id="dialog" popover="manual" style="position:fixed;inset:0;margin:0;width:100vw;height:100vh;max-width:none;max-height:none;border:0;background:rgba(0,0,0,.4)">
      <div role="dialog" aria-label="Order" style="position:absolute;left:30%;top:30%;width:40%;background:#fff;padding:16px"><button type="button">Close</button></div>
    </div>
    <script>document.getElementById('open').addEventListener('click', () => setTimeout(() => document.getElementById('dialog').showPopover(), 300));</script>`;
  const session = await start(page, () => words("Click Close."));
  try {
    await session.page.locator("#open").click();
    // The box is opened before the dialog shows, so the widget is in use when the page covers it.
    const launcher = await session.page.evaluate(() => {
      const rect = document.querySelector("haptic-root")!.shadowRoot!.querySelector(".launcher")!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await session.page.mouse.click(launcher.x, launcher.y);
    await session.page.waitForTimeout(1200);
    const hit = await session.page.evaluate(({ x, y }: { x: number; y: number }) => document.elementFromPoint(x, y)?.tagName.toLowerCase(), launcher);
    assert.equal(hit, "haptic-root", "the page's dialog covers the widget");
    await session.page.keyboard.type("how do I close this", { delay: 15 });
    await session.page.keyboard.press("Enter");
    const first = await session.untilAsked(1, 5000);
    assert.equal(first.goal, "how do I close this");
  } finally {
    await session.close();
  }
});
