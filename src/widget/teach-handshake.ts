import type { startTeaching } from "./teach.ts";

// How the widget's first file and its teach mode, widget-teach.js, find each
// other: what the first file (teach-code.ts) leaves for teach mode while it
// loads, and what teach mode (teaching.ts) hands back. The same pattern as
// acting (acting-handshake.ts), with names of its own.

/** The build both files were made from (build.ts sets it). A first file only takes teach mode of its own build. */
declare const __HAPTIC_BUILD__: string | undefined;
export const TEACH_BUILD = typeof __HAPTIC_BUILD__ === "string" ? __HAPTIC_BUILD__ : "dev";
/** Where the first file leaves what teach mode uses of it, while teach mode loads. build.ts points teach mode's imports of those modules here. */
export const TEACH_SHARED = Symbol.for("haptic.teach.shared");
/** Where teach mode hands back its code. */
export const TEACH_HAND = Symbol.for("haptic.teach.code");
/** Teach mode's file name, beside widget.js. */
export const TEACH_FILE = "widget-teach.js";

/** What teach mode gives the first file. */
export interface TeachCode {
  startTeaching: typeof startTeaching;
}
