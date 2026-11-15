import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { describeAction, keepShots, runDemo } from "./checks.ts";
import { KITS } from "./kits/index.ts";
import { coverageNote, faults, LEGEND, table } from "./report.ts";
import { bundle, launch, newContext, THIS_CHECKOUT } from "./session.ts";
import { KINDS, type DemoResult, type RunResults } from "./types.ts";

// Walks the public component galleries of the UI toolkits customers build
// with, and checks the widget against every kind of control. No model is
// called: each step's answer is scripted. See eval/README.md.
//
//   npm run eval:toolkits -- mui select
//   npm run eval:toolkits -- --widget ../other-checkout

const HELP = `Usage: npm run eval:toolkits -- [toolkit] [component] [options]

  toolkit          ${KITS.map((kit) => kit.id).join(", ")}, or all (the default).
  component        A kind of control (${KINDS.slice(0, 6).join(", ")}, ...) or a demo's name. All when left out.
  --widget <dir>   The checkout whose widget is tested. This one when left out.
  --table <file>   Print the table and the faults from a saved results file, and run nothing.
  --compare <file> Show each cell of the table beside the same cell of an earlier results file.
  --pause <ms>     Wait between demos, to keep a modest pace on other people's sites. 2000 by default.
  --shots <dir>    Keep a screenshot and the list the widget sent at each question, to look at a failure by hand.
  --headed         Show the browser.`;

const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      widget: { type: "string" },
      table: { type: "string" },
      compare: { type: "string" },
      pause: { type: "string", default: "2000" },
      headed: { type: "boolean", default: false },
      shots: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) return console.log(HELP);
  const before = values.compare ? (JSON.parse(await readFile(values.compare, "utf8")) as RunResults) : undefined;
  if (values.table) return print(JSON.parse(await readFile(values.table, "utf8")) as RunResults, before);

  const [kitArg = "all", component] = positionals;
  const kits = kitArg === "all" ? KITS : KITS.filter((kit) => kit.id === kitArg);
  if (!kits.length) throw new Error(`There is no toolkit "${kitArg}". ${HELP}`);
  const pick = (kind: string, demo: string) => !component || kind === component || demo === component;

  if (values.shots) keepShots(values.shots);
  const bundles = await bundle(values.widget ?? THIS_CHECKOUT);
  console.log(`Testing the widget from ${bundles.checkout} at ${bundles.commit}.`);
  if (!bundles.probeAll) console.log("Its length limits could not be found to lift, so a missing control cannot be told apart from one cut by a limit.");
  const browser = await launch(values.headed);
  const run: RunResults = { widget: { checkout: bundles.checkout, commit: bundles.commit }, startedAt: new Date().toISOString(), finishedAt: "", results: [] };
  const pause = Number(values.pause);
  try {
    for (const kit of kits) {
      const demos = kit.demos.filter((demo) => pick(demo.kind, demo.demo));
      if (!demos.length) continue;
      console.log(`\n${kit.name}`);
      const context = await newContext(browser, bundles);
      try {
        for (const demo of demos) {
          console.log(`  ${demo.kind} ${demo.demo || ""} ${demo.steps.length ? `(${demo.steps.map(describeAction).join(" then ")})` : ""}`);
          const result: DemoResult = await runDemo(context, bundles, kit, demo, (line) => console.log(line));
          if (!result.tested) console.log(`    not tested: ${result.why}`);
          for (const note of result.notes) console.log(`    note: ${note}`);
          run.results.push(result);
          if (!demo.skip && !demo.unreadable) await new Promise((resolve) => setTimeout(resolve, pause));
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  run.finishedAt = new Date().toISOString();
  await mkdir(RESULTS_DIR, { recursive: true });
  const file = `${RESULTS_DIR}${run.startedAt.slice(0, 19).replace(/[:T]/g, "-")}-${bundles.commit.split(" ")[0]}.json`;
  await writeFile(file, JSON.stringify(run, null, 1) + "\n");
  console.log(`\nResults: ${file}\n`);
  print(run, before);
}

function print(run: RunResults, before?: RunResults) {
  console.log(coverageNote(run));
  console.log(`\n${table(run, before)}\n\n${LEGEND}\n\nFaults, most widespread first:\n${faults(run)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
