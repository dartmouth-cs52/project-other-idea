import { startTeaching } from "./teach.ts";
import { TEACH_BUILD, TEACH_HAND, type TeachCode } from "./teach-handshake.ts";

// The widget's teach mode, widget-teach.js (src/shared/teach.ts). Only a tab
// that holds a teaching link, or a teaching session it already claimed, loads
// it, from beside widget.js (teach-code.ts), so no visitor's page carries it.
// It brings none of the first file's code: the page reading, the shared rules
// and the widget's drawing helpers are handed over by the first file as it
// loads (build.ts). It hands back the one function the first file calls.

const code: TeachCode = { startTeaching };
const take = (globalThis as unknown as Record<symbol, unknown>)[TEACH_HAND];
if (typeof take === "function") take(TEACH_BUILD, code);
