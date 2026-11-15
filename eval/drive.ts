import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { describeElement, type SiteContext, type SnapElement, type Snapshot, type TurnReply } from "../src/shared/types.ts";
import { modelAsker, parseModel, serverAsker, type Asker } from "./ask.ts";
import { ask, launch, loadGuideSet, open, reachedOrWhy, siteFor, type Browser, type Page } from "./browser.ts";
import { matches, plausibleRange } from "./cases.ts";
import type { Guide, GuideSet } from "./guide.ts";

// Whole guides, start to finish. For each guide in eval/guides/<name>.ts a
// browser opens the site, asks the question in the real widget, and then does
// whatever the pointer shows, the way a visitor who trusts it would. The model
// gives every step itself. The run is scored on one thing: did the visitor end
// up where they wanted to be.
//
// This is what the single-step cases cannot show. There, every step starts
// from the right page. Here, a wrong step leaves the model to deal with where
// it led, and a guide of six steps needs all six.
//
//   npm run eval:guides -- demo joinhaptic --server https://widget.joinhaptic.com
//   npm run eval:guides -- ui5 --model claude-sonnet-5-5 --repeat 3
//
// --server asks a running Haptic server, which needs the site published there
// and no key here. --model calls a model from this machine, which needs
// ANTHROPIC_API_KEY. Either way every step is billed.

const HELP = `Usage: npm run eval:guides -- <guide sets…> (--server <address> | --model <model>) [options]

  --server <address>  Ask a running Haptic server, like https://widget.joinhaptic.com.
  --model <model>     Call a model from here: a model ID with optional @low, @medium, @high or @off, or "mock".
  --only <prefix>     Only guides whose id starts with this. Repeat for more.
  --repeat <n>        Run each guide this many times. Default 1.
  --parallel <n>      How many sites to run at once. Default 1.`;

const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));

/** A guide may take this many steps more than its script before it counts as going round in circles. */
const EXTRA_STEPS = 4;
/** How long the widget may take to ask for the next step after the visitor acts: the page settling, a page load. */
const NEXT_STEP_MS = 40_000;
/**
 * On a site other people use, the run stops before a control that could send,
 * buy, save or delete, unless the script says that control is where it ends.
 */
const RISKY = /\b(delete|remove|discard|pay|buy|purchase|place order|order now|send|submit|publish|save|create|add|apply|confirm|register|sign up|invite|approve|reject|merge|close|archive|transfer|export|download|subscribe)\b/i;

type End =
  /** The visitor ended up where they wanted to be. */
  | "reached"
  /** The model said it was done, or had nothing to point at, somewhere else. */
  | "stopped short"
  /** It kept giving steps past the limit. */
  | "went in circles"
  /** The widget stopped asking for steps: it gave up, or the visitor's action never registered. */
  | "stalled"
  /** It pointed at a control that must not be pressed on a site other people use. Not counted either way. */
  | "cut short"
  /** The model or the server failed. */
  | "error";

interface StepLog {
  path: string;
  pointed: string;
  status: string;
  say: string;
  did: string;
  ms: number;
  msToTarget: number;
  /** The caption or something else was on top of the control, so a visitor could not have clicked its middle. */
  covered?: boolean;
}

interface GuideRun {
  site: string;
  guide: string;
  kind: string;
  heldOut: boolean;
  end: End;
  why: string;
  steps: number;
  scripted: number;
  /** The goal was reached, and the model then pointed at something more. */
  overran: boolean;
  trail: StepLog[];
}

/** What a visitor types into a field nobody scripted a value for. */
function valueFor(listed: SnapElement, inputType: string): string {
  const label = listed.label.toLowerCase();
  if (inputType === "email" || /e-?mail/.test(label)) return "sam@example.com";
  if (inputType === "password" || /password/.test(label)) return "Example-pass-1";
  if (inputType === "number" || /quantity|amount|number of/.test(label)) return "2";
  if (inputType === "tel" || /phone|mobile/.test(label)) return "5550100";
  if (inputType === "date") return "2026-12-01";
  if (inputType === "url" || /website|url/.test(label)) return "https://example.com";
  if (/zip|postal|postcode/.test(label)) return "03755";
  if (/first name/.test(label)) return "Sam";
  if (/last name|surname/.test(label)) return "Okafor";
  if (/name/.test(label)) return "Sam Okafor";
  if (/city|town/.test(label)) return "Hanover";
  if (/address|street/.test(label)) return "1 Main Street";
  return "Test";
}

async function drive(browser: Browser, set: GuideSet, guide: Guide, site: SiteContext, asker: Asker): Promise<GuideRun> {
  const trail: StepLog[] = [];
  /** Every answer given, in order. `stepNo` is how many steps the widget said it had been given when it asked. */
  const replies: { reply: TurnReply; snapshot: Snapshot; stepNo: number }[] = [];
  let failure = "";

  const last = guide.steps[guide.steps.length - 1];
  // A script that ends on a control it does not press is over when that control is pointed at.
  const stopAt = last && last.expect.length && !last.act ? last.expect : [];
  const limit = guide.steps.length + EXTRA_STEPS;
  const result = (end: End, why: string, overran = false): GuideRun => ({
    site: set.siteId,
    guide: guide.id,
    kind: guide.kind ?? "task",
    heldOut: !!(guide.heldOut || set.heldOut),
    end,
    why,
    steps: trail.length,
    scripted: guide.steps.length,
    overran,
    trail,
  });
  // Signing in or loading the page can fail on a site that is slow or down. That is one guide lost, not the run.
  let opened: Awaited<ReturnType<typeof open>>;
  try {
    opened = await open(
      browser,
      set,
      guide.start,
      async (request) => {
        try {
          const asked = await asker(site, request);
          const pointed = asked.reply.target ? request.snapshot.elements.find((element) => element.id === asked.reply.target) : undefined;
          trail.push({
            path: request.snapshot.path,
            pointed: pointed ? describeElement(pointed) : "nothing",
            status: asked.reply.status,
            say: asked.reply.say,
            did: "",
            ms: asked.ms,
            msToTarget: asked.msToTarget,
          });
          replies.push({ reply: asked.reply, snapshot: request.snapshot, stepNo: request.step });
          return asked.reply;
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
          throw error;
        }
      },
      site,
    );
  } catch (error) {
    return result("error", `the site could not be opened: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`);
  }
  const { page, close } = opened;
  const reachedNow = async (wait: number) => (guide.reached ? (await reachedOrWhy(page, guide.reached, wait)) === "" : false);

  try {
    await ask(page, guide.goal);
    const captionNow = () => page.evaluate(() => document.querySelector("haptic-root")?.shadowRoot?.querySelector(".caption span")?.textContent ?? "").catch(() => "");
    // `at` is the answer being waited for or acted on. `step` counts the ones a visitor was actually shown.
    for (let step = 1, at = 0; ; step++, at++) {
      const deadline = Date.now() + NEXT_STEP_MS;
      while (replies.length <= at && !failure && Date.now() < deadline) await page.waitForTimeout(100);
      if (failure) return result("error", failure);
      if (replies.length <= at) {
        const caption = await captionNow();
        if (await reachedNow(500)) return result("reached", "");
        return result("stalled", `the widget did not ask for another step${caption ? `. It was showing: "${caption}"` : ""}`);
      }
      // The widget sets an answer aside when the page changed while it was on its
      // way, and asks again. A visitor never sees the first one. Wait until the
      // answer is on show, or until the widget has asked again for the same step.
      for (const shownBy = Date.now() + 8000; Date.now() < shownBy; ) {
        if (replies.length > at + 1 && replies[at + 1]!.stepNo === replies[at]!.stepNo) {
          trail[at]!.did = "nothing: the page had changed, so the widget asked again";
          at++;
          continue;
        }
        if ((await captionNow()) === replies[at]!.reply.say) break;
        await page.waitForTimeout(100);
      }

      const { reply, snapshot } = replies[at]!;
      const log = trail[at]!;
      const pointed = reply.target ? snapshot.elements.find((element) => element.id === reply.target) : undefined;

      if (pointed && stopAt.some((matcher) => matches(matcher, pointed, snapshot.elements))) {
        log.did = "stopped here, as the script does";
        return result("reached", "");
      }
      if (!pointed) {
        log.did = "nothing: the guide was over";
        if (stopAt.length) return result("stopped short", `it ended on "${reply.say}" without reaching ${stopAt.map((matcher) => `"${matcher.label}"`).join(" or ")}`);
        const why = guide.reached ? await reachedOrWhy(page, guide.reached) : "the script has no way to tell";
        return why ? result("stopped short", `it ended on "${reply.say}", but ${why}`) : result("reached", "");
      }
      // Already there, and it is still pointing: the visitor got what they wanted, with a step too many.
      if (await reachedNow(300)) {
        log.did = "nothing: already there";
        return result("reached", "", true);
      }
      if (step > limit) return result("went in circles", `${limit} steps were not enough for a guide scripted in ${guide.steps.length}`);
      // A control the script itself presses on this site has been checked by whoever wrote it.
      const vetted = guide.steps.some((scripted) => scripted.act && scripted.expect.some((matcher) => matches(matcher, pointed, snapshot.elements)));
      if (!set.sandbox && !vetted && RISKY.test(pointed.label)) {
        log.did = "stopped: not pressed on a site other people use";
        return result("cut short", `it pointed at ${describeElement(pointed)}, which is not pressed on a site other people use`);
      }
      if (set.never && new RegExp(set.never, "i").test(`${pointed.label} ${pointed.href ?? ""}`)) {
        log.did = "stopped: the script says never to use this here";
        return result("stopped short", `it pointed at ${describeElement(pointed)}, which has nothing to do with the goal and must not be used on this site`);
      }

      // Do what the pointer shows.
      await page.locator("haptic-root .cursor").waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(250);
      const handle = await page.evaluateHandle(() => (document.querySelector("haptic-root") as (Element & { pointedAt?: Element }) | null)?.pointedAt ?? null);
      const element = handle.asElement();
      if (!element) return result("stalled", `the pointer was not on anything, though the reply named ${describeElement(pointed)}`);
      const field = (await element.evaluate((el: Element) => {
        if (el instanceof HTMLSelectElement) return "select";
        if (el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable) return "text";
        if (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color"].includes(el.type)) return el.type || "text";
        return "";
      })) as string;

      // A visitor on the scripted path types what the script types. The script's
      // own selector says which field a value is for: "expect" alone would not,
      // since a step may accept any of several fields.
      let scripted: Guide["steps"][number] | undefined;
      for (const candidate of guide.steps) {
        const selector = candidate.act && ("fill" in candidate.act ? candidate.act.fill[0] : "select" in candidate.act ? candidate.act.select[0] : "");
        if (!selector) continue;
        const same = await page.locator(selector).first().evaluate((el: Element, other: Element) => el === other, element, { timeout: 1000 }).catch(() => false);
        if (same) {
          scripted = candidate;
          break;
        }
      }
      try {
        if (field === "select") {
          // The scripted choice when the list has it, and otherwise any choice other than the one showing.
          const labels = (await element.evaluate((el: HTMLSelectElement) => Array.from(el.options).map((option) => option.label))) as string[];
          const asScripted = scripted?.act && "select" in scripted.act ? labels.indexOf(scripted.act.select[1]) : -1;
          const index = asScripted >= 0 ? asScripted : labels.length > 1 ? 1 : 0;
          await element.selectOption({ index }, { timeout: 8000 });
          log.did = `picked "${labels[index] ?? ""}"`;
        } else if (field) {
          const value = scripted?.act && "fill" in scripted.act ? scripted.act.fill[1] : valueFor(pointed, field);
          await element.fill(value, { timeout: 8000 });
          log.did = `typed "${value}"`;
          if (/\b(press|hit)\s+(enter|return)\b/i.test(reply.say)) {
            await element.press("Enter");
            log.did += " and pressed Enter";
          }
        } else {
          try {
            await element.click({ timeout: 6000 });
          } catch {
            // Something is on top of it. A visitor would click whatever part they can reach.
            log.covered = true;
            await element.evaluate((el: Element) => (el as HTMLElement).click());
          }
          log.did = log.covered ? "clicked it, though something was on top of it" : "clicked it";
        }
      } catch (error) {
        return result("stalled", `${describeElement(pointed)} could not be used: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`);
      }

      // "done" with a pointer is the model's last word: it showed where, and a visitor uses it. Nothing more is coming.
      if (reply.status === "done") {
        if (stopAt.length) return result("stopped short", `it ended on ${describeElement(pointed)} without reaching ${stopAt.map((matcher) => `"${matcher.label}"`).join(" or ")}`);
        const why = guide.reached ? await reachedOrWhy(page, guide.reached) : "the script has no way to tell";
        return why ? result("stopped short", `it ended by pointing at ${describeElement(pointed)}, but ${why}`) : result("reached", "");
      }
    }
  } catch (error) {
    return result("error", (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "");
  } finally {
    await close().catch(() => undefined);
  }
}

const percent = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "n/a");
const middle = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      server: { type: "string" },
      model: { type: "string" },
      only: { type: "string", multiple: true },
      repeat: { type: "string", default: "1" },
      parallel: { type: "string", default: "1" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help || !positionals.length || (!values.server && !values.model) || (values.server && values.model)) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }
  const asker = values.server ? serverAsker(values.server) : modelAsker(parseModel(values.model!).settings);
  const answeredBy = values.server ?? values.model!;
  const repeat = Math.max(1, Number(values.repeat) || 1);

  const work: { name: string; set: GuideSet; site: SiteContext; guides: Guide[] }[] = [];
  for (const name of positionals) {
    const set = await loadGuideSet(name);
    const site = await siteFor(set);
    if (!site) throw new Error(`There is no ${set.siteId} in data/sites or in any case file. Build it with npm run tag.`);
    // A guide of one step has nothing to follow: the single-step cases already cover it.
    const guides = set.guides.filter((guide) => guide.steps.length > 1 && (!values.only?.length || values.only.some((start) => guide.id.startsWith(start))));
    if (guides.length) work.push({ name, set, site, guides });
  }
  const total = work.reduce((sum, item) => sum + item.guides.length, 0) * repeat;
  if (!total) throw new Error("There are no guides to run.");
  console.log(`${total} guide runs on ${work.length} site${work.length === 1 ? "" : "s"}, answered by ${answeredBy}.${answeredBy === "mock" ? "" : " Every step is billed."}\n`);

  const browser = await launch();
  const runs: GuideRun[] = [];
  try {
    const queue = [...work];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        for (const guide of item.guides) {
          for (let round = 0; round < repeat; round++) {
            const run = await drive(browser, item.set, guide, item.site, asker);
            runs.push(run);
            console.log(`${run.end === "reached" ? "ok  " : "FAIL"} ${item.name}/${guide.id}: ${run.end}${run.overran ? " (then pointed at more)" : ""} in ${run.steps} steps (script: ${run.scripted})${run.why ? `. ${run.why}` : ""}`);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Number(values.parallel) || 1) }, worker));
  } finally {
    await browser.close();
  }

  // "cut short" says nothing about the model either way, so it is left out of the rate.
  const row = (label: string, mine: GuideRun[]) => {
    const judged = mine.filter((run) => run.end !== "cut short");
    const reached = judged.filter((run) => run.end === "reached");
    const range = plausibleRange(reached.length, judged.length);
    const steps = mine.flatMap((run) => run.trail);
    return {
      "": label,
      "got there": `${reached.length}/${judged.length} (${percent(reached.length, judged.length)})`,
      "plausible range": `${Math.round(range.low * 100)}-${Math.round(range.high * 100)}%`,
      "stopped short": judged.filter((run) => run.end === "stopped short").length,
      "in circles": judged.filter((run) => run.end === "went in circles").length,
      stalled: judged.filter((run) => run.end === "stalled").length,
      errors: judged.filter((run) => run.end === "error").length,
      "cut short": mine.length - judged.length,
      "steps, reached vs script": reached.length ? `${middle(reached.map((run) => run.steps))} vs ${middle(reached.map((run) => run.scripted))}` : "n/a",
      "control covered": steps.filter((step) => step.covered).length,
      "ms to pointer": steps.length ? middle(steps.map((step) => step.msToTarget)) : 0,
    };
  };
  console.log("");
  console.table([
    ...work.map((item) => row(item.name, runs.filter((run) => run.site === item.set.siteId))),
    ...(runs.some((run) => run.heldOut) ? [row("held out", runs.filter((run) => run.heldOut)), row("tuned on", runs.filter((run) => !run.heldOut))] : []),
    row("all", runs),
  ]);

  await mkdir(RESULTS_DIR, { recursive: true });
  const out = `${RESULTS_DIR}guides-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(out, JSON.stringify({ at: new Date().toISOString(), answeredBy, repeat, runs }, null, 2) + "\n");
  console.log(`\nEvery step of every run is in ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
