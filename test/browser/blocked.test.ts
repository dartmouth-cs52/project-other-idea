import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser } from "playwright";
import { BLOCKED_SAY } from "../../src/shared/corrections.ts";
import type { GuideReport } from "../../src/shared/types.ts";
import { ask, BROWSERS, idOf, launch, page, point, startHarness, type Harness } from "./harness.ts";

// The widget checks every pointer against the site's list of controls never to
// point at, as well as the server does. Here the server is a script that
// names a blocked control anyway, early and in full.

for (const name of BROWSERS) {
  describe(`controls never to point at in ${name}`, () => {
    let browser: Browser;
    let harness: Harness;
    before(async () => {
      browser = await launch(name);
      harness = await startHarness();
      harness.pages.set("/", page(`<h1>Settings</h1><button id="save">Save changes</button> <button id="delete">Delete workspace</button>`));
      harness.config = { ...harness.config, blocked: [{ label: "Delete workspace" }] };
    });
    after(async () => {
      await browser.close();
      await harness.close();
    });

    test("a blocked control named by the server gets no pointer, and the visitor is told plainly", async () => {
      harness.script = (request) => ({ ...point(idOf(request, "Delete workspace"), "Click Delete workspace."), holdMs: 600 });
      const tab = await browser.newPage();
      await tab.goto(`${harness.url}/`);
      await tab.waitForSelector("haptic-root");
      // Notes if the pointer is ever shown, at any moment.
      await tab.evaluate(() => {
        const cursor = document.querySelector("haptic-root")!.shadowRoot!.querySelector<HTMLElement>(".cursor")!;
        new MutationObserver(() => {
          if (!cursor.hidden) (window as unknown as { pointerShown: boolean }).pointerShown = true;
        }).observe(cursor, { attributes: true });
      });
      await ask(tab, "delete my workspace");
      const caption = tab.locator("haptic-root .caption span");
      await caption.filter({ hasText: BLOCKED_SAY }).waitFor({ timeout: 3000 });
      const pointerShown = await tab.evaluate(() => (window as unknown as { pointerShown?: boolean }).pointerShown === true);
      assert.equal(pointerShown, false, "the pointer never went to it, not even while the reply was coming");
      await new Promise((resolve) => setTimeout(resolve, 200));
      const reports = harness.posts.filter((post) => post.path.endsWith("/report")).map((post) => post.body as GuideReport);
      assert.ok(reports.some((report) => report.outcome === "blocked"), "the guide is reported as blocked");
      await tab.close();
    });
  });
}
