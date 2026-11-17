// Single-page apps change the address with history.pushState instead of
// loading a new page, so nothing reloads and the widget has to notice for
// itself. It watches without touching the page's own history object: through
// the browser's Navigation API where there is one, and otherwise by looking
// at the address often while anything is listening.

type Listener = (from: string, to: string) => void;

const listeners = new Set<Listener>();
/** How often the address is looked at in a browser without the Navigation API. */
const POLL_MS = 100;
let last = "";
let poll: ReturnType<typeof setInterval> | undefined;
let watching = false;

function check() {
  const now = location.href;
  if (now === last) return;
  const from = last;
  last = now;
  for (const listener of [...listeners]) {
    try {
      listener(from, now);
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  }
}

interface NavigationLike {
  addEventListener(type: "currententrychange", listener: () => void): void;
  removeEventListener(type: "currententrychange", listener: () => void): void;
}

function navigationApi(): NavigationLike | undefined {
  const api = (window as unknown as { navigation?: NavigationLike }).navigation;
  return api && typeof api.addEventListener === "function" ? api : undefined;
}

function start() {
  if (watching) return;
  watching = true;
  last = location.href;
  const api = navigationApi();
  // pushState, replaceState, back and forward all change the current entry.
  if (api) api.addEventListener("currententrychange", check);
  else poll = setInterval(check, POLL_MS);
  window.addEventListener("popstate", check);
  window.addEventListener("hashchange", check);
}

function stopIfIdle() {
  if (listeners.size || !watching) return;
  watching = false;
  navigationApi()?.removeEventListener("currententrychange", check);
  clearInterval(poll);
  window.removeEventListener("popstate", check);
  window.removeEventListener("hashchange", check);
}

/** Calls `listener` with the old and new address each time the address changes. Returns a function that stops it. */
export function onAddressChange(listener: Listener): () => void {
  start();
  // Anything not yet passed on goes to those already listening. It isn't news to this one.
  check();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    stopIfIdle();
  };
}
