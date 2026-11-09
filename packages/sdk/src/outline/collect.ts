import { isLearnableLabel, normalizePath, type PageOutline } from "@haptic/protocol";
import { onNavigate } from "../guide/navigation.ts";
import { waitForSettle } from "../guide/settle.ts";
import type { ApiClient } from "../net/api.ts";
import { takeSnapshot } from "../snapshot/index.ts";
import { describeLabel } from "../snapshot/labels.ts";

// Sends a cleaned outline of each route once per browser session, so the
// server can build a map of the whole app. Runs at idle time after the page
// settles, never while the user is mid-interaction.

const SENT_KEY = "haptic.v1.outlines";
const CLICK_KEY = "haptic.v1.lastClick";
/** A route change this soon after a click is credited to that click. */
const CLICK_WINDOW_MS = 8000;

function sentRoutes(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SENT_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function remember(routes: Set<string>) {
  try {
    sessionStorage.setItem(SENT_KEY, JSON.stringify(Array.from(routes).slice(-400)));
  } catch {
    // Without storage we may send a route twice. Harmless.
  }
}

interface LastClick {
  from: string;
  label: string;
  at: number;
}

const CLICKABLE = 'a[href], button, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"]';

/**
 * Remembers the label of the last control clicked, so a route change right
 * after it teaches us "View on /home leads to /set/:id". That's how Haptic
 * learns paths that only appear after opening a dialog or menu. Kept in
 * sessionStorage so full page loads count too.
 */
function recordClick(event: Event, host: Element) {
  for (const node of event.composedPath()) {
    if (!(node instanceof Element) || node === host) continue;
    if (!node.matches(CLICKABLE)) continue;
    if (node.closest("[data-haptic-ignore]")) return;
    const role = node.matches("a[href], [role=link]") ? "link" : "button";
    const { label, icon } = describeLabel(node, role);
    const name = label || (icon ? `icon:${icon}` : "");
    if (!name) return;
    const inDialog = node.closest('dialog, [role="dialog"], [role="alertdialog"]') !== null;
    const inMenu = !inDialog && node.closest('[role="menu"], [role="listbox"]') !== null;
    const click: LastClick = {
      from: normalizePath(location.pathname),
      label: `${name}${inDialog ? ", in a dialog" : inMenu ? ", in a menu" : ""}`,
      at: Date.now(),
    };
    try {
      sessionStorage.setItem(CLICK_KEY, JSON.stringify(click));
    } catch {
      // Best effort.
    }
    return;
  }
}

function takeClick(): LastClick | undefined {
  try {
    const raw = sessionStorage.getItem(CLICK_KEY);
    sessionStorage.removeItem(CLICK_KEY);
    const click = raw ? (JSON.parse(raw) as LastClick) : undefined;
    return click && Date.now() - click.at < CLICK_WINDOW_MS ? click : undefined;
  } catch {
    return undefined;
  }
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(() => resolve(), { timeout: 3000 });
    else setTimeout(resolve, 200);
  });
}

export function buildOutline(host: Element): PageOutline {
  const { snapshot } = takeSnapshot(host);
  const links: PageOutline["links"] = [];
  const buttons: string[] = [];
  for (const element of snapshot.elements) {
    // Icon-only buttons are often the ones people can't find, like Share.
    const label = element.label || (element.icon ? `icon:${element.icon}` : "");
    if (!label) continue;
    if (element.role === "link" && element.href && !element.href.startsWith("external:")) {
      links.push({ label, href: element.href });
    } else if (element.role === "button" || element.role === "tab" || element.role === "menuitem") {
      buttons.push(label);
    }
  }
  return {
    path: snapshot.path,
    title: snapshot.title,
    headings: snapshot.headings.slice(0, 10),
    links: links.slice(0, 60),
    buttons: Array.from(new Set(buttons)).slice(0, 40),
  };
}

export function startLearning(api: ApiClient, host: Element): () => void {
  const sent = sentRoutes();
  let running = false;

  const run = async () => {
    // Read the click before settling: the user may click again meanwhile.
    const click = takeClick();
    const to = normalizePath(location.pathname);
    if (click && click.from !== to && isLearnableLabel(click.label)) {
      const key = `nav|${click.from}|${click.label}|${to}`;
      if (!sent.has(key)) {
        sent.add(key);
        remember(sent);
        // Stored as a link on the page the click came from.
        void api.sendOutline({ path: click.from, title: "", headings: [], links: [{ label: click.label, href: to }], buttons: [] }).catch(() => {});
      }
    }
    if (running) return;
    running = true;
    try {
      await waitForSettle({ quietMs: 800, maxMs: 6000, ignore: host });
      await idle();
      // A dialog or open menu isn't the page's normal layout.
      const outline = buildOutline(host);
      if (sent.has(outline.path) || document.querySelector("dialog[open]")) return;
      sent.add(outline.path);
      remember(sent);
      await api.sendOutline(outline);
    } catch {
      // Learning is best effort and never surfaces errors on the page.
    } finally {
      running = false;
    }
  };

  const onClick = (event: Event) => {
    try {
      recordClick(event, host);
    } catch {
      // Never let learning surface errors on the page.
    }
  };
  document.addEventListener("click", onClick, { capture: true, passive: true });
  void run();
  const stopNavigate = onNavigate(() => void run());
  return () => {
    stopNavigate();
    document.removeEventListener("click", onClick, { capture: true });
  };
}
