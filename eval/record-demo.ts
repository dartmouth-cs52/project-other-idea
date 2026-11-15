import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { loadSite } from "../src/server/sites.ts";
import type { SnapElement, TurnRequest } from "../src/shared/types.ts";
import { CASES_DIR, matches, type Case, type Matcher } from "./cases.ts";

// Makes eval/cases/demo.json by walking the demo app the way a visitor would.
//
// For each guide below it opens the page, asks the question in the real widget,
// and then plays both parts: it answers each step from the script (so the
// widget is always sent down the right path), and it does what a visitor would
// do next. Every request the widget sends on the way is kept as a case. Run it
// again whenever the widget changes what it sends.
//
//   HAPTIC_MODEL=mock npm run dev                       (in one terminal)
//   HAPTIC_MODEL=mock npm run tag -- --url http://localhost:4000/demo/ --id site_demo \
//     --name "Acme Console" --notes demo/notes.md --docs demo/help
//   npm run eval:record-demo
//
// It drives a browser with Playwright, which this project does not install.
// Add it for the run: npm install --no-save playwright && npx playwright install chromium

const HOST = process.env.HAPTIC_PUBLIC_URL || "http://localhost:4000";
const SITE_ID = "site_demo";

type Act = { click: string } | { fill: [selector: string, value: string] } | { select: [selector: string, value: string] } | { check: string };

interface Step {
  /** The controls that are right at this step. Empty when the guide is over. */
  expect: Matcher[];
  /** What the visitor does next. Left out on the last step. */
  act?: Act;
  /** What the scripted answer says, when "Click <label>." would not do. */
  say?: string;
  sayStartsWith?: string;
}

interface Guide {
  id: string;
  start: string;
  goal: string;
  steps: Step[];
}

const button = (label: string): Matcher => ({ label, role: "button" });
const any = (label: string): Matcher => ({ label });
const DONE: Step = { expect: [] };
const ACCOUNT: Step = { expect: [button("A")], act: { click: "#account-button" }, say: "Click the round A button at the top right." };

const GUIDES: Guide[] = [
  {
    id: "billing",
    start: "/demo/",
    goal: "How do I change my billing info?",
    steps: [
      ACCOUNT,
      { expect: [any("Plan and billing")], act: { click: '#account-menu a[href="/demo/settings-billing"]' } },
      { expect: [button("Update payment method")], act: { click: "#edit-payment" } },
      { expect: [any("Name on card"), any("Billing postcode")], act: { fill: ['input[name="cardname"]', "Avery Stone"] }, say: "Type the name on the card." },
      { expect: [any("Billing postcode")], act: { fill: ['input[name="postcode"]', "03755"] }, say: "Type the billing postcode." },
      { expect: [button("Save payment method")], act: { click: 'button[value="save"]' } },
      DONE,
    ],
  },
  {
    id: "invite",
    start: "/demo/",
    goal: "I want to invite a teammate",
    steps: [
      { expect: [any("Team")], act: { click: 'nav a[href="/demo/team"]' } },
      { expect: [any("Email address")], act: { fill: ['input[name="email"]', "sam@example.com"] }, say: "Type their email address." },
      { expect: [button("Send invite")], act: { click: "#invite button" } },
      DONE,
    ],
  },
  {
    id: "invite-here",
    start: "/demo/team",
    goal: "invite a teammate",
    steps: [
      { expect: [any("Email address")], act: { fill: ['input[name="email"]', "priya@example.com"] }, say: "Type their email address." },
      { expect: [button("Send invite")], act: { click: "#invite button" } },
      DONE,
    ],
  },
  {
    id: "invite-wrong-click",
    start: "/demo/",
    goal: "add someone to my team",
    steps: [
      // The visitor is pointed at Team and clicks Projects.
      { expect: [any("Team")], act: { click: 'nav a[href="/demo/projects"]' } },
      { expect: [any("Team")], act: { click: 'nav a[href="/demo/team"]' }, say: "Not that one. Click Team.", sayStartsWith: "Not that one." },
      { expect: [any("Email address")], act: { fill: ['input[name="email"]', "jo@example.com"] }, say: "Type their email address." },
      { expect: [button("Send invite")], act: { click: "#invite button" } },
      DONE,
    ],
  },
  {
    id: "new-project",
    start: "/demo/",
    goal: "create a new project",
    steps: [
      { expect: [any("Projects"), any("View projects")], act: { click: 'nav a[href="/demo/projects"]' } },
      { expect: [button("New project")], act: { click: "#new-project" } },
      { expect: [any("Project name")], act: { fill: ['#project-dialog input[name="name"]', "billing-service"] }, say: "Type a name for the project." },
      { expect: [button("Create project"), any("Region")], act: { click: 'button[value="create"]' } },
      DONE,
    ],
  },
  {
    id: "api-key",
    start: "/demo/projects",
    goal: "Where do I get an API key?",
    steps: [
      ACCOUNT,
      { expect: [any("Settings")], act: { click: '#account-menu a[href="/demo/settings"]' } },
      { expect: [any("Security")], act: { click: '.tabs a[href="/demo/settings-security"]' } },
      { expect: [button("Create API key")], act: { click: "#new-key" } },
      DONE,
    ],
  },
  {
    id: "two-factor",
    start: "/demo/team",
    goal: "turn on two-factor authentication",
    steps: [
      ACCOUNT,
      { expect: [any("Settings")], act: { click: '#account-menu a[href="/demo/settings"]' } },
      { expect: [any("Security")], act: { click: '.tabs a[href="/demo/settings-security"]' } },
      { expect: [any("Require two-factor authentication")], act: { check: "#two-factor" }, say: "Tick Require two-factor authentication." },
      DONE,
    ],
  },
  {
    id: "rename-workspace",
    start: "/demo/",
    goal: "How can I rename my workspace?",
    steps: [
      ACCOUNT,
      { expect: [any("Settings")], act: { click: '#account-menu a[href="/demo/settings"]' } },
      { expect: [any("Workspace name")], act: { fill: ['input[name="workspace"]', "Acme Labs"] }, say: "Type the new name." },
      { expect: [button("Save changes")], act: { click: "#general button" } },
      DONE,
    ],
  },
  {
    id: "time-zone",
    start: "/demo/settings-billing",
    goal: "change the time zone",
    steps: [
      { expect: [any("General")], act: { click: '.tabs a[href="/demo/settings"]' } },
      { expect: [any("Time zone")], act: { select: ["#general select", "Pacific"] }, say: "Pick your time zone." },
      { expect: [button("Save changes")], act: { click: "#general button" } },
      DONE,
    ],
  },
  {
    id: "invoice",
    start: "/demo/",
    goal: "download my latest invoice",
    steps: [
      ACCOUNT,
      { expect: [any("Plan and billing")], act: { click: '#account-menu a[href="/demo/settings-billing"]' } },
      { expect: [any("Download latest invoice")], act: { click: 'main a[href="/demo/settings-billing"]:not([role])' } },
      DONE,
    ],
  },
  {
    id: "upgrade",
    start: "/demo/",
    goal: "I want to upgrade my plan",
    steps: [
      ACCOUNT,
      { expect: [any("Plan and billing")], act: { click: '#account-menu a[href="/demo/settings-billing"]' } },
      { expect: [button("Change plan")], act: { click: "#change-plan" } },
      DONE,
    ],
  },
  {
    id: "sign-out",
    start: "/demo/team",
    goal: "sign out",
    steps: [ACCOUNT, { expect: [any("Sign out")], act: { click: '#account-menu a[href="/demo/"]' } }, DONE],
  },
  {
    id: "usage",
    start: "/demo/team",
    goal: "where can I see my usage this month?",
    steps: [{ expect: [any("Overview"), any("Acme Console")], act: { click: 'nav a[href="/demo/"]' } }, DONE],
  },
  // The demo has no way to delete a project, so the right answer points at nothing.
  { id: "no-such-feature", start: "/demo/projects", goal: "How do I delete a project?", steps: [DONE] },
];

// Playwright is loaded by name at run time so that the project neither depends on it nor type-checks against it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

async function record(browser: { newContext: () => Promise<{ newPage: () => Promise<Page>; close: () => Promise<void> }> }, guide: Guide): Promise<Case[]> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cases: Case[] = [];
  let answered = 0;
  let problem = "";

  await page.route("**/v1/turn", async (route: Page) => {
    const { site: _site, ...request } = route.request().postDataJSON() as TurnRequest;
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

  await page.goto(HOST + guide.start);
  await page.waitForSelector("haptic-root", { state: "attached" });
  await page.locator("haptic-root .launcher").click();
  await page.locator("haptic-root .panel input").fill(guide.goal);
  await page.locator("haptic-root .panel input").press("Enter");

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
  const site = await loadSite(SITE_ID);
  if (!site) throw new Error(`There is no ${SITE_ID} yet. Build it first, with the command at the top of eval/record-demo.ts.`);

  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)("playwright"));
  } catch {
    throw new Error("Playwright isn't installed. Add it for this run: npm install --no-save playwright && npx playwright install chromium");
  }
  const browser = await chromium.launch();
  const cases: Case[] = [];
  try {
    for (const guide of GUIDES) {
      const made = await record(browser, guide);
      console.log(`${guide.id}: ${made.length} steps`);
      cases.push(...made);
    }
  } finally {
    await browser.close();
  }

  await mkdir(CASES_DIR, { recursive: true });
  await writeFile(`${CASES_DIR}demo.json`, JSON.stringify({ site, cases }, null, 1) + "\n");
  console.log(`Wrote ${cases.length} cases from ${GUIDES.length} guides to eval/cases/demo.json`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
