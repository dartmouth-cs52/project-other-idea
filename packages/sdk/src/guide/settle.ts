// Wait until the page stops changing after a click or route change, so the
// next snapshot shows the new state instead of a half-rendered one.

export interface SettleOptions {
  /** How long the page must stay quiet. */
  quietMs?: number;
  /** Give up waiting after this long. */
  maxMs?: number;
  /** Our own root. Changes inside it don't count. */
  ignore?: Node;
  signal?: AbortSignal;
}

export function waitForSettle({ quietMs = 300, maxMs = 3000, ignore, signal }: SettleOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout>;
    const finish = () => {
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const restartQuiet = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        // A spinner or skeleton means data is still loading; keep waiting.
        if (isLoading(ignore)) restartQuiet();
        else finish();
      }, quietMs);
    };
    const observer = new MutationObserver((records) => {
      if (ignore && records.every((record) => record.target === ignore || ignore.contains(record.target))) return;
      restartQuiet();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const maxTimer = setTimeout(finish, maxMs);
    signal?.addEventListener("abort", finish);
    restartQuiet();
  });
}

// Common loading markers: ARIA busy regions, progress bars, and the class
// names spinner and skeleton components use (Tailwind's animate-spin and
// animate-pulse included).
const LOADING_SELECTOR = [
  '[aria-busy="true"]',
  '[role="progressbar"]',
  ".animate-spin",
  ".animate-pulse",
  "[class*='skeleton']",
  "[class*='Skeleton']",
  "[class*='spinner']",
  "[class*='Spinner']",
  "[class*='loading']",
].join(", ");

export function isLoading(ignore?: Node): boolean {
  for (const el of document.querySelectorAll(LOADING_SELECTOR)) {
    if (ignore && (el === ignore || ignore.contains(el))) continue;
    const visible = typeof el.checkVisibility === "function" ? el.checkVisibility() : el.getClientRects().length > 0;
    if (visible) return true;
  }
  return false;
}
