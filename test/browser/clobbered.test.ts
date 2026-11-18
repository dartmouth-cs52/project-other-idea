import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import type { Browser } from "playwright";
import { BROWSERS, launch, page, startHarness, type Harness } from "./harness.ts";

// The widget takes every address it uses from its own script tag: the server
// it asks, and the files it loads beside itself. A page's HTML can name an
// element currentScript, and a document's named elements come before its own
// properties, so document.currentScript is then that element. The audit's
// proof was an image a visitor's comment could put on a page: the widget took
// its address for its own, fetched its settings from there, and loaded and ran
// a second file from there in the customer's page. Now only a script element
// is taken for the widget's tag, and on a page that names something else
// currentScript the widget does not start.

for (const name of BROWSERS) {
  describe(`a page with something named currentScript, in ${name}`, () => {
    let harness: Harness;
    let browser: Browser;
    let elsewhere: Server;
    /** The other server, as an attacker's would answer: settings that turn acting on, and a second file of its own. */
    let there = "";
    const asked: string[] = [];
    before(async () => {
      harness = await startHarness();
      elsewhere = createServer((req, res) => {
        asked.push(req.url ?? "");
        const cors = { "Access-Control-Allow-Origin": "*" };
        if (req.url?.startsWith("/v1/sites/")) {
          return res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify({ name: "Elsewhere", appearance: {}, acting: { maxActions: 3, confirmFirst: true } }));
        }
        if (req.url?.startsWith("/widget-act.js")) return res.writeHead(200, { ...cors, "Content-Type": "text/javascript" }).end("window.__ran = location.origin;");
        res.writeHead(404, cors).end();
      });
      await new Promise<void>((resolve) => elsewhere.listen(0, "127.0.0.1", resolve));
      there = `http://127.0.0.1:${(elsewhere.address() as AddressInfo).port}`;
      harness.pages.set("/", page(`<h1>Comments</h1><p>Looks good to me.</p>`));
      harness.pages.set("/named", page(`<h1>Comments</h1><p>Looks good to me. <img name="currentScript" src="${there}/x.png" data-site="site_elsewhere"></p>`));
      browser = await launch(name);
    });
    after(async () => {
      await browser.close();
      await harness.close();
      await new Promise((resolve) => elsewhere.close(resolve));
    });

    test("the widget does not start, asks nothing of the address the element names, and runs nothing from there", async () => {
      const tab = await (await browser.newContext()).newPage();
      const warned = tab
        .waitForEvent("console", { predicate: (message) => message.text().includes("named currentScript"), timeout: 5000 })
        .then((message) => message.text())
        .catch(() => "");
      await tab.goto(`${harness.url}/named`);
      const said = await warned;
      // Time for a widget that took the image for its tag to fetch its settings from there and load its second file, as it did.
      await tab.waitForTimeout(500);
      assert.equal(await tab.evaluate(() => (window as unknown as { __ran?: string }).__ran ?? null), null, "nothing from the other server ran in the page");
      assert.deepEqual(
        asked.filter((url) => url !== "/x.png"),
        [],
        "the only request to the other server is the page's own image",
      );
      assert.equal(await tab.locator("haptic-root").count(), 0);
      assert.match(said, /^\[Haptic\] Something on this page is named currentScript/);
      await tab.context().close();
    });

    test("the same page without it gets the widget as always", async () => {
      const tab = await (await browser.newContext()).newPage();
      await tab.goto(`${harness.url}/`);
      await tab.locator("haptic-root .launcher").waitFor();
      await tab.context().close();
    });
  });
}
