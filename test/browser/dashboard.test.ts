import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { BrowserContext, Locator, Page } from "playwright";
import { launcherColour } from "../../src/shared/colour.ts";
import { DEFAULT_APPEARANCE } from "../../src/shared/types.ts";
import { BRAND, COMPANY, NO_SITE_COMPANY, ONE_SITE, ONE_SITE_COMPANY, SETTING_UP, SETTING_UP_COMPANY, SITE, SKIP, WAITING, startDashboard, stayLocal, type Dashboard } from "./dashboard-harness.ts";
import { widgetBundle } from "./harness.ts";

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

  test("a guide opened and closed leaves no step for Back to land on, and Back still closes one", async () => {
    const tab = await dash.open("/dashboard/?view=sites");
    await closing(tab, async () => {
      const where = () => new URL(tab.url()).search;
      const card = tab.locator("main ul > li").first();
      await card.getByText("questions in the last 7 days").waitFor({ timeout: 15_000 });
      await card.getByRole("link").click();
      const rows = tab.locator("section", { hasText: "Latest questions" }).locator("li button");
      await rows.first().waitFor({ timeout: 15_000 });
      const site = where();
      const panel = tab.getByRole("dialog");
      // Each guide closed with Escape or the panel's close button once left a step that Back landed on, on this same page.
      for (const close of ["Escape", "Close"] as const) {
        await rows.first().click();
        await panel.waitFor();
        assert.match(where(), /[?&]guide=/);
        if (close === "Escape") await tab.keyboard.press("Escape");
        else await panel.getByRole("button", { name: "Close" }).click();
        await panel.waitFor({ state: "detached" });
        assert.equal(where(), site, `closing with ${close} should leave the site's page as it was`);
      }
      // Back while a guide is open closes it, and stays on the site's page.
      await rows.first().click();
      await panel.waitFor();
      await tab.goBack();
      await panel.waitFor({ state: "detached" });
      assert.equal(where(), site);
      // The next Back goes back to the list the site was opened from.
      await tab.goBack();
      await tab.waitForURL(/[?&]view=sites/, { timeout: 10_000 });
    });
  });

  test("a guide that came in the address closes in place, adding nothing to Back", async () => {
    const tab = await dash.open(`/dashboard/?site=${SITE}&guide=00000000-0000-4000-8000-000000000040`);
    await closing(tab, async () => {
      const panel = tab.getByRole("dialog");
      await panel.waitFor({ timeout: 15_000 });
      const steps = await tab.evaluate(() => history.length);
      await tab.keyboard.press("Escape");
      await panel.waitFor({ state: "detached" });
      // Nothing to take back here: going back would leave the dashboard.
      assert.equal(new URL(tab.url()).search, `?site=${SITE}`);
      assert.equal(await tab.evaluate(() => history.length), steps);
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

  test("the bar across the top and the list of pages stay where they are, together, when the page scrolls, and nothing hidden makes the page longer", async () => {
    const tab = await dash.open();
    await closing(tab, async () => {
      await tab.locator('[data-metric="Guides finished"]').waitFor();
      // The page is only as long as it will be once its lists have their rows. Until then there is nothing to scroll.
      await eventually(() => tab.evaluate(() => document.scrollingElement!.scrollHeight > window.innerHeight + 200), "the overview should be long enough to scroll");
      const where = () =>
        tab.evaluate(() =>
          ["header", "aside"].map((selector) => {
            const el = document.querySelector(selector)!;
            const box = el.getBoundingClientRect();
            return { top: Math.round(box.top), bottom: Math.round(box.bottom), position: getComputedStyle(el).position };
          }),
        );
      const start = await where();
      const [bar, list] = start;
      assert.equal(list!.bottom, 900, "the list of pages reaches the foot of the window");
      assert.equal(list!.top, bar!.bottom, "the list of pages starts where the bar ends");
      // A Mac's trackpad pulls the whole page past its top or foot and lets it spring back. That moves what scrolls with
      // the page and not what is fixed to the window: the bar, sticky, slid down over Overview and left a gap above it,
      // while the list of pages, fixed, stayed. Fixed alike, nothing that moves the page parts them. Chromium on Linux
      // draws no such pull, so how each is held is what can be checked here.
      assert.deepEqual(start.map((box) => box.position), ["fixed", "fixed"], "the bar and the list of pages should both be fixed to the window");

      // Straight to the foot of the page, which is where the list of pages used to slide up.
      await tab.evaluate(() => window.scrollTo({ top: document.scrollingElement!.scrollHeight, behavior: "instant" }));
      await eventually(() => tab.evaluate(() => window.scrollY > 100), "the page should have scrolled");
      assert.deepEqual(await where(), start, "the bar or the list of pages moved with the page");

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

  test("the list of sites says when it can't load, with Try again, and says Reconnecting once its cards are in", async () => {
    const tab = await dash.open("/sign-in/");
    await closing(tab, async () => {
      const list = /\/api\/app\/sites\?/;
      const cards = tab.locator("main ul > li");
      // It once kept its placeholders for good.
      await tab.route(list, (route) => route.fulfill({ status: 500, json: { error: "Something went wrong on our side. Try again in a moment." } }));
      await tab.goto(`${dash.url}/dashboard/?view=sites`);
      const failed = tab.getByRole("heading", { name: "Your sites didn't load" });
      await failed.waitFor({ timeout: 15_000 });
      assert.equal(await tab.locator('[data-slot="skeleton"]').count(), 0, "no placeholders once it has said it couldn't load");

      await tab.unroute(list);
      await tab.getByRole("button", { name: "Try again" }).click();
      await cards.first().getByText("questions in the last 7 days").waitFor({ timeout: 15_000 });
      assert.equal(await failed.count(), 0);

      // The cards stay while the list can't reach the server, and the page says it is reconnecting until it can.
      await tab.route(list, (route) => route.abort("failed"));
      await tab.getByText("Reconnecting").waitFor({ timeout: 15_000 });
      assert.equal(await cards.count(), 2);
      await tab.unroute(list);
      await tab.getByText("Reconnecting").waitFor({ state: "detached", timeout: 15_000 });
    });
  });

  test("a site's Ask button takes its website's colour on its own, and the pointer stays blue and is not a setting", async () => {
    // As a site added a moment ago: nothing read from it yet.
    dash.forgetLauncher();
    const tab = await dash.open(`/dashboard/?site=${SITE}&view=settings`);
    await closing(tab, async () => {
      const field = tab.locator("#launcher");
      await field.waitFor();
      // Read in the background after the page asked for the site, and shown here when it is in, with no reload.
      await eventually(async () => (await field.inputValue()) === BRAND, `the Ask button's colour should become the website's ${BRAND}`, 15_000);
      await tab.getByText("Matched to your website's colour when the site was added.").waitFor();
      assert.equal(await tab.locator("#accent").count(), 0, "there is no pointer colour to set");
      assert.equal(await tab.locator("[data-preview-launcher]").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(23, 99, 58)");
      const { appearance, launcherMatch } = await dash.site();
      assert.deepEqual({ launcher: appearance.launcher, accent: appearance.accent, source: launcherMatch.source }, { launcher: BRAND, accent: "#1E6EF4", source: "matched" });
    });
  });

  test("a colour too light to see is saved darker, and Match website reads the website's again", async () => {
    const tab = await dash.open(`/dashboard/?site=${SITE}&view=settings`);
    await closing(tab, async () => {
      const field = tab.locator("#launcher");
      await field.waitFor();
      await field.fill("#FACC15");
      const darker = launcherColour("#FACC15");
      await tab.getByText(`so it is drawn darker, as ${darker}`).waitFor();
      await tab.getByRole("button", { name: "Save changes" }).click();
      await tab.getByText("Saved.").waitFor();
      assert.equal(await field.inputValue(), darker, "what is saved is what is drawn");
      const chosen = await dash.site();
      assert.deepEqual({ launcher: chosen.appearance.launcher, source: chosen.launcherMatch.source }, { launcher: darker, source: "chosen" });

      await tab.getByRole("button", { name: "Match website" }).click();
      await tab.getByText(`Matched to ${BRAND}, your website's colour.`).waitFor({ timeout: 15_000 });
      assert.equal(await field.inputValue(), BRAND);
      assert.equal((await dash.site()).appearance.launcher, BRAND, "saved in the one press");
    });
  });

  test("a light colour saved before colours were darkened shows as visitors see it, darker, and is not read over", async () => {
    dash.saveOldLauncher("#FACC15");
    const tab = await dash.open(`/dashboard/?site=${SITE}&view=settings`);
    await closing(tab, async () => {
      const field = tab.locator("#launcher");
      await field.waitFor();
      assert.equal(await field.inputValue(), launcherColour("#FACC15"), "the field shows the colour visitors see");
      // Saved before matching existed, so it counts as a person's choice and is not read from the site.
      await tab.waitForTimeout(2500);
      assert.equal(await field.inputValue(), launcherColour("#FACC15"));
    });
  });

  test("the Overview says how often questions come up again, and turns answering from routes on", async () => {
    const tab = await dash.open();
    await closing(tab, async () => {
      const card = tab.locator("section", { hasText: "Questions asked again" });
      await card.waitFor({ timeout: 15_000 });
      const mode = (name: string) => card.getByRole("button", { name });
      assert.equal(await mode("Watch only").getAttribute("aria-pressed"), "true", "a site starts out watching");
      await mode("Answer from routes").click();
      await eventually(async () => (await mode("Answer from routes").getAttribute("aria-pressed")) === "true", "Answer from routes should be on");
      assert.equal((await dash.site()).routesMode, "serve");
      await mode("Watch only").click();
      await eventually(async () => (await dash.site()).routesMode === "shadow", "the site should be back to watching");
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

  describe("signing in and out", () => {
    test("Continue with Google that fails says so, and gives both ways to sign in back", async () => {
      const tab = await dash.open("/sign-in/");
      await closing(tab, async () => {
        const google = tab.getByRole("button", { name: "Continue with Google" });
        const link = tab.getByRole("button", { name: "Email me a sign-in link" });
        // Turned down by the server, turned down for too many tries as the Worker does it, never reaching it at all, and
        // an answer with no address to go to. The auth client throws for the first three and goes nowhere on the last,
        // and the page once said "Opening Google" for good after each of them.
        const answers = {
          server: { status: 500, json: { message: "Server error" } },
          busy: { status: 429, json: { message: "Too many tries. Wait a minute and try again.", code: "TOO_MANY_REQUESTS" } },
          nowhere: { status: 200, json: {} },
        };
        for (const [fail, says] of [
          ["server", "Couldn't open Google"],
          ["busy", "Too many tries"],
          ["network", "Couldn't open Google"],
          ["nowhere", "Couldn't open Google"],
        ] as const) {
          await tab.route("**/api/auth/sign-in/social", (route) => (fail === "network" ? route.abort("failed") : route.fulfill(answers[fail])));
          await google.click();
          await tab.getByRole("alert").filter({ hasText: says }).waitFor({ timeout: 5_000 });
          assert.ok((await google.isEnabled()) && (await link.isEnabled()), `after the ${fail} failure, both ways to sign in should work again`);
          assert.equal((await google.innerText()).trim(), "Continue with Google");
          await tab.unroute("**/api/auth/sign-in/social");
        }
      });
    });

    test("once a sign-in link is sent the focus moves to Check your email, and back to the field to use a different one", async () => {
      const tab = await dash.open("/sign-in/");
      await closing(tab, async () => {
        await tab.getByLabel("Work email").fill("ada@northpine.example");
        await tab.getByRole("button", { name: "Email me a sign-in link" }).click();
        const sent = tab.getByRole("heading", { name: "Check your email" });
        await sent.waitFor();
        await eventually(() => sent.evaluate((el) => el === document.activeElement), "the focus should be on Check your email, so a screen reader reads it");
        await tab.getByRole("button", { name: "Use a different email" }).click();
        await eventually(() => tab.getByLabel("Work email").evaluate((el) => el === document.activeElement), "the focus should be back in the email field");
      });
    });

    test("a sign-out that fails says the person is still signed in, in view, and Try again signs them out", async () => {
      // Sign out is in the bar's menu, which is there however far down a page the person is, and on two buttons of
      // pages that have no menu yet. The auth client throws when the call fails, and each of them once did nothing.
      const places = [
        { from: "the bar's menu, far down a site's page", path: `/dashboard/?site=${SITE}`, company: COMPANY, fail: "server", button: "Sign out" },
        { from: "the setup screens, before the company has a site", path: "/dashboard/setup/", company: NO_SITE_COMPANY, fail: "network", button: "Sign out" },
        { from: "the card for an account that isn't approved", path: "/dashboard/", company: COMPANY, fail: "server", button: "Use a different account" },
      ] as const;
      for (const place of places) {
        const tab = await dash.open(place.path, undefined, place.company);
        await closing(tab, async () => {
          if (place.button === "Use a different account") {
            await tab.route("**/api/app/me", (route) => route.fulfill({ json: { user: { email: "eve@elsewhere.example", name: "Eve" }, approved: false, reason: "not_approved" } }));
            await tab.reload();
          }
          await tab.route("**/api/auth/sign-out", (route) => (place.fail === "network" ? route.abort("failed") : route.fulfill({ status: 500, json: { message: "Server error" } })));
          const before = tab.url();
          if (place.path.includes("site=")) {
            await tab.locator('[data-metric="Guides finished"]').waitFor({ timeout: 15_000 });
            await eventually(() => tab.evaluate(() => document.scrollingElement!.scrollHeight > window.innerHeight + 200), "the overview should be long enough to scroll");
            await tab.evaluate(() => window.scrollTo({ top: document.scrollingElement!.scrollHeight, behavior: "instant" }));
            await tab.getByRole("button", { name: "Account" }).click();
            await tab.getByRole("menuitem", { name: "Sign out" }).click();
          } else {
            await tab.getByRole("button", { name: place.button }).click();
          }
          const alert = tab.getByRole("alert").filter({ hasText: "Couldn't sign you out" });
          await alert.waitFor({ timeout: 5_000 });
          assert.equal(tab.url(), before, `from ${place.from}, the page should stay`);
          assert.match(await alert.innerText(), /You are still signed in/);
          // The page scrolls smoothly, so this can take a moment.
          await eventually(
            () =>
              alert.evaluate((el) => {
                const box = el.getBoundingClientRect();
                return box.top >= 0 && box.bottom <= window.innerHeight;
              }),
            `from ${place.from}, what it says should come into view`,
          );
          await tab.unroute("**/api/auth/sign-out");
          await alert.getByRole("button", { name: "Try again" }).click();
          await tab.waitForURL("**/sign-in/", { timeout: 10_000 });
        });
      }
    });
  });

  describe("when the session ends", () => {
    /**
     * The session ends, from signing out in another tab or being away too long: the Worker turns every call away, and
     * the session itself says no one is signed in. The Worker turns calls away when it can't reach Neon Auth too, and
     * the page tells the two apart by asking the session. `calls` narrows which calls are turned away.
     */
    const endSession = async (tab: Page, calls = "**/api/app/**") => {
      await tab.route(calls, (route) => route.fulfill({ status: 401, json: { error: "Sign in first." } }));
      await tab.route("**/api/auth/get-session**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
    };
    /** Signed in again in another tab, which signs in every tab, since they share the cookie. */
    const signInAgain = async (tab: Page) => {
      await tab.unroute("**/api/app/**");
      await tab.unroute("**/api/auth/get-session**");
    };

    test("a page open when the session ends goes to sign in, from a page that keeps itself current and from a press", async () => {
      // Questions asks what is new every second and a half. Settings asks for nothing until a button is pressed. Both
      // once said "Sign in first." with a Try again that was turned away the same way, again and again.
      for (const view of ["questions", "settings"] as const) {
        const tab = await dash.open(`/dashboard/?site=${SITE}&view=${view}`);
        await closing(tab, async () => {
          if (view === "questions") await tab.getByRole("table").getByText("How do I issue a new card?").first().waitFor({ timeout: 15_000 });
          else await tab.getByRole("button", { name: "Match website" }).waitFor({ timeout: 15_000 });
          const steps = await tab.evaluate(() => history.length);
          await endSession(tab);
          if (view === "settings") await tab.getByRole("button", { name: "Match website" }).click();
          await tab.waitForURL("**/sign-in/", { timeout: 10_000 });
          await tab.getByRole("heading", { name: "Sign in to Haptic." }).waitFor();
          assert.equal(await tab.evaluate(() => history.length), steps, "the sign-in page should take the dashboard's place, so Back doesn't return to it");
        });
      }
    });

    test("notes and a help doc being written when the session ends stay, the page says so, and notes save once signed in again", async () => {
      // Notes run to 20,000 characters, and a help doc can be a whole article pasted in. They once went with the page
      // the first time anything on it was turned away, by a save or by Knowledge's own asking every fifteen seconds,
      // and Back couldn't bring them back.
      const tab = await dash.open(`/dashboard/?site=${SITE}&view=knowledge`);
      await closing(tab, async () => {
        const notes = tab.getByLabel("Notes");
        const save = tab.getByRole("button", { name: "Save notes" });
        await save.waitFor({ timeout: 15_000 });
        const draft = "Invoices are under Billing, not Settings. A workspace is what other tools call a team.";
        await notes.fill(draft);
        const at = tab.url();
        await endSession(tab);

        // Nothing pressed: the page's own asking finds the session gone.
        const notice = tab.getByRole("alert").filter({ has: tab.getByRole("link", { name: "Sign in again" }) });
        await notice.waitFor({ timeout: 20_000 });
        assert.match(await notice.innerText(), /You were signed out/);
        assert.equal(tab.url(), at, "the page should stay");
        assert.equal(await notes.inputValue(), draft, "what was typed should still be there");
        assert.equal(await notice.getByRole("link").getAttribute("target"), "_blank", "signing in again should leave this page as it is");

        // Save says the same, and keeps what was typed.
        await save.click();
        const failed = tab.getByRole("alert").filter({ hasText: "Couldn't save your notes" });
        await failed.waitFor({ timeout: 5_000 });
        assert.match(await failed.innerText(), /You were signed out/);
        assert.equal(tab.url(), at);
        assert.equal(await notes.inputValue(), draft);

        // Signed in again, the same press saves them, and the page stops saying it was signed out.
        await signInAgain(tab);
        await save.click();
        await tab.getByText("Saved. Haptic reads them within a minute.").waitFor({ timeout: 10_000 });
        await notice.waitFor({ state: "detached" });
        assert.equal((await dash.site()).notes, draft);

        // A help doc being added is kept the same way, when the session ends again.
        await endSession(tab);
        const doc = tab.getByLabel("Address of a help article");
        await doc.fill("https://help.northpine.example/billing");
        await tab.locator("form", { has: doc }).getByRole("button", { name: "Add", exact: true }).click();
        const notAdded = tab.getByRole("alert").filter({ hasText: "Couldn't add the doc" });
        await notAdded.waitFor({ timeout: 5_000 });
        assert.match(await notAdded.innerText(), /You were signed out/);
        assert.equal(tab.url(), at);
        assert.equal(await doc.inputValue(), "https://help.northpine.example/billing");
      });
    });

    test("a tab opened for teaching or mapping after the session ended closes as the page goes to sign in", async () => {
      // Teach Haptic and Start mapping open their tab at the click, since a browser blocks one opened after a wait, and
      // close it when the server says no. A page going to sign in never hears back, and the tab was once left open and
      // blank in front of it.
      for (const how of ["teaching", "mapping"] as const) {
        const tab = await dash.open(`/dashboard/?site=${SITE}${how === "teaching" ? "&view=knowledge" : ""}`);
        await closing(tab, async () => {
          if (how === "teaching") {
            await tab.getByRole("button", { name: "Teach Haptic a task" }).click({ timeout: 15_000 });
            await tab.getByLabel("What should Haptic learn to do?").fill("how do I add a budget");
            await endSession(tab);
          } else {
            await tab.getByRole("button", { name: "Start mapping" }).waitFor({ timeout: 15_000 });
            // The Overview asks what is new every second and a half, so only this call is turned away, or the page
            // could go to sign in before the button is pressed.
            await endSession(tab, "**/api/app/sites/*/map");
          }
          const opened = tab.context().waitForEvent("page");
          await tab.getByRole("button", { name: how === "teaching" ? "Start teaching" : "Start mapping" }).click();
          const blank = await opened;
          await tab.waitForURL("**/sign-in/", { timeout: 10_000 });
          await eventually(async () => blank.isClosed(), `the tab opened for ${how} should close with the page`, 5_000);
        });
      }
    });

    test("a call turned away while the session is still there doesn't send anyone to sign in", async () => {
      // The Worker answers 401 when it can't hear from Neon Auth as well as when no one is signed in. One such answer to
      // the page's asking once sent a person who was still signed in to sign in again.
      const tab = await dash.open();
      await closing(tab, async () => {
        await tab.locator('[data-metric="Guides finished"]').waitFor({ timeout: 15_000 });
        const at = tab.url();
        let asked = 0;
        await tab.route("**/api/app/sites/*/live", (route) => (asked++ === 0 ? route.fulfill({ status: 401, json: { error: "Sign in first." } }) : route.fallback()));
        await eventually(async () => asked > 2, "the page should go on asking what is new");
        assert.equal(tab.url(), at, "the page should stay where it is");
      });
    });

    test("a sign-in link that didn't work lands on the sign-in page, which says why", async () => {
      const tab = await dash.open("/sign-in/");
      await closing(tab, async () => {
        await endSession(tab);
        await tab.goto(`${dash.url}/dashboard/?view=sites&error=INVALID_TOKEN`);
        await tab.waitForURL("**/sign-in/?error=INVALID_TOKEN", { timeout: 10_000 });
        await tab.getByText("That sign-in link no longer works").waitFor();
      });
    });
  });

  describe("when a call fails", () => {
    test("the setup screens say when who is signed in can't be found out, and Try again carries on", async () => {
      // A company with no site yet, on the first screen, and one part way through, with its site loaded. Both once
      // said "Loading" for good.
      for (const [company, path] of [
        [NO_SITE_COMPANY, "/dashboard/setup/"],
        [SETTING_UP_COMPANY, `/dashboard/setup/?site=${SETTING_UP}`],
      ] as const) {
        const tab = await dash.open("/sign-in/", undefined, company);
        await closing(tab, async () => {
          await tab.route("**/api/app/me", (route) => route.fulfill({ status: 500, json: { error: "Something went wrong on our side. Try again in a moment." } }));
          await tab.goto(`${dash.url}${path}`);
          await tab.getByRole("heading", { name: "Something went wrong" }).waitFor({ timeout: 10_000 });
          assert.match(await tab.locator("main").innerText(), /Something went wrong on our side/, `${path} should say why`);
          await tab.unroute("**/api/app/me");
          await tab.getByRole("button", { name: "Try again" }).click();
          if (company === NO_SITE_COMPANY) await tab.getByLabel("Your app's address").waitFor({ timeout: 10_000 });
          else await tab.getByRole("heading", { name: "Add the script" }).waitFor({ timeout: 10_000 });
        });
      }
    });

    test("a session check that fails doesn't hold the dashboard or the setup screens where they start", async () => {
      // The auth client throws when its check fails, and both pages once waited on it for good, at "Signing you in" and
      // "Loading". Signed in all the same, they carry on.
      for (const [company, path] of [
        [COMPANY, "/dashboard/?view=sites"],
        [NO_SITE_COMPANY, "/dashboard/setup/"],
      ] as const) {
        const tab = await dash.open("/sign-in/", undefined, company);
        await closing(tab, async () => {
          await tab.route("**/api/auth/get-session**", (route) => route.fulfill({ status: 500, json: { message: "Server error" } }));
          await tab.goto(`${dash.url}${path}`);
          if (company === NO_SITE_COMPANY) await tab.getByLabel("Your app's address").waitFor({ timeout: 10_000 });
          else await tab.locator("main ul > li").first().getByText("questions in the last 7 days").waitFor({ timeout: 10_000 });
        });
      }
    });
  });

  describe("where signing in lands", () => {
    const SITES = "/dashboard/?view=sites";
    const where = (tab: Page) => new URL(tab.url()).pathname + new URL(tab.url()).search;
    /** Whether the page asked for the site's own record since call `from`, which only opening the site does. The list asks only for its icon. */
    const opened = (id: string, from: number) => dash.calls.slice(from).some((call) => call.method === "GET" && call.path === `/api/app/sites/${id}`);

    test("an emailed link and Google are both asked to come back to the list of sites", async () => {
      const from = dash.auth.length;
      const tab = await dash.open("/sign-in/");
      await closing(tab, async () => {
        await tab.getByLabel("Work email").fill("ada@northpine.example");
        await tab.getByRole("button", { name: "Email me a sign-in link" }).click();
        await tab.getByRole("heading", { name: "Check your email" }).waitFor();
        await tab.getByRole("button", { name: "Use a different email" }).click();
        await tab.getByRole("button", { name: "Continue with Google" }).click();
        await eventually(async () => dash.auth.slice(from).some((call) => call.path.endsWith("/sign-in/social")), "Google should have been asked for");
        assert.deepEqual(
          dash.auth.slice(from).filter((call) => call.path.includes("/sign-in/")).map(({ path, body }) => ({ path, body })),
          [
            { path: "/api/auth/sign-in/magic-link", body: { email: "ada@northpine.example", callbackURL: `${dash.url}${SITES}` } },
            { path: "/api/auth/sign-in/social", body: { provider: "google", callbackURL: `${dash.url}${SITES}` } },
          ],
        );
      });
    });

    test("with one site, the list is where sign-in lands, and the site opens from its card", async () => {
      const from = dash.calls.length;
      const tab = await dash.open(SITES, undefined, ONE_SITE_COMPANY);
      await closing(tab, async () => {
        const cards = tab.locator("main ul > li");
        await cards.first().getByText("questions in the last 7 days").waitFor({ timeout: 10_000 });
        assert.equal(await cards.count(), 1);
        assert.equal(opened(ONE_SITE, from), false, "the one site is not opened by itself");
        await cards.first().getByRole("link").click();
        await tab.locator('[data-metric="Guides finished"]').waitFor({ timeout: 10_000 });
        assert.equal(where(tab), `/dashboard/?site=${ONE_SITE}`);
      });
    });

    test("with one site, an address that names no site is the list too, and stays the list", async () => {
      for (const address of ["/dashboard/", "/dashboard/?view=questions"]) {
        const from = dash.calls.length;
        const tab = await dash.open(address, undefined, ONE_SITE_COMPANY);
        await closing(tab, async () => {
          await tab.getByRole("heading", { name: "Sites" }).waitFor({ timeout: 10_000 });
          await tab.locator("main ul > li").first().getByText("questions in the last 7 days").waitFor({ timeout: 10_000 });
          await tab.waitForTimeout(1000);
          assert.equal(where(tab), address, `${address} should stay where it is`);
          assert.equal(opened(ONE_SITE, from), false, `${address} should not open the company's only site`);
        });
      }
    });

    test("a site part way through setup goes back to its setup screen when it is opened, and not before", async () => {
      for (const address of [SITES, "/dashboard/"]) {
        const tab = await dash.open(address, undefined, SETTING_UP_COMPANY);
        await closing(tab, async () => {
          const card = tab.locator("main ul > li").first();
          await card.getByText("Waiting for the script").waitFor({ timeout: 10_000 });
          await tab.waitForTimeout(1000);
          assert.equal(where(tab), address, `${address} should stay on the list`);
          await card.getByRole("link").click();
          await tab.waitForURL(`**/dashboard/setup/?site=${SETTING_UP}`, { timeout: 10_000 });
          await tab.getByRole("heading", { name: "Add the script" }).waitFor({ timeout: 10_000 });
        });
      }
    });

    test("a company with no site yet still goes to the setup screens", async () => {
      for (const address of [SITES, "/dashboard/"]) {
        const tab = await dash.open(address, undefined, NO_SITE_COMPANY);
        await closing(tab, async () => {
          await tab.waitForURL("**/dashboard/setup/", { timeout: 10_000 });
          await tab.getByLabel("Your app's address").waitFor({ timeout: 10_000 });
        });
      }
    });
  });

  describe("on a phone, and with long names", () => {
    const PHONE = { width: 375, height: 667 };
    const SMALLEST = { width: 320, height: 640 };

    /**
     * A new tab on a page, as `dash.open` opens one, at `size`: a touch screen when `touch` is set, and with `prepare`
     * run on its context before the page loads, such as to answer a call the harness doesn't serve.
     */
    async function openOn(path: string, size: { width: number; height: number }, options: { company?: string; touch?: boolean; prepare?: (context: BrowserContext) => Promise<unknown> } = {}): Promise<Page> {
      const context = await dash.browser.newContext({ viewport: size, isMobile: options.touch ?? false, hasTouch: options.touch ?? false });
      await stayLocal(context);
      await context.addCookies([{ name: "company", value: options.company ?? COMPANY, url: dash.url }]);
      await options.prepare?.(context);
      const tab = await context.newPage();
      await tab.goto(`${dash.url}${path}`);
      await tab.locator("header").first().waitFor({ timeout: 10_000 });
      return tab;
    }

    /** How far the page reaches past the right edge of what can be seen. On a phone that zooms a page out to fit it, the window grows with it, so this measures against the page's own width. */
    const sideways = (tab: Page) => tab.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth);

    /** The innermost part of the page with this heading. */
    const part = (tab: Page, heading: string | RegExp) => tab.locator("section", { has: tab.getByRole("heading", { name: heading, exact: typeof heading === "string" }) }).last();

    /** Answers the page's asking for a site's record with the record as `change` makes it, such as with a long address. */
    const siteAs = (id: string, change: (site: Record<string, any>) => Record<string, unknown>) => (context: BrowserContext) =>
      context.route(`${dash.url}/api/app/sites/${id}`, async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        try {
          const site = await (await route.fetch()).json();
          await route.fulfill({ json: { ...site, ...change(site) } });
        } catch {
          // The tab closed while the page was still asking.
        }
      });

    /** A site's record once its script has called from `origin`, which it allows, a moment ago. */
    const liveOn = (origin: string) => {
      const now = new Date().toISOString();
      return { origin, allowedOrigins: [origin], connected: true, origins: [{ origin, allowed: true, first_seen_at: now, last_seen_at: now, requests: 3 }] };
    };

    test("the Questions page can be read on a phone: a question wraps, with how it ended and when under it", async () => {
      const question = "How do I change the billing address on an invoice I already sent to a customer last month?";
      dash.end(dash.ask(question));
      const tab = await openOn(`/dashboard/?site=${SITE}&view=questions`, PHONE);
      await closing(tab, async () => {
        const row = tab.locator("main tbody tr", { hasText: question });
        await row.waitFor({ timeout: 10_000 });
        const shown = await row.evaluate((tr) => {
          const words = tr.querySelector("button")!;
          const table = tr.closest('[data-slot="table-container"]')!;
          return {
            cut: words.scrollWidth > words.clientWidth + 1,
            lines: Math.round(words.getBoundingClientRect().height / parseFloat(getComputedStyle(words).lineHeight)),
            share: words.getBoundingClientRect().width / table.clientWidth,
            wider: table.scrollWidth - table.clientWidth,
          };
        });
        // The question once had 50px of a 375px phone, and showed "How d…".
        assert.equal(shown.cut, false, "the question is cut off");
        assert.ok(shown.lines >= 2, "a long question goes on to a second line");
        assert.ok(shown.share > 0.75, `the question has ${Math.round(shown.share * 100)}% of the table's width`);
        assert.ok(shown.wider <= 1, `the table is ${shown.wider}px wider than its card, which pushed When out of it`);
        assert.match(await row.innerText(), /Finished\s+just now/, "how it ended and when are under the question");
        assert.ok((await sideways(tab)) <= 0, "the page scrolls sideways");
      });
    });

    test("the month on the Usage tab, and the prompt to copy by hand, are 16px on a phone, so iOS doesn't zoom in on them", async () => {
      for (const [size, font] of [[PHONE, "16px"], [{ width: 1280, height: 800 }, "14px"]] as const) {
        const tab = await openOn(`/dashboard/?site=${SITE}&view=settings&tab=usage`, size);
        await closing(tab, async () => {
          const month = tab.getByLabel("Month");
          await month.waitFor({ timeout: 10_000 });
          assert.equal(await month.evaluate((element) => getComputedStyle(element).fontSize), font, `at ${size.width}px wide`);
        });
      }
      // The box shows when the browser won't copy, here with no clipboard and no older copy command either.
      const tab = await openOn(`/install/?site=${SITE}`, PHONE, {
        prepare: (context) =>
          context.addInitScript({
            content: `Object.defineProperty(navigator, "clipboard", { value: { writeText: function () { return Promise.reject(new DOMException("Denied", "NotAllowedError")); } } });
              document.execCommand = function () { return false; };`,
          }),
      });
      await closing(tab, async () => {
        await tab.getByRole("button", { name: /Onboard your agent/ }).click();
        const box = tab.getByRole("textbox", { name: "The prompt" });
        await box.waitFor({ timeout: 10_000 });
        assert.equal(await box.evaluate((element) => getComputedStyle(element).fontSize), "16px");
      });
    });

    test("what a number counts opens with a tap on a touch screen, from a mark 24px across, and still with the mouse over it", async () => {
      const tab = await openOn(`/dashboard/?site=${SITE}`, { width: 390, height: 844 }, { touch: true });
      await closing(tab, async () => {
        const mark = tab.getByRole("button", { name: "What guides finished counts" });
        await mark.waitFor({ timeout: 10_000 });
        const box = (await mark.boundingBox())!;
        assert.ok(box.width >= 24 && box.height >= 24, `what a finger has to press is ${box.width}x${box.height}px`);
        const about = tab.getByText("Guides where the person reached the end.");
        await mark.tap();
        await about.waitFor({ timeout: 5_000 });
        await mark.tap();
        await about.waitFor({ state: "hidden", timeout: 5_000 });
      });
      const laptop = await openOn(`/dashboard/?site=${SITE}`, { width: 1280, height: 800 });
      await closing(laptop, async () => {
        await laptop.getByRole("button", { name: "What guides finished counts" }).hover();
        await laptop.getByText("Guides where the person reached the end.").waitFor({ timeout: 5_000 });
      });
    });

    test("How guides ended keeps its bars wide enough to compare, on a phone and in the Overview's narrow column on a laptop", async () => {
      for (const size of [PHONE, { width: 1024, height: 768 }, { width: 1280, height: 800 }]) {
        const tab = await openOn(`/dashboard/?site=${SITE}`, size);
        await closing(tab, async () => {
          const endings = part(tab, "How guides ended");
          await endings.locator("li").first().waitFor({ timeout: 10_000 });
          // The track each share is drawn on. They were 5px wide on a phone and none at all on a 1024px laptop.
          const widths = await endings.locator("li > span.block").evaluateAll((bars) => bars.map((bar) => Math.round(bar.getBoundingClientRect().width)));
          assert.ok(widths.length > 0, "no bars");
          assert.ok(Math.min(...widths) >= 120, `at ${size.width}px wide the bars are ${widths.join(", ")}px`);
        });
      }
    });

    test("when the numbers don't load, the chart of guides each day says so, instead of holding its place for good", async () => {
      const tab = await openOn(`/dashboard/?site=${SITE}`, { width: 1280, height: 800 }, {
        prepare: (context) => context.route(/\/api\/app\/sites\/[^/]+\/metrics/, (route) => route.fulfill({ status: 500, json: { error: "Something went wrong on our side. Try again in a moment." } })),
      });
      await closing(tab, async () => {
        const chart = part(tab, /^Guides each day/);
        await chart.getByText("Something went wrong on our side.").waitFor({ timeout: 10_000 });
        assert.equal(await chart.locator('[data-slot="skeleton"]').count(), 0, "a block still holds the chart's place");
      });
    });

    /** A long address with no hyphen, the one place the browser would break it, so nothing but the page can let it wrap. */
    const LONG = "https://app.northpineenterprisesolutions.example";

    test("the last setup screen fits the smallest phone when the site's address is long", async () => {
      const tab = await openOn(`/dashboard/setup/?site=${SETTING_UP}`, SMALLEST, {
        company: SETTING_UP_COMPANY,
        // The site as it is once the script has called from its long address: the screen that says Haptic is live there.
        prepare: siteAs(SETTING_UP, () => ({ ...liveOn(LONG), setup: { step: "connect" } })),
      });
      await closing(tab, async () => {
        const heading = tab.getByRole("heading", { name: /^Haptic is live on/ });
        await heading.waitFor({ timeout: 10_000 });
        assert.ok((await sideways(tab)) <= 0, "the page scrolls sideways");
        assert.equal(await heading.evaluate((element) => element.scrollWidth <= element.clientWidth), true, "the heading runs past the screen");
        const open = (await tab.getByRole("link", { name: /^Open app\.northpine/ }).boundingBox())!;
        assert.ok(open.x + open.width <= SMALLEST.width - 24 + 1, `the link to the site ends at ${Math.round(open.x + open.width)}px`);
      });
    });

    test("the Overview of a site nobody has asked yet fits a phone, with its button to go and ask there on more lines when it must", async () => {
      // Where "Go to your dashboard" on the last setup screen leads: the site, once its script has called, still with no
      // questions. The button names the site's address, and with one as ordinary as app.northpine.example it ran past its
      // card on every phone.
      for (const size of [SMALLEST, PHONE, { width: 390, height: 844 }]) {
        const tab = await openOn(`/dashboard/?site=${SETTING_UP}`, size, { company: SETTING_UP_COMPANY, touch: size.width === 390, prepare: siteAs(SETTING_UP, (site) => liveOn(site.origin)) });
        await closing(tab, async () => {
          const ask = part(tab, "Your numbers start with the first question").getByRole("link", { name: /^Ask Haptic something on app\.northpine\.example/ });
          await ask.waitFor({ timeout: 10_000 });
          assert.ok((await sideways(tab)) <= 0, `at ${size.width}px wide the page scrolls sideways`);
          const shown = await ask.evaluate((link) => ({ inside: link.getBoundingClientRect().right <= link.closest("section")!.getBoundingClientRect().right, whole: link.scrollWidth <= link.clientWidth }));
          assert.equal(shown.inside, true, `at ${size.width}px wide the button runs past its card`);
          assert.equal(shown.whole, true, `at ${size.width}px wide the button's words are cut off`);
        });
      }
    });

    test("every other screen that names a site's long address fits the smallest phone too", async () => {
      const now = new Date().toISOString();
      // The script, seen on an address of the company's that the site doesn't allow.
      const refused = { origin: LONG.replace("app.", "staging."), allowed: false, first_seen_at: now, last_seen_at: now, requests: 1 };
      const screens: { name: string; path: string; site: (site: Record<string, any>) => Record<string, unknown>; ready: (tab: Page) => Locator }[] = [
        {
          // A site's own page before its script is seen where it should be, once its owner pressed Finish later:
          // "Finish adding Haptic to <host>", and the steps to add it, with the address to allow.
          name: "the card to finish setting it up",
          path: `/dashboard/?site=${SETTING_UP}`,
          site: () => ({ origin: LONG, allowedOrigins: [LONG], setup: { step: "install", later: true }, origins: [refused] }),
          ready: (tab) => tab.getByRole("heading", { name: /^Finish adding Haptic to/ }),
        },
        {
          name: "Reading your site",
          path: `/dashboard/setup/?site=${SETTING_UP}`,
          site: () => ({ origin: LONG, allowedOrigins: [LONG], setup: { step: "reading" } }),
          ready: (tab) => tab.getByRole("heading", { name: "Reading your site" }),
        },
        {
          name: "Here's what Haptic learned",
          path: `/dashboard/setup/?site=${SETTING_UP}`,
          site: () => ({ origin: LONG, allowedOrigins: [LONG], setup: { step: "learned" } }),
          ready: (tab) => tab.getByRole("heading", { name: "Here's what Haptic learned" }),
        },
        {
          // Where a running site's script has been seen, one of them an address it doesn't allow, and where it may run.
          name: "Settings, Install",
          path: `/dashboard/?site=${SETTING_UP}&view=settings&tab=install`,
          site: () => {
            const site = liveOn(LONG);
            return { ...site, origins: [...site.origins, refused] };
          },
          ready: (tab) => tab.getByRole("heading", { name: "Where Haptic may run" }),
        },
      ];
      const wide: string[] = [];
      for (const screen of screens) {
        const tab = await openOn(screen.path, SMALLEST, { company: SETTING_UP_COMPANY, prepare: siteAs(SETTING_UP, screen.site) });
        await closing(tab, async () => {
          await screen.ready(tab).waitFor({ timeout: 10_000 });
          const past = await sideways(tab);
          if (past > 0) wide.push(`${screen.name}, ${past}px`);
        });
      }
      assert.deepEqual(wide, [], "these screens scroll sideways");
    });

    test("the Approve page fits a phone when a name and an email are long, and its buttons still say whom they approve in full", async () => {
      const request = {
        name: "Alexandra Richardson-Montgomery",
        email: "alexandra.richardson-montgomery@northwind-traders.com",
        company: "Northwind Traders International",
        details: "",
        domain: "northwind-traders.com",
        domainAllowed: true,
        approved: { email: false, domain: false },
      };
      for (const size of [SMALLEST, PHONE, { width: 768, height: 1024 }]) {
        const tab = await openOn("/approve/?key=k&sig=s", size, { prepare: (context) => context.route(/\/api\/app\/approve\b/, (route) => route.fulfill({ json: request })) });
        await closing(tab, async () => {
          const buttons = [tab.getByRole("button", { name: `Approve ${request.email}` }), tab.getByRole("button", { name: `Approve everyone at ${request.domain}` })];
          await buttons[0]!.waitFor({ timeout: 10_000 });
          assert.ok((await sideways(tab)) <= 0, `at ${size.width}px wide the page scrolls sideways`);
          const card = (await tab.locator("main section").first().boundingBox())!;
          for (const button of buttons) {
            const box = (await button.boundingBox())!;
            assert.ok(box.x >= card.x && box.x + box.width <= card.x + card.width + 1, `at ${size.width}px wide a button runs out of its card`);
            assert.equal(await button.evaluate((element) => element.scrollWidth <= element.clientWidth), true, `at ${size.width}px wide a button's words are cut off`);
          }
        });
      }
    });

    test("on the smallest phone the site's bar keeps Sign in on one line, and the first feature demo keeps its buttons in its window", async () => {
      const tab = await openOn("/", SMALLEST);
      await closing(tab, async () => {
        const bar = tab.locator("header").first();
        const signIn = (await bar.getByRole("link", { name: "Sign in" }).boundingBox())!;
        assert.ok(signIn.height <= 24, `Sign in is ${signIn.height}px tall, on two lines`);
        assert.equal(await bar.getByRole("link", { name: "Haptic" }).count(), 1, "the pointer still says it is Haptic, to a screen reader");
        assert.ok((await sideways(tab)) <= 0, "the page scrolls sideways");
        const invite = tab.locator("[data-target=invite]").first();
        const inside = await invite.evaluate((button) => button.getBoundingClientRect().right <= button.closest('[role="img"]')!.getBoundingClientRect().right);
        assert.equal(inside, true, "Invite teammate is cut off by the demo's window");
      });
      // Where there is room, the name is beside the pointer.
      const wider = await openOn("/", PHONE);
      await closing(wider, async () => {
        const name = await wider.locator("header").first().getByText("Haptic", { exact: true }).boundingBox();
        assert.ok(name && name.width > 20, "the name is beside the pointer on a 375px phone");
      });
    });

    test("on a phone Haptic's own launcher keeps its corner of the public pages, with room under the footer's links", async () => {
      const { widget } = await widgetBundle();
      for (const path of ["/request-access/", "/sign-in/"]) {
        const tab = await openOn(path, { width: 390, height: 844 }, {
          touch: true,
          prepare: (context) =>
            // Haptic's widget, as widget.joinhaptic.com serves it to this site, answered here.
            context.route("https://widget.joinhaptic.com/**", (route) => {
              const { pathname } = new URL(route.request().url());
              if (pathname === "/widget.js") return route.fulfill({ contentType: "text/javascript", body: widget });
              if (pathname.startsWith("/v1/sites/")) return route.fulfill({ json: { name: "Haptic", appearance: DEFAULT_APPEARANCE } });
              return route.fulfill({ json: {} });
            }),
        });
        await closing(tab, async () => {
          const launcher = tab.locator("haptic-root .launcher");
          await launcher.waitFor({ timeout: 10_000 });
          // A footer link in the corner at the foot of the page sent it 44px up the side, over the request form's Company field.
          await eventually(async () => {
            const box = await launcher.boundingBox();
            return !!box && Math.abs(844 - (box.y + box.height) - 20) <= 1;
          }, `on ${path} the launcher should sit in its corner, 20px from the foot of the window`);
          await tab.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
          const under = await tab.evaluate(() => {
            const corner = document.querySelector("haptic-root")!.shadowRoot!.querySelector(".launcher")!.getBoundingClientRect();
            return Array.from(document.querySelectorAll("a[href], button, input, select, textarea"))
              .filter((element) => {
                const box = element.getBoundingClientRect();
                return box.width > 0 && box.right > corner.left && box.left < corner.right && box.bottom > corner.top && box.top < corner.bottom;
              })
              .map((element) => (element as HTMLElement).innerText || element.tagName);
          });
          assert.deepEqual(under, [], `at the foot of ${path} the launcher covers part of the page`);
        });
      }
    });

    test("an address that isn't on the site gets a page in the site's own frame, with the way home", async () => {
      // The Worker answers an address it has no file for with out/404.html and status 404 (wrangler.jsonc, worker/embedded.ts).
      const tab = await openOn("/404.html", PHONE);
      await closing(tab, async () => {
        await tab.getByRole("heading", { level: 1, name: "Page not found." }).waitFor({ timeout: 5_000 });
        assert.equal(await tab.title(), "Page not found, Haptic");
        assert.equal(await tab.getByRole("link", { name: "Go to the home page" }).getAttribute("href"), "/");
        assert.equal(await tab.locator("header").first().getByRole("link", { name: "Request access" }).count(), 1, "the bar with the call to action");
        assert.equal(await tab.locator("footer").getByRole("link", { name: "Privacy" }).count(), 1, "the footer");
        assert.ok((await sideways(tab)) <= 0, "the page scrolls sideways");
      });
    });

    test("Billing tells two sites with one name apart by their addresses, as the bar across the top does", async () => {
      // A new site is named after its company, so two can share a name.
      const sites = [
        { id: "site_dash_bill1", name: "Northpine", origin: "https://app.northpine.example", connected: true },
        { id: "site_dash_bill2", name: "Northpine", origin: "https://staging.northpine.example", connected: false },
      ];
      const start = new Date();
      start.setUTCDate(1);
      const billing = {
        ready: true,
        testMode: true,
        canManage: true,
        plan: { id: "early-access", name: "Early access" },
        subscription: null,
        hasCustomer: false,
        period: { start: start.toISOString(), end: new Date(start.getTime() + 30 * 86_400_000).toISOString(), kind: "month" },
        finished: 42,
        sent: 0,
        sites: [
          { id: sites[0]!.id, name: "Northpine", finished: 40 },
          { id: sites[1]!.id, name: "Northpine", finished: 2 },
        ],
        plans: [],
      };
      const me = { user: { email: "ada@northpine.example", name: "Ada Lovelace" }, approved: true, organization: { id: COMPANY, name: "Northpine", role: "owner" }, sites };
      const tab = await openOn("/dashboard/?view=billing", PHONE, {
        prepare: async (context) => {
          await context.route(/\/api\/app\/billing$/, (route) => route.fulfill({ json: billing }));
          await context.route(/\/api\/app\/me$/, (route) => route.fulfill({ json: me }));
        },
      });
      await closing(tab, async () => {
        const rows = part(tab, "Finished guides").locator("li");
        await eventually(async () => (await rows.allInnerTexts()).join(" ").includes("staging.northpine.example"), "each site's row should say its address");
        const [first, second] = await rows.allInnerTexts();
        assert.match(first!, /Northpine\s+app\.northpine\.example/);
        assert.match(second!, /Northpine\s+staging\.northpine\.example/);
      });
    });

    test("the links in the site's bar and footer are at least 24px each way, on a phone and a laptop", async () => {
      for (const size of [SMALLEST, { width: 1280, height: 800 }]) {
        const tab = await openOn("/", size);
        await closing(tab, async () => {
          const small = await tab.evaluate(() =>
            Array.from(document.querySelectorAll("header a, footer a"))
              .map((link) => ({ text: (link as HTMLElement).innerText.trim() || link.getAttribute("href"), box: link.getBoundingClientRect() }))
              .filter(({ box }) => box.width > 0 && (box.width < 24 || box.height < 24))
              .map(({ text, box }) => `${text} ${Math.round(box.width)}x${Math.round(box.height)}`),
          );
          assert.deepEqual(small, [], `at ${size.width}px wide these links are too small to press`);
        });
      }
    });
  });
});
