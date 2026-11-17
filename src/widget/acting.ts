import { perform } from "./act.ts";
import { ACTING_BUILD, ACTING_HAND, type ActingCode } from "./acting-handshake.ts";
import { confirmationAction, planFor } from "./gate.ts";

// The second file of the widget, widget-act.js: the code that acts ("Do it
// with me"), its gate (gate.ts) and the word tables both read
// (src/shared/act-rules.ts). The first file, widget.js, loads it only on a
// site with acting on, from the same address it came from (acting-code.ts),
// so a site's script policy needs nothing more for it.
//
// It brings none of the first file's code with it. What it uses of it, the
// page reading, the shared rules and the note of which events are Haptic's
// own, it is handed by the first file as it loads (see build.ts), so both
// files share one copy of each. It hands back the three functions the guide
// calls, with the build both were made from, and the first file uses them
// only when that build is its own.

const code: ActingCode = { perform, planFor, confirmationAction };
const take = (globalThis as unknown as Record<symbol, unknown>)[ACTING_HAND];
if (typeof take === "function") take(ACTING_BUILD, code);
