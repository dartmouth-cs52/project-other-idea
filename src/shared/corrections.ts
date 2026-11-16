// No extension on this import: the website imports this file too, and its settings refuse one.
import { FILLER } from "./questions";
import { describeElement, questionKey, type SnapElement } from "./types";

const FILLER_SET = new Set(FILLER);

// Corrections from the customer, and the controls Haptic must never point at.
// Shared by the server, which puts them in the prompt and enforces the list,
// and the widget, which enforces the list again before the pointer moves.
//
// Element ids like e12 only last for one snapshot, so a control is named by
// its role and visible label, the way the dashboard shows it.

/** A control as a person names it: by what it says, and what kind of control it is. */
export interface ControlName {
  /** link, button, textbox, checkbox, select, tab, menuitem and so on. Empty matches any. */
  role?: string;
  label: string;
}

/** "Point here instead": one step of one question, fixed by the site's owner. */
export interface Correction {
  id: string;
  /** The page the step was on, normalized like /orders/:id. */
  route: string;
  /** The question the visitor asked, masked as it was recorded. */
  question: string;
  /** What Haptic pointed at, when it pointed at anything. */
  wrong?: ControlName;
  /** What it should have pointed at. */
  right: ControlName;
  createdAt: string;
}

/** The fixed sentence a visitor reads when the model names a control the site's owner has ruled out. */
export const BLOCKED_SAY = "I can't help with that here.";
/** At most this many corrections go with one step. */
const MAX_CORRECTIONS = 5;

const words = (label: string) => label.replace(/\s+/g, " ").trim().toLowerCase();

/** True when the element is one of these controls. Labels are compared without regard to case or spacing. */
export function matchesControl(element: Pick<SnapElement, "role" | "label" | "icon">, control: ControlName): boolean {
  const label = words(element.label || (element.icon ? `icon:${element.icon}` : ""));
  return label !== "" && label === words(control.label) && (!control.role || control.role === element.role);
}

export function isBlocked(element: Pick<SnapElement, "role" | "label" | "icon"> | undefined, blocked: ControlName[] | undefined): boolean {
  return Boolean(element && blocked?.some((control) => matchesControl(element, control)));
}

function meaning(question: string): Set<string> {
  return new Set(questionKey(question).split(" ").filter((word) => word.length > 1 && !FILLER_SET.has(word)));
}

/** True when two questions share most of what they are about, like "how do I add more seats" and "add seats to my plan". */
export function similarQuestion(a: string, b: string): boolean {
  const [x, y] = [meaning(a), meaning(b)];
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((word) => y.has(word)).length;
  return shared / Math.min(x.size, y.size) >= 0.5;
}

/**
 * The corrections that apply to a step: those for a question like the one
 * asked, and those made on the page the visitor is on. A question like this
 * one comes first, then the newest.
 */
export function correctionsFor(corrections: Correction[] | undefined, path: string, goal: string): Correction[] {
  if (!corrections?.length) return [];
  const scored = corrections
    .map((correction) => ({ correction, like: similarQuestion(correction.question, goal), here: correction.route === path }))
    .filter((item) => item.like || item.here);
  scored.sort((a, b) => Number(b.like) - Number(a.like) || Number(b.here) - Number(a.here) || b.correction.createdAt.localeCompare(a.correction.createdAt));
  return scored.slice(0, MAX_CORRECTIONS).map((item) => item.correction);
}

/** How a control is named in the prompt and on the dashboard: button "Send invite". */
export function controlText(control: ControlName): string {
  return describeElement({ role: control.role || "control", label: control.label });
}
