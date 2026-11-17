import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// Start over, the turning arrow in the ask box's row. It shows once there is
// anything in the chat, calls off a guide that is running, and leaves the
// chat as it was before the first question: an empty ask box with the
// keyboard, and nothing else.

const ORDERS = `<h1>Orders</h1><button id="export" type="button" style="margin:200px 0 0 300px">Export</button><p id="out"></p>
  <script>document.getElementById('export').addEventListener('click', () => (document.getElementById('out').textContent = 'Exported.'));</script>`;

/** What the chat shows, read from Haptic's own element. */
const chat = (session: Session) =>
  session.page.evaluate(() => {
    const root = document.querySelector("haptic-root")!.shadowRoot!;
    // Written without a named function inside, which the test runner's build would wrap in a helper the page does not have.
    const [restart, question, done, helped, panel] = [".restart", ".thread", ".done", ".helped", ".panel"].map((selector) => {
      const el = root.querySelector(selector) as HTMLElement;
      return !el.closest("[hidden]") && getComputedStyle(el).display !== "none";
    });
    const input = root.querySelector(".ask textarea") as HTMLTextAreaElement;
    return { restart, question, done, helped, panel, typed: input.value, focused: root.activeElement === input, saved: sessionStorage.getItem("haptic.guide") === null ? 0 : 1 };
  });

test("Start over shows only once something is in the chat, and clears a finished guide back to an empty ask box", async () => {
  const session = await start(ORDERS, (request, index) => (index === 0 ? point(request, "Export", "Click Export.") : words("Your orders are exported.")));
  try {
    await session.page.locator("haptic-root .launcher").click();
    assert.equal((await chat(session)).restart, false, "Start over shows with nothing to clear");
    await session.ask("export my orders");
    await session.untilState("pointing");
    assert.equal((await chat(session)).restart, true, "Start over is not there while a guide runs");
    await session.page.locator("#export").click();
    await session.untilState("finished");
    await session.until(async () => (await chat(session)).done, "the guide did not end on Done");
    await session.page.locator("haptic-root .restart").click();
    await session.untilState("idle");
    const after = await chat(session);
    assert.deepEqual(
      { ...after, saved: undefined },
      { restart: false, question: false, done: false, helped: false, panel: true, typed: "", focused: true, saved: undefined },
    );
    assert.equal(await session.caption(), "");
  } finally {
    await session.close();
  }
});

test("Start over in the middle of a guide calls it off: the pointer goes, nothing more is asked, and nothing is kept for the next page", async () => {
  const session = await start(ORDERS, (request) => point(request, "Export", "Click Export."));
  try {
    await session.ask("export my orders");
    await session.untilState("pointing");
    assert.equal(await session.pointed(), "export");
    await session.page.locator("haptic-root .restart").click();
    await session.untilState("idle");
    assert.equal(await session.pointed(), null);
    assert.equal(await session.caption(), "");
    const shown = await chat(session);
    assert.equal(shown.question, false, "the question is still in the chat");
    assert.equal(shown.saved, 0, "the guide is still kept for the next page");
    // The control the guide pointed at is used now as any other: it is no step, and nothing is asked.
    await session.page.locator("#export").click();
    await session.page.waitForTimeout(800);
    assert.equal(session.requests.length, 1);
  } finally {
    await session.close();
  }
});
