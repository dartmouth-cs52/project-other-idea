// Mapping a company's signed-in app from Haptic's own browser, for a company
// that would rather hand over a test account than sit through it.
//
// The other way (src/widget/map.ts) has someone at the company open their app
// in a tab of their own, already signed in, and press Start. Here a browser on
// Cloudflare signs in with the account they gave (worker/sign-in.ts), opens
// the app, and the same mapper runs in it: the widget's, with the same rules
// about what it will not press. Nothing about what is mapped differs. Pages
// reach the site the same way, sent by the mapper as it goes.
//
// The browser outlives the request that started it. The dashboard asks how it
// is getting on every few seconds, and each time this connects to the same
// browser by its session id, looks, and lets go. A browser nobody has asked
// after for five minutes closes by itself, and so does any run at half an hour.
//
// The account's name and password are used in the one request that signs in.
// What is kept afterwards is the browser's session id, which is of use only
// to this Worker.

import puppeteer from "@cloudflare/puppeteer";
import { MAP_KEY } from "../../src/shared/mapping";
import { beginMapping, type MapPage } from "./map-begin";
import { signIn, type SignInPage, type SignInWith } from "./sign-in";

/** Cloudflare Browser Rendering, the BROWSER binding. The same shape reader.ts asks for, said here so this file stands apart from the reader. */
export interface BrowserBinding {
  fetch: typeof fetch;
}

/** What a site keeps while Haptic's browser is mapping it. */
export interface MapRun {
  /** The browser on Cloudflare, to connect to again. */
  session: string;
  startedAt: string;
}

export interface RunProgress {
  running: boolean;
  /** Screens the mapper has finished, when it could be asked. */
  screens?: number;
}

/** How long the browser stays open with no one asking after it. Cloudflare allows ten minutes at most. */
const KEEP_ALIVE_MS = 5 * 60_000;
/** The longest one run may take. The mapper's own limits end most runs well before this. */
export const MAX_RUN_MS = 30 * 60_000;

/** Signs in and starts the mapper. Returns the browser's session id, with the browser left running. */
export async function startRun(binding: BrowserBinding, using: SignInWith, start: string, pass: string, allowed: (origin: string) => boolean): Promise<string> {
  const browser = await puppeteer.launch(binding as never, { keep_alive: KEEP_ALIVE_MS });
  let started = false;
  try {
    const page = await browser.newPage();
    // A real browser's name, so the app serves what its users get, with ours after it, so the company can tell these visits apart.
    await page.setUserAgent(`${await browser.userAgent()} HapticMapper/1.0 (+https://joinhaptic.com)`);
    await signIn(page as unknown as SignInPage, using, allowed);
    await beginMapping(page as unknown as MapPage, start, pass, allowed);
    started = true;
    return browser.sessionId();
  } finally {
    // Left running, the browser is only let go of. Closing it would end the run.
    if (started) await Promise.resolve(browser.disconnect()).catch(() => {});
    else await browser.close().catch(() => {});
  }
}

/**
 * How a run is getting on. Not running once the mapper has finished, the
 * browser has gone, or the run has had its half hour, and the browser is
 * closed then.
 */
export async function runProgress(binding: BrowserBinding, run: MapRun, now = Date.now()): Promise<RunProgress> {
  let browser: Awaited<ReturnType<typeof puppeteer.connect>>;
  try {
    browser = await puppeteer.connect(binding as never, run.session);
  } catch {
    // Closed already: it finished and was closed, or no one asked after it for too long.
    return { running: false };
  }
  let over = now - Date.parse(run.startedAt) > MAX_RUN_MS;
  try {
    if (over) return { running: false };
    // A button the mapper pressed may have opened a tab of its own. The mapper is in the one that holds its state.
    let between = false;
    for (const page of await browser.pages()) {
      let kept: string | null;
      try {
        kept = await page.evaluate((key: string) => sessionStorage.getItem(key), MAP_KEY);
      } catch {
        // Between two page loads there is nothing to ask. It is still going.
        between = true;
        continue;
      }
      if (!kept) continue;
      const state = JSON.parse(kept) as { status?: string; count?: number };
      // The mapper pauses itself when something goes wrong, for a person to carry on. No one is there to.
      if (state.status !== "running") break;
      return { running: true, screens: Number(state.count) || 0 };
    }
    if (between) return { running: true };
    // The mapper clears its state when it ends.
    over = true;
    return { running: false };
  } catch {
    return { running: true };
  } finally {
    if (over) await browser.close().catch(() => {});
    else await Promise.resolve(browser.disconnect()).catch(() => {});
  }
}

/** Ends a run by closing its browser. Pages mapped so far are already saved. */
export async function stopRun(binding: BrowserBinding, run: MapRun): Promise<void> {
  try {
    const browser = await puppeteer.connect(binding as never, run.session);
    await browser.close();
  } catch {
    // Gone already.
  }
}
