import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { loadSite } from "../src/server/sites.ts";
import type { SnapElement, TurnRequest } from "../src/shared/types.ts";
import { CASES_DIR, matches, type Case } from "./cases.ts";
import type { Guide, GuideSet } from "./guide.ts";

// Makes eval/cases/<name>.json by walking a site the way a visitor would.
//
// For each guide in eval/guides/<name>.ts it opens the page, asks the question
// in the real widget, and then plays both parts: it answers each step from the
// script (so the widget is always sent down the right path), and it does what a
// visitor would do next. Every request the widget sends on the way is kept as a
// case. Run it again whenever the widget changes what it sends.
//
//   npm run eval:record -- demo         (needs the local server: HAPTIC_MODEL=mock npm run dev)
//   HAPTIC_PUBLIC_URL=https://widget.joinhaptic.com npm run eval:record -- joinhaptic
//
// The site has to be in data/sites first (npm run tag). For a site that does not
// carry the script tag, HAPTIC_PUBLIC_URL says which server the widget is loaded from.
//
// It drives a browser with Playwright, which this project does not install.
// Add it for the run: npm install --no-save playwright && npx playwright install chromium

const WIDGET_HOST = process.env.HAPTIC_PUBLIC_URL || "http://localhost:4000";

/**
 * Script that runs in the page before its own: it adds the tag once the body
 * exists. It is built as text because a function handed to the browser would
 * arrive with this project's build helpers still in it.
 */
const addTag = (src: string, site: string) => `(() => {
  const add = () => {
    const tag = document.createElement("script");
    tag.src = ${JSON.stringify(src)};
    tag.dataset.site = ${JSON.stringify(site)};
    document.body.append(tag);
  };
  if (document.body) add();
  else document.addEventListener("DOMContentLoaded", add);
})();`;

// Playwright is loaded by name at run time so that the project neither depends on it nor type-checks against it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

async function record(browser: { newContext: () => Promise<Page> }, set: GuideSet, guide: Guide): Promise<Case[]> {
  const context = await browser.newContext();
  // A site without the script tag gets it added to every page, the way the site's owner would.
  if (!set.hasTag) await context.addInitScript(addTag(`${WIDGET_HOST}/widget.js`, set.siteId));
  const page = await context.newPage();
  const cases: Case[] = [];
  let answered = 0;
  let problem = "";

  await page.route("**/v1/turn", async (route: Page) => {
    // The site is kept once, with the file. The guide and visitor ids are made up for each run and say nothing about the step.
    const { site: _site, guide: _guide, visitor: _visitor, ...request } = route.request().postDataJSON() as TurnRequest;
    const step = guide.steps[answered];
    const found = step?.expect.length ? request.snapshot.elements.find((element: SnapElement) => step.expect.some((matcher) => matches(matcher, element))) : undefined;
    if (!step) problem = `the widget asked for a step ${answered + 1}, which the script does not have`;
    else if (step.expect.length && !found) {
      problem = `step ${answered + 1} expects ${step.expect.map((matcher) => `"${matcher.label}"`).join(" or ")}, which the widget did not list. It listed: ${request.snapshot.elements.map((element: SnapElement) => `${element.role} "${element.label}"`).join(", ")}`;
    }
    if (problem || !step) return route.fulfill({ json: { target: null, status: "done", say: "The script stopped here." } });

    cases.push({
      id: `${guide.id}-${answered + 1}`,
      guide: guide.id,
      request,
      expect: { targets: step.expect, status: found ? "continue" : "done", ...(step.sayStartsWith ? { sayStartsWith: step.sayStartsWith } : {}) },
    });
    answered++;
    await route.fulfill({ json: found ? { target: found.id, status: "continue", say: step.say ?? `Click ${found.label}.` } : { target: null, status: "done", say: "That's done." } });
  });

  const turn = async (count: number) => {
    const deadline = Date.now() + 15_000;
    while (answered < count && !problem) {
      if (Date.now() > deadline) throw new Error(`${guide.id}: the widget never asked for step ${count}.`);
      await page.waitForTimeout(50);
    }
    if (problem) throw new Error(`${guide.id}: ${problem}`);
  };

  await page.goto(set.origin + guide.start);
  await page.waitForSelector("haptic-root", { state: "attached" });
  await page.locator("haptic-root .launcher").click();
  await page.locator("haptic-root .ask input").fill(guide.goal);
  await page.locator("haptic-root .ask input").press("Enter");

  for (const [index, step] of guide.steps.entries()) {
    await turn(index + 1);
    if (!step.act) break;
    // Wait until the pointer is on the page, as a visitor would before acting.
    await page.locator("haptic-root .cursor").waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(150);
    if ("click" in step.act) await page.locator(step.act.click).first().click();
    else if ("check" in step.act) await page.locator(step.act.check).check();
    else if ("select" in step.act) await page.locator(step.act.select[0]).selectOption({ label: step.act.select[1] });
    else await page.locator(step.act.fill[0]).fill(step.act.fill[1]);
  }
  await context.close();
  return cases;
}

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error("Say which guides to record: npm run eval:record -- demo");
  let set: GuideSet;
  try {
    set = (await import(`./guides/${name}.ts`)).default;
  } catch {
    throw new Error(`There is no eval/guides/${name}.ts.`);
  }
  const site = await loadSite(set.siteId);
  if (!site) throw new Error(`There is no ${set.siteId} in data/sites yet. Build it first with npm run tag.`);

  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)("playwright"));
  } catch {
    throw new Error("Playwright isn't installed. Add it for this run: npm install --no-save playwright && npx playwright install chromium");
  }
  const browser = await chromium.launch();
  const cases: Case[] = [];
  try {
    for (const guide of set.guides) {
      const made = await record(browser, set, guide);
      console.log(`${guide.id}: ${made.length} steps`);
      cases.push(...made);
    }
  } finally {
    await browser.close();
  }

  await mkdir(CASES_DIR, { recursive: true });
  await writeFile(`${CASES_DIR}${name}.json`, JSON.stringify({ site, cases }, null, 1) + "\n");
  console.log(`Wrote ${cases.length} cases from ${set.guides.length} guides to eval/cases/${name}.json`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
