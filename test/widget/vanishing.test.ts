import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, idOf, point, start, words, type Asked, type Session } from "./harness.ts";

after(closeBrowser);

// The control the pointer is on goes without being used: the visitor closes
// the dialog it is in, a menu closes, the page draws its list again without
// it, or opens a dialog over it. The guide notices within a second, leaves
// nothing pointing at where it was, and asks for the next step from the page
// as it now is, saying in plain words what happened. And a row's action that
// shows only while the mouse is over the row is listed as such and pointed
// at where it will show, with nothing clicked or focused for the visitor.
//
// The first page is the owner's report on Northpine's bills: the row's Pay,
// shown only on hover, opens a payment dialog; Haptic points at its Continue;
// the visitor clicks outside the dialog and it closes.

/** What a visitor sees of Haptic: whether the pointer is drawn, and the sentence on show. */
async function shown(session: Session): Promise<{ pointer: boolean; caption: string }> {
  return session.page.evaluate(() => {
    const root = document.querySelector("haptic-root")?.shadowRoot;
    const cursor = root?.querySelector(".cursor") as HTMLElement | null;
    const caption = root?.querySelector(".caption") as HTMLElement | null;
    return { pointer: !!cursor && !cursor.hidden, caption: caption && !caption.hidden ? (caption.querySelector("span")?.textContent ?? "") : "" };
  });
}

/** Waits, a second at most, for nothing to be left pointing at the control the sentence was about. */
async function letGo(session: Session, sentence: string, what: string): Promise<void> {
  await session.until(async () => {
    const now = await shown(session);
    return !now.pointer && now.caption !== sentence;
  }, `the pointer and "${sentence}" to go once ${what}`, 1000);
}

/** Tailwind 4's way of writing a row's actions that show while the mouse is over the row, or the keyboard is in them. */
const ROW_STYLES = `<style>
  .row { position: relative; display: flex; gap: 24px; width: 700px; height: 40px; align-items: center; border-bottom: 1px solid #ddd }
  .actions { position: absolute; right: 0; top: 0; bottom: 0; display: flex; align-items: center; gap: 4px; padding: 0 8px; background: #fff }
  @layer utilities {
    .opacity-0 { opacity: 0 }
    .pointer-events-none { pointer-events: none }
    .focus-within\\:opacity-100:focus-within { opacity: 1 }
    @media (hover: hover) {
      :is(:where(.group\\/row):hover .group-hover\\/row\\:opacity-100) { opacity: 1 }
      :is(:where(.group\\/row):hover .group-hover\\/row\\:pointer-events-auto) { pointer-events: auto }
    }
  }
  .overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .4); z-index: 50 }
  .dialog { position: fixed; top: 12vh; left: 50%; transform: translateX(-50%); width: 560px; padding: 16px; background: #fff; border-radius: 8px; z-index: 51 }
</style>`;

const row = (number: string, vendor: string, actions: string, extra = "") =>
  `<div class="group/row"><div role="row" class="row"><span role="cell">${number}</span><span role="cell">${vendor}</span><span role="cell">Due Friday</span>
    <div role="cell" class="actions opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 ${extra}">${actions}</div></div></div>`;

/**
 * Bills, as Northpine draws them. Pay opens a dialog as Radix draws one: a backdrop, and the dialog beside it at the
 * end of the page. A press outside it, Escape, or Cancel closes it, and the keyboard goes back to the Pay that opened it.
 */
const BILLS = `${ROW_STYLES}<main><h1>Bills</h1><div role="table" aria-label="Bills">
  ${row("INV-46951", "Linden Logistics", '<button id="pay" type="button">Pay</button>')}
  ${row("INV-51210", "Brightdesk", '<button type="button">Pay</button>')}
  </div></main>
  <script>
    let opener;
    const closeDialog = () => {
      document.querySelectorAll('.overlay, .dialog').forEach((el) => el.remove());
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      if (opener) opener.focus();
    };
    const outside = (event) => { if (!event.composedPath().some((node) => node.classList && node.classList.contains('dialog'))) closeDialog(); };
    const escape = (event) => { if (event.key === 'Escape') closeDialog(); };
    document.getElementById('pay').addEventListener('click', (event) => {
      opener = event.currentTarget;
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      const dialog = document.createElement('div');
      dialog.className = 'dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-labelledby', 'title');
      dialog.innerHTML = '<h2 id="title">Pay Linden Logistics</h2><p>Send today is selected and is free.</p><button type="button" id="cancel">Cancel</button> <button type="button" id="continue">Continue</button>';
      document.body.append(overlay, dialog);
      dialog.querySelector('#cancel').addEventListener('click', closeDialog);
      setTimeout(() => {
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape);
        dialog.querySelector('#continue').focus();
      }, 0);
    });
  </script>`;

const CONTINUE = "Send today is already selected and is free. Click Continue to go to the review step.";
const AGAIN = "Move over the INV-46951 row and click Pay to open the payment again.";
/** The owner's replies: Pay, then Continue, then Pay again for the page as it is once the dialog has gone. */
const payScript = (request: Asked, index: number) =>
  index === 0 ? point(request, "Pay", "Click Pay on the INV-46951 row.")
  : index === 1 ? point(request, "Continue", CONTINUE)
  : index === 2 ? point(request, "Pay", AGAIN)
  : words("Done.");

/** Asks to pay, follows the pointer to Pay as a visitor does, and waits for the pointer on the dialog's Continue. */
async function toContinue(session: Session): Promise<void> {
  await session.ask("Pay bill INV-46951");
  await session.untilState("pointing");
  const pay = await session.page.locator("#pay").boundingBox();
  await session.page.mouse.move(pay.x + pay.width / 2, pay.y + pay.height / 2, { steps: 4 });
  await session.page.mouse.click(pay.x + pay.width / 2, pay.y + pay.height / 2);
  const second = await session.untilAsked(2);
  assert.equal(second.snapshot.dialog, "Pay Linden Logistics");
  await session.until(async () => (await session.state()) === "pointing" && (await shown(session)).caption === CONTINUE, "the pointer on Continue");
  assert.equal(await session.pointed(), "continue");
}

test("the owner's report: a dialog closed by a click outside it takes Continue away, and the guide says so and gives the way from the page as it is", async () => {
  const session = await start(BILLS, payScript, "/");
  try {
    await toContinue(session);
    // Outside the dialog, on its backdrop, over the table.
    await session.page.mouse.click(60, 700);
    await letGo(session, CONTINUE, "the dialog closed");
    const third = await session.untilAsked(3, 3000);
    assert.equal(third.event, 'The user clicked outside the dialog "Pay Linden Logistics", which closed it without using button "Continue".');
    assert.equal(third.snapshot.dialog, undefined);
    assert.equal(third.offTrack, true);
    await session.until(async () => (await session.state()) === "pointing" && (await shown(session)).caption === AGAIN, "the pointer back on Pay");
    assert.equal(await session.pointed(), "pay");
  } finally {
    await session.close();
  }
});

test("Escape that closes the dialog is closing it, not using Continue, though the keyboard was on Continue", async () => {
  const session = await start(BILLS, payScript, "/");
  try {
    await toContinue(session);
    assert.equal(await session.page.evaluate(() => document.activeElement?.id), "continue");
    await session.page.keyboard.press("Escape");
    await letGo(session, CONTINUE, "Escape closed the dialog");
    const third = await session.untilAsked(3, 3000);
    assert.equal(third.event, 'The user pressed Escape, which closed the dialog "Pay Linden Logistics" without using button "Continue".');
    await session.untilState("pointing");
  } finally {
    await session.close();
  }
});

test("Cancel in the dialog is another control, named as one", async () => {
  const session = await start(BILLS, payScript, "/");
  try {
    await toContinue(session);
    await session.page.locator("#cancel").click();
    const third = await session.untilAsked(3, 3000);
    assert.equal(third.event, 'The user clicked "Cancel" instead of button "Continue".');
    assert.notEqual(await session.pointed(), "continue");
  } finally {
    await session.close();
  }
});

/** A menu of actions. `closes` says how it closes by itself, as well as on a press outside it. */
const menuPage = (closes: "outside" | "mouse-leaves") => `<main><h1>Files</h1><p>Quarterly plan.docx</p>
  <div id="wrap" style="display:inline-block"><button id="actions" type="button" aria-haspopup="menu" aria-expanded="false">Actions</button>
  <div id="menu" role="menu" style="visibility:hidden;position:absolute;top:110px;left:24px;width:180px;padding:4px;background:#fff;border:1px solid #999">
    <div role="menuitem" tabindex="-1" id="rename" style="padding:6px">Rename</div><div role="menuitem" tabindex="-1" style="padding:6px">Move</div>
  </div></div></main>
  <script>
    const button = document.getElementById('actions');
    const menu = document.getElementById('menu');
    const close = () => { menu.style.visibility = 'hidden'; button.setAttribute('aria-expanded', 'false'); };
    button.addEventListener('click', () => { menu.style.visibility = 'visible'; button.setAttribute('aria-expanded', 'true'); });
    document.addEventListener('pointerdown', (event) => { if (!event.composedPath().includes(menu) && !event.composedPath().includes(button)) close(); }, true);
    ${closes === "mouse-leaves" ? "let timer; document.getElementById('wrap').addEventListener('mouseleave', () => { timer = setTimeout(close, 300); }); document.getElementById('wrap').addEventListener('mouseenter', () => clearTimeout(timer));" : ""}
  </script>`;

const RENAME = "Click Rename.";
const menuScript = (request: Asked, index: number) =>
  index === 0 ? point(request, "Actions", "Click Actions.")
  : index === 1 ? point(request, "Rename", RENAME)
  : index === 2 ? point(request, "Actions", "Open Actions again.")
  : words("Done.");

async function toRename(session: Session): Promise<void> {
  await session.ask("rename the file");
  await session.untilState("pointing");
  await session.page.locator("#actions").click();
  await session.untilAsked(2);
  await session.until(async () => (await session.state()) === "pointing" && (await shown(session)).caption === RENAME, "the pointer on Rename");
  assert.equal(await session.pointed(), "rename");
}

test("a menu closed by a press outside it takes its entry away, and the guide says so", async () => {
  const session = await start(menuPage("outside"), menuScript);
  try {
    await toRename(session);
    await session.page.mouse.click(900, 500);
    await letGo(session, RENAME, "the menu closed");
    const third = await session.untilAsked(3, 3000);
    assert.equal(third.event, 'The user clicked outside the menu, which closed it without using menuitem "Rename".');
    await session.untilState("pointing");
    assert.equal(await session.pointed(), "actions");
  } finally {
    await session.close();
  }
});

test("a menu that closes by itself when the mouse leaves it, hidden and not removed, is noticed within a second and asked about at once", async () => {
  const session = await start(menuPage("mouse-leaves"), menuScript);
  try {
    await toRename(session);
    // The mouse wanders off without a press. The menu closes 300 ms later.
    await session.page.mouse.move(1000, 600, { steps: 3 });
    await session.until(() => session.page.evaluate(() => getComputedStyle(document.getElementById("menu")!).visibility === "hidden"), "the menu to close");
    await letGo(session, RENAME, "the menu closed by itself");
    const third = await session.untilAsked(3, 2000);
    assert.equal(third.event, 'The menu closed without menuitem "Rename" being used.');
  } finally {
    await session.close();
  }
});

/** A list the page draws again: with the same rows, or filtered by a saved view loading, with no press of the visitor's. */
const LIST = `<main><h1>Invoices</h1><ul id="list"></ul></main>
  <script>
    const rows = [['INV-1001', 'Paid'], ['INV-1002', 'Overdue'], ['INV-1003', 'Draft']];
    const draw = (only) => { document.getElementById('list').innerHTML = rows.filter((row) => !only || row[1] === only).map((row) => '<li>' + row[0] + ' (' + row[1] + ') <button type="button">Open ' + row[0] + '</button></li>').join(''); };
    draw();
    window.redraw = () => draw();
    window.overdueOnly = () => draw('Overdue');
  </script>`;

test("a control the page drew again is found on its new node at once, with no question", async () => {
  const session = await start(LIST, (request, index) => (index === 0 ? point(request, "Open INV-1003", "Open the draft.") : words("Done.")));
  try {
    await session.ask("open the draft invoice");
    await session.untilState("pointing");
    await session.page.evaluate(() => (window as unknown as { redraw(): void }).redraw());
    await session.until(() => session.page.evaluate(() => {
      const el = (document.querySelector("haptic-root") as Element & { pointedAt?: Element }).pointedAt;
      return !!el?.isConnected && el.textContent === "Open INV-1003";
    }), "the pointer on the new Open INV-1003", 1000);
    assert.equal((await shown(session)).caption, "Open the draft.");
    await session.page.waitForTimeout(1500);
    assert.equal(session.requests.length, 1);
    assert.equal(await session.state(), "pointing");
  } finally {
    await session.close();
  }
});

test("a control the page drew the list again without is noticed within a second, and the next step asked for at once", async () => {
  const session = await start(LIST, (request, index) => (index === 0 ? point(request, "Open INV-1003", "Open the draft.") : index === 1 ? point(request, "Open INV-1002", "Open the overdue one.") : words("Done.")));
  try {
    await session.ask("open the draft invoice");
    await session.untilState("pointing");
    await session.page.evaluate(() => (window as unknown as { overdueOnly(): void }).overdueOnly());
    await letGo(session, "Open the draft.", "the list was drawn without it");
    const second = await session.untilAsked(2, 2500);
    assert.equal(second.event, 'button "Open INV-1003" is no longer on the page.');
    await session.untilState("pointing");
  } finally {
    await session.close();
  }
});

test("a dialog the page opens over the control by itself is noticed, and the step asked for again", async () => {
  const page = `<main><h1>Workspace</h1><button id="rename" type="button">Rename workspace</button></main>
    <script>
      window.expire = () => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:50';
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', 'Session expiring');
        dialog.style.cssText = 'position:fixed;top:30vh;left:30vw;width:400px;padding:16px;background:#fff;z-index:51';
        dialog.innerHTML = '<p>You will be signed out soon.</p><button type="button">Stay signed in</button>';
        document.body.append(overlay, dialog);
      };
    </script>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Rename workspace", "Click Rename workspace.") : point(request, "Stay signed in", "Stay signed in first.")));
  try {
    await session.ask("rename the workspace");
    await session.untilState("pointing");
    await session.page.evaluate(() => (window as unknown as { expire(): void }).expire());
    await letGo(session, "Click Rename workspace.", "a dialog opened over it");
    const second = await session.untilAsked(2, 2500);
    assert.equal(second.event, 'A dialog opened over button "Rename workspace", so it cannot be used until the dialog is closed.');
    assert.equal(second.snapshot.dialog, "Session expiring");
  } finally {
    await session.close();
  }
});

// A row's action that shows only while the mouse is over the row ------------------------------------------------

for (const [what, extra] of [
  ["see-through until the mouse is over its row", ""],
  ["see-through and closed to the mouse until it is over its row", "pointer-events-none group-hover/row:pointer-events-auto"],
] as const) {
  test(`a row's Pay that is ${what} is listed as showing on hover, pointed at where it shows, and never clicked or focused for the visitor`, async () => {
    const page = `${ROW_STYLES}<main><h1>Bills</h1><div role="table" aria-label="Bills">
      ${row("INV-46951", "Linden Logistics", '<button id="pay" type="button">Pay</button>', extra)}
      ${row("INV-51210", "Brightdesk", '<button type="button">Pay</button>', extra)}
      </div></main>
      <script>window.pays = 0; document.getElementById('pay').addEventListener('click', () => window.pays++);</script>`;
    const say = "Move over the INV-46951 row, then click Pay.";
    const session = await start(page, (request, index) => (index === 0 ? { target: idOf(request, "Pay"), status: "continue", say } : words("Done.")));
    try {
      await session.ask("Pay bill INV-46951");
      await session.untilState("pointing");
      const listed = session.requests[0]!.snapshot.elements.filter((element) => element.label === "Pay");
      assert.equal(listed.length, 2);
      for (const pay of listed) assert.deepEqual(pay.state, ["shows on hover"]);
      assert.equal(await session.pointed(), "pay");
      // The ring is on where Pay shows, though nothing shows there yet.
      const ring = await session.page.evaluate(() => {
        const box = (document.querySelector("haptic-root")!.shadowRoot!.querySelector(".ring") as HTMLElement).getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2, hidden: (document.querySelector("haptic-root")!.shadowRoot!.querySelector(".ring") as HTMLElement).hidden };
      });
      const pay = await session.page.locator("#pay").boundingBox();
      assert.equal(ring.hidden, false);
      assert.ok(Math.abs(ring.x - (pay.x + pay.width / 2)) < 2 && Math.abs(ring.y - (pay.y + pay.height / 2)) < 2, JSON.stringify({ ring, pay }));
      assert.equal(await session.page.evaluate(() => getComputedStyle(document.getElementById("pay")!.parentElement!).opacity), "0");
      // Nothing clicked it or put the keyboard on it.
      assert.deepEqual(await session.page.evaluate(() => [(window as unknown as { pays: number }).pays, document.activeElement?.id ?? ""]), [0, ""]);
      // The mouse passes over the row, which shows Pay, and goes away again, which hides it. That is not the step, nor its going.
      await session.page.mouse.move(pay.x + pay.width / 2, pay.y + pay.height / 2, { steps: 4 });
      assert.equal(await session.page.evaluate(() => getComputedStyle(document.getElementById("pay")!.parentElement!).opacity), "1");
      await session.page.mouse.move(pay.x - 400, pay.y + 300, { steps: 4 });
      await session.page.waitForTimeout(1200);
      assert.equal(session.requests.length, 1);
      assert.equal(await session.state(), "pointing");
      assert.equal(await session.pointed(), "pay");
      assert.deepEqual(await shown(session), { pointer: true, caption: say });
      // Then they click it.
      await session.page.mouse.move(pay.x + pay.width / 2, pay.y + pay.height / 2, { steps: 4 });
      await session.page.mouse.click(pay.x + pay.width / 2, pay.y + pay.height / 2);
      const second = await session.untilAsked(2);
      assert.match(second.event ?? "", /^The user clicked button "Pay"/);
      assert.equal(await session.page.evaluate(() => (window as unknown as { pays: number }).pays), 1);
    } finally {
      await session.close();
    }
  });
}
