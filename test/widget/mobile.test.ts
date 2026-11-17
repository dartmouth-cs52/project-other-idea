import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// Haptic on a phone. A phone shows less than the window the page is laid out
// in, and Haptic draws against that window: zoomed in, by a pinch or by the
// phone itself as a small field takes the keyboard, it showed the ring beside
// the control and the chat off the side of the screen. On a page wider than
// the phone, the launcher was off the screen altogether. With the keyboard up
// the chat was under it. These open each page as an iPhone does, with its
// screen, its touch and its zoom, and look at where what Haptic draws lands
// on the part of the page the visitor can see.

const PHONE = "iPhone 13";

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/** A whole page laid out for a phone, as a site that works on one has it. */
const phonePage = (body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Phone page</title>
  <style>body{font:16px system-ui;margin:16px}button{font:inherit;padding:8px 12px}</style></head><body>${body}</body></html>`;

/**
 * Measures as Safari does: every box from the part of the page on the screen,
 * not from the window the page is laid out in, and the window's size as the
 * size of that part. Chrome measures from the window, so on its own it never
 * showed the ring off its control. The true measures are kept, for the test.
 */
const SAFARI = `(() => {
  if (Element.prototype.trueRect) return;
  const shown = window.visualViewport;
  const shift = (r) => new DOMRect(r.x - shown.offsetLeft, r.y - shown.offsetTop, r.width, r.height);
  const rect = Element.prototype.getBoundingClientRect, rects = Element.prototype.getClientRects;
  const rangeRect = Range.prototype.getBoundingClientRect, rangeRects = Range.prototype.getClientRects;
  const at = Document.prototype.elementFromPoint, all = Document.prototype.elementsFromPoint;
  const list = (found) => { const out = Array.from(found, shift); out.item = (i) => out[i] ?? null; return out; };
  Object.defineProperty(Element.prototype, "trueRect", { value: rect });
  Element.prototype.getBoundingClientRect = function () { return shift(rect.call(this)); };
  Element.prototype.getClientRects = function () { return list(rects.call(this)); };
  Range.prototype.getBoundingClientRect = function () { return shift(rangeRect.call(this)); };
  Range.prototype.getClientRects = function () { return list(rangeRects.call(this)); };
  Document.prototype.elementFromPoint = function (x, y) { return at.call(this, x + shown.offsetLeft, y + shown.offsetTop); };
  Document.prototype.elementsFromPoint = function (x, y) { return all.call(this, x + shown.offsetLeft, y + shown.offsetTop); };
  Object.defineProperty(window, "innerWidth", { configurable: true, get: () => shown.width });
  Object.defineProperty(window, "innerHeight", { configurable: true, get: () => shown.height });
})();`;

/** Where an element really is, measured from the window the page is laid out in, whichever way the page measures. */
const trueBox = (session: Session, selector: string): Promise<Box | null> =>
  session.page.evaluate((s: string) => {
    const [first, ...rest] = s.split(" >>> ");
    let el: Element | null | undefined = document.querySelector(first!);
    for (const part of rest) el = el?.shadowRoot?.querySelector(part);
    if (!el || (el as HTMLElement).hidden) return null;
    const measure = (Element.prototype as unknown as { trueRect?: () => DOMRect }).trueRect ?? Element.prototype.getBoundingClientRect;
    const r = measure.call(el);
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);

/** The part of the page on the screen, measured as trueBox measures, and how far it is zoomed in. */
const shown = (session: Session) =>
  session.page.evaluate(() => {
    const v = window.visualViewport!;
    return { left: v.offsetLeft, top: v.offsetTop, right: v.offsetLeft + v.width, bottom: v.offsetTop + v.height, scale: v.scale };
  });

/** Whether `inner` lies wholly inside `outer`, give or take a pixel. */
const inside = (inner: Box, outer: { left: number; top: number; right: number; bottom: number }) =>
  inner.left >= outer.left - 1 && inner.top >= outer.top - 1 && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1;

const ours = (part: string) => `haptic-root >>> ${part}`;

/** Zooms the page in as a pinch does, then brings `selector` to the middle of the screen, which moves what is shown across the page. */
async function zoomTo(session: Session, scale: number, selector: string) {
  const cdp = await session.page.context().newCDPSession(session.page);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: scale });
  await session.page.evaluate((s: string) => document.querySelector(s)!.scrollIntoView({ block: "center", inline: "center" }), selector);
  // A few frames for the pointer to follow, and its glide to end.
  await session.page.waitForTimeout(900);
}

const WIDE = phonePage(`<h1>Issue a card</h1>
  <p>Set who holds it and how much it can spend.</p>
  <div style="display:flex;gap:16px;width:620px"><button id="mine" type="button" style="width:300px">For myself</button><button id="theirs" type="button" style="width:300px">For someone else</button></div>
  <label for="name" style="display:block;margin-top:24px">Card name</label><input id="name" style="width:560px;font-size:13px">`);

test("on a page wider than the phone, the launcher and the chat stay in the corner of the screen, not of the page", async () => {
  const session = await start(WIDE, () => words("Done."), "/", { device: PHONE });
  try {
    const screen = await shown(session);
    const page = await session.page.evaluate(() => ({ laidOut: window.innerWidth, wide: document.documentElement.scrollWidth }));
    // The phone lays the page out wider than it shows it: the case to test.
    assert.ok(page.laidOut > screen.right + 100, `the page is laid out ${page.laidOut}px wide and shown ${screen.right}px wide`);
    const launcher = (await trueBox(session, ours(".launcher")))!;
    assert.ok(inside(launcher, screen), `the launcher is off the screen: ${JSON.stringify(launcher)}, the screen ${JSON.stringify(screen)}`);
    assert.ok(screen.right - launcher.right <= 30, `the launcher is not in the screen's corner: ${screen.right - launcher.right}px from its right edge`);
    await session.page.locator("haptic-root .launcher").tap();
    await session.page.waitForTimeout(300);
    const panel = (await trueBox(session, ours(".panel")))!;
    assert.ok(inside(panel, screen), `the chat is off the screen: ${JSON.stringify(panel)}, the screen ${JSON.stringify(screen)}`);
  } finally {
    await session.close();
  }
});

test("on a touch screen the ask box's words are 16px, so the phone does not zoom the page in as it takes the keyboard", async () => {
  const session = await start(WIDE, () => words("Done."), "/", { device: PHONE });
  try {
    const sizes = await session.page.evaluate(() => {
      const root = document.querySelector("haptic-root")!.shadowRoot!;
      return [".ask textarea", ".person input", ".person textarea"].map((s) => getComputedStyle(root.querySelector(s)!).fontSize);
    });
    assert.deepEqual(sizes, ["16px", "16px", "16px"]);
    await session.page.locator("haptic-root .launcher").tap();
    await session.page.locator("haptic-root .ask textarea").tap();
    await session.page.waitForTimeout(300);
    assert.equal((await shown(session)).scale, 1, "the page zoomed in");
  } finally {
    await session.close();
  }
});

const FORM = phonePage(`<h1>Expenses</h1><p>Every card charge across the company.</p>
  ${Array.from({ length: 6 }, (_, n) => `<p>Row ${n + 1} of a long list of charges, with words enough to fill the line.</p>`).join("")}
  <div style="position:relative;height:40px"><button id="export" type="button" style="position:absolute;left:180px">Export</button></div>
  ${Array.from({ length: 30 }, (_, n) => `<p>Row ${n + 7}</p>`).join("")}`);

for (const measures of ["Chrome", "Safari"] as const) {
  test(`zoomed in and moved across the page, the ring stays round the control and the launcher stays on the screen at its own size, measured as ${measures} measures`, async () => {
    const session = await start(FORM, (request, index) => (index === 0 ? point(request, "Export", "Tap Export to download your expenses.") : words("Done.")), "/", { device: PHONE });
    try {
      if (measures === "Safari") await session.page.evaluate(SAFARI);
      await session.ask("how do I export");
      await session.untilState("pointing");
      await zoomTo(session, 2, "#export");
      const screen = await shown(session);
      assert.equal(screen.scale, 2);
      assert.ok(screen.left > 40 && screen.top > 40, `the screen did not move across the page: ${JSON.stringify(screen)}`);
      const control = (await trueBox(session, "#export"))!;
      const ring = (await trueBox(session, ours(".ring")))!;
      assert.ok(ring, "the ring is not on show");
      // The ring stands 4px off the control all round.
      for (const side of ["left", "top", "right", "bottom"] as const) {
        const off = side === "left" || side === "top" ? control[side] - ring[side] : ring[side] - control[side];
        assert.ok(Math.abs(off - 4) <= 1.5, `the ring is ${off}px off the control's ${side} edge, not 4: ring ${JSON.stringify(ring)}, control ${JSON.stringify(control)}`);
      }
      const caption = (await trueBox(session, ours(".caption")))!;
      assert.ok(inside(caption, screen), `the sentence is off the screen: ${JSON.stringify(caption)}, the screen ${JSON.stringify(screen)}`);
      const launcher = (await trueBox(session, ours(".launcher")))!;
      assert.ok(inside(launcher, screen), `the launcher is off the screen: ${JSON.stringify(launcher)}, the screen ${JSON.stringify(screen)}`);
      // Zoomed in twice over, it is half its size on the page, so it looks its usual size on the screen.
      assert.ok(Math.abs(launcher.height * screen.scale - 40) <= 2, `the launcher is ${launcher.height * screen.scale}px tall on the screen, not 40`);
    } finally {
      await session.close();
    }
  });
}

test("with the keyboard up, the chat moves up above it", async () => {
  const session = await start(FORM, () => words("Done."), "/", { device: PHONE });
  try {
    await session.page.locator("haptic-root .launcher").tap();
    await session.page.waitForTimeout(300);
    const before = (await trueBox(session, ours(".panel")))!;
    // The keyboard: the window stays as it is and less of it can be seen, as on an iPhone. The browser says so on visualViewport.
    const keyboard = 300;
    await session.page.evaluate(`(() => {
      const real = window.visualViewport;
      const fake = {
        get width() { return real.width; },
        get height() { return real.height - ${keyboard}; },
        get offsetLeft() { return real.offsetLeft; },
        get offsetTop() { return real.offsetTop; },
        get pageLeft() { return real.pageLeft; },
        get pageTop() { return real.pageTop; },
        get scale() { return real.scale; },
        addEventListener: real.addEventListener.bind(real),
        removeEventListener: real.removeEventListener.bind(real),
      };
      Object.defineProperty(window, "visualViewport", { configurable: true, get: () => fake });
      real.dispatchEvent(new Event("resize"));
    })()`);
    await session.page.waitForTimeout(300);
    const above = await session.page.evaluate(() => window.visualViewport!.height);
    const panel = (await trueBox(session, ours(".panel")))!;
    const launcher = (await trueBox(session, ours(".launcher")))!;
    assert.ok(launcher.bottom <= above, `the launcher is under the keyboard: its bottom is ${launcher.bottom}, the keyboard's top ${above}`);
    assert.ok(Math.abs(before.top - keyboard - panel.top) <= 2, `the chat did not move up by the keyboard's height: from ${before.top} to ${panel.top}`);
  } finally {
    await session.close();
  }
});

test("on a phone, the chat steps aside while a step is shown, and the launcher brings it back", async () => {
  const session = await start(FORM, (request, index) => (index === 0 ? point(request, "Export", "Tap Export to download your expenses.") : words("Done.")), "/", { device: PHONE });
  try {
    await session.ask("how do I export");
    await session.untilState("pointing");
    await session.page.waitForTimeout(700);
    assert.equal(await session.page.locator("haptic-root .panel").isVisible(), false, "the chat covers the page while the step is shown");
    assert.ok(await trueBox(session, ours(".ring")), "the ring is not on show");
    assert.equal(await session.page.locator("haptic-root .launcher").isVisible(), true, "the launcher went with the chat");
    await session.page.locator("haptic-root .launcher").tap();
    await session.page.waitForTimeout(700);
    assert.equal(await session.page.locator("haptic-root .panel").isVisible(), true, "the launcher did not bring the chat back, or it went away again");
    assert.equal(await session.state(), "pointing", "bringing the chat back stopped the guide");
  } finally {
    await session.close();
  }
});

test("a tap leaves no hover behind: the minimize button is out while the chat is open, and goes with it", async () => {
  const session = await start(FORM, () => words("Done."), "/", { device: PHONE });
  const out = () => session.page.evaluate(() => getComputedStyle(document.querySelector("haptic-root")!.shadowRoot!.querySelector(".hide")!).opacity);
  try {
    await session.page.locator("haptic-root .launcher").tap();
    await session.page.waitForTimeout(400);
    assert.equal(await out(), "1", "the minimize button is not out while the chat is open");
    await session.page.locator("haptic-root .panel .dismiss").tap();
    await session.page.waitForTimeout(400);
    assert.equal(await session.page.locator("haptic-root .panel").isVisible(), false, "the chat did not close");
    assert.equal(await out(), "0", "the minimize button stayed out after the tap, on a closed chat");
  } finally {
    await session.close();
  }
});

const SIDEWAYS = phonePage(`<h1>Bills</h1><p>Every bill, by when it is due.</p>
  <div style="width:900px;display:flex;justify-content:space-between"><button id="near" type="button">Filters</button><button id="far" type="button">Pay now</button></div>
  <p>Some more words under the row.</p>`);

test("a control off the side of the screen gets its sentence at that side, with the way to it, and the way brings it into sight", async () => {
  const session = await start(SIDEWAYS, (request, index) => (index === 0 ? point(request, "Pay now", "Tap Pay now to pay this bill.") : words("Done.")), "/", { device: PHONE });
  try {
    await session.ask("how do I pay this bill");
    await session.untilState("pointing");
    await session.page.waitForTimeout(2000);
    const screen = await shown(session);
    const far = (await trueBox(session, "#far"))!;
    if (far.left < screen.right) {
      // The guide brought it into sight by itself: nothing to say at the side.
      assert.ok(await trueBox(session, ours(".ring")), "the ring is not on show");
      return;
    }
    const caption = (await trueBox(session, ours(".caption")))!;
    assert.ok(inside(caption, screen), `the sentence is off the screen: ${JSON.stringify(caption)}`);
    assert.ok(screen.right - caption.right <= 20, `the sentence is not at the right side: ${screen.right - caption.right}px from it`);
    assert.equal(await session.page.locator("haptic-root .caption .where").getAttribute("aria-label"), "Scroll right to it");
    await session.page.locator("haptic-root .caption .where").tap();
    await session.page.waitForTimeout(1200);
    const after = await shown(session);
    const control = (await trueBox(session, "#far"))!;
    assert.ok(inside(control, after), `the control is not in sight after the way to it was taken: ${JSON.stringify(control)}, screen ${JSON.stringify(after)}`);
    assert.ok(await trueBox(session, ours(".ring")), "the ring did not come back to the control");
  } finally {
    await session.close();
  }
});

test("on the narrowest phone the sentence, the launcher and the chat all fit on the screen", async () => {
  const session = await start(FORM, (request, index) => (index === 0 ? point(request, "Export", "Tap Export at the top right of the list to download your expenses as a spreadsheet you can open in any app.") : words("Done.")), "/", { device: "iPhone SE" });
  try {
    await session.page.setViewportSize({ width: 320, height: 568 });
    await session.page.waitForTimeout(300);
    await session.page.locator("haptic-root .launcher").tap();
    await session.page.waitForTimeout(300);
    const screen = await shown(session);
    const panel = (await trueBox(session, ours(".panel")))!;
    assert.ok(inside(panel, screen), `the chat is off the screen: ${JSON.stringify(panel)}`);
    await session.ask("how do I export");
    await session.untilState("pointing");
    await session.page.waitForTimeout(700);
    for (const part of [".caption", ".launcher", ".ring"]) {
      const box = (await trueBox(session, ours(part)))!;
      assert.ok(box && inside(box, screen), `${part} is off the screen: ${JSON.stringify(box)}, the screen ${JSON.stringify(screen)}`);
    }
  } finally {
    await session.close();
  }
});

const LONG_ANSWER =
  "Freezing a card stops new charges on it straight away. Pending charges still go through, and subscriptions on the card will fail until you unfreeze it. You can unfreeze it at any time from the card's page, and nothing about the card changes while it is frozen: the number, the limits and the holder all stay the same.";

test("on a phone on its side, an answer and the chat around it fit on the screen, and the answer is what shows", async () => {
  const session = await start(
    FORM,
    () => ({ target: null, status: "done", mode: "answer", say: LONG_ANSWER, sources: [{ title: "Freeze or unfreeze a card", url: "https://example.com/help/freeze" }] }),
    "/",
    { device: "iPhone 13 landscape" },
  );
  try {
    await session.ask("what does freezing a card do");
    await session.untilState("finished");
    await session.page.waitForTimeout(500);
    const screen = await shown(session);
    const panel = (await trueBox(session, ours(".panel")))!;
    assert.ok(inside(panel, screen), `the chat runs off the screen: ${JSON.stringify(panel)}, the screen ${JSON.stringify(screen)}`);
    // The reply's first line is in sight in the part of the chat that scrolls.
    const seen = await session.page.evaluate(() => {
      const root = document.querySelector("haptic-root")!.shadowRoot!;
      const thread = root.querySelector(".thread")!.getBoundingClientRect();
      const reply = root.querySelector(".reply p")!.getBoundingClientRect();
      return reply.top >= thread.top - 1 && reply.top + 20 <= thread.bottom;
    });
    assert.ok(seen, "the answer's first line is scrolled out of sight");
  } finally {
    await session.close();
  }
});

test("on a phone on its side, a sentence with nothing to point at goes beside the open chat when there is no room above it", async () => {
  const session = await start(FORM, () => words(LONG_ANSWER), "/", { device: "iPhone 13 landscape" });
  try {
    await session.ask("what does freezing a card do");
    await session.untilState("finished");
    await session.page.waitForTimeout(500);
    const screen = await shown(session);
    const caption = (await trueBox(session, ours(".caption")))!;
    const panel = (await trueBox(session, ours(".panel")))!;
    assert.ok(inside(caption, screen), `the sentence is off the screen: ${JSON.stringify(caption)}`);
    const overlap = caption.left < panel.right && caption.right > panel.left && caption.top < panel.bottom && caption.bottom > panel.top;
    assert.ok(!overlap, `the sentence covers the chat: ${JSON.stringify(caption)}, the chat ${JSON.stringify(panel)}`);
  } finally {
    await session.close();
  }
});

const FOOT = phonePage(`<h1>Issue a card</h1>
  ${Array.from({ length: 12 }, (_, n) => `<p>Line ${n + 1} of the form, with words enough to fill the line on a phone.</p>`).join("")}
  <div style="display:flex;justify-content:flex-end;gap:8px"><button type="button">Back</button><button id="next" type="button">Next</button></div>
  ${Array.from({ length: 12 }, (_, n) => `<p>More below ${n + 1}</p>`).join("")}`);

test("a control cut off by the foot of the screen is brought into sight, with its pointer", async () => {
  const session = await start(FOOT, (request, index) => (index === 0 ? point(request, "Next", "Tap Next to go on.") : words("Done.")), "/", { device: PHONE });
  try {
    // The button half under the foot of the screen, as the form's last button was.
    await session.page.evaluate(() => {
      const next = document.getElementById("next")!.getBoundingClientRect();
      window.scrollBy(0, next.bottom - window.visualViewport!.height - next.height / 2);
    });
    const before = (await trueBox(session, "#next"))!;
    const screen = await shown(session);
    assert.ok(before.top < screen.bottom && before.bottom > screen.bottom, `the button is not cut off by the foot of the screen to start with: ${JSON.stringify(before)}`);
    await session.ask("how do I go on");
    await session.untilState("pointing");
    await session.page.waitForTimeout(1200);
    const after = await shown(session);
    const button = (await trueBox(session, "#next"))!;
    assert.ok(inside(button, after), `the button is still cut off: ${JSON.stringify(button)}, the screen ${JSON.stringify(after)}`);
    const tip = await session.page.evaluate(() => {
      const cursor = document.querySelector("haptic-root")!.shadowRoot!.querySelector(".cursor") as HTMLElement;
      return !cursor.hidden;
    });
    assert.ok(tip, "the pointer is not on show");
  } finally {
    await session.close();
  }
});
