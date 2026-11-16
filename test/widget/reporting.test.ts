import assert from "node:assert/strict";
import { after, test } from "node:test";
import { GUIDE_ID, type TurnReply } from "../../src/shared/types.ts";
import { ACTING_ON, closeBrowser, idOf, point, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// What the widget tells the server about a guide besides its questions: one id
// for all its steps, how it ended, and whether the visitor said it helped. The
// question leaves the browser masked, while the page is read with it as it was
// typed. Reports go to the harness's own stand-in for the server.

const ORDERS = `<h1>Orders</h1>
  <p>Order 88123 for sam@example.com</p><p>Order 99876 for kim@example.com</p>
  <button id="export" type="button">Export</button>
  <p id="done" hidden>Exported.</p>
  <script>document.getElementById('export').addEventListener('click', () => (document.getElementById('done').hidden = false));</script>`;

/** Every report the widget has sent, in order. */
function reports(session: Session): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  session.page.on("request", (request: { url(): string; postData(): string | null }) => {
    const found = /\/v1\/guides\/([^/]+)\/report$/.exec(request.url());
    if (found) sent.push({ guide: found[1], ...JSON.parse(request.postData() ?? "{}") });
  });
  return sent;
}

test("a guide's steps carry one id, its question leaves masked, and how it ended is reported once, then whether it helped", async () => {
  const session = await start(ORDERS, (request, index) => (index === 0 ? point(request, "Export", "Click Export.") : words("Your orders are exported.")));
  const sent = reports(session);
  try {
    await session.ask("export order 88123 for sam@example.com");
    await session.untilState("pointing");
    const [first] = session.requests;
    assert.match(first?.guide ?? "", GUIDE_ID);
    assert.equal(first?.goal, "export order [number] for [email]");
    // The visitor named this order and this address, so where exactly they stand on the page they are left readable. The others are masked.
    const text = first?.snapshot.text.join(" ") ?? "";
    assert.match(text, /Order 88123 for sam@example\.com/);
    assert.doesNotMatch(text, /99876|kim@example\.com/);
    await session.page.locator("#export").click();
    await session.untilState("finished");
    assert.equal(session.requests[1]?.guide, first?.guide, "the second step carried another id");
    await session.until(() => sent.length === 1, "the ending to be reported");
    assert.deepEqual(sent, [{ guide: first?.guide, outcome: "finished", site: "site_widget_test" }]);
    // "Did this help?" is in the ask box, and the answer is reported for the same guide.
    await session.page.locator("haptic-root .helped button", { hasText: "Yes" }).click();
    await session.until(() => sent.length === 2, "the answer to be reported");
    assert.deepEqual(sent[1], { guide: first?.guide, helped: true, site: "site_widget_test" });
    await session.page.waitForTimeout(300);
    assert.equal(sent.length, 2, "an ending was reported twice");
  } finally {
    await session.close();
  }
});

test("a reply that is stuck ends the guide on its sentence with nothing pointed at, as nothing to point at", async () => {
  const session = await start(ORDERS, (request) => ({ ...point(request, "Export", "I looked for an archive and found none."), status: "stuck" }));
  const sent = reports(session);
  try {
    await session.ask("archive my orders");
    await session.untilState("finished");
    assert.equal(await session.caption(), "I looked for an archive and found none.");
    assert.equal(await session.pointed(), null);
    await session.until(() => sent.length === 1, "the ending to be reported");
    assert.equal(sent[0]?.outcome, "nothing_to_point_at");
  } finally {
    await session.close();
  }
});

test("a reply the server gave without the model, because the site is off or resting, ends the guide as an error and asks nothing", async () => {
  const session = await start(ORDERS, (): TurnReply => ({ target: null, status: "stuck", say: "The guide is resting for now. Try again in a little while.", paused: true }));
  const sent = reports(session);
  try {
    await session.ask("export my orders");
    await session.untilState("finished");
    assert.equal(await session.caption(), "The guide is resting for now. Try again in a little while.");
    await session.until(() => sent.length === 1, "the ending to be reported");
    assert.equal(sent[0]?.outcome, "error");
    assert.equal(await session.page.locator("haptic-root .helped").isVisible(), false, "Did this help? was asked after a pause");
  } finally {
    await session.close();
  }
});

test("Stop while a step is on show reports the guide as stopped", async () => {
  const session = await start(ORDERS, (request) => point(request, "Export", "Click Export."));
  const sent = reports(session);
  try {
    await session.ask("export my orders");
    await session.untilState("pointing");
    await session.page.locator("haptic-root .caption .close").click();
    await session.untilState("finished");
    await session.until(() => sent.length === 1, "the ending to be reported");
    assert.equal(sent[0]?.outcome, "stopped");
  } finally {
    await session.close();
  }
});

const CARD = `<h1>New card</h1><label>Card name <input id="name"></label><button id="issue" type="button">Issue card</button>`;

test("while Haptic acts, a reply that is stuck does nothing, even with something to do, and acting ends on its sentence", async () => {
  const session = await start(
    CARD,
    (request): TurnReply => ({ target: idOf(request, "Card name"), do: "type", enter: "Ads", commits: false, status: "stuck", say: "I can't find where to set a limit.", mode: "act" }),
    "/",
    { acting: { ...ACTING_ON, confirmFirst: false } },
  );
  const sent = reports(session);
  try {
    await session.ask('issue a card called "Ads"', { act: true });
    await session.untilState("finished");
    assert.equal(await session.page.locator("#name").inputValue(), "", "Haptic typed on a stuck reply");
    assert.equal(await session.caption(), "I can't find where to set a limit.");
    await session.until(() => sent.length === 1, "the ending to be reported");
    assert.equal(sent[0]?.outcome, "nothing_to_point_at");
  } finally {
    await session.close();
  }
});
