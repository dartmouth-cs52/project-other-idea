// Walks every benchmark task in a real browser and checks that each act
// still works against the current UI. It doesn't involve Haptic: it only
// proves the tasks are playable, so a failed run means a task or a page broke.
//
//   npm run dev                       # in another terminal
//   npm run tasks:replay              # every task
//   npm run tasks:replay -- cards     # tasks whose id contains "cards"
//
// Clicks move the mouse in steps, the way a person does. Radix submenus close
// when the pointer jumps straight from the trigger to an item, so a plain
// page.click() can't reach "Theme > Dark". A recorder driving these tasks
// should move the mouse the same way.

import { chromium, type Page } from "playwright";
import { TASKS } from "../src/tasks/index.ts";
import type { Act } from "../src/tasks/types.ts";

const BASE = process.env.TESTBED_URL ?? "http://localhost:4200";
const filter = process.argv[2];
const tasks = TASKS.filter((t) => !filter || t.id.includes(filter));

async function humanClick(page: Page, selector: string) {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) return target.click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await target.click();
}

async function perform(page: Page, act: Act) {
  if ("click" in act) await humanClick(page, act.click);
  else if ("fill" in act) await page.locator(act.fill[0]).first().fill(act.fill[1]);
  else if ("select" in act) await page.locator(act.select[0]).first().selectOption({ label: act.select[1] });
  else await page.locator(act.check).first().check();
}

const ids = new Set<string>();
for (const t of TASKS) {
  if (ids.has(t.id)) console.log(`duplicate id ${t.id}`);
  ids.add(t.id);
}

const browser = await chromium.launch();
let failed = 0;
for (const task of tasks) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = new URL(task.start, BASE);
  const lab = { widget: "0", latency: "none", role: "admin", plan: "growth", nav: "classic", locale: "en", ...task.lab };
  for (const [k, v] of Object.entries(lab)) url.searchParams.set(`lab.${k}`, String(v));
  let ok = true;
  try {
    await page.goto(url.toString(), { waitUntil: "load" });
    await page.waitForSelector("h1", { timeout: 20000 });
    await page.waitForTimeout(500);
    for (const [i, step] of task.steps.entries()) {
      if (!step.act) continue;
      try {
        await perform(page, step.act);
        await page.waitForTimeout(250);
      } catch (e) {
        ok = false;
        console.log(`FAIL ${task.id} step ${i + 1}: ${(e as Error).message.split("\n")[0]}`);
        break;
      }
    }
  } catch (e) {
    ok = false;
    console.log(`FAIL ${task.id} loading ${task.start}: ${(e as Error).message.split("\n")[0]}`);
  }
  if (!ok) failed++;
  else console.log(`ok   ${task.id.padEnd(40)} ${new URL(page.url()).pathname}${errors.length ? `  page errors: ${errors.join(" | ")}` : ""}`);
  await context.close();
}
await browser.close();
console.log(`\n${tasks.length} tasks, ${failed} failed`);
process.exit(failed ? 1 : 0);
