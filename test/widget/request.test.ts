import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { DEFAULT_APPEARANCE, GUIDE_ID, TURN_VERSION, type TurnRequest } from "../../src/shared/types.ts";
import { bundleWidget } from "../../src/widget/build.ts";

// What the widget puts in a question besides the page. It needs a browser, so
// it is not part of `npm test`: run it with `npm run test:widget`. Playwright
// is not installed by this project, and where it is missing the test is skipped.
//
// The page, the widget and the server's answers all come from this file, at an
// address that does not exist. Nothing leaves the machine and no model is called.

const ORIGIN = "https://app.haptic.test";
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Test page</title></head><body>
<h1>Orders</h1><button id="export">Export</button>
<script src="${ORIGIN}/widget.js" data-site="site_test"></script></body></html>`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let chromium: any;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  // Skipped below.
}

test("every question carries the widget's version and the date where the visitor is", { skip: chromium ? false : "Playwright is not installed" }, async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    // Fourteen hours ahead of the server's clock, so the visitor's date is often not the server's.
    const context = await browser.newContext({ timezoneId: "Pacific/Kiritimati" });
    const widget = await bundleWidget();
    const asked: TurnRequest[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await context.route(`${ORIGIN}/**`, async (route: any) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/widget.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: widget });
      if (path.startsWith("/v1/sites/")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "Test", appearance: DEFAULT_APPEARANCE }) });
      if (path === "/v1/turn") {
        asked.push(route.request().postDataJSON() as TurnRequest);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ target: null, status: "done", say: "Exports are made with the Export button." }) });
      }
      return route.fulfill({ status: 200, contentType: "text/html", body: PAGE });
    });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/orders`);
    await page.waitForSelector("haptic-root", { state: "attached" });
    await page.locator("haptic-root .launcher").click();
    await page.locator("haptic-root .ask input").fill("how do I export my orders?");
    await page.locator("haptic-root .ask input").press("Enter");
    for (const until = Date.now() + 10_000; !asked.length && Date.now() < until; ) await page.waitForTimeout(50);

    assert.equal(asked.length, 1, "the widget asked once");
    const [request] = asked;
    assert.equal(request?.version, TURN_VERSION);
    // The date on the visitor's own clock, read from the page itself, a moment before and after in case midnight passes.
    const theirs = () => page.evaluate(() => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
    assert.match(request?.today ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.ok([await theirs(), await theirs()].includes(request?.today ?? ""), `today was sent as ${request?.today}`);
    // Nothing else new goes with it: the same fields as before, the two above, the guide's id, which ties its steps together
    // on the server, and the random id the widget keeps for this site (learn.ts), which the server keeps only as a hash.
    assert.match(request?.guide ?? "", GUIDE_ID);
    assert.match(request?.visitor ?? "", /^[0-9a-f-]{36}$/);
    assert.deepEqual(Object.keys(request ?? {}).sort(), ["goal", "guide", "history", "site", "snapshot", "step", "today", "version", "visitor"]);
  } finally {
    await browser.close();
  }
});
