import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { bundle, launch, THIS_CHECKOUT, type Browser } from "../toolkits/session.ts";
import { keepShots, sweepSite } from "./checks.ts";
import { cspSite } from "./csp.ts";
import { printRun } from "./report.ts";
import { pickSites, type Site } from "./sites.ts";
import type { CspResult, SiteResult, SweepRun } from "./types.ts";

// Puts Haptic's tag into public sites that are not the benchmark's apps, and
// checks, with no model and no server, that it works there: it mounts and
// stays out of the way, it reads the page, the page behaves the same with it
// idle, and one scripted step points, is used with the real mouse, and is
// heard. See eval/README.md.
//
//   npm run eval:sweep -- --sites gov,docs
//   npm run eval:sweep -- --widget ../other-checkout
//   npm run eval:sweep -- --csp

const HELP = `Usage: npm run eval:sweep -- [options]

  --sites <list>   Site ids or kinds, separated by commas (see eval/sweep/sites.ts). All sites when left out.
  --widget <dir>   The checkout whose widget is tested. This one when left out.
  --csp            Load each page with its Content Security Policy in force, and report whether Haptic's
                   script and its requests would be blocked. Run on its own.
  --pause <ms>     Wait between sites. 4000 by default.
  --resume <file>  Carry on a run that stopped: sites already in the file are not loaded again.
  --table <file>   Print the tables and faults from saved results, and run nothing.
  --shots <dir>    Keep screenshots of the launcher, the pointer and after the click, and the lists sent.
  --headed         Show the browser.`;

const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));
const HERE = fileURLToPath(new URL(".", import.meta.url));
/** A site is given this long in all before it is reported as taking too long. */
const SITE_LIMIT_MS = 6 * 60_000;

async function main() {
  const { values } = parseArgs({
    options: {
      sites: { type: "string" },
      widget: { type: "string" },
      csp: { type: "boolean", default: false },
      pause: { type: "string", default: "4000" },
      resume: { type: "string" },
      table: { type: "string" },
      shots: { type: "string" },
      headed: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) return console.log(HELP);
  if (values.table) {
    const run = JSON.parse(await readFile(values.table, "utf8")) as SweepRun;
    return console.log(printRun(run));
  }
  const sites = pickSites(values.sites);
  if (values.shots) keepShots(values.shots);
  const bundles = await bundle(values.widget ?? THIS_CHECKOUT);
  const sweepJs = (await build({ entryPoints: [`${HERE}inpage.ts`], bundle: true, format: "iife", target: "es2020", write: false })).outputFiles[0]!.text;
  const mode = values.csp ? "csp" : "sweep";

  let run: SweepRun = {
    mode,
    widget: { checkout: bundles.checkout, commit: bundles.commit, fingerprint: bundles.fingerprint },
    startedAt: new Date().toISOString(),
    finishedAt: "",
    results: [],
    csp: [],
  };
  let file = `${RESULTS_DIR}${run.startedAt.slice(0, 19).replace(/[:T]/g, "-")}-${mode}-${bundles.fingerprint}.json`;
  if (values.resume) {
    run = JSON.parse(await readFile(values.resume, "utf8")) as SweepRun;
    if (run.mode !== mode) throw new Error(`${values.resume} is a ${run.mode} run, and this is a ${mode} run.`);
    if (run.widget.fingerprint !== bundles.fingerprint) throw new Error(`${values.resume} was run on widget ${run.widget.fingerprint}, and this widget is ${bundles.fingerprint}.`);
    file = values.resume;
  }
  const done = new Set([...run.results, ...run.csp].map((r) => r.id));
  console.log(`Testing the widget from ${bundles.checkout} at ${bundles.commit} (widget ${bundles.fingerprint}) on ${sites.length} sites${values.csp ? ", with each page's Content Security Policy in force" : ""}.`);
  console.log(`Results: ${file}`);
  await mkdir(RESULTS_DIR, { recursive: true });

  let browser: Browser = await launch(values.headed);
  const pause = Number(values.pause);
  try {
    for (const [n, site] of sites.entries()) {
      if (done.has(site.id)) continue;
      console.log(`\n[${n + 1}/${sites.length}] ${site.id} ${site.url}`);
      // A browser that crashed on the last site is started again.
      if (!browser.isConnected()) browser = await launch(values.headed);
      const result: SiteResult | CspResult = values.csp
        ? await withLimit<CspResult>(site, () => cspSite(browser, bundles, sweepJs, site, log), browser)
        : await withLimit<SiteResult>(site, () => sweepSite(browser, bundles, sweepJs, site, log), browser);
      if ("policy" in result) run.csp.push(result);
      else run.results.push(result);
      if (result.status !== "tested") console.log(`    ${result.status}: ${result.whyNot}`);
      await writeFile(file, JSON.stringify(run, null, 1) + "\n");
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  run.finishedAt = new Date().toISOString();
  await writeFile(file, JSON.stringify(run, null, 1) + "\n");
  const printed = printRun(run);
  await writeFile(file.replace(/\.json$/, ".md"), printed + "\n");
  console.log(`\n${printed}\n\nResults: ${file}`);
}

function log(line: string) {
  console.log(line);
}

/** Runs one site's checks, and reports it as taking too long if it has not finished in time. The browser is started again after. */
async function withLimit<T extends SiteResult | CspResult>(site: Site, check: () => Promise<T>, browser: Browser): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      // Closing the browser ends whatever the check was waiting on; the next site starts a new one.
      void browser.close().catch(() => undefined);
      resolve({ id: site.id, url: site.url, kinds: site.kinds, why: site.why, status: "could not test", whyNot: `the checks took longer than ${SITE_LIMIT_MS / 60_000} minutes`, loads: [], notes: [], ms: SITE_LIMIT_MS, at: new Date().toISOString() } as unknown as T);
    }, SITE_LIMIT_MS);
  });
  try {
    return await Promise.race([check(), limit]);
  } finally {
    clearTimeout(timer);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
