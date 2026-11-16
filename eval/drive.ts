import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildUserMessage } from "../src/server/prompt.ts";
import { describeElement, type SiteContext, type Snapshot, type TurnReply, type TurnRequest } from "../src/shared/types.ts";
import { modelAsker, parseModel, serverAsker, type Asker } from "./ask.ts";
import { ask, launch, loadGuideSet, open, reachedAnyOrWhy, reachedOrWhy, readAnswers, saysOrWhy, siteFor, type Browser, type Read } from "./browser.ts";
import { matches, plausibleRange } from "./cases.ts";
import type { Guide, GuideSet, Step } from "./guide.ts";
import { countSent, type Net, type SentLog } from "./net.ts";
import { pickWhenQuiet, use, useAsBefore, type Shown, type Used } from "./visitor.ts";

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
//
// What the visitor does with a control is in eval/visitor.ts. What keeps a run
// from writing to a site other people use is in eval/net.ts.

const HELP = `Usage: npm run eval:guides -- <guide sets…> (--server <address> | --model <model>) [options]

  --server <address>  Ask a running Haptic server, like https://widget.joinhaptic.com.
  --model <model>     Call a model from here: a model ID with optional @low, @medium, @high or @off, or "mock".
  --only <prefix>     Only guides whose id starts with this. Repeat for more.
  --repeat <n>        Run each guide this many times. Default 1.
  --parallel <n>      How many sites to run at once. Default 1.
  --trace             Also write, for every answer, the whole request the widget sent and the reply, beside the results file.
  --visitor <which>   "new" (the default) uses each control the way a person would. "old" is the visitor as it was before:
                      it fills every input, types "Test", takes the second entry of a dropdown and clicks by script
                      when a control is covered. Kept for one release, to show how much of a change in the score is the benchmark's.`;

const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));

/** A guide may take this many steps more than its script before it counts as going round in circles. */
const EXTRA_STEPS = 4;
/** How long the widget may take to ask for the next step after the visitor acts: the page settling, a page load. */
const NEXT_STEP_MS = 40_000;
/** How long a page that a click loaded may take to show the widget again. */
const WIDGET_BACK_MS = 20_000;
/** How long the widget may keep a sentence up with no pointer, watching for the visitor to do what it says. */
const WATCHING_MS = 100_000;
/** When the widget has not asked this long after a control was clicked open, the visitor picks from what is showing. */
const QUIET_MS = 4500;
/**
 * On a site other people use, the run stops before a control that could send,
 * buy, save or delete, unless the script says that control is where it ends.
 */
const RISKY = /\b(delete|remove|discard|pay|buy|purchase|place order|order now|send|submit|publish|save|create|add|apply|confirm|register|sign up|invite|approve|reject|merge|close|archive|transfer|export|download|subscribe|log ?in|sign ?in|log ?out|sign ?out)\b/i;

export type End =
  /** The visitor ended up where they wanted to be. */
  | "reached"
  /** The model said it was done, or had nothing to point at, somewhere else. */
  | "stopped short"
  /** It kept giving steps past the limit, and on the way pointed again at a control already used on a page that had not changed. */
  | "went in circles"
  /** It kept giving steps past the limit, each on something new: still moving, and too slow to get there. */
  | "ran long"
  /** The widget stopped asking for steps: it gave up, or the visitor's action never registered. */
  | "stalled"
  /** It pointed at a control that must not be pressed on a site other people use, or a step tried to write to one. Not counted either way. */
  | "cut short"
  /** The benchmark could not tell: the site was down, sign-in was refused, the model or the server failed. Not counted either way. */
  | "error";

interface StepLog {
  path: string;
  pointed: string;
  status: string;
  say: string;
  did: string;
  ms: number;
  msToTarget: number;
  /** Something unrelated was on top of the control's middle, so a visitor could not have clicked there. */
  covered?: boolean;
  /** The widget asked this after the visitor used what it called the last step. */
  closing?: boolean;
  /** It pointed at a control the visitor had already used, on a page that looked the same: it asked for something already done. */
  repeated?: boolean;
}

export interface GuideRun {
  site: string;
  guide: string;
  /** "answer" for a question that asks for a fact (a guide with `says`), and otherwise the guide's own kind. */
  kind: string;
  heldOut: boolean;
  end: End;
  why: string;
  steps: number;
  scripted: number;
  /** The goal was reached, and the model then pointed at something more. */
  overran: boolean;
  /** Reached only because the last sentence gave the true answer in words. Whether that counts is the owner's decision. */
  answered: boolean;
  /** The last answer was "done" with a pointer, and nothing more came after the visitor used it. */
  endedOnPointer: boolean;
  /** The model's last word was "done", and the script says the visitor is not there. */
  saidDoneButNot: boolean;
  /** How many answers the visitor never saw, because the page had changed and the widget asked again for the same step. */
  askedAgain: number;
  /** How many questions the widget asked after the visitor used what it had called the last step. */
  closing: number;
  /** How many times the widget asked a new question when the visitor had only scrolled. */
  askedAfterScroll: number;
  /** How many answers pointed at a control the visitor had already used, on a page that looked the same. */
  repeated: number;
  /** What the widget was showing when the run ended. */
  showing: string;
  trail: StepLog[];
  /** On a site other people use: what its pages sent other than plain reads, and what was stopped. See eval/net.ts. */
  sent?: SentLog;
}

/** One answer with everything the model was given, for --trace. */
interface Traced {
  at: string;
  /** The whole request as the widget sent it. */
  request: Omit<TurnRequest, "site">;
  /** The same request as the words this checkout's server would hand the model. The live server may word it differently. */
  message: string;
  reply: TurnReply;
  pointed: string;
  ms: number;
  did: string;
}

export interface Options {
  visitor: "new" | "old";
  trace: boolean;
}

/** The page loaded again, or went to another address, while the runner was reading the pointer from it. */
class PageMoved extends Error {
  constructor() {
    super("the page loaded again before the pointer could be read");
  }
}

/** The key a sentence asks the visitor to press, if it names one the runner can press. */
function keyAsked(say: string): string | undefined {
  const key = /\b(?:press|hit|tap)\s+(?:the\s+)?(enter|return|tab|escape|esc)\b/i.exec(say)?.[1]?.toLowerCase();
  if (!key) return undefined;
  return key === "tab" ? "Tab" : key.startsWith("esc") ? "Escape" : "Enter";
}

/** The selector of the control a scripted act is done on. */
function selectorOf(step: Step): string {
  const act = step.act;
  if (!act) return "";
  const selector = "fill" in act ? act.fill[0] : "select" in act ? act.select[0] : "press" in act ? act.press[0] : "click" in act ? act.click : "check" in act ? act.check : act.hover;
  // Two guide sets write two things a visitor does as one selector. The first of them is the control.
  if (selector.startsWith("alone=")) return selector.split("|")[1] ?? "";
  return selector.split(" >> then >> ")[0] ?? "";
}

export async function drive(browser: Browser, set: GuideSet, guide: Guide, site: SiteContext, asker: Asker, options: Options): Promise<{ run: GuideRun; traced: Traced[] }> {
  const trail: StepLog[] = [];
  const traced: Traced[] = [];
  /**
   * Every answer given, in order. `stepNo` is how many steps the widget said it had been given when it asked.
   * `moves` is how many times the page had gone to a new address or loaded again by then.
   */
  const replies: { reply: TurnReply; snapshot: Snapshot; stepNo: number; closing: boolean; moves: number }[] = [];
  /** How many times the page has gone to a new address or loaded again since it was opened for this guide. */
  let moves = 0;
  /** How many questions the widget has sent, answered yet or not. */
  let asked = 0;
  let failure = "";
  const counts = { askedAgain: 0, closing: 0, askedAfterScroll: 0, repeated: 0 };
  /** Each control the visitor used, with how the page looked when they did: what can be clicked on it, by role and name, in any order. */
  const usedOn = new Map<string, Set<string>>();
  const looks = (snapshot: Snapshot) => snapshot.elements.map((element) => `${element.role} ${element.label}`).sort().join("\n");

  const last = guide.steps[guide.steps.length - 1];
  // A script that ends on a control it does not press is over when that control is pointed at, and so is
  // another good way's last control (its "otherEnds"), each while the page is as its "given" says.
  const stopAt = [...(last && last.expect.length && !last.act ? [last] : []), ...(guide.otherEnds ?? [])];
  const stopAtNames = stopAt.flatMap((end) => end.expect.map((matcher) => `"${matcher.label}"`)).join(" or ");
  const limit = guide.steps.length + EXTRA_STEPS;
  let net: Net | undefined;
  const result = (end: End, why: string, more: Partial<Pick<GuideRun, "overran" | "answered" | "endedOnPointer" | "showing">> = {}): { run: GuideRun; traced: Traced[] } => {
    // A request to the site was stopped and nobody has said it is harmless. Whatever
    // the page shows now, it is not what a visitor would see, so the run is not scored.
    const spoiled = end === "error" ? undefined : net?.spoiled();
    if (spoiled) [end, why, more] = [spoiled.byAStep ? "cut short" : "error", spoiled.why, { showing: more.showing ?? "" }];
    const showing = more.showing ?? "";
    const lastReply = replies[replies.length - 1]?.reply;
    const run: GuideRun = {
      site: set.siteId,
      guide: guide.id,
      kind: guide.says ? "answer" : (guide.kind ?? "task"),
      heldOut: !!(guide.heldOut || set.heldOut),
      end,
      // However a run ends short of the goal, what the widget was showing then is part of why.
      why: end !== "reached" && showing && !why.includes(showing) ? `${why}. The widget was showing: ${showing}` : why,
      steps: trail.length,
      scripted: guide.steps.length,
      overran: more.overran ?? false,
      answered: more.answered ?? false,
      endedOnPointer: more.endedOnPointer ?? false,
      saidDoneButNot: end === "stopped short" && lastReply?.status === "done",
      ...counts,
      showing,
      trail,
      ...(net ? { sent: net.log } : {}),
    };
    return { run, traced };
  };
  // Signing in or loading the page can fail on a site that is slow or down. That is one guide lost, not the run.
  let opened: Awaited<ReturnType<typeof open>>;
  try {
    opened = await open(
      browser,
      set,
      guide.start,
      async (request) => {
        asked++;
        try {
          const got = await asker(site, request);
          const pointed = got.reply.target ? request.snapshot.elements.find((element) => element.id === got.reply.target) : undefined;
          // Job B's widget marks the question it asks after the visitor has used what was called the last step.
          const closing = (request as { closing?: boolean }).closing === true;
          if (closing) counts.closing++;
          trail.push({
            path: request.snapshot.path,
            pointed: pointed ? describeElement(pointed) : "nothing",
            status: got.reply.status,
            say: got.reply.say,
            did: "",
            ms: got.ms,
            msToTarget: got.msToTarget,
            ...(closing ? { closing } : {}),
          });
          if (options.trace) {
            traced.push({ at: new Date().toISOString(), request, message: buildUserMessage({ ...request, site: site.id }), reply: got.reply, pointed: pointed ? describeElement(pointed) : "nothing", ms: got.ms, did: "" });
          }
          replies.push({ reply: got.reply, snapshot: request.snapshot, stepNo: request.step, closing, moves });
          return got.reply;
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
  page.on("framenavigated", (frame: unknown) => {
    if (frame === page.mainFrame()) moves++;
  });
  net = opened.net;
  /** The sentence the widget has on show: the latest answer's, which is what a test that reads the sentence reads. */
  const sentenceNow = () => replies[replies.length - 1]?.reply.say;
  const reachedNow = async (wait: number, sentence = sentenceNow()) => (guide.reached ? (await reachedAnyOrWhy(page, guide.reached, wait, sentence)) === "" : false);
  /** The answer to a question that asks for a fact, where it is read from the page the guide starts on. */
  let atStart: Read = {};

  /** Whether the widget has said what state it is in at any time in this run. One that has is a widget that reports its state. */
  let reportsState = false;
  /** What the widget is showing, and what it says its state is. The state is undefined on a widget that does not report one, and while there is no widget on the page. */
  const widgetNow = () =>
    page
      .evaluate(
        `(() => {
          const host = document.querySelector("haptic-root");
          const root = host && host.shadowRoot;
          const caption = root && root.querySelector(".caption");
          const status = root && root.querySelector(".status");
          return {
            state: host ? host.guideState : undefined,
            caption: (caption && caption.querySelector("span").textContent) || "",
            captionShown: !!caption && !caption.hidden,
            status: status && !status.hidden ? status.querySelector("span").textContent || "" : "",
          };
        })()`,
      )
      .then((now: { state?: string } | undefined) => {
        if (now?.state) reportsState = true;
        return now;
      })
      .catch(() => undefined) as Promise<{ state?: string; caption: string; captionShown: boolean; status: string } | undefined>;
  /**
   * The widget's state once the visitor has used a control. Straight after a
   * click that loads a new page there is no widget on it yet, or no page to
   * read at all. For a widget that has reported its state before, that means
   * the widget is still to come, not that it reports none, so it is waited for,
   * up to a limit. Undefined when it reports none, or did not come back in time.
   */
  const stateAfterUse = async (): Promise<string | undefined> => {
    for (const until = Date.now() + WIDGET_BACK_MS; ; await page.waitForTimeout(200)) {
      const state = (await widgetNow())?.state;
      if (state || !reportsState || Date.now() >= until) return state;
    }
  };
  const showingNow = async () => {
    const now = await widgetNow();
    if (!now) return "nothing that could be read: the page was loading or gone";
    const text = now.captionShown && now.caption ? `"${now.caption}"` : now.status ? `"${now.status}" in its ask box` : "nothing";
    return now.state ? `${text} (${now.state})` : text;
  };
  const ended = async (end: End, why: string, more: Parameters<typeof result>[2] = {}) => result(end, why, { ...more, showing: await showingNow() });

  /** Scores the run once the guide is over. `how` says how it ended, for a run that did not get there. */
  const judge = async (how: string, more: Parameters<typeof result>[2] = {}) => {
    const showing = await showingNow();
    // A request the last click set off has to have begun before the run is judged.
    if (net) await page.waitForTimeout(700);
    const lastSaid = sentenceNow() ?? "";
    const whyNot = guide.reached ? await reachedAnyOrWhy(page, guide.reached, 4000, lastSaid) : stopAt.length ? `it never pointed at ${stopAtNames}` : "the script has no test of the page";
    if (guide.reached && !whyNot) return result("reached", "", { ...more, showing });
    if (guide.says) {
      const whyNotSaid = await saysOrWhy(page, guide.says, lastSaid, atStart);
      if (!whyNotSaid) return result("reached", "", { ...more, showing, answered: true });
      return result("stopped short", `${how}, but ${whyNot}, and ${whyNotSaid}`, { ...more, showing });
    }
    return result("stopped short", `${how}, but ${whyNot}`, { ...more, showing });
  };

  /** The script's own step for the control the pointer is on, if it has one: the first whose act is done on that control. */
  const scriptedFor = async (element: unknown): Promise<{ index: number; step: Step; exact: boolean } | undefined> => {
    for (const [index, step] of guide.steps.entries()) {
      const selector = selectorOf(step);
      if (!selector) continue;
      const found = await page.$(selector).catch(() => null);
      if (!found) continue;
      const how = (await found.evaluate((el: Element, other: Element) => (el === other ? "same" : el.contains(other) || other.contains(el) ? "around" : ""), element).catch(() => "")) as string;
      if (how) return { index, step, exact: how === "same" };
    }
    return undefined;
  };

  /**
   * Waits for answer number `at`. "finished" means the widget says the guide is
   * over and nothing is on its way. "silent" means the time ran out. While
   * waiting, `whenQuiet` is run once if the widget has asked nothing new by then.
   * With `watch`, the page is also looked at every half second, and "reached"
   * means it got where the guide ends: a notice like "Added to your cart" may
   * be gone by the time the next answer comes.
   */
  const awaitAnswer = async (at: number, limitMs: number, whenQuiet?: () => Promise<void>, watch = false): Promise<"answered" | "finished" | "silent" | "failed" | "reached"> => {
    const began = Date.now();
    const askedBefore = asked;
    let overSince = 0;
    let lookedAt = 0;
    while (Date.now() - began < limitMs) {
      if (failure) return "failed";
      if (replies.length > at) return "answered";
      if (watch && guide.reached && Date.now() - lookedAt >= 500) {
        lookedAt = Date.now();
        if ((await reachedAnyOrWhy(page, guide.reached, 50, sentenceNow())) === "") return "reached";
      }
      if (whenQuiet && asked === askedBefore && Date.now() - began > QUIET_MS) {
        const once = whenQuiet;
        whenQuiet = undefined;
        await once().catch(() => undefined);
      }
      // Nothing is on its way, and the widget says it is done. It has to say so for a moment: a page that has just loaded says "idle" before it picks the guide up.
      const state = asked === replies.length ? (await widgetNow())?.state : undefined;
      if (state === "finished" || state === "idle") {
        overSince ||= Date.now();
        if (Date.now() - overSince > (state === "finished" ? 1500 : 4000)) return "finished";
      } else overSince = 0;
      await page.waitForTimeout(100);
    }
    return replies.length > at ? "answered" : "silent";
  };

  try {
    atStart = await readAnswers(page, guide.says, "start");
    await ask(page, guide.goal);
    /** What the visitor did last, which decides how the wait for the next answer is read. */
    let after: { kind: "asked" } | { kind: "used"; done: string | undefined; whenQuiet?: () => Promise<void> } | { kind: "watched"; say: string; followed: boolean } = { kind: "asked" };
    const scrolled = new Set<number>();
    // `at` is the answer being waited for or acted on. `step` counts the ones a visitor was shown a control for.
    for (let step = 0, at = 0; ; at++) {
      // Once the visitor has done something, the page may reach the guide's end before the widget asks again.
      const waited = await awaitAnswer(at, after.kind === "watched" ? WATCHING_MS : NEXT_STEP_MS, after.kind === "used" ? after.whenQuiet : undefined, after.kind !== "asked");
      if (waited === "failed") return await ended("error", failure);
      if (waited === "reached") return await ended("reached", "");
      // The step before set off a request that was stopped. Nothing after it would mean anything.
      if (net?.spoiled()) return await ended("cut short", "");
      if (waited !== "answered") {
        // "done" with a pointer was the model's last word, the visitor used the control, and nothing more came.
        if (after.kind === "used" && after.done) return await judge(`it ended by pointing at ${after.done}`, { endedOnPointer: true });
        if (after.kind === "watched") return await judge(`it ended on "${after.say}", which the runner ${after.followed ? "did" : "could not do"}`);
        if (await reachedNow(500)) return await ended("reached", "");
        return await ended("stalled", waited === "finished" ? "the widget ended the guide without another step" : "the widget did not ask for another step");
      }
      // The widget sets an answer aside when the page changed while it was on its
      // way, and asks again. A visitor never sees the first one. Wait until the
      // answer is on show, or until the widget has asked again for the same step.
      for (const shownBy = Date.now() + 8000; Date.now() < shownBy; ) {
        if (replies.length > at + 1 && replies[at + 1]!.stepNo === replies[at]!.stepNo) {
          trail[at]!.did = "nothing: the page had changed, so the widget asked again";
          counts.askedAgain++;
          at++;
          continue;
        }
        if ((await widgetNow())?.caption === replies[at]!.reply.say) break;
        await page.waitForTimeout(100);
      }

      const { reply, snapshot } = replies[at]!;
      const log = trail[at]!;
      const did = (what: string) => {
        log.did = what;
        const trace = traced[at];
        if (trace) trace.did = what;
      };
      const pointed = reply.target ? snapshot.elements.find((element) => element.id === reply.target) : undefined;

      // The script ends on this control unpressed, or another good way does, and the page is as it has to be
      // then: the guide is over. Pointed at too soon, before the page is ready for it, it is used like any other control.
      if (pointed) {
        for (const end of stopAt) {
          if (!end.expect.some((matcher) => matches(matcher, pointed, snapshot.elements))) continue;
          if (end.given && (await reachedOrWhy(page, end.given, 300, reply.say)) !== "") continue;
          did(end === last ? "stopped here, as the script does" : "stopped here: another good way ends on this control, which is not pressed here");
          return await ended("reached", "");
        }
      }
      if (!pointed) {
        // "continue" with nothing to point at means "do this, I am watching", on a widget that watches.
        const state = (await widgetNow())?.state;
        if (reply.status === "continue" && state === "watching" && options.visitor === "new") {
          const key = keyAsked(reply.say);
          if (key) {
            net?.acting(`pressed ${key}`);
            await page.keyboard.press(key);
            did(`pressed ${key}, as the sentence asks`);
          } else did("nothing: the runner cannot do what this sentence asks");
          after = { kind: "watched", say: reply.say, followed: !!key };
          continue;
        }
        did("nothing: the guide was over");
        return await judge(`it ended on "${reply.say}"`);
      }
      // Pointing again at what the visitor already used, with the page as it was, asks for something already done.
      const usedKey = `${snapshot.path} ${describeElement(pointed)}`;
      if (usedOn.get(usedKey)?.has(looks(snapshot))) {
        log.repeated = true;
        counts.repeated++;
      }
      // Already there, and it is still pointing. "done" with a pointer shows where the answer is. "continue" is a step too many.
      if (await reachedNow(300, reply.say)) {
        did("nothing: already there");
        return await ended("reached", "", { overran: reply.status === "continue" });
      }
      // The answer to a question that asks for a fact, with a pointer at where it shows. That pointer is not something to click.
      if (reply.status === "done" && guide.says && !(await saysOrWhy(page, guide.says, reply.say, atStart))) {
        did("nothing: the sentence gave the answer");
        return await ended("reached", "", { answered: true });
      }
      if (!replies[at]!.closing) step++;
      if (step > limit) {
        const again = trail.find((one) => one.repeated);
        return again
          ? await ended("went in circles", `${limit} steps were not enough for a guide scripted in ${guide.steps.length}, and it pointed again at ${again.pointed}, which had been used on a page that looked the same`)
          : await ended("ran long", `${limit} steps were not enough for a guide scripted in ${guide.steps.length}, though each pointed at something new`);
      }
      // A control the script itself presses on this site has been checked by whoever wrote it.
      const vetted = guide.steps.some((scripted) => scripted.act && scripted.expect.some((matcher) => matches(matcher, pointed, snapshot.elements)));
      if (!set.sandbox && !vetted && RISKY.test(pointed.label)) {
        did("stopped: not pressed on a site other people use");
        return await ended("cut short", `it pointed at ${describeElement(pointed)}, which is not pressed on a site other people use`);
      }
      if (set.never && new RegExp(set.never, "i").test(`${pointed.label} ${pointed.href ?? ""}`)) {
        did("stopped: the script says never to use this here");
        return await ended("stopped short", `it pointed at ${describeElement(pointed)}, which has nothing to do with the goal and must not be used on this site`);
      }

      // Do what the pointer shows. A page that is still arriving is left to finish first.
      let used: Used;
      let scripted: Awaited<ReturnType<typeof scriptedFor>>;
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
        await page.locator("haptic-root .cursor").waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
        await page.waitForTimeout(250);
        const handle = await page.evaluateHandle(() => (document.querySelector("haptic-root") as (Element & { pointedAt?: Element }) | null)?.pointedAt ?? null);
        const element = handle.asElement();
        if (!element) {
          // The page loaded again, or went elsewhere, after this answer came. The widget there has not pointed yet.
          if (moves !== replies[at]!.moves) throw new PageMoved();
          return await ended("stalled", `the pointer was not on anything, though the reply named ${describeElement(pointed)}`);
        }

        // On a site other people use, nobody's password is typed, real or made up: a
        // sign-in form is where the run ends, unless the script itself fills it in.
        const password = (await element.evaluate((el: Element) => el instanceof HTMLInputElement && el.type === "password")) as boolean;
        if (password && !set.sandbox && !vetted) {
          did("stopped: no password is typed on a site other people use");
          return await ended("cut short", `it pointed at ${describeElement(pointed)}, a password field, on a site other people use`);
        }

        scripted = await scriptedFor(element);
        // A visitor who looks around first. Scrolling is not a step, so the widget should ask nothing because of it.
        if (scripted?.step.scrollFirst && !scrolled.has(scripted.index)) {
          scrolled.add(scripted.index);
          const askedBefore = asked;
          await page.mouse.wheel(0, scripted.step.scrollFirst);
          await page.waitForTimeout(2000);
          if (asked > askedBefore) {
            counts.askedAfterScroll++;
            did("scrolled the page, and the widget asked a new question though nothing had been done");
            if (!replies[at]!.closing) step--;
            after = { kind: "used", done: undefined };
            continue;
          }
        }
        // A visitor on the scripted path types what the script types. The script's
        // own selector says which field a value is for: "expect" alone would not,
        // since a step may accept any of several fields.
        const act = scripted?.exact ? scripted.step.act : undefined;
        const shown: Shown = {
          listed: pointed,
          say: reply.say,
          ...(act && "fill" in act ? { scripted: { fill: act.fill[1] } } : act && "select" in act ? { scripted: { select: act.select[1] } } : {}),
        };
        net?.acting(`used ${describeElement(pointed)}`);
        used = options.visitor === "old" ? await useAsBefore(page, element, shown) : await use(page, element, shown);
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
        // The page went away under the pointer, or had gone before it could be read. The widget asks again
        // from the new page once it has loaded, and that answer is the one to follow.
        if (error instanceof PageMoved || /context was destroyed|navigat|detached|not attached|frame got detached/i.test(message)) {
          did("nothing: a new page loaded before the pointer could be used");
          if (!replies[at]!.closing) step--;
          after = { kind: "used", done: undefined };
          continue;
        }
        return await ended("stalled", `${describeElement(pointed)} could not be used: ${message}`);
      }
      did(used.did);
      if (used.covered) log.covered = true;
      if (!used.failed) usedOn.set(usedKey, (usedOn.get(usedKey) ?? new Set()).add(looks(snapshot)));
      // A control no part of which can be reached is a result in its own right: a visitor could not have used it either.
      if (used.failed) return await ended("stalled", `${describeElement(pointed)} could not be used: ${used.failed}`);

      // When the control was only clicked open and the widget says nothing more, the visitor picks
      // from what is showing: what the sentence names, or what the script picks next.
      let whenQuiet: (() => Promise<void>) | undefined;
      if (used.opened) {
        const nextStep = scripted ? guide.steps[scripted.index + 1] : undefined;
        const nextClick = scripted?.step.pick ?? (nextStep?.act && "click" in nextStep.act ? selectorOf(nextStep) : undefined);
        whenQuiet = async () => {
          const picked = await pickWhenQuiet(page, reply.say, nextClick);
          if (picked) did(`${used.did}. The widget said nothing more, so the visitor ${picked}`);
        };
      }

      if (reply.status === "done" && (await stateAfterUse()) === undefined) {
        // This widget ends the guide on "done": it showed where, the visitor used it, and nothing more is coming.
        // Or the page the control loaded never showed the widget again, so nothing more can come.
        // A list it opened is still showing, and a person picks from it what the sentence says.
        if (whenQuiet) {
          await page.waitForTimeout(600);
          await whenQuiet().catch(() => undefined);
        }
        return await judge(`it ended by pointing at ${describeElement(pointed)}`, { endedOnPointer: true });
      }
      // A widget that reports its state looks once more after a "done" with a pointer. The next turn of the loop waits for that.
      after = { kind: "used", done: reply.status === "done" ? describeElement(pointed) : undefined, ...(whenQuiet ? { whenQuiet } : {}) };
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
      trace: { type: "boolean", default: false },
      visitor: { type: "string", default: "new" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help || !positionals.length || (!values.server && !values.model) || (values.server && values.model) || !["new", "old"].includes(values.visitor)) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }
  const options: Options = { visitor: values.visitor as Options["visitor"], trace: values.trace };
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
  console.log(
    `${total} guide runs on ${work.length} site${work.length === 1 ? "" : "s"}, answered by ${answeredBy}.${answeredBy === "mock" ? "" : " Every step is billed."}` +
      `${options.visitor === "old" ? " The visitor is the old one." : ""}\n`,
  );

  const browser = await launch();
  const runs: GuideRun[] = [];
  const traces: { site: string; guide: string; round: number; answers: Traced[] }[] = [];
  try {
    const queue = [...work];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        for (const guide of item.guides) {
          for (let round = 0; round < repeat; round++) {
            const { run, traced } = await drive(browser, item.set, guide, item.site, asker, options);
            runs.push(run);
            if (options.trace) traces.push({ site: item.name, guide: guide.id, round: round + 1, answers: traced });
            const notes = [run.overran ? "then pointed at more" : "", run.answered ? "by the answer in words" : "", run.repeated ? `asked ${run.repeated} time${run.repeated === 1 ? "" : "s"} for something already done` : ""].filter(Boolean);
            console.log(
              `${run.end === "reached" ? "ok  " : run.end === "error" ? "--  " : "FAIL"} ${item.name}/${guide.id}: ${run.end}${notes.length ? ` (${notes.join("; ")})` : ""} in ${run.steps} steps (script: ${run.scripted})${run.why ? `. ${run.why}` : ""}`,
            );
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Number(values.parallel) || 1) }, worker));
  } finally {
    await browser.close();
  }

  // An "error" says nothing about Haptic: the site was down or refused the run before Haptic was asked, so it
  // is left out of the rate and counted beside it. A run "cut short" is counted as not reached. It ends when
  // Haptic points a visitor of a site other people use at something the script never presses there (a
  // password field, a button that saves or signs in, a request that writes), so Haptic has left the way the
  // script knows. Sometimes that is another good way, more often it is not (Jira sent a signed-out visitor to
  // sign in for something that needs no account), and the benchmark cannot tell which. Leaving these out of
  // the rate would hide Haptic's failures, so each is listed for reading by hand instead.
  const judgedOf = (mine: GuideRun[]) => mine.filter((run) => run.end !== "error");
  const rate = (mine: GuideRun[]) => {
    const judged = judgedOf(mine);
    const reached = judged.filter((run) => run.end === "reached").length;
    return `${reached}/${judged.length} (${percent(reached, judged.length)})`;
  };
  const groups = [
    ...work.map((item) => ({ label: item.name, mine: runs.filter((run) => run.site === item.set.siteId) })),
    ...(runs.some((run) => run.heldOut)
      ? [
          { label: "held out", mine: runs.filter((run) => run.heldOut) },
          { label: "tuned on", mine: runs.filter((run) => !run.heldOut) },
        ]
      : []),
    { label: "all", mine: runs },
  ];

  console.log("");
  console.table(
    groups.map(({ label, mine }) => {
      const judged = judgedOf(mine);
      const reached = judged.filter((run) => run.end === "reached");
      const range = plausibleRange(reached.length, judged.length);
      const count = (end: End) => mine.filter((run) => run.end === end).length;
      return {
        "": label,
        "got there": rate(mine),
        "plausible range": judged.length ? `${Math.round(range.low * 100)}-${Math.round(range.high * 100)}%` : "n/a",
        // Whether a true answer in words counts as a finished guide is the owner's decision, so the rate is also given without those guides.
        "without answer guides": rate(mine.filter((run) => run.kind !== "answer")),
        "stopped short": count("stopped short"),
        "in circles": count("went in circles"),
        "ran long": count("ran long"),
        stalled: count("stalled"),
        "cut short (not reached)": count("cut short"),
        "not judged: error": count("error"),
      };
    }),
  );

  // What happened on the way, which the rate alone hides. The headings are short to keep the table on a screen:
  // steps taken against the script's, for runs that got there and for all; runs that ended on "done" with a
  // pointer; runs where the model said done and the script says the visitor is not there; passes by the true
  // answer in words; passes that pointed at more after the goal; passes after asking for something already
  // done; answers set aside because the widget asked again; closing questions; questions asked after a scroll.
  console.log("\nOn the way:");
  console.table(
    groups.map(({ label, mine }) => {
      const steps = mine.flatMap((run) => run.trail);
      const reached = mine.filter((run) => run.end === "reached");
      const sum = (key: "askedAgain" | "closing" | "askedAfterScroll" | "repeated") => mine.reduce((total, run) => total + run[key], 0);
      return {
        "": label,
        "steps if there": reached.length ? `${middle(reached.map((run) => run.steps))} vs ${middle(reached.map((run) => run.scripted))}` : "n/a",
        "steps, all": mine.length ? `${middle(mine.map((run) => run.steps))} vs ${middle(mine.map((run) => run.scripted))}` : "n/a",
        "done+pointer": mine.filter((run) => run.endedOnPointer).length,
        "done, not there": mine.filter((run) => run.saidDoneButNot).length,
        "by answer": reached.filter((run) => run.answered).length,
        "then more": reached.filter((run) => run.overran).length,
        "after a repeat": reached.filter((run) => run.repeated).length,
        "asked again": sum("askedAgain"),
        closing: sum("closing"),
        "after scroll": sum("askedAfterScroll"),
        covered: steps.filter((step) => step.covered).length,
        "ms to pointer": steps.length ? middle(steps.map((step) => step.msToTarget)) : 0,
      };
    }),
  );

  // On sites other people use: requests that were not plain reads. See eval/net.ts.
  if (runs.some((run) => run.sent)) {
    console.log("\nWhat the pages sent, other than plain reads:");
    console.table(
      groups.map(({ label, mine }) => {
        const sent = countSent(mine.map((run) => run.sent));
        return { "": label, "let through": sent.let, stopped: sent.stopped, "tried to write": sent.unknown };
      }),
    );
  }

  // Every request that was stopped with nobody vouching for it, by site, so a write attempt is seen the day it happens.
  for (const item of work) {
    const unknown = new Map<string, number>();
    for (const run of runs) {
      if (run.site !== item.set.siteId) continue;
      for (const sent of run.sent?.stopped ?? []) if (sent.after !== undefined) unknown.set(`${sent.method} ${sent.to}`, (unknown.get(`${sent.method} ${sent.to}`) ?? 0) + sent.times);
    }
    if (unknown.size) console.log(`\n${item.name}: stopped, and not known to be harmless: ${[...unknown].map(([request, times]) => `${request} (${times})`).join(", ")}`);
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const out = `${RESULTS_DIR}guides-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(out, JSON.stringify({ at: new Date().toISOString(), answeredBy, repeat, visitor: options.visitor, runs }, null, 2) + "\n");
  console.log(`\nEvery step of every run is in ${out}`);
  if (options.trace) {
    // What the model was given at every answer: the controls, the event, the history and the page text, with the reply beside it.
    const traceOut = out.replace(/\.json$/, ".trace.json");
    await writeFile(traceOut, JSON.stringify({ at: new Date().toISOString(), answeredBy, runs: traces }, null, 1) + "\n");
    console.log(`What the model was given at every answer is in ${traceOut}`);
  }
}

// Run as a command. A test imports `drive` alone.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
