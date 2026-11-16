import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// Picks: what the visitor chooses in what the pointed control opened. Each
// page is the smallest one that behaves like the toolkit or app it was seen on.

/** Presses the real mouse at the middle of what the pointer is on, as a visitor who trusts it would. */
async function pressPointed(session: Session): Promise<void> {
  const box = await session.page.evaluate(() => {
    const rect = (document.querySelector("haptic-root") as unknown as { pointedAt: Element }).pointedAt.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await session.page.mouse.click(box.x, box.y);
}

/** Presses the real mouse on an element, and lets go without moving. */
async function pressOn(session: Session, selector: string): Promise<void> {
  const box = (await session.page.locator(selector).boundingBox())!;
  await session.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  await session.page.mouse.down();
  await session.page.waitForTimeout(40);
  await session.page.mouse.up();
}

// Grafana's multi-value variable, built on react-select: a label beside a box
// that holds the chosen values as chips and a text input drawn as a speck. The
// label only puts the cursor in the input. A press on the box opens the list.
// The list acts as the mouse goes down: it toggles the option and draws every
// option again, so no click follows. Each option has a tick box beside its words.
const MULTI = `<h1>Nested variables</h1>
  <div style="display:flex;align-items:center">
    <label for="dc" style="padding:5px 8px;border:1px solid #ccc">datacenter</label>
    <div id="box" style="display:flex;align-items:center;width:180px;height:28px;padding:0 6px;border:1px solid #888;border-radius:4px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:4px;flex:1">
        <span id="chips"></span>
        <div style="display:inline-grid"><input id="dc" type="text" role="combobox" aria-expanded="false" aria-haspopup="true" aria-controls="dc-listbox" autocomplete="off" style="width:2px;min-width:2px;border:0;padding:0;margin:0;outline:0"></div>
      </div>
      <span aria-hidden="true">v</span>
    </div>
  </div>
  <p>Panels for the chosen data centers.</p><button type="button">Refresh</button>
  <script>
    const chosen = new Set(['A']);
    const input = document.getElementById('dc'), box = document.getElementById('box');
    let menu;
    const chips = () => {
      document.getElementById('chips').innerHTML = [...chosen].map((v) => '<span style="background:#eee;padding:0 4px">' + v + ' <button type="button" aria-label="Remove" data-v="' + v + '">x</button></span>').join(' ');
    };
    const draw = () => {
      menu.innerHTML = ['A', 'B', 'C'].map((v) => '<div role="option" aria-selected="' + chosen.has(v) + '" data-v="' + v + '" style="padding:6px;cursor:pointer"><label><input type="checkbox"' + (chosen.has(v) ? ' checked' : '') + '></label><span>' + v + '</span></div>').join('');
    };
    const open = () => {
      if (menu) return;
      menu = document.createElement('div');
      menu.style.cssText = 'position:absolute;top:60px;left:110px;width:180px;background:#fff;border:1px solid #888';
      menu.addEventListener('pointerdown', (event) => {
        const option = event.target.closest('[role=option]');
        if (!option) return;
        const v = option.dataset.v;
        if (chosen.has(v)) chosen.delete(v); else chosen.add(v);
        draw();
        chips();
      });
      menu.addEventListener('mousedown', (event) => event.preventDefault());
      draw();
      document.body.append(menu);
      input.setAttribute('aria-expanded', 'true');
    };
    box.addEventListener('mousedown', (event) => {
      const remove = event.target.closest('button');
      if (remove) { chosen.delete(remove.dataset.v); chips(); return; }
      event.preventDefault();
      input.focus();
      open();
    });
    chips();
  </script>`;

test("a field drawn as a speck inside its box is pointed at by the box, which opens its list, and not by a label beside it", async () => {
  const session = await start(MULTI, (request, index) => (index === 0 ? point(request, "datacenter", "Click the datacenter dropdown and choose B from the list.") : words("Done.")));
  try {
    await session.ask("only show data center B");
    await session.untilState("pointing");
    await session.page.waitForTimeout(500);
    assert.equal(await session.pointed(), "box", "the pointer is not on the box that opens the list");
    await pressPointed(session);
    const second = await session.untilAsked(2, 5000);
    assert.match(second.event ?? "", /^The user clicked into combobox "datacenter", and a list of choices opened\./);
  } finally {
    await session.close();
  }
});

test("a pick in a list that acts as the mouse goes down and draws its options again is heard and named", async () => {
  const session = await start(MULTI, (request, index) => (index === 0 ? point(request, "datacenter", "Click the datacenter dropdown and choose B from the list.") : words("Done.")));
  try {
    await session.ask("only show data center B");
    await session.untilState("pointing");
    await session.page.waitForTimeout(500);
    await pressPointed(session);
    await session.page.waitForTimeout(300);
    await pressOn(session, '[role="option"][data-v="B"]');
    const second = await session.untilAsked(2, 6000);
    assert.match(second.event ?? "", /^The user chose "B" from the list that combobox "datacenter" opened\./);
  } finally {
    await session.close();
  }
});

test("a press on another control inside the pointed field's box is that control, not the field", async () => {
  const session = await start(MULTI, (request, index) => (index === 0 ? point(request, "datacenter", "Click the datacenter dropdown and choose B from the list.") : words("Done.")));
  try {
    await session.ask("only show data center B");
    await session.untilState("pointing");
    await session.page.waitForTimeout(500);
    await session.page.locator('button[aria-label="Remove"]').click();
    const second = await session.untilAsked(2, 5000);
    assert.match(second.event ?? "", /^The user clicked "[^"]*Remove[^"]*" instead of combobox "datacenter"\./);
  } finally {
    await session.close();
  }
});
