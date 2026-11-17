import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { Browser, BrowserContext, Page } from "playwright";
import type { GuideReport } from "../../src/shared/types.ts";
import { ask, BROWSERS, done, idOf, launch, page, point, ringAround, startHarness, turns, type Harness } from "./harness.ts";

// The chat is the one in the website's home page demo. It stays open from the
// question to the last step: the question is a bubble at the top, one line
// under it says what Haptic is doing, and the ask box's button stops the
// guide. A click on the control is answered with a press, and a guide followed
// to the end is marked with the green tick. Thinking shows on the page, not in
// the chat: a soft band of colour falls from the page's top to its bottom,
// only while Haptic waits for the model, and fades the moment the reply arrives.

const PAGE = page(`
  <main style="font:14px system-ui;padding:40px">
    <h1>Team</h1>
    <button id="invite">Invite teammate</button>
    <button id="send" style="margin-left:24px">Send invite</button>
    <a href="#elsewhere" id="other" style="margin-left:24px">Roles</a>
    <button id="corner" style="position:fixed;right:80px;bottom:150px">Save changes</button>
  </main>`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const part = (tab: Page, selector: string) => tab.locator(`haptic-root ${selector}`);
const reports = (harness: Harness) => harness.posts.filter((post) => post.path.endsWith("/report")).map((post) => post.body as GuideReport);
const outcomes = (harness: Harness) => reports(harness).map((report) => report.outcome).filter(Boolean);

/** Where the guide is, as the widget itself says. */
const guideState = (tab: Page) => tab.evaluate(() => (document.querySelector("haptic-root") as (Element & { guideState?: string }) | null)?.guideState);
const untilState = (tab: Page, state: string) =>
  tab.waitForFunction((state) => (document.querySelector("haptic-root") as (Element & { guideState?: string }) | null)?.guideState === state, state, { timeout: 5000, polling: 20 });

/** What the line under the question says, with the look it has, or "" when it is not showing. */
const statusLine = (tab: Page) =>
  tab.evaluate(() => {
    const status = document.querySelector("haptic-root")?.shadowRoot?.querySelector<HTMLElement>(".status");
    if (!status || status.hidden) return "";
    const look = ["thinking", "pointing"].find((name) => status.classList.contains(name));
    return `${look ? `${look}: ` : ""}${status.querySelector("span")?.textContent ?? ""}`;
  });

/** Notes every class the pointer, the ring and the glow are given, so a test can ask what was shown, however briefly. */
const watchClasses = (tab: Page) =>
  tab.evaluate(() => {
    const seen = ((window as unknown as { seen: string[] }).seen = [] as string[]);
    // Written out in one piece: a helper function in here would not survive the trip into the page.
    // The glow has an element of its own, so both are watched.
    for (const host of [document.querySelector("haptic-root")!, document.querySelector("haptic-veil")!]) {
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "attributes") seen.push((record.target as Element).getAttribute("class")?.trim() ?? "");
          for (const added of record.addedNodes) if (added instanceof Element && added.getAttribute("class")) seen.push(added.getAttribute("class")!.trim());
        }
      }).observe(host.shadowRoot!, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    }
  });
const seen = (tab: Page) => tab.evaluate(() => (window as unknown as { seen: string[] }).seen);

/** The glow's element, as the browser has it: whether it is displayed, how it is blended into the page, and where it sits. */
const veil = (tab: Page) =>
  tab.evaluate(() => {
    const veil = document.querySelector("haptic-veil")!;
    const host = document.querySelector("haptic-root")!;
    const style = getComputedStyle(veil);
    const box = veil.getBoundingClientRect();
    return {
      display: style.display,
      blend: style.mixBlendMode,
      clicks: style.pointerEvents,
      covers: box.width === window.innerWidth && box.height === window.innerHeight,
      underOurs: Number(style.zIndex) < Number(getComputedStyle(host).zIndex),
    };
  });

for (const name of BROWSERS) {
  describe(`the chat in ${name}`, () => {
    let browser: Browser;
    let harness: Harness;
    let context: BrowserContext;
    let tab: Page;
    before(async () => {
      browser = await launch(name);
      harness = await startHarness();
      harness.pages.set("/", PAGE);
    });
    after(async () => {
      await browser.close();
      await harness.close();
    });
    beforeEach(async () => {
      await context?.close();
      harness.turns.length = 0;
      harness.posts.length = 0;
      context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      tab = await context.newPage();
      await tab.goto(`${harness.url}/`);
      await part(tab, ".launcher").waitFor();
    });

    test("says it is an AI under the ask box, before anything is asked and all through a guide", async () => {
      harness.script = (request) => point(idOf(request, "Invite teammate"), "Click Invite teammate.");
      await part(tab, ".launcher").click();
      const about = part(tab, ".about");
      assert.equal((await about.textContent())?.trim(), "Haptic is an AI guide and can be wrong.");
      assert.equal(await about.locator("a").getAttribute("href"), "https://joinhaptic.com/privacy/");
      await part(tab, ".ask input").fill("invite someone");
      await part(tab, ".ask input").press("Enter");
      assert.ok(await ringAround(tab, "#invite"));
      assert.equal(await about.isVisible(), true, "it is still there while the pointer shows a step");
    });

    test("stays open through a guide, with the question at the top and stop in the ask box", async () => {
      harness.script = async (request) => {
        await sleep(500);
        return point(idOf(request, "Invite teammate"), "Click Invite teammate.");
      };
      await ask(tab, "invite someone");
      await untilState(tab, "asking");
      assert.equal(await part(tab, ".question").textContent(), "invite someone");
      assert.equal(await statusLine(tab), "thinking: Thinking");
      assert.equal(await part(tab, ".ask input").inputValue(), "", "the ask box is empty again, and still there");
      assert.equal(await part(tab, ".ask").isVisible(), true);
      assert.equal(await part(tab, ".stop").isVisible(), true, "its button is the way to stop");
      assert.equal(await part(tab, ".send").isVisible(), false);

      assert.ok(await ringAround(tab, "#invite"), "the ring lands around the control");
      await untilState(tab, "pointing");
      assert.equal(await statusLine(tab), "pointing: Showing you how");
      assert.equal(await part(tab, ".panel").isVisible(), true, "the chat is still open while the pointer shows the step");
      assert.equal(await part(tab, ".caption span").textContent(), "Click Invite teammate.");

      await part(tab, ".stop").click();
      await untilState(tab, "finished");
      assert.equal(await part(tab, ".cursor").isVisible(), false, "stop takes the pointer away");
      assert.equal(await statusLine(tab), "");
      assert.equal(await part(tab, ".thread").isVisible(), false, "and leaves the plain ask box");
      assert.equal(await part(tab, ".send").isVisible(), true);
      assert.equal(await part(tab, ".stop").isVisible(), false);
      await sleep(150);
      assert.deepEqual(outcomes(harness), ["stopped"]);
    });

    test("answers a click on the control with a press, and then takes the pointer away", async () => {
      harness.script = async (request, index) => {
        if (index > 0) await sleep(700);
        return point(idOf(request, index === 0 ? "Invite teammate" : "Send invite"), "Click it.");
      };
      await ask(tab, "invite someone");
      assert.ok(await ringAround(tab, "#invite"));
      await untilState(tab, "pointing");
      await watchClasses(tab);
      await tab.click("#invite");
      await untilState(tab, "asking");
      assert.equal(await statusLine(tab), "thinking: Thinking");
      await tab.waitForFunction(() => document.querySelector("haptic-root")!.shadowRoot!.querySelector<HTMLElement>(".cursor")!.hidden, undefined, { timeout: 2000 });
      const classes = await seen(tab);
      assert.ok(classes.includes("cursor press"), `the pointer dipped: ${classes.join(", ")}`);
      assert.ok(classes.includes("ring press"), "and so did the ring");
      assert.equal(await part(tab, ".caption").isVisible(), false, "the caption went at once");
      assert.ok(await ringAround(tab, "#send"), "then it goes on to the next control");
    });

    test("a click somewhere else gets no press, and the chat says it is finding the way", async () => {
      harness.script = async (request, index) => {
        if (index > 0) await sleep(600);
        return point(idOf(request, "Invite teammate"), "Click Invite teammate.");
      };
      await ask(tab, "invite someone");
      assert.ok(await ringAround(tab, "#invite"));
      await untilState(tab, "pointing");
      await watchClasses(tab);
      await tab.click("#other");
      await untilState(tab, "asking");
      assert.equal(await statusLine(tab), "thinking: Finding the way from here");
      await turns(harness, 2);
      assert.ok(!(await seen(tab)).some((classes) => classes.includes("press")), "nothing was pressed");
    });

    test("marks a guide that was followed to the end with the green tick and Done", async () => {
      harness.script = (request, index) => (index === 0 ? point(idOf(request, "Invite teammate"), "Click Invite teammate.") : done("All set. The invite is on its way."));
      await ask(tab, "invite someone");
      assert.ok(await ringAround(tab, "#invite"));
      assert.equal(await part(tab, ".done").isVisible(), false, "not before it is done");
      await tab.click("#invite");
      await untilState(tab, "finished");
      await part(tab, ".done").waitFor({ state: "visible", timeout: 3000 });
      assert.equal((await part(tab, ".done").textContent())?.trim(), "Done");
      assert.equal(await part(tab, ".done i").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(0, 137, 50)", "the tick is Done green");
      assert.equal(await part(tab, ".question").textContent(), "invite someone", "the question is still at the top");
      assert.equal(await part(tab, ".caption span").textContent(), "All set. The invite is on its way.");
      assert.equal(await part(tab, ".send").isVisible(), true, "the ask box is ready for the next question");
      assert.equal(await part(tab, ".helped").textContent(), "Did this help?YesNo");
      await sleep(150);
      assert.ok(outcomes(harness).includes("finished"), "it is reported as finished");
    });

    test("sends the answer to Did this help to the server, for the guide it was asked about", async () => {
      harness.script = (request, index) => (index === 0 ? point(idOf(request, "Invite teammate")) : done());
      await ask(tab, "invite someone");
      assert.ok(await ringAround(tab, "#invite"));
      await tab.click("#invite");
      await part(tab, ".helped button").first().waitFor();
      await part(tab, ".helped button").filter({ hasText: "Yes" }).click();
      assert.equal(await part(tab, ".helped").textContent(), "Thanks.");
      await sleep(200);
      const said = harness.posts.find((post) => (post.body as GuideReport).helped === true);
      assert.ok(said, `a report with helped: true was posted: ${JSON.stringify(harness.posts)}`);
      assert.equal(said.path, `/v1/guides/${harness.turns[0]!.guide}/report`, "under the id the guide's steps carried");
      assert.equal((said.body as GuideReport).site, "site_test");
    });

    test("a question that is only shown the control, and does not use it, ends without the tick", async () => {
      harness.script = (request) => point(idOf(request, "Invite teammate"), "It is this button.", "done");
      await ask(tab, "where do I invite people");
      assert.ok(await ringAround(tab, "#invite"));
      await tab.click("#other");
      await untilState(tab, "finished");
      await sleep(200);
      assert.equal(await part(tab, ".done").isVisible(), false);
      assert.deepEqual(outcomes(harness), ["shown"]);
    });

    test("a band of colour falls down the page only while Haptic thinks, and is gone by the time the ring has landed", async () => {
      harness.script = async (request) => {
        await sleep(900);
        return point(idOf(request, "Invite teammate"), "Click Invite teammate.");
      };
      await part(tab, ".launcher").click();
      assert.equal((await veil(tab)).display, "none", "with no glow on, its element is not displayed");
      await watchClasses(tab);
      await part(tab, ".ask input").fill("invite someone");
      await part(tab, ".ask input").press("Enter");
      const glow = tab.locator("haptic-veil .glow");
      await glow.waitFor({ state: "attached" });
      assert.equal(await guideState(tab), "asking");

      // It is on the page: the whole of it, under the chat and the pointer, multiplied in so the page's words stay sharp.
      assert.deepEqual(await veil(tab), { display: "block", blend: "multiply", clicks: "none", covers: true, underOurs: true });
      assert.equal(await part(tab, ".panel .glow").count(), 0, "and not in the chat");
      // The page under it still takes a click.
      await tab.locator("#send").click({ trial: true, timeout: 1000 });

      // It comes in at the top and falls, slower as the wait goes on: the band's middle starts above the page's top edge, and is lower each time it is looked at.
      const middle = () =>
        glow.locator("i").evaluate((el) => {
          const box = el.getBoundingClientRect();
          return (box.top + box.height / 2) / window.innerHeight;
        });
      const first = await middle();
      await sleep(300);
      const second = await middle();
      assert.ok(first < 0.2, `it starts at the top of the page: ${first}`);
      assert.ok(second > first + 0.15, `and falls: ${first} then ${second}`);

      // It is paced to a wait it cannot know the length of, so it is never at the bottom before the reply.
      await sleep(350);
      assert.ok((await middle()) < 0.9, "it has not got to the bottom while Haptic still thinks");

      // The reply arrives. The glow goes on to the bottom and off the page, and is gone by the time the ring has landed.
      assert.ok(await ringAround(tab, "#invite"));
      await glow.waitFor({ state: "detached", timeout: 1000 });
      assert.equal((await veil(tab)).display, "none", "and nothing is left over the page");
      assert.ok((await seen(tab)).includes("glow fade"), "it faded, and was not cut off");
    });

    // The blend the glow asks for is no use unless the browser gives it across the top layer, where the glow is: laid
    // over the page as plain colour, the same band would grey its words out. So this looks at the picture, not the style.
    for (const [shade, ink, paper, blend] of [
      ["light", "#000", "#fff", "multiply"],
      ["dark", "#fff", "#0c0a09", "screen"],
    ] as const) {
      test(`on a ${shade} page the band colours the page and leaves its ink as it was`, async () => {
        harness.pages.set(
          `/${shade}-ink`,
          page(
            `<div style="position:fixed;left:0;top:0;width:40px;height:100vh;background:${ink}"></div>
             <main style="font:14px system-ui;padding:40px 40px 40px 160px;min-height:100vh;box-sizing:border-box;background:${paper};color:${ink}"><button id="invite">Invite teammate</button></main>`,
            "<style>body{margin:0}</style>",
          ),
        );
        harness.script = () => new Promise(() => {});
        await tab.goto(`${harness.url}/${shade}-ink`);
        await part(tab, ".launcher").waitFor();
        // Two strips down the page's left edge, clear of the chat: one of its ink, and one of bare page beside it.
        const strip = (x: number) => tab.screenshot({ clip: { x, y: 0, width: 40, height: 700 } });
        const before = { ink: await strip(0), paper: await strip(60) };
        await ask(tab, "invite someone");
        await tab.locator("haptic-veil .glow").waitFor({ state: "attached" });
        assert.equal((await veil(tab)).blend, blend);
        // Long enough for the band to be well down the page, with Haptic still thinking.
        await sleep(900);
        const during = { ink: await strip(0), paper: await strip(60) };
        assert.equal(await guideState(tab), "asking");
        assert.ok(!during.paper.equals(before.paper), "the band shows on the bare page");
        assert.ok(during.ink.equals(before.ink), `the page's ink is untouched under it: the band is blended in (${blend}), not laid over`);
      });
    }

    // Blending the band into the page is work for the browser, and where there is no graphics card to do it, frames
    // come slowly while it fades. The ring does not wait for one.
    test("the ring is round the control the moment the guide says it is pointing, however slowly the page is drawn", async () => {
      const slow = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      try {
        // Every frame comes a third of a second late.
        await slow.addInitScript(() => {
          const frame = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = (callback) => window.setTimeout(() => frame(callback), 300);
          window.cancelAnimationFrame = (id) => window.clearTimeout(id);
        });
        const late = await slow.newPage();
        await late.goto(`${harness.url}/`);
        await part(late, ".launcher").waitFor();
        harness.script = (request) => point(idOf(request, "Invite teammate"), "Click Invite teammate.");
        await ask(late, "invite someone");
        // Asked in one go, so nothing can happen between the two answers.
        const seenAt = await late.waitForFunction(
          () => {
            const host = document.querySelector("haptic-root") as (Element & { guideState?: string }) | null;
            if (host?.guideState !== "pointing") return false;
            const ring = host.shadowRoot!.querySelector<HTMLElement>(".ring")!;
            const box = ring.getBoundingClientRect();
            const button = document.querySelector("#invite")!.getBoundingClientRect();
            return { hidden: ring.hidden, round: box.left <= button.left && box.right >= button.right && box.top <= button.top && box.bottom >= button.bottom };
          },
          undefined,
          { timeout: 8000, polling: 10 },
        );
        assert.deepEqual(await seenAt.jsonValue(), { hidden: false, round: true });
      } finally {
        await slow.close();
      }
    });

    test("the glow comes back for each spell of thinking, and not while the pointer shows a step", async () => {
      harness.script = async (request, index) => {
        await sleep(500);
        return point(idOf(request, index === 0 ? "Invite teammate" : "Send invite"), "Click it.");
      };
      await ask(tab, "invite someone");
      const glow = tab.locator("haptic-veil .glow");
      assert.ok(await ringAround(tab, "#invite"));
      await sleep(500);
      assert.equal(await glow.count(), 0, "nothing is over the page while the visitor reads the step");
      await tab.click("#invite");
      await glow.waitFor({ state: "attached", timeout: 1000 });
      assert.ok(await ringAround(tab, "#send"));
      await glow.waitFor({ state: "detached", timeout: 1000 });
    });

    test("on a dark page the glow is screened in, so its colour shows", async () => {
      harness.pages.set("/dark", page(`<main style="font:14px system-ui;padding:40px;min-height:100vh;background:#0c0a09;color:#e7e5e4"><h1>Team</h1><button id="invite">Invite teammate</button></main>`, "<style>body{margin:0}</style>"));
      harness.script = () => new Promise(() => {});
      await tab.goto(`${harness.url}/dark`);
      await ask(tab, "invite someone");
      await tab.locator("haptic-veil .glow").waitFor({ state: "attached" });
      assert.equal((await veil(tab)).blend, "screen");
    });

    test("with reduced motion there is no glow, and the pointer and ring still arrive", async () => {
      const still = await browser.newContext({ viewport: { width: 1000, height: 700 }, reducedMotion: "reduce" });
      const quiet = await still.newPage();
      harness.script = async (request) => {
        await sleep(300);
        return point(idOf(request, "Invite teammate"), "Click Invite teammate.");
      };
      await quiet.goto(`${harness.url}/`);
      await ask(quiet, "invite someone");
      await untilState(quiet, "asking");
      assert.equal(await statusLine(quiet), "thinking: Thinking", "the word still says what Haptic is doing");
      assert.equal(await quiet.locator("haptic-veil .glow").count(), 0, "nothing is drawn over the page");
      assert.equal(await quiet.evaluate(() => getComputedStyle(document.querySelector("haptic-veil")!).display), "none");
      assert.ok(await ringAround(quiet, "#invite"));
      await still.close();
    });

    test("moves to the other side of the window when it would cover the control, and comes back when the pointer has gone", async () => {
      harness.script = async (request, index) => {
        if (index > 0) await sleep(500);
        return point(idOf(request, index === 0 ? "Save changes" : "Invite teammate"), "Click it.");
      };
      const side = () => part(tab, ".dock").evaluate((dock) => (dock.classList.contains("left") ? "left" : "right"));
      await ask(tab, "save my changes");
      assert.ok(await ringAround(tab, "#corner"));
      await tab.waitForFunction(() => document.querySelector("haptic-root")!.shadowRoot!.querySelector(".dock")!.classList.contains("left"), undefined, { timeout: 2000 });
      assert.equal(await part(tab, ".panel").isVisible(), true, "the chat is still open, on the other side");
      // The control it would have covered can be clicked.
      await tab.locator("#corner").click({ trial: true, timeout: 1000 });

      await tab.click("#corner");
      assert.ok(await ringAround(tab, "#invite"));
      await sleep(400);
      assert.equal(await side(), "right", "it is back on its own side for a control it does not cover");
    });
  });
}
