import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chips, HAS_WEB, labels, openSetup, ORIGIN, SITE, siteState, startFlow, toggle, type Flow, type State } from "./setup-harness.ts";

// The setup screens, end to end in a browser against a stand-in Worker that
// keeps what is saved: what "Never touch" saves, changing the address, a save
// that fails, and what Enter may press.

let state: State = siteState();
const blockedSaves = () => state.calls.filter((call) => call.path.endsWith("/blocked"));

describe("the setup screens in chromium", { skip: HAS_WEB ? false : "web/node_modules is not installed" }, () => {
  let flow: Flow;
  before(async () => {
    flow = await startFlow(() => state);
  });
  after(async () => {
    await flow?.close();
  });

  describe("Enter", () => {
    test("Enter never allows an address: that takes a click", async () => {
      state = siteState({ setup: { step: "connect" }, origins: [{ origin: "http://localhost:3000", allowed: false, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), requests: 1 }] });
      const page = await openSetup(flow);
      await page.getByRole("button", { name: "Allow this address" }).waitFor();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(700);
      assert.deepEqual(state.calls.filter((call) => call.method === "PATCH"), [], "Enter sent nothing");
      await page.getByRole("button", { name: "Allow this address" }).click();
      await page.getByRole("heading", { name: /Haptic is live/ }).waitFor();
      assert.deepEqual((state.calls.find((call) => call.method === "PATCH")?.body as { allowedOrigins: string[] }).allowedOrigins, ["https://app.example.com", "http://localhost:3000"]);
      await page.close();
    });
  });

  describe("when saving where the setup is fails", () => {
    test("every screen says so, with Try again, and Try again saves it", async () => {
      state = siteState();
      state.fail["PUT /sites/site_a1b2c3d4e5f6/setup"] = 500;
      const page = await openSetup(flow);
      await page.getByRole("button", { name: "Skip" }).click();
      await page.getByRole("heading", { name: "Add the script" }).waitFor();
      const alert = page.getByRole("alert").filter({ hasText: "Couldn't save where you are" });
      await alert.waitFor();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { name: "See it connect" }).waitFor();
      await alert.waitFor();
      delete state.fail["PUT /sites/site_a1b2c3d4e5f6/setup"];
      await alert.getByRole("button", { name: "Try again" }).click();
      await alert.waitFor({ state: "detached" });
      assert.equal(state.site.setup?.step, "connect");
      await page.close();
    });

    test("Finish later still leaves for the dashboard, which is told not to send them back", async () => {
      state = siteState({ setup: { step: "install" } });
      state.fail["PUT /sites/site_a1b2c3d4e5f6/setup"] = 500;
      const page = await openSetup(flow);
      await page.getByRole("button", { name: "Finish later" }).first().click();
      await page.waitForFunction(() => (window as unknown as { __navigations: string[] }).__navigations.length > 0);
      assert.deepEqual(await page.evaluate(() => (window as unknown as { __navigations: string[] }).__navigations), ["push /dashboard/?site=site_a1b2c3d4e5f6&later=1"]);
      await page.close();
    });
  });

  describe("changing the address", () => {
    const deletes = () => state.calls.filter((call) => call.method === "DELETE");

    test("Back to the address and a new one changes the site in place, and never deletes it", async () => {
      state = siteState({ setup: { step: "reading" }, notes: "Keep me", blocked: [{ label: "Delete" }] });
      const page = await openSetup(flow);
      await page.getByRole("button", { name: "Back", exact: true }).click();
      const field = page.getByLabel("Your app's address");
      await field.fill("www.example.com");
      await page.keyboard.press("Enter");
      await page.getByRole("heading", { name: "Reading your site" }).waitFor();
      assert.deepEqual(deletes(), []);
      assert.ok(state.calls.some((call) => call.method === "PUT" && call.path.endsWith("/address") && (call.body as { url: string }).url === "https://www.example.com/"));
      assert.equal(state.calls.filter((call) => call.method === "POST" && call.path === "/sites").length, 0, "no second site");
      assert.equal(state.site.origin, "https://www.example.com");
      assert.equal(state.site.notes, "Keep me");
      assert.ok(await page.getByText("www.example.com", { exact: false }).first().isVisible());
      await page.close();
    });

    test("when the address can't change, the person is told why, and the site is left as it was", async () => {
      state = siteState({ setup: { step: "reading" } });
      state.fail[`PUT /sites/site_a1b2c3d4e5f6/address`] = 409;
      const page = await openSetup(flow);
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.getByLabel("Your app's address").fill("www.example.com");
      await page.keyboard.press("Enter");
      await page.getByRole("alert").getByText("The server failed on purpose.").waitFor();
      await page.waitForTimeout(3500);
      assert.equal(await page.getByLabel("Your app's address").inputValue(), "www.example.com", "still on the address, with what they typed");
      assert.deepEqual(deletes(), []);
      assert.equal(state.site.origin, "https://app.example.com");
      await page.close();
    });

    test("pages still being read from the old address are stopped, never shown, and the new address is read", async () => {
      const reading = (read: number, done: boolean, titles: string[]) => ({
        read, max: 30, done, failed: 0, thin: 0, via: "browser", controls: 0, signIn: 0, risky: [],
        pages: titles.map((title, index) => ({ path: index ? `/${title.split(" ").pop()}` : "/", title, controls: 9 })),
      });
      state = siteState({ setup: { step: "reading" }, reading: reading(1, false, ["Old site home"]) });
      // The old address's next batch: finished, with the old site's pages, and slow, so it is still on its way when the address changes.
      let release = () => {};
      const slow = new Promise<void>((resolve) => (release = resolve));
      state.reply = (method, path) => {
        if (path !== `/sites/${SITE}/read`) return undefined;
        if (state.site.origin === ORIGIN) return slow.then(() => [200, reading(3, true, ["Old site home", "Old site pricing", "Old site docs"])]);
        return Promise.resolve([200, reading(2, true, ["New site home", "New site start"])]);
      };
      const reads = () => state.calls.filter((call) => call.path === `/sites/${SITE}/read`);
      const page = await openSetup(flow);
      await page.waitForFunction(() => document.body.textContent?.includes("Old site home"));
      assert.equal(reads().length, 1, "the old address's batch is on its way");

      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.getByLabel("Your app's address").fill("www.other-product.example");
      await page.keyboard.press("Enter");
      await page.getByText("public pages of www.other-product.example").waitFor();
      // From here on, anything from the old site on the screen is noted.
      // A string, as tsx would otherwise name the function with a helper the page doesn't have.
      await page.evaluate(`{
        const seen = (window.__old = []);
        const look = () => document.body.textContent.includes("Old site") && seen.push(document.body.textContent);
        look();
        new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true });
      }`);
      release();
      await page.waitForTimeout(1500);
      assert.deepEqual(await page.evaluate(() => (window as unknown as { __old: string[] }).__old), [], "nothing from the old site shows");
      await page.getByText("New site start").waitFor({ timeout: 5000 });
      assert.equal(reads()[0]?.aborted, true, "the old address's read was stopped");
      const changed = state.calls.findIndex((call) => call.method === "PUT" && call.path.endsWith("/address"));
      assert.ok(reads().some((call) => state.calls.indexOf(call) > changed), "the new address was read");
      await page.close();
    });
  });

  describe("Never touch saves what the screen shows", () => {
    test("Continue with everything ticked, come Back, untick two, Continue: those two are no longer ruled out", async () => {
      state = siteState();
      const page = await openSetup(flow);
      assert.deepEqual(await chips(page), ["[x] Delete project", "[x] Billing", "[x] Cancel subscription", "[x] Delete", "[x] Pay", "[x] Transfer ownership", "[x] Change billing"]);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { name: "Add the script" }).waitFor();
      assert.deepEqual(labels(state.site.blocked), ["Billing", "Cancel subscription", "Change billing", "Delete", "Delete project", "Pay", "Transfer ownership"]);

      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.getByRole("heading", { name: "Here's what Haptic learned" }).waitFor();
      await toggle(page, "Delete project");
      await toggle(page, "Pay");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { name: "Add the script" }).waitFor();
      assert.deepEqual(labels(state.site.blocked), ["Billing", "Cancel subscription", "Change billing", "Delete", "Transfer ownership"]);
      await page.close();
    });

    test("untick two, Continue, come Back: they show unticked, and Continue again leaves them allowed", async () => {
      state = siteState();
      const page = await openSetup(flow);
      await toggle(page, "Pay");
      await toggle(page, "Billing");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { name: "Add the script" }).waitFor();
      assert.deepEqual(labels(state.site.blocked), ["Cancel subscription", "Change billing", "Delete", "Delete project", "Transfer ownership"]);

      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.getByRole("heading", { name: "Here's what Haptic learned" }).waitFor();
      assert.deepEqual(await chips(page), ["[x] Delete project", "[ ] Billing", "[x] Cancel subscription", "[x] Delete", "[ ] Pay", "[x] Transfer ownership", "[x] Change billing"]);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { name: "Add the script" }).waitFor();
      assert.deepEqual(labels(state.site.blocked), ["Cancel subscription", "Change billing", "Delete", "Delete project", "Transfer ownership"]);
      await page.close();
    });

    test("a site that already rules out only Delete, reloaded on this screen: it shows just that ticked, and Enter adds nothing", async () => {
      state = siteState({ blocked: [{ label: "Delete" }] });
      const page = await openSetup(flow);
      assert.deepEqual(await chips(page), ["[ ] Delete project", "[ ] Billing", "[ ] Cancel subscription", "[x] Delete", "[ ] Pay", "[ ] Transfer ownership", "[ ] Change billing"]);
      await page.keyboard.press("Enter");
      await page.getByRole("heading", { name: "Add the script" }).waitFor();
      assert.deepEqual(labels(state.site.blocked), ["Delete"]);
      await page.close();
    });

    test("what the owner ruled out elsewhere, and not suggested here, is left alone", async () => {
      state = siteState({ blocked: [{ label: "Archive workspace" }, { role: "button", label: "Delete project" }] });
      const page = await openSetup(flow);
      await toggle(page, "Delete project");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { name: "Add the script" }).waitFor();
      assert.deepEqual(labels(state.site.blocked), ["Archive workspace"]);
      assert.equal(blockedSaves().length, 1);
      await page.close();
    });

    test("Skip saves nothing", async () => {
      state = siteState();
      const page = await openSetup(flow);
      await page.getByRole("button", { name: "Skip" }).click();
      await page.getByRole("heading", { name: "Add the script" }).waitFor();
      assert.equal(blockedSaves().length, 0);
      assert.deepEqual(state.site.blocked, []);
      await page.close();
    });
  });
});
