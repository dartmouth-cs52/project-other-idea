import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser, Page } from "playwright";
import { ask, BROWSERS, done, idOf, launch, page, point, reachable, ringAround, startHarness, turns, type Harness } from "./harness.ts";

// A page's modal <dialog> makes everything outside it inert, our element
// included, and draws over it. The widget moves into the open dialog and shows
// itself again on top, and moves back out when the dialog closes.

const PAGE = page(`
  <main>
    <h1>Projects</h1>
    <button id="open" onclick="document.getElementById('settings').showModal()">Open settings</button>
    <button id="save">Save page</button>
    <div id="menu" popover>Page menu</div>
    <button id="menu-button" onclick="document.getElementById('menu').showPopover()">Menu</button>
  </main>
  <dialog id="settings" aria-label="Settings">
    <h2>Settings</h2>
    <button id="nested" onclick="document.getElementById('more').showModal()">More options</button>
    <button id="close" onclick="this.closest('dialog').close()">Close</button>
  </dialog>
  <dialog id="more" aria-label="More options">
    <h2>More options</h2>
    <button id="more-done" onclick="this.closest('dialog').close()">Done here</button>
  </dialog>`);

/** Where our element is: the id of the dialog it sits in, or "page". */
const home = (tab: Page) => tab.evaluate(() => {
  const host = document.querySelector("haptic-root");
  return host?.parentElement instanceof HTMLDialogElement ? host.parentElement.id : "page";
});

/** Waits until our element is in the given place, and says how long that took after `since`. */
async function movedTo(tab: Page, where: string): Promise<void> {
  await tab.waitForFunction(
    (where) => {
      const parent = document.querySelector("haptic-root")?.parentElement;
      return (parent instanceof HTMLDialogElement ? parent.id : "page") === where && document.querySelector("haptic-root")!.matches(":popover-open");
    },
    where,
    // The backstop check runs every 500ms. Moving well inside that shows the dialog itself was heard.
    { timeout: 200, polling: 10 },
  );
}

for (const name of BROWSERS) {
  describe(`modal dialogs in ${name}`, () => {
    let browser: Browser;
    let harness: Harness;
    before(async () => {
      browser = await launch(name);
      harness = await startHarness();
      harness.pages.set("/", PAGE);
    });
    after(async () => {
      await browser.close();
      await harness.close();
    });

    test("a dialog that opens and closes mid-guide keeps the pointer and the panel usable", async () => {
      harness.turns.length = 0;
      harness.script = (request, index) => {
        if (index === 0) return point(idOf(request, "Open settings"), "Click Open settings.");
        if (index === 1) return point(idOf(request, "Close"), "Click Close.");
        if (index === 2) return point(idOf(request, "Save page"), "Click Save page.");
        return done();
      };
      const tab = await browser.newPage();
      await tab.goto(`${harness.url}/`);
      await ask(tab, "save the page");
      assert.ok(await ringAround(tab, "#open"), "points at Open settings");

      await tab.click("#open");
      await movedTo(tab, "settings");
      const [, second] = await turns(harness, 2);
      assert.equal(second!.snapshot.dialog, "Settings", "the next step sees only the dialog");
      assert.ok(!second!.snapshot.elements.some((element) => element.label === "Save page"), "nothing behind the dialog is listed");
      assert.ok(await ringAround(tab, "#close"), "points at Close, inside the dialog");
      assert.ok(await reachable(tab, ".caption .close"), "the caption's stop button can be pressed while the dialog is open");
      await tab.locator("haptic-root .caption .close").click({ trial: true, timeout: 1000 });

      await tab.click("#close");
      await movedTo(tab, "page");
      const [, , third] = await turns(harness, 3);
      assert.equal(third!.snapshot.dialog, undefined);
      assert.ok(await ringAround(tab, "#save"), "points at Save page once the dialog has closed");
      assert.ok(await reachable(tab, ".caption .close"));
      await tab.close();
    });

    test("nested dialogs: it follows the top one in and back out", async () => {
      harness.turns.length = 0;
      harness.script = (request, index) => {
        if (index === 0) return point(idOf(request, "Open settings"));
        if (index === 1) return point(idOf(request, "More options"));
        if (index === 2) return point(idOf(request, "Done here"));
        if (index === 3) return point(idOf(request, "Close"));
        return done("You're back on the page.");
      };
      const tab = await browser.newPage();
      await tab.goto(`${harness.url}/`);
      await ask(tab, "more options");
      assert.ok(await ringAround(tab, "#open"));

      await tab.click("#open");
      await movedTo(tab, "settings");
      assert.ok(await ringAround(tab, "#nested"));

      await tab.click("#nested");
      await movedTo(tab, "more");
      const [, , third] = await turns(harness, 3);
      assert.equal(third!.snapshot.dialog, "More options");
      assert.ok(await ringAround(tab, "#more-done"), "points inside the inner dialog");
      assert.ok(await reachable(tab, ".caption .close"));

      await tab.click("#more-done");
      await movedTo(tab, "settings");
      const [, , , fourth] = await turns(harness, 4);
      assert.equal(fourth!.snapshot.dialog, "Settings", "back to the outer dialog");
      assert.ok(await ringAround(tab, "#close"));
      assert.ok(await reachable(tab, ".caption .close"));

      await tab.click("#close");
      await movedTo(tab, "page");
      await turns(harness, 5);
      assert.equal(await home(tab), "page");
      await tab.close();
    });

    test("Escape in the ask box closes the panel and leaves the page's dialog open", async () => {
      const tab = await browser.newPage();
      await tab.goto(`${harness.url}/`);
      await tab.click("#open");
      await movedTo(tab, "settings");
      await tab.locator("haptic-root .launcher").click();
      await tab.locator("haptic-root .ask textarea").press("Escape");
      assert.equal(await tab.locator("haptic-root .panel").isHidden(), true, "our panel closed");
      assert.equal(await tab.evaluate(() => (document.getElementById("settings") as HTMLDialogElement).open), true, "the dialog stayed open");
      await tab.close();
    });

    test("a popover the page opens does not cover the pointer", async () => {
      const tab = await browser.newPage();
      await tab.goto(`${harness.url}/`);
      await tab.waitForSelector("haptic-root");
      const raised = await tab.evaluate(async () => {
        const host = document.querySelector("haptic-root")!;
        let shown = 0;
        host.addEventListener("toggle", (event) => (event as ToggleEvent).newState === "open" && shown++);
        document.getElementById("menu")!.showPopover();
        await new Promise((resolve) => setTimeout(resolve, 100));
        return shown;
      });
      assert.ok(raised >= 1, "shown again after the page's popover, so it is on top of it");
      await tab.close();
    });
  });
}
