import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chips, HAS_WEB, labels, openSetup, siteState, startFlow, toggle, type Flow, type State } from "./setup-harness.ts";

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
