import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// The visitor scrolls the control the pointer is on out of the window. The
// pointer and its sentence are drawn over the window, not the page, so left
// alone they would stay where they were and point at whatever scrolled under
// them. Instead the pointer is put away, and the sentence waits at the edge of
// the window the control went off, led by a button that scrolls back to it,
// until the control is in the window again.

type Box = { left: number; top: number; right: number; bottom: number };

/** What a visitor sees of Haptic: the pointer and ring, if drawn, the caption's box and words, if on show, and the way back, if it shows. */
async function drawn(session: Session): Promise<{ pointer?: Box; ring?: Box; caption?: Box & { text: string }; way?: string }> {
  // Written without named functions inside, which the test runner's compiler would wrap in a helper the page lacks.
  const [pointer, ring, caption, text, way] = await session.page.evaluate(() => {
    const root = document.querySelector("haptic-root")!.shadowRoot!;
    return [".cursor", ".ring", ".caption", ".caption span", ".caption .where"].map((selector) => {
      const el = root.querySelector(selector) as HTMLElement;
      if (selector.endsWith("span")) return el.textContent ?? "";
      if (el.hidden) return undefined;
      if (selector.endsWith(".where")) return el.getAttribute("aria-label") ?? "";
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
  });
  return {
    pointer: pointer as Box | undefined,
    ring: ring as Box | undefined,
    caption: caption ? { ...(caption as Box), text: text as string } : undefined,
    way: way as string | undefined,
  };
}

const box = async (session: Session, selector: string): Promise<Box> => {
  const rect = (await session.page.locator(selector).boundingBox())!;
  return { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height };
};

const LONG = `<header style="height:60px;display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:0 24px">
    <a href="#pricing">Pricing</a><button id="signin" type="button">Sign in</button></header>
  <main><h1>Meet the product</h1>${Array.from({ length: 40 }, (_, n) => `<p style="height:60px">Paragraph ${n + 1}</p>`).join("")}</main>
  <footer style="height:60px"><button id="contact" type="button">Contact us</button></footer>`;

const SENTENCE = "Click Sign in in the top bar.";

test("a control scrolled out of the window takes the pointer with it, and the sentence waits at the edge it went off", async () => {
  const session = await start(LONG, (request, index) => (index === 0 ? point(request, "Sign in", SENTENCE) : words("You are signed in.")));
  try {
    await session.ask("how do I sign in");
    await session.untilState("pointing");
    await session.page.waitForTimeout(700);
    const first = await drawn(session);
    assert.ok(first.pointer && first.ring && first.caption, "the pointer, ring and caption are not all on show to begin with");
    assert.equal(first.way, undefined, "the way back shows with Sign in in the window");

    // Scrolled down by more than a window: Sign in is above the top of the window.
    await session.page.evaluate(() => window.scrollTo(0, 1200));
    await session.page.waitForTimeout(300);
    assert.ok((await box(session, "#signin")).bottom < 0, "Sign in is still in the window");
    const away = await drawn(session);
    assert.equal(away.ring, undefined, "the ring is still drawn with nothing under it");
    assert.equal(away.pointer, undefined, `the pointer is left floating in the window at ${JSON.stringify(away.pointer)}`);
    assert.ok(away.caption, "the sentence went away: the visitor no longer knows what to do");
    assert.equal(away.caption.text, SENTENCE);
    assert.equal(away.way, "Scroll up to it");
    assert.ok(away.caption.top <= 16, `the sentence is not at the top edge of the window: its top is at ${away.caption.top}`);
    // Still pointing: the guide waits on the same control.
    assert.equal(await session.pointed(), "signin");
    assert.equal(await session.state(), "pointing");

    // Scrolled back: everything is round Sign in again, and the way back has gone.
    await session.page.evaluate(() => window.scrollTo(0, 0));
    await session.page.waitForTimeout(300);
    const back = await drawn(session);
    const signIn = await box(session, "#signin");
    assert.ok(back.pointer && back.ring && back.caption, "the pointer, ring and caption did not come back with Sign in");
    assert.ok(Math.abs(back.ring.left + 4 - signIn.left) < 2 && Math.abs(back.ring.top + 4 - signIn.top) < 2, "the ring is not round Sign in");
    assert.equal(back.caption.text, SENTENCE);
    assert.equal(back.way, undefined, "the way back still shows with Sign in in the window");
    assert.ok(back.caption.top >= signIn.bottom, "the sentence is not below Sign in");

    // The way back, pressed, scrolls Sign in into the window, and clicking it is still the step.
    await session.page.evaluate(() => window.scrollTo(0, 1200));
    await session.page.waitForTimeout(300);
    await session.page.locator("haptic-root .caption .where").click();
    await session.until(async () => (await box(session, "#signin")).top >= 0 && !!(await drawn(session)).pointer, "Sign in and the pointer to come back into the window", 3000);
    assert.equal(await session.state(), "pointing", "pressing the way back ended the guide");
    await session.page.locator("#signin").click();
    const second = await session.untilAsked(2);
    assert.match(second.event ?? "", /^The user clicked button "Sign in"\./);
  } finally {
    await session.close();
  }
});

test("a control below the window is said to be below, with the sentence at the bottom edge", async () => {
  const session = await start(LONG, (request, index) => (index === 0 ? point(request, "Contact us", "Click Contact us at the foot of the page.") : words("Done.")));
  try {
    await session.ask("how do I get in touch");
    await session.untilState("pointing");
    // The guide scrolls a control below the window into it. Until it is there, nothing of ours floats over the page.
    await session.until(async () => !!(await drawn(session)).ring, "the ring to go round Contact us", 3000);
    await session.page.waitForTimeout(300);
    await session.page.evaluate(() => window.scrollTo(0, 0));
    await session.page.waitForTimeout(300);
    const height = await session.page.evaluate(() => window.innerHeight);
    assert.ok((await box(session, "#contact")).top > height, "Contact us is still in the window");
    const away = await drawn(session);
    assert.equal(away.pointer, undefined, "the pointer is left floating in the window");
    assert.ok(away.caption, "the sentence went away");
    assert.equal(away.way, "Scroll down to it");
    assert.ok(away.caption.bottom >= height - 16, `the sentence is not at the bottom edge: its bottom is at ${away.caption.bottom} of ${height}`);
    // The launcher keeps off the sentence, on the other side if it has to.
    const dock = await session.page.evaluate(() => {
      const rect = document.querySelector("haptic-root")!.shadowRoot!.querySelector(".dock")!.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
    const overlaps = dock.left < away.caption.right && away.caption.left < dock.right && dock.top < away.caption.bottom && away.caption.top < dock.bottom;
    assert.ok(!overlaps, "the launcher is over the sentence");
  } finally {
    await session.close();
  }
});
