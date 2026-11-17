import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser } from "playwright";
import type { GuideReport } from "../../src/shared/types.ts";
import { ask, BROWSERS, done, idOf, launch, page, point, ringAround, startHarness, turns, type Harness } from "./harness.ts";

// How a guide that is still on show when the page goes is reported. The
// report goes from the page's pagehide, with keepalive, so it still reaches the
// server once the page has gone. Here the server is a real one on this machine,
// which hears a request the page sends as it goes. The visitor leaves for
// another site: closing a tab with Playwright drops what a page sends as it
// closes in Chromium, though Chrome itself sends it, so leaving stands in for
// closing the tab. Both fire pagehide.

const HOME = page(`<h1>Home</h1><button id="billing" type="button">Billing</button>`);

for (const name of BROWSERS) {
  describe(`a guide's ending as the tab closes, in ${name}`, () => {
    let browser: Browser;
    let harness: Harness;
    before(async () => {
      browser = await launch(name);
      harness = await startHarness();
      harness.pages.set("/", HOME);
    });
    after(async () => {
      await browser.close();
      await harness.close();
    });

    const reports = () => harness.posts.filter((post) => post.path.endsWith("/report")).map((post) => ({ guide: post.path.split("/")[3], ...(post.body as GuideReport) }));
    async function until(check: () => boolean, ms = 4000) {
      for (const deadline = Date.now() + ms; !check() && Date.now() < deadline; ) await new Promise((resolve) => setTimeout(resolve, 25));
    }

    test("a first answer that points, read and left, is reported shown as the page goes", async () => {
      harness.posts.length = 0;
      harness.turns.length = 0;
      harness.script = (request) => point(idOf(request, "Billing"), "Billing is here.", "done");
      const tab = await browser.newPage();
      await tab.goto(`${harness.url}/`);
      await ask(tab, "where is billing");
      assert.ok(await ringAround(tab, "#billing"));
      await tab.waitForTimeout(500);
      assert.deepEqual(reports(), [], "a pointer not yet used is not an ending yet");
      await tab.goto("about:blank");
      await until(() => reports().length > 0);
      assert.deepEqual(reports(), [{ guide: harness.turns[0]?.guide, outcome: "shown", site: "site_test" }]);
      await tab.close();
    });

    test("with no guide running, leaving the page sends nothing more", async () => {
      harness.posts.length = 0;
      harness.turns.length = 0;
      harness.script = () => done("Billing is in the account menu.");
      const tab = await browser.newPage();
      await tab.goto(`${harness.url}/`);
      await ask(tab, "where is billing");
      await turns(harness, 1);
      await until(() => reports().length > 0);
      assert.deepEqual(reports().map((report) => report.outcome), ["shown"]);
      await tab.goto("about:blank");
      await new Promise((resolve) => setTimeout(resolve, 800));
      assert.deepEqual(reports().map((report) => report.outcome), ["shown"], "an ended guide was reported again as the page went");
      await tab.close();
    });
  });
}
