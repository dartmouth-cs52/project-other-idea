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
