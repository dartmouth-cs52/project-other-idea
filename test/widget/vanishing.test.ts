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

type Rect = { x: number; y: number; width: number; height: number };

/** Where the ring and the caption are drawn, and where the pointer's tip is. */
const drawnRound = (session: Session): Promise<{ ring: Rect & { hidden: boolean }; caption: Rect; tip: { x: number; y: number } }> =>
  session.page.evaluate(() => {
    const root = document.querySelector("haptic-root")!.shadowRoot!;
    // Written without a named function inside, which the test runner's build would wrap in a helper the page does not have.
    const [ring, caption, cursor] = [".ring", ".caption", ".cursor svg"].map((selector) => {
      const el = root.querySelector(selector) as HTMLElement;
      const box = el.getBoundingClientRect();
      return { x: box.left, y: box.top, width: box.width, height: box.height, hidden: el.hidden };
    }) as [Rect & { hidden: boolean }, Rect, Rect];
    // The tip is at 3.81, 3.14 of the pointer's 24 by 24.
    return { ring, caption, tip: { x: cursor.x + (3.81 * cursor.width) / 24, y: cursor.y + (3.14 * cursor.height) / 24 } };
  });
const surrounds = (outer: Rect, inner: Rect) => outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
const crosses = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

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

test("the browser's own modal dialog closed by a click on its backdrop, which lands on the dialog itself, is a click outside it", async () => {
  // As Northpine draws its dialogs with lab.nativeDialogs=1: showModal(), and a click whose target is the dialog closes it.
  const page = `<main><h1>Bills</h1><button id="pay" type="button">Pay</button></main>
    <dialog id="dialog" aria-labelledby="title" style="width:480px;padding:16px"><h2 id="title">Pay Linden Logistics</h2><button type="button" id="continue">Continue</button></dialog>
    <script>
      const dialog = document.getElementById('dialog');
      document.getElementById('pay').addEventListener('click', () => dialog.showModal());
      dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    </script>`;
  const session = await start(page, payScript);
  try {
    await session.ask("Pay bill INV-46951");
    await session.untilState("pointing");
    await session.page.locator("#pay").click();
    await session.until(async () => (await session.state()) === "pointing" && (await shown(session)).caption === CONTINUE, "the pointer on Continue");
    await session.page.mouse.click(30, 760);
    await letGo(session, CONTINUE, "the dialog closed");
    const third = await session.untilAsked(3, 3000);
    assert.equal(third.event, 'The user clicked outside the dialog "Pay Linden Logistics", which closed it without using button "Continue".');
    await session.until(async () => (await session.state()) === "pointing" && (await shown(session)).caption === AGAIN, "the pointer back on Pay");
    assert.deepEqual((await shown(session)).pointer, true);
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
const LIST = `<main><h1>Invoices</h1><input id="search" aria-label="Search invoices"><ul id="list"></ul></main>
  <script>
    const rows = [['INV-1001', 'Paid'], ['INV-1002', 'Overdue'], ['INV-1003', 'Draft']];
    const draw = (only) => { document.getElementById('list').innerHTML = rows.filter((row) => !only || row[1] === only).map((row) => '<li>' + row[0] + ' (' + row[1] + ') <button type="button">Open ' + row[0] + '</button></li>').join(''); };
    draw();
    window.redraw = () => draw();
    window.overdueOnly = () => draw('Overdue');
    document.getElementById('search').addEventListener('input', (event) => {
      const words = event.target.value.toLowerCase();
      document.getElementById('list').innerHTML = rows.filter((row) => (row[0] + ' ' + row[1]).toLowerCase().includes(words)).map((row) => '<li>' + row[0] + ' (' + row[1] + ') <button type="button">Open ' + row[0] + '</button></li>').join('');
    });
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

test("a list the visitor filters by typing in a search box, which takes the control away, is noticed within a second, and typing is not an unidentified press", async () => {
  const session = await start(LIST, (request, index) => (index === 0 ? point(request, "Open INV-1003", "Open the draft.") : index === 1 ? point(request, "Search invoices", "Clear the search to see the draft again.") : words("Done.")));
  try {
    await session.ask("open the draft invoice");
    await session.untilState("pointing");
    await session.page.locator("#search").pressSequentially("overdue", { delay: 60 });
    await letGo(session, "Open the draft.", "the search took it out of the list");
    const second = await session.untilAsked(2, 3000);
    assert.equal(second.event, 'button "Open INV-1003" is no longer on the page.');
    assert.ok(!JSON.stringify(second).toLowerCase().includes('"overdue"'), "what was typed was sent");
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

// A page that keeps taking the pointed control away --------------------------------------------------------------
//
// From the review of 42ecfb6 (N9): a page that draws its button again under a new name every 900 ms. Each time, the
// pointer's control was gone, and the next step was asked for: 32 requests in 40 seconds, until the guide's twenty
// steps ran out. Three such questions in half a minute are enough. The model here answers at once, so that its
// answer is not about a control that has gone again by the time it comes, which is another path with its own limit.

/** Every ending the widget has reported, in order. */
function endings(session: Session): unknown[] {
  const sent: unknown[] = [];
  session.page.on("request", (request: { url(): string; postData(): string | null }) => {
    if (!/\/v1\/guides\/[^/]+\/report$/.test(request.url())) return;
    const outcome = (JSON.parse(request.postData() ?? "{}") as { outcome?: string }).outcome;
    if (outcome) sent.push(outcome);
  });
  return sent;
}

test("a page that keeps replacing the pointed control is asked about again three times, then the guide stops and says why", async () => {
  const page = `<main><h1>Team</h1><div id="box"><button type="button">Invite</button></div></main>
    <script>let n = 0; setInterval(() => { document.getElementById('box').innerHTML = '<button type="button">Invite ' + ++n + '</button>'; }, 900);</script>`;
  const session = await start(page, (request) => {
    const invite = request.snapshot.elements.find((element) => /^Invite/.test(element.label));
    return invite ? { target: invite.id, status: "continue", say: "Click Invite." } : words("Wait for Invite to come back.", "continue");
  });
  const ended = endings(session);
  try {
    await session.ask("how do I invite someone");
    await session.untilState("finished", 20_000);
    assert.equal((await shown(session)).caption, "This page keeps taking away what I point at, so I've stopped for now. Ask again once it settles.");
    assert.equal((await shown(session)).pointer, false, "the pointer was left up");
    // The first question and three more. One whose control had gone again by the time its answer came is asked once
    // more on top, as it always was, so a few more are allowed for.
    const asked = session.requests.length;
    assert.ok(asked >= 4 && asked <= 8, `${asked} questions were asked`);
    // Three controls that went were asked about, each by its own name. The fourth ended the guide.
    const went = new Set(session.requests.map((request) => request.event ?? "").filter((event) => / is no longer on the page\.$/.test(event)));
    assert.equal(went.size, 3, JSON.stringify(session.requests.map((request) => request.event)));
    await session.page.waitForTimeout(3000);
    assert.equal(session.requests.length, asked, "it asked again after it stopped");
    assert.deepEqual(ended, ["loop"]);
  } finally {
    await session.close();
  }
});

test("a control the page draws again and again is pointed at on each new node, with no question and no stopping", async () => {
  const page = `<main><h1>Team</h1><div id="box"><button type="button">Invite</button></div></main>
    <script>setInterval(() => { document.getElementById('box').innerHTML = '<button type="button">Invite</button>'; }, 400);</script>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Invite", "Click Invite.") : words("Done.")));
  try {
    await session.ask("how do I invite someone");
    await session.untilState("pointing");
    // Ten times and more: well past what would stop a guide whose control really went.
    await session.page.waitForTimeout(4500);
    assert.equal(session.requests.length, 1);
    assert.notEqual(await session.state(), "finished");
    // Between one drawing and the next the pointer may be down for a moment. It comes back on the Invite that is there.
    await session.until(
      async () =>
        (await session.state()) === "pointing" &&
        (await shown(session)).caption === "Click Invite." &&
        (await session.page.evaluate(() => !!(document.querySelector("haptic-root") as Element & { pointedAt?: Element }).pointedAt?.isConnected)),
      "the pointer and its sentence on the Invite now on the page",
      2000,
    );
    // And the visitor's click on it is still heard as the step.
    await session.page.locator("#box button").click();
    const second = await session.untilAsked(2, 4000);
    assert.match(second.event ?? "", /clicked button "Invite"/);
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
      // Nothing shows where Pay will yet: the ring is round the row the mouse has to be over, and the pointer's tip is
      // where Pay will show.
      await session.page.waitForTimeout(800);
      const pay = await session.page.locator("#pay").boundingBox();
      const rowBox = await session.page.locator(".group\\/row").first().boundingBox();
      const drawn = await drawnRound(session);
      assert.equal(drawn.ring.hidden, false);
      assert.ok(surrounds(drawn.ring, rowBox), `the ring ${JSON.stringify(drawn.ring)} is not round the row ${JSON.stringify(rowBox)}`);
      assert.ok(drawn.tip.x >= pay.x && drawn.tip.x <= pay.x + pay.width && drawn.tip.y >= pay.y && drawn.tip.y <= pay.y + pay.height, JSON.stringify({ tip: drawn.tip, pay }));
      assert.ok(!crosses(drawn.caption, rowBox), `the caption ${JSON.stringify(drawn.caption)} covers the row`);
      assert.equal(await session.page.evaluate(() => getComputedStyle(document.getElementById("pay")!.parentElement!).opacity), "0");
      // Nothing clicked it or put the keyboard on it.
      assert.deepEqual(await session.page.evaluate(() => [(window as unknown as { pays: number }).pays, document.activeElement?.id ?? ""]), [0, ""]);
      // The mouse passes over the row, which shows Pay, and goes away again, which hides it. That is not the step, nor its going.
      await session.page.mouse.move(pay.x + pay.width / 2, pay.y + pay.height / 2, { steps: 4 });
      assert.equal(await session.page.evaluate(() => getComputedStyle(document.getElementById("pay")!.parentElement!).opacity), "1");
      // Once it shows, the ring is on Pay itself.
      await session.page.waitForTimeout(100);
      assert.ok(surrounds((await drawnRound(session)).ring, pay) && !surrounds((await drawnRound(session)).ring, rowBox), "the ring did not go to Pay once it showed");
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
      // Shown now because the mouse is over its row: that is not something that became of it.
      assert.doesNotMatch(second.event ?? "", /shows on hover/);
      assert.equal(await session.page.evaluate(() => (window as unknown as { pays: number }).pays), 1);
    } finally {
      await session.close();
    }
  });
}

for (const present of [false, true]) {
  test(`${present ? "in presentation mode, " : ""}a sentence that does not say to move over the row is told so by the caption, which keeps off the row, and nothing is clicked or focused`, async () => {
    // Rows as wide as the page, low on it, as a list of cards is: the row's action is at its far end, in the launcher's corner.
    const page = `${ROW_STYLES}<style>.row { width: auto }</style><main><h1>Cards</h1><div role="table" aria-label="Cards" style="margin-top:500px">
      ${row("Travel", "Avery Stone", '<button type="button" aria-label="Freeze card">*</button>')}
      ${row("Team offsite", "Avery Stone", '<button id="freeze" type="button" aria-label="Freeze card">*</button>')}
      ${row("Malika's card", "Malika Cummerata", '<button type="button" aria-label="Freeze card">*</button>')}
      </div></main>
      <script>window.pressed = 0; document.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => window.pressed++));</script>`;
    // What the model said on Northpine, which names the row but not the mouse.
    const say = "Click the Freeze card button (snowflake icon) on the Team offsite row, card ending 8774. New charges on it will be declined right away.";
    const session = await start(
      page,
      (request, index) => {
        if (index > 0) return words("Done.");
        const freeze = request.snapshot.elements.filter((element) => element.label === "Freeze card");
        return { target: freeze[1]!.id, status: "continue", say };
      },
      "/",
      { present },
    );
    try {
      await session.page.mouse.move(40, 40);
      await session.ask("Someone has my Team offsite card number. Lock it now.");
      await session.untilState("pointing");
      assert.equal(await session.pointed(), "freeze");
      await session.page.waitForTimeout(1000);
      assert.equal(await session.caption(), `${say} Move the mouse over the outlined row to see it.`);
      const rowBox = await session.page.locator(".group\\/row").nth(1).boundingBox();
      const freeze = await session.page.locator("#freeze").boundingBox();
      const drawn = await drawnRound(session);
      assert.ok(surrounds(drawn.ring, rowBox), `the ring ${JSON.stringify(drawn.ring)} is not round the row ${JSON.stringify(rowBox)}`);
      assert.ok(drawn.tip.x >= freeze.x && drawn.tip.x <= freeze.x + freeze.width && drawn.tip.y >= freeze.y && drawn.tip.y <= freeze.y + freeze.height, JSON.stringify({ tip: drawn.tip, freeze }));
      assert.ok(!crosses(drawn.caption, rowBox), `the caption ${JSON.stringify(drawn.caption)} covers the row ${JSON.stringify(rowBox)}`);
      // The chat, open through the guide, keeps off where Freeze card will show, the pointer on it, and the caption.
      const chat = (await session.page.locator("haptic-root .panel").boundingBox())!;
      assert.ok(!crosses(chat, freeze), `the chat ${JSON.stringify(chat)} covers where Freeze card shows ${JSON.stringify(freeze)}`);
      assert.ok(!crosses(chat, { x: drawn.tip.x - 2, y: drawn.tip.y - 2, width: 4, height: 4 }), `the chat covers the pointer's tip ${JSON.stringify(drawn.tip)}`);
      assert.ok(!crosses(chat, drawn.caption), `the chat covers the caption ${JSON.stringify(drawn.caption)}`);
      assert.deepEqual(await session.page.evaluate(() => [(window as unknown as { pressed: number }).pressed, document.activeElement?.tagName ?? ""]), [0, "BODY"]);
      assert.equal(await session.page.evaluate(() => getComputedStyle(document.getElementById("freeze")!.parentElement!).opacity), "0");
    } finally {
      await session.close();
    }
  });
}

test("a control that shows on hover is not hinted at while Haptic uses it itself", async () => {
  const page = `${ROW_STYLES}<main><h1>Bills</h1><div role="table" aria-label="Bills">
    ${row("INV-46951", "Linden Logistics", '<button id="view" type="button">View</button>')}
    </div></main>`;
  const seen: string[] = [];
  const session: Session = await start(
    page,
    async (request, index) => {
      if (index === 0) return { target: idOf(request, "View"), do: "click", enter: null, commits: false, status: "continue", say: "Opening the bill.", mode: "act" };
      seen.push(await session.caption());
      return words("Done.");
    },
    "/",
    { acting: { maxActions: 25, confirmFirst: false } },
  );
  try {
    await session.page.mouse.move(40, 40);
    await session.ask("can you open bill INV-46951", { act: true });
    await session.untilState("acting", 10_000);
    for (const until = Date.now() + 3000; Date.now() < until && session.requests.length < 2; ) {
      const caption = await session.caption();
      if (caption) seen.push(caption);
      await session.page.waitForTimeout(30);
    }
    assert.ok(seen.length > 0, "no caption was read");
    for (const caption of seen) assert.doesNotMatch(caption, /Move the mouse/);
  } finally {
    await session.close();
  }
});
