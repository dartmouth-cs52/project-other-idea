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
  const box = (await session.page.locator(selector).boundingBox({ timeout: 5000 }))!;
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

// Ant Design's dropdown: the menu opens while the mouse is over the trigger,
// a link that goes nowhere, and closes once an entry is clicked.
const HOVER_MENU = `<h1>Dropdown</h1>
  <a id="trigger" href="#" onclick="return false" style="display:inline-block;padding:6px">Hover me</a><button type="button">Save</button>
  <script>
    const trigger = document.getElementById('trigger');
    let menu, timer;
    const close = () => { menu?.remove(); menu = undefined; };
    trigger.addEventListener('mouseenter', () => {
      clearTimeout(timer);
      if (menu) return;
      menu = document.createElement('ul');
      menu.setAttribute('role', 'menu');
      menu.style.cssText = 'position:absolute;top:70px;left:24px;margin:0;padding:4px;list-style:none;background:#fff;border:1px solid #999';
      menu.innerHTML = '<li role="menuitem" style="padding:6px">1st menu item</li><li role="menuitem" style="padding:6px">a danger item</li>';
      for (const item of menu.children) item.addEventListener('click', close);
      menu.addEventListener('mouseenter', () => clearTimeout(timer));
      menu.addEventListener('mouseleave', () => { timer = setTimeout(close, 300); });
      document.body.append(menu);
    });
    trigger.addEventListener('mouseleave', () => { timer = setTimeout(close, 300); });
  </script>`;

test("a pick in a menu that opened while the visitor's mouse was over the pointed control is a pick, not a wrong click", async () => {
  const session = await start(HOVER_MENU, (request, index) => (index === 0 ? point(request, "Hover me", "Hover over Hover me and choose a danger item.") : words("Done.")));
  try {
    await session.ask("the danger item");
    await session.untilState("pointing");
    const box = (await session.page.locator("#trigger").boundingBox({ timeout: 5000 }))!;
    await session.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await session.page.waitForTimeout(300);
    const item = (await session.page.locator('[role="menuitem"]:has-text("a danger item")').boundingBox({ timeout: 5000 }))!;
    // Down to the menu the way a hand goes, through the gap under the trigger.
    await session.page.mouse.move(item.x + 20, item.y + item.height / 2, { steps: 6 });
    await session.page.mouse.down();
    await session.page.mouse.up();
    const second = await session.untilAsked(2, 6000);
    assert.match(second.event ?? "", /^The user chose "a danger item" from the list that link "Hover me" opened\./);
  } finally {
    await session.close();
  }
});

// Carbon's nested menu: an entry that opens a menu of its own while the mouse
// is over it. The inner menu is inside the entry's element.
const NESTED_MENU = `<h1>Report</h1>
  <ul role="menu" style="width:200px;margin:0;padding:4px;list-style:none;border:1px solid #999">
    <li role="menuitem" tabindex="-1" style="padding:6px">Share</li>
    <li id="export" role="menuitem" tabindex="-1" aria-haspopup="true" aria-expanded="false" style="padding:6px;position:relative">Export as
      <ul id="sub" role="menu" hidden style="position:absolute;left:190px;top:0;width:120px;margin:0;padding:4px;list-style:none;background:#fff;border:1px solid #999">
        <li role="menuitem" tabindex="-1" style="padding:6px">PDF</li><li role="menuitem" tabindex="-1" style="padding:6px">JPG</li>
      </ul>
    </li>
  </ul><p id="out"></p>
  <script>
    const exp = document.getElementById('export'), sub = document.getElementById('sub');
    exp.addEventListener('mouseenter', () => { sub.hidden = false; exp.setAttribute('aria-expanded', 'true'); });
    for (const item of sub.children) item.addEventListener('click', (event) => {
      event.stopPropagation();
      sub.hidden = true; exp.setAttribute('aria-expanded', 'false');
      document.getElementById('out').textContent = 'Exported as ' + item.textContent;
    });
  </script>`;

test("a pick in a submenu that sits inside the pointed entry is named as the pick, not as the entry", async () => {
  const session = await start(NESTED_MENU, (request, index) => (index === 0 ? point(request, request.snapshot.elements.find((element) => element.label.startsWith("Export as"))!.label, "Hover over Export as and choose PDF.") : words("Done.")));
  try {
    await session.ask("export as pdf");
    await session.untilState("pointing");
    const box = (await session.page.locator("#export").boundingBox({ timeout: 5000 }))!;
    await session.page.mouse.move(box.x + 30, box.y + 12, { steps: 4 });
    await session.page.waitForTimeout(300);
    const pdf = (await session.page.locator('#sub [role="menuitem"]:has-text("PDF")').boundingBox({ timeout: 5000 }))!;
    await session.page.mouse.move(box.x + 120, box.y + 12, { steps: 3 });
    await session.page.mouse.move(pdf.x + 20, pdf.y + pdf.height / 2, { steps: 3 });
    await session.page.mouse.down();
    await session.page.mouse.up();
    const second = await session.untilAsked(2, 6000);
    assert.match(second.event ?? "", /^The user chose "PDF" from the list that menuitem "Export as[^"]*" opened\./);
  } finally {
    await session.close();
  }
});

// Material UI's slider: a range input the size of the thumb, clipped to nothing.
// The thumb follows the mouse while it is held down, and the page sets the
// input's value with no input or change event.
const SLIDER = `<h1>Sound</h1>
  <span id="root" style="position:relative;display:inline-block;width:300px;height:20px;margin:20px;cursor:pointer">
    <span style="position:absolute;top:9px;left:0;right:0;height:2px;background:#999"></span>
    <span id="thumb" style="position:absolute;top:0;left:90px;width:20px;height:20px;border-radius:50%;background:#1976d2">
      <input id="volume" type="range" aria-label="Volume" min="0" max="100" value="30" aria-valuenow="30" style="position:absolute;width:100%;height:100%;overflow:hidden;clip:rect(0 0 0 0);border:0;margin:-1px;padding:0;white-space:nowrap">
    </span>
  </span><button type="button">Mute</button>
  <script>
    const root = document.getElementById('root'), thumb = document.getElementById('thumb'), input = document.getElementById('volume');
    let held = false;
    const set = (x) => {
      const value = Math.round(Math.min(100, Math.max(0, ((x - root.getBoundingClientRect().left) / 300) * 100)));
      input.value = String(value);
      input.setAttribute('aria-valuenow', String(value));
      thumb.style.left = value * 3 - 10 + 'px';
    };
    root.addEventListener('pointerdown', (event) => { held = true; set(event.clientX); event.preventDefault(); });
    document.addEventListener('pointermove', (event) => held && set(event.clientX));
    document.addEventListener('pointerup', () => { held = false; });
  </script>`;

test("a slider dragged with the mouse, which sends no input event, is heard", async () => {
  const session = await start(SLIDER, (request, index) => (index === 0 ? point(request, "Volume", "Drag the Volume slider to the right.") : words("Done.")));
  try {
    await session.ask("louder");
    await session.untilState("pointing");
    await session.page.waitForTimeout(400);
    const box = (await session.page.locator("#thumb").boundingBox({ timeout: 5000 }))!;
    await session.page.mouse.move(box.x + 10, box.y + 10);
    await session.page.mouse.down();
    await session.page.mouse.move(box.x + 70, box.y + 10, { steps: 6 });
    await session.page.mouse.up();
    const second = await session.untilAsked(2, 6000);
    assert.match(second.event ?? "", /^The user moved slider "Volume"\./);
  } finally {
    await session.close();
  }
});

// UI5's date picker: a custom element whose input and calendar both live in
// its shadow root. F4 in the input shows the calendar as a popover, and each
// day is a cell in the shadow root of the calendar's own element.
const SHADOW_DATE = `<h1>Delivery</h1><x-date-picker id="dp"></x-date-picker><button type="button">Order</button>
  <script>
    customElements.define('x-calendar', class extends HTMLElement {
      connectedCallback() {
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = '<div role="grid" aria-label="November 2026">' + Array.from({ length: 30 }, (_, n) => '<div role="gridcell" tabindex="-1" aria-label="November ' + (n + 1) + ', 2026" style="display:inline-block;width:28px;padding:4px;cursor:pointer">' + (n + 1) + '</div>').join('') + '</div>';
        root.addEventListener('click', (event) => {
          const cell = event.composedPath().find((node) => node.getAttribute && node.getAttribute('role') === 'gridcell');
          if (cell) this.dispatchEvent(new CustomEvent('pick', { detail: cell.textContent, bubbles: true, composed: true }));
        });
      }
    });
    customElements.define('x-date-picker', class extends HTMLElement {
      connectedCallback() {
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = '<label for="value">Delivery Date</label> <input id="value" type="text"><div id="pop" popover="manual" style="margin:0;position:fixed;left:40px;top:120px;width:300px;border:1px solid #999;background:#fff"><x-calendar></x-calendar></div>';
        const input = root.getElementById('value'), pop = root.getElementById('pop');
        input.addEventListener('keydown', (event) => { if (event.key === 'F4') pop.showPopover(); });
        pop.addEventListener('pick', (event) => { input.value = 'Nov ' + event.detail + ', 2026'; pop.hidePopover(); });
      }
    });
  </script>`;

test("a day picked in a calendar that the pointed field opened in its shadow root, with a key, is a pick", async () => {
  const session = await start(SHADOW_DATE, (request, index) => (index === 0 ? point(request, "Delivery Date", "Press F4 in Delivery Date and pick the 15th.") : words("Done.")));
  try {
    await session.ask("deliver on the 15th");
    await session.untilState("pointing");
    await session.page.locator("x-date-picker input").focus();
    await session.page.keyboard.press("F4");
    await session.page.waitForTimeout(400);
    await session.page.locator('x-calendar [aria-label="November 15, 2026"]').click();
    const second = await session.untilAsked(2, 6000);
    assert.match(second.event ?? "", /^The user chose "November 15, 2026" from the list that textbox "Delivery Date" opened\./);
  } finally {
    await session.close();
  }
});
