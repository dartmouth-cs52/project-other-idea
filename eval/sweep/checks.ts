import { mkdir, writeFile } from "node:fs/promises";
import { describeElement, type SnapElement, type Snapshot } from "../../src/shared/types.ts";
import { judgeEvent, keyOf, lineOf } from "../toolkits/checks.ts";
import type { Browser, Bundles, Session } from "../toolkits/session.ts";
import type { Page } from "../toolkits/types.ts";
import { countTraffic, openContext, openPage, type Opened, type SweepContext } from "./context.ts";
import type { Site } from "./sites.ts";
import type { Covered, FrameInfo, IdleResult, InventoryResult, LauncherResult, ListedResult, LoadRecord, MissingControl, ReadingResult, SiteResult, StepResult } from "./types.ts";

// The checks every site goes through. Four loads of the same page, one site at
// a time:
//
//   A1  without Haptic: the page's own errors, layout, focus and keys.
//   B1  with Haptic, idle: the same, then the launcher.
//   B2  with Haptic: reading the page, the list against the accessibility
//       tree, and one scripted step with the real mouse.
//   A2  without Haptic again, so that what differs with Haptic can be told
//       from what differs from one load to the next.
//
// No model is called: the step's answer is scripted, as in the toolkit suite.

/** The question typed into Haptic's box. The same words the in-page reader is given. */
const QUESTION = "Where can I see more about this?";
/** Presses of Tab in the focus check. */
const TABS = 8;
/** A pause between loads of the same site, to keep a modest pace on someone else's server. */
const BETWEEN_LOADS_MS = 1500;
/** How long the widget may take to send its first question: it waits up to twelve seconds for a page that lists nothing. */
const FIRST_QUESTION_MS = 25_000;
/**
 * How long it may take to ask after the visitor used the control. The widget
 * waits up to twelve seconds for a page that still shows it is loading, and a
 * page whose request the net stopped can show that for good.
 */
const NEXT_QUESTION_MS = 20_000;
/** At most this many of the accessibility tree's controls are looked at on one page. */
const MAX_AX = 6000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error: unknown) => (error instanceof Error ? error.message.split("\n")[0]! : String(error));

let shotsDir: string | undefined;
export function keepShots(dir: string) {
  shotsDir = dir;
}
async function shoot(page: Page, name: string, sent?: Snapshot) {
  if (!shotsDir) return;
  await mkdir(shotsDir, { recursive: true });
  const file = `${shotsDir}/${name.replace(/[^\w.-]+/g, "_")}`;
  await page.screenshot({ path: `${file}.png` }).catch(() => undefined);
  if (sent) await writeFile(`${file}.json`, JSON.stringify(sent, null, 1) + "\n");
}

/** A page under test, with the readers put into it on demand. */
class Live {
  private cdpSession: Page;
  constructor(
    readonly page: Page,
    private readonly sweepJs: string,
    readonly session?: Session,
  ) {}

  /** Calls one of the sweep's in-page readers (inpage.ts). On a page with Haptic, the toolkit's helpers are put in first. */
  async sweep<T>(name: string, ...args: unknown[]): Promise<T> {
    if (this.session) await this.session.call("hasProbe");
    const there = await this.page.evaluate("!!window.__hapticSweep");
    if (!there) await this.page.evaluate(this.sweepJs);
    return this.page.evaluate(`window.__hapticSweep.${name}(...${JSON.stringify(args)})`);
  }

  /** Calls one of the toolkit suite's in-page helpers (eval/toolkits/inpage.ts). */
  async toolkit<T>(name: string, ...args: unknown[]): Promise<T> {
    if (!this.session) throw new Error("The toolkit's helpers are only on pages with Haptic.");
    return this.session.call<T>(name, ...args);
  }

  async cdp(): Promise<Page> {
    if (!this.cdpSession) {
      this.cdpSession = await this.page.context().newCDPSession(this.page);
      await this.cdpSession.send("Accessibility.enable");
      await this.cdpSession.send("DOM.enable");
    }
    return this.cdpSession;
  }
}

// The accessibility tree -------------------------------------------------------

/** Roles that are a control a visitor uses, as Chrome's accessibility tree names them. The same as the toolkit suite's. */
const CONTROL_ROLES = new Set([
  "button", "link", "checkbox", "radio", "switch", "textbox", "searchbox", "combobox", "slider", "spinbutton",
  "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "treeitem", "DisclosureTriangle",
  "PopUpButton", "ToggleButton", "MenuListOption", "ColorWell", "Date", "DateTime", "InputTime",
]);
/** Roles that are a control only when the element takes the keyboard itself, like a calendar's day. */
const CONTROL_IF_FOCUSABLE = new Set(["gridcell", "columnheader"]);

interface AxControl {
  handle: number;
  role: string;
  name: string;
  disabled: boolean;
  checked: boolean;
  expanded: boolean;
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
type Shown = AxControl & Where;

/**
 * Every control in the main page's accessibility tree, each tied to its
 * element. As the toolkit suite reads it, with the elements resolved many at a
 * time, since a whole page can have thousands.
 */
async function axControls(live: Live): Promise<{ controls: AxControl[]; capped?: number }> {
  await live.sweep("focusName");
  const cdp = await live.cdp();
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const picked = [];
  for (const node of nodes) {
    if (node.ignored || node.backendDOMNodeId === undefined) continue;
    const role: string = node.role?.value ?? "";
    const property = (name: string) => node.properties?.find((p: { name: string }) => p.name === name)?.value?.value;
    if (!CONTROL_ROLES.has(role) && !(CONTROL_IF_FOCUSABLE.has(role) && property("focusable") === true)) continue;
    picked.push({ node, role, property });
  }
  const capped = picked.length > MAX_AX ? picked.length : undefined;
  const found: AxControl[] = [];
  const list = picked.slice(0, MAX_AX);
  for (let start = 0; start < list.length; start += 100) {
    const batch = await Promise.all(
      list.slice(start, start + 100).map(async ({ node, role, property }) => {
        try {
          const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: node.backendDOMNodeId });
          const { result } = await cdp.send("Runtime.callFunctionOn", {
            objectId: object.objectId,
            functionDeclaration: "function () { return this.nodeType === 1 && window.__hapticSweep ? window.__hapticSweep.reg(this) : -1; }",
            returnByValue: true,
          });
          void cdp.send("Runtime.releaseObject", { objectId: object.objectId }).catch(() => undefined);
          if (typeof result.value !== "number" || result.value < 0) return undefined;
          return {
            handle: result.value,
            role,
            name: String(node.name?.value ?? "").trim(),
            disabled: property("disabled") === true,
            checked: property("checked") === "true",
            expanded: property("expanded") === true,
          } satisfies AxControl;
        } catch {
          return undefined;
        }
      }),
    );
    for (const control of batch) if (control) found.push(control);
  }
  return { controls: found, ...(capped ? { capped } : {}) };
}

/** A cell is a control only when it is a button or can be selected, and a column header only when it sorts, as in the toolkit suite. */
function isControl(c: Shown): boolean {
  if (!c.shown || c.haptic) return false;
  if (c.role === "gridcell") return !c.holdsControl && (c.tag === "button" || c.selectable);
  if (c.role === "columnheader") return !c.holdsControl && c.sortable && c.name !== "";
  return true;
}

interface Reading {
  snapshot: Snapshot;
  ids: Record<string, number>;
}
interface PageState {
  reading: Reading;
  controls: Shown[];
  capped?: number;
}

async function readPage(live: Live): Promise<PageState> {
  const reading = await live.sweep<Reading>("snap", false);
  const { controls, capped } = await axControls(live);
  const where = await live.toolkit<Where[]>("where", controls.map((c) => c.handle), controls.map((c) => c.role));
  return { reading, controls: controls.map((c, i) => ({ ...c, ...where[i]! })).filter(isControl), ...(capped ? { capped } : {}) };
}

function sameList(a: SnapElement[], b: SnapElement[]): boolean {
  return a.length === b.length && a.every((element, i) => keyOf(element) === keyOf(b[i]!));
}

/**
 * The listed check over a whole page: the controls the accessibility tree
 * has, against the list the widget sent. As the toolkit suite judges a demo,
 * with each missing control placed: in a closed shadow root, outside an open
 * dialog, cut by the limit, or not read.
 */
async function judgeListed(live: Live, state: PageState, sent: Snapshot): Promise<ListedResult> {
  const expectedAll = state.controls;
  const related = await live.toolkit<(string | undefined)[]>("relate", expectedAll.map((c) => c.handle), state.reading.ids);
  const unmatched = expectedAll.map((c, i) => ({ c, i })).filter(({ i }) => !related[i]);
  const placedAll = await live.sweep<{ closed: boolean; open: boolean; onScreen: boolean; outOfReach: boolean; outsideDialog: boolean; tag: string; haptic: boolean }[]>("whereMissing", unmatched.map(({ c }) => c.handle));
  // Haptic's own controls are not the page's, wherever the tree put them.
  const ownIndex = new Set(unmatched.filter((_, n) => placedAll[n]!.haptic).map(({ i }) => i));
  const kept = unmatched.map((u, n) => ({ u, p: placedAll[n]! })).filter(({ p }) => !p.haptic);
  unmatched.splice(0, unmatched.length, ...kept.map(({ u }) => u));
  const placed = kept.map(({ p }) => p);
  // Read again with the length limits lifted, to tell "cut by the limit" from "not read".
  let cut: (string | undefined)[] = [];
  const wasCut = state.reading.snapshot.truncated;
  if (unmatched.length && wasCut) {
    const all = await live.sweep<Reading>("snap", true);
    cut = await live.toolkit<(string | undefined)[]>("relate", unmatched.map(({ c }) => c.handle), all.ids);
  }
  const onScreen = await live.sweep<boolean[]>("onScreen", expectedAll.map((c) => c.handle));
  const missing: MissingControl[] = [];
  const missingByReason: Record<string, number> = {};
  let closedShadow = 0;
  let expected = 0;
  let found = 0;
  let onScreenExpected = 0;
  let onScreenFound = 0;
  const closedSet = new Set<number>();
  unmatched.forEach(({ i }, n) => placed[n]!.closed && closedSet.add(i));
  expectedAll.forEach((_, i) => {
    if (ownIndex.has(i)) return;
    if (closedSet.has(i)) {
      closedShadow++;
      return;
    }
    expected++;
    if (related[i]) found++;
    if (onScreen[i]) {
      onScreenExpected++;
      if (related[i]) onScreenFound++;
    }
  });
  const ranked = unmatched.map(({ c, i }, n) => ({ c, i, n })).sort((a, b) => Number(onScreen[b.i]) - Number(onScreen[a.i]));
  for (const { c, i, n } of ranked) {
    const where = placed[n]!;
    // One no click can reach where it is, as under a wall of cookie choices, is rightly left out of what a visitor can use.
    const reason: MissingControl["reason"] = where.closed ? "closed shadow root" : where.outsideDialog ? "outside the open dialog" : cut[n] ? "cut by the limit" : where.outOfReach ? "out of reach" : "not read";
    missingByReason[reason] = (missingByReason[reason] ?? 0) + 1;
    if (missing.length < 25) missing.push({ role: c.role, name: c.name.slice(0, 80), reason, markup: await live.toolkit<string>("markup", c.handle), onScreen: onScreen[i]!, inOpenShadow: where.open, tag: where.tag });
  }

  const byId = new Map(state.reading.snapshot.elements.map((element) => [element.id, element]));
  const treeName = new Map<string, string>();
  related.forEach((id, i) => id && !treeName.has(id) && treeName.set(id, expectedAll[i]!.name));
  const listed = state.reading.snapshot.elements;
  const unnamed: ListedResult["unnamed"] = [];
  let unnamedCount = 0;
  let unnamedNotInTree = 0;
  // The ones the tree names come first: they are the widget's to fix.
  const nameless = listed.filter((element) => !element.label && !element.icon).sort((a, b) => Number(!!treeName.get(b.id)) - Number(!!treeName.get(a.id)));
  for (const element of nameless) {
    unnamedCount++;
    const inTree = treeName.has(element.id);
    if (!inTree) unnamedNotInTree++;
    if (unnamed.length < 12) unnamed.push({ line: lineOf(element), treeName: treeName.get(element.id) ?? "", inTree, markup: await live.toolkit<string>("markup", state.reading.ids[element.id]!) });
  }
  const stateMissing: ListedResult["stateMissing"] = [];
  let stateMissingCount = 0;
  for (const [i, id] of related.entries()) {
    const element = id ? byId.get(id) : undefined;
    const control = expectedAll[i]!;
    if (!element) continue;
    const lacks = (["disabled", "checked", "expanded"] as const).filter((name) => control[name] && !element.state?.includes(name));
    if (!lacks.length) continue;
    stateMissingCount++;
    if (stateMissing.length < 10) stateMissing.push({ line: lineOf(element), treeState: lacks.join(", "), markup: await live.toolkit<string>("markup", control.handle) });
  }
  const groups = new Map<string, SnapElement[]>();
  for (const element of listed) groups.set(lineOf(element), [...(groups.get(lineOf(element)) ?? []), element]);
  const duplicates: ListedResult["duplicates"] = [];
  let duplicateGroups = 0;
  let duplicateLines = 0;
  for (const [line, group] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    if (group.length < 2) continue;
    duplicateGroups++;
    duplicateLines += group.length;
    const treeSame = new Set(group.map((element) => treeName.get(element.id) ?? "")).size === 1;
    if (duplicates.length < 10) duplicates.push({ line: line.slice(0, 160), count: group.length, treeSame, markup: await live.toolkit<string>("markup", state.reading.ids[group[0]!.id]!) });
  }
  // Listed controls in the window that a click would not reach. One the list marks as showing on hover, or when the keyboard reaches it, is hidden by design.
  const inWindow = sent.elements.filter((element) => !element.offscreen && !element.state?.includes("shows on hover") && !element.state?.includes("shows on focus")).map((element) => element.id);
  const handleOf = sentIds(state.reading, sent);
  const coveredList = await live.sweep<{ handle: number; blocker: string; byHaptic: boolean; why: string }[]>("covered", inWindow.map((id) => handleOf.get(id)).filter((h): h is number => h !== undefined));
  const lineByHandle = new Map([...handleOf].map(([id, handle]) => [handle, sent.elements.find((element) => element.id === id)!]));
  const byPage = coveredList.filter((c) => !c.byHaptic);
  return {
    covered: byPage.length,
    coveredExamples: byPage.slice(0, 8).map((c) => ({ line: lineOf(lineByHandle.get(c.handle)!).slice(0, 120), blocker: c.blocker, why: c.why })),
    coveredWhy: byPage.reduce<Record<string, number>>((all, c) => ({ ...all, [c.why]: (all[c.why] ?? 0) + 1 }), {}),
    underHaptic: coveredList.length - byPage.length,
    expected,
    found,
    onScreenExpected,
    onScreenFound,
    closedShadow,
    missingByReason,
    missing,
    unnamedCount,
    unnamedNotInTree,
    unnamed,
    duplicateGroups,
    duplicateLines,
    duplicates,
    stateMissingCount,
    stateMissing,
    lines: listed.length,
    distinct: groups.size,
    matchedSent: sameList(state.reading.snapshot.elements, sent.elements),
    ...(state.capped ? { capped: state.capped } : {}),
  };
}

// Idle: what Haptic changes by being there ---------------------------------------

async function idleChecks(ctx: SweepContext, opened: Opened, live: Live, tabs: boolean) {
  const record = opened.record;
  record.layout = await live.sweep("layout");
  record.focus = { initial: await live.sweep<string>("focusName"), tabs: [] };
  const snapshot = () => {
    countTraffic(ctx, opened);
    record.idleErrors = [...record.errors];
    record.idleWarnings = [...record.hapticWarnings];
    record.idleStopped = stoppedCount(record);
  };
  if (!tabs) return snapshot();
  // Only a key pressed while the page has the keyboard counts. One pressed while Haptic's own launcher has it is Haptic's.
  record.keys = { pressed: 0, reached: 0, presses: [] };
  let from = record.focus.initial;
  for (let i = 0; i < TABS; i++) {
    const before = await live.sweep<number>("keys");
    await live.page.keyboard.press("Tab");
    await live.page.waitForTimeout(150);
    const reached = (await live.sweep<number>("keys")) > before;
    record.keys.presses!.push([from, reached]);
    if (from !== "haptic") {
      record.keys.pressed++;
      if (reached) record.keys.reached++;
    }
    from = await live.sweep<string>("focusName");
    record.focus.tabs.push(from);
  }
  snapshot();
  // Tab may have scrolled the page or opened something on focus. The page is put back at its top.
  await live.sweep("toTop");
}

const stoppedCount = (record: LoadRecord) => Object.values(record.stopped).reduce((sum, n) => sum + n, 0);

/** Errors a page logs because the net stopped one of its requests. */
const BY_THE_NET = /ERR_BLOCKED_BY_CLIENT|Failed to fetch|NetworkError|networking error|Load failed|net::ERR_FAILED|status of 0\b/i;

/**
 * What differs with Haptic present and idle. Something counts only when both
 * loads without Haptic agree and both loads with it agree, and the two
 * disagree: a page that differs from load to load by itself says nothing.
 */
export function compareIdle(a1: LoadRecord, a2: LoadRecord, b1: LoadRecord, b2: LoadRecord): IdleResult {
  // An error about a request the net stopped comes whenever the page's timer sends it, with Haptic or without.
  const errorsOf = (record: LoadRecord) => (record.idleErrors ?? record.errors).filter((error) => !BY_THE_NET.test(error));
  const [e1, e2, f1, f2] = [errorsOf(a1), errorsOf(a2), errorsOf(b1), errorsOf(b2)];
  const without = new Set([...e1, ...e2]);
  const errorsNew = f1.filter((error) => f2.includes(error) && !without.has(error));
  const errorsGone = e1.filter((error) => e2.includes(error) && !f1.includes(error) && !f2.includes(error));
  const result: IdleResult = {
    errorsNew,
    errorsGone,
    hapticThrows: [...new Set([...b1.hapticThrows, ...b2.hapticThrows])],
    hapticWarnings: [...new Set([...(b1.idleWarnings ?? b1.hapticWarnings), ...(b2.idleWarnings ?? b2.hapticWarnings)])],
    layoutStable: 0,
    layoutMoved: 0,
    layoutExamples: [],
    focusCompared: 0,
    keysReached: { without: [a1.keys?.reached ?? -1, a2.keys?.reached ?? -1], with: [b1.keys?.reached ?? -1], pressed: Math.min(a1.keys?.pressed ?? 0, b1.keys?.pressed ?? 0) },
    stoppedWithout: Math.max(a1.idleStopped ?? stoppedCount(a1), a2.idleStopped ?? stoppedCount(a2)),
    stoppedWith: Math.max(b1.idleStopped ?? stoppedCount(b1), b2.idleStopped ?? stoppedCount(b2)),
  };
  const [la1, la2, lb1, lb2] = [a1.layout, a2.layout, b1.layout, b2.layout];
  if (la1 && la2 && lb1 && lb2) {
    for (const [path, box] of Object.entries(la1.anchors)) {
      if (la2.anchors[path] !== box) continue;
      const withHaptic = lb1.anchors[path];
      if (withHaptic === undefined || lb2.anchors[path] !== withHaptic) continue;
      result.layoutStable++;
      if (withHaptic === box) continue;
      result.layoutMoved++;
      if (result.layoutExamples.length < 5) result.layoutExamples.push(`${path.slice(-90)}: ${box} -> ${withHaptic}`);
    }
    if (la1.scroll === la2.scroll && lb1.scroll === lb2.scroll && la1.scroll !== lb1.scroll) result.scrollChanged = `${la1.scroll} -> ${lb1.scroll}`;
  }
  const [fa1, fa2, fb1, fb2] = [a1.focus, a2.focus, b1.focus, b2.focus];
  if (fa1 && fa2 && fb1 && fb2 && fa1.initial === fa2.initial && fb1.initial === fb2.initial && fa1.initial !== fb1.initial) {
    result.initialFocusDiffers = `${fa1.initial} -> ${fb1.initial}`;
  }
  if (fa1 && fa2 && fb1 && fb2) {
    for (let i = 0; i < Math.min(fa1.tabs.length, fa2.tabs.length, fb1.tabs.length, fb2.tabs.length); i++) {
      if (fa1.tabs[i] !== fa2.tabs[i] || fb1.tabs[i] !== fb2.tabs[i]) break;
      result.focusCompared++;
      // Haptic's own launcher comes last in the order, after the page's: reaching it is not a difference.
      if (fb1.tabs[i] === "haptic") break;
      if (fb1.tabs[i] !== fa1.tabs[i]) {
        result.focusDiffers = `Tab ${i + 1}: ${fa1.tabs[i]} -> ${fb1.tabs[i]}`;
        break;
      }
    }
  }
  // A key pressed from the same place reaches the window without Haptic and not with it.
  const [ka1, ka2, kb1, kb2] = [a1.keys?.presses, a2.keys?.presses, b1.keys?.presses, b2.keys?.presses];
  if (ka1 && ka2 && kb1 && kb2) {
    for (let i = 0; i < Math.min(ka1.length, ka2.length, kb1.length, kb2.length); i++) {
      const place = ka1[i]![0];
      if (ka2[i]![0] !== place || kb1[i]![0] !== place || kb2[i]![0] !== place) break;
      if (ka1[i]![1] && ka2[i]![1] && !kb1[i]![1] && !kb2[i]![1]) {
        result.keysLost = `Tab ${i + 1}, from ${place}`;
        break;
      }
    }
  }
  return result;
}

// The launcher ---------------------------------------------------------------------

async function launcherCheck(live: Live, id: string): Promise<LauncherResult> {
  await live.sweep("toTop");
  await live.page.waitForTimeout(400);
  const top = await live.sweep<LauncherResult & { covered: Covered[] }>("launcher");
  await shoot(live.page, `${id}-launcher`);
  await live.sweep("toBottom");
  await live.page.waitForTimeout(900);
  const bottom = await live.sweep<{ covered: Covered[] }>("launcher");
  await shoot(live.page, `${id}-launcher-bottom`);
  await live.sweep("toTop");
  return { there: top.there, shown: top.shown, onTop: top.onTop, ...(top.over ? { over: top.over } : {}), coveredTop: top.covered ?? [], coveredBottom: bottom.covered ?? [] };
}

// What the widget cannot see -------------------------------------------------------

const FRAME_CONTROLS = `(() => {
  const all = [];
  const walk = (root) => { for (const el of root.querySelectorAll("*")) { all.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
  walk(document);
  return all.filter((el) => el.matches('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [contenteditable="true"]') && el.getClientRects().length > 0).length;
})()`;

async function inventory(live: Live): Promise<InventoryResult> {
  const found = await live.sweep<Omit<InventoryResult, "closedShadow"> & { frames: FrameInfo[] }>("inventory");
  // Closed shadow roots cannot be seen from the page, only from the browser.
  let closedShadow = 0;
  try {
    const cdp = await live.cdp();
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const walk = (node: { shadowRootType?: string; children?: unknown[]; shadowRoots?: unknown[]; contentDocument?: unknown }) => {
      if (node.shadowRootType === "closed") closedShadow++;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? []), ...(node.contentDocument ? [node.contentDocument] : [])]) walk(child as typeof node);
    };
    walk(root);
  } catch {
    closedShadow = -1;
  }
  // Each frame on show, from the browser's side, with the controls a visitor could use inside it.
  const pageOrigin = new URL(live.page.url()).origin;
  const frames: FrameInfo[] = [];
  for (const frame of live.page.frames().slice(1, 40)) {
    try {
      if (frame.isDetached()) continue;
      const element = await frame.frameElement();
      const box = await element.boundingBox();
      if (!box || box.width < 40 || box.height < 30 || !(await element.isVisible())) continue;
      let origin = "";
      try {
        origin = new URL(frame.url()).origin;
      } catch {
        origin = "";
      }
      const sameOrigin = origin === pageOrigin || frame.url() === "about:blank" || frame.url().startsWith("about:srcdoc");
      const controls = await Promise.race([frame.evaluate(FRAME_CONTROLS).catch(() => -1), sleep(3000).then(() => -1)]);
      let from = "";
      try {
        from = new URL(frame.url()).host || frame.url().slice(0, 40);
      } catch {
        from = frame.url().slice(0, 40);
      }
      frames.push({ sameOrigin, from, width: Math.round(box.width), height: Math.round(box.height), onScreen: box.y < 800 && box.y + box.height > 0, title: ((await element.getAttribute("title")) ?? "").slice(0, 60), controls: controls as number });
    } catch {
      // The frame went away while it was looked at.
    }
  }
  return { ...found, frames, closedShadow };
}

// The step ---------------------------------------------------------------------------

/** Words on a control that could mean it signs in, buys, sends, saves or deletes, in the languages of the sites. It is never chosen. */
const RISKY =
  /\b(sign ?(in|up|on|out)|log ?(in|on|out)|login|logout|register|subscribe|newsletter|buy|purchase|order|checkout|check out|cart|basket|bag|pay|payment|donat\w*|delete|remove|send|submit|share|copy|download|print|accept|agree|reject|decline|consent|cookies?|allow|deny|save|upload|apply|book|reserve|join|follow|like|vote|install|trial|contact|call|chat|report|feedback|unsubscribe|close|dismiss)\b|anmelden|registrieren|kaufen|warenkorb|einloggen|connexion|se connecter|inscri|panier|acheter|iniciar sesi|registr|comprar|carrito|accedi|carrello|inloggen|winkelwagen|bestellen|entrar|ログイン|購入|カート|로그인|장바구니|تسجيل|سلة|شراء/i;

/** Roles a step never uses: things typed into or picked, which change what a form holds. */
const NOT_A_STEP = new Set(["textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "slider", "spinbutton", "option", "select", "textarea"]);

interface Candidate {
  tag: string;
  role: string;
  type: string;
  href?: string;
  inPage: boolean;
  targetThere: boolean;
  newWindow: boolean;
  submits: boolean;
  inForm: boolean;
  expanded?: string;
  popup?: string;
  selected?: string;
  controls?: string;
  detailsClosed: boolean;
  consent: boolean;
  inNav: boolean;
  words: string;
  onScreen: boolean;
  hitsItself: boolean;
  reachable: boolean;
  top: number;
  markup: string;
  disabled: boolean;
}

/**
 * What kind of safe step a listed control is, or why it is not one. Only a
 * tab, a part that opens and closes, a link to a place on the same page, or a
 * menu is used: none of them can submit, buy, sign in, delete or send.
 */
function stepKind(element: SnapElement, c: Candidate): StepResult["kind"] | undefined {
  if (c.disabled || c.consent || c.submits || c.newWindow || !c.reachable || !c.hitsItself) return undefined;
  if (NOT_A_STEP.has(element.role) || c.tag === "input" || c.tag === "select" || c.tag === "textarea") return undefined;
  if (RISKY.test(`${element.label} ${c.words}`)) return undefined;
  // A link that leads off the page is never used.
  if (c.href !== undefined && !c.inPage && c.tag === "a") {
    const harmless = c.href === "#" || c.href === "" || /^javascript:/i.test(c.href);
    if (!harmless || !(c.role === "tab" || c.expanded === "false")) return undefined;
  }
  const popup = c.popup !== undefined && c.popup !== "false";
  if ((c.role === "tab" || element.role === "tab") && c.selected !== "true" && !element.state?.includes("selected")) return "tab";
  if (c.detailsClosed) return "disclosure";
  if (c.expanded === "false" && !popup && !c.inForm) return "disclosure";
  if (c.inPage && c.targetThere && c.expanded === undefined) return "in-page link";
  if (popup && c.expanded === "false" && !c.inForm) return "menu";
  return undefined;
}

/**
 * Which safe step to prefer. A tab is heard at once. A part that opens a
 * region of the page, and a link to a place on it, come next. A button in the
 * page's header or navigation that opens something is most often a menu, and a
 * menu is used last: the widget waits, by design, for a pick in what opened.
 */
function rankOf(kind: NonNullable<StepResult["kind"]>, c: Candidate): number {
  if (kind === "tab") return 0;
  if (kind === "disclosure" && (c.detailsClosed || (c.controls && !c.inNav))) return 1;
  if (kind === "in-page link") return 2;
  if (kind === "disclosure") return 3;
  return 4;
}

/** Waits until the element has stopped moving, as a visitor waits for the page to finish scrolling to the pointer. */
async function holdStill(live: Live, handle: number) {
  let last = "";
  for (const until = Date.now() + 3000; Date.now() < until; ) {
    const now = await live.toolkit<string>("boxOf", handle);
    if (now === last) return;
    last = now;
    await live.page.waitForTimeout(150);
  }
}

/** The ids the sent list gives the elements of a reading of the same page, by what each is and its place among its equals. */
function sentIds(reading: Reading, sent: Snapshot): Map<string, number> {
  const out = new Map<string, number>();
  if (sameList(reading.snapshot.elements, sent.elements)) {
    for (const element of sent.elements) if (reading.ids[element.id] !== undefined) out.set(element.id, reading.ids[element.id]!);
    return out;
  }
  const seen = new Map<string, number>();
  const byKey = new Map<string, SnapElement[]>();
  for (const element of reading.snapshot.elements) byKey.set(keyOf(element), [...(byKey.get(keyOf(element)) ?? []), element]);
  for (const element of sent.elements) {
    const key = keyOf(element);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const mine = byKey.get(key)?.[n];
    if (mine && reading.ids[mine.id] !== undefined) out.set(element.id, reading.ids[mine.id]!);
  }
  return out;
}

type Turn = NonNullable<Awaited<ReturnType<Session["turns"]["next"]>>>;

async function runStep(live: Live, session: Session, id: string, turn: Turn, state: PageState): Promise<StepResult> {
  const result: StepResult = { asked: true };
  const sent = turn.request.snapshot;
  const handles = sentIds(state.reading, sent);
  const ids = sent.elements.map((element) => element.id).filter((elementId) => handles.has(elementId));
  const info = await live.sweep<(Candidate | undefined)[]>("candidates", ids.map((elementId) => handles.get(elementId)!));
  const choices = ids
    .map((elementId, i) => {
      const element = sent.elements.find((e) => e.id === elementId)!;
      const c = info[i];
      const kind = c && stepKind(element, c);
      return kind && c ? { elementId, element, c, kind, handle: handles.get(elementId)! } : undefined;
    })
    .filter((choice): choice is NonNullable<typeof choice> => !!choice)
    .sort((a, b) => Number(b.c.onScreen) - Number(a.c.onScreen) || rankOf(a.kind, a.c) - rankOf(b.kind, b.c) || Number(a.c.inNav) - Number(b.c.inNav) || a.c.top - b.c.top);
  const choice = choices[0];
  await shoot(live.page, `${id}-sent`, sent);
  if (!choice) {
    const consentOnly = sent.dialog !== undefined && info.every((c) => !c || c.consent);
    result.skipped = consentOnly ? `only the dialog "${sent.dialog}" was listed, and nothing in it is safe to press` : "no tab, part that opens, link to a place on the page or menu was listed that is safe to press";
    turn.answer({ target: null, status: "done", say: "That is all." });
    return result;
  }
  const { element, handle, kind } = choice;
  result.kind = kind;
  result.line = lineOf(element);
  result.markup = choice.c.markup;

  // Point at it. If the widget asks again about the same page before the visitor acts, answer again.
  let asking: Turn = turn;
  let target = choice.elementId;
  result.askedAgain = 0;
  let pointed = false;
  for (let tries = 0; tries < 3; tries++) {
    asking.answer({ target, status: "continue", say: `Click ${describeElement(element)} to see what it holds.` });
    for (const until = Date.now() + 6000; Date.now() < until; ) {
      if (session.turns.pending) break;
      if ((await live.toolkit<number>("pointed")) >= 0) {
        pointed = await live.toolkit<boolean>("pointedNear", handle);
        break;
      }
      await live.page.waitForTimeout(100);
    }
    if (!session.turns.pending) break;
    result.askedAgain++;
    asking = (await session.turns.next(1000))!;
    const again = await live.sweep<Reading>("snap", false);
    const remapped = [...sentIds(again, asking.request.snapshot)].find(([, h]) => h === handle)?.[0];
    if (!remapped) {
      result.why = "the control was no longer listed when the widget asked again";
      asking.answer({ target: null, status: "done", say: "That is all." });
      return result;
    }
    target = remapped;
  }
  result.pointed = pointed;
  if (!pointed) {
    // A widget that gave up before pointing leaves nothing for the visitor to use.
    const said = await live.sweep<{ caption: string; status: string; state: string }>("said").catch(() => undefined);
    if (said?.caption && /went wrong/i.test(said.caption)) {
      result.heard = "failed";
      result.why = `the widget gave up before pointing, with "${said.caption}"`;
      await shoot(live.page, `${id}-pointer`, sent);
      return result;
    }
  }
  // The pointer glides there and the page may scroll to it: wait until both have stopped.
  await holdStill(live, handle);
  await live.page.waitForTimeout(800);
  result.pointer = await live.sweep("pointer", handle);
  result.caption = (await live.sweep<{ caption: string }>("said")).caption;
  await shoot(live.page, `${id}-pointer`, sent);

  // The visitor clicks it with the real mouse, where a person would.
  const before = await live.sweep<Record<string, string | number | boolean>>("stateOf", handle);
  const aim = await live.toolkit<{ x: number; y: number; coveredByHaptic: boolean; blocker: string }>("aim", handle);
  if (aim.coveredByHaptic) result.coveredByHaptic = true;
  if (aim.blocker) result.blocker = aim.blocker;
  const address = live.page.url();
  await session.clickAt(aim.x, aim.y);
  const next = await session.turns.next(NEXT_QUESTION_MS);
  const after = await live.sweep<Record<string, string | number | boolean>>("stateOf", handle).catch(() => undefined);
  if (after) {
    const changed = Object.keys(before).filter((key) => key !== "focus" && before[key] !== after[key]).map((key) => `${key} ${before[key] || "-"} -> ${after[key] || "-"}`);
    result.effect = changed.join("; ") || "nothing seen to change";
  }
  try {
    const was = new URL(address);
    const now = new URL(live.page.url());
    result.navigated = was.origin + was.pathname + was.search !== now.origin + now.pathname + now.search;
  } catch {
    result.navigated = false;
  }
  await shoot(live.page, `${id}-after`, next?.request.snapshot);
  if (!next) {
    // Something opened, and the widget waits, by design, for a pick in it. A pick is not made: it could lead anywhere.
    const opened = /expanded (false|-) -> true|open false -> true/.test(result.effect ?? "");
    const said = await live.sweep<{ caption: string; status: string; state: string }>("said").catch(() => undefined);
    if (said?.caption && /went wrong/i.test(said.caption)) {
      result.heard = "failed";
      result.why = `the widget gave up with "${said.caption}"`;
      return result;
    }
    result.heard = opened ? "silent" : "none";
    result.why = opened
      ? "the widget asked nothing after the control opened something; it waits for a pick in it, by design"
      : said?.state === "asking"
        ? `the widget heard the click and was still waiting for the page to settle ("${said.status}") ${NEXT_QUESTION_MS / 1000} seconds later`
        : `the widget never asked its next question (it was "${said?.state ?? "gone"}"${said?.caption ? `, showing "${said.caption}"` : ""})`;
    return result;
  }
  result.event = next.request.event;
  const words = choice.c.words || element.label;
  const judged = judgeEvent(next.request.event, { click: { text: words } }, element, words);
  result.heard = judged.heard === "true" || judged.heard === "wrong" || judged.heard === "unclear" || judged.heard === "none" ? judged.heard : "unclear";
  if (judged.why) result.why = judged.why;
  next.answer({ target: null, status: "done", say: "That is all." });
  await live.page.waitForTimeout(500);
  return result;
}

// One site ---------------------------------------------------------------------------

/** Drops what is only needed to compare loads, to keep the saved results small. What the comparison found is kept in `idle`. */
export function slim(record: LoadRecord): LoadRecord {
  const { layout, focus, keys, idleErrors: _errors, idleWarnings: _warnings, ...rest } = record;
  return {
    ...rest,
    ...(layout ? { layout: { anchors: {}, scroll: layout.scroll } } : {}),
    ...(focus ? { focus: { initial: focus.initial, tabs: [] } } : {}),
    ...(keys ? { keys: { pressed: keys.pressed, reached: keys.reached } } : {}),
  };
}

export async function sweepSite(browser: Browser, bundles: Bundles, sweepJs: string, site: Site, log: (line: string) => void): Promise<SiteResult> {
  const started = Date.now();
  const result: SiteResult = { id: site.id, url: site.url, kinds: site.kinds, why: site.why, status: "tested", loads: [], notes: [], ms: 0, at: new Date().toISOString() };
  const done = () => {
    result.loads = result.loads.map(slim);
    result.ms = Date.now() - started;
    return result;
  };
  let ctx: SweepContext | undefined;
  const loads: Partial<Record<LoadRecord["label"], LoadRecord>> = {};
  /** Loads one page and says whether the site can still be tested. */
  const load = async (label: LoadRecord["label"], mode: "plain" | "haptic"): Promise<Opened | undefined> => {
    const opened = await openPage(ctx!, site.url, label, mode);
    countTraffic(ctx!, opened);
    loads[label] = opened.record;
    result.loads.push(opened.record);
    if (opened.unreachable) {
      result.status = "could not reach";
      result.whyNot = `the page did not load from this machine: ${opened.record.error}`;
      return undefined;
    }
    if (opened.page && !opened.page.isClosed()) {
      const signs = await new Live(opened.page, sweepJs).sweep<string>("blockSigns", opened.record.status).catch(() => "");
      if (signs.startsWith("gone: ")) {
        result.status = "could not reach";
        result.whyNot = `the page is not there: ${signs.slice(6)}`;
        return undefined;
      }
      if (signs && label === "A2") {
        // Everything but the comparison with the page as it is was done already.
        opened.record.blocked = signs;
        result.notes.push(`The fourth load, without Haptic, met a bot check, a block or an error page (${signs}), so the page with Haptic idle was not compared with it.`);
        return undefined;
      }
      if (signs) {
        opened.record.blocked = signs;
        result.status = "could not test";
        result.whyNot = `${label === "A1" ? "" : `on load ${label}, `}the site showed a bot check, a block or an error page: ${signs}`;
        return undefined;
      }
    }
    if (opened.record.error && !opened.session && mode === "plain") {
      result.status = "could not test";
      result.whyNot = `the page did not load: ${opened.record.error}`;
      return undefined;
    }
    return opened;
  };
  try {
    ctx = await openContext(browser, bundles, { bypassCSP: true });

    // A1: the page as it is.
    const a1 = await load("A1", "plain");
    if (!a1) return done();
    await idleChecks(ctx, a1, new Live(a1.page, sweepJs), true);
    countTraffic(ctx, a1);
    await a1.page.close();
    log(`    A1 ${a1.record.status} "${a1.record.title.slice(0, 50)}" ${a1.record.ms} ms, ${a1.record.errors.length} errors`);
    await sleep(BETWEEN_LOADS_MS);

    // B1: with Haptic, idle.
    const b1 = await load("B1", "haptic");
    if (!b1) return done();
    if (!b1.session) {
      result.notes.push(`With the tag in the page, Haptic's element never appeared: ${b1.record.error}`);
      result.launcher = { there: false, shown: false, onTop: false, coveredTop: [], coveredBottom: [] };
    } else {
      const live = new Live(b1.page, sweepJs, b1.session);
      await idleChecks(ctx, b1, live, true);
      result.launcher = await launcherCheck(live, site.id);
    }
    countTraffic(ctx, b1);
    await b1.page.close();
    log(`    B1 mounted ${!!b1.session}, launcher shown ${result.launcher?.shown} on top ${result.launcher?.onTop}, covers ${result.launcher?.coveredTop.length}/${result.launcher?.coveredBottom.length}`);
    await sleep(BETWEEN_LOADS_MS);

    // B2: with Haptic, read the page and take one step.
    const b2 = await load("B2", "haptic");
    if (!b2) return done();
    if (b2.session) {
      const live = new Live(b2.page, sweepJs, b2.session);
      await idleChecks(ctx, b2, live, true);
      // Tab moves focus, and focus scrolls boxes inside the page. The page is loaded again, so the reading and the step start from it as it first showed.
      await b2.page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
      await b2.page.waitForSelector("haptic-root", { state: "attached", timeout: 30_000 });
      await b2.page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      await b2.page.waitForTimeout(1500);
      const loadErrors = [...b2.record.errors];
      await live.toolkit("setContainer", await b2.session.handleOf(b2.page.locator("body")));
      try {
        const read = await live.sweep<Omit<ReadingResult, "fastestMs">>("readTimes", 3);
        result.reading = { ...read, fastestMs: Math.min(...read.times) };
      } catch (error) {
        result.notes.push(`Reading the page failed: ${message(error)}`);
      }
      try {
        result.inventory = await inventory(live);
      } catch (error) {
        result.notes.push(`Looking for frames and canvases failed: ${message(error)}`);
      }
      log(`    B2 read ${result.reading?.fastestMs} ms, ${result.reading?.controls} controls${result.reading?.truncated ? " (cut)" : ""}, ${result.inventory?.frames.length ?? "?"} frames, canvas ${result.inventory?.canvasLargest ?? "?"}`);
      const hapticBefore = { throws: b2.record.hapticThrows.length, warnings: b2.record.hapticWarnings.length };
      // The page's errors from here on belong to the step, and are not compared with the loads without Haptic.
      b2.record.errors = loadErrors;
      const stepErrors: string[] = [];
      b2.page.on("pageerror", (error: Error) => stepErrors.push(error.message));
      const asked = await b2.session.ask(QUESTION);
      const step: StepResult = { asked: asked.typed };
      if (asked.why) step.askNotes = asked.why;
      if (!asked.typed) {
        step.skipped = `the question could not be asked: ${asked.why ?? ""}`;
        result.step = step;
      } else {
        const turn = await b2.session.turns.next(FIRST_QUESTION_MS);
        if (!turn) {
          step.skipped = "the widget never sent the page after the question";
          result.step = step;
        } else {
          try {
            const state = await readPage(live);
            result.listed = await judgeListed(live, state, turn.request.snapshot);
            log(`    listed ${result.listed.found}/${result.listed.expected} (on screen ${result.listed.onScreenFound}/${result.listed.onScreenExpected}), ${result.listed.unnamedCount} unnamed, ${result.listed.duplicateGroups} same-line groups`);
            result.step = await runStep(live, b2.session, site.id, turn, state);
          } catch (error) {
            result.step = { ...step, why: `the check stopped with an error in the test: ${message(error)}` };
            turn.answer({ target: null, status: "done", say: "That is all." });
          }
        }
      }
      result.stepThrows = b2.record.hapticThrows.slice(hapticBefore.throws);
      result.stepWarnings = b2.record.hapticWarnings.slice(hapticBefore.warnings);
      b2.record.errors = loadErrors;
      const s = result.step;
      log(`    step: ${s?.skipped ?? `${s?.kind} ${s?.line?.slice(0, 60)}; pointed ${s?.pointed}, tip on it ${s?.pointer?.tipHits}, caption over it ${s?.pointer?.captionOverMiddle}; heard ${s?.heard}${s?.why ? ` (${s.why})` : ""}`}`);
    } else {
      result.notes.push(`On the second load with the tag, Haptic's element never appeared: ${b2.record.error}`);
    }
    countTraffic(ctx, b2);
    await b2.page.close().catch(() => undefined);
    await sleep(BETWEEN_LOADS_MS);

    // A2: the page as it is, again.
    const a2 = await load("A2", "plain");
    if (!a2) return done();
    await idleChecks(ctx, a2, new Live(a2.page, sweepJs), true);
    countTraffic(ctx, a2);
    await a2.page.close();
    if (loads.A1 && loads.A2 && loads.B1 && loads.B2) result.idle = compareIdle(loads.A1, loads.A2, loads.B1, loads.B2);
    const idle = result.idle;
    const keys = (label: LoadRecord["label"]) => `${loads[label]?.keys?.reached ?? "?"}/${loads[label]?.keys?.pressed ?? "?"}`;
    if (idle) log(`    idle: ${idle.errorsNew.length} new errors, ${idle.hapticThrows.length} throws, layout moved ${idle.layoutMoved}/${idle.layoutStable}, focus ${idle.focusDiffers ?? idle.initialFocusDiffers ?? "same"}, keys reached ${keys("A1")}, ${keys("A2")} without and ${keys("B1")} with`);
  } catch (error) {
    result.notes.push(`The sweep of this site stopped with an error in the test: ${message(error)}`);
  } finally {
    await ctx?.context.close().catch(() => undefined);
  }
  return done();
}
