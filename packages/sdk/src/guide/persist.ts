import type { HistoryTurn } from "@haptic/protocol";
import type { Fingerprint } from "../snapshot/index.ts";

// Guide state survives full page loads in sessionStorage, so a guide can keep
// going after the user clicks a plain link.

const KEY = "haptic.v1.guide";
const MAX_AGE_MS = 2 * 60 * 1000;

export interface SavedGuide {
  goal: string;
  history: HistoryTurn[];
  step: number;
  visited: string[];
  /** Path when the user was asked to act. */
  path: string;
  waitingFor?: Fingerprint & { label: string };
  savedAt: number;
}

export function saveGuide(guide: Omit<SavedGuide, "savedAt">) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...guide, savedAt: Date.now() }));
  } catch {
    // Storage can be full or blocked. The guide just won't survive a reload.
  }
}

export function loadGuide(): SavedGuide | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as SavedGuide;
    if (Date.now() - saved.savedAt > MAX_AGE_MS) {
      clearGuide();
      return undefined;
    }
    return saved;
  } catch {
    return undefined;
  }
}

export function clearGuide() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
