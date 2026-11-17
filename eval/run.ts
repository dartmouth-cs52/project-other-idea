import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { TurnError } from "../src/server/model.ts";
import { isBlocked, type ControlName } from "../src/shared/corrections.ts";
import type { SiteContext } from "../src/shared/types.ts";
import { modelAsker, parseModel, serverAsker, type Asker } from "./ask.ts";
import { KINDS, loadCaseFiles, plausibleRange, score, type Case } from "./cases.ts";

// Runs every benchmark case against one or more models and prints how often
// each pointed at a right control, and how long a step took.
//
//   npm run eval -- --models mock
//   npm run eval -- --models claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5 --repeat 3 --yes
//   npm run eval -- --server https://widget.joinhaptic.com --yes
//
// --models goes through the same code as the live server (measureTurn), so
// what wins here is switched on with HAPTIC_MODEL, HAPTIC_EFFORT and
// HAPTIC_THINKING. --server asks a server that is already running, which
// needs no key here and measures the setting visitors actually get.

const HELP = `Usage: npm run eval -- (--models <list> | --server <address>) [options]

  --models <list>     Comma-separated. Each is a model ID, or "mock", with optional settings after @:
                      low, medium or high for effort, and off for no thinking.
                      Example: claude-haiku-5-5@off,claude-sonnet-5-5@medium
  --server <address>  Ask a running Haptic server instead, like https://widget.joinhaptic.com.
                      Each site has to be on it already (npm run site:publish).
  --cases <names>     Comma-separated case files from eval/cases, without ".json". Default: all of them.
  --split <which>     "held-out" for only the cases kept out of prompt tuning, "tuned" for only the rest. Default: both.
  --repeat <n>        Ask each case this many times. Default 1. More shows which cases a model gets right only sometimes.
  --limit <n>         Only the first n cases, for a quick check.
  --answers           With --models: ask every case as a site with Answers on would be asked, the longer prompt and
                      the reply with a mode. The right pointers are the same, so this shows whether guiding got worse.
                      Without it, each site is asked as it would be live: Answers is on for a site with help docs.
  --without-answers   With --models: ask every case with Answers off, the way every site was asked before it was on
                      by default.
  --without-corrections
                      With --models: ask every case as if its site had no corrections and no controls ruled out, to
                      see what they change. eval/cases/corrections.json is the file where it shows.
  --yes               Don't stop to show the number of calls first.

Real models need ANTHROPIC_API_KEY, and every call is billed, with --models and with --server alike.`;

const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));
/** Misses printed per model. All of them are in the results file. */
const MISSES_SHOWN = 40;

interface Run {
  model: string;
  file: string;
  case: string;
  kind: string;
  heldOut: boolean;
  pass: boolean;
  statusAgrees: boolean;
  /** The right control was not in the list the model was given, so no reply could have passed. */
  unlisted: boolean;
  /** The pointer went where planted text was trying to send it. */
  trapped: boolean;
  /** Unknown when a server answered: it sends the sentence already tidied. */
  clean?: boolean;
  /** The rules for a sentence that the model's own sentence broke, like "link" or "length". Part of it was not shown. Unknown when a server answered. */
  broke?: string[];
  /** The pointer went to a control the site's owner ruled out. Must never happen with them in place. */
  pointedAtBlocked?: boolean;
  why: string;
  ms: number;
  msToTarget: number;
  said: string;
  servedBy: string;
  tokens?: { input: number; cacheRead: number; cacheWrite: number; output: number };
  error?: string;
}

interface Work {
  file: string;
  site: SiteContext;
  item: Case;
  /** The controls the case file's site rules out, whether or not this run asks with them. */
  ruledOut: ControlName[];
}

const percent = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "n/a");
const middle = (sorted: number[], share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
const ascending = (values: number[]) => [...values].sort((a, b) => a - b);
const tally = (runs: Run[]) => {
  const answered = runs.filter((run) => !run.error);
  const passed = answered.filter((run) => run.pass).length;
  return answered.length ? `${passed}/${answered.length} (${percent(passed, answered.length)})` : "n/a";
};

async function main() {
  const { values } = parseArgs({
    options: {
      models: { type: "string" },
      server: { type: "string" },
      cases: { type: "string" },
      split: { type: "string" },
      repeat: { type: "string", default: "1" },
      limit: { type: "string" },
      answers: { type: "boolean", default: false },
      "without-answers": { type: "boolean", default: false },
      "without-corrections": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help || (!values.models && !values.server) || (values.models && values.server)) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }
  if (values.split && values.split !== "held-out" && values.split !== "tuned") throw new Error('--split is "held-out" or "tuned".');
  if (values.server && (values.answers || values["without-answers"] || values["without-corrections"])) throw new Error("--answers, --without-answers and --without-corrections change the site as this machine asks it, so they go with --models.");
  const askers: { name: string; ask: Asker; billed: boolean }[] = values.server
    ? [{ name: values.server.replace(/^https?:\/\//, ""), ask: serverAsker(values.server), billed: true }]
    : values.models!.split(",").filter(Boolean).map((spec) => {
        const { name, settings } = parseModel(spec);
        return { name, ask: modelAsker(settings), billed: settings.model !== "mock" };
      });
  const repeat = Math.max(1, Number(values.repeat) || 1);

  const files = await loadCaseFiles(values.cases?.split(",").filter(Boolean));
  // With --answers each site is asked as if it had Answers switched on, and with --without-answers as if off.
  // Its help docs and everything else stay as they were.
  // With --without-corrections the owner's corrections and ruled-out controls are taken away, and nothing else.
  const asked = (site: SiteContext): SiteContext => {
    const forced = values.answers ? true : values["without-answers"] ? false : undefined;
    const changed = forced === undefined ? { ...site } : { ...site, answers: { ...site.answers, enabled: forced } };
    if (values["without-corrections"]) {
      delete changed.corrections;
      delete changed.blocked;
    }
    return changed;
  };
  const all: Work[] = files.flatMap(({ name, file }) => {
    const site = asked(file.site);
    return file.cases.map((item) => ({ file: name, site, item, ruledOut: file.site.blocked ?? [] }));
  });
  const unchecked = all.filter(({ item }) => item.reviewed === false).length;
  let work = all.filter(({ item }) => item.reviewed !== false && (!values.split || (values.split === "held-out") === !!item.heldOut));
  if (values.limit) work = work.slice(0, Math.max(1, Number(values.limit) || 1));
  if (!work.length) throw new Error("There are no cases to run. See eval/README.md for how to make some.");

  const calls = work.length * askers.length * repeat;
  const billed = askers.filter((asker) => asker.billed).length * work.length * repeat;
  console.log(
    `${work.length} cases from ${files.map((file) => file.name).join(", ")}${values.answers ? ", asked with Answers on" : values["without-answers"] ? ", asked with Answers off" : ""}${values["without-corrections"] ? ", without corrections" : ""}, ${askers.length} setting${askers.length === 1 ? "" : "s"}, ${calls} calls${billed ? `, ${billed} of them billed` : ""}.` +
      (unchecked ? ` ${unchecked} cases drafted from real sessions are left out until someone has checked them.` : ""),
  );
  if (billed && !values.yes) {
    console.log("Add --yes to run it.");
    return;
  }

  // Models take turns on each case, so a slow minute on the network hits them all alike.
  const runs: Run[] = [];
  for (const each of work) {
    for (let round = 0; round < repeat; round++) {
      for (const asker of askers) runs.push(await runOne(asker.name, asker.ask, each));
    }
    process.stdout.write(".");
  }
  console.log("\n");

  const of = (name: string, keep: (run: Run) => boolean = () => true) => runs.filter((run) => run.model === name && keep(run));

  // The headline: every case, and the same again without the steps no model could have passed.
  const summary = askers.map(({ name }) => {
    const answered = of(name, (run) => !run.error);
    const passed = answered.filter((run) => run.pass).length;
    const range = plausibleRange(passed, answered.length);
    const listed = answered.filter((run) => !run.unlisted);
    const cleanKnown = answered.filter((run) => run.clean !== undefined);
    const rulesKnown = answered.filter((run) => run.broke !== undefined);
    const tokens = answered.filter((run) => run.tokens);
    const mean = (pick: (run: Run) => number) => (tokens.length ? Math.round(tokens.reduce((sum, run) => sum + pick(run), 0) / tokens.length) : 0);
    return {
      model: name,
      "right pointer": `${passed}/${answered.length} (${percent(passed, answered.length)})`,
      "plausible range": `${Math.round(range.low * 100)}-${Math.round(range.high * 100)}%`,
      "when the control was listed": `${passed}/${listed.length} (${percent(passed, listed.length)})`,
      "status agrees": percent(answered.filter((run) => run.statusAgrees).length, answered.length),
      "clean sentence": cleanKnown.length ? percent(cleanKnown.filter((run) => run.clean).length, cleanKnown.length) : "n/a",
      "within the rules": rulesKnown.length ? percent(rulesKnown.filter((run) => run.broke!.length === 0).length, rulesKnown.length) : "n/a",
      "pointed at a ruled-out control": answered.filter((run) => run.pointedAtBlocked).length,
      "ms to pointer": middle(ascending(answered.map((run) => run.msToTarget)), 0.5),
      "typical ms": middle(ascending(answered.map((run) => run.ms)), 0.5),
      "slow ms (9 in 10 are faster)": middle(ascending(answered.map((run) => run.ms)), 0.9),
      "tokens in / cached / out": tokens.length ? `${mean((run) => run.tokens!.input)} / ${mean((run) => run.tokens!.cacheRead)} / ${mean((run) => run.tokens!.output)}` : "n/a",
      errors: of(name).length - answered.length,
    };
  });
  console.table(summary);

  // The same score, cut three ways. A column per model.
  const cut = (title: string, groups: { label: string; keep: (run: Run) => boolean }[]) => {
    const rows = groups
      .filter((group) => runs.some(group.keep))
      .map((group) => ({ [title]: group.label, ...Object.fromEntries(askers.map(({ name }) => [name, tally(of(name, group.keep))])) }));
    if (rows.length > 1) console.table(rows);
    return rows;
  };
  const bySite = cut("site", files.map((file) => ({ label: file.name, keep: (run: Run) => run.file === file.name })));
  const byKind = cut("kind of case", KINDS.map((kind) => ({ label: kind, keep: (run: Run) => run.kind === kind })));
  const bySplit = cut("", [
    { label: "tuned on", keep: (run: Run) => !run.heldOut },
    { label: "held out", keep: (run: Run) => run.heldOut },
  ]);

  // What the widget gave the model to work with, whichever model it was.
  const pages = files
    .map(({ name }) => {
      const mine = work.filter((each) => each.file === name);
      if (!mine.length) return undefined;
      const sizes = ascending(mine.map(({ item }) => item.request.snapshot.elements.length));
      const controls = mine.flatMap(({ item }) => item.request.snapshot.elements);
      const wanted = mine.filter(({ item }) => item.expect.targets.length);
      return {
        site: name,
        steps: mine.length,
        "right control not listed": `${mine.filter(({ item }) => item.expect.unlisted).length} of ${wanted.length}`,
        "step never asked for": mine.filter(({ item }) => item.expect.unheard).length,
        "controls on a page, typical": middle(sizes, 0.5),
        most: sizes[sizes.length - 1] ?? 0,
        "pages cut at the limit": mine.filter(({ item }) => item.request.snapshot.truncated).length,
        "controls with no name": percent(controls.filter((element) => !element.label && !element.icon).length, controls.length),
      };
    })
    .filter((row) => row !== undefined);
  console.log("What the widget gave the model to work with:");
  console.table(pages);

  const trapped = askers.map(({ name }) => ({ model: name, "followed planted text": `${of(name, (run) => run.trapped && run.kind === "hostile").length} of ${of(name, (run) => run.kind === "hostile" && !run.error).length} hostile cases` }));
  if (runs.some((run) => run.kind === "hostile")) console.table(trapped);

  // With repeats, a case a model gets right only sometimes is worth knowing about.
  let steadiness: Record<string, string | number>[] = [];
  if (repeat > 1) {
    steadiness = askers.map(({ name }) => {
      const perCase = new Map<string, Run[]>();
      for (const run of of(name, (each) => !each.error)) perCase.set(`${run.file}/${run.case}`, [...(perCase.get(`${run.file}/${run.case}`) ?? []), run]);
      const groups = [...perCase.values()];
      return {
        model: name,
        "right every time": groups.filter((group) => group.every((run) => run.pass)).length,
        "right sometimes": groups.filter((group) => group.some((run) => run.pass) && !group.every((run) => run.pass)).length,
        "never right": groups.filter((group) => !group.some((run) => run.pass)).length,
      };
    });
    console.table(steadiness);
  }

  for (const { name } of askers) {
    const misses = of(name, (run) => !!run.error || (!run.pass && !run.unlisted));
    if (!misses.length) continue;
    console.log(`\n${name} missed${misses.length > MISSES_SHOWN ? ` (the first ${MISSES_SHOWN} of ${misses.length}; the rest are in the results file)` : ""}:`);
    for (const miss of misses.slice(0, MISSES_SHOWN)) console.log(`  ${miss.file}/${miss.case}: ${miss.error ?? miss.why}`);
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const out = `${RESULTS_DIR}${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(
    out,
    JSON.stringify({ at: new Date().toISOString(), models: askers.map((asker) => asker.name), repeat, summary, bySite, byKind, bySplit, pages, trapped, steadiness, runs }, null, 2) + "\n",
  );
  console.log(`\nEvery answer is in ${out}`);
}

async function runOne(name: string, ask: Asker, { file, site, item, ruledOut }: Work): Promise<Run> {
  const base = { model: name, file, case: item.id, kind: item.kind ?? "task", heldOut: !!item.heldOut };
  try {
    const asked = await ask(site, item.request);
    const result = score(item, asked.reply);
    const pointed = item.request.snapshot.elements.find((element) => element.id === asked.reply.target);
    return {
      ...base,
      ...result,
      ...(isBlocked(pointed, ruledOut) ? { pointedAtBlocked: true } : {}),
      ms: asked.ms,
      msToTarget: asked.msToTarget,
      said: asked.reply.say,
      servedBy: asked.servedBy,
      ...(asked.clean !== undefined ? { clean: asked.clean } : {}),
      ...(asked.broke !== undefined ? { broke: asked.broke } : {}),
      ...(asked.tokens ? { tokens: asked.tokens } : {}),
    };
  } catch (error) {
    // Bad credentials fail every call the same way, so there's no point going on.
    if (error instanceof TurnError && error.status === 500) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, pass: false, statusAgrees: false, unlisted: !!item.expect.unlisted, trapped: false, why: "", ms: 0, msToTarget: 0, said: "", servedBy: "", error: message };
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
