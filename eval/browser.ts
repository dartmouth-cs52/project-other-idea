import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { loadSite, SITES_DIR } from "../src/server/sites.ts";
import { publicActing } from "../src/server/acting.ts";
import { DEFAULT_APPEARANCE, STREAM_TYPE, type PublicSiteConfig, type SiteContext, type TurnReply, type TurnRequest } from "../src/shared/types.ts";
import { widgetBundles } from "../src/widget/build.ts";
import { CASES_DIR, type CaseFile } from "./cases.ts";
import { faults, reachedList, type Act, type GuideSet, type Reached, type ReadAnswer, type Says } from "./guide.ts";
import { watch, type Net } from "./net.ts";
import { inPage, markTyped, typedInto } from "./visitor.ts";

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

/**
 * Loads eval/guides/<name>.ts. A set whose guides are to be run or recorded is
 * checked first: a guide that could never be scored as reached would count
 * against Haptic whatever it did, so such a set is not used at all. Looking at
 * a page needs no guide, so `eval:look` passes `checked: false`.
 */
export async function loadGuideSet(name: string, checked = true): Promise<GuideSet> {
  let set: GuideSet;
  try {
    set = (await import(`./guides/${name}.ts`)).default as GuideSet;
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_MODULE_NOT_FOUND") throw new Error(`There is no eval/guides/${name}.ts.`);
    throw error;
  }
  const wrong = checked ? faults(set) : [];
  if (wrong.length) throw new Error(`eval/guides/${name}.ts cannot be used as it is:\n${wrong.map((line) => `  ${line}`).join("\n")}`);
  return set;
}

export async function perform(page: Page, act: Act): Promise<void> {
  if ("click" in act) await page.locator(act.click).first().click();
  else if ("check" in act) await page.locator(act.check).first().check();
  else if ("select" in act) await page.locator(act.select[0]).first().selectOption({ label: act.select[1] });
  else if ("press" in act) await page.locator(act.press[0]).first().press(act.press[1]);
  else if ("hover" in act) await page.locator(act.hover).first().hover();
  else {
    await page.locator(act.fill[0]).first().fill(act.fill[1]);
    // Noted as the visitor notes what it types, for a "typedInto" test.
    await page.locator(act.fill[0]).first().evaluate(inPage(markTyped)).catch(() => undefined);
  }
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
  /** What the page sent, and what was stopped. Only on a site other people use: see eval/net.ts. */
  net?: Net;
}

/**
 * Opens a page of the site the way a visitor with Haptic installed would see
 * it: signed in if the site needs that, banners clicked away, the widget up.
 * `answer` is asked for every step. The widget is told the site's settings as
 * the server would tell it: its look, and its acting when the site has it on.
 * `config` puts other settings in their place, such as acting for a test page.
 */
export async function open(browser: Browser, set: GuideSet, path: string, answer: Answer, site?: SiteContext, config?: Partial<PublicSiteConfig>): Promise<Opened> {
  // A site that forbids scripts from elsewhere would block the tag. Its owner would allow it; here the rule is set aside.
  // On a site other people use, a service worker could send requests the net below never sees, so none is allowed to start.
  const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1366, height: 800 }, ...(set.sandbox ? {} : { serviceWorkers: "block" }) });
  // The net goes on first, so that every route added after it, the widget's own among them, is asked before it.
  const net = set.sandbox ? undefined : await watch(context, set);
  const api = set.hasTag ? set.origin : WIDGET_ORIGIN;
  if (!set.hasTag) await context.addInitScript(addTag(`${api}/widget.js`, set.siteId));

  const { widget, acting: actingCode } = await widgetSource();
  // Anything else the widget posts to its server, like the outline of a page it learns from or a visitor's note to a
  // person, is answered here too, so a run never reaches a real server's records. Added first, so the routes below come before it.
  await context.route(`${api}/v1/**`, (route: Page) => route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({ ok: true }) }));
  await context.route(`${api}/widget.js`, (route: Page) => route.fulfill({ status: 200, contentType: "text/javascript", headers: CORS, body: widget }));
  // The code that acts, which the widget loads from beside itself on a site with acting on, with its build in the query.
  await context.route((url: URL) => url.href.startsWith(`${api}/widget-act.js`), (route: Page) => route.fulfill({ status: 200, contentType: "text/javascript", headers: CORS, body: actingCode }));
  const acting = site ? publicActing(site) : undefined;
  const served: PublicSiteConfig = { name: site?.name ?? "", appearance: site?.appearance ?? DEFAULT_APPEARANCE, ...(acting ? { acting } : {}), ...config };
  await context.route(`${api}/v1/sites/**`, (route: Page) => route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(served) }));
  // How a guide ended, which the widget reports to its server. It is answered here, so a run never reaches a real server's records.
  await context.route(`${api}/v1/guides/**`, (route: Page) => route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({ ok: true }) }));
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
    // What the set's author wrote to sign in has been checked by them, so it goes through and is counted.
    if (net) net.signingIn = true;
    await page.goto(set.origin + set.before.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await dismiss(page, set.dismiss);
    for (const act of set.before.acts) await perform(page, act);
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    if (net) net.signingIn = false;
    // An address that differs from this one only after its "#" would not load a page at all.
    await page.goto("about:blank");
  }
  await page.goto(set.origin + path, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("haptic-root", { state: "attached", timeout: 30_000 });
  // A page built by JavaScript is often still filling in when the tag has loaded.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await dismiss(page, set.dismiss);
  await page.waitForTimeout(BEFORE_ASKING_MS);
  return { page, close: () => context.close(), ...(net ? { net } : {}) };
}

/**
 * A test of an address against a guide's pattern: the address as it is, or
 * with its escapes undone (%20 and + as spaces) and whatever the case. A query
 * a visitor typed can be written many ways, and "created >= -7d" is easier to
 * read and to get right than "created%20%3E%3D%20-7d".
 */
export function addressFits(pattern: string): (address: string) => boolean {
  const raw = new RegExp(pattern);
  const plain = new RegExp(pattern, "i");
  return (address) => {
    if (raw.test(address)) return true;
    try {
      return plain.test(decodeURIComponent(address.replace(/\+/g, "%20")));
    } catch {
      return false;
    }
  };
}

/**
 * Whether the page is where a guide was meant to end. Says what is missing
 * when it is not. `sentence` is the widget's sentence on show, for a test that
 * reads it; with none, such a test does not pass.
 */
export async function reachedOrWhy(page: Page, reached: Reached, waitMs = 4000, sentence?: string): Promise<string> {
  if (reached.url) {
    const fits = addressFits(reached.url);
    // The click that ends a guide may still be loading its page.
    for (const until = Date.now() + waitMs; !fits(page.url()) && Date.now() < until; ) await page.waitForTimeout(100);
    if (!fits(page.url())) return `the address is ${page.url()}, which does not match ${reached.url}`;
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
  if (reached.absent) {
    try {
      // Gone from the page, or still there and no longer shown.
      await page.locator(reached.absent).first().waitFor({ state: "hidden", timeout: waitMs });
    } catch {
      return `${reached.absent} is still on the page`;
    }
  }
  if (reached.typedInto) {
    // The visitor keeps its own note of the fields it typed into on a page, which the page never sees: a field's
    // value alone cannot tell, since a page that fills its form from a script leaves no "value the page gave it".
    const typed = (await page.evaluate(inPage(typedInto), reached.typedInto).catch(() => undefined)) as boolean | undefined;
    if (typed === undefined) return `there is no field ${reached.typedInto} on the page`;
    if (!typed) return `the visitor has not typed into ${reached.typedInto}`;
  }
  if (reached.request) {
    const to = new RegExp(reached.request.to);
    const has = new RegExp(reached.request.has);
    // The page's own record of every address it has fetched since it loaded, in order. A browser keeps 250 by
    // default and then stops adding, so a full record may not hold the last one, and says so.
    const all = (await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name)).catch(() => [])) as string[];
    const full = all.length >= 250 ? ` (the page's record of its requests is full, at ${all.length}, so a later one may be missing)` : "";
    const fetched = all.filter((address) => to.test(address));
    const latest = fetched[fetched.length - 1];
    if (!latest) return `the page has made no request to ${reached.request.to} since it loaded${full}`;
    if (!has.test(latest)) return `the page's last request to ${reached.request.to} was ${latest}, which does not match ${reached.request.has}${full}`;
  }
  if (reached.said !== undefined) {
    if (sentence === undefined) return `only the widget's sentence can say this is the place, and there was none to read`;
    if (!new RegExp(reached.said, "i").test(sentence)) return `the sentence does not say ${reached.said}`;
  }
  return "";
}

/**
 * Whether the page is at any of a guide's ends. Says why it is at none of them
 * when it is not. Each end is given the time to arrive: the click that ends a
 * guide may still be loading its page.
 */
export async function reachedAnyOrWhy(page: Page, reached: Reached | Reached[], waitMs = 4000, sentence?: string): Promise<string> {
  const ends = reachedList(reached);
  const why: string[] = [];
  for (const [index, end] of ends.entries()) {
    // Once the first has waited, the page has had its time to arrive, and the rest are looked at as it is.
    const one = await reachedOrWhy(page, end, index === 0 ? waitMs : Math.min(waitMs, 300), sentence);
    if (!one) return "";
    why.push(one);
  }
  return why.length > 1 ? `none of the ${why.length} ways of getting there holds: ${why.join("; ")}` : (why[0] ?? "the script has no test of the page");
}

/** The words of a text, lower case, for comparing what was said with what the page shows. */
const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * A sentence that hedges gives no answer, whatever else it says: "it may be
 * out of stock", "check whether it is offered", "I can't confirm". In the
 * languages the guides are asked in.
 */
export const HEDGES =
  /\b(it|they|this|that|there) (may|might|could) (be|have)\b|\b(probably|possibly|perhaps|presumably|not sure|unsure)\b|\b(check|see|verify|confirm) (whether|if)\b|\bi (can't|cannot|can not|couldn't) (see|tell|confirm|find|be sure)\b|\b(vielleicht|möglicherweise|wahrscheinlich|eventuell)\b|\bprüfen sie,? ob\b|\b(peut-être|probablement|sans doute)\b|\b(quizás|quizá|tal vez|probablemente)\b/i;

/** The pieces of an answer the page shows, each cut to the part that counts. */
function pieces(texts: string[], part: string | undefined): string[] {
  return texts.map((text) => (part ? (new RegExp(part, "i").exec(text)?.[0] ?? "") : text).trim());
}

/**
 * Words that say nothing about an answer once the rest is right: "$149 a month",
 * "$149 per month" and "$149/month" are one price. They are left out of both
 * sides when a sentence is compared with what the page shows.
 */
const FILLER = new Set(["a", "an", "per"]);
/** A word as it is compared: one thing or several is the same word, so "button names" says "the names of buttons". */
const stem = (word: string) => (word.length > 3 ? word.replace(/s$/, "") : word);
const comparable = (words: string[]) => words.filter((word) => !FILLER.has(word)).map(stem);

/** Whether a sentence says a piece of text: its words in order, or in any order when `anyOrder` is set. */
function sayIt(saidAll: string[], piece: string, anyOrder = false): boolean {
  const said = comparable(saidAll);
  const wanted = comparable(wordsOf(piece));
  if (!wanted.length) return false;
  if (anyOrder) return wanted.every((word) => said.includes(word));
  return said.some((_, start) => wanted.every((word, offset) => said[start + offset] === word));
}

/** What the page shows for an answer: the text of every visible element the selector matches. */
export interface Read {
  shown?: string[];
  notShown?: string[];
}

/**
 * Whether a sentence gives the true answer to a question that asks for a
 * fact. Says what is wrong when it does not. `read` holds what the page shows
 * for the answer, already read from it: see `readAnswers`.
 */
export function saidOrWhy(says: Says, sentence: string, read: Read = {}): string {
  const hedge = HEDGES.exec(sentence);
  if (hedge) return `the sentence hedges ("${hedge[0]}"), which is not an answer`;
  for (const pattern of says.not ?? []) {
    const found = new RegExp(pattern, "i").exec(sentence);
    if (found) return `the sentence says "${found[0]}", which is the wrong answer`;
  }
  for (const pattern of says.all ?? []) if (!new RegExp(pattern, "i").test(sentence)) return `the sentence does not say ${pattern}`;
  const said = wordsOf(sentence);
  if (says.shown) {
    const shown = read.shown ?? [];
    if (!shown.length) return `the page showed nothing at ${says.shown.selector} to check the answer against`;
    for (const [index, piece] of pieces(shown, says.shown.part).entries()) {
      if (!piece) return `the page's "${shown[index]!.slice(0, 60)}" has no part matching ${says.shown.part}`;
      if (!sayIt(said, piece, says.shown.anyOrder)) return `the sentence does not say "${piece}", which is what the page shows`;
    }
  }
  if (says.notShown) {
    for (const piece of pieces(read.notShown ?? [], says.notShown.part)) {
      if (piece && sayIt(said, piece, says.notShown.anyOrder)) return `the sentence names "${piece}", which the page shows is not the answer`;
    }
  }
  return "";
}

/** The text of every visible element a selector matches, at most sixty, after waiting up to `waitMs` for one. Empty when the page is gone or still loading. */
async function visibleTexts(page: Page, selector: string, waitMs = 0): Promise<string[]> {
  try {
    const found = page.locator(selector);
    if (waitMs) await found.first().waitFor({ state: "visible", timeout: waitMs }).catch(() => undefined);
    const texts: string[] = [];
    for (let index = 0, count = Math.min(await found.count(), 60); index < count; index++) {
      if (await found.nth(index).isVisible()) texts.push(((await found.nth(index).textContent()) ?? "").replace(/\s+/g, " ").trim());
    }
    return texts.filter(Boolean);
  } catch {
    return [];
  }
}

/** Reads from the page the answers a `says` takes from it `when` it is now: at the start, or at the end. */
export async function readAnswers(page: Page, says: Says | undefined, when: "start" | "end"): Promise<Read> {
  const read: Read = {};
  // The page a guide starts on may still be drawing its data. It is there all along, so it is worth a short wait.
  const wait = when === "start" ? 5000 : 0;
  const readOne = async (answer: ReadAnswer) => {
    if (!answer.from || when !== "start") return visibleTexts(page, answer.selector, wait);
    // Another page of the site, in a tab of its own, so that the visitor's page is left as it is.
    const other = await page.context().newPage();
    try {
      await other.goto(new URL(answer.from, page.url()).href, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return await visibleTexts(other, answer.selector, wait);
    } catch {
      return [];
    } finally {
      await other.close().catch(() => undefined);
    }
  };
  if (says?.shown && (says.shown.when ?? "end") === when) read.shown = await readOne(says.shown);
  if (says?.notShown && (says.notShown.when ?? "end") === when) read.notShown = await readOne(says.notShown);
  return read;
}

/** `saidOrWhy` with what is read at the end read from the page as it is now, and what was read at the start passed in. */
export async function saysOrWhy(page: Page, says: Says, sentence: string, atStart: Read = {}): Promise<string> {
  return saidOrWhy(says, sentence, { ...atStart, ...(await readAnswers(page, says, "end")) });
}

/**
 * Types a question into the widget, as a visitor would. The launcher opens the
 * ask box, unless it is open already: a guide that ended leaves it open when
 * it asks whether it helped.
 */
export async function ask(page: Page, goal: string): Promise<void> {
  if (!(await page.locator("haptic-root .panel").isVisible())) await page.locator("haptic-root .launcher").click();
  await page.locator("haptic-root .ask textarea").fill(goal);
  await page.locator("haptic-root .ask textarea").press("Enter");
}

let bundled: Promise<{ widget: string; acting: string }> | undefined;
/** The widget in the page is always this checkout's, both its files built in memory, so a change to it shows up without a separate build. */
function widgetSource(): Promise<{ widget: string; acting: string }> {
  bundled ??= widgetBundles();
  return bundled;
}
