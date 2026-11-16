import assert from "node:assert/strict";
import { after, test } from "node:test";
import { DEFAULT_APPEARANCE, STREAM_TYPE, type TurnReply, type TurnRequest } from "../../src/shared/types.ts";
import { bundleWidget } from "../../src/widget/build.ts";
import { closeBrowser, sharedBrowser } from "./harness.ts";

after(closeBrowser);

// The widget on a page whose owner runs a strict content security policy, as
// large companies and governments do: scripts only from the addresses the
// owner names (Haptic's among them), no inline style at all, and Trusted
// Types, under which a string is never turned into markup. The owner allows
// Haptic's script and its requests; nothing else is relaxed for it.
//
// The page and Haptic are served from two addresses that do not exist, and
// both are answered here. Nothing leaves the machine and no model is called.

const PAGE = "https://app.policy.test";
const HAPTIC = "https://widget.policy.test";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Accept" };

// The page's own inline style is refused too, and is heard refused: the check that the policy's reports reach the test.
const HEAD = `<style>h1 { color: #b00 }</style>`;
const BODY = `<h1>Orders</h1><p>Your orders this month.</p><button id="export" type="button">Export</button>
  <script src="${HAPTIC}/widget.js" data-site="site_policy" async></script>`;

/** A policy that forbids inline style, and one that also requires Trusted Types. Both allow Haptic's script and requests. */
const POLICIES = {
  "no inline style": `default-src 'self'; script-src ${HAPTIC}; style-src 'self'; connect-src 'self' ${HAPTIC}; img-src 'self'`,
  "no inline style, and Trusted Types": `default-src 'self'; script-src ${HAPTIC}; style-src 'self'; connect-src 'self' ${HAPTIC}; img-src 'self'; require-trusted-types-for 'script'`,
};

interface Drawn {
  mounted: boolean;
  /** How the launcher is drawn: its height and background, which come only from the widget's stylesheet. */
  launcher?: { height: number; background: string; position: string };
}

for (const [name, policy] of Object.entries(POLICIES)) {
  test(`under a strict policy (${name}) the widget is drawn, asks, and points, and the policy reports nothing of it`, async () => {
    const browser = await sharedBrowser();
    // No bypassCSP: the page's policy is in force, as it is for a visitor.
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const widget = await bundleWidget();
    const asked: TurnRequest[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await context.route(`${HAPTIC}/**`, async (route: any) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
        if (path === "/widget.js") return route.fulfill({ status: 200, contentType: "text/javascript", headers: CORS, body: widget });
        if (path.startsWith("/v1/sites/")) return route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({ name: "Policy", appearance: DEFAULT_APPEARANCE }) });
        if (path === "/v1/turn") {
          const sent = request.postDataJSON() as TurnRequest;
          asked.push(sent);
          const exportButton = sent.snapshot.elements.find((element) => element.label === "Export");
          const reply: TurnReply = exportButton ? { target: exportButton.id, status: "continue", say: "Click Export." } : { target: null, status: "done", say: "Export is not on this page." };
          return route.fulfill({ status: 200, contentType: STREAM_TYPE, headers: CORS, body: `${JSON.stringify({ target: reply.target })}\n${JSON.stringify(reply)}\n` });
        }
        return route.fulfill({ status: 404, headers: CORS, body: "" });
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await context.route(`${PAGE}/**`, (route: any) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          headers: { "Content-Security-Policy": policy },
          body: `<!doctype html><html><head><meta charset="utf-8"><title>Orders</title>${HEAD}</head><body>${BODY}</body></html>`,
        }),
      );
      const page = await context.newPage();
      const violations: string[] = [];
      const warnings: string[] = [];
      // Every report the policy makes, heard from before the page's own scripts run.
      await page.exposeFunction("reportViolation", (line: string) => violations.push(line));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) =>
          (window as unknown as { reportViolation: (line: string) => void }).reportViolation(`${event.effectiveDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`),
        );
      });
      page.on("console", (message: { type: () => string; text: () => string }) => {
        if (message.type() === "warning" || message.type() === "error") warnings.push(message.text());
      });
      await page.goto(`${PAGE}/orders`);
      await page.waitForTimeout(1200);

      const drawn = (await page.evaluate(() => {
        const host = document.querySelector("haptic-root");
        const launcher = host?.shadowRoot?.querySelector(".launcher");
        if (!host || !launcher || !host.isConnected) return { mounted: false };
        const style = getComputedStyle(launcher);
        return { mounted: true, launcher: { height: launcher.getBoundingClientRect().height, background: style.backgroundColor, position: getComputedStyle(host).position } };
      })) as Drawn;
      assert.ok(drawn.mounted, `the widget did not mount. The console said: ${warnings.join(" | ") || "nothing"}`);
      assert.deepEqual(drawn.launcher, { height: 40, background: "rgb(28, 25, 23)", position: "fixed" }, "the launcher is not drawn with the widget's own styles");

      await page.locator("haptic-root .launcher").click();
      await page.locator("haptic-root .panel input").fill("how do I export my orders");
      await page.locator("haptic-root .panel input").press("Enter");
      for (const until = Date.now() + 10_000; !asked.length && Date.now() < until; ) await page.waitForTimeout(50);
      assert.equal(asked.length, 1, "the question never reached Haptic");
      await page.locator("haptic-root .cursor").waitFor({ state: "visible", timeout: 5000 });
      const shown = await page.evaluate(() => {
        const root = document.querySelector("haptic-root")!.shadowRoot!;
        const ring = root.querySelector(".ring") as HTMLElement;
        const caption = root.querySelector(".caption") as HTMLElement;
        const pointed = (document.querySelector("haptic-root") as Element & { pointedAt?: Element }).pointedAt;
        return {
          pointed: pointed?.id ?? null,
          ringBorder: getComputedStyle(ring).borderTopWidth,
          ringPosition: getComputedStyle(ring).position,
          caption: caption.hidden ? "" : (caption.querySelector("span")?.textContent ?? ""),
          captionBackground: getComputedStyle(caption).backgroundColor,
        };
      });
      assert.deepEqual(shown, { pointed: "export", ringBorder: "2px", ringPosition: "fixed", caption: "Click Export.", captionBackground: "rgb(28, 25, 23)" });
      assert.ok(violations.some((line) => line.startsWith("style-src-elem inline") && line.includes(PAGE)), `the page's own inline style was not reported: ${violations.join(" | ")}`);
      assert.deepEqual(violations.filter((line) => line.includes(HAPTIC)), [], "the policy reported something the widget did");
    } finally {
      await context.close();
    }
  });
}
