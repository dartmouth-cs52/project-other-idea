import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser } from "playwright";
import { ask, BROWSERS, done, idOf, launch, page, point, markAround, startHarness, turns, type Harness } from "./harness.ts";

// A small single-page app. Its links change the address with pushState and
// draw the next page in place. Two of its buttons are slow in the two ways
// real apps are: one changes the address at once and draws the page a second
// later, and one waits for the next page's data and then changes both together.

const SPA = page(`
  <nav><a href="/" data-link>Home</a> <a href="/reports/42" data-link>Latest report</a></nav>
  <main id="app"></main>
  <script>
    const views = {
      "/": '<h1>Home</h1><button id="slow">Open report</button> <button id="late">Open report later</button>',
      "/reports/42": '<h1>Report 42</h1><button id="export">Export</button>',
    };
    const render = () => (document.getElementById("app").innerHTML = views[location.pathname] || "<h1>Not found</h1>");
    render();
    addEventListener("popstate", render);
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[data-link]");
      if (link) {
        event.preventDefault();
        history.pushState({}, "", link.getAttribute("href"));
        render();
      }
      const button = event.target.closest("button");
      if (button?.id === "slow") {
        history.pushState({}, "", "/reports/42");
        setTimeout(render, 1000);
      }
      if (button?.id === "late") {
        setTimeout(() => {
          window.routeChangedAt = performance.now();
          history.pushState({}, "", "/reports/42");
          render();
        }, 700);
      }
    });
  </script>`);

for (const name of BROWSERS) {
  describe(`route changes in ${name}`, () => {
    let browser: Browser;
    let harness: Harness;
    before(async () => {
      browser = await launch(name);
      harness = await startHarness();
      harness.fallback = SPA;
    });
    after(async () => {
      await browser.close();
      await harness.close();
    });

    test("an address that changes before the page is drawn waits for the new page", async () => {
      harness.turns.length = 0;
      harness.script = (request, index) => {
        if (index === 0) return point(idOf(request, "Open report"), "Click Open report.");
        if (index === 1) return point(idOf(request, "Export"), "Click Export.");
        return done();
      };
      const tab = await browser.newPage();
      await tab.goto(`${harness.url}/`);
      await ask(tab, "export the report");
      assert.ok(await markAround(tab, "#slow"));
      await tab.click("#slow");
      const [, second] = await turns(harness, 2);
      assert.equal(second!.snapshot.path, "/reports/:id");
      assert.deepEqual(second!.snapshot.elements.filter((element) => element.role === "button").map((element) => element.label), ["Export"], "the step shows the new page, not the old one under the new address");
      assert.ok(await markAround(tab, "#export"));
      await tab.close();
    });

    test("a page that changes while the model is answering drops that answer and asks again from the new page", async () => {
      harness.turns.length = 0;
      harness.hungUp = 0;
      harness.script = (request, index) => {
        if (index === 0) return point(idOf(request, "Open report later"), "Click Open report later.");
        // The slow model. Asked about the old page, it would point at the same button again.
        if (index === 1) return { ...point(idOf(request, "Open report later")), holdMs: 4000 };
        if (index === 2) return point(idOf(request, "Export"), "Click Export.");
        return done();
      };
      const tab = await browser.newPage();
      await tab.goto(`${harness.url}/`);
      await ask(tab, "export the report");
      assert.ok(await markAround(tab, "#late"));
      await tab.click("#late");
      const [, second] = await turns(harness, 2);
      assert.equal(second!.snapshot.path, "/", "the step was asked before the page changed");

      const [, , third] = await turns(harness, 3);
      assert.equal(harness.hungUp, 1, "the widget hung up on the answer about the old page");
      assert.equal(third!.snapshot.path, "/reports/:id");
      assert.match(third!.event ?? "", /went from \/ to \/reports\/:id/);
      assert.ok(await markAround(tab, "#export"));
      const ms = await tab.evaluate(() => performance.now() - (window as unknown as { routeChangedAt: number }).routeChangedAt);
      assert.ok(ms < 2000, `pointed at Export ${Math.round(ms)} ms after the page changed, without waiting out the old answer`);
      console.log(`  ${name}: pointer on the new page ${Math.round(ms)} ms after the route changed`);
      await tab.close();
    });

    test("going back while a step waits for a click is seen at once", async () => {
      harness.turns.length = 0;
      harness.script = (request, index) => {
        if (index === 0) return point(idOf(request, "Export"), "Click Export.");
        return done("You're back on the home page.");
      };
      const tab = await browser.newPage();
      await tab.goto(`${harness.url}/`);
      await tab.click("a[href='/reports/42']");
      await ask(tab, "export the report");
      assert.ok(await markAround(tab, "#export"));
      await tab.goBack();
      const [, second] = await turns(harness, 2);
      assert.match(second!.event ?? "", /went to \/ without using button "Export"/);
      assert.equal(second!.snapshot.path, "/");
      await tab.close();
    });

    test("a pointer left up after an explanation goes when the visitor goes back", async () => {
      harness.turns.length = 0;
      harness.script = (request) => point(idOf(request, "Export"), "Export is here.", "done");
      const tab = await browser.newPage();
      await tab.goto(`${harness.url}/`);
      await tab.click("a[href='/reports/42']");
      await ask(tab, "where is export");
      assert.ok(await markAround(tab, "#export"));
      await tab.goBack();
      await tab.waitForFunction(() => document.querySelector("haptic-root")!.shadowRoot!.querySelector<HTMLElement>(".cursor")!.hidden, null, { timeout: 1000 });
      await tab.close();
    });
  });
}
