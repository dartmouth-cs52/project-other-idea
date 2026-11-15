import { mkdir, writeFile } from "node:fs/promises";
import { describeElement, type SnapElement, type Snapshot, type TurnReply } from "../../src/shared/types.ts";
import { Session, type AxControl, type Bundles, type Context } from "./session.ts";
import type { Action, Demo, DemoResult, Heard, Kit, ListedResult, Locator, OverlayResult, ReadAt, StepResult, Target } from "./types.ts";

// The checks every demo goes through, whatever the toolkit:
//
// 1. Listed. The controls a visitor could use in the demo, by the browser's
//    accessibility tree, against the widget's list. Each listed entry is tied
//    to its element by running the widget's own reader beside it.
// 2. Heard. The model's answer is scripted to point at a control. A real mouse
//    or keyboard uses it, and the widget's next question must come, with a
//    true sentence about what the visitor did.
// 3. Read at the right time. The list sent with that next question, against
//    the page once it has finished changing.
// And for anything that opens over the page: can the visitor still type a
// question into Haptic's box, and are the overlay's controls the ones listed.

/** How long the widget may take to ask its next question after an action: a typing pause, the settle, and room to spare. */
const NEXT_QUESTION_MS = 10_000;
/** How long after the widget asks before the page is read again, to see what it looks like once it has stopped changing. */
const SETTLED_MS = 1500;
/** How long a visitor takes to move to the control once the pointer shows. */
const VISITOR_PAUSE_MS = 400;
/** Times the widget may ask about the same page again before an answer stands. */
const MAX_ASKS = 3;

export type Log = (line: string) => void;

let shotsDir: string | undefined;
/** Keeps a screenshot and the list the widget sent at each question, for looking at a failure by hand. */
export function keepShots(dir: string) {
  shotsDir = dir;
}

async function shoot(session: Session, name: string, sent: Snapshot) {
  if (!shotsDir) return;
  const file = `${shotsDir}/${name.replace(/[^\w.-]+/g, "_")}`;
  await mkdir(shotsDir, { recursive: true });
  await session.page.screenshot({ path: `${file}.png` }).catch(() => undefined);
  await writeFile(`${file}.json`, JSON.stringify(sent, null, 1) + "\n");
}

/** The widget's reading of the page, with each listed entry tied to its element. */
interface Reading {
  snapshot: Snapshot;
  ids: Record<string, number>;
  inDemo: Record<string, boolean>;
}

interface Shown extends AxControl {
  shown: boolean;
  inDemo: boolean;
  haptic: boolean;
}

interface PageState {
  reading: Reading;
  controls: Shown[];
}

/** What identifies a listed control from one reading to the next, where its id differs. */
export function keyOf(element: SnapElement): string {
  return `${element.role}|${element.label}|${element.icon ?? ""}|${element.context ?? ""}|${element.href ?? ""}`;
}

/** A listed control's whole line, as the model reads it. Two controls with the same line cannot be told apart. */
export function lineOf(element: SnapElement): string {
  const extras = [
    element.icon && `icon ${element.icon}`,
    element.state?.length && element.state.join(" "),
    element.href && `to ${element.href}`,
    element.context && `in ${element.context}`,
    element.options?.length && `options ${element.options.join("/")}`,
  ].filter(Boolean);
  return `${element.role} "${element.label}"${extras.length ? ` [${extras.join("; ")}]` : ""}`;
}

function counts(keys: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const key of keys) map.set(key, (map.get(key) ?? 0) + 1);
  return map;
}

/** Keys in `a` beyond how many times they are in `b`. */
function beyond(a: string[], b: string[]): string[] {
  const left = counts(b);
  const out: string[] = [];
  for (const key of a) {
    const n = left.get(key) ?? 0;
    if (n > 0) left.set(key, n - 1);
    else out.push(key);
  }
  return out;
}

function sameList(a: SnapElement[], b: SnapElement[]): boolean {
  return a.length === b.length && a.every((element, i) => keyOf(element) === keyOf(b[i]!));
}

function targetOf(action: Action): Target {
  if ("click" in action) return action.click;
  if ("type" in action) return action.type;
  if ("keys" in action) return action.keys;
  if ("drag" in action) return action.drag;
  return action.hover;
}

function describeTarget(target: Target): string {
  const what = target.role ? `${target.role}${target.name !== undefined ? ` "${target.name}"` : ""}` : `"${target.text}"`;
  return `${what}${target.nth ? ` #${target.nth + 1}` : ""}${target.where === "page" ? " (in what opened)" : ""}`;
}

export function describeAction(action: Action): string {
  if ("click" in action) return `click ${describeTarget(action.click)}`;
  if ("type" in action) return `type "${action.text}" into ${describeTarget(action.type)}`;
  if ("keys" in action) return `press ${action.press.join(", ")} on ${describeTarget(action.keys)}`;
  if ("drag" in action) return `drag ${describeTarget(action.drag)} by ${action.by.join(",")}`;
  return `hover ${describeTarget(action.hover)}`;
}

function locate(session: Session, box: Locator, target: Target, one = true): Locator {
  const scope = target.where === "page" ? session.page : box;
  // A name given as words is matched whole: "Male" must not find "Female". A pattern is for when part of it will do.
  const exact = target.exact ?? true;
  const found = (
    target.text !== undefined ? scope.getByText(target.text, { exact }) : scope.getByRole(target.role, { name: target.name, exact })
  ).filter({ visible: true });
  return one ? found.nth(target.nth ?? 0) : found;
}

interface Where {
  shown: boolean;
  inDemo: boolean;
  haptic: boolean;
  tag: string;
  selectable: boolean;
  sortable: boolean;
  holdsControl: boolean;
}

/**
 * A cell is a control only when it is a button or can be selected, like a
 * calendar's day, and a column header only when it sorts. Either is only
 * where a control sits when it holds one.
 */
function isControl(c: AxControl & Where): boolean {
  if (!c.shown || c.haptic) return false;
  if (c.role === "gridcell") return !c.holdsControl && (c.tag === "button" || c.selectable);
  if (c.role === "columnheader") return !c.holdsControl && c.sortable;
  return true;
}

async function read(session: Session): Promise<PageState> {
  const reading = await session.call<Reading>("snap", false);
  const controls = await session.axControls();
  const where = await session.call<Where[]>("where", controls.map((c) => c.handle), controls.map((c) => c.role));
  return { reading, controls: controls.map((c, i) => ({ ...c, ...where[i]! })).filter(isControl) };
}

/** What a listed control is and what state it is in, to compare two lists. */
function readKeyOf(element: SnapElement): string {
  return `${keyOf(element)}|${(element.state ?? []).join(",")}`;
}

/**
 * Finds a step's control. One in what a control opened is looked for among
 * the controls that appeared since the demo was first read, never elsewhere
 * on the page: a documentation page often shows the same thing twice.
 */
async function find(session: Session, box: Locator, target: Target, appeared: Set<number>): Promise<number | undefined> {
  const all = locate(session, box, { ...target, nth: undefined }, false);
  const count = Math.min(await all.count(), 60);
  if (target.where !== "page") return count > (target.nth ?? 0) ? session.handleOf(all.nth(target.nth ?? 0)) : undefined;
  const matches: number[] = [];
  for (let i = 0; i < count; i++) {
    const handle = await session.handleOf(all.nth(i));
    if (appeared.has(handle) || (await session.call<boolean>("isAdded", handle))) matches.push(handle);
  }
  return matches[target.nth ?? 0];
}

/** Waits until the element has stopped moving, as a visitor waits for a page to finish scrolling to the pointer. */
async function holdStill(session: Session, handle: number) {
  let last = "";
  for (const until = Date.now() + 3000; Date.now() < until; ) {
    const now = await session.call<string>("boxOf", handle);
    if (now === last) return;
    last = now;
    await session.page.waitForTimeout(150);
  }
}

/** The id the sent list gives an element, found through a reading of the same page beside it. */
async function idInSent(session: Session, handle: number, state: PageState, sent: Snapshot): Promise<string | undefined> {
  const [id] = await session.call<(string | undefined)[]>("relate", [handle], state.reading.ids);
  if (!id) return undefined;
  if (sameList(state.reading.snapshot.elements, sent.elements)) return id;
  // The page moved between the two readings. Match by what the control is, and its place among its equals.
  const read = state.reading.snapshot.elements;
  const mine = read.find((element) => element.id === id);
  if (!mine) return undefined;
  const nth = read.filter((element) => keyOf(element) === keyOf(mine)).indexOf(mine);
  return sent.elements.filter((element) => keyOf(element) === keyOf(mine))[nth]?.id;
}

/** Waits until the widget's pointer is on the element, or it asks again, or it gives up. */
async function waitForPointer(session: Session, handle: number): Promise<"pointed" | "elsewhere" | "asked again" | "none"> {
  for (const until = Date.now() + 5000; Date.now() < until; ) {
    if (session.turns.pending) return "asked again";
    const pointed = await session.call<number>("pointed");
    if (pointed >= 0) return (await session.call<boolean>("pointedNear", handle)) ? "pointed" : "elsewhere";
    await session.page.waitForTimeout(100);
  }
  return "none";
}

interface Aim {
  x: number;
  y: number;
  coveredByHaptic: boolean;
  blocker: string;
}

/** Does the action with a real mouse and keyboard, as a person would. */
async function act(session: Session, action: Action, handle: number): Promise<Aim> {
  await holdStill(session, handle);
  const aim = await session.call<Aim>("aim", handle);
  if ("click" in action) await session.clickAt(aim.x, aim.y);
  else if ("type" in action) {
    await session.clickAt(aim.x, aim.y);
    await session.page.waitForTimeout(250);
    await session.typeKeys(action.text);
  } else if ("keys" in action) {
    await session.clickAt(aim.x, aim.y);
    await session.page.waitForTimeout(250);
    for (const key of action.press) await session.press(key);
  } else if ("drag" in action) await session.drag(aim.x, aim.y, action.by);
  else await session.page.mouse.move(aim.x, aim.y, { steps: 8 });
  return aim;
}

/**
 * Whether the widget's sentence about what the visitor did is true: it names
 * the control they used, says what they did with it, and does not say they
 * went somewhere else.
 */
export function judgeEvent(event: string | undefined, action: Action, used: SnapElement): { heard: Heard; why?: string } {
  if (!event) return { heard: "unclear", why: "the widget asked again without saying what the visitor did" };
  if (/instead of|without using|something else/i.test(event)) return { heard: "wrong", why: "it says the visitor did not use the control they used" };
  const named = describeElement(used);
  if (!event.includes(named) && !(used.label && event.includes(`"${used.label}"`))) return { heard: "unclear", why: `the sentence does not name ${named}` };
  const verbs =
    "type" in action ? /filled|typed|entered|wrote/i : "drag" in action ? /filled|moved|set|changed|dragged|slid|clicked/i : "click" in action ? /clicked|chose|picked|selected|pressed|opened|checked|ticked|toggled/i : /./;
  if (!verbs.test(event)) return { heard: "unclear", why: "the sentence names the control but not what was done with it" };
  return { heard: "true" };
}

/**
 * The listed check for a set of controls the accessibility tree has: how many
 * the widget listed, which it did not, and whether those it listed have a
 * name and can be told apart.
 */
async function judgeListed(session: Session, state: PageState, expected: Shown[], listedIds: string[], sent: Snapshot): Promise<ListedResult> {
  const related = await session.call<(string | undefined)[]>("relate", expected.map((c) => c.handle), state.reading.ids);
  const missing: ListedResult["missing"] = [];
  const unmatched = expected.filter((_, i) => !related[i]);
  let cut: (string | undefined)[] = [];
  if (unmatched.length && session.liftedLimits) {
    const all = await session.call<Reading>("snap", true);
    cut = await session.call<(string | undefined)[]>("relate", unmatched.map((c) => c.handle), all.ids);
  }
  for (const [i, control] of unmatched.entries()) {
    missing.push({ role: control.role, name: control.name, reason: cut[i] ? "cut by the limit" : "not read", markup: await session.call<string>("markup", control.handle) });
  }
  const byId = new Map(state.reading.snapshot.elements.map((element) => [element.id, element]));
  const treeName = new Map<string, string>();
  related.forEach((id, i) => id && !treeName.has(id) && treeName.set(id, expected[i]!.name));
  const listed = listedIds.map((id) => byId.get(id)).filter((element): element is SnapElement => !!element);
  const unnamed: ListedResult["unnamed"] = [];
  for (const element of listed) {
    if (element.label || element.icon) continue;
    unnamed.push({ line: lineOf(element), treeName: treeName.get(element.id) ?? "", markup: await session.call<string>("markup", state.reading.ids[element.id]!) });
  }
  const groups = new Map<string, SnapElement[]>();
  for (const element of listed) groups.set(lineOf(element), [...(groups.get(lineOf(element)) ?? []), element]);
  const duplicates: ListedResult["duplicates"] = [];
  for (const [line, group] of groups) {
    if (group.length > 1) duplicates.push({ line, count: group.length, markup: await session.call<string>("markup", state.reading.ids[group[0]!.id]!) });
  }
  return {
    expected: expected.length,
    found: related.filter(Boolean).length,
    missing,
    unnamed,
    duplicates,
    lines: listed.length,
    distinct: groups.size,
    matchedSent: sameList(state.reading.snapshot.elements, sent.elements),
  };
}

function merge(into: ListedResult, more: ListedResult, where: string): ListedResult {
  const tag = <T extends object>(items: T[]) => items.map((item) => ({ ...item, where }));
  return {
    expected: into.expected + more.expected,
    found: into.found + more.found,
    missing: [...into.missing, ...tag(more.missing)],
    unnamed: [...into.unnamed, ...tag(more.unnamed)],
    duplicates: [...into.duplicates, ...tag(more.duplicates)],
    lines: into.lines + more.lines,
    distinct: into.distinct + more.distinct,
    matchedSent: into.matchedSent && more.matchedSent,
  };
}

/** Controls the documentation site puts inside a demo's container, which are not the demo's. */
async function chromeHandles(session: Session, kit: Kit, box: Locator): Promise<Set<number>> {
  const handles = new Set<number>();
  for (const target of kit.chrome ?? []) {
    const found = box.getByRole(target.role, { name: target.name, exact: target.exact ?? true });
    for (let i = 0; i < (await found.count()); i++) handles.add(await session.handleOf(found.nth(i)));
  }
  return handles;
}

async function dismiss(session: Session, kit: Kit) {
  for (const target of kit.dismiss ?? []) {
    const found = session.page.getByRole(target.role, { name: target.name, exact: target.exact ?? true }).filter({ visible: true }).first();
    if (!(await found.count())) continue;
    const handle = await session.handleOf(found);
    const aim = await session.call<Aim>("aim", handle);
    await session.clickAt(aim.x, aim.y);
    await session.page.waitForTimeout(500);
  }
}

/** Opens the demo's page, finds the demo, and brings it into view. Says why when it cannot. */
async function openDemo(context: Context, bundles: Bundles, kit: Kit, demo: Demo): Promise<{ session?: Session; box?: Locator; why?: string }> {
  let session: Session;
  try {
    session = await Session.open(context, bundles, kit.origin + demo.path);
  } catch (error) {
    return { why: `the page did not load: ${error instanceof Error ? error.message.split("\n")[0] : error}` };
  }
  await dismiss(session, kit);
  const box = kit.container(session.page, demo.demo).first();
  try {
    await box.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    await session.close();
    return { why: `the demo "${demo.demo}" was not found on the page` };
  }
  await session.call("setContainer", await session.handleOf(box));
  await session.call("showDemo");
  await session.page.waitForTimeout(600);
  return { session, box };
}

export async function runDemo(context: Context, bundles: Bundles, kit: Kit, demo: Demo, log: Log): Promise<DemoResult> {
  const started = Date.now();
  const result: DemoResult = { kit: kit.id, kind: demo.kind, demo: demo.demo, url: kit.origin + demo.path, tested: false, steps: [], notes: [], ms: 0 };
  const done = () => ({ ...result, ms: Date.now() - started });
  if (demo.unreadable) {
    result.unreadable = demo.unreadable;
    result.why = `its controls are inside ${demo.unreadable === "iframe" ? "an iframe" : `a ${demo.unreadable}`}, which the widget does not read`;
    return done();
  }
  if (demo.skip) {
    result.why = demo.skip;
    return done();
  }

  const opened = await openDemo(context, bundles, kit, demo);
  if (!opened.session) {
    result.why = opened.why;
    return done();
  }
  const { session, box } = opened;
  try {
    // A demo whose first control cannot be found has changed: not tested, never a failure.
    const first = demo.steps[0] && locate(session, box, targetOf(demo.steps[0]));
    if (first && !(await first.count())) {
      result.why = `its first control, ${describeTarget(targetOf(demo.steps[0]!))}, was not found`;
      return done();
    }
    result.tested = true;
    const chrome = await chromeHandles(session, kit, box);

    const asked = await session.ask("How do I use this?");
    if (asked.why) result.notes.push(`Asking: ${asked.why}.`);
    if (!asked.typed) {
      result.notes.push("The question could not be asked, so nothing else was checked.");
      return done();
    }
    let turn = await session.turns.next(15_000);
    if (!turn) {
      result.notes.push("The widget never sent the page after the question.");
      return done();
    }
    await shoot(session, `${kit.id}-${demo.demo}-0`, turn.request.snapshot);
    let state = await read(session);
    const demoControls = state.controls.filter((c) => c.inDemo && !chrome.has(c.handle));
    const listedInDemo = Object.keys(state.reading.ids).filter((id) => state.reading.inDemo[id] && !chrome.has(state.reading.ids[id]!));
    result.listed = await judgeListed(session, state, demoControls, listedInDemo, turn.request.snapshot);
    if (turn.request.snapshot.truncated) result.notes.push("The page was over the widget's limit of controls, so its list was cut.");
    log(`    listed ${result.listed.found}/${result.listed.expected}`);

    await session.call("watchAdded");
    // Every control seen so far, by element and by role and name. The page coming back from behind a
    // modal has not "opened", and neither has a control the demo drew again.
    const seen = new Set<number | string>(state.controls.map((c) => c.handle));
    for (const c of state.controls) seen.add(`${c.role}|${c.name}`);
    // Controls that were not there when the demo was first read: what the steps opened.
    const appeared = new Set<number>();
    for (const action of demo.steps) {
      const step = await runStep(session, box, chrome, seen, appeared, action, turn, state, result, log);
      result.steps.push(step.result);
      if (!step.next) break;
      turn = step.next.turn;
      state = step.next.state;
    }
    turn?.answer({ target: null, status: "done", say: "That is all." });
  } catch (error) {
    result.notes.push(`The run stopped with an error in the test: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  } finally {
    await session.close();
  }

  if (demo.overlay && result.tested) result.overlay = await overlayCheck(context, bundles, kit, demo, log);
  return done();
}

interface StepOutcome {
  result: StepResult;
  next?: { turn: NonNullable<Awaited<ReturnType<Session["turns"]["next"]>>>; state: PageState };
}

async function runStep(
  session: Session,
  box: Locator,
  chrome: Set<number>,
  seen: Set<number | string>,
  appeared: Set<number>,
  action: Action,
  turn: NonNullable<Awaited<ReturnType<Session["turns"]["next"]>>>,
  before: PageState,
  demoResult: DemoResult,
  log: Log,
): Promise<StepOutcome> {
  const result: StepResult = { action: describeAction(action), line: "", listed: false, pointed: false, heard: "not pointed", readAt: "not checked", missingAfter: [], staleAfter: [], asked: 0 };
  const target = targetOf(action);
  const handle = await find(session, box, target, appeared);
  if (handle === undefined) {
    result.why = target.where === "page" ? "the control was not found in what the last step opened" : "the control was not found in the demo";
    turn.answer({ target: null, status: "done", say: "Stopping here." });
    return { result };
  }

  // Point at it, answering again each time the widget asks again about the same page.
  let id: string | undefined;
  let pointed: Awaited<ReturnType<typeof waitForPointer>> = "none";
  for (let asks = 0; asks < MAX_ASKS; asks++) {
    id = await idInSent(session, handle, before, turn.request.snapshot);
    if (!id) {
      // A model cannot point at what it was not shown.
      turn.answer({ target: null, status: "continue", say: "Use the control." });
      const again = await session.turns.next(4000);
      if (!again) break;
      turn = again;
      before = await read(session);
      continue;
    }
    const used = turn.request.snapshot.elements.find((element) => element.id === id)!;
    result.line = lineOf(used);
    result.listed = true;
    turn.answer({ target: id, status: "continue", say: `Use ${describeElement(used)}.` });
    pointed = await waitForPointer(session, handle);
    if (pointed !== "asked again") break;
    turn = (await session.turns.next(1000))!;
    before = await read(session);
  }
  if (!id) {
    result.why = "the widget did not list the control, so the scripted model could not point at it";
    log(`    ${result.action}: not listed`);
    return { result };
  }
  const used = turn.request.snapshot.elements.find((element) => element.id === id)!;
  result.pointed = pointed === "pointed";
  if (pointed !== "pointed") demoResult.notes.push(`${result.action}: the pointer ${pointed === "elsewhere" ? "went to another element" : "never showed"}.`);
  await session.page.waitForTimeout(VISITOR_PAUSE_MS);

  const aim = await act(session, action, handle);
  if (aim.coveredByHaptic) result.coveredByHaptic = true;
  if (aim.blocker) demoResult.notes.push(`${result.action}: something was in front of the control (${aim.blocker}).`);

  let next = await session.turns.next(NEXT_QUESTION_MS);
  if (!next) {
    result.heard = aim.blocker && aim.coveredByHaptic ? "blocked" : "none";
    result.why = result.heard === "blocked" ? "Haptic's caption covered the control" : "the widget never asked its next question";
    log(`    ${result.action}: ${result.heard}`);
    return { result };
  }
  result.asked = 1;
  result.event = next.request.event;
  const judged = judgeEvent(next.request.event, action, used);
  result.heard = judged.heard;
  if (judged.why) result.why = judged.why;

  // Read at the right time: the list sent, against the page once it has stopped changing.
  await session.page.waitForTimeout(SETTLED_MS);
  let after = await read(session);
  const firstSent = next.request.snapshot;
  await shoot(session, `${demoResult.kit}-${demoResult.demo}-${demoResult.steps.length + 1}`, firstSent);

  if (firstSent.dialog !== undefined) result.dialog = firstSent.dialog;

  // Anything the action opened is judged like the demo itself: is it listed, and can its controls be told apart.
  // What the action opened may be put at the end of the page or inside the demo itself.
  const opened = after.controls.filter((c) => !seen.has(c.handle) && !seen.has(`${c.role}|${c.name}`) && !chrome.has(c.handle));
  for (const c of after.controls) {
    if (!seen.has(c.handle)) appeared.add(c.handle);
    seen.add(c.handle);
  }
  for (const c of opened) seen.add(`${c.role}|${c.name}`);
  judgeReadAt(result, before, firstSent, after, chrome, appeared);
  if (opened.length) {
    result.opened = opened.length;
    const under = await session.call<boolean[]>("underHaptic", opened.map((c) => c.handle));
    const covered = opened.filter((_, i) => under[i]).map((c) => `${c.role} "${c.name}"`);
    if (covered.length) result.openedUnderHaptic = covered;
    const openedHandles = new Set(opened.map((c) => c.handle));
    const openedIds = Object.keys(after.reading.ids).filter((key) => openedHandles.has(after.reading.ids[key]!));
    const openedListed = await judgeListed(session, after, opened, openedIds, firstSent);
    demoResult.listed = demoResult.listed ? merge(demoResult.listed, openedListed, `opened by: ${result.action}`) : openedListed;
  }
  log(`    ${result.action}: heard ${result.heard}${result.why ? ` (${result.why})` : ""}; read ${result.readAt}`);

  // The page has stopped changing, but the widget may have asked again on its own: the last question is the one to answer.
  while (session.turns.pending) {
    next = (await session.turns.next(100))!;
    result.asked++;
    after = await read(session);
  }
  return { result, next: { turn: next, state: after } };
}

/**
 * Compares the list sent after an action with the page once it has stopped
 * changing. Only the demo, and whatever the action opened, counts: the rest
 * of a documentation page is not what the visitor is using.
 */
function judgeReadAt(result: StepResult, before: PageState, sent: Snapshot, after: PageState, chrome: Set<number>, appeared: Set<number>) {
  // In the demo, or among the controls the steps opened. Not whatever else a scroll brought under the list's limit.
  const inScope = (state: PageState) =>
    state.reading.snapshot.elements.filter((element) => {
      const handle = state.reading.ids[element.id]!;
      return !chrome.has(handle) && (state.reading.inDemo[element.id] || appeared.has(handle));
    });
  const beforeKeys = inScope(before).map(readKeyOf);
  const afterKeys = inScope(after).map(readKeyOf);
  const sentKeys = sent.elements.map(readKeyOf);
  const allAfter = after.reading.snapshot.elements.map(readKeyOf);
  result.missingAfter = beyond(afterKeys, sentKeys).slice(0, 12);
  // Gone since the action, yet still sent: in the demo before, absent from the whole page after, present in what was sent.
  result.staleAfter = beyond(sentKeys, allAfter).filter((key) => beforeKeys.includes(key)).slice(0, 12);
  const changed = beyond(afterKeys, beforeKeys).length > 0 || beyond(beforeKeys, afterKeys).length > 0;
  const sameAsBefore = sentKeys.length === before.reading.snapshot.elements.length && before.reading.snapshot.elements.every((element, i) => readKeyOf(element) === sentKeys[i]);
  if (!result.missingAfter.length && !result.staleAfter.length) result.readAt = changed ? "right" : "nothing changed";
  else if (sameAsBefore) result.readAt = "stale";
  else result.readAt = "early";
}

/**
 * Opens what the demo's first step opens, with no guide running, then asks
 * Haptic a question the way a visitor would. Checks the keys reach Haptic's
 * box, and that the list sent with the question has the overlay's controls.
 */
async function overlayCheck(context: Context, bundles: Bundles, kit: Kit, demo: Demo, log: Log): Promise<OverlayResult | undefined> {
  const result: OverlayResult = { opened: false, stayedOpen: false, typed: false, expected: 0, found: 0, missing: [] };
  const opened = await openDemo(context, bundles, kit, demo);
  if (!opened.session) return { ...result, why: opened.why };
  const { session, box } = opened;
  try {
    const first = demo.steps[0]!;
    const target = locate(session, box, targetOf(first));
    if (!(await target.count())) return { ...result, why: "the control that opens it was not found" };
    const before = await session.axControls();
    const beforeHandles = new Set<number | string>(before.map((c) => c.handle));
    for (const c of before) beforeHandles.add(`${c.role}|${c.name}`);
    await act(session, first, await session.handleOf(target));
    await session.page.waitForTimeout(1200);
    const openState = await read(session);
    const overlay = openState.controls.filter((c) => !beforeHandles.has(c.handle) && !beforeHandles.has(`${c.role}|${c.name}`));
    result.opened = overlay.length > 0;
    if (!result.opened) return { ...result, why: "nothing new opened" };

    const stillShown = async () => (await session.call<Where[]>("where", overlay.map((c) => c.handle))).map((w) => w.shown);
    let openAfterClick = true;
    const asked = await session.ask("What can I do here?", async () => {
      openAfterClick = (await stillShown()).some(Boolean);
    });
    if (!openAfterClick) result.closedBy = "the click on Haptic's button";
    result.typed = asked.typed;
    if (asked.why) result.why = asked.why;
    // Whether it is still open now that the visitor has gone to Haptic's box, before the question is read.
    result.stayedOpen = (await stillShown()).some(Boolean);
    if (!result.stayedOpen && !result.closedBy) result.closedBy = "typing in Haptic's box";
    if (!asked.typed) {
      await shoot(session, `${kit.id}-${demo.demo}-overlay`, { path: "", title: "", headings: [], text: [], elements: [], truncated: false });
      return result;
    }
    const turn = await session.turns.next(15_000);
    if (!turn) return { ...result, typed: false, why: "the keys reached the box, but the question never went" };
    await shoot(session, `${kit.id}-${demo.demo}-overlay`, turn.request.snapshot);
    const still = await stillShown();
    const open = overlay.filter((_, i) => still[i]);
    result.stayedOpen &&= open.length > 0;
    result.expected = open.length;
    const state = await read(session);
    const related = await session.call<(string | undefined)[]>("relate", open.map((c) => c.handle), state.reading.ids);
    const sentKeys = turn.request.snapshot.elements.map(keyOf);
    const byId = new Map(state.reading.snapshot.elements.map((element) => [element.id, element]));
    open.forEach((control, i) => {
      const id = related[i];
      const element = id ? byId.get(id) : undefined;
      if (element && sentKeys.includes(keyOf(element))) result.found++;
      else result.missing.push(`${control.role} "${control.name}"`);
    });
    if (turn.request.snapshot.dialog !== undefined) result.dialog = turn.request.snapshot.dialog;
    turn.answer({ target: null, status: "done", say: "That is all." } satisfies TurnReply);
    log(`    overlay: typed ${result.typed}, stayed open ${result.stayedOpen}, listed ${result.found}/${result.expected}`);
    return result;
  } catch (error) {
    return { ...result, why: `the check stopped with an error in the test: ${error instanceof Error ? error.message.split("\n")[0] : error}` };
  } finally {
    await session.close();
  }
}
