// The pass that lets someone at a company map their app from their own
// signed-in browser. The dashboard makes it and puts it in a link. The site
// keeps only this hash of it, so reading the database gives no one a pass.

/** How long a pass works for. */
export const MAPPING_PASS_MS = 2 * 60 * 60 * 1000;
export const MAPPING_PASS = /^[0-9a-f]{48}$/;
/** The part of the address that carries the pass to the widget, after the #, so it is never sent to the company's server. */
export const MAPPING_FRAGMENT = "haptic-map=";

/** Where the mapper keeps how far it has got, in the tab's sessionStorage (src/widget/map.ts). */
export const MAP_KEY = "haptic.map";

/**
 * What a tab holds before the mapper has done anything. "ready" waits for the
 * person to press Start in that tab. "running" is only ever written by Haptic's
 * own browser, which has no one in it to press Start (web/worker/map-run.ts).
 */
export function newMapState(pass: string, status: "ready" | "running" = "ready") {
  return { pass, status, todo: [], done: [], asked: [], tried: {}, memo: {}, count: 0, loads: 0 };
}

export function newMappingPass(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function mappingHash(site: string, pass: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${site} map:${pass}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** True when `pass` is the one this site is waiting for and it has not run out. */
export async function mappingAllowed(site: string, mapping: { hash: string; expires: string } | undefined, pass: string, now = Date.now()): Promise<boolean> {
  if (!mapping || !MAPPING_PASS.test(pass) || !(Date.parse(mapping.expires) > now)) return false;
  const hash = await mappingHash(site, pass);
  // Compared in full, whatever differs, so how long it takes says nothing about where.
  let differs = hash.length ^ mapping.hash.length;
  for (let i = 0; i < hash.length; i++) differs |= hash.charCodeAt(i) ^ (mapping.hash.charCodeAt(i) || 0);
  return differs === 0;
}
