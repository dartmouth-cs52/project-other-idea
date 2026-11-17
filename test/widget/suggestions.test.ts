import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { PublicSiteConfig, TurnReply } from "../../src/shared/types.ts";
import { ACTING_ON, closeBrowser, idOf, point, start, words, type Asked, type Session } from "./harness.ts";

after(closeBrowser);

// Suggested questions: up to three questions the company chose, as pills
// above the open ask box. A press asks one exactly as if it had been typed
// and sent, or, for one marked as Haptic's to do, presses Do it where acting
// is on, first-use line and all. They go as soon as the visitor types, while
// a guide runs and when the panel closes, and a short window shows fewer.

const SUGGESTED: NonNullable<PublicSiteConfig["suggestions"]> = [
  { text: "Lock my Team offsite card" },
  { text: "Who approves meals over $150?" },
  { text: "Issue Malika a $500 virtual card", act: true },
];
const TEXTS = SUGGESTED.map((one) => one.text);

const CARDS = `<h1>Cards</h1><p>Every card your team holds.</p>
  <button id="lock" type="button" style="margin-top:40px">Lock card</button>
  <form id="card"><label>Card name <input id="name" name="name"></label><button id="issue" type="submit">Issue card</button></form>
  <script>document.getElementById('card').addEventListener('submit', (event) => event.preventDefault());</script>`;

type Box = { left: number; top: number; right: number; bottom: number };

/** The pills on show, top to bottom, with their boxes, and the panel's box. A pill in a closed panel is not on show. */
const drawn = (session: Session) =>
  session.page.evaluate(() => {
    const root = document.querySelector("haptic-root")!.shadowRoot!;
    // Measured where they come to rest, not part way through coming in.
    for (const animation of root.querySelector(".suggest")?.getAnimations() ?? []) animation.finish();
    const pills = Array.from(root.querySelectorAll<HTMLElement>(".suggest .pill")).filter((pill) => pill.getClientRects().length > 0);
    const panel = root.querySelector(".panel")!.getBoundingClientRect();
    return {
      texts: pills.map((pill) => pill.textContent ?? ""),
      boxes: pills.map((pill) => {
        const rect = pill.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } as Box;
      }),
      panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom } as Box,
    };
  });
const texts = async (session: Session) => (await drawn(session)).texts;

const root = (session: Session) => session.page.locator("haptic-root");
const field = (session: Session) => root(session).locator('[aria-label="Ask a question"]');
const pill = (session: Session, text: string) => root(session).locator(".suggest .pill", { hasText: text });
const openPanel = async (session: Session) => {
  if (!(await root(session).locator(".panel").isVisible())) await root(session).locator(".launcher").click();
};
/** What the keyboard is on inside the widget: a pill's words, "field" for the ask box, the class of another button, or "". */
const focused = (session: Session) =>
  session.page.evaluate(() => {
    const active = document.querySelector("haptic-root")!.shadowRoot!.activeElement as HTMLElement | null;
    if (!active) return "";
    if (active.classList.contains("pill")) return active.textContent ?? "";
    if (active.matches("input, textarea")) return "field";
    return active.className;
  });

test("the pills show over an open, empty ask box, in the company's order, lined up above the panel", async () => {
  const session = await start(CARDS, () => words("Cards are under Cards."), "/", { suggestions: SUGGESTED });
  try {
    assert.deepEqual(await texts(session), [], "pills show before the ask box is opened");
    await root(session).locator(".launcher").click();
    const { texts: shown, boxes, panel } = await drawn(session);
    assert.deepEqual(shown, TEXTS);
    for (const [index, box] of (boxes as Box[]).entries()) {
      assert.ok(Math.abs(box.right - panel.right) <= 1, `pill ${index} ends at ${box.right}, the panel at ${panel.right}`);
      assert.ok(box.bottom < panel.top, `pill ${index} is not above the panel`);
      assert.ok(box.bottom - box.top < 44, `pill ${index} is ${box.bottom - box.top} px tall, more than one line`);
      if (index > 0) assert.ok(box.top >= boxes[index - 1]!.bottom + 6, `pill ${index} is not under the one before it`);
    }
    assert.ok(panel.top - boxes.at(-1)!.bottom >= 10 && panel.top - boxes.at(-1)!.bottom <= 16, "the pills are not just above the panel");
    // The keyboard is in the ask box, as the panel always opens.
    assert.equal(await focused(session), "field");
  } finally {
    await session.close();
  }
});

test("they go as soon as the visitor types, while a guide runs and when the panel closes, and come back when it opens again empty", async () => {
  const session = await start(CARDS, (request, index) => (index === 0 ? point(request, "Lock card", "Click Lock card.") : words("Locked.")), "/", { suggestions: SUGGESTED });
  try {
    await root(session).locator(".launcher").click();
    assert.deepEqual(await texts(session), TEXTS);
    await field(session).pressSequentially("lo");
    assert.deepEqual(await texts(session), [], "the pills stay while the visitor types");
    await field(session).fill("");
    assert.deepEqual(await texts(session), TEXTS, "the pills don't come back once the box is empty again");
    await field(session).press("Escape");
    assert.equal(await root(session).locator(".panel").isVisible(), false);
    assert.deepEqual(await texts(session), []);
    await root(session).locator(".launcher").click();
    assert.deepEqual(await texts(session), TEXTS, "the pills don't come back when the panel opens again");

    // A guide: none while it runs, even with the panel opened on it.
    await field(session).fill("how do I lock a card");
    await field(session).press("Enter");
    await session.untilState("pointing");
    assert.deepEqual(await texts(session), []);
    await openPanel(session);
    assert.deepEqual(await texts(session), [], "the pills show while a guide runs");
    await session.page.locator("#lock").click();
    await session.untilState("finished");
    // The guide's last sentence is up beside the panel, which asks whether it helped: Haptic is still talking.
    assert.equal(await session.caption(), "Locked.");
    assert.equal(await root(session).locator(".panel").isVisible(), true);
    assert.deepEqual(await texts(session), [], "the pills show beside the guide's last sentence");
    await root(session).locator(".caption .close").click();
    assert.deepEqual(await texts(session), TEXTS, "the pills don't come back once the guide is put away");
  } finally {
    await session.close();
  }
});

test("a press on the page puts them away, with the panel left open, until the visitor is back in the ask box", async () => {
  const session = await start(CARDS, () => words("Cards are under Cards."), "/", { suggestions: SUGGESTED });
  try {
    await root(session).locator(".launcher").click();
    assert.deepEqual(await texts(session), TEXTS);
    await session.page.locator("h1").click();
    assert.equal(await root(session).locator(".panel").isVisible(), true);
    assert.deepEqual(await texts(session), [], "the pills stay after a press on the page");
    await field(session).click();
    assert.deepEqual(await texts(session), TEXTS, "the pills don't come back with the keyboard in the ask box");
  } finally {
    await session.close();
  }
});

test("only the pills take a press: the page under the space between and beside them still gets it", async () => {
  const session = await start(CARDS, () => words("Cards are under Cards."), "/", { suggestions: SUGGESTED });
  try {
    await root(session).locator(".launcher").click();
    const { boxes } = await drawn(session);
    const [first, second] = boxes as [Box, Box];
    const at = (x: number, y: number) => session.page.evaluate(([x, y]: number[]) => document.elementFromPoint(x!, y!)?.tagName.toLowerCase() ?? "", [x, y]);
    assert.equal(await at((first.left + first.right) / 2, (first.top + first.bottom) / 2), "haptic-root", "a pill does not take a press");
    assert.notEqual(await at((first.left + first.right) / 2, (first.bottom + second.top) / 2), "haptic-root", "the gap between two pills takes a press");
    const narrowest = boxes.reduce((least: Box, box: Box) => (box.left > least.left ? box : least));
    const widest = boxes.reduce((most: Box, box: Box) => (box.left < most.left ? box : most));
    assert.notEqual(await at((widest.left + narrowest.left) / 2, (narrowest.top + narrowest.bottom) / 2), "haptic-root", "the space beside a short pill takes a press");
  } finally {
    await session.close();
  }
});

test("a pill asks exactly its question, as if it had been typed and sent", async () => {
  const typed = await start(CARDS, () => words("Meals over $150 need a manager."), "/", { suggestions: SUGGESTED });
  const pressed = await start(CARDS, () => words("Meals over $150 need a manager."), "/", { suggestions: SUGGESTED });
  try {
    await root(typed).locator(".launcher").click();
    await field(typed).fill("Who approves meals over $150?");
    await field(typed).press("Enter");
    const byHand = await typed.untilAsked(1);

    await root(pressed).locator(".launcher").click();
    await pill(pressed, "Who approves meals over $150?").click();
    const byPill = await pressed.untilAsked(1);
    const same = ({ goal, step, mode, history, guide }: Asked) => ({ goal, step, mode, history, guided: typeof guide });
    assert.deepEqual(same(byPill), same(byHand));
    assert.equal(byPill.goal, "Who approves meals over $150?");
    assert.equal(byPill.mode, undefined, "an ordinary pill asked for Do it");
    await pressed.page.waitForTimeout(400);
    assert.equal(pressed.requests.length, 1, "the question was asked more than once");
    assert.deepEqual(await texts(pressed), []);
  } finally {
    await typed.close();
    await pressed.close();
  }
});

/** The hand-over at the end of acting: the visitor makes the click that commits. */
const handOver = (request: Asked): TurnReply => ({ target: idOf(request, "Issue card"), do: null, commits: true, status: "done", say: "Ready. Click Issue card.", mode: "act" });
const doIt = (request: Asked) => (request.mode === "act" ? handOver(request) : words("Cards are issued from the card form."));

test("a Do it pill presses Do it where acting is on: the same first-use line and Go, and nothing is asked before Go", async () => {
  const session = await start(CARDS, doIt, "/", { acting: ACTING_ON, suggestions: SUGGESTED });
  try {
    await root(session).locator(".launcher").click();
    await pill(session, "Issue Malika a $500 virtual card").click();
    const first = root(session).locator(".panel .first");
    assert.equal(await first.isVisible(), true, "the first-use line is not shown");
    assert.match((await first.textContent()) ?? "", /stop before anything is saved/);
    assert.equal(await field(session).inputValue(), "Issue Malika a $500 virtual card", "the question is not in the ask box beside Go");
    assert.deepEqual(await texts(session), [], "the pills stay over the first-use line");
    await session.page.waitForTimeout(600);
    assert.equal(session.requests.length, 0, "a question went before Go");
    await root(session).locator(".panel .first .go").click();
    await session.untilState("pointing");
    assert.equal(session.requests[0]!.mode, "act");
    assert.equal(session.requests[0]!.goal, "Issue Malika a $500 virtual card");

    // Once the line has been seen on the site, the pill goes straight to work, as Do it does. An ordinary pill never acts.
    await root(session).locator(".caption .close").click();
    await session.untilState("finished");
    await openPanel(session);
    await pill(session, "Issue Malika a $500 virtual card").click();
    await session.untilAsked(2);
    assert.equal(session.requests[1]!.mode, "act");
    assert.equal(await first.isVisible(), false);
    await root(session).locator(".caption .close").click();
    await session.untilState("finished");
    await openPanel(session);
    await pill(session, "Lock my Team offsite card").click();
    await session.untilAsked(3);
    assert.equal(session.requests[2]!.mode, undefined, "an ordinary pill pressed Do it");
  } finally {
    await session.close();
  }
});

test("a Do it pill is an ordinary question where acting is off: on a site without it, on a page that turns it off, on a path it leaves out", async () => {
  const off = `${CARDS}<script>
    new MutationObserver(() => document.querySelector('script[data-site]')?.setAttribute('data-acting', 'off')).observe(document.documentElement, { childList: true, subtree: true });
  </script>`;
  const cases: [string, string, PublicSiteConfig["acting"]][] = [
    ["a site without acting", CARDS, undefined],
    ["a page with data-acting=off", off, ACTING_ON],
    ["a path the site leaves out", CARDS, { ...ACTING_ON, paths: ["/cards"] }],
  ];
  for (const [what, pages, acting] of cases) {
    const session = await start(pages, doIt, "/", { suggestions: SUGGESTED, ...(acting ? { acting } : {}) });
    try {
      await root(session).locator(".launcher").click();
      await pill(session, "Issue Malika a $500 virtual card").click();
      const asked = await session.untilAsked(1);
      assert.equal(asked.goal, "Issue Malika a $500 virtual card", what);
      assert.equal(asked.mode, undefined, `act mode was asked for on ${what}`);
      assert.equal(await root(session).locator(".panel .first").isVisible(), false, `the first-use line showed on ${what}`);
    } finally {
      await session.close();
    }
  }
});

test("from the keyboard: the pills come before the ask box, show where the keyboard is, and Enter asks; Escape closes the panel", async () => {
  const session = await start(CARDS, doIt, "/", { acting: ACTING_ON, suggestions: SUGGESTED, appearance: { launcher: "#17633A" } });
  try {
    await root(session).locator(".launcher").click();
    const group = root(session).getByRole("group", { name: "Suggested questions" });
    assert.deepEqual(await group.getByRole("button").allTextContents(), TEXTS);

    await session.page.keyboard.press("Shift+Tab");
    assert.equal(await focused(session), "Issue Malika a $500 virtual card");
    await session.page.keyboard.press("Shift+Tab");
    assert.equal(await focused(session), "Who approves meals over $150?");
    // Turned dark in the site's launcher colour, with Paper words, and the focus ring outside it.
    await session.page.waitForTimeout(250);
    const look = await pill(session, "Who approves meals over $150?").evaluate((el: Element) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, color: style.color, outline: style.outlineStyle };
    });
    assert.deepEqual(look, { background: "rgb(23, 99, 58)", color: "rgb(250, 250, 249)", outline: "solid" });
    await session.page.keyboard.press("Tab");
    await session.page.keyboard.press("Tab");
    assert.equal(await focused(session), "field", "the ask box does not come after the pills");

    await session.page.keyboard.press("Shift+Tab");
    await session.page.keyboard.press("Escape");
    assert.equal(await root(session).locator(".panel").isVisible(), false, "Escape on a pill does not close the panel");

    await root(session).locator(".launcher").click();
    // A click within half a second of a press on one of Haptic's buttons is taken for that press's own click (keepPressesOurs).
    await session.page.waitForTimeout(600);
    await session.page.keyboard.press("Shift+Tab");
    await session.page.keyboard.press("Shift+Tab");
    await session.page.keyboard.press("Enter");
    const asked = await session.untilAsked(1);
    assert.equal(asked.goal, "Who approves meals over $150?");

    // A Do it pill from the keyboard leaves the keyboard on Do it, beside the first-use line, as pressing Do it does.
    await session.untilState("finished");
    await root(session).locator(".caption .close").click();
    await openPanel(session);
    await session.page.waitForTimeout(600);
    await pill(session, "Issue Malika a $500 virtual card").focus();
    await session.page.keyboard.press("Enter");
    assert.equal(await root(session).locator(".panel .first").isVisible(), true);
    assert.equal(await focused(session), "doit");
    assert.equal(session.requests.length, 1, "a question went before Go");
  } finally {
    await session.close();
  }
});

test("under the mouse a pill turns Ink with Paper words, where the site chose no colour", async () => {
  const session = await start(CARDS, () => words("Done."), "/", { suggestions: SUGGESTED });
  try {
    await root(session).locator(".launcher").click();
    const target = pill(session, "Lock my Team offsite card");
    const colours = () => target.evaluate((el: Element) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
    assert.deepEqual(await colours(), ["rgb(255, 255, 255)", "rgb(28, 25, 23)"]);
    await target.hover();
    await session.page.waitForTimeout(250);
    assert.deepEqual(await colours(), ["rgb(28, 25, 23)", "rgb(250, 250, 249)"]);
  } finally {
    await session.close();
  }
});

test("a short window shows fewer, the first ones listed, and none where there is no room, never reaching the top of the window", async () => {
  const session = await start(CARDS, () => words("Done."), "/", { suggestions: SUGGESTED });
  try {
    await root(session).locator(".launcher").click();
    const tall = await drawn(session);
    assert.deepEqual(tall.texts, TEXTS);
    // The panel keeps to the foot of the window, so its top is this far above the foot at any height.
    const fromFoot = 800 - tall.panel.top;
    const pillAndGap = tall.boxes[1]!.top - tall.boxes[0]!.top;
    const pillHeight = tall.boxes[0]!.bottom - tall.boxes[0]!.top;
    // The room above the panel is its top, less the space under the pills and the margin kept at the top of the window.
    for (const [room, count] of [[pillAndGap + pillHeight + 10, 2], [pillHeight + 10, 1], [pillHeight - 10, 0]] as const) {
      await session.page.setViewportSize({ width: 1366, height: Math.round(room + 25 + fromFoot) });
      await session.until(async () => (await texts(session)).length === count, () => `${count} pills to show with ${room} px of room`);
      const now = await drawn(session);
      assert.deepEqual(now.texts, TEXTS.slice(0, count));
      for (const box of now.boxes) assert.ok(box.top >= 12, `a pill reaches ${box.top} px from the top of the window`);
      if (count) assert.ok(now.panel.top - now.boxes.at(-1)!.bottom <= 16, "the pills left are not just above the panel");
    }
    await session.page.setViewportSize({ width: 1366, height: 800 });
    await session.until(async () => (await texts(session)).length === 3, "the pills to come back in a tall window");
  } finally {
    await session.close();
  }
});

test("they never lie over a control the page keeps in place, like a top bar's, and may lie over one that scrolls away", async () => {
  // A bar fixed to the top of the window, with a button at its right end, over the cards.
  const BAR = `<header style="position:fixed;top:0;left:0;right:0;height:60px;background:#f5f5f4;z-index:10">
      <button id="profile" type="button" style="position:absolute;right:28px;top:14px;width:240px;height:32px">Profile</button></header>
    <div style="height:60px"></div>${CARDS}`;
  const session = await start(BAR, () => words("Done."), "/", { suggestions: SUGGESTED });
  try {
    await root(session).locator(".launcher").click();
    const tall = await drawn(session);
    assert.deepEqual(tall.texts, TEXTS);
    // A button of the page's own, which scrolls with it, under the middle pill: the pills stay.
    const middle = tall.boxes[1]!;
    await session.page.evaluate(
      ([left, top]: number[]) => {
        const row = document.createElement("button");
        row.id = "approve";
        row.textContent = "Approve";
        row.style.cssText = `position:absolute;left:${left}px;top:${top! + window.scrollY}px;width:120px;height:28px`;
        document.body.append(row);
      },
      [middle.left + 20, middle.top + 5] as number[],
    );
    await field(session).press("Escape");
    await root(session).locator(".launcher").click();
    assert.deepEqual(await texts(session), TEXTS, "a control that scrolls away took a pill away");

    // A window just short enough that the first pill would lie over the bar's button: it is left out, and the rest move down.
    const fromFoot = 800 - tall.panel.top;
    await session.page.setViewportSize({ width: 1366, height: Math.round(tall.panel.top - tall.boxes[0]!.top + 20 + fromFoot) });
    await session.until(async () => (await texts(session)).length === 2, () => "two pills to show under the bar");
    const short = await drawn(session);
    assert.deepEqual(short.texts, TEXTS.slice(0, 2));
    const profile = (await session.page.locator("#profile").boundingBox())!;
    for (const box of short.boxes) assert.ok(box.top >= profile.y + profile.height, `a pill at ${box.top} lies over the bar's button`);
  } finally {
    await session.close();
  }
});

test("in presentation mode the pills are drawn larger, and still fit above the panel", async () => {
  const session = await start(CARDS, () => words("Done."), "/", { suggestions: SUGGESTED, present: true });
  try {
    await root(session).locator(".launcher").click();
    const { texts: shown, boxes, panel } = await drawn(session);
    assert.deepEqual(shown, TEXTS);
    assert.equal(await pill(session, "Lock my Team offsite card").evaluate((el: Element) => getComputedStyle(el).fontSize), "20px");
    assert.ok(boxes.every((box: Box) => box.bottom < panel.top && box.top >= 12));
    assert.ok(Math.abs(boxes[0]!.right - panel.right) <= 1);
  } finally {
    await session.close();
  }
});

test("a site with no suggestions draws nothing more, and its ask box works as before", async () => {
  for (const suggestions of [undefined, [], [{ text: "   " }]] as PublicSiteConfig["suggestions"][]) {
    const session = await start(CARDS, () => words("Cards are under Cards."), "/", suggestions ? { suggestions } : {});
    try {
      await root(session).locator(".launcher").click();
      const inside = await session.page.evaluate(() => {
        const shadow = document.querySelector("haptic-root")!.shadowRoot!;
        return { group: shadow.querySelector(".suggest") !== null, sheets: shadow.adoptedStyleSheets.length, first: shadow.querySelector(".panel")!.firstElementChild!.className };
      });
      assert.deepEqual(inside, { group: false, sheets: 1, first: "thread" }, JSON.stringify(suggestions));
      await field(session).fill("where are cards");
      await field(session).press("Enter");
      assert.equal((await session.untilAsked(1)).goal, "where are cards");
    } finally {
      await session.close();
    }
  }
});
