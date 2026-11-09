// Runs whole guides on the demo in a real browser. A simulated user asks a
// question and clicks whatever Haptic points at, typing into fields and
// picking options when asked, until Haptic stops. Each run is scored on:
//
//   done     the task got finished, or Haptic stopped at a fair hand-off point
//   extra    steps Haptic pointed at after the task was already finished
//   dead     points at the same element right after clicking it changed nothing
//   clicks   how many clicks it took, against the fewest possible
//
//   npm run dev                                   (web on :4000, demo on :4100)
//   npm run eval:guides -- gemini-3.5-flash-lite gemini-3.8-flash
//
// EVAL_RUNS repeats each flow, EVAL_ONLY=api-key,plan picks flows by name.

import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const DEMO = process.env.HAPTIC_DEMO ?? "http://localhost:4100";
const RUNS = Number(process.env.EVAL_RUNS ?? 2);
const ONLY = process.env.EVAL_ONLY?.split(",");
const MAX_CLICKS = 14;
const PHASE_TIMEOUT_MS = 20_000;
const models = process.argv.slice(2).length ? process.argv.slice(2) : ["gemini-3.5-flash-lite"];

interface Flow {
  name: string;
  question: string;
  /** Fewest clicks a user needs, counting a click into each field. */
  optimal: number;
  /** Typed into any text field Haptic points at. */
  type?: string;
  /** Picked in any select Haptic points at. */
  choose?: string;
  /** The task is finished. Any point after this is an extra step. */
  reached: (page: Page, clicked: string[]) => Promise<boolean>;
  /** Stopping here with <done/> is also fine, e.g. the last form is open for the user to fill in. */
  enough?: (page: Page) => Promise<boolean>;
}

const dialogOpen = (page: Page, name: string) => page.getByRole("dialog", { name }).isVisible();

const FLOWS: Flow[] = [
  {
    name: "api-key",
    question: "how do I create an API key",
    optimal: 6,
    type: "CI server",
    reached: (page) => page.getByText("New key created").isVisible(),
    enough: (page) => dialogOpen(page, "Create API key"),
  },
  {
    name: "invite",
    question: "how do I invite a teammate",
    optimal: 6,
    type: "sam@example.com",
    reached: (page) => page.getByText("· Invited").isVisible(),
    enough: (page) => dialogOpen(page, "Invite member"),
  },
  {
    name: "two-factor",
    question: "how do I make everyone use two-factor authentication",
    optimal: 4,
    // Clicking the checkbox a second time turns it back off.
    reached: (page) => page.getByRole("checkbox", { name: "Require two-factor authentication" }).isChecked().catch(() => false),
  },
  {
    name: "plan",
    question: "how do I change my plan",
    optimal: 3,
    reached: async (_page, clicked) => clicked.some((label) => /^(Starter|Team|Enterprise)$/.test(label)),
    enough: (page) => dialogOpen(page, "Choose a plan"),
  },
  {
    name: "rename-me",
    question: "how do I change my name",
    optimal: 4,
    type: "Alex Kim",
    // Saving shows nothing in the demo, which is exactly the hard case.
    reached: async (_page, clicked) => clicked.includes("Save profile"),
    enough: async (page) => new URL(page.url()).pathname === "/profile",
  },
  {
    name: "new-project",
    question: "how do I create a new project",
    optimal: 6,
    type: "Eval project",
    reached: (page) => page.getByRole("link", { name: "Eval project" }).isVisible(),
    enough: (page) => dialogOpen(page, "New project"),
  },
  {
    name: "region",
    question: "how do I move my workspace to the EU",
    optimal: 2,
    choose: "EU West",
    reached: async (page) => (await page.getByRole("combobox", { name: "Region" }).inputValue().catch(() => "")) === "eu-west",
  },
];

type Ending = "done" | "answered" | "max" | "error" | "timeout";

interface Run {
  model: string;
  flow: string;
  ending: Ending;
  success: boolean;
  clicks: number;
  optimal: number;
  extra: number;
  dead: number;
  ms: number;
  path: string[];
  steps: string[];
}

declare global {
  interface Window {
    Haptic?: {
      ask(question: string): void;
      on(event: string, listener: (detail: Record<string, unknown>) => void): () => void;
      debug: { phase(): string; target(): Element | null };
    };
    __evalSteps?: string[];
  }
}

const phase = (page: Page) => page.evaluate(() => window.Haptic?.debug.phase() ?? "");

/** Wait until Haptic has finished thinking: it's waiting for a click, or it stopped. */
async function settledPhase(page: Page): Promise<string> {
  const deadline = Date.now() + PHASE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = await phase(page);
    if (["waiting", "done", "answered", "error"].includes(current)) return current;
    await page.waitForTimeout(80);
  }
  return "timeout";
}

/** Everything a click could change that a user would notice. */
function pageState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll("input, select, textarea")).map((field) => {
      const input = field as HTMLInputElement;
      return `${input.value}:${input.checked}`;
    });
    const dialogs = Array.from(document.querySelectorAll("dialog[open]")).length;
    return `${location.pathname}|${dialogs}|${fields.join(",")}|${document.body.innerHTML.length}:${document.body.innerText}`;
  });
}

/** Click what Haptic points at, the way a user would, and fill it in if it's a field. */
async function act(page: Page, flow: Flow): Promise<{ label: string; same: boolean } | undefined> {
  const handle = await page.evaluateHandle(() => window.Haptic?.debug.target() ?? null);
  const el = handle.asElement();
  if (!el) return undefined;
  const info = await el.evaluate((node) => {
    const field = node as HTMLInputElement;
    const label = (node.getAttribute("aria-label") || node.getAttribute("title") || field.labels?.[0]?.textContent || node.textContent || field.placeholder || node.tagName)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    const store = window as unknown as { __evalLast?: Element; __evalLastLabel?: string };
    const same = store.__evalLast === node || store.__evalLastLabel === label;
    store.__evalLast = node;
    store.__evalLastLabel = label;
    // A plain DOM click, like e2e/guide.spec.ts: the caption can sit over the target.
    (node as HTMLElement).click();
    return { tag: node.tagName.toLowerCase(), type: field.type ?? "", label, same };
  });
  if (info.tag === "textarea" || (info.tag === "input" && !["checkbox", "radio", "submit", "button"].includes(info.type))) {
    await el.fill(flow.type ?? "test");
  } else if (info.tag === "select" && flow.choose) {
    await el.selectOption({ label: flow.choose });
  }
  return { label: info.label, same: info.same };
}

async function runFlow(browser: Browser, model: string, flow: Flow): Promise<Run> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.route("**/api/v1/turn", (route) => route.continue({ headers: { ...route.request().headers(), "x-haptic-model": model } }));
  const run: Run = { model, flow: flow.name, ending: "timeout", success: false, clicks: 0, optimal: flow.optimal, extra: 0, dead: 0, ms: 0, path: [], steps: [] };
  const started = performance.now();
  try {
    await page.goto(`${DEMO}/`);
    await page.waitForFunction(() => Boolean(window.Haptic));
    await page.evaluate((question) => {
      window.__evalSteps = [];
      window.Haptic!.on("step", (detail) => window.__evalSteps!.push(String(detail.text ?? "")));
      window.Haptic!.ask(question);
    }, flow.question);

    let clickChangedNothing = false;
    for (;;) {
      const current = await settledPhase(page);
      if (current !== "waiting") {
        run.ending = current === "answered" && run.clicks >= 12 ? "max" : (current as Ending);
        break;
      }
      if (await flow.reached(page, run.path)) run.extra++;
      if (run.clicks >= MAX_CLICKS) {
        run.ending = "max";
        break;
      }
      const before = await pageState(page);
      const acted = await act(page, flow);
      if (!acted) {
        run.ending = "error";
        break;
      }
      if (acted.same && clickChangedNothing) run.dead++;
      run.clicks++;
      run.path.push(acted.label);
      // Haptic switches to settling as soon as it sees the click.
      await page.waitForFunction(() => window.Haptic?.debug.phase() !== "waiting", null, { timeout: 5000 }).catch(() => {});
      await settledPhase(page);
      clickChangedNothing = (await pageState(page)) === before;
    }
    const reached = await flow.reached(page, run.path);
    run.success = reached || (run.ending === "done" && Boolean(await flow.enough?.(page)));
    run.steps = await page.evaluate(() => window.__evalSteps ?? []);
  } catch (error) {
    run.ending = "error";
    run.steps.push(error instanceof Error ? error.message : String(error));
  } finally {
    run.ms = Math.round(performance.now() - started);
    await context.close();
  }
  return run;
}

const flows = FLOWS.filter((flow) => !ONLY || ONLY.includes(flow.name));
const browser = await chromium.launch();
const runs: Run[] = [];
for (const model of models) {
  const jobs = Array.from({ length: RUNS }, () => flows).flat();
  // A few at a time keeps rate limits happy and timings honest.
  for (let i = 0; i < jobs.length; i += 4) {
    runs.push(...(await Promise.all(jobs.slice(i, i + 4).map((flow) => runFlow(browser, model, flow)))));
  }
}
await browser.close();

for (const run of runs) {
  const flag = !run.success ? "FAIL" : run.extra || run.dead ? "MEH " : "ok  ";
  console.log(
    `${flag} ${run.model.padEnd(24)} ${run.flow.padEnd(12)} ${run.ending.padEnd(9)} clicks ${run.clicks}/${run.optimal} extra ${run.extra} dead ${run.dead}  ${run.path.join(" → ")}`,
  );
  if (run.success && !run.extra && !run.dead) continue;
  for (const step of run.steps) console.log(`       "${step.replace(/\s+/g, " ").slice(0, 110)}"`);
}

// A model timeout or failed request says nothing about guiding, so those runs
// are counted on their own instead of as failures.
const failedRequest = (run: Run) => (run.ending === "error" || run.ending === "timeout") && run.clicks === 0;

console.log("");
console.log(`${"model".padEnd(26)}${"done".padEnd(9)}${"stopped".padEnd(10)}${"extra".padEnd(8)}${"dead".padEnd(7)}${"clicks/opt".padEnd(13)}${"s per run".padEnd(11)}errors`);
for (const model of models) {
  const errors = runs.filter((run) => run.model === model && failedRequest(run)).length;
  const rows = runs.filter((run) => run.model === model && !failedRequest(run));
  const sum = (pick: (run: Run) => number) => rows.reduce((total, run) => total + pick(run), 0);
  const stopped = rows.filter((run) => run.ending === "done" || run.ending === "answered").length;
  console.log(
    `${model.padEnd(26)}${`${rows.filter((run) => run.success).length}/${rows.length}`.padEnd(9)}${`${stopped}/${rows.length}`.padEnd(10)}${String(sum((run) => run.extra)).padEnd(8)}${String(sum((run) => run.dead)).padEnd(7)}${`${sum((run) => run.clicks)}/${sum((run) => run.optimal)}`.padEnd(13)}${(sum((run) => run.ms) / Math.max(1, rows.length) / 1000).toFixed(1).padEnd(11)}${errors}`,
  );
}

mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
const file = new URL(`./results/guides-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(runs, null, 1));
console.log(`\nSaved ${file.pathname}`);
