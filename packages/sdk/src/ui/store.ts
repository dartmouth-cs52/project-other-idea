import { signal } from "@preact/signals";
import { DEFAULT_APPEARANCE, type SiteConfig } from "@haptic/protocol";

export type Phase =
  | "idle"
  | "listening" // holding the launcher, mic on
  | "thinking" // request sent, nothing back yet
  | "responding" // streaming a step
  | "waiting" // pointed at something, waiting for the user's click
  | "settling" // the user acted, waiting for the page to settle
  | "answered" // explanation finished, nothing to wait for
  | "done" // goal reached
  | "error";

const LAUNCHER_KEY = "haptic.v1.launcher";

/** Whether this visitor shrank the launcher to a dot. Remembered per site in localStorage. */
function readLauncherHidden(): boolean {
  try {
    return localStorage.getItem(LAUNCHER_KEY) === "hidden";
  } catch {
    return false;
  }
}

export function rememberLauncherHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(LAUNCHER_KEY, "hidden");
    else localStorage.removeItem(LAUNCHER_KEY);
  } catch {
    // Storage blocked: it stays hidden for this page only.
  }
}

export function createStore() {
  return {
    /** Session started and this origin is allowed. */
    ready: signal(false),
    config: signal<SiteConfig>({
      siteName: "",
      appearance: DEFAULT_APPEARANCE,
      voiceEnabled: false,
      learningEnabled: false,
    }),
    askOpen: signal(false),
    phase: signal<Phase>("idle"),
    /** Caption text for the current step, tags removed. While listening, the live transcript. */
    text: signal(""),
    /** The question being answered, shown above the answer. */
    question: signal(""),
    step: signal(0),
    error: signal(""),
    /** The customer's page is dark, so our UI turns light. */
    pageDark: signal(false),
    /** The visitor shrank the launcher to a dot in the corner. */
    launcherHidden: signal(readLauncherHidden()),
  };
}

export type Store = ReturnType<typeof createStore>;
