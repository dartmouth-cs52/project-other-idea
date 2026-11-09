import { describeElement } from "./prompt.ts";
import type { PageChange, PageSnapshot, SnapshotElement } from "./types.ts";

// Compares the page before and after the user acted on a step, so the model
// can tell whether the click did anything. Element ids are only valid for one
// snapshot, so elements are matched by role, label, icon and link instead.

const MAX_LISTED = 8;
const MAX_TEXT = 5;
const MAX_TEXT_LENGTH = 100;

/** Identifies the same control across two snapshots. */
export function elementKey(element: Pick<SnapshotElement, "role" | "label" | "icon" | "href">): string {
  return `${element.role}|${element.label}|${element.icon ?? ""}|${element.href ?? ""}`;
}

export function describeChange(before: PageSnapshot, after: PageSnapshot): PageChange {
  const change: PageChange = { none: false };
  if (before.path !== after.path) change.path = { from: before.path, to: after.path };
  if (before.dialog !== after.dialog) {
    if (before.dialog !== undefined) change.dialogClosed = before.dialog;
    if (after.dialog !== undefined) change.dialogOpened = after.dialog;
  }

  // A new page or a dialog swaps out most of the list, and the model reads the
  // new list anyway, so element-level changes only matter within one view.
  const sameView = !change.path && before.dialog === after.dialog;
  if (sameView) {
    const added = without(after.elements, before.elements, elementKey);
    const removed = without(before.elements, after.elements, elementKey);
    if (added.length) {
      change.added = added.slice(0, MAX_LISTED).map(describeElement);
      if (added.length > MAX_LISTED) change.addedMore = added.length - MAX_LISTED;
    }
    if (removed.length) {
      change.removed = removed.slice(0, MAX_LISTED).map(describeElement);
      if (removed.length > MAX_LISTED) change.removedMore = removed.length - MAX_LISTED;
    }
    const states = stateChanges(before.elements, after.elements);
    if (states.length) change.states = states.slice(0, MAX_LISTED);
  }

  const beforeText = textOf(before);
  const afterText = textOf(after);
  const newText = without(afterText, beforeText, (text) => text);
  if (newText.length) change.text = newText.slice(0, MAX_TEXT).map((text) => text.slice(0, MAX_TEXT_LENGTH));
  const textGone = without(beforeText, afterText, (text) => text).length > 0;

  change.none = !change.path && before.dialog === after.dialog && !change.added && !change.removed && !change.states && !change.text && !textGone;
  return change;
}

/** Items of `list` left over after matching each one in `other` once. */
function without<T>(list: T[], other: T[], key: (item: T) => string): T[] {
  const counts = new Map<string, number>();
  for (const item of other) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return list.filter((item) => {
    const left = counts.get(key(item)) ?? 0;
    if (left === 0) return true;
    counts.set(key(item), left - 1);
    return false;
  });
}

/** Checked, expanded and similar flips, for controls that appear once in both snapshots. */
function stateChanges(before: SnapshotElement[], after: SnapshotElement[]): string[] {
  const unique = (elements: SnapshotElement[]) => {
    const byKey = new Map<string, SnapshotElement | null>();
    for (const element of elements) {
      const key = elementKey(element);
      byKey.set(key, byKey.has(key) ? null : element);
    }
    return byKey;
  };
  const was = unique(before);
  const changes: string[] = [];
  for (const [key, element] of unique(after)) {
    const old = was.get(key);
    if (!element || !old) continue;
    const now = new Set(element.state ?? []);
    const then = new Set(old.state ?? []);
    const gained = [...now].filter((state) => !then.has(state));
    const lost = [...then].filter((state) => !now.has(state));
    if (!gained.length && !lost.length) continue;
    const parts = [];
    if (gained.length) parts.push(`is now ${gained.join(", ")}`);
    if (lost.length) parts.push(`is no longer ${lost.join(", ")}`);
    changes.push(`${describeElement(element)} ${parts.join(" and ")}`);
  }
  return changes;
}

function textOf(snapshot: PageSnapshot): string[] {
  return [...snapshot.alerts, ...snapshot.headings, ...(snapshot.text ?? [])];
}
