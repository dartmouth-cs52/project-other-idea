import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type BrowserContext, type Page, type Route } from "playwright";
import { loadSite } from "../src/server/sites.ts";
import type { SnapElement, TurnRequest } from "../src/shared/types.ts";
import { TASKS, type Task } from "../testbed/src/tasks/index.ts";
import { CASES_DIR, matches, type Case } from "./cases.ts";

// Makes eval/cases/northpine.json from Northpine's tasks (testbed/src/tasks),
// the way eval/record.ts does for the demo app: it asks each task's question
// in the real widget, answers each step from the task's script, does what a
// visitor would do next, and keeps every request the widget sends as a case.
//
//   cd testbed && npm run dev                 # Northpine on :4200
//   HAPTIC_MODEL=mock npm run dev             # the Haptic server on :4000
//   npm run tag -- --url http://localhost:4200 --id site_testbed --name Northpine --notes testbed/haptic-notes.md --allow http://localhost:4200
//   npx tsx eval/record-northpine.ts          # every task
//   npx tsx eval/record-northpine.ts cards    # tasks whose id contains "cards"
//
// It differs from eval/record.ts in three ways Northpine needs. Each task
// opens with its test-panel settings in the address. Clicks move the mouse in
// steps, because a Radix submenu closes when the pointer jumps to an item. And
// a task that can't be walked is reported and left out, so one broken task
// does not cost the other 178.

const BASE = process.env.TESTBED_URL ?? "http://localhost:4200";
const SITE = "site_testbed";
const AT_ONCE = 4;
const filter = process.argv[2];

async function humanClick(page: Page, selector: string) {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await target.click();
}

async function record(context: BrowserContext, task: Task): Promise<Case[]> {
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const cases: Case[] = [];
  let answered = 0;
  let problem = "";

  await page.route("**/v1/turn", async (route: Route) => {
    const { site: _site, ...request } = route.request().postDataJSON() as TurnRequest;
    const step = task.steps[answered];
    const found = step?.expect.length ? request.snapshot.elements.find((element: SnapElement) => step.expect.some((matcher) => matches(matcher, element))) : undefined;
    if (!step) problem = `the widget asked for a step ${answered + 1}, which the task does not have`;
    else if (step.expect.length && !found) problem = `step ${answered + 1} expects ${step.expect.map((matcher) => `"${matcher.label}"`).join(" or ")}, which the widget did not list`;
    if (problem || !step) return route.fulfill({ json: { target: null, status: "done", say: "The script stopped here." } });
    cases.push({
      id: `${task.id}-${answered + 1}`,
      guide: task.id,
      request,
      expect: { targets: step.expect, status: found ? "continue" : "done", ...(step.sayStartsWith ? { sayStartsWith: step.sayStartsWith } : {}) },
    });
    answered++;
    await route.fulfill({ json: found ? { target: found.id, status: "continue", say: step.say ?? `Click ${found.label}.` } : { target: null, status: "done", say: "That's done." } });
  });

  const turn = async (count: number) => {
    const deadline = Date.now() + 15_000;
    while (answered < count && !problem) {
      if (Date.now() > deadline) throw new Error(`the widget never asked for step ${count}`);
      await page.waitForTimeout(50);
    }
    if (problem) throw new Error(problem);
  };

  const url = new URL(task.start, BASE);
  const lab = { latency: "none", role: "admin", plan: "growth", nav: "classic", locale: "en", ...task.lab };
  for (const [name, value] of Object.entries(lab)) url.searchParams.set(`lab.${name}`, String(value));
  await page.goto(url.toString(), { waitUntil: "load" });
  await page.waitForSelector("h1", { timeout: 20_000 });
  await page.waitForSelector("haptic-root", { state: "attached" });
  await page.locator("haptic-root .launcher").click();
  await page.locator("haptic-root .ask input").fill(task.goal);
  await page.locator("haptic-root .ask input").press("Enter");

  for (const [index, step] of task.steps.entries()) {
    await turn(index + 1);
    if (!step.act) break;
    // Wait until the pointer is on the page, as a visitor would before acting.
    await page.locator("haptic-root .cursor").waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(150);
    if ("click" in step.act) await humanClick(page, step.act.click);
    else if ("check" in step.act) await page.locator(step.act.check).first().check();
    else if ("select" in step.act) await page.locator(step.act.select[0]).first().selectOption({ label: step.act.select[1] });
    else await page.locator(step.act.fill[0]).first().fill(step.act.fill[1]);
  }
  await page.close();
  return cases;
}

const site = await loadSite(SITE);
if (!site) throw new Error(`There is no ${SITE} in data/sites yet. Build it first with npm run tag (see the top of this file).`);
const tasks = TASKS.filter((task) => !filter || task.id.includes(filter));
const browser = await chromium.launch();
const made = new Map<string, Case[]>();
const failed: string[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: AT_ONCE }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++]!;
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        made.set(task.id, await record(context, task));
      } catch (error) {
        failed.push(`${task.id}: ${(error as Error).message.split("\n")[0]}`);
      } finally {
        await context.close();
      }
    }
  }),
);
await browser.close();

// In the tasks' own order, whatever order they finished in.
const cases = tasks.flatMap((task) => made.get(task.id) ?? []);
for (const line of failed) console.log(`left out  ${line}`);
if (!filter) {
  await mkdir(CASES_DIR, { recursive: true });
  await writeFile(`${CASES_DIR}northpine.json`, JSON.stringify({ site, cases }, null, 1) + "\n");
}
console.log(`${cases.length} cases from ${made.size} of ${tasks.length} tasks${filter ? " (not written: a filter was given)" : ", written to eval/cases/northpine.json"}. ${failed.length} left out.`);
