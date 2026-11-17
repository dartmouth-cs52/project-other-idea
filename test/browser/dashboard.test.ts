import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Locator, Page } from "playwright";
import { BRAND, SITE, SKIP, WAITING, startDashboard, type Dashboard } from "./dashboard-harness.ts";

// The dashboard keeping itself current, and the things about it that only show
// in a real browser. Each test opens the built page, changes the database the
// way the widget server would, and waits for the page to say so by itself.
// Nothing here reloads a page to see a change.

/** Waits until `check` holds, and fails with `message` if it never does. */
async function eventually(check: () => Promise<boolean>, message: string, ms = 10_000): Promise<void> {
  for (const deadline = Date.now() + ms; Date.now() < deadline; await new Promise((resolve) => setTimeout(resolve, 100))) if (await check()) return;
  assert.fail(message);
}

const shows = (row: Locator, words: string) => row.getByText(words).first().waitFor({ timeout: 10_000 });
const closing = async (tab: Page, work: () => Promise<void>) => {
  try {
    await work();
  } finally {
    // An open tab keeps asking what is new, which the next test would count as its own.
    await tab.context().close();
  }
};

describe("the dashboard in chromium", { skip: SKIP }, () => {
  let dash: Dashboard;
  before(async () => {
    dash = await startDashboard();
  });
  after(async () => {
    await dash?.close();
  });

  test("a question asked elsewhere shows on the open Overview, step by step, and the count goes up", async () => {
    const tab = await dash.open();
    await closing(tab, async () => {
      const finished = tab.locator('[data-metric="Guides finished"] > span').nth(1);
      await finished.waitFor();
      const count = Number(await finished.innerText());

      const guide = dash.ask("How do I invite a teammate?");
      const row = tab.locator("li", { hasText: "How do I invite a teammate?" }).first();
      await shows(row, "Thinking");

      dash.step(guide, 0, "People", "Open People.");
      await shows(row, "Showing step 1");
      assert.match(await row.innerText(), /People on \//, "the control it is pointing at, and the page");
      assert.equal(await row.locator("svg.text-pointer").count(), 1, "a guide under way carries the pointer");

      dash.step(guide, 1, "Invite people", "Press Invite people.", "/people");
      await shows(row, "Showing step 2");

      dash.end(guide);
      await shows(row, "Finished");
      assert.equal(await row.locator("svg.text-pointer").count(), 0, "the pointer goes when the guide ends");
      await eventually(async () => Number(await finished.innerText()) === count + 1, `guides finished should go from ${count} to ${count + 1}`);
    });
  });

  test("a guide opened beside the page fills in as its steps arrive", async () => {
    const tab = await dash.open();
    await closing(tab, async () => {
      const guide = dash.ask("Where do I issue a card?");
      dash.step(guide, 0, "Cards", "Open Cards in the sidebar.");
      await tab.locator("li", { hasText: "Where do I issue a card?" }).first().getByRole("button").click();
      const panel = tab.getByRole("dialog");
      await shows(panel, "Open Cards in the sidebar.");
      assert.match(tab.url(), new RegExp(`guide=${guide}`), "the address holds the guide, so the link opens it for someone else");

      dash.step(guide, 1, "Issue card", "Press Issue card.", "/cards");
      await shows(panel, "Press Issue card.");
      dash.end(guide);
      await shows(panel, "Finished");
    });
  });

  test("a guide left alone reads Paused, and a new step brings it back", async () => {
    const tab = await dash.open();
    await closing(tab, async () => {
      const guide = dash.ask("Where do I freeze a card?");
      dash.step(guide, 0, "Cards", "Open Cards.");
      const row = tab.locator("li", { hasText: "Where do I freeze a card?" }).first();
      await shows(row, "Showing step 1");

      // They walk away. Nothing new for three minutes.
      dash.quietFor(guide, "3 minutes");
      await shows(row, "Paused at step 1");
      assert.equal(await row.locator("svg.text-pointer").count(), 0, "no pointer on a guide nobody may be following");
      assert.equal(await row.locator(".shimmer").count(), 0, "and nothing moving");

      // They come back and click.
      dash.step(guide, 1, "Freeze", "Press Freeze.", "/cards/1");
      await shows(row, "Showing step 2");
      dash.end(guide);
      await shows(row, "Finished");
    });
  });

  test("only the pages that show questions ask what is new", async () => {
    for (const [view, asks] of [["overview", true], ["questions", true], ["knowledge", false], ["settings", false]] as const) {
      const tab = await dash.open(`/dashboard/?site=${SITE}&view=${view}`);
      await closing(tab, async () => {
        await tab.waitForTimeout(2000);
        const from = dash.calls.length;
        await tab.waitForTimeout(4000);
        const asked = dash.calls.slice(from).filter((call) => call.path.endsWith("/live")).length;
        if (asks) assert.ok(asked >= 2, `${view} should keep asking what is new, and asked ${asked} times in four seconds`);
        else assert.equal(asked, 0, `${view} shows no questions, and asked what is new ${asked} times`);
      });
    }
  });

  test("the list of pages stays where it is when the page scrolls, and nothing hidden makes the page longer", async () => {
    const tab = await dash.open();
    await closing(tab, async () => {
      await tab.locator('[data-metric="Guides finished"]').waitFor();
      // The page is only as long as it will be once its lists have their rows. Until then there is nothing to scroll.
      await eventually(() => tab.evaluate(() => document.scrollingElement!.scrollHeight > window.innerHeight + 200), "the overview should be long enough to scroll");
      const where = () =>
        tab.locator("aside").evaluate((el) => {
          const box = el.getBoundingClientRect();
          return { top: Math.round(box.top), bottom: Math.round(box.bottom) };
        });
      const start = await where();
      assert.equal(start.bottom, 900, "the list of pages reaches the foot of the window");

      // Straight to the foot of the page, which is where the list of pages used to slide up.
      await tab.evaluate(() => window.scrollTo({ top: document.scrollingElement!.scrollHeight, behavior: "instant" }));
      await eventually(() => tab.evaluate(() => window.scrollY > 100), "the page should have scrolled");
      assert.deepEqual(await where(), start, "the list of pages moved with the page");

      // The chart's table for screen readers once made the page 39px longer than what was on it, and far more on 90 days.
      for (const days of ["90 days", "30 days"]) {
        await tab.getByRole("button", { name: days }).click();
        await tab.waitForTimeout(1500);
        const extra = await tab.evaluate(() => document.scrollingElement!.scrollHeight - Math.round(document.body.getBoundingClientRect().height));
        assert.ok(extra <= 1, `on ${days} the page is ${extra}px longer than what is on it`);
      }
    });
  });

  test("the list of sites puts the running one first, with its own icon", async () => {
    const tab = await dash.open("/dashboard/?view=sites");
    await closing(tab, async () => {
      const cards = tab.locator("main ul > li");
      await cards.first().getByText("questions in the last 7 days").waitFor({ timeout: 10_000 });
      assert.equal(await cards.count(), 2);
      assert.match(await cards.nth(1).innerText(), /Waiting for the script/);
      // Both sites are called Northpine, as two new sites of one company are, so each card says which address it is.
      assert.ok((await cards.first().innerText()).includes(new URL(dash.siteOrigin).host), "two sites with one name should each show their address");
      // No icon at /favicon.ico, so the page asks what the site's first page declares, and shows that.
      await eventually(
        () => cards.first().locator("img").evaluate((img: HTMLImageElement) => img.src.endsWith("/icon.svg") && img.complete && img.naturalWidth >= 8).catch(() => false),
        "the running site's own icon should load",
        15_000,
      );
    });
  });

  test("Match website gives the Ask button the site's colour and leaves the pointer blue", async () => {
    const tab = await dash.open(`/dashboard/?site=${SITE}&view=settings`);
    await closing(tab, async () => {
      await tab.getByRole("button", { name: "Match website" }).click();
      await tab.getByText(`Matched to ${BRAND}`).waitFor({ timeout: 15_000 });
      assert.equal(await tab.locator("#launcher").inputValue(), BRAND);
      assert.equal(await tab.locator("#accent").inputValue(), "#1E6EF4");
      const { appearance } = await dash.site();
      assert.equal(appearance.launcher, BRAND, "saved in the one press");
      assert.equal(appearance.accent, "#1E6EF4", "the pointer's colour is not touched");
    });
  });

  test("renaming a site changes its name in the bar, and its address goes once the name is its own", async () => {
    const tab = await dash.open(`/dashboard/?site=${SITE}&view=settings`);
    await closing(tab, async () => {
      const host = new URL(dash.siteOrigin).host;
      const crumb = tab.getByRole("button", { name: /^Site, / });
      await crumb.waitFor();
      assert.ok((await crumb.innerText()).includes(host), "two sites share the name, so the bar says which");

      await tab.locator("#site-name").fill("Northpine app");
      await tab.getByRole("button", { name: "Rename" }).click();
      await tab.getByRole("button", { name: "Site, Northpine app. Choose another" }).waitFor({ timeout: 10_000 });
      assert.ok(!(await crumb.innerText()).includes(host), "the name is its own now, so the address is gone");
      assert.equal((await dash.site()).name, "Northpine app");
    });
  });

  test("suggested questions are saved from General settings, Haptic does it shows only where acting is on, and a bad list is refused", async () => {
    const tab = await dash.open(`/dashboard/?site=${SITE}&view=settings`);
    await closing(tab, async () => {
      const section = tab.locator("form", { has: tab.getByText("Suggested questions", { exact: true }) });
      await section.waitFor();
      const switches = section.getByRole("switch", { name: "Haptic does it" });
      assert.equal(await switches.count(), 3, "the running site has acting on, so each question has its switch");
      assert.equal(await switches.nth(0).isDisabled(), true, "a switch for an empty field can be pressed");
      await tab.locator("#suggestion-1").fill("  Lock my Team offsite card ");
      await tab.locator("#suggestion-2").fill("Who approves meals over $150?");
      await tab.locator("#suggestion-3").fill("Issue Malika a $500 virtual card");
      await switches.nth(2).click();
      await section.getByRole("button", { name: "Save questions" }).click();
      await section.getByText("Saved. The widget picks them up within a minute.").waitFor({ timeout: 10_000 });
      assert.deepEqual((await dash.site()).suggestions, [
        { text: "Lock my Team offsite card" },
        { text: "Who approves meals over $150?" },
        { text: "Issue Malika a $500 virtual card", act: true },
      ]);
      assert.equal(await tab.locator("#suggestion-1").inputValue(), "Lock my Team offsite card", "the field shows the words as saved");

      // A repeat is refused by the server, under the field at fault, and nothing changes.
      await tab.locator("#suggestion-2").fill("lock my team offsite card");
      await section.getByRole("button", { name: "Save questions" }).click();
      await section.getByText("This is the same as another suggested question.").waitFor({ timeout: 10_000 });
      assert.equal(await tab.locator("#suggestion-2").getAttribute("aria-invalid"), "true");
      assert.equal((await dash.site()).suggestions[1].text, "Who approves meals over $150?");

      // So are more than three, and words too long or on two lines, sent straight to the server.
      // Written without a named function inside, which the test runner's build would wrap in a helper the page does not have.
      const refused = await tab.evaluate(
        ([id, lists]) =>
          Promise.all(
            lists.map((suggestions) =>
              fetch(`/api/app/sites/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ suggestions }) }).then(async (response) => [
                response.status,
                (await response.json()).field,
              ]),
            ),
          ),
        [SITE, [[{ text: "One" }, { text: "Two" }, { text: "Three" }, { text: "Four" }], [{ text: "One" }, { text: "x".repeat(61) }], [{ text: "One\ntwo" }]]] as const,
      );
      assert.deepEqual(refused, [[400, "suggestions.3"], [400, "suggestions.1"], [400, "suggestions.0"]]);
      assert.equal((await dash.site()).suggestions.length, 3, "a refused list changed what was saved");
    });
    const off = await dash.open(`/dashboard/?site=${WAITING}&view=settings`);
    await closing(off, async () => {
      await off.locator("#suggestion-1").waitFor();
      assert.equal(await off.getByRole("switch").count(), 0, "a site with acting off shows Haptic does it");
    });
  });

  test("deleting a site leads to the list of sites, not into the one that is left", async () => {
    const tab = await dash.open(`/dashboard/?site=${WAITING}&view=settings`);
    await closing(tab, async () => {
      await tab.locator("#confirm-delete").fill("staging.northpine.example");
      await tab.getByRole("button", { name: "Delete site" }).click();
      await tab.waitForURL(/[?&]view=sites/, { timeout: 10_000 });
      await tab.getByRole("heading", { name: "Sites" }).waitFor();
      await eventually(async () => (await tab.locator("main ul > li").count()) === 1, "one site should be left on the list");
    });
  });
});
