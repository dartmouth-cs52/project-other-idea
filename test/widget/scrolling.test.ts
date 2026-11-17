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

test("the way back puts a control from the middle of the page in the middle of the window, clear of a header that sticks", async () => {
  const paragraphs = (from: number, to: number) => Array.from({ length: to - from }, (_, n) => `<p style="height:60px;margin:0">Paragraph ${from + n}</p>`).join("");
  const page = `<header style="position:sticky;top:0;height:120px;background:#eee;z-index:5">Acme</header>
    ${paragraphs(1, 30)}<button id="export" type="button">Export</button>${paragraphs(30, 60)}`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Export", "Click Export.") : words("Exported.")));
  try {
    await session.ask("export this");
    await session.untilState("pointing");
    await session.until(async () => !!(await drawn(session)).ring, "the ring to go round Export", 3000);
    await session.page.waitForTimeout(300);
    await session.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await session.page.waitForTimeout(300);
    assert.equal((await drawn(session)).way, "Scroll up to it");
    await session.page.locator("haptic-root .caption .where").click();
    await session.until(async () => !(await drawn(session)).way, "the way back to go once Export is in the window", 3000);
    // The smooth scroll ends where it was aimed: Export's middle at the window's.
    await session.page.waitForTimeout(800);
    const exported = await box(session, "#export");
    const height = await session.page.evaluate(() => window.innerHeight);
    assert.ok(Math.abs((exported.top + exported.bottom) / 2 - height / 2) <= 2, `Export is not in the middle of the window: its top is at ${exported.top} of ${height}`);
    const ring = (await drawn(session)).ring;
    assert.ok(ring && Math.abs(ring.left + 4 - exported.left) < 2 && Math.abs(ring.top + 4 - exported.top) < 2, "the ring is not round Export");
    const hit = await session.page.evaluate(({ x, y }: { x: number; y: number }) => document.elementFromPoint(x, y)?.id, { x: (exported.left + exported.right) / 2, y: (exported.top + exported.bottom) / 2 });
    assert.equal(hit, "export", "something covers Export where it was brought to");
  } finally {
    await session.close();
  }
});

// A page wider than the window scrolls across as well as down. A control off to the side is brought into view when
// the guide points at it, and once the visitor scrolls it away again the sentence waits at that side of the window.
const WIDE = `<div style="position:relative;width:3200px;height:900px">
    <button id="near" type="button" style="position:absolute;left:40px;top:300px">Filters</button>
    <button id="far" type="button" style="position:absolute;left:2600px;top:300px">Settings</button>
  </div>`;

test("a control off to the right is scrolled into view, and once scrolled away its sentence waits at the right edge", async () => {
  const session = await start(WIDE, (request, index) => (index === 0 ? point(request, "Settings", "Click Settings.") : words("Settings are open.")));
  try {
    await session.ask("open settings");
    await session.untilState("pointing");
    // The guide brings it into the window, across.
    await session.until(async () => !!(await drawn(session)).ring && !!(await drawn(session)).pointer, "the pointer and ring to go round Settings", 3000);
    const width = await session.page.evaluate(() => document.documentElement.clientWidth);
    const brought = await box(session, "#far");
    assert.ok(brought.left >= 0 && brought.right <= width, `Settings is not in the window: it spans ${brought.left} to ${brought.right} of ${width}`);

    await session.page.evaluate(() => window.scrollTo(0, window.scrollY));
    await session.page.waitForTimeout(300);
    assert.ok((await box(session, "#far")).left >= width, "Settings is still in the window");
    const away = await drawn(session);
    assert.equal(away.ring, undefined, "the ring is still drawn");
    assert.equal(away.pointer, undefined, "the pointer is left in the window");
    assert.ok(away.caption, "the sentence went away");
    assert.equal(away.way, "Scroll right to it");
    assert.ok(away.caption.right >= width - 16, `the sentence is not at the right edge: its right is at ${away.caption.right} of ${width}`);
    const far = await box(session, "#far");
    assert.ok(away.caption.top <= far.bottom && away.caption.bottom >= far.top, "the sentence is not level with Settings");

    await session.page.locator("haptic-root .caption .where").click();
    await session.until(async () => !(await drawn(session)).way, "the way back to go once Settings is in the window", 3000);
    await session.page.waitForTimeout(800);
    const back = await box(session, "#far");
    assert.ok(back.left >= 0 && back.right <= width, `Settings was not brought into the window: it spans ${back.left} to ${back.right}`);
    const ring = (await drawn(session)).ring;
    assert.ok(ring && Math.abs(ring.left + 4 - back.left) < 2, "the ring is not round Settings");
    await session.page.locator("#far").click();
    const second = await session.untilAsked(2);
    assert.match(second.event ?? "", /^The user clicked button "Settings"\./);
  } finally {
    await session.close();
  }
});

test("a control scrolled away off the left waits at the left edge", async () => {
  const session = await start(WIDE, (request, index) => (index === 0 ? point(request, "Filters", "Click Filters.") : words("Filtered.")));
  try {
    await session.ask("filter this");
    await session.untilState("pointing");
    await session.until(async () => !!(await drawn(session)).ring, "the ring to go round Filters", 3000);
    await session.page.evaluate(() => window.scrollTo(1800, window.scrollY));
    await session.page.waitForTimeout(300);
    assert.ok((await box(session, "#near")).right <= 0, "Filters is still in the window");
    const away = await drawn(session);
    assert.equal(away.pointer, undefined, "the pointer is left in the window");
    assert.ok(away.caption, "the sentence went away");
    assert.equal(away.way, "Scroll left to it");
    assert.ok(away.caption.left <= 16, `the sentence is not at the left edge: its left is at ${away.caption.left}`);
  } finally {
    await session.close();
  }
});

test("a control parked off the side of a page that cannot scroll across is not scrolled to, and gets no way back", async () => {
  // A menu that slides in from the right, parked past the window's edge while closed, on a page that hides what
  // overflows across: a visitor cannot scroll to it, so neither does Haptic, which would shove the whole page aside.
  const page = `<style>html, body { overflow-x: hidden }</style>
    <nav style="position:absolute;top:80px;left:calc(100vw + 40px);width:240px"><a id="billing" href="#billing">Billing</a></nav>
    <button id="menu" type="button">Menu</button><h1>Dashboard</h1>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Billing", "Click Billing in the menu.") : words("Done.")));
  try {
    await session.ask("go to billing");
    await session.untilState("pointing");
    await session.page.waitForTimeout(2000);
    assert.equal(await session.page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollLeft), 0, "the page was scrolled across");
    const shown = await drawn(session);
    assert.equal(shown.pointer, undefined, "the pointer is drawn outside the window");
    assert.equal(shown.way, undefined, "a way back is offered to a control no scrolling reaches");
    assert.ok(shown.caption, "the sentence went away");
    assert.equal(shown.caption.text, "Click Billing in the menu.");
  } finally {
    await session.close();
  }
});
