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
    // The guide brings it into the window, across. The ring shows as soon as any of it does, so its scroll is let finish.
    await session.until(async () => !!(await drawn(session)).ring && !!(await drawn(session)).pointer, "the pointer and ring to go round Settings", 3000);
    await session.page.waitForTimeout(800);
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

// A box inside the page that scrolls, like a sidebar, a list or a wide table, hides what is scrolled out of it while
// that may still lie inside the window. The ring and the pointer would be drawn over whatever is beside the box, so
// they go, and the sentence waits at the edge of the box, just outside it where there is room. A control half out of
// the box has the ring round the half on show.
const SIDEBAR = `<div style="display:flex;gap:24px">
    <nav id="side" style="height:200px;width:200px;overflow-y:auto;border:1px solid #ccc">
      ${["Home", "Inbox", "Projects", "Calendar", "Reports", "Files", "People", "Teams", "Goals", "Docs", "Tasks", "Apps", "Labels", "Billing", "Help"]
        .map((name) => `<a href="#${name.toLowerCase()}" id="${name.toLowerCase()}" style="display:block;height:24px;padding:4px 8px">${name}</a>`)
        .join("")}
    </nav>
    <main><h1>Overview</h1><p id="beside">What is beside the list.</p></main>
  </div>`;

/** Where a box shows what is inside it, inside its border. */
const inside = (session: Session, selector: string): Promise<Box> =>
  session.page.evaluate((s: string) => {
    const el = document.querySelector(s)!;
    const rect = el.getBoundingClientRect();
    return { left: rect.left + el.clientLeft, top: rect.top + el.clientTop, right: rect.left + el.clientLeft + el.clientWidth, bottom: rect.top + el.clientTop + el.clientHeight };
  }, selector);

test("a control scrolled out of a box that scrolls, but still in the window, has its sentence wait just outside that box", async () => {
  const session = await start(SIDEBAR, (request, index) => (index === 0 ? point(request, "Billing", "Click Billing.") : words("Here is billing.")));
  try {
    await session.ask("where is billing");
    await session.untilState("pointing");
    // The guide scrolls the list to it.
    await session.until(async () => !!(await drawn(session)).ring, "the ring to go round Billing", 3000);
    await session.page.waitForTimeout(300);
    const side = await inside(session, "#side");
    const billing = await box(session, "#billing");
    assert.ok(billing.top >= side.top && billing.bottom <= side.bottom, "the list was not scrolled to Billing");

    // The visitor scrolls the list back to its top. Billing is in the window, below the list's edge.
    await session.page.evaluate(() => (document.getElementById("side")!.scrollTop = 0));
    await session.page.waitForTimeout(300);
    const hidden = await box(session, "#billing");
    const height = await session.page.evaluate(() => window.innerHeight);
    assert.ok(hidden.top >= side.bottom && hidden.bottom <= height, `Billing is not hidden by the list inside the window: ${JSON.stringify(hidden)}`);
    const away = await drawn(session);
    assert.equal(away.ring, undefined, `the ring is drawn outside the list, at ${JSON.stringify(away.ring)}`);
    assert.equal(away.pointer, undefined, "the pointer is drawn outside the list");
    assert.ok(away.caption, "the sentence went away");
    assert.equal(away.way, "Scroll down to it");
    assert.ok(away.caption.top >= side.bottom && away.caption.top <= side.bottom + 20, `the sentence is not just under the list: its top is at ${away.caption.top}, the list ends at ${side.bottom}`);

    // The way back scrolls the list, and Billing is still the step.
    await session.page.locator("haptic-root .caption .where").click();
    await session.until(async () => !!(await drawn(session)).ring, "the ring to come back round Billing", 3000);
    await session.page.waitForTimeout(800);
    const back = await box(session, "#billing");
    assert.ok(back.top >= side.top && back.bottom <= side.bottom, "the way back did not scroll the list to Billing");
    await session.page.locator("#billing").click();
    const second = await session.untilAsked(2);
    assert.match(second.event ?? "", /^The user clicked link "Billing"\./);
  } finally {
    await session.close();
  }
});

test("a control half out of a box that scrolls has the ring round the half on show", async () => {
  const session = await start(SIDEBAR, (request, index) => (index === 0 ? point(request, "Billing", "Click Billing.") : words("Here is billing.")));
  try {
    await session.ask("where is billing");
    await session.untilState("pointing");
    await session.until(async () => !!(await drawn(session)).ring, "the ring to go round Billing", 3000);
    await session.page.waitForTimeout(300);
    // Billing straddles the bottom edge of the list.
    await session.page.evaluate(() => {
      const side = document.getElementById("side")!;
      const billing = document.getElementById("billing")!;
      side.scrollTop += billing.getBoundingClientRect().top + billing.offsetHeight / 2 - (side.getBoundingClientRect().top + side.clientTop + side.clientHeight);
    });
    await session.page.waitForTimeout(300);
    const side = await inside(session, "#side");
    const billing = await box(session, "#billing");
    assert.ok(billing.top < side.bottom && billing.bottom > side.bottom, "Billing does not straddle the list's edge");
    const shown = await drawn(session);
    assert.ok(shown.ring, "the ring went with half of Billing on show");
    assert.ok(Math.abs(shown.ring.bottom - 4 - side.bottom) < 2, `the ring does not end at the list's edge: it ends at ${shown.ring.bottom}, the list at ${side.bottom}`);
    assert.ok(shown.pointer && shown.pointer.top < side.bottom, "the pointer is not on the half of Billing on show");
  } finally {
    await session.close();
  }
});

test("a cell scrolled out across a wide table's box has its sentence wait at that side of the box", async () => {
  const cells = Array.from({ length: 12 }, (_, n) => `<td style="min-width:120px">Column ${n + 1}</td>`).join("");
  const page = `<div id="wrap" style="width:500px;overflow-x:auto;border:1px solid #ccc"><table><tr>${cells}<td><button id="edit" type="button">Edit</button></td></tr></table></div><p>Below the table.</p>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Edit", "Click Edit.") : words("Editing.")));
  try {
    await session.ask("edit the row");
    await session.untilState("pointing");
    await session.until(async () => !!(await drawn(session)).ring, "the ring to go round Edit", 3000);
    await session.page.evaluate(() => (document.getElementById("wrap")!.scrollLeft = 0));
    await session.page.waitForTimeout(300);
    const wrap = await inside(session, "#wrap");
    const edit = await box(session, "#edit");
    assert.ok(edit.left >= wrap.right, "Edit is still in the table's box");
    const away = await drawn(session);
    assert.equal(away.ring, undefined, "the ring is drawn outside the table's box");
    assert.ok(away.caption, "the sentence went away");
    assert.equal(away.way, "Scroll right to it");
    assert.ok(away.caption.left >= wrap.right && away.caption.left <= wrap.right + 20, `the sentence is not just right of the table's box: its left is at ${away.caption.left}, the box ends at ${wrap.right}`);
  } finally {
    await session.close();
  }
});

test("a control moved out of a box that only clips, like a strip of slides, gets no way back", async () => {
  const slides = ["Welcome", "Plans", "Upgrade"].map((name) => `<div style="flex:none;width:300px;height:120px;padding:12px">${name === "Plans" ? '<button id="plans" type="button">See plans</button>' : name}</div>`).join("");
  const page = `<div id="strip" style="width:300px;margin-left:700px;overflow:hidden;border:1px solid #ccc"><div style="display:flex">${slides}</div></div>
    <button id="next" type="button">Next slide</button><button id="prev" type="button">Previous slide</button>
    <script>
      document.getElementById('strip').scrollLeft = 300;
      document.getElementById('next').onclick = () => document.getElementById('strip').scrollLeft += 300;
      document.getElementById('prev').onclick = () => document.getElementById('strip').scrollLeft -= 300;
    </script>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "See plans", "Click See plans.") : words("Here are the plans.")));
  try {
    await session.ask("see the plans");
    await session.untilState("pointing");
    await session.until(async () => !!(await drawn(session)).ring, "the ring to go round See plans", 3000);
    // The page moves the strip on by itself.
    await session.page.evaluate(() => (document.getElementById("strip")!.scrollLeft = 600));
    await session.page.waitForTimeout(300);
    const strip = await inside(session, "#strip");
    const plans = await box(session, "#plans");
    assert.ok(plans.right <= strip.left && plans.left >= 0, "See plans is not hidden by the strip inside the window");
    const away = await drawn(session);
    assert.equal(away.ring, undefined, "the ring is drawn outside the strip");
    assert.equal(away.pointer, undefined, "the pointer is drawn outside the strip");
    assert.ok(away.caption, "the sentence went away");
    assert.equal(away.way, undefined, "a way back is offered that the visitor could not scroll themselves");
  } finally {
    await session.close();
  }
});

test("boxes that clip nothing of the control, like a card's or a run of text's, leave the ring and pointer round all of it", async () => {
  const page = `<div style="overflow:hidden;border-radius:12px;border:1px solid #ccc;padding:16px;width:300px">
      <p>Your changes are not saved yet.</p><span style="overflow:hidden"><button id="save" type="button">Save changes</button></span>
    </div>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Save changes", "Click Save changes.") : words("Saved.")));
  try {
    await session.ask("save");
    await session.untilState("pointing");
    await session.until(async () => !!(await drawn(session)).ring, "the ring to go round Save changes", 3000);
    await session.page.waitForTimeout(700);
    const save = await box(session, "#save");
    const shown = await drawn(session);
    assert.ok(shown.ring && Math.abs(shown.ring.left + 4 - save.left) < 2 && Math.abs(shown.ring.right - 4 - save.right) < 2 && Math.abs(shown.ring.bottom - 4 - save.bottom) < 2, "the ring is not round all of Save changes");
    assert.ok(shown.pointer, "the pointer is not drawn");
    assert.ok(shown.caption && shown.way === undefined, "the sentence is not beside Save changes");
  } finally {
    await session.close();
  }
});

test("a box that scrolls across, parked past the side of a page that cannot, does not count as a way to what is in it", async () => {
  // The same menu that slides in, holding a strip of tabs that scrolls across inside it. Scrolling the strip cannot
  // bring the menu into the window, so Haptic scrolls nothing and offers no way back.
  const page = `<style>html, body { overflow-x: hidden }</style>
    <nav style="position:absolute;top:80px;left:calc(100vw + 40px);width:240px">
      <div id="tabs" style="width:240px;overflow-x:auto;white-space:nowrap">
        <a id="billing" href="#billing">Billing</a><span style="display:inline-block;width:600px"></span><a href="#usage">Usage</a>
      </div>
    </nav>
    <button id="menu" type="button">Menu</button><h1>Dashboard</h1>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Billing", "Click Billing in the menu.") : words("Done.")));
  try {
    await session.ask("go to billing");
    await session.untilState("pointing");
    await session.page.waitForTimeout(2000);
    assert.equal(await session.page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollLeft), 0, "the page was scrolled across");
    const shown = await drawn(session);
    assert.equal(shown.pointer, undefined, "the pointer is drawn outside the window");
    assert.equal(shown.way, undefined, "a way back is offered that cannot bring the menu into the window");
    assert.ok(shown.caption, "the sentence went away");
  } finally {
    await session.close();
  }
});
