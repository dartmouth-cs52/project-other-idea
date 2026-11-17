import type { perform } from "./act.ts";
import type { confirmationAction, planFor } from "./gate.ts";

// How the widget's two files find each other: what the first file
// (acting-code.ts) leaves for the second (acting.ts) while it loads, and
// what the second hands back. Both files hold this small module.

/** The build both files were made from (build.ts sets it). A first file only takes a second file of its own build. */
declare const __HAPTIC_BUILD__: string | undefined;
export const ACTING_BUILD = typeof __HAPTIC_BUILD__ === "string" ? __HAPTIC_BUILD__ : "dev";
/** Where the first file leaves what the second file uses of it, while the second file loads. build.ts points the second file's imports of those modules here. */
export const ACTING_SHARED = Symbol.for("haptic.acting.shared");
/** Where the second file hands back its code. */
export const ACTING_HAND = Symbol.for("haptic.acting.code");
/** The second file's name, beside widget.js. */
export const ACTING_FILE = "widget-act.js";

/** What the second file gives the guide. */
export interface ActingCode {
  perform: typeof perform;
  planFor: typeof planFor;
  confirmationAction: typeof confirmationAction;
}
