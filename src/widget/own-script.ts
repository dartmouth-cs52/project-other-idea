// The widget's own script tag, read once, as the file first runs: that is the
// only time document.currentScript names it. Every address the widget uses
// comes from it: the server it asks, and the files it loads beside itself.
//
// The page's own HTML can put something else in its place. A document's named
// elements come before its own properties, so an injected
// <img name="currentScript" src="https://elsewhere.example/x"> makes
// document.currentScript that image. Taken at its word, the widget fetched its
// settings from there and loaded a second file from there into the page, to
// run as the page's own script. So only a script element is taken, and
// nothing is looked for in its place: an inert script element that the page's
// HTML added without running it would answer a search for one as well.

export interface OwnScript {
  /** The tag itself, for its data-* settings. */
  tag: HTMLScriptElement;
  /** Its address when it ran, which the files loaded beside it are found from. */
  src: string;
  /** The origin of that address, where everything the widget sends goes. */
  origin: string;
  /** Its nonce, which those files are given on a page whose policy asks for one. */
  nonce: string;
}

/** Why there is no own script: none was running, or something on the page took the name of one. */
export type Missing = "none" | "named";

function read(): OwnScript | Missing {
  try {
    const found = document.currentScript;
    if (!(found instanceof HTMLScriptElement)) return found ? "named" : "none";
    return { tag: found, src: found.src, origin: new URL(found.src).origin, nonce: found.nonce ?? "" };
  } catch {
    // A tag with no address, written inline: there is no server to ask.
    return "none";
  }
}

const own = read();
/** The tag this file came from, or undefined when it could not be told. */
export const OWN_SCRIPT: OwnScript | undefined = typeof own === "string" ? undefined : own;
/** Why OWN_SCRIPT is undefined, when it is. */
export const OWN_SCRIPT_MISSING: Missing | undefined = typeof own === "string" ? own : undefined;
