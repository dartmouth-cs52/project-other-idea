import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// Presentation mode, for a demo on a projector or a shared screen: the page
// asks for it with data-present="1" on the script tag, and never gets it
// otherwise. The pointer, the caption and the ring are large enough to be
// seen from the back of a room, the question stays on show while its guide
// runs, and the large caption keeps off the control and what it opens.

type Box = { left: number; top: number; right: number; bottom: number };
const overlap = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** What Haptic draws, measured: the pointer's size, the caption's type and box, the ring's border, and the question on show. */
const drawn = (session: Session) =>
  session.page.evaluate(() => {
    const root = document.querySelector("haptic-root")!.shadowRoot!;
    // Written without a named function inside, which the test runner's build would wrap in a helper the page does not have.
    const [caption, askedBox] = [".caption", ".asked"].map((selector) => {
      const rect = root.querySelector(selector)!.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }) as [Box, Box];
    const asked = root.querySelector(".asked") as HTMLElement;
    return {
      pointer: Math.round(root.querySelector(".cursor svg")!.getBoundingClientRect().height),
      glide: getComputedStyle(root.querySelector(".cursor")!).transitionDuration,
      font: getComputedStyle(root.querySelector(".caption")!).fontSize,
      caption,
      ring: getComputedStyle(root.querySelector(".ring")!).borderTopWidth,
      asked: asked.hidden ? "" : (asked.textContent ?? ""),
      askedBox,
    };
  });

const LONG = "Click Export to download every order from this month as a spreadsheet, with one row for each order.";
const ORDERS = `<h1>Orders</h1><p>Your orders this month.</p><button id="export" type="button" style="margin:220px 0 0 300px">Export</button>`;

test("presentation mode is off unless the script tag asks for it", async () => {
  const session = await start(ORDERS, (request, index) => (index === 0 ? point(request, "Export", LONG) : words("Done.")));
  try {
    await session.ask("how do I export my orders");
    await session.untilState("pointing");
    await session.page.waitForTimeout(800);
    const shown = await drawn(session);
    assert.deepEqual({ pointer: shown.pointer, font: shown.font, ring: shown.ring, asked: shown.asked, glide: shown.glide }, { pointer: 24, font: "14px", ring: "2px", asked: "", glide: "0.55s" });
  } finally {
    await session.close();
  }
});

test("with data-present the pointer, caption and ring are large, the glide slower, and the question stays on show while the guide runs", async () => {
  const session = await start(ORDERS, (request, index) => (index === 0 ? point(request, "Export", LONG) : words("The spreadsheet is on its way.")), "/", { present: true });
  try {
    await session.ask("how do I export my orders");
    await session.untilState("pointing");
    await session.page.waitForTimeout(1200);
    const shown = await drawn(session);
    assert.equal(shown.pointer, 48);
    assert.equal(shown.font, "27px");
    assert.equal(shown.ring, "6px");
    assert.equal(shown.glide, "0.8s");
    assert.ok(shown.caption.right - shown.caption.left > 600, `the caption is ${shown.caption.right - shown.caption.left} px wide`);
    assert.equal(shown.asked, "“how do I export my orders”");
    const exportBox = (await session.page.locator("#export").boundingBox())!;
    const control = { left: exportBox.x, top: exportBox.y, right: exportBox.x + exportBox.width, bottom: exportBox.y + exportBox.height };
    assert.ok(!overlap(shown.caption, control), "the caption covers the control");
    assert.ok(!overlap(shown.askedBox, control) && !overlap(shown.askedBox, shown.caption), "the question covers the control or the caption");
    // The guide's last sentence keeps the question beside it; putting it away takes both.
    await session.page.locator("#export").click();
    await session.untilState("finished");
    assert.equal((await drawn(session)).asked, "“how do I export my orders”");
    await session.page.locator("haptic-root .caption .close").click();
    assert.equal((await drawn(session)).asked, "");
  } finally {
    await session.close();
  }
});

test("in presentation mode the caption goes above a field whose list opens below it, and stays off the list once it is open", async () => {
  const page = `<h1>Invite people</h1><label>Email <input id="email" style="width:300px"></label>
    <div style="position:relative;width:320px;margin-top:220px">
      <input id="dept" role="combobox" aria-label="Department" aria-expanded="false" aria-controls="list" style="width:300px;height:32px">
      <div id="list" role="listbox" hidden style="position:absolute;top:38px;left:0;width:320px;background:#fff;border:1px solid #999">
        ${["Engineering", "Platform", "Mobile", "Data", "Sales", "Marketing"].map((name) => `<div role="option" style="padding:10px">${name}</div>`).join("")}
      </div>
    </div><p>Notes</p><textarea aria-label="Note"></textarea><button type="button">Send invite</button>
    <script>
      const dept = document.getElementById('dept'), list = document.getElementById('list');
      dept.addEventListener('mousedown', () => { list.hidden = false; dept.setAttribute('aria-expanded', 'true'); });
    </script>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Department", "Open Department and choose Platform, the team they are joining.") : words("Done.")), "/", { present: true });
  try {
    await session.ask("invite a new hire to the Platform team");
    await session.untilState("pointing");
    await session.page.waitForTimeout(1200);
    const field = (await session.page.locator("#dept").boundingBox())!;
    const before = (await drawn(session)).caption;
    assert.ok(before.bottom <= field.y, `the caption is not above the field: ${JSON.stringify(before)}, the field's top is ${field.y}`);
    await session.page.locator("#dept").click();
    await session.page.waitForTimeout(800);
    const list = (await session.page.locator("#list").boundingBox())!;
    const after = (await drawn(session)).caption;
    assert.ok(!overlap(after, { left: list.x, top: list.y, right: list.x + list.width, bottom: list.y + list.height }), "the caption covers the open list");
  } finally {
    await session.close();
  }
});

test("in presentation mode the caption moves off a menu that opens where it is", async () => {
  // A menu that opens above its button, where the caption first goes.
  const page = `<h1>Report</h1><div style="position:relative;margin:330px 0 0 420px;width:160px">
      <button id="more" type="button" aria-haspopup="menu">More actions</button>
      <ul id="menu" role="menu" hidden style="position:absolute;bottom:34px;left:-260px;width:560px;margin:0;padding:6px;list-style:none;background:#fff;border:1px solid #999">
        ${["Duplicate", "Archive", "Move to folder", "Delete"].map((name) => `<li role="menuitem" tabindex="-1" style="padding:8px">${name}</li>`).join("")}
      </ul></div>
    <script>document.getElementById('more').addEventListener('mousedown', () => { document.getElementById('menu').hidden = false; });</script>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "More actions", "Open More actions, then choose Archive to put this report away.", "continue") : words("Done.")), "/", { present: true });
  try {
    await session.ask("archive this report");
    await session.untilState("pointing");
    await session.page.waitForTimeout(1200);
    // The press opens the menu and is not the step: an open menu is still waited on.
    await session.page.locator("#more").dispatchEvent("mousedown");
    await session.page.waitForTimeout(900);
    const menu = (await session.page.locator("#menu").boundingBox())!;
    const caption = (await drawn(session)).caption;
    assert.ok(!overlap(caption, { left: menu.x, top: menu.y, right: menu.x + menu.width, bottom: menu.y + menu.height }), `the caption ${JSON.stringify(caption)} covers the menu ${JSON.stringify(menu)}`);
  } finally {
    await session.close();
  }
});

test("in presentation mode the question keeps off the ask box while the answer is worked out, in a narrow window", async () => {
  const session = await start(
    ORDERS,
    async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return point(request, "Export", "Click Export.");
    },
    "/",
    { present: true },
  );
  try {
    await session.page.setViewportSize({ width: 1024, height: 576 });
    await session.ask("how do I export every order from this month as a spreadsheet");
    await session.untilState("asking");
    await session.page.waitForTimeout(600);
    const [asked, dock] = (await session.page.evaluate(() =>
      [".asked", ".dock"].map((selector) => {
        const rect = document.querySelector("haptic-root")!.shadowRoot!.querySelector(selector)!.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      }),
    )) as [Box, Box];
    assert.equal((await drawn(session)).asked, "“how do I export every order from this month as a spreadsheet”");
    assert.ok(!overlap(asked, dock), `the question ${JSON.stringify(asked)} covers the ask box ${JSON.stringify(dock)}`);
  } finally {
    await session.close();
  }
});

/**
 * How the question is drawn: its box, how many lines of it are on show, and whether its last letter is among them.
 * Read from where the browser lays the words out, so a question cut short at the end of a line, or below the
 * second, is told apart from one shown whole.
 */
const QUESTION_DRAWN = `(() => {
  const asked = document.querySelector('haptic-root').shadowRoot.querySelector('.asked');
  const box = asked.getBoundingClientRect();
  const walker = document.createTreeWalker(asked, NodeFilter.SHOW_TEXT);
  const texts = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node);
  const text = texts[texts.length - 1];
  const inside = (rect) => rect.width > 0 && rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
  const range = document.createRange();
  range.setStart(text, text.length - 2);
  range.setEnd(text, text.length - 1);
  const last = range.getBoundingClientRect();
  range.selectNodeContents(text);
  const tops = new Set(Array.from(range.getClientRects()).filter(inside).map((rect) => Math.round(rect.top)));
  return { box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom }, lines: tops.size, whole: inside(last), text: asked.textContent };
})()`;

test("in presentation mode a long question wraps to a second line before it is cut, and is cut only past two", async () => {
  const session = await start(ORDERS, (request) => point(request, "Export", "Click Export."), "/", { present: true });
  const question = "Issue Malika Cummerata a virtual card called Ads with a $500 monthly limit, for the spring campaign";
  try {
    await session.page.setViewportSize({ width: 1280, height: 720 });
    await session.ask(question);
    await session.untilState("pointing");
    await session.page.waitForTimeout(400);
    const two = (await session.page.evaluate(QUESTION_DRAWN)) as { lines: number; whole: boolean; text: string };
    assert.equal(two.text, `“${question}”`);
    assert.deepEqual([two.lines, two.whole], [2, true], `the question is not shown whole on two lines: ${JSON.stringify(two)}`);
    // Longer than two lines will hold: two are shown, and it is cut at the end of the second.
    await session.page.locator("haptic-root .caption .close").click();
    await session.untilState("finished");
    await session.ask(`${question}, ${question}, ${question}`);
    await session.untilState("pointing");
    await session.page.waitForTimeout(400);
    const cut = (await session.page.evaluate(QUESTION_DRAWN)) as { lines: number; whole: boolean };
    assert.deepEqual([cut.lines, cut.whole], [2, false], JSON.stringify(cut));
  } finally {
    await session.close();
  }
});

/**
 * A page that shows messages where pages most often do, as toolkits draw them: pinned to the window at the top right
 * and at the bottom centre, a little while after something happens. `window.toast(where)` brings one up.
 */
const TOASTING = `${ORDERS}
  <style>
    .toast { position: fixed; width: 356px; padding: 16px; border-radius: 8px; background: #ecfdf3; color: #008a2e; font: 13px system-ui; }
    .toast.top-right { top: 24px; right: 32px; }
    .toast.bottom { bottom: 24px; left: calc(50% - 178px); }
    .toast.top { top: 24px; left: calc(50% - 178px); }
  </style>
  <script>
    window.toast = (where) => {
      const toast = document.createElement('li');
      toast.className = 'toast ' + where;
      toast.setAttribute('data-sonner-toast', '');
      toast.setAttribute('role', 'status');
      toast.textContent = 'Your export is on its way.';
      document.body.append(toast);
    };
  </script>`;

/** Starts keeping, for every frame the browser draws, the boxes of the question, the caption, the launcher's dock and each message. */
const KEEP_FRAMES = `(() => {
  window.kept = [];
  const root = document.querySelector('haptic-root').shadowRoot;
  const box = (el) => {
    if (!el || el.hidden || !el.getClientRects().length) return null;
    const r = el.getBoundingClientRect();
    return [r.left, r.top, r.right, r.bottom];
  };
  const tick = () => {
    window.kept.push({ asked: box(root.querySelector('.asked')), caption: box(root.querySelector('.caption')), dock: box(root.querySelector('.dock')),
      toasts: Array.from(document.querySelectorAll('.toast')).map(box) });
    if (window.kept.length < 600) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

type Kept = { asked: number[] | null; caption: number[] | null; dock: number[] | null; toasts: (number[] | null)[] };
const covers = (a: number[] | null, b: number[] | null) => !!a && !!b && a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!;

for (const size of [
  { width: 1280, height: 720 },
  { width: 1536, height: 864 },
]) {
  test(`in presentation mode the question never covers a message at the top right or the bottom centre, nor Haptic's own panel (${size.width} by ${size.height})`, async () => {
    const session = await start(TOASTING, (request, index) => (index === 0 ? point(request, "Export", "Click Export.") : words("Done.")), "/", { present: true });
    try {
      await session.page.setViewportSize(size);
      await session.ask("Issue Malika Cummerata a virtual card called Ads with a $500 monthly limit");
      await session.untilState("pointing");
      // The visitor opens the panel while the pointer is up, and the page brings up its messages.
      await session.page.locator("haptic-root .launcher").click();
      await session.page.evaluate(KEEP_FRAMES);
      await session.page.evaluate(() => (window as unknown as { toast: (where: string) => void }).toast("top-right"));
      await session.page.waitForTimeout(300);
      await session.page.evaluate(() => (window as unknown as { toast: (where: string) => void }).toast("bottom"));
      await session.page.waitForTimeout(1500);
      const kept = (await session.page.evaluate(() => (window as unknown as { kept: Kept[] }).kept)) as Kept[];
      assert.ok(kept.length > 30 && kept.every((frame) => frame.asked), "the question was not on show");
      for (const [at, frame] of kept.entries()) {
        for (const toast of frame.toasts) assert.ok(!covers(frame.asked, toast), `frame ${at}: the question covers a message: ${JSON.stringify(frame)}`);
        assert.ok(!covers(frame.asked, frame.dock) && !covers(frame.asked, frame.caption), `frame ${at}: the question covers Haptic's panel or caption: ${JSON.stringify(frame)}`);
      }
    } finally {
      await session.close();
    }
  });
}

test("in presentation mode a message that comes up under the question moves it, and it does not go back there", async () => {
  const session = await start(TOASTING, (request, index) => (index === 0 ? point(request, "Export", "Click Export.") : words("Done.")), "/", { present: true });
  try {
    await session.page.setViewportSize({ width: 1536, height: 864 });
    await session.ask("how do I export my orders");
    await session.untilState("pointing");
    await session.page.waitForTimeout(600);
    const before = (await session.page.evaluate(QUESTION_DRAWN)) as { box: Box };
    // A message at the top centre, where some toolkits put theirs: under the question.
    await session.page.evaluate(() => (window as unknown as { toast: (where: string) => void }).toast("top"));
    const toast = (await session.page.locator(".toast.top").boundingBox())!;
    const message = { left: toast.x, top: toast.y, right: toast.x + toast.width, bottom: toast.y + toast.height };
    assert.ok(overlap(before.box, message), "the message did not come up under the question");
    await session.until(async () => !overlap(((await session.page.evaluate(QUESTION_DRAWN)) as { box: Box }).box, message), "the question to move off the message", 1500);
    // The message goes, and the question stays where it went.
    await session.page.evaluate(() => document.querySelector(".toast.top")!.remove());
    await session.page.waitForTimeout(1200);
    assert.ok(!overlap(((await session.page.evaluate(QUESTION_DRAWN)) as { box: Box }).box, message), "the question went back where the message was");
  } finally {
    await session.close();
  }
});
