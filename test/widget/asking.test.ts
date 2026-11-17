import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// Asking something else while a guide is up, and typing a long question.
//
// With a pointer on show the launcher opened a panel that held only "Your
// turn" and Stop. A visitor had no way to ask anything else from there, and
// what they typed went to the page: on Northpine, whose own keyboard shortcuts
// heard the letters and took them to another page. The chat keeps its ask box
// while a guide runs. It now says it is the way to ask something else, Send
// comes back beside Stop once something is typed, sending ends the guide as
// Stop does, and the launcher puts the keyboard in it.

/**
 * A page with keyboard shortcuts of its own, heard on the window as an app's are: a letter typed anywhere but in one of
 * the page's own fields is acted on. Every key the page hears is kept, and "n" goes to another view.
 */
const SHORTCUTS = `<h1>Orders</h1><p id="where">Orders</p>
  <button id="export" type="button" style="margin:120px 0 0 200px">Export</button>
  <script>
    window.heard = [];
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      window.heard.push(event.key);
      if (event.key === 'n') document.getElementById('where').textContent = 'New order';
    });
  </script>`;

/** The keys the page heard, and the view it is on. */
const page = (session: Session) => session.page.evaluate(() => ({ heard: (window as unknown as { heard: string[] }).heard, where: document.getElementById("where")?.textContent }));

/** Every report the widget has sent, in order. */
function reports(session: Session): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  session.page.on("request", (request: { url(): string; postData(): string | null }) => {
    const found = /\/v1\/guides\/([^/]+)\/report$/.exec(request.url());
    if (found) sent.push({ guide: found[1], ...JSON.parse(request.postData() ?? "{}") });
  });
  return sent;
}

/** What the chat shows: whether it is open, its status line, the ask box's words, which of its buttons show, and what of ours holds the keyboard. */
const panel = (session: Session) =>
  session.page.evaluate(() => {
    const root = document.querySelector("haptic-root")!.shadowRoot!;
    // Written without a named function inside, which the test runner's build would wrap in a helper the page does not have.
    const [open, status, send, stop] = [".panel", ".status", ".ask .send", ".ask .stop"].map((selector) => {
      const el = root.querySelector(selector) as HTMLElement | null;
      return !!el && !el.hidden && el.getClientRects().length > 0;
    });
    const box = root.querySelector(".ask textarea") as HTMLTextAreaElement;
    const holds = root.activeElement;
    return {
      open,
      status: status ? (root.querySelector(".status span")?.textContent ?? "") : "",
      placeholder: box.placeholder,
      send,
      stop,
      keyboard: holds ? (holds.className || holds.tagName.toLowerCase()) : "",
    };
  });

test("with a pointer up, the chat's ask box is the way to ask something else, and what is typed there never reaches the page", async () => {
  const session = await start(SHORTCUTS, (request, index) => (index === 0 ? point(request, "Export", "Click Export.") : words("Invoices are under Billing.")));
  const sent = reports(session);
  try {
    await session.ask("how do I export my orders");
    await session.untilState("pointing");
    const first = session.requests[0]!;
    const up = await panel(session);
    assert.deepEqual([up.open, up.placeholder, up.send, up.stop], [true, "Ask something else", false, true]);
    // The visitor put the chat away, and presses Ask to ask something else: the keyboard is in the ask box.
    await session.page.locator("haptic-root .launcher").click();
    assert.equal((await panel(session)).open, false);
    await session.page.locator("haptic-root .launcher").click();
    assert.equal((await panel(session)).keyboard, "textarea");
    // They type before reading. The keys are Haptic's, the page's shortcuts hear none of them, and the guide stays up.
    await session.page.keyboard.type("new", { delay: 20 });
    assert.deepEqual(await page(session), { heard: [], where: "Orders" });
    assert.equal(await session.state(), "pointing");
    assert.equal(await session.caption(), "Click Export.");
    // Something is typed: Send is back beside Stop.
    const typing = await panel(session);
    assert.deepEqual([typing.send, typing.stop], [true, true]);

    await session.page.keyboard.press("Control+A");
    await session.page.keyboard.type("where are my invoices", { delay: 5 });
    await session.page.keyboard.press("Enter");
    const second = await session.untilAsked(2);
    assert.equal(second.goal, "where are my invoices");
    assert.notEqual(second.guide, first.guide);
    // The guide before ended as it does for Stop: nothing is left pointing, and it is reported as stopped, once.
    await session.until(() => sent.some((report) => report.guide === first.guide), "the first guide's ending to be reported");
    await session.untilState("finished");
    assert.equal(await session.pointed(), null);
    assert.deepEqual(await page(session), { heard: [], where: "Orders" });
    await session.page.waitForTimeout(300);
    assert.deepEqual(sent.filter((report) => report.guide === first.guide), [{ guide: first.guide, outcome: "stopped", site: "site_widget_test" }]);
    // Once the guide is over the ask box asks its first question again.
    assert.equal((await panel(session)).placeholder, "What do you want to do");
  } finally {
    await session.close();
  }
});

test("asking something else at a guide's last pointer reports the guide exactly as Stop does there", async () => {
  const endings: unknown[] = [];
  for (const how of ["ask", "stop"] as const) {
    const session = await start(SHORTCUTS, (request, index) => (index === 0 ? point(request, "Export", "Click Export to download them.", "done") : words("Done.")));
    const sent = reports(session);
    try {
      await session.ask("how do I export my orders");
      await session.untilState("pointing");
      const first = session.requests[0]!;
      if (how === "stop") await session.page.locator("haptic-root .ask .stop").click();
      else {
        await session.page.locator("haptic-root .ask textarea").click();
        await session.page.keyboard.type("where are my invoices", { delay: 5 });
        await session.page.keyboard.press("Enter");
      }
      await session.until(() => sent.some((report) => report.guide === first.guide && report.outcome), "the ending to be reported");
      endings.push(sent.find((report) => report.guide === first.guide && report.outcome)?.outcome);
    } finally {
      await session.close();
    }
  }
  assert.deepEqual(endings, ["shown", "shown"]);
});

test("a long question is read whole while it is typed: the ask box grows to three lines, and Enter still sends it on one", async () => {
  const session = await start(SHORTCUTS, () => words("Done."));
  const box = () =>
    session.page.evaluate(() => {
      const root = document.querySelector("haptic-root")!.shadowRoot!;
      const field = root.querySelector(".ask textarea") as HTMLTextAreaElement;
      const rect = field.getBoundingClientRect();
      const panel = root.querySelector(".panel")!.getBoundingClientRect();
      return { height: Math.round(rect.height), hidden: field.scrollHeight - field.clientHeight, lineHeight: parseFloat(getComputedStyle(field).lineHeight), panelTop: panel.top, value: field.value };
    });
  const question = "Issue Malika Cummerata a virtual card called Ads with a $500 monthly limit.";
  try {
    await session.page.locator("haptic-root .launcher").click();
    const empty = await box();
    assert.equal(empty.height, 40);
    await session.page.keyboard.type("Lock my card", { delay: 2 });
    assert.equal((await box()).height, 40, "a short question made the box taller");
    await session.page.keyboard.press("Control+A");
    await session.page.keyboard.type(question, { delay: 2 });
    const typed = await box();
    // Every line of it is on show: two or three lines, and nothing scrolled out of the box. One line is 40 px, as the
    // box was when it was a single line, and each line more adds its height.
    const lines = (height: number, lineHeight: number) => Math.round((height - 40) / lineHeight) + 1;
    assert.ok(lines(typed.height, typed.lineHeight) >= 2 && lines(typed.height, typed.lineHeight) <= 3, `the box is ${typed.height} px tall`);
    assert.ok(typed.hidden <= 1, `${typed.hidden} px of the question are out of sight`);
    assert.ok(typed.panelTop >= 0);
    // A question longer than three lines scrolls inside the box, which grows no further.
    await session.page.keyboard.type(` ${question} ${question}`, { delay: 1 });
    const long = await box();
    assert.equal(lines(long.height, long.lineHeight), 3, `the box grew to ${long.height} px`);
    assert.ok(long.hidden > 0);
    await session.page.keyboard.press("Control+A");
    await session.page.keyboard.type(question, { delay: 1 });
    await session.page.keyboard.press("Enter");
    const asked = await session.untilAsked(1);
    assert.equal(asked.goal, question);
    await session.untilState("finished");
    // Back to one line for the next question.
    await session.until(async () => (await box()).value === "", "the ask box to empty");
    assert.equal((await box()).height, 40);
  } finally {
    await session.close();
  }
});
