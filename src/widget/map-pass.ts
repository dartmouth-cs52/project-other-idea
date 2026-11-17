import { MAPPING_FRAGMENT, MAPPING_PASS } from "../shared/mapping.ts";

// The little of mapping (map.ts) that every copy of the widget carries: seeing
// that this tab was opened from the dashboard to map the app, and fetching the
// rest. The mapper itself is a file of its own, /map.js, so a visitor's
// browser never downloads code only one person at the company ever runs.

export const MAP_KEY = "haptic.map";

/** What the mapper is handed by the widget that loads it. */
export interface MappingParts {
  api: string;
  site: string;
  /** The widget's own element. Nothing in it is read or pressed. */
  host: HTMLElement;
  /** Controls the company said Haptic must never point at. They are never pressed either. */
  blocked: { role?: string; label: string }[];
}

/**
 * Looks for a mapping pass, in the address or kept from an earlier page in
 * this tab. Run as the script loads, before anything else. True when this
 * tab is mapping.
 */
export function mappingAsked(): boolean {
  try {
    const at = location.hash.indexOf(MAPPING_FRAGMENT);
    if (at >= 0) {
      const pass = location.hash.slice(at + MAPPING_FRAGMENT.length).split(/[&#]/)[0] ?? "";
      // The pass comes out of the address at once, so it isn't copied, bookmarked or sent on in a Referer.
      history.replaceState(history.state, "", location.pathname + location.search);
      if (MAPPING_PASS.test(pass)) sessionStorage.setItem(MAP_KEY, JSON.stringify({ pass, status: "ready", todo: [], done: [], asked: [], tried: {}, memo: {}, count: 0, loads: 0 }));
    }
    return sessionStorage.getItem(MAP_KEY) !== null;
  } catch {
    return false;
  }
}

/** Fetches the mapper and hands it what it needs. */
export function loadMapper(parts: MappingParts) {
  (window as unknown as { hapticMapping?: MappingParts }).hapticMapping = parts;
  const script = document.createElement("script");
  script.src = `${parts.api}/map.js`;
  script.async = true;
  document.head.append(script);
}
