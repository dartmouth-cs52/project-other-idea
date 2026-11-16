import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser, Page } from "playwright";
import type { OutlineReport, PageOpening } from "../../src/shared/types.ts";
import { BROWSERS, launch, page, startHarness, type Harness } from "./harness.ts";

// When a visitor opens a menu, a tab or an accordion, the widget sends what
// appeared with the label of the control that opened it. Never what a field
// suggests, and never a menu inside a table's cells.

const APP = page(`
  <header>
    <button id="help" aria-haspopup="menu" aria-expanded="false">Help</button>
  </header>
  <main>
    <h1>Settings</h1>
    <div role="tablist"><button role="tab" aria-selected="true" id="general">General</button><button role="tab" aria-selected="false" id="security">Security</button></div>
    <div role="tabpanel" id="panel"><button>Save profile</button></div>
    <label>Assignee <input id="who" role="combobox" aria-expanded="false" aria-controls="people"></label>
    <ul role="listbox" id="people" hidden><li role="option">Jane Doe</li><li role="option">Omar Ali</li></ul>
    <table><tr><td>Acme</td><td><button id="row" aria-haspopup="menu" aria-expanded="false">Row actions</button></td></tr></table>
  </main>
  <script>
    // Like Radix: the menu opens on the press, before the click.
    document.getElementById("help").addEventListener("pointerdown", (event) => {
      const button = event.currentTarget;
      if (button.getAttribute("aria-expanded") === "true") return;
      button.setAttribute("aria-expanded", "true");
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = '<a role="menuitem" href="/help">Help center</a><div role="menuitem" tabindex="-1">Keyboard shortcuts</div><div role="menuitem" tabindex="-1">Contact support</div>';
      document.body.append(menu);
    });
    document.getElementById("security").addEventListener("click", () => {
      document.getElementById("panel").innerHTML = '<button>Create API key</button><button>Turn on two-factor</button>';
    });
    document.getElementById("who").addEventListener("pointerdown", () => (document.getElementById("people").hidden = false));
    document.getElementById("row").addEventListener("pointerdown", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = '<div role="menuitem">Archive Acme</div>';
      document.body.append(menu);
    });
  </script>`);

const opened = (harness: Harness): PageOpening[] =>
  harness.posts.filter((post) => post.path === "/v1/outline").flatMap((post) => (post.body as OutlineReport).outline.opens ?? []);

async function until(check: () => boolean, ms = 6000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error("Waited too long.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

for (const name of BROWSERS) {
  describe(`learning what menus show in ${name}`, () => {
    let browser: Browser;
    let harness: Harness;
    let tab: Page;
    before(async () => {
      browser = await launch(name);
      harness = await startHarness();
      harness.fallback = APP;
      tab = await (await browser.newContext()).newPage();
      await tab.goto(`${harness.url}/settings`);
      await tab.locator("haptic-root .launcher").waitFor();
      // The page's own outline goes first.
      await until(() => harness.posts.some((post) => post.path === "/v1/outline"));
    });
    after(async () => {
      await browser.close();
      await harness.close();
    });

    test("a menu that opens on the press is sent with the control that opened it", async () => {
      await tab.click("#help");
      await until(() => opened(harness).some((item) => item.control === "Help"));
      assert.deepEqual(
        opened(harness).find((item) => item.control === "Help"),
        { control: "Help", links: [{ label: "Help center", to: "/help" }], buttons: ["Keyboard shortcuts", "Contact support"] },
      );
    });

    test("a tab is sent with what its panel showed", async () => {
      await tab.click("#security");
      await until(() => opened(harness).some((item) => item.control === "Security"));
      assert.deepEqual(opened(harness).find((item) => item.control === "Security")?.buttons, ["Create API key", "Turn on two-factor"]);
    });

    test("never what a field suggests, a menu in a table's cells, or the same control twice in a tab", async () => {
      const before = opened(harness).length;
      await tab.click("#who");
      await tab.click("#row");
      await tab.click("#help");
      await tab.waitForTimeout(1500);
      assert.equal(opened(harness).length, before, JSON.stringify(opened(harness)));
      const sent = JSON.stringify(harness.posts);
      assert.ok(!sent.includes("Jane Doe") && !sent.includes("Archive Acme"), sent);
    });
  });
}
