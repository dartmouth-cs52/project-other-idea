import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { TurnReply } from "../../src/shared/types.ts";
import { ACTING_ON, closeBrowser, idOf, start, words, type Asked, type Session } from "./harness.ts";

after(closeBrowser);

// The hand-over at the end of "Do it with me": the pointer on the control that commits, its caption, and "What I did"
// in the launcher's panel, all at once. On Northpine a visitor watched it rearrange itself for about 0.6 seconds:
// "What I did" opened over Haptic's own caption and the edge of the button it pointed at and then jumped to the other
// side, and the caption was laid out three times, each wider than the last. In a short window the button's lower edge
// was under the window's edge, the pointer was out of sight, and "What I did" stayed over half the caption.
//
// Every place is now decided before anything is drawn. These tests read every frame the browser draws from the
// moment the hand-over arrives.

type Box = [left: number, top: number, right: number, bottom: number];
interface Frame {
  caption: Box | null;
  text: string;
  panel: Box | null;
  did: Box | null;
  ring: Box | null;
  pointer: Box | null;
  asked: Box | null;
  issue: Box;
}

const overlap = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/**
 * Starts keeping, for every frame the browser draws, where each of Haptic's parts is and where the button is. Given to
 * the page as text: a function handed over would arrive with this project's build helpers in it.
 */
const RECORD = `(() => {
  window.frames = [];
  const root = document.querySelector('haptic-root').shadowRoot;
  const round = (r) => [r.left, r.top, r.right, r.bottom].map((n) => Math.round(n));
  const box = (selector) => {
    const el = root.querySelector(selector);
    return el && !el.hidden && el.getClientRects().length ? round(el.getBoundingClientRect()) : null;
  };
  const tick = () => {
    window.frames.push({
      caption: box('.caption'), text: root.querySelector('.caption span').textContent, panel: box('.panel'), did: box('.did'),
      ring: box('.ring'), pointer: box('.cursor'), asked: box('.asked'), issue: round(document.getElementById('issue').getBoundingClientRect()),
    });
    if (window.frames.length < 900) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

const READY = "Ready. Check that the holder is Malika, the card is named Ads and the limit is 500, then click Issue card to create it.";
const QUESTION = "Issue Malika a card called Ads with a 500 limit for marketing";

/**
 * A card form that waits for its submit, with the button that commits low on the right, as on Northpine's review page:
 * where the launcher's panel opens, and where a wide caption beside it has to go. `space` puts the button that far down
 * (`toHandOver` reads a negative one as how far into the window the button's top is).
 */
const CARD = (space: number) => `<style>
    main { width: 1160px }
    label { display: block; margin: 12px 0 }
    .foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: ${space}px }
    .foot button { height: 32px; padding: 0 14px }
  </style>
  <main><h1>Issue a card</h1>
    <form id="card">
      <label>Cardholder <input id="holder" name="holder"></label>
      <label>Card name <input id="name" name="name"></label>
      <label>Spending limit <input id="limit" name="limit"></label>
      <label>Purpose <input id="purpose" name="purpose"></label>
      <div class="foot"><button type="button">Back</button><button id="issue" type="submit">Issue card</button></div>
    </form>
    <div style="height:420px"></div>
  </main>
  <script>document.getElementById('card').addEventListener('submit', (event) => event.preventDefault());</script>`;

const typing = (request: Asked, label: string, enter: string): TurnReply => ({ target: idOf(request, label), do: "type", enter, commits: false, status: "continue", say: `Typing ${enter} in ${label}.`, mode: "act" });

/** Runs the form to its hand-over in a window of this size, keeping every frame from the moment the hand-over is on its way, and gives the frames back a second after it. */
async function toHandOver(size: { width: number; height: number }, present: boolean, space: number): Promise<{ session: Session; frames: Frame[]; before: Box }> {
  let before: Box = [0, 0, 0, 0];
  const session: Session = await start(
    CARD(space),
    async (request, index) => {
      if (index === 0) return typing(request, "Cardholder", "Malika");
      if (index === 1) return typing(request, "Card name", "Ads");
      if (index === 2) return typing(request, "Spending limit", "500");
      if (index === 3) return typing(request, "Purpose", "marketing");
      if (index === 4) {
        await session.page.evaluate(RECORD);
        // Where the button is as the hand-over is sent, before the widget has it.
        before = (await session.page.evaluate(`(() => { const r = document.getElementById('issue').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); })()`)) as Box;
        return { target: idOf(request, "Issue card"), do: null, commits: true, status: "done", say: READY, mode: "act" };
      }
      return words("The card is issued.");
    },
    "/",
    { acting: ACTING_ON, present },
  );
  await session.page.setViewportSize(size);
  // A negative space puts the button that many pixels into the window from its foot, with the rest of it below.
  if (space < 0) {
    await session.page.evaluate(`(() => {
      const foot = document.querySelector('.foot');
      const top = document.getElementById('issue').getBoundingClientRect().top;
      foot.style.marginTop = (parseFloat(getComputedStyle(foot).marginTop) + innerHeight + ${space} - top) + 'px';
    })()`);
  }
  // The visitor's mouse rests away from everything, as it does while they watch.
  await session.page.mouse.move(300, 300);
  await session.ask(QUESTION, { act: true });
  await session.untilAsked(5, 40_000);
  await session.untilState("pointing");
  await session.until(async () => (await session.did()).lines.length === 4, "What I did to show");
  await session.page.waitForTimeout(1200);
  const frames = (await session.page.evaluate(() => (window as unknown as { frames: Frame[] }).frames)) as Frame[];
  return { session, frames, before };
}

/** The frames from the first one that shows anything of the hand-over: its caption, or What I did. */
const ofHandOver = (frames: Frame[]) => frames.slice(Math.max(0, frames.findIndex((frame) => frame.did !== null || (frame.caption !== null && frame.text === READY))));

for (const [mode, present] of [
  ["in presentation mode", true],
  ["as usual", false],
] as const) {
  test(`${mode}, the hand-over is drawn once: What I did never covers the caption or the button, and neither is laid out twice`, async () => {
    const { session, frames } = await toHandOver({ width: 1536, height: 864 }, present, 430);
    try {
      const shown = ofHandOver(frames);
      assert.ok(shown.length > 20, `only ${shown.length} frames of the hand-over were kept`);
      // From its first frame the hand-over is whole: the caption, What I did and the ring come up together.
      const first = shown[0]!;
      assert.ok(first.caption && first.text === READY && first.did && first.panel && first.ring, `the first frame of the hand-over is missing a part: ${JSON.stringify(first)}`);
      const captions = new Set(shown.map((frame) => `${frame.text === READY ? "" : "another sentence "}${frame.caption?.join(",")}`));
      assert.equal(captions.size, 1, `the caption was laid out ${captions.size} times: ${[...captions].join(" | ")}`);
      const panels = new Set(shown.map((frame) => frame.panel?.join(",")));
      assert.equal(panels.size, 1, `What I did was in ${panels.size} places: ${[...panels].join(" | ")}`);
      for (const [at, frame] of shown.entries()) {
        assert.ok(!overlap(frame.panel!, frame.caption!), `frame ${at}: What I did covers the caption: ${JSON.stringify(frame)}`);
        assert.ok(!overlap(frame.panel!, frame.issue), `frame ${at}: What I did covers the button: ${JSON.stringify(frame)}`);
        assert.ok(!overlap(frame.caption!, frame.issue), `frame ${at}: the caption covers the button: ${JSON.stringify(frame)}`);
        if (frame.asked) assert.ok(!overlap(frame.asked, frame.caption!) && !overlap(frame.asked, frame.panel!) && !overlap(frame.asked, frame.issue), `frame ${at}: the question covers something: ${JSON.stringify(frame)}`);
      }
      // The pointer ends on the button, and the caption keeps off the window's edge.
      const last = shown.at(-1)!;
      assert.ok(last.pointer && last.pointer[0] >= last.issue[0] && last.pointer[0] <= last.issue[2] && last.pointer[1] >= last.issue[1] && last.pointer[1] <= last.issue[3], JSON.stringify(last));
      assert.ok(last.caption![0] >= 8 && last.caption![2] <= 1536 - 8, `the caption is against the window's edge: ${last.caption}`);
      assert.equal(await session.pointed(), "issue");
    } finally {
      await session.close();
    }
  });
}

test("in a short window the button is brought into view before the hand-over, the pointer is in sight, and What I did covers neither the caption nor the button", async () => {
  // 1280 by 720 is a 1920 by 1080 screen at 150% zoom. The button's lower edge starts under the window's.
  const { session, frames, before } = await toHandOver({ width: 1280, height: 720 }, true, -14);
  try {
    assert.ok(before[1] < 720 && before[3] > 720, `the button was not half out of view before the hand-over: ${before}`);
    const shown = ofHandOver(frames);
    for (const [at, frame] of shown.entries()) {
      assert.ok(frame.issue[1] >= 0 && frame.issue[3] <= 720, `frame ${at}: the button is not wholly in the window: ${frame.issue}`);
      assert.ok(frame.caption && frame.panel && !overlap(frame.panel, frame.caption), `frame ${at}: What I did covers the caption: ${JSON.stringify(frame)}`);
      assert.ok(!overlap(frame.panel!, frame.issue) && !overlap(frame.caption!, frame.issue), `frame ${at}: the button is covered: ${JSON.stringify(frame)}`);
      assert.ok(frame.panel![1] >= 0 && frame.caption![1] >= 0 && frame.caption![3] <= 720 && frame.caption![0] >= 0 && frame.caption![2] <= 1280, `frame ${at}: part of Haptic is outside the window: ${JSON.stringify(frame)}`);
    }
    assert.equal(new Set(shown.map((frame) => `${frame.caption?.join(",")} ${frame.panel?.join(",")}`)).size, 1, "the hand-over moved after it was drawn");
    const last = shown.at(-1)!;
    assert.ok(last.pointer && last.pointer[1] >= 0 && last.pointer[3] <= 720 && last.pointer[0] >= 0 && last.pointer[2] <= 1280, `the pointer is out of sight: ${last.pointer}`);
    assert.deepEqual((await session.did()).lines, ["Cardholder: Malika", "Card name: Ads", "Spending limit: 500", "Purpose: marketing"]);

    // Shorter still: the list scrolls inside itself, and the panel stays inside the window with every line reachable.
    await session.page.setViewportSize({ width: 1280, height: 420 });
    await session.page.waitForTimeout(400);
    const small = await session.page.evaluate(() => {
      const root = document.querySelector("haptic-root")!.shadowRoot!;
      const list = root.querySelector(".did ul") as HTMLElement;
      const panel = root.querySelector(".panel")!.getBoundingClientRect();
      return { top: panel.top, bottom: panel.bottom, scrolls: list.scrollHeight > list.clientHeight + 1, overflow: getComputedStyle(list).overflowY };
    });
    assert.ok(small.top >= 0 && small.bottom <= 420, `What I did does not fit a window 420 px high: ${JSON.stringify(small)}`);
    assert.deepEqual([small.scrolls, small.overflow], [true, "auto"]);
  } finally {
    await session.close();
  }
});
