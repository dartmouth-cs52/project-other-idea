import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { TurnReply } from "../../src/shared/types.ts";
import { ACTING_ON, closeBrowser, idOf, point, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// Asking something else while a guide is up, and typing a long question.
//
// With a pointer on show the launcher opened a panel that held only "Your
// turn" and Stop. A visitor who had not met the widget before had no way to
// ask anything from there, and what they typed went to the page: on
// Northpine, whose own keyboard shortcuts heard the letters and took them to
// another page. The panel now offers "Ask something else", which ends the
// guide as Stop does and opens the ask box, and the keyboard is in the panel
// from the moment it opens.

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

/** What the launcher's panel shows: its status line, whether the ask box and "Ask something else" are on show, and what of ours holds the keyboard. */
const panel = (session: Session) =>
  session.page.evaluate(() => {
    const root = document.querySelector("haptic-root")!.shadowRoot!;
    // Written without a named function inside, which the test runner's build would wrap in a helper the page does not have.
    const [open, status, askBox, another, stop] = [".panel", ".status", ".ask textarea", ".another", ".stop"].map((selector) => {
      const el = root.querySelector(selector) as HTMLElement | null;
      return !!el && el.getClientRects().length > 0;
    });
    const holds = root.activeElement;
    return {
      open,
      status: status ? (root.querySelector(".status span")?.textContent ?? "") : "",
      askBox,
      another: another ? (root.querySelector(".another")?.textContent ?? "") : "",
      stop,
      keyboard: holds ? (holds.className || holds.tagName.toLowerCase()) : "",
    };
  });

/** Every report the widget has sent, in order. */
function reports(session: Session): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  session.page.on("request", (request: { url(): string; postData(): string | null }) => {
    const found = /\/v1\/guides\/([^/]+)\/report$/.exec(request.url());
    if (found) sent.push({ guide: found[1], ...JSON.parse(request.postData() ?? "{}") });
  });
  return sent;
}

test("with a pointer up, the panel offers a way to ask something else, and what is typed there never reaches the page", async () => {
  const session = await start(SHORTCUTS, (request, index) => (index === 0 ? point(request, "Export", "Click Export.") : words("Invoices are under Billing.")));
  const sent = reports(session);
  try {
    await session.ask("how do I export my orders");
    await session.untilState("pointing");
    const first = session.requests[0]!;
    // A visitor who wants something else presses the launcher, as they did to ask the first time.
    await session.page.locator("haptic-root .launcher").click();
    assert.deepEqual(await panel(session), { open: true, status: "Your turn", askBox: false, another: "Ask something else", stop: true, keyboard: "another" });
    // They type before reading. The keys are Haptic's, and the page's shortcuts hear none of them.
    await session.page.keyboard.type("new", { delay: 20 });
    assert.deepEqual(await page(session), { heard: [], where: "Orders" });
    assert.equal(await session.state(), "pointing");
    assert.equal(await session.caption(), "Click Export.");

    await session.page.locator("haptic-root .another").click();
    await session.untilState("finished");
    // The guide ended as it does for Stop: nothing is left pointing, and it is reported as stopped, once.
    assert.equal(await session.pointed(), null);
    assert.equal(await session.caption(), "");
    await session.until(() => sent.length === 1, "the ending to be reported");
    assert.deepEqual(sent, [{ guide: first.guide, outcome: "stopped", site: "site_widget_test" }]);
    // The ask box is open and has the keyboard.
    const asking = await panel(session);
    assert.deepEqual([asking.open, asking.status, asking.askBox, asking.another], [true, "", true, ""]);
    assert.equal(await session.page.evaluate(() => document.querySelector("haptic-root")!.shadowRoot!.activeElement?.matches(".ask textarea")), true);
    await session.page.keyboard.type("where are my invoices", { delay: 5 });
    await session.page.keyboard.press("Enter");
    const second = await session.untilAsked(2);
    assert.equal(second.goal, "where are my invoices");
    assert.notEqual(second.guide, first.guide);
    assert.deepEqual(await page(session), { heard: [], where: "Orders" });
    await session.page.waitForTimeout(300);
    assert.equal(sent.filter((report) => report.guide === first.guide).length, 1, "the first guide's ending was reported twice");
  } finally {
    await session.close();
  }
});

test("asking something else at a guide's last pointer reports the guide exactly as Stop does there", async () => {
  const endings: unknown[] = [];
  for (const button of [".another", ".stop"]) {
    const session = await start(SHORTCUTS, (request, index) => (index === 0 ? point(request, "Export", "Click Export to download them.", "done") : words("Done.")));
    const sent = reports(session);
    try {
      await session.ask("how do I export my orders");
      await session.untilState("pointing");
      await session.page.locator("haptic-root .launcher").click();
      await session.page.locator(`haptic-root ${button}`).click();
      await session.untilState("finished");
      await session.until(() => sent.length >= 1, "the ending to be reported");
      endings.push(sent[0]?.outcome);
      assert.equal((await panel(session)).askBox, true);
    } finally {
      await session.close();
    }
  }
  assert.deepEqual(endings, ["shown", "shown"]);
});

test("it is not offered while Haptic is finding the step, and with only a sentence up the ask box is there, with the keyboard", async () => {
  let release: (() => void) | undefined;
  const session = await start(SHORTCUTS, async (_request, index) => {
    if (index === 0) await new Promise<void>((resolve) => (release = resolve));
    return index === 0 ? words("Press Enter to search.", "continue") : words("Invoices are under Billing.");
  });
  try {
    await session.ask("search my orders");
    await session.untilState("asking");
    await session.until(async () => (await panel(session)).status === "Finding it…", "the panel to say it is finding the step");
    // Working on it: Stop is the way out, as before.
    assert.deepEqual([(await panel(session)).another, (await panel(session)).stop], ["", true]);
    // The keyboard stays in the panel when the ask box goes, and a key there presses nothing: not the page's
    // shortcuts, and not Stop, which a space would press if it had the keyboard.
    assert.equal((await panel(session)).keyboard, "panel");
    await session.page.keyboard.type("c n", { delay: 20 });
    assert.deepEqual(await page(session), { heard: [], where: "Orders" });
    assert.equal(await session.state(), "asking");
    // The step is held until it has been asked for, so the panel above was read while Haptic was finding it.
    await session.until(() => release, "the step to be asked for");
    release!();
    await session.untilState("watching");
    // A guide that only says something leaves the ask box as it was: the launcher opens it, and the keys are Haptic's.
    await session.page.locator("haptic-root .launcher").click();
    const waiting = await panel(session);
    assert.deepEqual([waiting.askBox, waiting.another, waiting.keyboard], [true, "", "textarea"]);
    await session.page.keyboard.type("new", { delay: 20 });
    assert.deepEqual(await page(session), { heard: [], where: "Orders" });
  } finally {
    await session.close();
  }
});

test("while Haptic is paused for the visitor's own hand, it is offered beside Carry on and Stop, and all of them fit in the panel", async () => {
  const FORM = `<h1 id="title">New card</h1><form><label>Card name <input id="name"></label></form>`;
  const LONG = "Marketing and events for the whole of the coming year";
  const session = await start(
    FORM,
    (request, index): TurnReply =>
      index === 0 ? { target: idOf(request, "Card name"), do: "type", enter: LONG, commits: false, status: "continue", say: "Typing the card's name.", mode: "act" } : words("Done."),
    "/",
    { acting: ACTING_ON },
  );
  try {
    await session.ask(`can you make a card called ${LONG}`, { act: true });
    await session.untilState("acting");
    await session.until(async () => (await session.page.inputValue("#name")).length >= 4, "some of the name to be typed");
    await session.page.locator("#title").click();
    await session.untilState("paused");
    const paused: { text: string | null; inside: boolean; wide: number }[] = await session.page.evaluate(() => {
      const root = document.querySelector("haptic-root")!.shadowRoot!;
      const box = root.querySelector(".panel")!.getBoundingClientRect();
      return Array.from(root.querySelectorAll(".status span, .status button"))
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return { text: el.textContent, inside: rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom, wide: rect.width };
        });
    });
    assert.deepEqual(
      paused.map((part) => part.text),
      ["You took over, so I've paused.", "Carry on", "Ask something else", "Stop"],
    );
    for (const part of paused) assert.ok(part.inside, `"${part.text}" is not inside the panel: ${JSON.stringify(paused)}`);
    // The sentence is read on lines of its own width, not squeezed to a word a line.
    assert.ok(paused[0]!.wide > 150, `the sentence is ${paused[0]!.wide} px wide`);
    await session.page.locator("haptic-root .another").click();
    await session.untilState("finished");
    assert.equal((await panel(session)).askBox, true);
    assert.equal(await session.page.evaluate(() => document.querySelector("haptic-root")!.shadowRoot!.activeElement?.matches(".ask textarea")), true);
  } finally {
    await session.close();
  }
});

test("when Haptic gives the visitor a step of its own, the panel offers it beside Stop, and not while Haptic is doing a step", async () => {
  const FORM = `<h1>New card</h1><form id="card"><label>Card name <input id="name" name="name"></label><label>Spending limit <input id="limit" name="limit"></label>
    <button id="issue" type="submit">Issue card</button></form><script>document.getElementById('card').addEventListener('submit', (event) => event.preventDefault());</script>`;
  const seen: Awaited<ReturnType<typeof panel>>[] = [];
  const session: Session = await start(
    FORM,
    async (request, index): Promise<TurnReply> => {
      // The second question is asked while Haptic is at work between two steps.
      if (index === 1) seen.push(await panel(session));
      if (index === 0) return { target: idOf(request, "Card name"), do: "type", enter: "Ads", commits: false, status: "continue", say: "Typing the card's name.", mode: "act" };
      return { target: idOf(request, "Spending limit"), do: null, enter: null, commits: false, status: "continue", say: "Type the limit you want in Spending limit.", mode: "act" };
    },
    "/",
    { acting: ACTING_ON },
  );
  try {
    await session.ask("Can you issue a card called Ads?", { act: true });
    await session.untilState("pointing", 20_000);
    assert.deepEqual([seen[0]?.status, seen[0]?.another, seen[0]?.stop], ["Doing it", "", true]);
    const theirs = await panel(session);
    assert.deepEqual([theirs.status, theirs.another, theirs.stop], ["Your turn", "Ask something else", true]);
  } finally {
    await session.close();
  }
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
