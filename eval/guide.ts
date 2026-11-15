import type { Matcher } from "./cases.ts";

// A guide as a script: the question, and for each step which controls are
// right and what a visitor would do next. eval/record.ts walks a site with
// these and keeps what the widget sends as benchmark cases.

export type Act = { click: string } | { fill: [selector: string, value: string] } | { select: [selector: string, value: string] } | { check: string };

export interface Step {
  /** The controls that are right at this step. Empty when the guide is over. */
  expect: Matcher[];
  /** What the visitor does next. Leave it out to stop here, as before a button that must not be pressed. */
  act?: Act;
  /** What the scripted answer says, when "Click <label>." would not do. */
  say?: string;
  sayStartsWith?: string;
}

export interface Guide {
  id: string;
  /** The path the visitor is on when they ask. */
  start: string;
  goal: string;
  steps: Step[];
}

export interface GuideSet {
  /** The site's id in data/sites. Its context is saved with the cases. */
  siteId: string;
  /** Where the site is, like "https://example.com". */
  origin: string;
  /** False when the site's pages do not carry Haptic's script tag, so the recorder adds it. */
  hasTag: boolean;
  guides: Guide[];
}

export const button = (label: string): Matcher => ({ label, role: "button" });
export const any = (label: string): Matcher => ({ label });
export const DONE: Step = { expect: [] };
