import { writeFile } from "node:fs/promises";
import { readName } from "../src/shared/act-rules.ts";
import type { Act as Doing, SnapElement, TurnReply, TurnRequest } from "../src/shared/types.ts";
import { launch, open, perform, reachedAnyOrWhy, type Browser, type Page } from "./browser.ts";
import { findListed, type Matcher } from "./cases.ts";
import type { Act, Guide, GuideSet, Step } from "./guide.ts";

// Northpine's tasks in act mode, with scripted answers and no model (DESIGN
// 7.1e, the smallest version: cards, people, expenses and reimbursements).
//
// Each task's steps already say, for every step, which control is right and
// what a person does with it. Here they become the answers a good model would
// give in act mode: a click is "do: click", typing is "do: type", a list
// opened and then picked from is one "do: choose" on the field, a box ticked
// is "do: check", and the last control, when it commits, is the hand-over
// ("commits": true, no "do"). Values the question does not hold are added to
// it, since Haptic only enters what the visitor wrote. The visitor presses Do
// it, the widget acts, and when it gives a step to the visitor ("your turn")
// this runner does that step as the task says, with the real mouse and keys.
//
// Each run checks that:
// - it ends right: on the task's last control, left to the visitor (the
//   hand-over with What I did, the visitor's turn, or acting stopped there
//   at the page's confirmation or a commit the visitor did not ask for);
//   or, when the last step is one Haptic may do itself (Next, a link), at the
//   task's own end (`reached`); or, for a task whose answer is "that can't be
//   done here", anywhere, as long as nothing was committed;
// - every field Haptic set holds what the task asked for, read by Playwright
//   from the page when the next step is asked for;
// - nothing of Haptic's reached the last control it was to leave, and Haptic
//   sent no form;
// - Northpine's stored data (localStorage "northpine-data") changed only by
//   the visitor's own steps, never between them.
// The runner, as the visitor, never does the last control itself. A step the
// widget does not list is reported with the labels it did list nearby.
//
// Northpine must be running (cd testbed && npm run dev, or the stand-in data
// layer for now: see the round's notes); NORTHPINE_URL says where, by default
// http://localhost:4200. If it is not, the runner says so and stops. Every
// request that would leave this machine is stopped. No model and no Haptic
// server is called.
//
//   npm run eval:acts -- [area or task id prefix ...] [--parallel 2] [--out results.json] [--naive]
//
// --naive answers the commit with "do: click" and "commits": false, as a model
// that misses it would. The widget must still not press it: the run then ends
// with the visitor pointed at the commit instead of the hand-over.

type Request = Omit<TurnRequest, "site">;

/** The areas of the smallest version. */
const AREAS = ["cards", "people", "expenses", "rmb"];
/** How long one step may take before the run gives up on it. */
const STEP_MS = 25_000;
const ALLOWED = (origin: string) => (url: URL) => !(url.origin === origin || /^(data|blob|about):/.test(url.protocol));

/**
 * One answer of the script: a step of the task, or a list opened and picked
 * from, which is one choice in act mode. `steps` are the task's own steps it
 * stands for, which the visitor does when the widget gives it to them.
 */
interface Item {
  /** The control the answer names. */
  control: Step;
  /** What Haptic is asked to do, or null for the hand-over and for a control the task points at and leaves. */
  do: Doing | null;
  /** The text to type, or the choice to pick. */
  enter?: string;
  /** For a pick, every name the task gives the choice: the field may show any of them. */
  names?: string[];
  /** The last control, which commits: the hand-over. */
  commit: boolean;
  /** The task ends on this control unpressed, and it is not a commit: pointed at, and left to the visitor. */
  last: boolean;
  /** The task's own steps for it, which the visitor does when it is their turn. */
  steps: Step[];
}

export interface ActResult {
  id: string;
  /**
   * How it ended:
   * - "hand-over": the hand-over on the task's last control, with What I did.
   * - "pointed": the last control given to the visitor ("your turn"), unpressed.
   * - "stopped": acting stopped with the pointer on the last control: a confirmation the page opened, or a commit of a kind the visitor did not ask for.
   * - "done": Haptic did the last step itself (one that does not commit, such as Next) and the task's own end, `reached`, holds.
   * - "finished": it ended anywhere else, with a sentence.
   */
  end: "hand-over" | "pointed" | "stopped" | "done" | "finished" | "stuck" | "error";
  /** Whether the end is the right one for the task. */
  right: boolean;
  why?: string;
  /** Actions Haptic took, and steps it gave the visitor, with the reason it gave. */
  actions: number;
  yourTurn: string[];
  /** Steps whose control the widget did not list, with the listed labels nearest to it. */
  unlisted: string[];
  /** Fields set as the task asks, of those checked. */
  fields: { ok: number; checked: number; wrong: string[] };
  /** Whether anything of Haptic's reached the last control, when Haptic was to leave it to the visitor, or Haptic sent a form. */
  commitPressed: boolean;
  /** What reached it, when something did. */
  pressed?: string[];
  /** Whether Northpine's stored data is as it was, apart from what the visitor's own steps changed. */
  dataUnchanged: boolean;
  /** What Haptic told the model it did, step by step. */
  events: string[];
  did: string[];
  caption: string;
  /** The words of what the pointer was on at the end, and the step last asked about, counting from 1. */
  pointed: string;
  step: number;
  ms: number;
}

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, "");

/**
 * The listed control for a step's matchers: an exact match, or one of the
 * same role whose label starts with the matcher's. `nth` picks among those
 * listed alike, as the task's selector does with ">> nth=".
 */
function locate(matchers: Matcher[], listed: SnapElement[], nth = 0, actRole?: string): SnapElement | undefined {
  for (const matcher of matchers) {
    const exact = nth ? listed.filter((element) => findListed([matcher], [element]))[nth] : findListed([matcher], listed);
    if (exact) return exact;
    const want = squash(matcher.label);
    // The role the task's own selector names counts too: a task can call a tab a link.
    const roleFits = (role: string) => !matcher.role || role === matcher.role || role === actRole || (matcher.role === "combobox" && role === "select");
    const loose = listed.find((element) => roleFits(element.role) && want.length >= 2 && (squash(element.label).startsWith(want) || squash(element.label).includes(`(${want})`)));
    if (loose) return loose;
  }
  return undefined;
}

/** The selector an act is done on. */
function selectorOf(act: Act | undefined): string | undefined {
  if (!act) return undefined;
  if ("click" in act) return act.click;
  if ("fill" in act) return act.fill[0];
  if ("select" in act) return act.select[0];
  if ("check" in act) return act.check;
  if ("press" in act) return act.press[0];
  return act.hover;
}

/** The matchers in the order the act names them: the one its selector names first. */
function ordered(step: Step): Matcher[] {
  const selector = squash(selectorOf(step.act) ?? "");
  const named = step.expect.filter((matcher) => selector.includes(squash(matcher.label).slice(0, 6)));
  return [...named, ...step.expect.filter((matcher) => !named.includes(matcher))];
}

const opensList = (step: Step) => !!step.act && "click" in step.act && (/role=combobox/.test(step.act.click) || step.expect.some((matcher) => matcher.role === "combobox"));
const picks = (step: Step) => !!step.act && "click" in step.act && (/role=option/.test(step.act.click) || step.expect.some((matcher) => matcher.role === "option"));

/**
 * A task's steps as act-mode answers. `naive`: the commit is answered with a
 * click, as a model that misses it would. A pick is asked for in the words of
 * the task's names for it that the question already holds, if any does.
 */
export function scriptOf(guide: Guide, grounded: (value: string, words: string) => boolean, naive = false): Item[] {
  const steps = guide.steps.filter((step) => step.expect.length);
  const items: Item[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const act = step.act;
    const lastOne = i === steps.length - 1;
    if (!act) {
      // The task stops here, at a control that must not be pressed.
      const commit = ordered(step).some((matcher) => !!readName(matcher.label).commit);
      items.push({ control: step, do: null, commit, last: !commit, steps: [] });
      continue;
    }
    // A list opened and picked from, with a search typed in it on the way: one choice.
    if (opensList(step)) {
      const search = steps[i + 1]?.act && "fill" in steps[i + 1]!.act! && picks(steps[i + 2] ?? { expect: [] }) ? steps[i + 1] : undefined;
      const pick = search ? steps[i + 2] : picks(steps[i + 1] ?? { expect: [] }) ? steps[i + 1] : undefined;
      if (pick) {
        const names = ordered(pick).map((matcher) => matcher.label);
        const enter = names.find((name) => grounded(name, guide.goal)) ?? names[0]!;
        items.push({ control: step, do: "choose", enter, names, commit: false, last: false, steps: [step, ...(search ? [search] : []), pick] });
        i += search ? 2 : 1;
        continue;
      }
    }
    const label = ordered(step)[0]?.label ?? "";
    // The last click of a task commits when its words say so: a link there only leads to a form.
    const commit = lastOne && "click" in act && !/role=link/.test(act.click) && !!readName(label).commit;
    if (commit) {
      items.push({ control: step, do: naive ? "click" : null, commit: true, last: false, steps: [step] });
      continue;
    }
    if ("fill" in act) items.push({ control: step, do: "type", enter: act.fill[1], commit: false, last: false, steps: [step] });
    else if ("select" in act) items.push({ control: step, do: "choose", enter: act.select[1], commit: false, last: false, steps: [step] });
    else if ("check" in act) items.push({ control: step, do: "check", commit: false, last: false, steps: [step] });
    else if ("press" in act) items.push({ control: step, do: act.press[1] === "Enter" ? "press_enter" : null, commit: false, last: false, steps: [step] });
    else items.push({ control: step, do: "click", commit: false, last: false, steps: [step] });
  }
  return items;
}

/** The question, with every value the script enters that the visitor's words do not hold added to it, as the visitor would have said it. */
export function questionOf(guide: Guide, items: Item[], grounded: (value: string, words: string) => boolean): string {
  // A task's own value is added only where the visitor's words lack it.
  let question = guide.goal;
  for (const item of items) {
    if (!item.enter || grounded(item.enter, question)) continue;
    const label = ordered(item.control)[0]?.label ?? "it";
    question += `${/[.?!]$/.test(question.trim()) ? "" : "."} ${label}: ${item.enter}.`;
  }
  return question;
}

/** The answer to one question, from the script. */
function answer(item: Item | undefined, request: Request): { reply: TurnReply; listed?: SnapElement } {
  if (!item) return { reply: { target: null, status: "done", say: "That's everything.", mode: "act" } };
  const selector = selectorOf(item.control.act) ?? "";
  const nth = Number(/>>\s*nth=(\d+)/.exec(selector)?.[1] ?? 0);
  const listed = locate(ordered(item.control), request.snapshot.elements, nth, /role=([a-z]+)/.exec(selector)?.[1]);
  if (!listed) return { reply: { target: null, status: "continue", say: `Do this yourself: ${ordered(item.control)[0]?.label ?? "the next step"}.`, mode: "act" } };
  const name = listed.label || ordered(item.control)[0]?.label || "it";
  if (item.commit && item.do === null) return { reply: { target: listed.id, do: null, commits: true, status: "done", say: `Ready. Check it and click ${name}.`, mode: "act" }, listed };
  if (item.last) return { reply: { target: listed.id, do: null, commits: false, status: "done", say: `It's here: ${name}.`, mode: "act" }, listed };
  let act = item.do;
  // A box is set to on unless it is on already: the task ticks it.
  if (act === "click" && (listed.role === "checkbox" || listed.role === "switch")) act = (listed.state ?? []).includes("checked") ? "uncheck" : "check";
  const say = act === "type" ? `Typing ${item.enter}.` : act === "choose" ? `Choosing ${item.enter}.` : `Using ${name}.`;
  return { reply: { target: listed.id, do: act, ...(item.enter !== undefined ? { enter: item.enter } : {}), commits: false, status: "continue", say, mode: "act" }, listed };
}

/** What the page shows for a step Haptic did, read with Playwright: the field's value, the box's state, the list's choice. Empty when it holds. */
async function checkStep(page: Page, item: Item): Promise<string | undefined> {
  const step = item.steps[0];
  const selector = selectorOf(step?.act);
  if (!selector || !item.do || item.do === "click" || item.do === "press_enter") return undefined;
  const field = page.locator(selector).first();
  if (!(await field.count().catch(() => 0))) return undefined;
  try {
    if (item.do === "type") {
      const value = await field.inputValue({ timeout: 2000 });
      const want = item.enter ?? "";
      const digits = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
      return digits(value).includes(digits(want)) ? "" : `${selector} holds "${value}", not "${want}"`;
    }
    if (item.do === "check" || item.do === "uncheck") {
      const on = (await field.getAttribute("aria-checked", { timeout: 2000 })) === "true" || (await field.isChecked({ timeout: 2000 }).catch(() => false));
      return on === (item.do === "check") ? "" : `${selector} is ${on ? "on" : "off"}`;
    }
    // A choice: the field shows it, by any of the task's names for it.
    const shown = `${(await field.textContent({ timeout: 2000 })) ?? ""} ${await field.inputValue({ timeout: 500 }).catch(() => "")}`;
    const names = item.names ?? [item.enter ?? ""];
    return names.some((name) => squash(shown).includes(squash(name))) ? "" : `${selector} shows "${shown.trim().slice(0, 60)}", not "${names.join('" or "')}"`;
  } catch (error) {
    return `${selector} could not be read: ${(error as Error).message.split("\n")[0]}`;
  }
}

/**
 * Notes every press, click, key and form submit on the page, from before the
 * page's own scripts run, with the words of the control it reached as they
 * were at that moment: a page can draw its last button on the node that was
 * "Next" a step before.
 */
const COUNT_PRESSES = `(() => {
  window.__acted = [];
  for (const type of ['pointerdown', 'mousedown', 'click', 'keydown', 'submit']) {
    document.addEventListener(type, (event) => {
      const at = event.target instanceof Element ? event.target.closest('button, a, input, [role]') : null;
      const words = at ? (at.getAttribute('aria-label') || at.textContent || at.value || '').replace(/\\s+/g, ' ').trim() : '';
      const role = !at ? '' : at.getAttribute('role') || (at.tagName === 'A' ? 'link' : at.tagName === 'BUTTON' || (at.tagName === 'INPUT' && /^(submit|button|image)$/.test(at.type)) ? 'button' : at.tagName.toLowerCase());
      window.__acted.push({ type, words, role, visitor: event.isTrusted });
    }, true);
  }
})();`;

// The next two run in the page. They are written as text: a function handed to
// the browser would arrive with this project's build helpers still in it.

/**
 * What of Haptic's own reached a control with the last control's words and
 * role, when Haptic was to leave it, or sent a form: none is what a run must
 * end with. What the visitor's own steps did, as the runner does them, is
 * theirs.
 */
async function pressedCommit(page: Page, last: Matcher | undefined): Promise<string[]> {
  const acted = (await page.evaluate("window.__acted")) as { type: string; words: string; role: string; visitor: boolean }[];
  const name = squash(last?.label ?? "");
  const role = last?.role ?? "button";
  return acted
    .filter((entry) => !entry.visitor && (entry.type === "submit" || (!!name && squash(entry.words) === name && entry.role === role)))
    .map((entry) => `${entry.type} on ${entry.role} "${entry.words}"`);
}

/** Where the widget is, what it says, what it points at, and the lines of What I did. */
async function widget(page: Page): Promise<{ state: string; caption: string; status: string; pointed: string; did: string[] }> {
  return page.evaluate(`(() => {
    const root = document.querySelector("haptic-root");
    const shadow = root?.shadowRoot;
    const shown = (selector) => {
      const el = shadow?.querySelector(selector);
      return el && !el.hidden ? (el.textContent ?? "") : "";
    };
    const did = shadow?.querySelector(".did");
    const pointed = root?.pointedAt;
    return {
      state: root?.guideState ?? "",
      caption: shown(".caption") ? shown(".caption span") : "",
      status: shown(".status") ? shown(".status span") : "",
      pointed: pointed ? (pointed.getAttribute("aria-label") ?? pointed.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 80) : "",
      did: did && !did.hidden ? Array.from(did.querySelectorAll(".line")).map((line) => (line.textContent ?? "").replace(/\\s+/g, " ").trim()) : [],
    };
  })()`);
}

/** Runs one task in act mode. */
export async function actOn(browser: Browser, set: GuideSet, guide: Guide, options: { naive?: boolean; grounded: (value: string, words: string) => boolean }): Promise<ActResult> {
  const started = Date.now();
  const items = scriptOf(guide, options.grounded, options.naive);
  const question = questionOf(guide, items, options.grounded);
  const result: ActResult = { id: guide.id, end: "stuck", right: false, unlisted: [], pointed: "", step: 0, actions: 0, yourTurn: [], fields: { ok: 0, checked: 0, wrong: [] }, commitPressed: false, dataUnchanged: true, events: [], did: [], caption: "", ms: 0 };
  /** The index of the item the last question was answered with, and whether the visitor has done it. */
  let asked = -1;
  let visitorDid = -1;
  let page: Page | undefined;
  const checked = new Set<number>();
  const reply = async (request: Request): Promise<TurnReply> => {
    const index = request.step;
    if (request.event && index > 0 && !result.events.includes(request.event)) result.events.push(request.event);
    // The step before has been done, by Haptic or the visitor: what it set is read from the page now.
    const before = items[index - 1];
    if (page && before && !checked.has(index - 1)) {
      checked.add(index - 1);
      const wrong = await checkStep(page, before);
      if (wrong !== undefined) {
        result.fields.checked++;
        if (wrong) result.fields.wrong.push(wrong);
        else result.fields.ok++;
      }
    }
    asked = index;
    const answered = answer(items[index], request);
    const item = items[index];
    if (item && !answered.listed) {
      const label = ordered(item.control)[0]?.label ?? "";
      const words = label.toLowerCase().split(/\W+/).filter((word) => word.length > 2);
      const near = request.snapshot.elements
        .map((element) => ({ element, score: words.filter((word) => element.label.toLowerCase().includes(word)).length }))
        .filter((found) => found.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(({ element }) => `${element.role} "${element.label}"`);
      const line = `step ${index + 1}, ${label}${near.length ? ` (listed nearby: ${near.join(", ")})` : " (nothing like it listed)"}`;
      if (!result.unlisted.includes(line)) result.unlisted.push(line);
    }
    return answered.reply;
  };
  let opened: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // Nothing leaves this machine.
    const guarded = {
      newContext: async (settings: unknown) => {
        const context = await browser.newContext(settings);
        await context.route(ALLOWED(new URL(set.origin).origin), (route: Page) => route.abort());
        await context.addInitScript(COUNT_PRESSES);
        return context;
      },
    };
    opened = await open(guarded, set, guide.start, reply, undefined, { acting: { maxActions: 25, confirmFirst: false } });
    page = opened.page;
    // A visitor's step that cannot be done is a finding, not a half-minute wait.
    page.setDefaultTimeout(10_000);
    const data = (): Promise<string> => page!.evaluate(`localStorage.getItem("northpine-data") ?? ""`);
    const dataBefore = await data();
    await page.locator("haptic-root .launcher").click();
    await page.locator("haptic-root .panel input").fill(question);
    await page.locator("haptic-root .panel .doit").click();
    let lastChange = Date.now();
    let lastAsked = asked;
    /** The data as it stood after the visitor's last own step: any change since then is Haptic's. */
    let known = dataBefore;
    let hapticChanged = false;
    const final = items.length - 1;
    const finalLabel = final >= 0 ? (ordered(items[final]!.control)[0]?.label ?? "") : "";
    // Whether the pointer is on the last control: the element the task's own selector finds, or failing that, its words.
    const finalSelector = final >= 0 ? (selectorOf(items[final]!.control.act) ?? (ordered(items[final]!.control)[0]?.role ? `role=${ordered(items[final]!.control)[0]!.role}[name="${finalLabel.replace(/"/g, '\\"')}"]` : `text=${finalLabel}`)) : "";
    const onFinal = async (pointed: string): Promise<boolean> => {
      // Where the selector finds the control, only that element counts: another control with the same words, earlier on, is not it.
      const there = finalSelector ? await page!.locator(finalSelector).count().catch(() => 0) : 0;
      // Not on the page: the words of what is pointed at decide, but only at the last step, since an earlier control can share them.
      if (!there) return asked === final && !!finalLabel && squash(pointed).includes(squash(finalLabel).slice(0, 12));
      return page!
        .locator(finalSelector)
        .first()
        .evaluate((el: Element) => {
          const at = (document.querySelector("haptic-root") as (Element & { pointedAt?: Element }) | null)?.pointedAt;
          return !!at && (at === el || at.contains(el) || el.contains(at) || (el instanceof HTMLInputElement && Array.from(el.labels ?? []).includes(at as HTMLLabelElement)));
        }, undefined, { timeout: 2000 })
        .catch(() => false);
    };
    for (;;) {
      await page.waitForTimeout(150);
      if (asked !== lastAsked) {
        lastAsked = asked;
        lastChange = Date.now();
      }
      const now = await widget(page);
      result.pointed = now.pointed;
      result.step = asked + 1;
      if (now.state === "finished") {
        result.caption = now.caption;
        result.did = now.did;
        if (final < 0) {
          // A task with nothing to do here: the right end is that Haptic did nothing.
          result.end = "finished";
          result.right = true;
        } else if (asked > final) {
          // The script ran out after Haptic did the last step itself: the task's own end must hold.
          const why = guide.reached ? await reachedAnyOrWhy(page, guide.reached, 4000) : "";
          result.end = "done";
          result.right = !why;
          if (why) result.why = why;
        } else {
          // Acting stopped with the pointer on the last control, at whatever step: a confirmation the page opened, or a commit not asked for.
          result.end = await onFinal(now.pointed) ? "stopped" : "finished";
          result.right = result.end === "stopped";
        }
        break;
      }
      if ((now.state === "pointing" || now.state === "watching") && asked >= 0) {
        const item = items[asked];
        // The last control: it is left to the visitor, whether as the hand-over or as their turn. The visitor here never presses it.
        if (asked === final) {
          result.end = now.status === "" && /^Ready/.test(now.caption) ? "hand-over" : "pointed";
          result.caption = now.caption;
          result.did = now.did;
          result.right = await onFinal(now.pointed);
          if (!result.right) result.why = now.pointed ? `the pointer is on "${now.pointed}", not on ${finalLabel}` : `the widget does not list ${finalLabel}, so nothing points at it`;
          break;
        }
        if (item && visitorDid < asked) {
          // Haptic gave this step to the visitor: they do it as the task says.
          visitorDid = asked;
          if ((await data()) !== known) hapticChanged = true;
          result.yourTurn.push(`${ordered(item.control)[0]?.label ?? "?"}: ${now.caption}`);
          try {
            for (const [part, step] of item.steps.entries()) {
              if (!step.act) continue;
              // A person stops once the widget has moved on: what is left of the step is Haptic's again.
              if (part > 0 && !["pointing", "watching"].includes((await widget(page)).state)) break;
              await perform(page, step.act);
              await page.waitForTimeout(400);
            }
          } catch (error) {
            result.end = "stuck";
            result.why = `the visitor could not do step ${asked + 1} as the task says: ${(error as Error).message.split("\n")[0]}`;
            break;
          }
          // What the visitor's own step saves is theirs.
          await page.waitForTimeout(1500);
          known = await data();
          lastChange = Date.now();
        }
      }
      if (Date.now() - lastChange > STEP_MS) {
        result.end = "stuck";
        result.why = `nothing moved for ${STEP_MS / 1000} s after step ${asked + 1} (state "${now.state}", caption "${now.caption}")`;
        result.caption = now.caption;
        break;
      }
    }
    // Haptic leaves the last control to the visitor when it commits, and never sends a form. A last step that does not commit (a tab, Next) it may do.
    const left = final >= 0 && items[final]!.commit;
    const matcher = final >= 0 ? ordered(items[final]!.control)[0] : undefined;
    const pressed = await pressedCommit(page, left ? matcher : undefined);
    result.commitPressed = pressed.length > 0;
    if (pressed.length) result.pressed = pressed;
    if ((await data()) !== known) hapticChanged = true;
    result.dataUnchanged = !hapticChanged;
    // A task whose right answer is "that can't be done here" ends right wherever it ends, as long as Haptic did nothing that commits.
    if (guide.kind === "no-answer" && result.end !== "stuck") result.right = true;
    result.actions = result.events.filter((event) => /^You (?!did not|could not|stopped)/.test(event)).length;
  } catch (error) {
    result.end = "error";
    result.why = (error as Error).message.split("\n")[0];
  } finally {
    await opened?.close().catch(() => undefined);
    result.ms = Date.now() - started;
  }
  return result;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const at = argv.indexOf(name);
    if (at < 0) return undefined;
    const value = argv[at + 1];
    argv.splice(at, 2);
    return value;
  };
  const parallel = Number(flag("--parallel") ?? 2);
  const out = flag("--out");
  const naive = argv.includes("--naive");
  const wanted = argv.filter((arg) => !arg.startsWith("--"));
  const { grounded } = await import("../src/shared/act-rules.ts");
  let set: GuideSet;
  try {
    set = (await import("./guides/northpine.ts")).default as GuideSet;
  } catch (error) {
    console.error(`Northpine's tasks could not be loaded: ${(error as Error).message}`);
    process.exit(1);
  }
  try {
    const response = await fetch(set.origin);
    if (!response.ok) throw new Error(`it answered ${response.status}`);
  } catch (error) {
    console.error(`Northpine is not running at ${set.origin} (${(error as Error).message}). Start it with: cd testbed && npm run dev. Its data layer (testbed/src/data) has to be there for it to build.`);
    process.exit(1);
  }
  const prefixes = wanted.length ? wanted : AREAS;
  const guides = set.guides.filter((guide) => prefixes.some((prefix) => guide.id === prefix || guide.id.startsWith(`${prefix}-`) || guide.id.startsWith(prefix)));
  if (!guides.length) {
    console.error(`No Northpine task starts with ${prefixes.join(", ")}.`);
    process.exit(1);
  }
  const browser = await launch();
  const results: ActResult[] = [];
  const queue = [...guides];
  await Promise.all(
    Array.from({ length: Math.max(1, parallel) }, async () => {
      for (let guide = queue.shift(); guide; guide = queue.shift()) {
        const result = await actOn(browser, set, guide, { naive, grounded });
        results.push(result);
        const fine = result.right && !result.commitPressed && result.dataUnchanged && !result.fields.wrong.length;
        const parts = [
          `${result.end}${result.why ? ` (${result.why})` : ""}`,
          `${result.actions} actions`,
          `${result.yourTurn.length} your turn`,
          `fields ${result.fields.ok}/${result.fields.checked}`,
          result.commitPressed ? "COMMIT PRESSED" : "commit not pressed",
          result.dataUnchanged ? "data unchanged" : "DATA CHANGED BY HAPTIC",
        ];
        console.log(`${fine ? "ok  " : "FAIL"} ${guide.id}: ${parts.join(", ")}${result.end === "finished" || result.end === "stopped" ? `. Said: "${result.caption}"` : ""}`);
        for (const turn of result.yourTurn) console.log(`       your turn: ${turn}`);
        for (const wrong of result.fields.wrong) console.log(`       field: ${wrong}`);
        for (const press of result.pressed ?? []) console.log(`       reached the commit: ${press}`);
        for (const missing of result.unlisted) console.log(`       not listed: ${missing}`);
      }
    }),
  );
  await browser.close();
  results.sort((a, b) => guides.findIndex((guide) => guide.id === a.id) - guides.findIndex((guide) => guide.id === b.id));
  const count = (test: (result: ActResult) => boolean) => results.filter(test).length;
  console.log("");
  console.log(
    `${results.length} tasks, ${count((r) => r.right && !r.commitPressed && r.dataUnchanged && !r.fields.wrong.length)} ending right: ${count((r) => r.end === "hand-over")} at the hand-over, ${count((r) => r.end === "pointed")} with the last control given to the visitor, ${count((r) => r.end === "stopped")} stopped on it, ${count((r) => r.end === "done")} done to the task's end, ${count((r) => r.end === "finished")} ended elsewhere with a sentence, ${count((r) => r.end === "stuck" || r.end === "error")} stuck or failed.`,
  );
  console.log(`Commit pressed in ${count((r) => r.commitPressed)}; data changed in ${count((r) => !r.dataUnchanged)}; fields set as asked ${results.reduce((n, r) => n + r.fields.ok, 0)} of ${results.reduce((n, r) => n + r.fields.checked, 0)}; your-turn steps ${results.reduce((n, r) => n + r.yourTurn.length, 0)}.`);
  if (out) await writeFile(out, JSON.stringify(results, null, 2) + "\n");
  process.exit(results.some((r) => r.commitPressed || !r.dataUnchanged) ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
