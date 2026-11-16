import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { after, before, describe, test } from "node:test";
import type { Browser, BrowserContext, Page } from "playwright";
import { createApp } from "../../src/server/app.ts";
import { MemoryTeachStore } from "../../src/server/teach.ts";
import { newTeachToken, type TaughtStep } from "../../src/shared/teach.ts";
import { DEFAULT_APPEARANCE, type SiteContext } from "../../src/shared/types.ts";
import { BROWSERS, launch, widgetBundle } from "./harness.ts";

// Teach mode in real browsers: the dashboard's link opens the app with a
// token in the fragment, the widget claims it with the real server code (an
// in-memory store in place of Neon), shows its bar, and records which
// controls the person uses across two pages and a dialog. Never what they type.

const SITE = "site_test";
const QUESTION = "how do I add a budget";

const shell = (body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Budgets</title></head><body>
  <nav aria-label="Main"><a href="/budgets">Budgets</a> <a href="/settings">Settings</a></nav>
  <main>${body}</main>
  <script src="/widget.js" data-site="${SITE}" async></script></body></html>`;

const BUDGETS = shell(`
  <h1>Budgets</h1>
  <button id="new" type="button">New budget</button>
  <button id="blank" type="button" style="width:40px;height:32px"></button>
  <button type="button">Email ana@example.com</button>
  <button type="button">Order 12345678</button>
  <table>
    <thead><tr><th>Name</th><th></th></tr></thead>
    <tbody>
      <tr><td><a href="/budgets/8812">Acme Corporation</a></td><td><button type="button">Edit</button></td></tr>
      <tr><td><a href="/budgets/8813">Globex Travel</a></td><td><button type="button">Edit</button></td></tr>
    </tbody>
  </table>
  <dialog id="dialog" aria-labelledby="dialog-title">
    <h2 id="dialog-title">New budget</h2>
    <label>Budget name <input id="name"></label>
    <label>Period <select id="period"><option>Monthly</option><option>Quarterly</option></select></label>
    <label><input type="checkbox" id="rollover"> Roll over</label>
    <div contenteditable="true" aria-label="Description" id="description" style="min-height:20px"></div>
    <button type="button" id="create">Create budget</button>
  </dialog>
  <script>
    document.getElementById("new").addEventListener("click", () => document.getElementById("dialog").showModal());
    document.getElementById("create").addEventListener("click", () => { document.getElementById("dialog").close(); location.href = "/budgets/8812"; });
  </script>`);

const DETAIL = shell(`<h1>Marketing</h1><button type="button">Add owner</button><button type="button">Share</button>`);

interface Rig {
  url: string;
  store: MemoryTeachStore;
  /** Moves the store's clock forward. */
  later(ms: number): void;
  /** Answers the next posts of the steps with a server error. */
  failDone: number;
  turns: number;
  close(): Promise<void>;
}

async function startRig(): Promise<Rig> {
  const widget = await widgetBundle();
  let shift = 0;
  const store = new MemoryTeachStore(() => Date.now() + shift);
  const rig: Rig = { url: "", store, later: (ms) => (shift += ms), failDone: 0, turns: 0, close: async () => {} };
  const site = (origin: string): SiteContext => ({
    version: 1,
    id: SITE,
    name: "Test",
    origin,
    allowedOrigins: [origin],
    appearance: DEFAULT_APPEARANCE,
    notes: "",
    docs: [],
    pages: [],
    source: { url: origin, maxPages: 1, docs: [] },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const app = createApp({
    loadSite: async (id) => (id === SITE ? site(rig.url) : undefined),
    widget: async () => widget,
    widgetMaxAge: 0,
    overLimit: () => false,
    teach: store,
  });
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? "/", rig.url);
    if (url.pathname === "/v1/turn") rig.turns++;
    if (url.pathname === "/v1/teach/done" && rig.failDone > 0) {
      rig.failDone--;
      return res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": rig.url }).end(JSON.stringify({ error: "Something went wrong." }));
    }
    if (url.pathname.startsWith("/v1/") || url.pathname === "/widget.js") {
      const request = new Request(url, {
        method: req.method,
        headers: Object.entries(req.headers).flatMap(([name, value]) => (typeof value === "string" ? [[name, value] as [string, string]] : [])),
        ...(req.method === "POST" ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: "half" } : {}),
      } as RequestInit);
      const response = await app(request, "127.0.0.1");
      if (response) {
        res.writeHead(response.status, Object.fromEntries(response.headers));
        return res.end(Buffer.from(await response.arrayBuffer()));
      }
    }
    const page = url.pathname === "/budgets" ? BUDGETS : url.pathname.startsWith("/budgets/") ? DETAIL : undefined;
    if (!page) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  rig.url = `http://localhost:${(server.address() as AddressInfo).port}`;
  rig.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return rig;
}

/** The teach bar's words, or null when there is no bar. */
async function bar(tab: Page): Promise<string | null> {
  return tab.evaluate(() => document.querySelector("haptic-teach")?.shadowRoot?.querySelector(".bar")?.textContent ?? null);
}

async function barSays(tab: Page, words: string | RegExp, ms = 5000) {
  const started = Date.now();
  let seen: string | null = null;
  while (Date.now() - started < ms) {
    seen = await bar(tab);
    if (seen && (typeof words === "string" ? seen.includes(words) : words.test(seen))) return;
    await tab.waitForTimeout(40);
  }
  assert.fail(`The bar never said ${words}. It said: ${seen}`);
}

const press = (tab: Page, button: string) => tab.locator(`haptic-teach .buttons button:text-is("${button}")`).click();

async function notice(tab: Page, ms = 5000): Promise<string> {
  await tab.waitForFunction(() => !!document.querySelector("haptic-teach-notice")?.shadowRoot?.querySelector(".notice"), undefined, { timeout: ms });
  return tab.evaluate(() => document.querySelector("haptic-teach-notice")!.shadowRoot!.querySelector(".notice p")!.textContent ?? "");
}

for (const name of BROWSERS) {
  describe(`teach mode in ${name}`, () => {
    let browser: Browser;
    let rig: Rig;
    before(async () => {
      browser = await launch(name);
      rig = await startRig();
    });
    after(async () => {
      await browser?.close();
      await rig?.close();
    });

    test("a valid token shows the bar, records a task across two pages and a dialog, and never what was typed", async () => {
      const token = await rig.store.create(SITE, QUESTION, newTeachToken());
      const context: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const tab = await context.newPage();
      await tab.goto(`${rig.url}/budgets#haptic-teach=${token}`);
      await barSays(tab, `Teaching Haptic: ${QUESTION}.`);
      await barSays(tab, "Do the task as a visitor would. Haptic records which controls you use, not what you type.");
      assert.equal(new URL(tab.url()).hash, "", "the token left the address bar");
      assert.equal(await tab.locator("haptic-root").count(), 0, "no guide while teaching");

      await tab.click("#new");
      await tab.locator("#name").pressSequentially("Groceries ana@example.com 4111 1111 1111 1111");
      await tab.selectOption("#period", "Quarterly");
      await tab.check("#rollover");
      await tab.locator("#description").pressSequentially("my private note 99887766");
      await barSays(tab, "5 steps");
      // The bar is still pressable with the page's own modal dialog open.
      await press(tab, "Undo last");
      await barSays(tab, "4 steps");
      await tab.click("#create");
      await tab.waitForURL(/\/budgets\/8812$/);
      // A new page: the same session carries on, with its steps.
      await barSays(tab, "5 steps. Last: Press Create budget");
      await press(tab, "Done");
      await barSays(tab, "Sent 5 steps");

      const steps = (await rig.store.stepsOf(token)) as TaughtStep[];
      assert.deepEqual(
        steps.map(({ kind, path, role, label, choice, dialog, commits }) => ({ kind, path, role, label, choice, dialog, commits })),
        [
          { kind: "press", path: "/budgets", role: "button", label: "New budget", choice: undefined, dialog: undefined, commits: undefined },
          { kind: "type", path: "/budgets", role: "textbox", label: "Budget name", choice: undefined, dialog: "New budget", commits: undefined },
          { kind: "choose", path: "/budgets", role: "select", label: "Period", choice: "Quarterly", dialog: "New budget", commits: undefined },
          { kind: "check", path: "/budgets", role: "checkbox", label: "Roll over", choice: undefined, dialog: "New budget", commits: undefined },
          { kind: "press", path: "/budgets", role: "button", label: "Create budget", choice: undefined, dialog: "New budget", commits: true },
        ],
      );
      const kept = JSON.stringify(steps);
      for (const typed of ["Groceries", "ana@", "4111", "private", "99887766"]) assert.ok(!kept.includes(typed), `nothing typed is kept: ${typed}`);
      assert.equal(rig.turns, 0, "teach mode never asks the model");
      assert.equal(await tab.evaluate(() => sessionStorage.getItem("haptic.teach")), null, "the tab forgets the session once it is sent");
      await context.close();
    });

    test("a control with no name is still a step, shown as an unnamed control, and a record's name and masked words are never kept", async () => {
      const token = await rig.store.create(SITE, "edit a budget", newTeachToken());
      const context = await browser.newContext();
      const tab = await context.newPage();
      await tab.goto(`${rig.url}/budgets#haptic-teach=${token}`);
      await barSays(tab, "No steps yet");
      await tab.click("#blank");
      await barSays(tab, "Last: Press an unnamed control on /budgets");
      await tab.click("text=Email ana@example.com");
      await tab.click("text=Order 12345678");
      await tab.locator("tr", { hasText: "Globex" }).locator("button").click();
      // A record's own link: its name is left out. The page then changes, and the session carries on.
      await tab.click("text=Acme Corporation");
      await tab.waitForURL(/\/budgets\/8812$/);
      await barSays(tab, "5 steps");
      await press(tab, "Done");
      await barSays(tab, "Sent 5 steps");
      const steps = (await rig.store.stepsOf(token))!;
      assert.deepEqual(
        steps.map(({ kind, role, label, row }) => ({ kind, role, label, row })),
        [
          { kind: "press", role: "button", label: "", row: undefined },
          { kind: "press", role: "button", label: "Email [email]", row: undefined },
          { kind: "press", role: "button", label: "Order [number]", row: undefined },
          { kind: "press", role: "button", label: "Edit", row: true },
          { kind: "press", role: "link", label: "", row: true },
        ],
      );
      const kept = JSON.stringify(steps);
      for (const hidden of ["ana@", "12345678", "Acme", "Globex"]) assert.ok(!kept.includes(hidden), `masked or left out: ${hidden}`);
      await context.close();
    });

    test("a failed post keeps the steps, says so with Retry, and survives a reload", async () => {
      const token = await rig.store.create(SITE, QUESTION, newTeachToken());
      const context = await browser.newContext();
      const tab = await context.newPage();
      await tab.goto(`${rig.url}/budgets#haptic-teach=${token}`);
      await barSays(tab, "No steps yet");
      await tab.click("#new");
      await barSays(tab, "1 step");
      await tab.keyboard.press("Escape");
      rig.failDone = 1;
      await press(tab, "Done");
      await barSays(tab, "The steps weren't sent.");
      await barSays(tab, "press Retry");
      assert.equal(await tab.locator('haptic-teach .buttons button:text-is("Retry")').count(), 1);
      assert.equal(await rig.store.stepsOf(token), undefined);
      await tab.reload();
      await barSays(tab, "1 step. Last: On /budgets, press New budget");
      await press(tab, "Done");
      await barSays(tab, "Sent 1 step");
      assert.equal((await rig.store.stepsOf(token))?.length, 1);
      await context.close();
    });

    test("an expired, used or unknown token shows a clear notice and no teach bar, and the guide starts as usual", async () => {
      const expired = await rig.store.create(SITE, QUESTION, newTeachToken());
      rig.later(31 * 60_000);
      const fresh = await rig.store.create(SITE, QUESTION, newTeachToken());
      const context = await browser.newContext();
      const tab = await context.newPage();

      await tab.goto(`${rig.url}/budgets#haptic-teach=${expired}`);
      assert.equal(await notice(tab), "This teaching link has expired. Start again from your Haptic dashboard.");
      assert.equal(await bar(tab), null, "no teach bar");
      await tab.waitForSelector("haptic-root", { state: "attached" });
      assert.equal(new URL(tab.url()).hash, "");

      // Claimed in one browser, then opened in another: single use.
      const first = await (await browser.newContext()).newPage();
      await first.goto(`${rig.url}/budgets#haptic-teach=${fresh}`);
      await barSays(first, "No steps yet");
      const other = await context.newPage();
      await other.goto(`${rig.url}/budgets#haptic-teach=${fresh}`);
      assert.equal(await notice(other), "This teaching link has already been used. Start again from your Haptic dashboard.");
      assert.equal(await bar(other), null);

      const unknown = await context.newPage();
      await unknown.goto(`${rig.url}/budgets#haptic-teach=${newTeachToken()}`);
      assert.equal(await notice(unknown), "This teaching link isn't valid for this site. Start again from your Haptic dashboard.");
      const cut = await context.newPage();
      await cut.goto(`${rig.url}/budgets#haptic-teach=abc`);
      assert.equal(await notice(cut), "This teaching link is incomplete. Start again from your Haptic dashboard.");
      assert.equal(rig.turns, 0);
      await first.context().close();
      await context.close();
    });

    test("Cancel ends the session for good", async () => {
      const token = await rig.store.create(SITE, QUESTION, newTeachToken());
      const context = await browser.newContext();
      const tab = await context.newPage();
      await tab.goto(`${rig.url}/budgets#haptic-teach=${token}`);
      await barSays(tab, "No steps yet");
      await press(tab, "Cancel");
      await tab.waitForFunction(() => !document.querySelector("haptic-teach"));
      const deadline = Date.now() + 3000;
      while (![...rig.store.sessions.values()].some((session) => session.cancelled) && Date.now() < deadline) await tab.waitForTimeout(30);
      await tab.reload();
      await tab.waitForSelector("haptic-root", { state: "attached" });
      assert.equal(await bar(tab), null, "a reload does not bring it back");
      await context.close();
    });
  });
}
