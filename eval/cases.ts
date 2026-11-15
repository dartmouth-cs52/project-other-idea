import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describeElement, type SiteContext, type SnapElement, type TurnReply, type TurnRequest } from "../src/shared/types.ts";

// A benchmark case is one step of one guide, frozen: the page as the widget
// saw it, the question, what had happened so far, and which controls are a
// right answer. Cases live in eval/cases/*.json, one file per site.

/** A control that counts as a right answer. The label is compared without regard to case. */
export interface Matcher {
  label: string;
  /** Needed only when two controls share the label, like a button and the title of the dialog it opens. */
  role?: string;
}

export interface Expect {
  /** Any one of these is right. Empty means nothing is left to point at. */
  targets: Matcher[];
  /** Reported beside the score, not part of it: models differ on whether the last click is "continue" or "done". */
  status: "continue" | "done";
  /** Set when the wording matters, as after a wrong click. */
  sayStartsWith?: string;
}

export interface Case {
  /** The guide's name and the step's number, like "billing-2". */
  id: string;
  guide: string;
  request: Omit<TurnRequest, "site">;
  expect: Expect;
}

export interface CaseFile {
  /** What the server knows about the site. It is part of the prompt, so it is kept with the cases. */
  site: SiteContext;
  cases: Case[];
}

export const CASES_DIR = fileURLToPath(new URL("./cases/", import.meta.url));

export function matches(matcher: Matcher, element: Pick<SnapElement, "role" | "label">): boolean {
  return element.label.trim().toLowerCase() === matcher.label.trim().toLowerCase() && (!matcher.role || matcher.role === element.role);
}

export interface Score {
  /** The pointer went to a right control, or to nothing when nothing was left, and the wording check passed. */
  pass: boolean;
  /** Whether "continue" or "done" agreed with the case. */
  statusAgrees: boolean;
  /** Why it failed, in words. Empty on a pass. */
  why: string;
}

export function score(item: Case, reply: TurnReply): Score {
  const { expect, request } = item;
  const statusAgrees = reply.status === expect.status;
  const fail = (why: string): Score => ({ pass: false, statusAgrees, why });
  const pointed = reply.target ? request.snapshot.elements.find((element) => element.id === reply.target) : undefined;
  const wanted = expect.targets.map((matcher) => `${matcher.role ?? "control"} "${matcher.label}"`).join(" or ");

  if (expect.targets.length === 0) {
    if (pointed) return fail(`pointed at ${describeElement(pointed)} when nothing was left to point at`);
  } else {
    if (!pointed) return fail(`pointed at nothing, wanted ${wanted}`);
    if (!expect.targets.some((matcher) => matches(matcher, pointed))) return fail(`pointed at ${describeElement(pointed)}, wanted ${wanted}`);
  }
  if (expect.sayStartsWith && !reply.say.startsWith(expect.sayStartsWith)) return fail(`said "${reply.say}", which should start with "${expect.sayStartsWith}"`);
  return { pass: true, statusAgrees, why: "" };
}

/** Reads every case file, or only the named ones ("demo" for eval/cases/demo.json). */
export async function loadCaseFiles(names: string[] = []): Promise<{ name: string; file: CaseFile }[]> {
  const all = (await readdir(CASES_DIR)).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
  const wanted = names.length ? names : all;
  const files = [];
  for (const name of wanted) {
    if (!all.includes(name)) throw new Error(`No case file called "${name}". There ${all.length === 1 ? "is" : "are"}: ${all.join(", ") || "none yet"}.`);
    files.push({ name, file: JSON.parse(await readFile(`${CASES_DIR}${name}.json`, "utf8")) as CaseFile });
  }
  return files;
}

/**
 * The range the true score plausibly lies in, given how few cases there are
 * (Wilson's 95% interval). Two models whose ranges overlap are not yet told apart.
 */
export function plausibleRange(passed: number, total: number): { low: number; high: number } {
  if (total === 0) return { low: 0, high: 1 };
  const z = 1.96;
  const p = passed / total;
  const centre = (p + (z * z) / (2 * total)) / (1 + (z * z) / total);
  const half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / (1 + (z * z) / total);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}
