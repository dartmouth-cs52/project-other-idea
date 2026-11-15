import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { loadSite, SITES_DIR } from "../src/server/sites.ts";
import { DEFAULT_APPEARANCE, STREAM_TYPE, type SiteContext, type TurnReply, type TurnRequest } from "../src/shared/types.ts";
import { bundleWidget } from "../src/widget/build.ts";
import { CASES_DIR, type CaseFile } from "./cases.ts";
import type { Act, GuideSet, Reached } from "./guide.ts";

// What the recorder, the whole-guide runs and the look tool share: a browser
// with the real widget on a page, and a way to answer each step it asks for.
//
// The widget is this project's own build, handed to the page here, and every
// request it makes is answered here too. So a site needs no script tag, no
// entry on a server and no permission for its origin, and nothing is sent to
// the live server unless the answers are asked from it on purpose.
//
// It drives a browser with Playwright, which this project does not install.
// Add it for a run: npm install --no-save playwright && npx playwright install chromium

// Playwright is loaded by name at run time so that the project neither depends on it nor type-checks against it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Page = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Browser = any;

/** Where a site without the tag loads the widget from. Requests to it are answered here and never leave. */
const WIDGET_ORIGIN = "https://widget.joinhaptic.com";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Accept" };

/** A page load set off by the same click can start a moment after the widget asks. */
const LEAVING_GRACE_MS = 150;
/** Nobody asks a question the instant a page appears: opening the box and typing takes at least this long. */
const BEFORE_ASKING_MS = 1500;

/** Gives the answer to one step the widget asked for. */
export type Answer = (request: Omit<TurnRequest, "site">) => Promise<TurnReply> | TurnReply;

export async function launch(): Promise<Browser> {
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)("playwright"));
  } catch {
    throw new Error("Playwright isn't installed. Add it for this run: npm install --no-save playwright && npx playwright install chromium");
  }
  return chromium.launch();
}

/**
 * Script that runs in the page before its own: it adds the tag once the body
 * exists. It is built as text because a function handed to the browser would
 * arrive with this project's build helpers still in it.
 */
const addTag = (src: string, site: string) => `(() => {
  if (window.top !== window) return;
  const add = () => {
    const tag = document.createElement("script");
    tag.src = ${JSON.stringify(src)};
    tag.dataset.site = ${JSON.stringify(site)};
    document.body.append(tag);
  };
  if (document.body) add();
  else document.addEventListener("DOMContentLoaded", add);
})();`;

/**
 * The site's context: from data/sites when it is there, and otherwise from a
 * case file, where the recorder keeps a copy. That copy is put back in
 * data/sites, so a fresh checkout can run guides on a site it has never built.
 */
export async function siteFor(set: GuideSet): Promise<SiteContext | undefined> {
  const built = await loadSite(set.siteId);
  if (built) return built;
  for (const name of await readdir(CASES_DIR).catch(() => [])) {
    if (!name.endsWith(".json")) continue;
    const { site } = JSON.parse(await readFile(`${CASES_DIR}${name}`, "utf8")) as CaseFile;
    if (site.id !== set.siteId) continue;
    await mkdir(SITES_DIR, { recursive: true });
    await writeFile(`${SITES_DIR}${site.id}.json`, JSON.stringify(site, null, 2) + "\n");
    return site;
  }
  return undefined;
}

export async function loadGuideSet(name: string): Promise<GuideSet> {
  try {
    return (await import(`./guides/${name}.ts`)).default as GuideSet;
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_MODULE_NOT_FOUND") throw new Error(`There is no eval/guides/${name}.ts.`);
    throw error;
  }
}

export async function perform(page: Page, act: Act): Promise<void> {
  if ("click" in act) await page.locator(act.click).first().click();
  else if ("check" in act) await page.locator(act.check).first().check();
  else if ("select" in act) await page.locator(act.select[0]).first().selectOption({ label: act.select[1] });
  else if ("press" in act) await page.locator(act.press[0]).first().press(act.press[1]);
  else if ("hover" in act) await page.locator(act.hover).first().hover();
  else await page.locator(act.fill[0]).first().fill(act.fill[1]);
}

/** Clicks away whatever the site puts in front of a first-time visitor. Each is tried once and may not be there. */
async function dismiss(page: Page, selectors: string[] = []): Promise<void> {
  for (const selector of selectors) {
    try {
      await page.locator(selector).first().click({ timeout: 1500 });
    } catch {
      // Not shown this time.
    }
  }
}

export interface Opened {
  page: Page;
  close: () => Promise<void>;
}

/**
 * Opens a page of the site the way a visitor with Haptic installed would see
 * it: signed in if the site needs that, banners clicked away, the widget up.
 * `answer` is asked for every step.
 */
export async function open(browser: Browser, set: GuideSet, path: string, answer: Answer, site?: SiteContext): Promise<Opened> {
  // A site that forbids scripts from elsewhere would block the tag. Its owner would allow it; here the rule is set aside.
  const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1366, height: 800 } });
  const api = set.hasTag ? set.origin : WIDGET_ORIGIN;
  if (!set.hasTag) await context.addInitScript(addTag(`${api}/widget.js`, set.siteId));

  const widget = await widgetSource();
  await context.route(`${api}/widget.js`, (route: Page) => route.fulfill({ status: 200, contentType: "text/javascript", headers: CORS, body: widget }));
  await context.route(`${api}/v1/sites/**`, (route: Page) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({ name: site?.name ?? "", appearance: site?.appearance ?? DEFAULT_APPEARANCE }) }),
  );
  // A click that loads a new page leaves the old one alive until the new one
  // starts to arrive, and the widget may ask for a step from it in that time.
  // A real server has not answered by then, so the request dies with the page
  // and the widget asks again from the new one. Here an answer could come back
  // at once, and would be taken for a step the visitor never saw. So a step
  // asked from a page that is on its way out is left unanswered.
  const leaving = new WeakSet<object>();
  /** How many new documents each page has loaded. A hash or history change inside one document does not count. */
  const loads = new WeakMap<object, number>();
  context.on("page", (opened: Page) => {
    const isMain = (request: Page) => request.isNavigationRequest() && request.frame() === opened.mainFrame();
    opened.on("request", (request: Page) => isMain(request) && leaving.add(opened));
    opened.on("requestfailed", (request: Page) => isMain(request) && leaving.delete(opened));
    opened.on("framenavigated", (frame: Page) => {
      if (frame !== opened.mainFrame() || !leaving.has(opened)) return;
      leaving.delete(opened);
      loads.set(opened, (loads.get(opened) ?? 0) + 1);
    });
  });
  await context.route(`${api}/v1/turn`, async (route: Page) => {
    const from = route.request().frame().page();
    const loadedBefore = loads.get(from) ?? 0;
    await new Promise((resolve) => setTimeout(resolve, LEAVING_GRACE_MS));
    // Gone already, or going: either way the page that asked will never see the answer.
    if (leaving.has(from) || (loads.get(from) ?? 0) !== loadedBefore) return;
    const { site: _site, ...request } = route.request().postDataJSON() as TurnRequest;
    let body: string;
    try {
      const reply = await answer(request);
      // The same lines the server streams: the control first, then the whole reply.
      body = (reply.target ? JSON.stringify({ target: reply.target }) + "\n" : "") + JSON.stringify(reply) + "\n";
    } catch (error) {
      body = JSON.stringify({ error: error instanceof Error ? error.message : String(error), code: 502 }) + "\n";
    }
    await route.fulfill({ status: 200, contentType: STREAM_TYPE, headers: CORS, body });
  });

  const page = await context.newPage();
  if (set.before) {
    await page.goto(set.origin + set.before.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await dismiss(page, set.dismiss);
    for (const act of set.before.acts) await perform(page, act);
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    // An address that differs from this one only after its "#" would not load a page at all.
    await page.goto("about:blank");
  }
  await page.goto(set.origin + path, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("haptic-root", { state: "attached", timeout: 30_000 });
  // A page built by JavaScript is often still filling in when the tag has loaded.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await dismiss(page, set.dismiss);
  await page.waitForTimeout(BEFORE_ASKING_MS);
  return { page, close: () => context.close() };
}

/** Whether the page is where a guide was meant to end. Says what is missing when it is not. */
export async function reachedOrWhy(page: Page, reached: Reached, waitMs = 4000): Promise<string> {
  if (reached.url) {
    // The click that ends a guide may still be loading its page.
    const pattern = new RegExp(reached.url);
    for (const until = Date.now() + waitMs; !pattern.test(page.url()) && Date.now() < until; ) await page.waitForTimeout(100);
    if (!pattern.test(page.url())) return `the address is ${page.url()}, which does not match ${reached.url}`;
  }
  const shown = async (locator: Page) => {
    try {
      await locator.first().waitFor({ state: "visible", timeout: waitMs });
      return true;
    } catch {
      return false;
    }
  };
  if (reached.text && !(await shown(page.getByText(reached.text)))) return `"${reached.text}" is not on the page`;
  if (reached.selector && !(await shown(page.locator(reached.selector)))) return `nothing visible matches ${reached.selector}`;
  return "";
}

/** Types a question into the widget, as a visitor would. */
export async function ask(page: Page, goal: string): Promise<void> {
  await page.locator("haptic-root .launcher").click();
  await page.locator("haptic-root .panel input").fill(goal);
  await page.locator("haptic-root .panel input").press("Enter");
}

let bundled: Promise<string> | undefined;
/** The widget in the page is always this checkout's, built in memory, so a change to it shows up without a separate build. */
function widgetSource(): Promise<string> {
  bundled ??= bundleWidget();
  return bundled;
}
