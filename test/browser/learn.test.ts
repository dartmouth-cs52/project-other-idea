import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser } from "playwright";
import type { OutlineReport } from "../../src/shared/types.ts";
import { BROWSERS, launch, page, startHarness, type Harness } from "./harness.ts";

// What the widget sends to teach Haptic the site: one outline per page per
// tab, labels only, and the way to a page that a click in a dialog leads to.

const APP = page(`
  <nav><a href="/" data-link>Home</a> <a href="/sets" data-link>My sets</a></nav>
  <main id="app"></main>
  <dialog id="set" aria-label="Biology 101"><h2>Biology 101</h2><button id="view">View</button></dialog>
  <script>
    const views = {
      "/": '<h1>Home</h1><button><svg class="lucide lucide-share-2"></svg></button> <button>Email ana@example.com</button>' +
        '<label>Search <input id="search"></label>' +
        '<table><tr><td><a href="/clients/8812">Acme Corporation</a></td><td><button>Edit</button></td></tr></table>' +
        '<button id="open-set" onclick="document.getElementById(\\'set\\').showModal()">Open set</button>',
      "/sets": '<h1>My sets</h1><button>New set</button>',
      "/set/8812": '<h1>Biology 101</h1><button>Study</button>',
    };
    const render = () => (document.getElementById("app").innerHTML = views[location.pathname] || "<h1>Not found</h1>");
    render();
    addEventListener("popstate", render);
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[data-link]");
      if (link) { event.preventDefault(); history.pushState({}, "", link.getAttribute("href")); render(); }
      if (event.target.closest("#view")) { document.getElementById("set").close(); history.pushState({}, "", "/set/8812"); render(); }
    });
  </script>`);

const outlines = (harness: Harness) => harness.posts.filter((post) => post.path === "/v1/outline").map((post) => post.body as OutlineReport);

async function until(check: () => boolean, ms = 6000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error("Waited too long.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

for (const name of BROWSERS) {
  describe(`learning from visits in ${name}`, () => {
    let browser: Browser;
    let harness: Harness;
    before(async () => {
      browser = await launch(name);
      harness = await startHarness();
      harness.fallback = APP;
    });
    after(async () => {
      await browser.close();
      await harness.close();
    });

    test("sends each page once per tab, with labels only", async () => {
      harness.posts.length = 0;
      const context = await browser.newContext();
      const tab = await context.newPage();
      await tab.goto(`${harness.url}/`);
      // Typed before the outline goes. It must never be in it.
      await tab.fill("#search", "my secret search");
      await until(() => outlines(harness).length >= 1);
      const [home] = outlines(harness);
      assert.equal(home!.site, "site_test");
      assert.match(home!.visitor ?? "", /^[0-9a-f-]{36}$/);
      assert.equal(home!.outline.path, "/");
      assert.deepEqual(home!.outline.headings, ["Home"]);
      assert.deepEqual(home!.outline.links, [{ label: "Home", to: "/" }, { label: "My sets", to: "/sets" }], "nothing from the table's cells");
      assert.deepEqual(home!.outline.buttons, ["icon:share-2", "Open set"], "an icon-only button by its icon, and the one with an email address left out");
      assert.ok(!JSON.stringify(home).includes("secret"), "nothing typed into a field");
      assert.ok(!JSON.stringify(home).includes("Acme"));

      await tab.reload();
      await tab.click("a[href='/sets']");
      await until(() => outlines(harness).length >= 2);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.deepEqual(outlines(harness).map((report) => report.outline.path), ["/", "/sets"], "the reload didn't send / again");

      const other = await context.newPage();
      await other.goto(`${harness.url}/`);
      await until(() => outlines(harness).length >= 3);
      assert.equal(outlines(harness)[2]!.visitor, home!.visitor, "another tab of the same browser is the same visitor");
      await context.close();
    });

    test("a click in a dialog that leads to a new page is learned as the way there", async () => {
      harness.posts.length = 0;
      const context = await browser.newContext();
      const tab = await context.newPage();
      await tab.goto(`${harness.url}/`);
      await until(() => outlines(harness).length >= 1);
      await tab.click("#open-set");
      await tab.click("#view");
      await until(() => outlines(harness).some((report) => report.outline.links.some((link) => link.label === "View, in a dialog")));
      const way = outlines(harness).find((report) => report.outline.links.some((link) => link.label === "View, in a dialog"))!;
      assert.equal(way.outline.path, "/", "stored on the page the click came from");
      assert.deepEqual(way.outline.links, [{ label: "View, in a dialog", to: "/set/:id" }]);
      await until(() => outlines(harness).some((report) => report.outline.path === "/set/:id"));
      await context.close();
    });

    test("a site that opted out sends nothing", async () => {
      harness.posts.length = 0;
      harness.config = { ...harness.config, learn: false };
      const context = await browser.newContext();
      const tab = await context.newPage();
      await tab.goto(`${harness.url}/`);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      assert.equal(outlines(harness).length, 0);
      harness.config = { name: "Test", appearance: harness.config.appearance };
      await context.close();
    });
  });
}
