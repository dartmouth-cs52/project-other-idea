import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { measureTurn, TurnError, type TurnSettings } from "../src/server/model.ts";
import { loadCaseFiles, plausibleRange, score, type Case } from "./cases.ts";

// Runs every benchmark case against one or more models and prints how often
// each pointed at a right control, and how long a step took.
//
//   npm run eval -- --models mock
//   npm run eval -- --models claude-opus-5-5,claude-haiku-5-5@off,claude-sonnet-5-5@off
//
// It goes through the same code as the live server (measureTurn), so what wins
// here is switched on with HAPTIC_MODEL, HAPTIC_EFFORT and HAPTIC_THINKING.

const HELP = `Usage: npm run eval -- --models <list> [options]

  --models <list>   Comma-separated. Each is a model ID, or "mock", with optional settings after @:
                    low, medium or high for effort, and off for no thinking.
                    Example: claude-haiku-5-5@off,claude-sonnet-5-5@medium
  --cases <names>   Comma-separated case files from eval/cases, without ".json". Default: all of them.
  --repeat <n>      Ask each case this many times. Default 1. More gives steadier timings.
  --limit <n>       Only the first n cases, for a quick check.
  --yes             Don't stop to show the number of calls first.

Real models need ANTHROPIC_API_KEY, and every call is billed.`;

const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));

interface Run {
  model: string;
  case: string;
  pass: boolean;
  statusAgrees: boolean;
  why: string;
  ms: number;
  msToTarget: number;
  /** False when the model's sentence had to be tidied before a visitor could be shown it. */
  clean: boolean;
  said: string;
  servedBy: string;
  tokens?: { input: number; cacheRead: number; cacheWrite: number; output: number };
  error?: string;
}

function parseModel(spec: string): { name: string; settings: TurnSettings } {
  const [model = "", ...flags] = spec.trim().split("@");
  const settings: TurnSettings = { model, effort: "low", thinking: "default" };
  for (const flag of flags) {
    if (flag === "low" || flag === "medium" || flag === "high") settings.effort = flag;
    else if (flag === "off") settings.thinking = "off";
    else throw new Error(`"${flag}" in "${spec}" isn't a setting. Use low, medium, high or off.`);
  }
  if (!model) throw new Error("A model is missing from --models.");
  return { name: spec.trim(), settings };
}

const percent = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "n/a");
const middle = (sorted: number[], share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;

async function main() {
  const { values } = parseArgs({
    options: {
      models: { type: "string" },
      cases: { type: "string" },
      repeat: { type: "string", default: "1" },
      limit: { type: "string" },
      yes: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help || !values.models) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }
  const models = values.models.split(",").filter(Boolean).map(parseModel);
  const repeat = Math.max(1, Number(values.repeat) || 1);
  const files = await loadCaseFiles(values.cases?.split(",").filter(Boolean));
  let work = files.flatMap(({ name, file }) => file.cases.map((item) => ({ file: name, site: file.site, item })));
  if (values.limit) work = work.slice(0, Math.max(1, Number(values.limit) || 1));
  if (!work.length) throw new Error("There are no cases to run. See eval/README.md for how to make some.");

  const calls = work.length * models.length * repeat;
  const billed = models.filter((model) => model.settings.model !== "mock").length * work.length * repeat;
  console.log(`${work.length} cases from ${files.map((file) => file.name).join(", ")}, ${models.length} model setting${models.length === 1 ? "" : "s"}, ${calls} calls${billed ? `, ${billed} of them billed` : ""}.`);
  if (billed && !values.yes) {
    console.log("Add --yes to run it.");
    return;
  }

  // Models take turns on each case, so a slow minute on the network hits them all alike.
  const runs: Run[] = [];
  for (const { item, site } of work) {
    for (let round = 0; round < repeat; round++) {
      for (const { name, settings } of models) {
        runs.push(await runOne(name, settings, item, site));
      }
    }
    process.stdout.write(".");
  }
  console.log("\n");

  const rows = models.map(({ name }) => {
    const mine = runs.filter((run) => run.model === name);
    const answered = mine.filter((run) => !run.error);
    const passed = answered.filter((run) => run.pass).length;
    const range = plausibleRange(passed, answered.length);
    const times = answered.map((run) => run.ms).sort((a, b) => a - b);
    const tokens = answered.filter((run) => run.tokens);
    const mean = (pick: (run: Run) => number) => (tokens.length ? Math.round(tokens.reduce((sum, run) => sum + pick(run), 0) / tokens.length) : 0);
    return {
      model: name,
      "right pointer": `${passed}/${answered.length} (${percent(passed, answered.length)})`,
      "plausible range": `${Math.round(range.low * 100)}-${Math.round(range.high * 100)}%`,
      "status agrees": percent(answered.filter((run) => run.statusAgrees).length, answered.length),
      "clean sentence": percent(answered.filter((run) => run.clean).length, answered.length),
      "ms to pointer": middle(answered.map((run) => run.msToTarget).sort((a, b) => a - b), 0.5),
      "typical ms": middle(times, 0.5),
      "slow ms (9 in 10 are faster)": middle(times, 0.9),
      "tokens in / cached / out": tokens.length ? `${mean((run) => run.tokens!.input)} / ${mean((run) => run.tokens!.cacheRead)} / ${mean((run) => run.tokens!.output)}` : "n/a",
      errors: mine.length - answered.length,
    };
  });
  console.table(rows);

  for (const { name } of models) {
    const misses = runs.filter((run) => run.model === name && (run.error || !run.pass));
    if (!misses.length) continue;
    console.log(`\n${name} missed:`);
    for (const miss of misses) console.log(`  ${miss.case}: ${miss.error ?? miss.why}`);
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const out = `${RESULTS_DIR}${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(out, JSON.stringify({ at: new Date().toISOString(), models: models.map((model) => model.name), repeat, summary: rows, runs }, null, 2) + "\n");
  console.log(`\nEvery answer is in ${out}`);
}

async function runOne(name: string, settings: TurnSettings, item: Case, site: Parameters<typeof measureTurn>[0]): Promise<Run> {
  const base = { model: name, case: item.id };
  try {
    const measure = await measureTurn(site, { ...item.request, site: site.id }, settings);
    const result = score(item, measure.reply);
    return { ...base, ...result, ms: measure.ms, msToTarget: measure.msToTarget, clean: measure.wrote === measure.reply.say, said: measure.reply.say, servedBy: measure.model, ...(measure.tokens ? { tokens: measure.tokens } : {}) };
  } catch (error) {
    // Bad credentials fail every call the same way, so there's no point going on.
    if (error instanceof TurnError && error.status === 500) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, pass: false, statusAgrees: false, why: "", ms: 0, msToTarget: 0, clean: false, said: "", servedBy: "", error: message };
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
