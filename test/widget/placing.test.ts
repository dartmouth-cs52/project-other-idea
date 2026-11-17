import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// Where the pointer, its caption and the launcher go. Haptic draws over
// someone else's page: nothing it draws may stand between the visitor and the
// control they were shown, or what that control opens.

type Box = { left: number; top: number; right: number; bottom: number };

/** The box of something Haptic draws, by its class. */
const ours = (session: Session, part: string): Promise<Box> =>
  session.page.evaluate((selector: string) => {
    const rect = document.querySelector("haptic-root")!.shadowRoot!.querySelector(selector)!.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }, part);

/** What a click at the middle of a box would land on: the id of a page element, or "haptic" for anything of ours. */
const hitAt = (session: Session, box: Box): Promise<string> =>
  session.page.evaluate(({ x, y }: { x: number; y: number }) => {
    const hit = document.elementFromPoint(x, y);
    return !hit ? "" : hit.tagName === "HAPTIC-ROOT" ? "haptic" : hit.id || hit.tagName.toLowerCase();
  }, { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });

/** Where the tip of the pointer is. */
const tip = (session: Session): Promise<{ x: number; y: number }> =>
  session.page.evaluate(() => {
    const cursor = document.querySelector("haptic-root")!.shadowRoot!.querySelector(".cursor") as HTMLElement;
    const [x, y] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(cursor.style.transform)!.slice(1).map(Number);
    return { x: x! + 3.81, y: y! + 3.14 };
  });

const pointedIs = (session: Session, selector: string) =>
  session.page.evaluate((s: string) => (document.querySelector("haptic-root") as unknown as { pointedAt?: Element }).pointedAt === document.querySelector(s), selector);

const COMBO = `<h1>Rules</h1>
  <div style="position:relative;width:240px">
    <input id="size" role="combobox" aria-label="Page size" aria-expanded="false" style="width:220px;height:28px">
    <div id="list" role="listbox" hidden style="position:absolute;top:34px;left:0;width:240px;background:#fff;border:1px solid #999">
      ${["10 / page", "20 / page", "50 / page", "100 / page"].map((size, n) => `<div id="o${n}" role="option" style="padding:8px;cursor:pointer">${size}</div>`).join("")}
    </div>
  </div><p id="out"></p><button type="button">Query</button>
  <script>
    const size = document.getElementById('size'), list = document.getElementById('list');
    size.addEventListener('mousedown', () => { list.hidden = false; size.setAttribute('aria-expanded', 'true'); });
    for (const option of list.children) option.addEventListener('click', () => { list.hidden = true; size.setAttribute('aria-expanded', 'false'); document.getElementById('out').textContent = 'Showing ' + option.textContent; });
  </script>`;

test("the caption lets clicks through to the page, all but its close button, and keeps off a list that opens under it", async () => {
  const session = await start(COMBO, (request, index) => (index === 0 ? point(request, "Page size", "Open Page size and choose 50 / page.") : words("The table shows 50 rows.")));
  try {
    await session.ask("show 50 rows");
    await session.untilState("pointing");
    await session.page.waitForTimeout(400);
    const before = await ours(session, ".caption");
    // Clicking into a field that types is not the step, so the caption stays while its list opens.
    await session.page.locator("#size").click();
    await session.page.waitForTimeout(100);
    assert.notEqual(await hitAt(session, before), "haptic", "the caption took a click meant for the list under it");
    assert.equal(await hitAt(session, await ours(session, ".caption .close")), "haptic", "the close button no longer takes clicks");
    // A field that types has its caption above it from the start, so the list that opens under it is clear.
    await session.page.waitForTimeout(500);
    const moved = await ours(session, ".caption");
    const field = await session.page.locator("#size").boundingBox();
    assert.ok(moved.bottom <= field.y, `the caption is still over the list: its top is ${moved.top}, the field's is ${field.y}`);
    await session.page.locator("#o2").click();
    await session.untilAsked(2);
    assert.match(session.requests[1]!.event ?? "", /^The user chose "50 \/ page" from the list that combobox "Page size" opened\./);
  } finally {
    await session.close();
  }
});

const INVITE = `<h1>Invite people</h1>
  <label for="email" style="display:block;margin-top:120px">Email address</label>
  <input id="email" type="email" placeholder="new.hire@example.com" style="width:320px;height:32px">
  <div style="position:relative;margin-top:24px">
    <button id="role" type="button" aria-haspopup="menu" aria-expanded="false" style="height:32px">Employee</button>
    <div id="roles" role="menu" hidden style="position:absolute;top:38px;left:0;width:360px;background:#fff;border:1px solid #999">
      ${["Employee", "Manager", "Admin"].map((role) => `<div role="menuitem" style="padding:10px">${role}</div>`).join("")}
    </div>
  </div>
`;

test("the caption goes above a text field, where the browser's own suggestions open below it, and below a button until something opens under it (Northpine: Chrome's saved addresses covered the caption on the invite's email field)", async () => {
  const session = await start(INVITE, (request, index) =>
    index === 0 ? point(request, "Email address", "Type the email of the person you want to invite.") : index === 1 ? point(request, "Employee", "Click Employee to pick their role.") : words("Done."),
  );
  try {
    await session.ask("invite someone");
    await session.untilState("pointing");
    await session.page.waitForTimeout(700);
    const field = (await session.page.locator("#email").boundingBox())!;
    const overField = await ours(session, ".caption");
    assert.ok(overField.bottom <= field.y, `the caption is not above the email field: its bottom is ${overField.bottom}, the field's top ${field.y}`);
    await session.page.locator("#email").fill("sam@example.com");
    await session.untilAsked(2, 10_000);
    await session.untilState("pointing");
    await session.page.waitForTimeout(700);
    const button = (await session.page.locator("#role").boundingBox())!;
    const underButton = await ours(session, ".caption");
    assert.ok(underButton.top >= button.y + button.height, `the caption is not below the button: its top is ${underButton.top}, the button's bottom ${button.y + button.height}`);
    // A menu the page opens by itself, where the caption is: the caption moves to the other side, and stays on show.
    await session.page.evaluate(() => (document.getElementById("roles")!.hidden = false));
    await session.page.waitForTimeout(700);
    const moved = await ours(session, ".caption");
    assert.ok(moved.bottom > moved.top, "the caption is not on show");
    assert.ok(moved.bottom <= button.y, `the caption stayed on the menu: its bottom is ${moved.bottom}, the button's top ${button.y}`);
  } finally {
    await session.close();
  }
});

test("a tick box drawn as a hidden speck under its label is pointed at by its label", async () => {
  const page = `<h1>Issue</h1><p>Some text before the row.</p>
    <label id="watch" style="display:inline-block;padding:6px 10px;border:1px solid #999;position:relative">Watch this issue
      <input id="box" type="checkbox" style="position:absolute;left:0;top:0;width:1px;height:1px;margin:0;opacity:0"></label>
    <p>Some text after the row.</p><button type="button">Comment</button>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Watch this issue", "Tick Watch this issue.") : words("You are watching it.")));
  try {
    await session.ask("watch this issue");
    await session.untilState("pointing");
    await session.page.waitForTimeout(700);
    assert.ok(await pointedIs(session, "#watch"), "the pointer is not on the label");
    const label = (await session.page.locator("#watch").boundingBox())!;
    const ring = await ours(session, ".ring");
    assert.ok(Math.abs(ring.left + 4 - label.x) < 2 && Math.abs(ring.right - 4 - (label.x + label.width)) < 2, "the ring is not round the label");
    await session.page.locator("#watch").click();
    const second = await session.untilAsked(2);
    assert.match(second.event ?? "", /^The user clicked checkbox "Watch this issue"\./);
  } finally {
    await session.close();
  }
});

test("a panel whose middle is a frame is pointed at by its title, which takes the click", async () => {
  const page = `<h1>Dashboard</h1>
    <section id="panel" role="button" tabindex="0" aria-labelledby="title" style="width:460px;height:300px;border:1px solid #999">
      <div id="title" style="height:32px;padding:6px">Sales by region</div>
      <iframe srcdoc="<p>Chart</p>" style="width:100%;height:250px;border:0"></iframe>
    </section><button type="button">Add panel</button>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Sales by region", "Click the Sales by region panel.") : words("The panel is open.")));
  try {
    await session.ask("open the sales panel");
    await session.untilState("pointing");
    await session.page.waitForTimeout(700);
    assert.ok(await pointedIs(session, "#title"), "the pointer is not on the panel's title");
    await session.page.locator("#title").click();
    const second = await session.untilAsked(2);
    assert.match(second.event ?? "", /^The user clicked button "Sales by region"\./);
  } finally {
    await session.close();
  }
});

test("the tip of the pointer stays on the control when something else sits on its corner", async () => {
  const page = `<h1>Dashboard</h1>
    <div style="position:relative;width:300px;height:160px">
      <div id="panel" role="button" tabindex="0" aria-label="Errors panel" style="width:300px;height:160px;border:1px solid #999">Errors</div>
      <div id="handle" style="position:absolute;right:0;bottom:0;width:24px;height:24px;background:#ddd;cursor:se-resize"></div>
    </div><button type="button">Add panel</button>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Errors panel", "Click the Errors panel.") : words("Done.")));
  try {
    await session.ask("open errors");
    await session.untilState("pointing");
    await session.page.waitForTimeout(900);
    const at = await tip(session);
    const under = await hitAt(session, { left: at.x, right: at.x, top: at.y, bottom: at.y });
    assert.equal(under, "panel", `the tip rests on ${under}`);
  } finally {
    await session.close();
  }
});

test("the launcher moves out of the way of a control in its corner, and back when the guide moves on", async () => {
  const page = `<h1>Wizard</h1><button type="button">Back</button>
    <button id="next" type="button" style="position:fixed;right:24px;bottom:24px;padding:10px 24px">Next</button>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Next", "Click Next.") : words("You are on the last step.")));
  try {
    await session.ask("go on");
    await session.untilState("pointing");
    await session.page.waitForTimeout(700);
    const next = (await session.page.locator("#next").boundingBox())!;
    const launcher = await ours(session, ".launcher");
    assert.ok(launcher.right < next.x || launcher.left > next.x + next.width, "the launcher covers the Next button");
    assert.equal(await hitAt(session, { left: next.x, right: next.x + next.width, top: next.y, bottom: next.y + next.height }), "next");
    await session.page.locator("#next").click();
    await session.untilState("finished");
    await session.page.waitForTimeout(300);
    const home = await ours(session, ".launcher");
    assert.ok(home.left > 683, "the launcher did not go back to its own corner");
  } finally {
    await session.close();
  }
});

test("the space around the launcher and the ask box takes no clicks: a page button beside the launcher can still be pressed", async () => {
  // UI5's dialog puts its Close button in the window's lower right corner, beside where the launcher sits below the open box.
  const page = `<h1>Order</h1><button id="close" type="button" style="position:fixed;right:150px;bottom:24px">Close</button><p id="out"></p>
    <script>document.getElementById('close').addEventListener('click', () => { document.getElementById('out').textContent = 'Closed'; });</script>`;
  const session = await start(page, () => words("Click Close."));
  try {
    await session.page.locator("haptic-root .launcher").click();
    await session.page.waitForTimeout(200);
    const close = (await session.page.locator("#close").boundingBox({ timeout: 5000 }))!;
    const panel = await ours(session, ".panel");
    assert.ok(close.x + close.width / 2 > panel.left && close.y > panel.bottom, "the test page's button is not beside the launcher, under the open box");
    assert.equal(await hitAt(session, { left: close.x, right: close.x + close.width, top: close.y, bottom: close.y + close.height }), "close", "the empty space beside the launcher took the click");
  } finally {
    await session.close();
  }
});

// Where the launcher sits while no guide runs. Sites keep their own controls
// in the window's lower corners: a chat button, a Feedback tab, a "Customize"
// button pinned there, and at the foot of a page the footer's last links,
// which no scrolling brings out from under the launcher.

const overlap = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const boxOf = async (session: Session, selector: string): Promise<Box> => {
  const box = (await session.page.locator(selector).boundingBox({ timeout: 5000 }))!;
  return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height };
};
/** The launcher is free of every one of these controls, and a click at the middle of each lands on it. */
async function launcherClearOf(session: Session, selectors: string[]): Promise<Box> {
  const launcher = await ours(session, ".launcher");
  for (const selector of selectors) {
    const box = await boxOf(session, selector);
    assert.ok(!overlap(launcher, box), `the launcher (${JSON.stringify(launcher)}) covers ${selector} (${JSON.stringify(box)})`);
    assert.equal(await hitAt(session, box), selector.slice(1), `a click on ${selector} lands on something else`);
  }
  return launcher;
}

test("the launcher does not sit on a chat button the page pins in its corner, and stays near that corner", async () => {
  const page = `<h1>Store</h1><p>Find the right Mac for you.</p>
    <button id="chat" type="button" aria-label="Chat with a specialist" style="position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:28px">Chat</button>`;
  const session = await start(page, () => words("Use Chat."));
  try {
    await session.page.waitForTimeout(300);
    const launcher = await launcherClearOf(session, ["#chat"]);
    assert.ok(launcher.left > 683 && launcher.bottom > 800 - 160, `the launcher went far from its corner: ${JSON.stringify(launcher)}`);
    // It still opens the ask box, where it now is.
    await session.ask("talk to someone");
    await session.untilAsked(1, 5000);
  } finally {
    await session.close();
  }
});

test("the launcher does not sit on a Feedback tab and a Customize button pinned on its side of the window", async () => {
  const page = `<h1>Data</h1><p>Datasets from the federal government.</p>
    <button id="feedback" type="button" style="position:fixed;right:0;bottom:120px;width:44px;height:110px">Feedback</button>
    <button id="customize" type="button" aria-label="Customize" style="position:fixed;right:24px;bottom:24px;width:48px;height:48px;border-radius:24px">C</button>`;
  const session = await start(page, () => words("Use Feedback."));
  try {
    await session.page.waitForTimeout(300);
    const launcher = await launcherClearOf(session, ["#feedback", "#customize"]);
    assert.ok(launcher.left > 683, `the launcher left its side: ${JSON.stringify(launcher)}`);
  } finally {
    await session.close();
  }
});

test("at the foot of a page the launcher does not sit on the footer's last links", async () => {
  // Material Dashboard's footer: its links end in the lower right corner, at the very end of the page.
  const page = `<h1>Dashboard</h1>${Array.from({ length: 30 }, (_, n) => `<p>Row ${n + 1} of the report.</p>`).join("")}
    <footer style="display:flex;justify-content:flex-end;gap:16px;padding:12px 0 0"><a id="team" href="#team">Team</a><a id="blog" href="#blog">Blog</a><a id="license" href="#license">License</a></footer>`;
  const session = await start(page, () => words("The license is in the footer."));
  try {
    await session.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await session.page.waitForTimeout(300);
    await launcherClearOf(session, ["#license", "#blog", "#team"]);
  } finally {
    await session.close();
  }
});

test("when the window is resized, the launcher moves off a control that came into its corner, and back once the corner is free", async () => {
  const page = `<style>#help { position: fixed; left: 20px; bottom: 20px; width: 90px; height: 44px } @media (max-width: 900px) { #help { left: auto; right: 16px } }</style>
    <h1>Board</h1><button id="help" type="button">Help</button>`;
  const session = await start(page, () => words("Use Help."));
  try {
    await session.page.waitForTimeout(300);
    const wide = await ours(session, ".launcher");
    await session.page.setViewportSize({ width: 800, height: 700 });
    await session.page.waitForTimeout(300);
    await launcherClearOf(session, ["#help"]);
    await session.page.setViewportSize({ width: 1366, height: 800 });
    await session.page.waitForTimeout(300);
    const back = await ours(session, ".launcher");
    assert.deepEqual(back, wide, "the launcher did not go back to its corner once it was free");
  } finally {
    await session.close();
  }
});

test("the site's own corner wins: a launcher set to the lower left stays on the left, beside the page's button there", async () => {
  const page = `<h1>Account</h1><button id="cookies" type="button" style="position:fixed;left:16px;bottom:16px;width:120px;height:40px">Cookie settings</button>`;
  const session = await start(page, () => words("Use Cookie settings."), "/", { appearance: { position: "bottom-left" } });
  try {
    await session.page.waitForTimeout(300);
    const launcher = await launcherClearOf(session, ["#cookies"]);
    assert.ok(launcher.right < 683, `the launcher left the site's side: ${JSON.stringify(launcher)}`);
  } finally {
    await session.close();
  }
});
