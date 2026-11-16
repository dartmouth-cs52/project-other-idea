import { SITES } from "./sites.ts";
import type { CspResult, SiteResult, SweepRun } from "./types.ts";

// The tables and the list of faults, printed from a run's results. Kept apart
// from the run so a saved results file can be printed again.

/** One fault on one site, with the markup that shows it. */
export interface FaultSeen {
  key: string;
  what: string;
  /**
   * "wrong": the widget gets it wrong. "never": something no script in the page
   * can do (read a canvas's drawing, reach into a frame from another origin or a
   * closed shadow root). "page": the page's own doing, like a control nothing
   * names, or a modal it opened.
   */
  kind: "wrong" | "never" | "page";
  example: string;
}

/** A control under the launcher counts when its middle is, or a third of it. */
const coveredMuch = (c: { middle: boolean; share: number }) => c.middle || c.share >= 0.3;

/** Every fault seen on a site. */
export function faultsOf(r: SiteResult): FaultSeen[] {
  const out: FaultSeen[] = [];
  const add = (key: string, what: string, example: string, kind: FaultSeen["kind"] = "wrong") => out.push({ key, what, kind, example: example.replace(/\s+/g, " ").slice(0, 400) });
  if (r.status !== "tested") return out;

  // What the widget can never do.
  const inv = r.inventory;
  if (inv && inv.canvasLargest >= 0.3) add("never canvas", "Most of the window is a canvas, whose drawing the widget cannot read", `${inv.canvases} canvas(es), the largest covering ${Math.round(inv.canvasLargest * 100)}% of the window`, "never");
  const crossFrames = inv?.frames.filter((f) => !f.sameOrigin && (f.controls ?? 0) > 0) ?? [];
  if (crossFrames.length) add("never cross-origin frame", "Controls inside a frame from another origin, which the widget cannot reach", crossFrames.slice(0, 3).map((f) => `${f.from} ${f.width}x${f.height}${f.onScreen ? " on screen" : ""}, ${f.controls} controls`).join("; "), "never");
  if ((r.listed?.closedShadow ?? 0) > 0) add("never closed shadow", "Controls inside a closed shadow root, which no script on the page can read", `${r.listed!.closedShadow} controls; ${r.listed!.missing.filter((m) => m.reason === "closed shadow root").slice(0, 2).map((m) => `${m.role} "${m.name}" ${m.markup}`).join("; ")}`, "never");

  // Mounting and the launcher.
  const l = r.launcher;
  if (l && !l.there) add("mount none", "With the tag in the page, Haptic's element never appeared", r.notes.find((n) => n.includes("never appeared")) ?? "");
  else if (l && !l.shown) add("mount launcher off screen", "Haptic's launcher is not inside the window", "");
  else if (l && !l.onTop) add("mount launcher under page", "Something of the page's is on top of Haptic's launcher", l.over ?? "");
  const pinnedUnder = [...(l?.coveredTop ?? []), ...(l?.coveredBottom ?? [])].filter((c) => c.pinned && coveredMuch(c));
  if (pinnedUnder.length) add("launcher covers pinned", "Haptic's launcher sits on a control of the page's that stays put when the page scrolls", pinnedUnder.map((c) => `"${c.words}" ${c.markup}`).slice(0, 2).join("; "));
  const footUnder = (l?.coveredBottom ?? []).filter((c) => !c.pinned && coveredMuch(c));
  if (footUnder.length) add("launcher covers foot", "At the foot of the page, Haptic's launcher sits on a control that cannot be scrolled out from under it", footUnder.map((c) => `"${c.words}" ${c.markup}`).slice(0, 2).join("; "));

  // Haptic present and idle.
  const idle = r.idle;
  if (idle?.hapticThrows.length) add("idle throws", "Haptic threw an error into the page while idle", idle.hapticThrows[0]!);
  if (idle?.errorsNew.length) add("idle errors", "The page logged errors with Haptic present that it does not log without it", idle.errorsNew.slice(0, 3).join(" | "));
  if (idle && idle.layoutMoved > 0) add("idle layout", "The page's own elements moved with Haptic present and idle", `${idle.layoutMoved} of ${idle.layoutStable} moved: ${idle.layoutExamples.slice(0, 2).join("; ")}`);
  if (idle?.scrollChanged) add("idle scroll size", "The page's scrollable size changed with Haptic present", idle.scrollChanged);
  if (idle?.focusDiffers || idle?.initialFocusDiffers) add("idle focus", "The keyboard's order through the page changed with Haptic present", idle.initialFocusDiffers ?? idle.focusDiffers ?? "");
  if (idle?.keysLost) add("idle keys", "A key pressed on the page reached the page's window without Haptic and not with it", idle.keysLost);
  if (r.stepThrows?.length) add("step throws", "Haptic threw an error into the page during the step", r.stepThrows[0]!);

  // Reading the page.
  if (r.reading && r.reading.fastestMs >= 100) add("read slow", "Reading the page took 100 ms or more, at its fastest of three", `${r.reading.fastestMs} ms for ${r.reading.controls} controls (${inv?.nodes ?? "?"} elements)`);
  if (r.reading?.dialog !== undefined) {
    // Only a dialog that says it is modal, or the browser's own modal dialog, shuts out the page. One that does not say so was taken for one.
    const modal = inv?.dialogs.some((d) => d.modal);
    const consent = inv?.dialogs.some((d) => d.consent) || (inv?.notices.length ?? 0) > 0;
    const example = `dialog "${r.reading.dialog}"; ${inv?.dialogs.map((d) => `${d.modal ? "modal" : "not marked modal"} ${d.markup}`).slice(0, 2).join("; ") ?? ""}`;
    if (modal) add(consent ? "dialog modal consent" : "dialog modal", `A modal ${consent ? "consent dialog" : "dialog"} was open when the page was read, so only it was listed, by design`, example, "page");
    else add(consent ? "dialog taken consent" : "dialog taken", `A ${consent ? "cookie or consent notice" : "dialog"} not marked modal was taken for an open modal, so only it was listed`, example);
  }
  const sameFrames = inv?.frames.filter((f) => f.sameOrigin && (f.controls ?? 0) > 0) ?? [];
  if (sameFrames.length) add("frame same-origin", "Controls inside a frame from the page's own origin, which the widget does not read", sameFrames.slice(0, 2).map((f) => `${f.from} ${f.width}x${f.height}, ${f.controls} controls`).join("; "));
  const listed = r.listed;
  if (listed) {
    const byRole = new Map<string, string[]>();
    // Haptic's own buttons are not the page's. A page that patches the DOM, as YouTube's ShadyDOM does, can hide from the check that they are Haptic's.
    const hapticOwn = (m: { markup: string }) => /class="(dock (left|right)|status|panel)"|class="(launcher|stop|send|close)"/.test(m.markup);
    for (const m of listed.missing.filter((m) => m.reason === "not read" && m.onScreen && !hapticOwn(m))) byRole.set(m.role, [...(byRole.get(m.role) ?? []), `${m.role} "${m.name}" ${m.markup}`]);
    for (const [role, examples] of byRole) add(`missing ${role}`, `A ${role} on screen that the accessibility tree has is not listed`, examples.slice(0, 2).join("; "));
    // A control the accessibility tree names is the widget's fault. One nothing names is the page's, which a model can still place by its surroundings.
    const unnamedByRole = new Map<string, string[]>();
    for (const u of listed.unnamed) {
      const key = `${u.line.split(" ")[0]!}|${u.treeName ? "named" : u.inTree === false ? "not a control" : "nameless"}`;
      unnamedByRole.set(key, [...(unnamedByRole.get(key) ?? []), `${u.line}${u.treeName ? ` (tree: "${u.treeName}")` : ""} ${u.markup}`]);
    }
    for (const [key, examples] of unnamedByRole) {
      const [role, named] = key.split("|");
      if (named === "named") add(`unnamed ${role}`, `A ${role} the accessibility tree names is listed with no name`, examples.slice(0, 2).join("; "));
      else if (named === "not a control") add(`unnamed box ${role}`, `A box the accessibility tree has no control for is listed as "${role}" with no name, taking a place in the list`, examples.slice(0, 2).join("; "));
      else add(`nameless ${role}`, `A ${role} that nothing on the page names is listed as just "${role}"`, examples.slice(0, 2).join("; "), "page");
    }
    // Grouped by why a click would miss: each is a different thing for the widget to see.
    const byWhy = new Map<string, string[]>();
    // A control the widget lists as showing on hover is hidden by design, and the list says so.
    for (const c of (listed.coveredExamples ?? []).filter((c) => !c.line.includes("shows on hover"))) byWhy.set(c.why ?? "", [...(byWhy.get(c.why ?? "") ?? []), `${c.line} (${c.blocker.slice(0, 160)})`]);
    for (const [why, examples] of byWhy) add(`covered ${why}`, `Controls listed as usable in the window that a click cannot reach: ${why || "something of the page's is over them"}`, examples.slice(0, 2).join("; "));
    const apart = listed.duplicates.filter((d) => !d.treeSame);
    if (apart.length) add("same line apart", "Controls listed with the same whole line, though the accessibility tree names them apart", apart.slice(0, 2).map((d) => `${d.count} x ${d.line} ${d.markup}`).join("; "));
    const alike = listed.duplicates.filter((d) => d.treeSame);
    if (alike.length) add("same line alike", "Controls listed with the same whole line, which the page names alike too", alike.slice(0, 2).map((d) => `${d.count} x ${d.line}`).join("; "), "page");
    const byState = new Map<string, string[]>();
    for (const s of listed.stateMissing) byState.set(s.treeState, [...(byState.get(s.treeState) ?? []), `${s.line} ${s.markup}`]);
    for (const [state, examples] of byState) add(`state ${state}`, `A control the accessibility tree calls ${state} is listed without that state`, examples.slice(0, 2).join("; "));
  }

  // The step.
  const s = r.step;
  if (s && !s.asked) add("ask failed", "A question could not be typed into Haptic's box", s.askNotes ?? s.skipped ?? "");
  else if (s?.askNotes) add("ask trouble", "Asking took a second try", s.askNotes);
  if (s?.skipped === "the widget never sent the page after the question") add("no first step", "The widget never sent the page after the question", "");
  if (s?.kind) {
    if (!s.pointed && s.heard !== "failed") add("step no pointer", "The pointer never went to the control it was given", `${s.line} ${s.markup}`);
    else if (s.pointer && !s.pointer.tipHits && s.pointer.tipInBox && !s.blocker)
      add("step tip edge", "The pointer's tip is inside the control's box, on a spot where a click lands on the box around it", `${s.line}; tip ${s.pointer.tip.x},${s.pointer.tip.y} on ${s.pointer.underTip}; box ${JSON.stringify(s.pointer.box)}`);
    else if (s.pointer && !s.pointer.tipHits) add("step tip off", "The pointer's tip is not on the control: a click there would land on something else", `${s.line}; tip ${s.pointer.tip.x},${s.pointer.tip.y} on ${s.pointer.underTip}; box ${JSON.stringify(s.pointer.box)}`);
    if (s.pointer && (s.pointer.captionOverMiddle || s.pointer.captionShare >= 0.3)) add("step caption covers", "Haptic's caption covers the control it points at", `${s.line}; ${Math.round(s.pointer.captionShare * 100)}% covered${s.pointer.captionOverMiddle ? ", the middle too" : ""}`);
    if (s.pointer && (s.pointer.dockOverMiddle || s.pointer.dockShare >= 0.3)) add("step launcher covers", "Haptic's launcher covers the control it points at", `${s.line}; ${Math.round(s.pointer.dockShare * 100)}% covered`);
    if (s.blocker && !s.coveredByHaptic) add("step page covers", "Something of the page's is in front of the control pointed at", `${s.line}; ${s.blocker}`);
    if (s.heard === "none") add("step unheard", "After the visitor used the control, the widget never asked again", `${s.line} ${s.markup}; ${s.effect ?? ""}; ${s.why ?? ""}`);
    if (s.heard === "failed") add("step failed", "The widget gave up with its own error message during the step", `${s.line}: ${s.why ?? ""}; ${[...(r.stepWarnings ?? [])].slice(0, 1).join("")}`);
    if (s.heard === "wrong") add("step heard wrong", "The widget said the visitor did something other than what they did", `${s.line}: ${s.event}`);
    if (s.heard === "unclear") add("step sentence", "The widget's sentence about the click does not name the control or what was done", `${s.line}: ${s.event ?? "(none)"}${s.why ? ` (${s.why})` : ""}`);
  }
  return out;
}

export interface RankedFault {
  key: string;
  what: string;
  kind: FaultSeen["kind"];
  sites: string[];
  examples: string[];
}

export function rankFaults(results: SiteResult[]): RankedFault[] {
  const found = new Map<string, RankedFault>();
  for (const r of results) {
    for (const f of faultsOf(r)) {
      const fault = found.get(f.key) ?? { key: f.key, what: f.what, kind: f.kind, sites: [], examples: [] };
      if (!fault.sites.includes(r.id)) fault.sites.push(r.id);
      if (fault.examples.length < 3 && f.example) fault.examples.push(`${r.id}: ${f.example}`);
      found.set(f.key, fault);
    }
  }
  return [...found.values()].sort((a, b) => b.sites.length - a.sites.length);
}

const cell = (text: string | number | undefined) => String(text ?? "").replace(/\|/g, "/").replace(/\s+/g, " ");

function stepCell(r: SiteResult): string {
  const s = r.step;
  if (!s) return "";
  if (s.skipped) return `not taken: ${s.skipped}`;
  if (!s.kind) return s.why ?? "";
  const bits = [s.kind, s.pointed ? "pointer on it" : "no pointer"];
  if (s.pointer && !s.pointer.tipHits) bits.push("tip off it");
  if (s.pointer?.captionOverMiddle || (s.pointer?.captionShare ?? 0) >= 0.3) bits.push("caption over it");
  bits.push(`heard ${s.heard}`);
  return bits.join(", ");
}

/** The table of every site, one row each. */
export function siteTable(results: SiteResult[]): string {
  const header = ["site", "result", "launcher", "read (fastest)", "listed", "found / expected (on screen)", "unnamed", "same lines", "covered", "Haptic idle", "step", "cannot ever"];
  const rows = results.map((r) => {
    if (r.status !== "tested") return [r.id, `${r.status}: ${r.whyNot ?? ""}`.slice(0, 140), "", "", "", "", "", "", "", "", "", ""];
    const l = r.launcher;
    // As in the faults: a pinned control anywhere, or one at the foot of the page that cannot be scrolled out from under.
    const covers = [...(l?.coveredTop ?? []).filter((c) => c.pinned), ...(l?.coveredBottom ?? [])].filter(coveredMuch);
    const launcher = !l ? "" : !l.there ? "never appeared" : !l.shown ? "off screen" : !l.onTop ? "under the page" : covers.length ? `covers ${[...new Set(covers.map((c) => `"${c.words.slice(0, 20)}"${c.pinned ? " (pinned)" : ""}`))].slice(0, 2).join(", ")}` : "shown";
    const reading = r.reading ? `${r.reading.fastestMs} ms` : "";
    const listedCount = r.reading ? `${r.reading.controls}${r.reading.truncated ? ` of ${r.reading.unlimited}` : ""}` : "";
    const lst = r.listed;
    const found = lst ? `${lst.found}/${lst.expected} (${lst.onScreenFound}/${lst.onScreenExpected})` : "";
    const idle = r.idle;
    const idleBits = idle
      ? [idle.hapticThrows.length ? `${idle.hapticThrows.length} throws` : "", idle.errorsNew.length ? `${idle.errorsNew.length} new errors` : "", idle.layoutMoved ? `${idle.layoutMoved} moved` : "", idle.focusDiffers || idle.initialFocusDiffers ? "focus differs" : ""].filter(Boolean).join(", ") || "same"
      : "not compared";
    const inv = r.inventory;
    const never = [
      inv && inv.canvasLargest >= 0.3 ? `canvas ${Math.round(inv.canvasLargest * 100)}%` : "",
      inv?.frames.some((f) => !f.sameOrigin && (f.controls ?? 0) > 0) ? `${inv.frames.filter((f) => !f.sameOrigin && (f.controls ?? 0) > 0).length} foreign frames` : "",
      lst?.closedShadow ? `${lst.closedShadow} in closed roots` : "",
    ].filter(Boolean).join(", ");
    return [r.id, faultsOf(r).some((f) => f.kind === "wrong") ? "faults" : "passed", launcher, reading, listedCount, found, lst ? String(lst.unnamedCount) : "", lst ? `${lst.duplicateLines} in ${lst.duplicateGroups}` : "", lst ? String(lst.covered) : "", idleBits, stepCell(r), never];
  });
  return [header, header.map(() => "---"), ...rows].map((row) => `| ${row.map(cell).join(" | ")} |`).join("\n");
}

export function cspTable(results: CspResult[]): string {
  const header = ["site", "policy", "script from Haptic", "GET to Haptic", "POST to Haptic", "Haptic's style", "mounted", "a question went", "what blocked it", "inline style if the script were allowed"];
  const rows = results.map((r) => {
    if (r.status !== "tested") return [r.id, `${r.status}: ${r.whyNot ?? ""}`.slice(0, 120), "", "", "", "", "", "", "", ""];
    const policy = r.policy.header ? "header" : r.policy.meta.length ? "meta tag" : r.policy.reportOnly ? "report-only" : "none";
    const blocked = [...new Set(r.violations.filter((v) => v.blocked.startsWith("https://widget.joinhaptic.com") || v.blocked === "inline" || v.blocked === "trusted-types-sink").map((v) => `${v.directive}${v.blocked === "inline" ? " (inline)" : ""}`))].join(", ");
    return [r.id, policy + (r.trustedTypes ? ", trusted types" : ""), r.script, r.connectGet, r.connectPost, r.style, r.mounted ? "yes" : "no", r.askWorked ? "yes" : "no", blocked, r.inlineStyleAllowed ? "allowed" : "blocked"];
  });
  return [header, header.map(() => "---"), ...rows].map((row) => `| ${row.map(cell).join(" | ")} |`).join("\n");
}

/** The headline numbers. */
export function headline(results: SiteResult[]): string {
  const tested = results.filter((r) => r.status === "tested");
  const notTested = results.filter((r) => r.status !== "tested");
  const clean = tested.filter((r) => !faultsOf(r).some((f) => f.kind === "wrong"));
  const withNever = tested.filter((r) => faultsOf(r).some((f) => f.kind === "never"));
  const withWrong = tested.filter((r) => faultsOf(r).some((f) => f.kind === "wrong"));
  const lines = [
    `Sites on the list: ${results.length}. Tested: ${tested.length}. Could not be tested: ${notTested.length}.`,
    `Sites where every check passed (nothing the widget gets wrong): ${clean.length} of ${tested.length}.`,
    `Sites with something the widget gets wrong: ${withWrong.length}. Sites with something it can never do (canvas, frames from another origin, closed shadow roots): ${withNever.length}.`,
  ];
  if (notTested.length) {
    lines.push("Could not be tested:");
    for (const r of notTested) lines.push(`  ${r.id}: ${r.status}, ${r.whyNot ?? ""}`);
  }
  return lines.join("\n");
}

export function faultList(results: SiteResult[]): string {
  const ranked = rankFaults(results);
  const part = (kind: FaultSeen["kind"]) =>
    ranked
      .filter((f) => f.kind === kind)
      .map((f, i) => `${i + 1}. ${f.what}. Sites: ${f.sites.length} (${f.sites.join(", ")}).\n${f.examples.map((e) => `     ${e}`).join("\n")}`)
      .join("\n");
  return [
    `What the widget gets wrong, most widespread first:\n${part("wrong") || "Nothing."}`,
    `What the widget can never do:\n${part("never") || "Nothing."}`,
    `The pages' own doing, not counted against the widget:\n${part("page") || "Nothing."}`,
  ].join("\n\n");
}

/** The CSP run in a few lines. */
export function cspHeadline(results: CspResult[]): string {
  const tested = results.filter((r) => r.status === "tested");
  const count = (test: (r: CspResult) => boolean) => tested.filter(test).length;
  const withPolicy = count((r) => !!r.policy.header || r.policy.meta.length > 0);
  return [
    `Sites: ${results.length}. Loaded with their policy in force: ${tested.length}. Could not be tested: ${results.length - tested.length}.`,
    `With a policy that is enforced (not only reported): ${withPolicy}.`,
    `Haptic's script was blocked: ${count((r) => r.script === "blocked")}. It loaded and Haptic mounted: ${count((r) => r.mounted)}. A question reached the server: ${count((r) => r.askWorked)}.`,
    `Requests to Haptic's address blocked from the page: GET ${count((r) => r.connectGet === "blocked")}, POST ${count((r) => r.connectPost === "blocked")}.`,
    `Haptic's inline stylesheet would be blocked by the policy even with its script allowed: ${count((r) => !r.inlineStyleAllowed)}. Trusted Types required: ${count((r) => r.trustedTypes)}.`,
  ].join("\n");
}

export function printRun(run: SweepRun): string {
  // In the order of the list of sites, whatever order they were run in.
  const order = new Map(SITES.map((site, i) => [site.id, i]));
  const byList = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  const about = [`Widget ${run.widget.fingerprint} from ${run.widget.checkout} at ${run.widget.commit}, ${run.startedAt.slice(0, 16)} to ${run.finishedAt.slice(0, 16)}.`, ...(run.notes ?? [])].join("\n");
  if (run.mode === "csp") return `${about}\n\n${cspHeadline(run.csp)}\n\n${cspTable(byList(run.csp))}`;
  const results = byList(run.results);
  return [about, headline(results), siteTable(results), faultList(results)].join("\n\n");
}
