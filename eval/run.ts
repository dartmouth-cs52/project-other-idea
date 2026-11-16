import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { measureTurn, tidySay, TurnError, type TurnSettings } from "../src/server/model.ts";
import { isBlocked } from "../src/shared/corrections.ts";
import { loadCaseFiles, plausibleRange, score, type Case } from "./cases.ts";
import { middle, parseModel, percent } from "./models.ts";

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
  --answers         Ask every case as a site with Answers on would be asked: the longer prompt and the reply
                    with a mode. The right pointers are the same, so this shows whether guiding got worse.
                    Without it, each site is asked as it would be live: Answers is on for a site with help docs.
  --without-answers Ask every case with Answers off, the way every site was asked before it was on by default.
  --without-corrections
                    Ask every case as if its site had no corrections and no controls ruled out, to see what they change.
                    eval/cases/corrections.json is the file where it shows.
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
  /** False when the model's sentence had to be tidied before a visitor could be shown it: stray space or a closing brace at its ends. */
  clean: boolean;
  /** The rules for a sentence that the model's own sentence broke, like "link" or "length". Part of it was not shown. */
  broke: string[];
  /** The pointer went to a control the site's owner ruled out. Must never happen with them in place. */
  pointedAtBlocked?: boolean;
  said: string;
  /** The id pointed at, or null. */
  target?: string | null;
  servedBy: string;
  tokens?: { input: number; cacheRead: number; cacheWrite: number; output: number };
  error?: string;
}

async function main() {
  const { values } = parseArgs({
    options: {
      models: { type: "string" },
      cases: { type: "string" },
      repeat: { type: "string", default: "1" },
      limit: { type: "string" },
      answers: { type: "boolean", default: false },
      "without-answers": { type: "boolean", default: false },
      "without-corrections": { type: "boolean", default: false },
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
  // With --answers each site is asked as if it had Answers switched on, and with --without-answers as if off.
  // Its help docs and everything else stay as they were.
  // With --without-corrections the owner's corrections and ruled-out controls are taken away, and nothing else.
  const asked = (site: (typeof files)[number]["file"]["site"]) => {
    const forced = values.answers ? true : values["without-answers"] ? false : undefined;
    const changed = forced === undefined ? { ...site } : { ...site, answers: { ...site.answers, enabled: forced } };
    if (values["without-corrections"]) {
      delete changed.corrections;
      delete changed.blocked;
    }
    return changed;
  };
  let work = files.flatMap(({ name, file }) => file.cases.map((item) => ({ file: name, site: asked(file.site), ruledOut: file.site.blocked ?? [], item })));
  if (values.limit) work = work.slice(0, Math.max(1, Number(values.limit) || 1));
  if (!work.length) throw new Error("There are no cases to run. See eval/README.md for how to make some.");

  const calls = work.length * models.length * repeat;
  const billed = models.filter((model) => model.settings.model !== "mock").length * work.length * repeat;
  console.log(`${work.length} cases from ${files.map((file) => file.name).join(", ")}${values.answers ? ", asked with Answers on" : values["without-answers"] ? ", asked with Answers off" : ""}${values["without-corrections"] ? ", without corrections" : ""}, ${models.length} model setting${models.length === 1 ? "" : "s"}, ${calls} calls${billed ? `, ${billed} of them billed` : ""}.`);
  if (billed && !values.yes) {
    console.log("Add --yes to run it.");
    return;
  }

  // Models take turns on each case, so a slow minute on the network hits them all alike.
  const runs: Run[] = [];
  for (const { item, site, ruledOut } of work) {
    for (let round = 0; round < repeat; round++) {
      for (const { name, settings } of models) {
        const run = await runOne(name, settings, item, site);
        const pointed = item.request.snapshot.elements.find((element) => element.id === run.target);
        if (isBlocked(pointed, ruledOut)) run.pointedAtBlocked = true;
        runs.push(run);
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
      "within the rules": percent(answered.filter((run) => run.broke.length === 0).length, answered.length),
      "pointed at a ruled-out control": answered.filter((run) => run.pointedAtBlocked).length,
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
    return { ...base, ...result, target: measure.reply.target, ms: measure.ms, msToTarget: measure.msToTarget, clean: tidySay(measure.wrote) === measure.wrote, broke: measure.broke, said: measure.reply.say, servedBy: measure.model, ...(measure.tokens ? { tokens: measure.tokens } : {}) };
  } catch (error) {
    // Bad credentials fail every call the same way, so there's no point going on.
    if (error instanceof TurnError && error.status === 500) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, pass: false, statusAgrees: false, why: "", ms: 0, msToTarget: 0, clean: false, broke: [], said: "", servedBy: "", error: message };
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
