// Setting the mapper going in a page that is already signed in, for
// worker/map-run.ts. Kept apart from it, and free of Cloudflare's browser
// package, so the tests at the top of the repository can run it in a browser
// of their own.

import { MAP_KEY, newMapState } from "../../src/shared/mapping";
import { CannotMap, type SignInPage } from "./sign-in";

const LOAD_MS = 20_000;
/** How long the widget may take to show on the app's first page. */
const WIDGET_MS = 12_000;

/** What starting the mapper needs of a page, beyond signing in. */
export interface MapPage extends SignInPage {
  reload(options?: { timeout?: number }): Promise<unknown>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens the app where the company said it starts and sets the mapper going
 * in it. The mapper waits for a person to press Start unless the tab already
 * holds a run under way, so that is what the tab is given before the page is
 * loaded again. Throws CannotMap when the widget is not on that page.
 */
export async function beginMapping(page: MapPage, start: string, pass: string, allowed: (origin: string) => boolean): Promise<void> {
  try {
    await page.goto(start, { timeout: LOAD_MS });
  } catch {
    throw new CannotMap("Haptic signed in, but could not open the address your app starts at. Check it.");
  }
  const at = new URL(page.url());
  if (!allowed(at.origin)) throw new CannotMap(`Haptic signed in, but your app's start address led to ${at.host}, which is not an address Haptic may run on.`);
  await page.evaluate(([key, state]: [string, string]) => sessionStorage.setItem(key, state), [MAP_KEY, JSON.stringify(newMapState(pass, "running"))]);
  await page.reload({ timeout: LOAD_MS }).catch(() => {});
  for (const end = Date.now() + WIDGET_MS; Date.now() < end; ) {
    const there = await page.evaluate(() => document.querySelector("haptic-root") !== null).catch(() => false);
    if (there) return;
    await sleep(400);
  }
  throw new CannotMap(`Haptic signed in, but its script is not on ${at.origin}${at.pathname}. Mapping runs through the script, so give a start address the script is on.`);
}
