import * as types from "../shared/types.ts";
import { TEACH_FRAGMENT, TEACH_KEY } from "../shared/teach-link.ts";
import type { OwnScript } from "./own-script.ts";
import * as snapshot from "./snapshot.ts";
import { TEACH_BUILD, TEACH_FILE, TEACH_HAND, TEACH_SHARED, type TeachCode } from "./teach-handshake.ts";
import * as teachNotice from "./teach-notice.ts";
import * as ui from "./ui.ts";

// The first file's side of teach mode (src/shared/teach.ts). Every page load
// takes a teaching link's token out of the address bar at once, before
// anything else, so it is never left there. Teach mode itself, the bar and
// the recording, is a file of its own, widget-teach.js, loaded only by a tab
// that holds a link or a teaching session it already claimed (`loadTeaching`),
// so no visitor's page carries it.

/** How long teach mode may take to arrive before the page says it could not be loaded. */
const LOAD_MS = 15_000;

/** What teach mode uses of the first file, by module (build.ts maps its imports of these modules here). */
export function teachModules() {
  return { types, snapshot, ui, teachNotice };
}

/**
 * The teach token in the address's fragment, `#haptic-teach=<token>`, taken out
 * of the address bar straight away so it is not bookmarked, shared or left in
 * the tab's history. The rest of the fragment is kept.
 */
export function takeTeachToken(): string | undefined {
  const hash = location.hash.replace(/^#/, "");
  const parts = hash.split("&");
  const found = parts.find((part) => part.startsWith(`${TEACH_FRAGMENT}=`));
  if (found === undefined) return undefined;
  const rest = parts.filter((part) => part !== found).join("&");
  try {
    history.replaceState(history.state, "", location.pathname + location.search + (rest ? `#${rest}` : ""));
  } catch {
    // The address could not be changed. The token is single use, so it is spent once claimed all the same.
  }
  const token = found.slice(TEACH_FRAGMENT.length + 1);
  // Something is always returned, so a link cut short in an email says it is broken rather than nothing happening.
  return token;
}

/** Whether this tab already holds a teaching session it claimed, from before a page load. */
export function teachingHeld(): boolean {
  try {
    return sessionStorage.getItem(TEACH_KEY) !== null;
  } catch {
    return false;
  }
}

let code: TeachCode | undefined;
let loading: Promise<TeachCode | undefined> | undefined;

/**
 * Loads teach mode, once, from beside the widget's own script tag, as its
 * address and its nonce were read when the widget first ran (own-script.ts),
 * not as anything on the page says now. Its code once it is in; undefined
 * when it could not be loaded, ran without handing anything back, came from
 * another build, or took longer than `LOAD_MS`.
 */
export function loadTeaching(script: Pick<OwnScript, "src" | "nonce">): Promise<TeachCode | undefined> {
  loading ??= new Promise<TeachCode | undefined>((resolve) => {
    const slots = globalThis as unknown as Record<symbol, unknown>;
    let tag: HTMLScriptElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(timer);
      delete slots[TEACH_SHARED];
      delete slots[TEACH_HAND];
      tag?.remove();
      tag = undefined;
      resolve(code);
    };
    try {
      slots[TEACH_SHARED] = teachModules();
      slots[TEACH_HAND] = (build: unknown, given: Partial<TeachCode> | undefined) => {
        if (build !== TEACH_BUILD || typeof given?.startTeaching !== "function") return;
        code = given as TeachCode;
        done();
      };
      tag = document.createElement("script");
      tag.async = true;
      if (script.nonce) tag.nonce = script.nonce;
      tag.addEventListener("load", done);
      tag.addEventListener("error", done);
      const url = new URL(`${TEACH_FILE}?v=${encodeURIComponent(TEACH_BUILD)}`, script.src).href;
      const trusted = (window as unknown as { trustedTypes?: { createPolicy(name: string, rules: { createScriptURL(url: string): string }): { createScriptURL(url: string): unknown } } }).trustedTypes;
      let set = false;
      if (trusted) {
        try {
          tag.src = trusted.createPolicy("haptic-teach", { createScriptURL: (given) => given }).createScriptURL(url) as string;
          set = true;
        } catch {
          // The page allows no policy of that name. The plain address is tried, and refused if the page requires one.
        }
      }
      if (!set) tag.src = url;
      timer = setTimeout(done, LOAD_MS);
      (document.head ?? document.documentElement).appendChild(tag);
    } catch (error) {
      console.warn("[Haptic] Couldn't load teach mode.", error);
      done();
    }
  });
  return loading;
}
