import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { Browser, BrowserContext, Page } from "playwright";
import type { GuideReport } from "../../src/shared/types.ts";
import { ask, BROWSERS, done, idOf, launch, markAround, page, point, reachable, startHarness, stateOf, turns, type Harness } from "./harness.ts";

// The chat is the one on the website's home page. It stays open from the
// question to the last step: the question is a bubble at the top, one line
// under it says what Haptic is doing, and the ask box's button stops the
// guide. A click on the control is answered with a press, a guide followed to
// the end finishes with the green tick, and thinking shows as a pool of colour
// that rises through the chat when the reply arrives.

const PAGE = page(`
  <main style="font:14px system-ui;padding:40px">
    <h1>Team</h1>
    <button id="invite">Invite teammate</button>
    <button id="send" style="margin-left:24px">Send invite</button>
    <a href="#elsewhere" id="other" style="margin-left:24px">Roles</a>
    <label style="display:block;margin-top:24px">Email <input id="email" type="email"></label>
    <button id="corner" style="position:fixed;right:80px;bottom:150px">Save changes</button>
  </main>`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const part = (tab: Page, selector: string) => tab.locator(`haptic-root ${selector}`);
const reports = (harness: Harness) => harness.posts.filter((post) => post.path.endsWith("/report")).map((post) => post.body as GuideReport);

/** Notes every class the pointer, the mark and the glow are given, so a test can ask what was shown, however briefly. */
const watchClasses = (tab: Page) =>
  tab.evaluate(() => {
    const root = document.querySelector("haptic-root")!.shadowRoot!;
    const seen = ((window as unknown as { seen: string[] }).seen = [] as string[]);
    // Written out in one piece: a helper function in here would not survive the trip into the page.
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") seen.push((record.target as Element).className.trim());
        for (const added of record.addedNodes) if (added instanceof Element) seen.push(added.className.trim());
      }
    }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  });
const seen = (tab: Page) => tab.evaluate(() => (window as unknown as { seen: string[] }).seen);

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
      const note = part(tab, ".note");
      assert.equal((await note.textContent())?.trim(), "Haptic is an AI guide and can be wrong.");
      assert.equal(await note.locator("a").getAttribute("href"), "https://joinhaptic.com/privacy/");
      await part(tab, ".ask input").fill("invite someone");
      await part(tab, ".ask input").press("Enter");
      assert.ok(await markAround(tab, "#invite"));
      assert.equal(await note.isVisible(), true, "it is still there while the pointer shows a step");
    });

    test("stays open through a guide, with the question at the top and stop in the ask box", async () => {
      harness.script = async (request) => {
        await sleep(400);
        return point(idOf(request, "Invite teammate"), "Click Invite teammate.");
      };
      await part(tab, ".launcher").click();
      assert.equal(await part(tab, ".send").isDisabled(), true, "with nothing typed there is nothing to send");
      await part(tab, ".ask input").fill("invite someone");
      assert.equal(await part(tab, ".send").isDisabled(), false);
      await part(tab, ".send").click();

      assert.equal(await part(tab, ".asked").textContent(), "invite someone");
      assert.equal(await stateOf(tab), "thinking: Thinking");
      assert.equal(await part(tab, ".send").getAttribute("aria-label"), "Stop");
      assert.equal(await part(tab, ".ask input").inputValue(), "", "the ask box is empty again");

      assert.ok(await markAround(tab, "#invite"), "the mark lands around the control");
      assert.equal(await stateOf(tab), "pointing: Showing you how");
      assert.equal(await part(tab, ".panel").isVisible(), true, "the chat is still open while the pointer shows the step");
      assert.equal(await part(tab, ".caption span").textContent(), "Click Invite teammate.");
      assert.equal(await part(tab, ".caption .close").isVisible(), false, "the caption carries no button while the chat is open");

      await part(tab, ".send").click();
      await part(tab, ".cursor").waitFor({ state: "hidden" });
      assert.equal(await stateOf(tab), "", "stop ends the guide");
      assert.equal(await part(tab, ".thread").isVisible(), false, "and leaves the plain ask box");
      assert.equal(await part(tab, ".send").getAttribute("aria-label"), "Send");
    });

    test("answers a click on the control with a press, and the pointer waits there for the next step", async () => {
      harness.script = async (request, index) => {
        if (index > 0) await sleep(700);
        return point(idOf(request, index === 0 ? "Invite teammate" : "Send invite"), "Click it.");
      };
      await ask(tab, "invite someone");
      assert.ok(await markAround(tab, "#invite"));
      await watchClasses(tab);
      await tab.click("#invite");
      await tab.waitForFunction(() => document.querySelector("haptic-root")!.shadowRoot!.querySelector<HTMLElement>(".mark")!.hidden);
      const classes = await seen(tab);
      assert.ok(classes.includes("cursor press"), `the pointer dipped: ${classes.join(", ")}`);
      assert.ok(classes.includes("mark press"), "and so did the mark");
      assert.equal(await part(tab, ".caption").isVisible(), false, "the caption went with the mark");
      assert.equal(await part(tab, ".cursor").isVisible(), true, "the pointer waits where it is");
      assert.equal(await stateOf(tab), "thinking: Thinking");
      assert.ok(await markAround(tab, "#send"), "then it goes on to the next control");
    });

    test("a click somewhere else gets no press, and the chat says it is finding the way", async () => {
      harness.script = async (request, index) => {
        if (index > 0) await sleep(600);
        return point(idOf(request, "Invite teammate"), "Click Invite teammate.");
      };
      await ask(tab, "invite someone");
      assert.ok(await markAround(tab, "#invite"));
      await watchClasses(tab);
      await tab.click("#other");
      assert.equal(await stateOf(tab), "thinking: Finding the way from here");
      await turns(harness, 2);
      assert.ok(!(await seen(tab)).some((classes) => classes.includes("press")), "nothing was pressed");
    });

    test("finishes a guide that was followed with the reply, the green tick and Done", async () => {
      harness.script = (request, index) => (index === 0 ? point(idOf(request, "Invite teammate"), "Click Invite teammate.") : done("All set. The invite is on its way."));
      await ask(tab, "invite someone");
      assert.ok(await markAround(tab, "#invite"));
      await tab.click("#invite");
      await part(tab, ".reply").waitFor();
      assert.equal(await part(tab, ".reply p").first().textContent(), "All set. The invite is on its way.");
      assert.equal(await stateOf(tab), "done: Done");
      assert.equal(await part(tab, ".state .tick").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(0, 137, 50)", "the tick is Done green");
      assert.equal(await part(tab, ".send").getAttribute("aria-label"), "Send", "the ask box is ready for the next question");
      await part(tab, ".cursor").waitFor({ state: "hidden" });
      assert.equal(await part(tab, ".helped").textContent(), "Did this help?YesNo");
      await sleep(150);
      assert.ok(reports(harness).some((report) => report.outcome === "finished"), "it is reported as finished");
    });

    test("sends the answer to Did this help to the server, for the guide it was asked about", async () => {
      harness.script = (request, index) => (index === 0 ? point(idOf(request, "Invite teammate")) : done());
      await ask(tab, "invite someone");
      assert.ok(await markAround(tab, "#invite"));
      await tab.click("#invite");
      await part(tab, ".helped button").first().waitFor();
      await part(tab, ".helped button").filter({ hasText: "Yes" }).click();
      assert.equal(await part(tab, ".helped").textContent(), "Thanks.");
      await sleep(200);
      const said = harness.posts.find((post) => (post.body as GuideReport).helped === true);
      assert.ok(said, `a report with helped: true was posted: ${JSON.stringify(harness.posts)}`);
      const guide = harness.turns[0]!.guide;
      assert.equal(said.path, `/v1/guides/${guide}/report`, "under the id the guide's steps carried");
      assert.equal((said.body as GuideReport).site, "site_test");
    });

    test("a first answer that points shows Done once the control is used", async () => {
      harness.script = (request) => point(idOf(request, "Invite teammate"), "It is this button.", "done");
      await ask(tab, "where do I invite people");
      assert.ok(await markAround(tab, "#invite"));
      assert.equal(await stateOf(tab), "pointing: Showing you how");
      await watchClasses(tab);
      await tab.click("#invite");
      assert.equal(await stateOf(tab), "done: Done");
      assert.ok((await seen(tab)).includes("cursor press"), "the click was answered with a press");
      await part(tab, ".cursor").waitFor({ state: "hidden" });
      await sleep(150);
      assert.deepEqual(reports(harness).map((report) => report.outcome).filter(Boolean), ["finished"]);
    });

    test("a first answer that points and is not used ends without the tick", async () => {
      harness.script = (request) => point(idOf(request, "Invite teammate"), "It is this button.", "done");
      await ask(tab, "where do I invite people");
      assert.ok(await markAround(tab, "#invite"));
      await tab.click("#other");
      await part(tab, ".cursor").waitFor({ state: "hidden" });
      assert.equal(await stateOf(tab), "");
      await sleep(150);
      assert.deepEqual(reports(harness).map((report) => report.outcome).filter(Boolean), ["shown"]);
    });

    test("thinking gathers a pool of colour, which rises through the chat when the reply arrives and is then gone", async () => {
      harness.script = async (request) => {
        await sleep(300);
        return point(idOf(request, "Invite teammate"), "Click Invite teammate.");
      };
      await part(tab, ".launcher").click();
      await watchClasses(tab);
      await part(tab, ".ask input").fill("invite someone");
      await part(tab, ".ask input").press("Enter");
      await part(tab, ".glow").waitFor({ state: "attached" });
      assert.equal(await part(tab, ".glow.bloom").count(), 0, "it only gathers while Haptic thinks");
      await part(tab, ".glow.bloom").waitFor({ state: "attached", timeout: 3000 });
      // The reply took 300ms. The pool still gathers for its full 600ms before it breaks away, and the pointer does not wait for it.
      const classes = await seen(tab);
      assert.ok(classes.indexOf("state pointing") < classes.indexOf("glow bloom"), `the pointer set off first: ${classes.join(", ")}`);
      await part(tab, ".glow").waitFor({ state: "detached", timeout: 3000 });
      assert.equal(await part(tab, ".glows").evaluate((el) => el.childElementCount), 0, "nothing is left behind");
    });

    test("a reply that says Haptic is resting fades the pool where it is, with no rise", async () => {
      harness.script = async () => {
        await sleep(200);
        return { reply: { target: null, status: "stuck", say: "Haptic is resting for a while.", paused: true } };
      };
      await part(tab, ".launcher").click();
      await watchClasses(tab);
      await part(tab, ".ask input").fill("invite someone");
      await part(tab, ".ask input").press("Enter");
      await part(tab, ".reply").waitFor();
      assert.equal(await part(tab, ".reply p").first().textContent(), "Haptic is resting for a while.");
      await part(tab, ".glow").waitFor({ state: "detached", timeout: 2000 });
      const classes = await seen(tab);
      assert.ok(classes.includes("glow fade"), `it faded: ${classes.join(", ")}`);
      assert.ok(!classes.includes("glow bloom"), "and did not rise");
      assert.equal(await stateOf(tab), "");
    });

    test("steps aside when it would cover the control, and comes back when the pointer leaves", async () => {
      harness.script = async (request, index) => {
        if (index > 0) await sleep(500);
        return point(idOf(request, index === 0 ? "Save changes" : "Invite teammate"), "Click it.");
      };
      await ask(tab, "save my changes");
      assert.ok(await markAround(tab, "#corner"));
      assert.equal(await part(tab, ".panel").isVisible(), false, "the chat closed, so the control can be clicked");
      await tab.locator("#corner").click({ trial: true, timeout: 1000 });
      assert.ok(await reachable(tab, ".caption .close"), "the caption now carries the way to stop");

      await tab.click("#corner");
      await part(tab, ".panel").waitFor({ state: "visible" });
      assert.equal(await stateOf(tab), "thinking: Thinking", "it is back as soon as the pointer has left the control");
      assert.ok(await markAround(tab, "#invite"));
      assert.equal(await part(tab, ".panel").isVisible(), true, "and stays for a control it does not cover");
      assert.equal(await part(tab, ".caption .close").isVisible(), false);
    });

    test("stopping from the caption, when the chat has stepped aside, ends the guide", async () => {
      harness.script = (request) => point(idOf(request, "Save changes"), "Click Save changes.");
      await ask(tab, "save my changes");
      assert.ok(await markAround(tab, "#corner"));
      await part(tab, ".caption .close").click();
      await part(tab, ".cursor").waitFor({ state: "hidden" });
      assert.equal(await part(tab, ".panel").isVisible(), true, "the chat is back, with the plain ask box");
      assert.equal(await part(tab, ".thread").isVisible(), false);
      await sleep(150);
      assert.deepEqual(reports(harness).map((report) => report.outcome).filter(Boolean), ["stopped"]);
    });

    test("a chat the visitor closed stays closed while Haptic thinks, with the way to stop on the caption, and opens for the reply", async () => {
      harness.script = async (request, index) => {
        if (index === 0) return point(idOf(request, "Invite teammate"), "Click Invite teammate.");
        await sleep(500);
        return done("All set.");
      };
      await ask(tab, "invite someone");
      assert.ok(await markAround(tab, "#invite"));
      await part(tab, ".launcher").click();
      assert.equal(await part(tab, ".panel").isVisible(), false);
      await part(tab, ".caption .close").waitFor({ state: "visible" });

      await tab.click("#invite");
      await turns(harness, 2);
      assert.equal(await part(tab, ".panel").isVisible(), false, "thinking does not open it again");
      await part(tab, ".reply").waitFor({ state: "visible", timeout: 3000 });
      assert.equal(await stateOf(tab), "done: Done", "the reply does");
    });

    test("with reduced motion there is no glow, and the pointer and mark still arrive", async () => {
      const still = await browser.newContext({ viewport: { width: 1000, height: 700 }, reducedMotion: "reduce" });
      const quiet = await still.newPage();
      harness.script = async (request) => {
        await sleep(300);
        return point(idOf(request, "Invite teammate"), "Click Invite teammate.");
      };
      await quiet.goto(`${harness.url}/`);
      await ask(quiet, "invite someone");
      assert.equal(await stateOf(quiet), "thinking: Thinking", "the word still says what Haptic is doing");
      assert.equal(await part(quiet, ".glows").evaluate((el) => getComputedStyle(el).display), "none");
      assert.ok(await markAround(quiet, "#invite"));
      assert.equal(await part(quiet, ".cursor").evaluate((el) => getComputedStyle(el).transitionDuration), "0s", "the pointer jumps to the control");
      await still.close();
    });
  });
}
