// Tasks for the guide benchmark, in the same shape as eval/guide.ts so
// eval/record.ts can walk them. Kept here, next to the pages they test, and
// collected in index.ts.
//
// `expect` lists the controls that are right at a step, by the label the
// widget would read (the accessible name) and, when two controls share it,
// the role. `act` is what a visitor does next, as a Playwright selector:
// CSS, or role=button[name="Issue card"], or text=Next.

export interface Matcher {
  label: string;
  role?: string;
}

export type Act = { click: string } | { fill: [selector: string, value: string] } | { select: [selector: string, value: string] } | { check: string };

export interface Step {
  expect: Matcher[];
  act?: Act;
  say?: string;
  sayStartsWith?: string;
}

/** Test-panel settings a task needs, set through ?lab.<name>=<value> on the start URL. */
export type LabParams = Partial<Record<"role" | "plan" | "nav" | "locale" | "nativeDialogs" | "liveFeed" | "chatBubble" | "banner" | "latency", string>>;

export interface Task {
  id: string;
  /** Path to open first, without the lab params. */
  start: string;
  /** The question, worded the way a user would type it. */
  goal: string;
  steps: Step[];
  lab?: LabParams;
  /** Which hard parts this task exercises, from the list in testbed/README.md. */
  covers: string[];
  /** Tasks whose right answer is "I can't do that here", and why. */
  note?: string;
}

export const button = (label: string): Matcher => ({ label, role: "button" });
export const link = (label: string): Matcher => ({ label, role: "link" });
export const any = (label: string): Matcher => ({ label });
export const DONE: Step = { expect: [] };
