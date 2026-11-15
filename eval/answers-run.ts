import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { measureTurn, TurnError, type TurnSettings } from "../src/server/model.ts";
import type { Mode } from "../src/shared/types.ts";
import { ANSWERS_DIR, gate, loadAnswerFiles, requestFor, scoreAnswer, type AnswerCase, type AnswerFile, type AnswerScore, type Kind, type Marks } from "./answers.ts";
import { judge, JUDGE_MODEL, type Judged, type Verdict } from "./judge.ts";
import { middle, parseModel, percent } from "./models.ts";

// Runs the Answers benchmark: every question in eval/answers against one or
// more models, through the same code as the live server.
//
//   npm run eval:answers -- --models mock
//   npm run eval:answers -- --models claude-sonnet-5-5,claude-haiku-5-5 --judge --yes
//   npm run eval:answers -- --check-judge --yes

const HELP = `Usage: npm run eval:answers -- --models <list> [options]

  --models <list>   Comma-separated, as for npm run eval: a model ID or "mock", with optional settings after @.
  --cases <names>   Comma-separated files from eval/answers, without ".json". Default: all of them.
  --kinds <list>    Only cases of these kinds, like uncovered,sensitive.
  --limit <n>       Only the first n cases, for a quick check.
  --judge           Have the judge model read each answer: is it right, and is it all in the docs it cites.
                    One more billed call for every answer in words. The judge is ${JUDGE_MODEL}.
  --gate            Fail (exit 1) unless every model reaches the marks set in the case file.
  --check-judge     Run only the judge, on the answers in eval/answers/judge-check.json that a person has
                    labelled, and say how often it agrees. Do this before believing --judge.
  --yes             Don't stop to show the number of calls first.

Real models need ANTHROPIC_API_KEY, and every call is billed.`;

const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));

interface Run {
  model: string;
  file: string;
  case: string;
  kind: Kind;
  score?: AnswerScore;
  mode?: Mode;
  said: string;
  cited: string[];
  overruled?: string;
  ms: number;
  msToMode: number;
  usd: number;
  verdict?: Verdict;
  error?: string;
}

async function main() {
  const { values } = parseArgs({
    options: {
      models: { type: "string" },
      cases: { type: "string" },
      kinds: { type: "string" },
      limit: { type: "string" },
      judge: { type: "boolean", default: false },
      gate: { type: "boolean", default: false },
      "check-judge": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values["check-judge"]) return checkJudge(values.yes);
  if (values.help || !values.models) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }

  const models = values.models.split(",").filter(Boolean).map(parseModel);
  const files = await loadAnswerFiles(values.cases?.split(",").filter(Boolean));
  const kinds = values.kinds?.split(",").filter(Boolean);
  let work = files.flatMap(({ name, file }) => file.cases.filter((item) => !kinds || kinds.includes(item.kind)).map((item) => ({ name, file, item })));
  if (values.limit) work = work.slice(0, Math.max(1, Number(values.limit) || 1));
  if (!work.length) throw new Error("There are no Answers cases to run. See eval/README.md for how they are made.");

  const real = models.filter((model) => model.settings.model !== "mock").length;
  const calls = work.length * models.length;
  console.log(
    `${work.length} questions from ${files.map((file) => file.name).join(", ")}, ${models.length} model setting${models.length === 1 ? "" : "s"}, ${calls} calls${real ? `, ${real * work.length} of them billed` : ""}` +
      `${values.judge ? `, and up to ${calls} more to the judge` : ""}.`,
  );
  if ((real || values.judge) && !values.yes) {
    console.log("Add --yes to run it.");
    return;
  }

  // Models take turns on each question, so a slow minute on the network hits them all alike.
  const runs: Run[] = [];
  for (const { name, file, item } of work) {
    for (const model of models) runs.push(await runOne(model.name, model.settings, name, file, item, values.judge));
    process.stdout.write(".");
  }
  console.log("\n");

  const share = (list: Run[], pick: (score: AnswerScore) => boolean | undefined) => {
    const scored = list.flatMap((run) => (run.score && pick(run.score) !== undefined ? [pick(run.score) as boolean] : []));
    return { part: scored.filter(Boolean).length, whole: scored.length };
  };
  const shown = ({ part, whole }: { part: number; whole: number }) => (whole ? `${part}/${whole} (${percent(part, whole)})` : "n/a");

  let failed = false;
  const rows = models.map(({ name }) => {
    const mine = runs.filter((run) => run.model === name && !run.error);
    const judged = mine.filter((run) => run.verdict);
    const tally = {
      routed: share(mine, (score) => score.routed),
      declinedRightly: share(mine, (score) => score.declinedRightly),
      declinedWrongly: share(mine, (score) => score.declinedWrongly),
      sourced: share(mine, (score) => score.sourced),
      pointed: share(mine, (score) => score.pointed),
      kept: share(mine, (score) => score.kept),
    };
    for (const { name: fileName, file } of files) {
      if (!values.gate || !file.marks) continue;
      const shares = Object.fromEntries(Object.entries(tally).flatMap(([key, value]) => (value.whole ? [[key, value.part / value.whole]] : []))) as Partial<Record<keyof Marks, number>>;
      const result = gate(file.marks, shares);
      console.log(`${name} against the marks in ${fileName}.json:\n  ${result.lines.join("\n  ")}\n`);
      if (!result.pass) failed = true;
    }
    return {
      model: name,
      "right kind of reply": shown(tally.routed),
      "declined what it should": shown(tally.declinedRightly),
      "declined what the docs cover": shown(tally.declinedWrongly),
      "right article": shown(tally.sourced),
      "right pointer": shown(tally.pointed),
      "nothing forbidden said": shown(tally.kept),
      ...(values.judge ? { "judged right": shown({ part: judged.filter((run) => run.verdict!.correct).length, whole: judged.length }), "judged all in the docs": shown({ part: judged.filter((run) => run.verdict!.supported).length, whole: judged.length }) } : {}),
      "overruled by the server": mine.filter((run) => run.overruled).length,
      "ms to kind of reply": middle(mine.map((run) => run.msToMode).sort((a, b) => a - b), 0.5),
      "typical ms": middle(mine.map((run) => run.ms).sort((a, b) => a - b), 0.5),
      "cents a reply": mine.length ? ((100 * mine.reduce((sum, run) => sum + run.usd, 0)) / mine.length).toFixed(2) : "n/a",
      errors: runs.filter((run) => run.model === name && run.error).length,
    };
  });
  console.table(rows);

  for (const { name } of models) {
    const misses = runs.filter((run) => run.model === name && (run.error || run.score?.why.length || (run.verdict && !(run.verdict.correct && run.verdict.supported))));
    if (!misses.length) continue;
    console.log(`\n${name} missed:`);
    for (const miss of misses) {
      const judged = miss.verdict && !(miss.verdict.correct && miss.verdict.supported) ? [`the judge said ${[!miss.verdict.correct && "not right", !miss.verdict.supported && "not all in the docs"].filter(Boolean).join(" and ")}: "${miss.said}"`] : [];
      console.log(`  ${miss.case} (${miss.kind}): ${miss.error ?? [...(miss.score?.why ?? []), ...judged].join("; ")}`);
    }
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const out = `${RESULTS_DIR}answers-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(out, JSON.stringify({ at: new Date().toISOString(), models: models.map((model) => model.name), judge: values.judge ? JUDGE_MODEL : null, summary: rows, runs }, null, 2) + "\n");
  console.log(`\nEvery reply is in ${out}`);
  if (failed) process.exit(1);
}

async function runOne(name: string, settings: TurnSettings, fileName: string, file: AnswerFile, item: AnswerCase, judged: boolean): Promise<Run> {
  const base = { model: name, file: fileName, case: item.id, kind: item.kind };
  try {
    const measure = await measureTurn(file.site, requestFor(file, item), settings);
    const { reply } = measure;
    const run: Run = {
      ...base,
      score: scoreAnswer(file, item, reply, measure.cited),
      said: reply.say,
      cited: measure.cited,
      ms: measure.ms,
      msToMode: measure.msToMode ?? measure.ms,
      usd: measure.usd,
      ...(reply.mode ? { mode: reply.mode } : {}),
      ...(measure.overruled ? { overruled: measure.overruled } : {}),
    };
    if (judged && reply.mode === "answer" && item.expect.reference) {
      const articles = file.site.docs.filter((doc) => measure.cited.includes(doc.source)).map((doc) => ({ title: doc.title, text: doc.text }));
      run.verdict = await judge({ question: item.question, reference: item.expect.reference, articles, answer: reply.say });
    }
    return run;
  } catch (error) {
    // Bad credentials fail every call the same way, so there's no point going on.
    if (error instanceof TurnError && error.status === 500) throw error;
    return { ...base, said: "", cited: [], ms: 0, msToMode: 0, usd: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

/** An answer a person has read and labelled, for checking the judge against. */
interface Labelled extends Judged {
  id: string;
  correct: boolean;
  supported: boolean;
}

async function checkJudge(yes: boolean) {
  const items = JSON.parse(await readFile(`${ANSWERS_DIR}judge-check.json`, "utf8")) as Labelled[];
  console.log(`${items.length} labelled answers, ${items.length} billed calls to ${JUDGE_MODEL}.`);
  if (!yes) return console.log("Add --yes to run it.");
  const wrong: string[] = [];
  const agreed = { correct: 0, supported: 0 };
  for (const item of items) {
    const verdict = await judge(item);
    for (const key of ["correct", "supported"] as const) {
      if (verdict[key] === item[key]) agreed[key]++;
      else wrong.push(`  ${item.id}: the judge said ${key} is ${verdict[key]}, the label says ${item[key]}`);
    }
    process.stdout.write(".");
  }
  console.log(`\n\nThe judge agreed with the labels on "right" for ${agreed.correct}/${items.length} (${percent(agreed.correct, items.length)}) and on "all in the docs" for ${agreed.supported}/${items.length} (${percent(agreed.supported, items.length)}).`);
  if (wrong.length) console.log(`It disagreed on:\n${wrong.join("\n")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
