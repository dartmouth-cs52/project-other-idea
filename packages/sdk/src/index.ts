import { readOptions } from "./config.ts";
import { Haptic, type HapticApi } from "./haptic.tsx";

declare global {
  interface Window {
    Haptic?: HapticApi;
    __hapticLoaded?: boolean;
  }
}

// currentScript is only set while this file first runs, so read it now.
const script = document.currentScript as HTMLScriptElement | null;

function boot() {
  if (window.__hapticLoaded) return;
  window.__hapticLoaded = true;
  const options = readOptions(script);
  if (!options) return;
  const haptic = new Haptic(options);
  window.Haptic = haptic.publicApi();
  const start = () => {
    haptic.start().catch((error) => console.error("[Haptic] Failed to start", error));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

try {
  boot();
} catch (error) {
  // Never let Haptic break the page it's embedded in.
  console.error("[Haptic] Failed to load", error);
}
