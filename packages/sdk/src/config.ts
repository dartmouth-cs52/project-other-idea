// Settings come from the script tag's data attributes, or from
// window.HapticConfig when the page sets it before loading the script.

export interface HapticOptions {
  key: string;
  /** Base URL of the Haptic API. Defaults to the origin the script came from. */
  apiBase: string;
  /** Optional keyboard shortcut that opens the Ask bar, e.g. "Alt+H". */
  shortcut?: string;
}

export interface GlobalConfig {
  key?: string;
  apiBase?: string;
  shortcut?: string;
}

declare global {
  interface Window {
    HapticConfig?: GlobalConfig;
  }
}

export function readOptions(script: HTMLScriptElement | null): HapticOptions | undefined {
  const global = window.HapticConfig ?? {};
  const tag = script ?? document.querySelector<HTMLScriptElement>("script[data-key][src*='haptic']");
  const key = global.key ?? tag?.dataset.key;
  if (!key) {
    console.warn("[Haptic] No key found. Add data-key=\"pk_...\" to the Haptic script tag.");
    return undefined;
  }
  let apiBase = global.apiBase ?? tag?.dataset.api;
  if (!apiBase && tag?.src) {
    try {
      apiBase = new URL(tag.src, location.href).origin;
    } catch {
      apiBase = undefined;
    }
  }
  const shortcut = global.shortcut ?? tag?.dataset.shortcut;
  return { key, apiBase: (apiBase ?? location.origin).replace(/\/$/, ""), ...(shortcut ? { shortcut } : {}) };
}

/** Matches "Alt+H", "Mod+/", "Ctrl+Shift+K". Mod is Cmd on Mac, Ctrl elsewhere. */
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+").map((part) => part.trim());
  const key = parts.pop();
  if (!key) return false;
  const isMac = /mac|iphone|ipad/i.test(navigator.platform);
  const want = {
    alt: parts.includes("alt") || parts.includes("option"),
    shift: parts.includes("shift"),
    ctrl: parts.includes("ctrl") || (parts.includes("mod") && !isMac),
    meta: parts.includes("cmd") || parts.includes("meta") || (parts.includes("mod") && isMac),
  };
  if (event.altKey !== want.alt || event.shiftKey !== want.shift || event.ctrlKey !== want.ctrl || event.metaKey !== want.meta) {
    return false;
  }
  // event.code is layout-independent, so Alt+H still matches on a Mac where
  // Option+H types a symbol.
  const code = event.code.toLowerCase();
  return event.key.toLowerCase() === key || code === `key${key}` || code === `digit${key}` || (key === "/" && code === "slash");
}
