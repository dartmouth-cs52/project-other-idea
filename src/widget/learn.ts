import { isLearnableLabel, normalizePath, type OutlineReport, type PageOutline } from "../shared/types.ts";
import { settle } from "./guide.ts";
import { onAddressChange } from "./navigation.ts";
import { nameOf, takeSnapshot } from "./snapshot.ts";

// Learning the site from real visits. The crawl builds the first map of a
// site, but it can't sign in, and it can't open what only a click reveals.
// So once per page per tab, when the page has settled and the browser is idle,
// the widget sends an outline of it: the title, headings, link and button
// labels. And when a click is followed by a new page within a few seconds, it
// sends the clicked label as a link on the page it came from, like
// "View, in a dialog → /set/:id", which is how Haptic learns a page that is
// only reachable through a dialog. And when a visitor opens a menu, a tab or
// an accordion, it sends what appeared, with the label of the control that
// opened it, so the model knows what is behind "Help" before anyone opens it.
//
// Labels only. Nothing typed into a field is ever read, controls inside a
// table's cells are left out, and emails and numbers are masked. The server
// counts each label by distinct visitor, and a label reaches the prompt only
// once several have seen it, which keeps one person's own data out of it.

const SENT_KEY = "haptic.outlines";
const CLICK_KEY = "haptic.lastClick";
const VISITOR_KEY = "haptic.visitor";
/** A new page this soon after a click is credited to that click. */
const CLICK_WINDOW_MS = 8000;
const MAX_LINKS = 60;
const MAX_BUTTONS = 40;
const CLICKABLE = 'a[href], button, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"]';
/** A table's cells hold the customer's records, like their clients' names. Nothing in them is learned. */
const CELL = 'td, [role="cell"], [role="gridcell"]';
const BUTTON_ROLES = new Set(["button", "tab", "menuitem", "menuitemcheckbox", "menuitemradio"]);
/** Controls that show something when opened. Menus often open on the press, before the click, so it is watched from there. */
const OPENER = '[aria-haspopup]:not([aria-haspopup="false"]), [aria-expanded="false"], [role="tab"], summary';
const FIELDISH = 'input, textarea, select, [role="combobox"], [role="searchbox"], [role="textbox"], [contenteditable]:not([contenteditable="false"])';
/** More new controls than this after opening something means the whole view changed, not that something opened. */
const MAX_OPENED = 40;
const MAX_OPENED_SENT = 30;
/** When to look after a press, each wait after the one before: about 1.5 s in all. */
const LOOKS_MS = [120, 180, 300, 400, 500];

/** The labels of the links and buttons on screen now, dialog included, outside table cells. */
function shownNow(host: Element): { links: Map<string, { label: string; to: string }>; buttons: Set<string> } {
  const { snapshot, elements } = takeSnapshot(host);
  const links = new Map<string, { label: string; to: string }>();
  const buttons = new Set<string>();
  for (const element of snapshot.elements) {
    if (elements.get(element.id)?.closest(CELL)) continue;
    const label = element.label || (element.icon ? `icon:${element.icon}` : "");
    if (!isLearnableLabel(label)) continue;
    // A menu item can be a link too, like <a role="menuitem" href="/help">. Where it leads is what matters.
    if (element.href && !element.href.startsWith("external:")) links.set(`${label} ${element.href}`, { label, to: element.href });
    else if (BUTTON_ROLES.has(element.role)) buttons.add(label);
  }
  return { links, buttons };
}

interface LastClick {
  from: string;
  label: string;
  at: number;
  /** Where the control says it leads, when it is a link. Such a link is in the page's outline already. */
  href?: string;
}

/** A random id kept in this site's localStorage. The server keeps only a hash of it, made per site, to count how many people saw a label. */
export function visitorId(): string | undefined {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
      id = randomId();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    // Storage blocked. Without an id this visitor can't be counted once, so the server doesn't use what they send.
    return undefined;
  }
}

function randomId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The outline of the page as it is now, or nothing while a dialog is open, since that isn't the page's own layout. */
export function buildOutline(host: Element): PageOutline | undefined {
  const { snapshot, elements } = takeSnapshot(host);
  if (snapshot.dialog !== undefined) return undefined;
  const links: PageOutline["links"] = [];
  const buttons = new Set<string>();
  for (const element of snapshot.elements) {
    if (elements.get(element.id)?.closest(CELL)) continue;
    // An icon-only button is often the one people can't find, like Share.
    const label = element.label || (element.icon ? `icon:${element.icon}` : "");
    if (!isLearnableLabel(label)) continue;
    if (element.role === "link" && element.href && !element.href.startsWith("external:")) {
      if (links.length < MAX_LINKS && !links.some((link) => link.label === label && link.to === element.href)) links.push({ label, to: element.href });
    } else if (BUTTON_ROLES.has(element.role) && buttons.size < MAX_BUTTONS) buttons.add(label);
  }
  return {
    path: snapshot.path,
    title: isLearnableLabel(snapshot.title) ? snapshot.title : "",
    headings: snapshot.headings.filter(isLearnableLabel).slice(0, 12),
    links,
    buttons: [...buttons],
  };
}

/** Starts learning on this page. `send` posts one outline. Returns a function that stops it. */
export function startLearning(send: (report: Omit<OutlineReport, "site">) => void, host: Element): () => void {
  const visitor = visitorId();
  const sent = sentKeys();
  // Without an id the server can't count this visitor, so there is nothing worth sending.
  if (!visitor) return () => {};
  const post = (outline: PageOutline) => send({ visitor, outline });
  let running = false;
  let again = false;

  const run = async () => {
    // The click is taken before waiting, since the visitor may click again meanwhile.
    const click = takeClick();
    const here = normalizePath(location.pathname);
    if (click && click.from !== here && click.href !== here) {
      const key = `${click.from} ${click.label} ${here}`;
      if (!sent.has(key)) {
        remember(sent, key);
        post({ path: click.from, title: "", headings: [], links: [{ label: click.label, to: here }], buttons: [] });
      }
    }
    if (running) return void (again = true);
    running = true;
    try {
      do {
        again = false;
        await settle(host, { quietMs: 800, maxMs: 6000, patient: false });
        await idle();
        const outline = buildOutline(host);
        if (!outline || sent.has(outline.path)) continue;
        remember(sent, outline.path);
        post(outline);
      } while (again);
    } catch (error) {
      console.warn("[Haptic]", error);
    } finally {
      running = false;
    }
  };

  const onClick = (event: Event) => {
    try {
      recordClick(event, host);
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  };

  // Opening a menu, tab or accordion: what was on screen as it was pressed, against what shows up after.
  // Some people pick from a menu within a few hundred milliseconds, so it is looked at several times
  // until the next press, and whatever appeared in any look counts.
  let presses = 0;
  const onPress = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown") return;
    const pressed = ++presses;
    try {
      const control = openerOf(event, host);
      if (!control) return;
      const from = normalizePath(location.pathname);
      const key = `${from} opens ${control.name}`;
      if (sent.has(key)) return;
      const before = shownNow(host);
      const links = new Map<string, { label: string; to: string }>();
      const buttons = new Set<string>();
      void (async () => {
        for (const wait of LOOKS_MS) {
          await new Promise((resolve) => setTimeout(resolve, wait));
          if (presses !== pressed || normalizePath(location.pathname) !== from) break;
          const after = shownNow(host);
          for (const [id, link] of after.links) if (!before.links.has(id)) links.set(id, link);
          for (const label of after.buttons) if (!before.buttons.has(label) && label !== control.name) buttons.add(label);
        }
        if (!links.size && !buttons.size) return;
        if (links.size + buttons.size > MAX_OPENED || sent.has(key)) return;
        remember(sent, key);
        post({
          path: from,
          title: "",
          headings: [],
          links: [],
          buttons: [],
          opens: [{ control: control.name, links: [...links.values()].slice(0, MAX_OPENED_SENT), buttons: [...buttons].slice(0, MAX_OPENED_SENT) }],
        });
      })().catch((error) => console.warn("[Haptic]", error));
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  };

  document.addEventListener("click", onClick, { capture: true, passive: true });
  document.addEventListener("pointerdown", onPress, { capture: true, passive: true });
  document.addEventListener("keydown", onPress, { capture: true, passive: true });
  const stopAddress = onAddressChange(() => void run());
  void run();
  return () => {
    stopAddress();
    document.removeEventListener("click", onClick, { capture: true });
    document.removeEventListener("pointerdown", onPress, { capture: true });
    document.removeEventListener("keydown", onPress, { capture: true });
  };
}

/** The control a press is about to open, with the name it is learned by, or nothing for any other press. */
function openerOf(event: Event, host: Element): { name: string } | undefined {
  for (const node of event.composedPath()) {
    if (node === host) return undefined;
    if (!(node instanceof Element)) continue;
    if (!node.matches(OPENER)) {
      if (node.matches(CLICKABLE)) return undefined;
      continue;
    }
    // A field's suggestions follow what was typed into it, so nothing a field opens is learned.
    if (node.closest(CELL) || node.matches(FIELDISH)) return undefined;
    const { label, icon } = nameOf(node);
    const name = label || (icon ? `icon:${icon}` : "");
    return isLearnableLabel(name) ? { name } : undefined;
  }
  return undefined;
}

/**
 * Notes the label of the control just clicked, with where it was, so that a
 * new page straight after it teaches Haptic the way there. It is kept in
 * sessionStorage, so a click that loads a whole new page counts too.
 */
function recordClick(event: Event, host: Element) {
  for (const node of event.composedPath()) {
    if (node === host) return;
    if (!(node instanceof Element) || !node.matches(CLICKABLE)) continue;
    if (node.closest(CELL)) return;
    const { label, icon } = nameOf(node);
    const name = label || (icon ? `icon:${icon}` : "");
    if (!isLearnableLabel(name)) return;
    const inDialog = node.closest('dialog, [role="dialog"], [role="alertdialog"]') !== null;
    const inMenu = !inDialog && node.closest('[role="menu"], [role="listbox"]') !== null;
    const click: LastClick = { from: normalizePath(location.pathname), label: `${name}${inDialog ? ", in a dialog" : inMenu ? ", in a menu" : ""}`, at: Date.now() };
    if (node instanceof HTMLAnchorElement && node.origin === location.origin) click.href = normalizePath(node.pathname);
    try {
      sessionStorage.setItem(CLICK_KEY, JSON.stringify(click));
    } catch {
      // Without storage this way there isn't learned. Nothing else depends on it.
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

function sentKeys(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SENT_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function remember(sent: Set<string>, key: string) {
  sent.add(key);
  try {
    sessionStorage.setItem(SENT_KEY, JSON.stringify([...sent].slice(-400)));
  } catch {
    // A page may be sent twice in this tab. The server counts a visitor once per label anyway.
  }
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(() => resolve(), { timeout: 1000 });
    else setTimeout(resolve, 200);
  });
}
