import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

// The dashboard's "Onboard your agent" pill and the email to a developer, the
// real components, in a real browser. Neither may ever seem to do nothing: a
// copy says it copied or shows the prompt to copy by hand, a link to an app
// says whether the app opened, and the email says it went or why not.
//
//   npm run test:browser
//   CHROMIUM_PATH=/path/to/chrome npm run test:browser   when Playwright's own build isn't installed
//
// Chromium only: the clipboard permissions it tests are Chromium's.

const root = fileURLToPath(new URL("../..", import.meta.url));
const web = `${root}web`;
const SITE = "site_test1234";
const runs = existsSync(`${web}/node_modules/react`);

let bundle = "";
let server: Server;
let base = "";
/** How the fake Worker answers the next email. */
let emailAnswer: { status: number; body: unknown } = { status: 200, body: { sent: true, to: "dev@example.com" } };
const emails: unknown[] = [];

async function components(): Promise<string> {
  const result = await build({
    stdin: {
      contents: `import { createElement } from "react";
        import { createRoot } from "react-dom/client";
        import { AgentPill } from "@/components/app/agent-pill";
        import { DeveloperEmail } from "@/components/app/developer-email";
        window.mount = (props) => createRoot(document.getElementById("root")).render(
          createElement("div", null, createElement(AgentPill, props.pill), createElement(DeveloperEmail, props.email)));`,
      resolveDir: web,
      loader: "tsx",
    },
    bundle: true,
    format: "iife",
    target: "es2020",
    write: false,
    jsx: "automatic",
    alias: { "@": web },
    nodePaths: [`${web}/node_modules`],
    define: { "process.env.NODE_ENV": '"production"' },
    // Next fills in process.env at build time. Here nothing reads more than NODE_ENV.
    banner: { js: 'var process = { env: { NODE_ENV: "production" } };' },
    logLevel: "error",
  });
  return result.outputFiles[0]!.text;
}

async function open(browser: Browser, options: { clipboard: "allowed" | "blocked" }): Promise<Page> {
  const context = await browser.newContext();
  if (options.clipboard === "allowed") await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  const page = await context.newPage();
  if (options.clipboard === "blocked") {
    // No permission and no older copy command either: the case where nothing can be copied for the person.
    // As text, so the test runner's helpers don't end up inside it.
    await page.addInitScript({
      content: `Object.defineProperty(navigator, "clipboard", { value: { writeText: function () { return Promise.reject(new DOMException("Denied", "NotAllowedError")); } } });
        document.execCommand = function () { return false; };`,
    });
  }
  await page.goto(`${base}/`);
  await page.evaluate(
    ({ site }) => (window as unknown as { mount(props: unknown): void }).mount({ pill: { siteId: site }, email: { siteId: site, installLink: `${location.origin}/install/?site=${site}` } }),
    { site: SITE },
  );
  await page.getByRole("button", { name: /Onboard your agent/ }).waitFor();
  return page;
}

const note = (page: Page) => page.locator("[data-pill-note]");

/** Opens the menu with a click and picks the agent with the keyboard, both real input, as a person's would be. */
async function openIn(page: Page, agent: string) {
  await page.getByRole("button", { name: "Open the prompt in an agent" }).click();
  await page.getByRole("menuitem", { name: `Open in ${agent}` }).focus();
  await page.keyboard.press("Enter");
}

describe("the agent pill and the developer email in chromium", { skip: runs ? false : "web/node_modules is not installed" }, () => {
  let browser: Browser;
  before(async () => {
    bundle = await components();
    server = createServer((request, response) => {
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        return response.end(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/components.js"></script></body></html>`);
      }
      if (request.url === "/components.js") {
        response.writeHead(200, { "content-type": "text/javascript" });
        return response.end(bundle);
      }
      if (request.method === "POST" && request.url === `/api/app/sites/${SITE}/developer-email`) {
        let text = "";
        request.on("data", (chunk) => (text += chunk));
        request.on("end", () => {
          emails.push(JSON.parse(text));
          response.writeHead(emailAnswer.status, { "content-type": "application/json" });
          response.end(JSON.stringify(emailAnswer.body));
        });
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Not found." }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  });
  after(async () => {
    await browser?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  test("pressing the pill copies the prompt and says so", async () => {
    const page = await open(browser, { clipboard: "allowed" });
    await page.getByRole("button", { name: /Onboard your agent/ }).click();
    await assert.doesNotReject(note(page).getByText("Copied. Paste it into Claude Code, Cursor or Codex").waitFor());
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `Add Haptic to this app. Fetch ${base}/install/${SITE}.md and follow it.`);
    assert.equal(await page.locator("[data-pill-label]").textContent(), "Paste to your agent");
    assert.equal(await page.locator("[data-prompt-box]").count(), 0, "nothing to copy by hand when the copy worked");
    await page.context().close();
  });

  test("when the browser won't copy, the prompt shows in a box with Select all, never nothing", async () => {
    const page = await open(browser, { clipboard: "blocked" });
    await page.getByRole("button", { name: /Onboard your agent/ }).click();
    await note(page).getByText("Your browser didn't let the page copy.").waitFor();
    const box = page.getByRole("textbox", { name: "The prompt" });
    assert.equal(await box.inputValue(), `Add Haptic to this app. Fetch ${base}/install/${SITE}.md and follow it.`);
    await page.getByRole("button", { name: "Select all" }).click();
    const selected = await box.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd));
    assert.equal(selected, await box.inputValue(), "the whole prompt is selected, ready to copy");
    await page.context().close();
  });

  test("a link that opens the app, which the page sees as losing focus, says it opened and that the prompt is copied", async () => {
    const page = await open(browser, { clipboard: "allowed" });
    await openIn(page, "Claude Code");
    await note(page).getByText("Opening Claude Code.").waitFor();
    // The computer handing the link to the app takes the focus from the browser.
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await note(page).getByText(/^Opened in Claude Code.*The prompt is also copied\.$/).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `Add Haptic to this app. Fetch ${base}/install/${SITE}.md and follow it.`);
    await page.context().close();
  });

  test("a link no app takes says the app didn't open, that the prompt is copied, and where to get the app", async () => {
    const page = await open(browser, { clipboard: "allowed" });
    await openIn(page, "Cursor");
    await note(page).getByText("Cursor didn't open. The prompt is copied, paste it into your agent.").waitFor({ timeout: 5_000 });
    assert.equal(await note(page).getByRole("link", { name: "Get Cursor" }).getAttribute("href"), "https://cursor.com/download");
    assert.equal(await page.evaluate(() => location.pathname), "/", "the page stayed where it was");
    await page.context().close();
  });

  test("a link no app takes, with copying blocked too, shows the prompt to copy by hand", async () => {
    const page = await open(browser, { clipboard: "blocked" });
    await openIn(page, "Codex");
    await note(page).getByText("Codex didn't open, and your browser didn't let the page copy.", { exact: false }).waitFor({ timeout: 5_000 });
    assert.equal(await page.getByRole("textbox", { name: "The prompt" }).count(), 1);
    await page.context().close();
  });

  test("the email says who it went to", async () => {
    emailAnswer = { status: 200, body: { sent: true, to: "dev@example.com" } };
    const page = await open(browser, { clipboard: "allowed" });
    await page.getByLabel("Email it to my developer").fill("Dev@Example.com");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByRole("status").filter({ hasText: "Sent to dev@example.com." }).waitFor();
    const sent = emails.at(-1) as { to: string; key: string };
    assert.equal(sent.to, "dev@example.com");
    assert.match(sent.key, /^[0-9a-f-]{36}$/, "one key per press, so a retry can't send twice");
    await page.context().close();
  });

  test("an email that fails says why, with the link to copy beside it", async () => {
    emailAnswer = { status: 502, body: { error: "The email service could not be reached. Copy the link and send it yourself." } };
    const page = await open(browser, { clipboard: "allowed" });
    await page.getByLabel("Email it to my developer").fill("dev@example.com");
    await page.getByRole("button", { name: "Send" }).click();
    const alert = page.getByRole("alert");
    await alert.getByText("The email didn't go out").waitFor();
    await alert.getByText("The email service could not be reached.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Copy the link instead" }).click();
    await page.getByRole("button", { name: "Copied" }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${base}/install/?site=${SITE}`);
    await page.context().close();
  });

  test("an address that isn't one is caught before anything is sent", async () => {
    const before = emails.length;
    const page = await open(browser, { clipboard: "allowed" });
    await page.getByLabel("Email it to my developer").fill("not an address");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByText("Enter a full email address, like name@company.com.").waitFor();
    assert.equal(emails.length, before);
    await page.context().close();
  });
});
