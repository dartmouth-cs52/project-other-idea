import { mkdir, writeFile } from "node:fs/promises";
import type { TurnReply } from "../src/shared/types.ts";
import { ask, launch, loadGuideSet, open, perform, reachedOrWhy, siteFor, type Browser } from "./browser.ts";
import { CASES_DIR, describeMatcher, findListed, type Case, type CaseFile } from "./cases.ts";
import type { Guide, GuideSet } from "./guide.ts";

// Makes eval/cases/<name>.json by walking a site the way a visitor would.
//
// For each guide in eval/guides/<name>.ts it opens the page, asks the question
// in the real widget, and then plays both parts: it answers each step from the
// script (so the widget is always sent down the right path), and it does what a
// visitor would do next. Every request the widget sends on the way is kept as a
// case. Run it again whenever the widget changes what it sends.
//
//   npm run eval:record -- demo           (the demo app needs the local server: HAPTIC_MODEL=mock npm run dev)
//   npm run eval:record -- joinhaptic
//   npm run eval:record -- ui5 cart-add   (only the guides whose id starts with "cart-add"; the rest are kept as they were)
//
// The site has to be in data/sites first (npm run tag), because its context is
// saved with the cases. No model is called and nothing is sent to a server:
// see eval/browser.ts.

/** How long the widget may take to ask for a step. Other people's sites are slower than the demo. */
const STEP_WAIT_MS = 30_000;

async function record(browser: Browser, set: GuideSet, guide: Guide, site: CaseFile["site"]): Promise<Case[]> {
  const cases: Case[] = [];
  let answered = 0;
  let problem = "";
  /** How many steps the widget said it had been given, the last time it asked. */
  let lastAskedAt = -1;
  /** The recorder has just asked the question again itself, so the count starts over. */
  let askedAgain = false;

  const answer = (request: Case["request"]): TurnReply => {
    // When a page changes while a step is being answered, the widget looks again
    // and asks for the same step once more. The later look is the one a visitor
    // gets an answer about, so it replaces the earlier one.
    if (request.step === lastAskedAt && answered > 0 && !askedAgain && !guide.steps[answered - 1]?.unlisted) {
      answered--;
      cases.pop();
    }
    askedAgain = false;
    lastAskedAt = request.step;
    const step = guide.steps[answered];
    const listed = request.snapshot.elements;
    const found = step?.expect.length ? findListed(step.point ? [step.point] : step.expect, listed) : undefined;
    if (!step) problem = `the widget asked for a step ${answered + 1}, which the script does not have`;
    else if (step.unlisted && found) problem = `step ${answered + 1} is marked unlisted, but the widget now lists ${describeMatcher(step.expect[0]!)}. Take the mark off.`;
    else if (step.unlisted && !step.act) problem = `step ${answered + 1} is marked unlisted, so it needs an "act" that shows the control is really there`;
    else if (step.expect.length && !found && !step.unlisted) {
      problem = `step ${answered + 1} expects ${step.expect.map(describeMatcher).join(" or ")}, which the widget did not list. It listed: ${listed.map((element) => `${element.role} "${element.label}"`).join(", ")}`;
    } else if (step.trap?.length && !findListed(step.trap, listed)) {
      problem = `step ${answered + 1} names a trap, ${step.trap.map(describeMatcher).join(" or ")}, which the widget did not list`;
    }
    if (problem || !step) return { target: null, status: "done", say: "The script stopped here." };

    cases.push({
      id: `${guide.id}-${answered + 1}`,
      guide: guide.id,
      ...(guide.kind && guide.kind !== "task" ? { kind: guide.kind } : {}),
      ...(guide.heldOut || set.heldOut ? { heldOut: true } : {}),
      request,
      expect: {
        targets: step.expect,
        status: found || step.unlisted ? "continue" : "done",
        ...(step.unlisted ? { unlisted: true } : {}),
        ...(step.sayStartsWith ? { sayStartsWith: step.sayStartsWith } : {}),
        ...(step.sayNot?.length ? { sayNot: step.sayNot } : {}),
        ...(step.trap?.length ? { trap: step.trap } : {}),
      },
    });
    answered++;
    return found ? { target: found.id, status: "continue", say: step.say ?? `Click ${found.label}.` } : { target: null, status: "done", say: "That's done." };
  };

  const { page, close, net } = await open(browser, set, guide.start, answer, site);
  /** Does one scripted act, and says which, so that a request it sets off can be traced to it. */
  const act = async (index: number) => {
    net?.acting(`did step ${index + 1} of the script`);
    await perform(page, guide.steps[index]!.act!);
  };
  const turn = async (count: number) => {
    const deadline = Date.now() + STEP_WAIT_MS;
    while (answered < count && !problem) {
      if (Date.now() > deadline) throw new Error(`${guide.id}: the widget never asked for step ${count}.`);
      await page.waitForTimeout(50);
    }
    if (problem) throw new Error(`${guide.id}: ${problem}`);
  };

  try {
    await ask(page, guide.goal);
    for (const [index, step] of guide.steps.entries()) {
      if (step.silent) {
        // The widget is still showing the step before, with no idea that it is over. The visitor carries on alone.
        if (!step.act) throw new Error(`${guide.id}: step ${index + 1} is marked silent, so it needs an "act".`);
        const lastSent = cases[cases.length - 1]?.request;
        if (!lastSent) throw new Error(`${guide.id}: step ${index + 1} is marked silent, but the widget has not been asked anything yet.`);
        cases.push({
          id: `${guide.id}-${index + 1}`,
          guide: guide.id,
          ...(guide.kind && guide.kind !== "task" ? { kind: guide.kind } : {}),
          ...(guide.heldOut || set.heldOut ? { heldOut: true } : {}),
          request: lastSent,
          expect: { targets: step.expect, status: "continue", unheard: true },
        });
        answered++;
        await act(index);
        await page.waitForTimeout(1200);
        continue;
      }
      await turn(index + 1);
      if (!step.act) break;
      if (step.unlisted) {
        // The widget had nothing to point at, so its guide is over. The visitor
        // finds the control themselves and, still not there, asks again.
        await act(index);
        await page.waitForTimeout(1200);
        if (guide.steps[index + 1]) {
          askedAgain = true;
          await ask(page, guide.goal);
        }
        continue;
      }
      // Wait until the pointer is on the page, as a visitor would before acting.
      await page.locator("haptic-root .cursor").waitFor({ state: "visible", timeout: 5000 });
      await page.waitForTimeout(150);
      await act(index);
    }
    const last = guide.steps[guide.steps.length - 1];
    // On a site other people use, a script may only read. A request that was stopped means the script, or the set's "reads", is wrong.
    if (net) await page.waitForTimeout(700);
    const spoiled = net?.spoiled();
    if (spoiled) throw new Error(`${guide.id}: ${spoiled.why}.`);
    if (guide.reached) {
      const why = await reachedOrWhy(page, guide.reached);
      if (why) throw new Error(`${guide.id}: the script ran to its end, but ${why}. Fix the script or its "reached".`);
    } else if (last && !last.expect.length && guide.steps.length > 1) {
      throw new Error(`${guide.id}: it ends with DONE, so it needs a "reached" that says how to tell the visitor got there.`);
    }
  } finally {
    await close();
  }
  return cases;
}

async function main() {
  const [name, ...only] = process.argv.slice(2);
  if (!name) throw new Error("Say which guides to record: npm run eval:record -- demo");
  const set = await loadGuideSet(name);
  const site = await siteFor(set);
  if (!site) throw new Error(`There is no ${set.siteId} in data/sites yet. Build it first with npm run tag.`);
  const wanted = only.length ? set.guides.filter((guide) => only.some((start) => guide.id.startsWith(start))) : set.guides;
  if (!wanted.length) throw new Error(`No guide in eval/guides/${name}.ts has an id starting with ${only.join(" or ")}.`);

  // A partial run replaces only the guides it recorded.
  let kept: Case[] = [];
  if (only.length) {
    try {
      const { readFile } = await import("node:fs/promises");
      const before = JSON.parse(await readFile(`${CASES_DIR}${name}.json`, "utf8")) as CaseFile;
      // Guides that were not asked for stay as they were, unless the script no longer has them.
      kept = before.cases.filter((item) => set.guides.some((guide) => guide.id === item.guide) && !wanted.some((guide) => guide.id === item.guide));
    } catch {
      // No file yet.
    }
  }

  const browser = await launch();
  const made: Case[] = [];
  const failed: string[] = [];
  try {
    for (const guide of wanted) {
      try {
        const cases = await record(browser, set, guide, site);
        console.log(`${guide.id}: ${cases.length} steps`);
        made.push(...cases);
      } catch (error) {
        // One guide that no longer fits its site should not cost the others.
        failed.push(error instanceof Error ? error.message : String(error));
        console.error(`${guide.id}: FAILED`);
      }
    }
  } finally {
    await browser.close();
  }

  // In the script's order, whatever order they were recorded in.
  const order = new Map(set.guides.map((guide, index) => [guide.id, index]));
  const cases = [...kept, ...made].sort((a, b) => (order.get(a.guide) ?? 0) - (order.get(b.guide) ?? 0));
  await mkdir(CASES_DIR, { recursive: true });
  const file: CaseFile = { ...(set.about ? { about: set.about } : {}), site, cases };
  await writeFile(`${CASES_DIR}${name}.json`, JSON.stringify(file, null, 1) + "\n");
  console.log(`Wrote ${cases.length} cases from ${new Set(cases.map((item) => item.guide)).size} guides to eval/cases/${name}.json`);
  if (failed.length) throw new Error(`${failed.length} guide${failed.length === 1 ? "" : "s"} could not be recorded:\n\n${failed.join("\n\n")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
