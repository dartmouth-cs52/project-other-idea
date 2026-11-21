import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// Opens a real site in a visible browser with the widget injected, so you can
// try Haptic on a product you don't control. The site needs a context first:
//
//   npm run dev
//   npm run tag -- --url https://app.example.com --id site_example --name Example --allow https://app.example.com
//   npx tsx eval/live.ts https://app.example.com site_example
//
// The tag is added on every page load (a full reload would otherwise drop it),
// and the page's Content Security Policy is ignored, since most real apps
// would block a script from localhost. The browser keeps a profile in
// eval/.profile, so sign in once and stay signed in for later runs.
// Every request the widget sends is saved under eval/results/live/, as raw
// material for eval cases: add the expected target by hand to keep one.

const [url, site] = process.argv.slice(2);
if (!url || !site) {
  console.error("Usage: npx tsx eval/live.ts <url> <site id>");
  process.exit(1);
}
const HOST = process.env.HAPTIC_PUBLIC_URL || "http://localhost:4000";
const OUT = `eval/results/live/${site}-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const context = await chromium.launchPersistentContext("eval/.profile", {
  headless: false,
  bypassCSP: true,
  viewport: null,
  // Chrome stops a public site (github.com) from calling localhost unless the
  // visitor allows it. Real visitors load the widget from a public host, so
  // only this local setup needs the check off.
  args: ["--start-maximized", "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"],
});

// A string, not a function: tsx compiles functions with an esbuild helper
// (__name) that doesn't exist in the page, and the injection would throw.
await context.addInitScript(`(() => {
  if (window.top !== window) return;
  function add() {
    if (document.querySelector("script[data-haptic-live]")) return;
    const script = document.createElement("script");
    script.src = ${JSON.stringify(`${HOST}/widget.js`)};
    script.dataset.site = ${JSON.stringify(site)};
    script.dataset.hapticLive = "";
    document.body.appendChild(script);
  }
  if (document.body) add();
  else document.addEventListener("DOMContentLoaded", add, { once: true });
})();`);

let saved = 0;
await mkdir(OUT, { recursive: true });
context.on("request", async (request) => {
  if (!request.url().endsWith("/v1/turn") || request.method() !== "POST") return;
  const body = request.postDataJSON();
  const file = `${OUT}/${String(++saved).padStart(3, "0")}.json`;
  await writeFile(file, JSON.stringify({ page: request.frame().url(), request: body }, null, 1) + "\n");
  console.log(`turn ${saved} (step ${body.step}): "${body.goal}" on ${request.frame().url()} (${body.snapshot?.elements?.length ?? "?"} elements) -> ${file}`);
});
context.on("console", (message) => {
  if (message.text().includes("[Haptic]")) console.log(message.text());
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(url);
console.log(`Open on ${url}. Click "Ask" in the corner. Close the browser window to stop.`);
await new Promise((resolve) => context.on("close", resolve));
console.log(`${saved} turns saved to ${OUT}`);
