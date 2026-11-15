import { KINDS, type DemoResult, type RunResults, type StepResult } from "./types.ts";

// The table and the list of faults, printed from a run's results. Kept apart
// from the run so a saved results file can be printed again, or set beside
// another run's.

/** What the suite cannot see at all, said before any number. */
export function coverageNote(run: RunResults): string {
  const unreadable = run.results.filter((r) => r.unreadable);
  const byWhere = new Map<string, number>();
  for (const r of unreadable) byWhere.set(r.unreadable!, (byWhere.get(r.unreadable!) ?? 0) + 1);
  const where = [...byWhere].map(([what, n]) => `${n} in ${what === "iframe" ? "an iframe" : `a ${what}`}`).join(", ");
  const notTested = run.results.filter((r) => !r.tested && !r.unreadable);
  return [
    `Widget: ${run.widget.checkout} at ${run.widget.commit}.`,
    "Not covered: the widget does not read controls inside an iframe, inside a closed shadow root, or drawn on a canvas, so no check here can pass or fail them.",
    `Demos ruled out for that reason: ${unreadable.length}${where ? ` (${where})` : ""}.`,
    `Demos not tested for other reasons: ${notTested.length}${notTested.length ? ` (${notTested.map((r) => `${r.kit} ${r.kind}: ${r.why}`).join("; ")})` : ""}.`,
    "Each count below is of demos on the toolkits' public documentation sites, run with a scripted model: no model and no server were involved.",
  ].join("\n");
}

interface Cell {
  demos: number;
  expected: number;
  found: number;
  lines: number;
  distinct: number;
  unnamed: number;
  pointed: number;
  heard: number;
  steps: number;
  readChecked: number;
  readRight: number;
  overlays: number;
  typed: number;
  overlayExpected: number;
  overlayFound: number;
}

const heardTrue = (step: StepResult) => step.heard === "true";
const readRight = (step: StepResult) => step.readAt === "right" || step.readAt === "right on asking again";
const readChecked = (step: StepResult) => step.readAt !== "not checked" && step.readAt !== "nothing changed";

function cellOf(results: DemoResult[]): Cell {
  const cell: Cell = { demos: 0, expected: 0, found: 0, lines: 0, distinct: 0, unnamed: 0, pointed: 0, heard: 0, steps: 0, readChecked: 0, readRight: 0, overlays: 0, typed: 0, overlayExpected: 0, overlayFound: 0 };
  for (const r of results) {
    if (!r.tested) continue;
    cell.demos++;
    if (r.listed) {
      cell.expected += r.listed.expected;
      cell.found += r.listed.found;
      cell.lines += r.listed.lines;
      cell.distinct += r.listed.distinct;
      cell.unnamed += r.listed.unnamed.length;
    }
    for (const step of r.steps) {
      cell.steps++;
      if (step.pointed) cell.pointed++;
      if (step.pointed && heardTrue(step)) cell.heard++;
      if (readChecked(step)) cell.readChecked++;
      if (readChecked(step) && readRight(step)) cell.readRight++;
    }
    if (r.overlay) {
      cell.overlays++;
      if (r.overlay.typed) cell.typed++;
      cell.overlayExpected += r.overlay.expected;
      cell.overlayFound += r.overlay.found;
    }
  }
  return cell;
}

const ratio = (a: number, b: number) => (b ? `${a}/${b}` : "-");

function cellText(cell: Cell | undefined, results: DemoResult[]): string[] {
  if (!cell || !cell.demos) {
    const why = results.find((r) => r.unreadable) ? "not read (iframe)" : results.length ? "not tested" : "";
    return [why, "", "", "", "", ""];
  }
  return [
    ratio(cell.found, cell.expected),
    cell.lines ? `${cell.distinct}/${cell.lines}${cell.unnamed ? `, ${cell.unnamed} unnamed` : ""}` : "-",
    `${ratio(cell.heard, cell.pointed)}${cell.steps > cell.pointed ? ` (${cell.steps - cell.pointed} not pointed)` : ""}`,
    ratio(cell.readRight, cell.readChecked),
    cell.overlays ? `${ratio(cell.typed, cell.overlays)} typed, ${ratio(cell.overlayFound, cell.overlayExpected)} listed` : "",
    String(cell.demos),
  ];
}

const HEADER = ["toolkit", "kind", "listed", "told apart", "heard", "read in time", "inside overlays", "demos"];

/** The results table, toolkit by kind of control. With `before`, each cell shows the earlier value beside it. */
export function table(run: RunResults, before?: RunResults): string {
  const kits = [...new Set(run.results.map((r) => r.kit))];
  const rows: string[][] = [HEADER];
  for (const kit of kits) {
    for (const kind of KINDS) {
      const results = run.results.filter((r) => r.kit === kit && r.kind === kind);
      if (!results.length) continue;
      const now = cellText(cellOf(results), results);
      let shown = now;
      if (before) {
        const earlier = before.results.filter((r) => r.kit === kit && r.kind === kind);
        const then = cellText(cellOf(earlier), earlier);
        shown = now.map((value, i) => (then[i] !== undefined && then[i] !== value && i < 5 ? `${then[i] || "-"} -> ${value}` : value));
      }
      rows.push([kit, kind, ...shown]);
    }
    const all = run.results.filter((r) => r.kit === kit);
    rows.push([kit, "all", ...cellText(cellOf(all), all)]);
  }
  const widths = HEADER.map((_, i) => Math.max(...rows.map((row) => (row[i] ?? "").length)));
  return rows.map((row, n) => row.map((value, i) => value.padEnd(widths[i]!)).join("  ").trimEnd() + (n === 0 ? `\n${widths.map((w) => "-".repeat(w)).join("  ")}` : "")).join("\n");
}

export const LEGEND = [
  "listed: controls the accessibility tree has in the demo and in what it opened, found in the widget's list.",
  "told apart: distinct lines among the controls listed in the demo (role, name, icon, state, surroundings, link), and how many have no name.",
  "heard: steps where the widget asked its next question with a true sentence, of the steps where its pointer showed.",
  "read in time: steps whose next list showed the page as it was once it stopped changing, of the steps where the list changed.",
  "inside overlays: whether a question could be typed into Haptic's box with the overlay open, and the overlay's controls in that list.",
].join("\n");

interface Fault {
  key: string;
  what: string;
  kits: Set<string>;
  demos: Set<string>;
  examples: string[];
}

/** Every fault found, grouped by what kind of fault and what kind of control, most widespread first. */
export function faults(run: RunResults): string {
  const found = new Map<string, Fault>();
  const add = (key: string, what: string, r: DemoResult, example: string) => {
    const fault = found.get(key) ?? { key, what, kits: new Set(), demos: new Set(), examples: [] };
    fault.kits.add(r.kit);
    fault.demos.add(`${r.kit}/${r.demo}`);
    if (fault.examples.length < 3 && !fault.examples.some((e) => e.startsWith(`${r.kit}/`))) fault.examples.push(`${r.kit}/${r.demo}: ${example}`);
    found.set(key, fault);
  };
  for (const r of run.results) {
    if (!r.tested) continue;
    for (const m of r.listed?.missing ?? []) add(`missing ${m.role} ${m.reason}`, `A ${m.role} the accessibility tree has is not listed (${m.reason})`, r, `${m.role} "${m.name}" ${m.markup}`);
    for (const u of r.listed?.unnamed ?? []) add(`unnamed ${u.line.split(" ")[0]}`, `A ${u.line.split(" ")[0]} is listed with no name${u.treeName ? " though the tree names it" : ""}`, r, `${u.line}${u.treeName ? ` (tree: "${u.treeName}")` : ""} ${u.markup}`);
    for (const d of r.listed?.duplicates ?? []) add(`same line ${d.line.split(" ")[0]}`, `${d.line.split(" ")[0]} controls listed with the same whole line`, r, `${d.count} x ${d.line} ${d.markup}`);
    for (const step of r.steps) {
      if (!step.listed) add(`step not listed`, "A control a step uses could not be pointed at", r, `${step.action}: ${step.why ?? ""}`);
      else if (step.pointed && step.heard !== "true") add(`heard ${step.heard}`, `After the visitor used the control, the widget's next question was ${step.heard === "none" ? "never asked" : `"${step.heard}"`}`, r, `${step.action}: ${step.event ?? "(no question)"}${step.why ? ` (${step.why})` : ""}`);
      if (step.readAt === "early" || step.readAt === "stale") add(`read ${step.readAt}`, `The list sent after an action was read ${step.readAt === "stale" ? "before the page changed" : "while the page was still changing"}`, r, `${step.action}: missing ${step.missingAfter.join(", ") || "nothing"}; still listed ${step.staleAfter.join(", ") || "nothing"}`);
      if (step.coveredByHaptic) add("covered by haptic", "Haptic's own caption or button sat on the control a visitor had to click", r, step.action);
      if (step.openedUnderHaptic?.length) add("opened under haptic", "Haptic's caption sat on top of controls the action opened, while the widget waited for its next answer", r, `${step.action}: ${step.openedUnderHaptic.length} of ${step.opened} covered (${step.openedUnderHaptic.slice(0, 3).join(", ")})`);
    }
    const o = r.overlay;
    if (o?.opened && !o.typed) add("overlay typing", "With the overlay open, a question could not be typed into Haptic's box", r, o.why ?? "");
    if (o?.opened && !o.stayedOpen) add(`overlay closed ${o.closedBy}`, `Going to Haptic's box closed the overlay (closed by ${o.closedBy})`, r, o.why ?? "");
    if (o?.typed && o.found < o.expected) add("overlay missing", "With the overlay open, its controls were not all in the list sent with the question", r, `${o.found}/${o.expected}; missing ${o.missing.slice(0, 6).join(", ")}`);
  }
  const ranked = [...found.values()].sort((a, b) => b.kits.size - a.kits.size || b.demos.size - a.demos.size);
  if (!ranked.length) return "No faults found.";
  return ranked
    .map((f, i) => `${i + 1}. ${f.what}. Toolkits: ${f.kits.size} (${[...f.kits].join(", ")}); demos: ${f.demos.size}.\n${f.examples.map((e) => `     ${e}`).join("\n")}`)
    .join("\n");
}
