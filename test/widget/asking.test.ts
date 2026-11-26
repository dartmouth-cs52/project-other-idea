import assert from "node:assert/strict";
import { after, test } from "node:test";
import { chromium } from "playwright";
import { page, startHarness } from "../browser/harness.ts";
import { ACTING_ON, closeBrowser, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// The ask box with a question longer than its width. It wraps onto more lines,
// so the whole question can be read as it is typed, and never scrolls
// sideways. It is still one question of one line: Enter sends it, whatever
// lines it wrapped onto, and a line break pasted into it is a space.

const PAGE = `<h1>Cards</h1><button id="issue" type="button">Issue card</button>`;
/** A question a visitor asked that ran off the side of the old one-line box. */
const LONG = "lets add Theo as a card user he will 50 dollars for his trip to japan";

/** How the ask box is drawn: its height, whether it scrolls either way, and what it holds. */
const box = (session: Session) =>
  session.page.evaluate(() => {
    const field = document.querySelector("haptic-root")!.shadowRoot!.querySelector(".ask textarea") as HTMLTextAreaElement;
    const panel = document.querySelector("haptic-root")!.shadowRoot!.querySelector(".panel") as HTMLElement;
    return {
      height: field.getBoundingClientRect().height,
      panelWidth: panel.getBoundingClientRect().width,
      sideways: field.scrollWidth > field.clientWidth || field.scrollLeft > 0,
      upAndDown: field.scrollHeight > field.clientHeight,
      typed: field.value,
    };
  });

test("a question longer than the ask box wraps onto more lines, never sideways, and Enter sends it whole", async () => {
  const session = await start(PAGE, () => words("Card users are added from Team."), "/", { acting: ACTING_ON });
  try {
    await session.page.locator("haptic-root .launcher").click();
    const empty = await box(session);
    assert.equal(empty.height, 40, "an empty ask box is one line");
    await session.page.keyboard.type(LONG);
    const typed = await box(session);
    assert.equal(typed.typed, LONG);
    assert.equal(typed.sideways, false, "the question runs off the side of the ask box");
    assert.equal(typed.upAndDown, false, "part of the question is out of sight above or below");
    assert.ok(typed.height >= 60, `the ask box did not grow to a second line: ${typed.height}px`);
    assert.equal(typed.panelWidth, empty.panelWidth, "the chat got wider");
    await session.page.keyboard.press("Enter");
    const asked = await session.untilAsked(1);
    assert.equal(asked.goal, LONG);
    const sent = await box(session);
    assert.equal(sent.typed, "", "the ask box was not emptied for the next question");
    assert.equal(sent.height, 40, "the emptied ask box did not go back to one line");
  } finally {
    await session.close();
  }
});

test("the ask box grows to six lines, then scrolls up and down, and fits again when the window narrows", async () => {
  const session = await start(PAGE, () => words("Done."));
  try {
    await session.page.locator("haptic-root .launcher").click();
    const field = session.page.locator("haptic-root .ask textarea");
    // Its limit, 300 characters, in words: far more than six lines.
    await field.fill(`${LONG} `.repeat(10).slice(0, 300));
    const full = await box(session);
    assert.equal(full.typed.length, 300);
    assert.equal(full.height, 140, "the ask box is not six lines high at most");
    assert.equal(full.upAndDown, true, "a question past six lines does not scroll");
    assert.equal(full.sideways, false, "the question runs off the side of the ask box");

    await field.fill(LONG);
    const wide = await box(session);
    await session.page.setViewportSize({ width: 240, height: 720 });
    await session.until(async () => (await box(session)).panelWidth < wide.panelWidth, "the chat to narrow with the window");
    await session.until(async () => (await box(session)).height > wide.height, "the ask box to take more lines in a narrow window");
    const narrow = await box(session);
    assert.equal(narrow.sideways, false, "the question runs off the side of the narrow ask box");
    assert.equal(narrow.upAndDown, false, "part of the question is out of sight in the narrow ask box");
  } finally {
    await session.close();
  }
});

test("the ask box is as tall as the lines its words take, never a line more or less, where scroll bars take room", async () => {
  // Scroll bars that take room, as on Windows. Chromium hides them when it runs without a window, so this one is told not
  // to. A box that could show one before its words are more than six lines could keep one where the words just fit, and
  // then wrap them onto a line more, out of sight; one measured with a scroll bar showing would be a line too tall.
  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), ignoreDefaultArgs: ["--hide-scrollbars"] });
  const harness = await startHarness();
  try {
    harness.pages.set("/", page(PAGE));
    const tab = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await tab.goto(`${harness.url}/`);
    await tab.locator("haptic-root .launcher").click();
    const text = "can you add Theo as a card user with a limit of fifty dollars for his trip to Japan next month, and make sure the card works abroad, then send him an invite by email so he can set up his own login and see the card in the app on his phone before he flies out on Friday morning, and after that show me where to see what he spends while he is away";
    const drawn = await tab.evaluate((text: string) => {
      const root = document.querySelector("haptic-root")!.shadowRoot!;
      // On macOS, scroll bars float over the text and take no room even without --hide-scrollbars, so give this one a
      // classic gutter to exercise the Windows layout rule everywhere.
      const barStyle = document.createElement("style");
      barStyle.textContent = ".ask textarea::-webkit-scrollbar { width: 15px; }";
      root.append(barStyle);
      const field = root.querySelector(".ask textarea") as HTMLTextAreaElement;
      const wrong: string[] = [];
      const all = text.split(" ");
      let bar = 0;
      // Written without a named function inside, which the test runner's build would wrap in a helper the page does not have.
      for (let count = 1; count <= all.length; count++) {
        field.value = all.slice(0, count).join(" ");
        field.dispatchEvent(new Event("input"));
        const height = field.getBoundingClientRect().height;
        // More than six lines hold: the box stops growing and scrolls, and its scroll bar is measured.
        if (height === 140 && field.scrollHeight > field.clientHeight) {
          bar = field.offsetWidth - field.clientWidth;
          break;
        }
        if (field.scrollHeight > field.clientHeight || field.offsetWidth > field.clientWidth) wrong.push(`${count} words: cut off at ${height}px`);
        // A line less: if the words still fit in it, the box was a line too tall.
        field.style.setProperty("height", `${height - 20}px`);
        if (height > 40 && field.scrollHeight <= height - 20) wrong.push(`${count} words: a line too tall at ${height}px`);
        field.style.setProperty("height", `${height}px`);
      }
      return { bar, wrong };
    }, text);
    assert.ok(drawn.bar > 0, "the words never came to more than six lines, or their scroll bar takes no room: this tells nothing");
    assert.deepEqual(drawn.wrong, []);
  } finally {
    await browser.close();
    await harness.close();
  }
});

test("Shift and Enter sends rather than starting a line, and lines put in at once run on as one", async () => {
  const session = await start(PAGE, () => words("Done."));
  try {
    await session.page.locator("haptic-root .launcher").click();
    // Text put in at once, as a paste is: its line breaks become spaces, and the caret stays at its end.
    await session.page.keyboard.insertText("add Theo\nas a card user");
    await session.page.keyboard.type(" now");
    assert.equal((await box(session)).typed, "add Theo as a card user now");
    await session.page.keyboard.press("Shift+Enter");
    const asked = await session.untilAsked(1);
    assert.equal(asked.goal, "add Theo as a card user now");
    assert.equal((await box(session)).typed, "");
  } finally {
    await session.close();
  }
});

test("Enter that takes a word from an input method, as for Japanese, does not send the question", async () => {
  const session = await start(PAGE, () => words("Done."));
  try {
    await session.page.locator("haptic-root .launcher").click();
    await session.page.keyboard.type("trip to ");
    // The Enter an input method uses to take the word it was putting together: marked as composing in most browsers,
    // and only by its key code, 229, in Safari. Either way it is the input method's.
    const sent = await session.page.evaluate(() => {
      const field = document.querySelector("haptic-root")!.shadowRoot!.querySelector(".ask textarea") as HTMLTextAreaElement;
      const composing = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, composed: true, cancelable: true });
      const safari = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true });
      // A value, not a getter: a function inside would be named by the test runner's build, with a helper the page lacks.
      Object.defineProperty(safari, "keyCode", { value: 229 });
      return [field.dispatchEvent(composing), field.dispatchEvent(safari)];
    });
    assert.deepEqual(sent, [true, true], "an input method's Enter was taken from it");
    await session.page.keyboard.type("日本");
    await session.page.waitForTimeout(400);
    assert.equal(session.requests.length, 0, "a question was sent while a word was being put together");
    assert.equal((await box(session)).typed, "trip to 日本");
    await session.page.keyboard.press("Enter");
    assert.equal((await session.untilAsked(1)).goal, "trip to 日本");
  } finally {
    await session.close();
  }
});
