// Single-page apps change routes with history.pushState instead of loading a
// new page. Wrap it once and tell listeners when the path changes.

type Listener = (from: string, to: string) => void;

const listeners = new Set<Listener>();
let installed = false;
let lastPath = "";

function currentPath(): string {
  return location.pathname + location.search;
}

function check() {
  const now = currentPath();
  if (now === lastPath) return;
  const from = lastPath;
  lastPath = now;
  for (const listener of listeners) {
    try {
      listener(from, now);
    } catch (error) {
      console.error("[Haptic] navigation listener failed", error);
    }
  }
}

function install() {
  if (installed) return;
  installed = true;
  lastPath = currentPath();

  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      queueMicrotask(check);
      return result;
    } as History["pushState"];
  }
  window.addEventListener("popstate", check);
  window.addEventListener("hashchange", check);
}

export function onNavigate(listener: Listener): () => void {
  install();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
