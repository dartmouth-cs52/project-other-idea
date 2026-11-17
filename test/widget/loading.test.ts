import assert from "node:assert/strict";
import { after, test } from "node:test";
import { ACTING_ON, closeBrowser, idOf, point, start, words, type Session } from "./harness.ts";

after(closeBrowser);

// The widget is two files. widget.js is what the script tag loads on every
// page. The code that acts ("Do it with me") is widget-act.js, beside it on
// the same server, which widget.js loads only on a site with acting on
// (src/widget/acting-code.ts). Here: a site with acting off never asks for
// it; a site with acting on gets it and acts; and a site whose second file
// does not come is guided by pointer.

const PAGE = `<h1>Expenses</h1><label>Memo <input id="memo"></label><button id="next" type="button">Next</button><p id="done" hidden>Moved on.</p>
  <script>document.getElementById('next').addEventListener('click', () => { document.getElementById('done').hidden = false; });</script>`;

/** Every request the page made for the code that acts. */
function actingAsked(session: Session): string[] {
  const asked: string[] = [];
  session.page.on("request", (request: { url(): string }) => {
    if (request.url().includes("widget-act.js")) asked.push(request.url());
  });
  return asked;
}

test("a site with acting off never asks for the code that acts, and guides by pointer", async () => {
  const session = await start(PAGE, (request, index) => (index === 0 ? point(request, "Next", "Click Next.") : words("That's it.")));
  try {
    const asked = actingAsked(session);
    // Read again from the start, with the listener on, so the boot itself is heard.
    await session.page.reload();
    await session.page.waitForSelector("haptic-root", { state: "attached" });
    await session.ask("how do I go on");
    await session.untilState("pointing");
    assert.equal(await session.pointed(), "next");
    await session.page.waitForTimeout(500);
    assert.deepEqual(asked, []);
    assert.equal(await session.page.locator("haptic-root .panel .doit").isVisible(), false);
    assert.equal(await session.page.evaluate(() => typeof (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("haptic.acting.code")]), "undefined");
  } finally {
    await session.close();
  }
});

test("a site with acting on loads the code that acts from beside the widget, once, and Haptic does the step", async () => {
  const session = await start(
    PAGE,
    (request, index) => (index === 0 ? { target: idOf(request, "Next"), do: "click", commits: false, status: "continue", say: "Going on.", mode: "act" } : { ...words("Done."), mode: "act" }),
    "/",
    { acting: { ...ACTING_ON, confirmFirst: false } },
  );
  try {
    const asked = actingAsked(session);
    await session.page.reload();
    await session.page.waitForSelector("haptic-root", { state: "attached" });
    await session.ask("can you go on for me", { act: true });
    await session.untilAsked(2, 10_000);
    assert.equal(session.requests[0]?.mode, "act");
    assert.equal(await session.page.locator("#done").isVisible(), true, "Haptic did not press Next");
    assert.match(session.requests[1]?.event ?? "", /^You clicked button "Next"\./);
    assert.equal(asked.length, 1, asked.join(", "));
    assert.match(asked[0]!, /^https:\/\/widget\.joinhaptic\.com\/widget-act\.js\?v=\w+$/);
  } finally {
    await session.close();
  }
});

test("a site with acting on whose code that acts does not come is guided by pointer: Do it pressed while it loads points instead, and Do it goes", async () => {
  const session = await start(PAGE, (request, index) => (index === 0 ? point(request, "Next", "Click Next.") : words("That's it.")), "/", { acting: { ...ACTING_ON, confirmFirst: false } });
  try {
    // The second file takes a while, then fails.
    await session.page.context().route(/\/widget-act\.js/, (route: { abort(): Promise<void> }) => {
      setTimeout(() => void route.abort().catch(() => undefined), 2500);
    });
    await session.page.reload();
    await session.page.waitForSelector("haptic-root", { state: "attached" });
    await session.ask("can you go on for me", { act: true });
    const first = await session.untilAsked(1, 10_000);
    assert.equal(first.mode, undefined, "asked to act without the code that acts");
    await session.untilState("pointing");
    assert.equal(await session.pointed(), "next");
    assert.equal(await session.caption(), "Click Next.");
    assert.equal(await session.page.locator("#done").isVisible(), false, "something pressed Next");
    // Once the ask box comes back, it offers no Do it.
    await session.page.locator("#next").click();
    await session.untilState("finished");
    assert.equal(await session.page.locator("haptic-root .panel .doit").isVisible(), false);
  } finally {
    await session.close();
  }
});
