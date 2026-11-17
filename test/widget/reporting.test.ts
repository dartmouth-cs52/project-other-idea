import assert from "node:assert/strict";
import { after, test } from "node:test";
import { GUIDE_ID, type TurnReply } from "../../src/shared/types.ts";
import { ACTING_ON, closeBrowser, idOf, point, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// What the widget tells the server about a guide besides its questions: one id
// for all its steps, how it ended, and whether the visitor said it helped. The
// question leaves the browser masked, except for what the visitor named that the
// page also shows, and the page is read with it as it was typed. Reports go to
// the harness's own stand-in for the server.

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

test("a guide's steps carry one id, its question leaves masked but for what the page also shows, and how it ended is reported once, then whether it helped", async () => {
  const session = await start(ORDERS, (request, index) => (index === 0 ? point(request, "Export", "Click Export.") : words("Your orders are exported.")));
  const sent = reports(session);
  try {
    await session.ask("export order 88123 for sam@example.com, not 55555 or lee@example.com");
    await session.untilState("pointing");
    const [first] = session.requests;
    assert.match(first?.guide ?? "", GUIDE_ID);
    // The order and the address the page shows stay readable in the question, so the model can tell
    // that they are the ones asked about. What the visitor named that the page does not show stays masked.
    assert.equal(first?.goal, "export order 88123 for sam@example.com, not [number] or [email]");
    // The visitor named this order and this address, so where exactly they stand on the page they are left readable. The others are masked.
    const text = first?.snapshot.text.join(" ") ?? "";
    assert.match(text, /Order 88123 for sam@example\.com/);
    assert.doesNotMatch(text, /99876|kim@example\.com/);
    await session.page.locator("#export").click();
    await session.untilState("finished");
    assert.equal(session.requests[1]?.guide, first?.guide, "the second step carried another id");
    await session.until(() => sent.length === 1, "the ending to be reported");
    // It names the step its ending rests on: the second, counting from 0, whose reply ended the guide.
    assert.deepEqual(sent, [{ guide: first?.guide, outcome: "finished", step: 1, site: "site_widget_test" }]);
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

test("a value the visitor named stays readable in the question only where the page shows it standing on its own, not as part of something else", async () => {
  const session = await start(`<h1>Accounts</h1><p>Account 1334455</p><p>Ref 13344-5566</p><button id="move" type="button">Move money</button>`, () => words("Use Move money."));
  try {
    await session.ask("move 13344 to 1334455");
    await session.untilAsked(1);
    // 13344 is inside 1334455 and in a reference with a dash, and the page shows it nowhere on its own: masked.
    assert.equal(session.requests[0]?.goal, "move [number] to 1334455");
  } finally {
    await session.close();
  }
});

// No guide that got there goes unreported. A visitor who has what they asked for on screen often just closes the
// tab, so a guide is reported the moment its ending is known, and a page that goes with its ending still open
// reports it as it goes. These were found in review: on each, nothing at all used to reach the server. The third,
// a tab closed on a first answer, is in test/browser/leaving.test.ts, where the server is a real one: a request a
// closing page sends is not seen by this harness, which answers in the browser.

/** Every report the widget sends from any page of the session, the page being closed included. */
function allReports(session: Session): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  session.page.context().on("request", (request: { url(): string; postData(): string | null }) => {
    const found = /\/v1\/guides\/([^/]+)\/report$/.exec(request.url());
    if (found) sent.push({ guide: found[1], ...JSON.parse(request.postData() ?? "{}") });
  });
  return sent;
}
const outcomes = (sent: Record<string, unknown>[]) => sent.filter((report) => "outcome" in report).map((report) => report.outcome);

test("a guide that got there is reported finished the moment its last pointer shows, its last look keeps its id, and closing the tab sends nothing more", async () => {
  const PAGE = `<h1>Account</h1><button id="settings" type="button">Settings</button>
    <div id="more" hidden><button id="billing" type="button">Billing</button><p id="open" hidden>Billing details</p></div>
    <script>
      document.getElementById('settings').addEventListener('click', () => (document.getElementById('more').hidden = false));
      document.getElementById('billing').addEventListener('click', () => (document.getElementById('open').hidden = false));
    </script>`;
  const session = await start(PAGE, (request, index) =>
    index === 0 ? point(request, "Settings", "Open Settings.") : index === 1 ? point(request, "Billing", "Billing is here.", "done") : words("Your billing details are open."),
  );
  const sent = allReports(session);
  try {
    await session.ask("where is billing");
    await session.untilState("pointing");
    await session.page.locator("#settings").click();
    await session.untilAsked(2);
    await session.until(async () => (await session.pointed()) === "billing", "the last pointer");
    await session.until(() => outcomes(sent).length === 1, "the ending to be reported while the last pointer is on show");
    const guide = session.requests[0]?.guide;
    // It names the step whose reply put the last pointer up, so the server judges that step, not the look that follows.
    assert.deepEqual(sent, [{ guide, outcome: "finished", step: 1, site: "site_widget_test" }]);
    // The visitor uses it, and the look at what came of it is a step of the same guide. Nothing is reported twice.
    await session.page.locator("#billing").click();
    const look = await session.untilAsked(3);
    assert.equal(look.guide, guide, "the last look carried another id, or none");
    assert.equal(look.closing, true);
    assert.equal(look.step, 2, "the look is the step after the one the report named");
    await session.untilState("finished");
    await session.page.waitForTimeout(300);
    assert.deepEqual(outcomes(sent), ["finished"]);
    assert.equal(await session.page.locator("haptic-root .helped").isVisible(), true, "Did this help? was not asked");
    await session.page.close({ runBeforeUnload: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(outcomes(sent), ["finished"]);
  } finally {
    await session.close();
  }
});

test("a first answer that points at a link to another site is reported finished when the visitor clicks it, before the page goes", async () => {
  const session = await start({ "/": "<h1>Home</h1>", "/portal": "<h1>Billing portal</h1><p>Elsewhere.</p>" }, (request) => point(request, "Billing portal", "Open the billing portal.", "done"));
  // A link to the same server under another name, which is another origin: the guide cannot follow it there.
  const other = session.origin.replace("127.0.0.1", "localhost");
  await session.page.evaluate((href: string) => {
    const link = document.createElement("a");
    link.id = "portal";
    link.href = href;
    link.textContent = "Billing portal";
    document.body.prepend(link);
  }, `${other}/portal`);
  const sent = allReports(session);
  try {
    await session.ask("open the billing portal");
    await session.until(async () => (await session.pointed()) === "portal", "the pointer on the link");
    assert.deepEqual(sent, [], "nothing is reported before the visitor uses it");
    await session.page.locator("#portal").click();
    await session.page.waitForURL(/localhost.*\/portal/);
    await session.until(() => outcomes(sent).length > 0, "the ending to be reported");
    assert.deepEqual(sent, [{ guide: session.requests[0]?.guide, outcome: "finished", step: 0, site: "site_widget_test" }]);
    assert.equal(session.requests.length, 1, "nothing was asked from the other site");
  } finally {
    await session.close();
  }
});
