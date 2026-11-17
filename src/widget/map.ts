import { MAPPING_PASS } from "../shared/mapping.ts";
import { isBlocked } from "../shared/corrections.ts";
import { isLearnableLabel, normalizePath, type MapReport, type PageNode, type PageOpening, type SnapElement } from "../shared/types.ts";
import { settle } from "./guide.ts";
import { lower, plainFetch, raise } from "./guard.ts";
import { MAP_KEY, type MappingParts } from "./map-pass.ts";
import { takeSnapshot, type PageSnapshot } from "./snapshot.ts";

// Mapping an app from a signed-in browser at the company.
//
// The reader at signup cannot sign in, so it never sees the product itself.
// Someone at the company can show it: they press "Start mapping" in the
// dashboard, their app opens in a new tab with a pass in the address, and the
// widget in that tab goes through the app by itself. On each page it notes
// the labels, presses each button, tab and menu to see what it shows, notes
// that, closes it, and moves on to the next page. The result is the graph of
// the product as a signed-in person sees it: which page a link or a button
// leads to, and what sits behind each menu, tab and dialog.
//
// It never starts by itself. The pass only makes a panel appear, and nothing
// is pressed until the person presses Start in that tab.
//
// What it will not press: anything in a form, anything in a table's cells,
// anything inside what it just opened, switches and checkboxes, and any
// control whose words say it saves, sends, deletes, pays or signs out. While
// it presses a button, the guard (guard.ts) stops the page sending anything
// but a read. It never types. Labels only are kept, as everywhere else.
//
// Everything is kept in sessionStorage, so it carries on across page loads in
// this tab and is gone when the tab closes.
//
// This is not part of widget.js. The widget fetches it as /map.js only in a
// tab that holds a pass (map-pass.ts).

const KEY = MAP_KEY;
/** Pages mapped in one run. */
const MAX_PAGES = 40;
/** Controls pressed on one page. */
const MAX_PRESSES = 24;
/** Page loads in one run, so a site that sends it in circles still ends. */
const MAX_LOADS = 220;
/** A new page this soon after a press is credited to that press. */
const PRESS_WINDOW_MS = 20_000;
const MAX_LINKS = 60;
const MAX_BUTTONS = 40;
const MAX_FIELDS = 30;
const MAX_OPENINGS = 16;

const CELL = 'td, [role="cell"], [role="gridcell"]';
const BUTTON_ROLES = new Set(["button", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option"]);
const FIELD_ROLES = new Set(["textbox", "searchbox", "combobox", "select", "spinbutton", "slider", "checkbox", "radio", "switch", "file-upload"]);

/** Never pressed and never followed, whatever else is true of the control. */
const NEVER = /\b(sign\s?out|log\s?out|logout|signout|delete|remove|destroy|erase|pay|purchase|buy|checkout|impersonate)\b/i;
/**
 * Not pressed unless the control itself says it only opens something (a menu,
 * a popup, a tab). "Export" that opens a menu of formats is worth knowing.
 * "Export" that starts an export is not worth the risk.
 */
const RISKY =
  /\b(save|send|submit|apply|confirm|approve|reject|decline|accept|publish|unpublish|post|share|invite|subscribe|unsubscribe|upgrade|downgrade|cancel|archive|trash|discard|disconnect|connect|revoke|reset|restore|transfer|refund|charge|activate|deactivate|enable|disable|leave|merge|deploy|run|start|stop|restart|pause|resume|import|export|download|upload|duplicate|clone|copy|sync|refresh|generate|regenerate|resend|verify|print|call|book|install|uninstall|block|ban|suspend|mark|turn (on|off)|switch (account|workspace|team|organi[sz]ation))\b/i;
/** A link whose address says it does something rather than shows something. */
const RISKY_PATH = /(log|sign)[-_]?out|delete|remove|destroy|unsubscribe|impersonate|disconnect|revoke|export|download|oauth|\/auth\//i;
/** A dialog's own ways out that choose nothing. Not "OK" or "Done", which can mean yes. */
const CLOSERS = /^(cancel|close|dismiss|not now|no,? thanks|back|got it|skip)$/i;

interface Press {
  /** The page it was pressed on, as a normalized path and as an address to come back to. */
  from: string;
  url: string;
  key: string;
  label: string;
  at: number;
}

interface MapState {
  pass: string;
  status: "ready" | "running" | "paused" | "done";
  /** Addresses still to visit, each a path with its query. */
  todo: string[];
  /** Normalized paths that are finished. */
  done: string[];
  /** Normalized paths already opened from the list, so one that sends us elsewhere is not opened again and again. */
  asked: string[];
  /** For each path, the controls already pressed there. Written before each press, so a press that loads a new page is not made twice. */
  tried: Record<string, string[]>;
  /** The page being worked on, as found so far. */
  page?: PageNode;
  /** The press just made, in case a new page follows it. */
  press?: Press;
  /** What a control did the last times it was pressed, by its name. The same result twice is taken as known, so the top bar's menus are not opened on every page. */
  memo: Record<string, { result: string; times: number }>;
  count: number;
  loads: number;
  /** Why it ended, when it didn't simply run out of pages. */
  ended?: "limit" | "refused" | "stopped";
}

function read(): MapState | undefined {
  try {
    const state = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as MapState | null;
    return state && MAPPING_PASS.test(state.pass) ? state : undefined;
  } catch {
    return undefined;
  }
}

function write(state: MapState | undefined) {
  try {
    if (state) sessionStorage.setItem(KEY, JSON.stringify(state));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Without storage, mapping can't carry on across pages. The panel says so when it stops.
  }
}

/** Shows the mapping panel, and carries on mapping if this tab was already at it. */
export async function startMapping(parts: MappingParts): Promise<void> {
  const state = read();
  if (!state) return;
  const mapper = new Mapper(parts, state);
  await mapper.begin();
}

const keyOf = (element: Pick<SnapElement, "role" | "label" | "icon">) => `${element.role} ${nameIn(element)}`;
const nameIn = (element: Pick<SnapElement, "label" | "icon">) => element.label || (element.icon ? `icon:${element.icon}` : "");
const here = () => normalizePath(location.pathname);

class Mapper {
  private readonly panel: HTMLElement;
  /** What each of the panel's buttons does, by its place in the row. */
  private actions: (() => void)[] = [];
  private busy = false;

  constructor(
    private readonly parts: MappingParts,
    private state: MapState,
  ) {
    this.panel = document.createElement("div");
    this.panel.className = "map";
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    (parts.host.shadowRoot ?? parts.host).append(style, this.panel);
    this.listen();
  }

  /**
   * The widget's element cancels a press on any button in it and puts a fresh
   * copy of the button in its place (keepPressesOurs in ui.ts), so a listener
   * on the button itself never hears it. The panel acts when a press that began
   * on one of its buttons ends there, and on a click that comes without a
   * press, from the keyboard.
   */
  private listen() {
    const buttonIn = (event: Event) => event.composedPath().find((node): node is HTMLButtonElement => node instanceof HTMLButtonElement && this.panel.contains(node));
    const act = (button: HTMLButtonElement | undefined) => button && this.actions[Number(button.dataset.index)]?.();
    let pressed: string | undefined;
    let actedAt = -Infinity;
    this.panel.addEventListener("pointerdown", (event) => (pressed = event.button === 0 ? buttonIn(event)?.dataset.index : undefined));
    this.panel.addEventListener("pointerup", (event) => {
      const button = buttonIn(event);
      const was = pressed;
      pressed = undefined;
      if (!button || was === undefined || button.dataset.index !== was) return;
      actedAt = performance.now();
      act(button);
    });
    this.panel.addEventListener("click", (event) => {
      if (performance.now() - actedAt > 500) act(buttonIn(event));
    });
  }

  async begin() {
    // Asked before anything is shown, so a made-up or used-up pass in a link shows a visitor nothing they can start.
    const good = await this.send();
    if (good === "refused") {
      write(undefined);
      return this.show("This mapping link has run out", "Start again from your Haptic dashboard.", [["Close", () => this.panel.remove()]]);
    }
    if (good === "failed") return this.show("Haptic couldn't be reached", "Check your connection, then reload this page.", [["Close", () => this.panel.remove()]]);
    this.draw();
    if (this.state.status === "running") void this.run();
  }

  private save() {
    write(this.state);
  }

  /** Posts one page, or only the pass when there is none. */
  private async send(page?: PageNode): Promise<"ok" | "refused" | "failed"> {
    const body: MapReport = { site: this.parts.site, pass: this.state.pass, ...(page ? { page } : {}) };
    try {
      // text/plain needs no preflight. The page's own fetch may be guarded, so the widget uses the one from before.
      const response = await plainFetch(`${this.parts.api}/v1/map`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
      if (response.status === 403) return "refused";
      return response.ok ? "ok" : "failed";
    } catch {
      return "failed";
    }
  }

  // The panel ----------------------------------------------------------------

  private show(title: string, text: string, buttons: [string, () => void][]) {
    this.panel.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = title;
    const body = document.createElement("p");
    body.textContent = text;
    const row = document.createElement("div");
    row.className = "row";
    this.actions = buttons.map(([, onClick]) => onClick);
    buttons.forEach(([name], index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.dataset.index = String(index);
      if (index === 0) button.className = "main";
      row.append(button);
    });
    this.panel.append(heading, body, row);
  }

  private draw(doing = "") {
    const { status, count } = this.state;
    const screens = `${count} ${count === 1 ? "screen" : "screens"}`;
    if (status === "ready") {
      this.show(
        "Map this app for Haptic",
        "Haptic will go through this app by itself: it visits each page and opens menus, tabs and dialogs to see what is there. It skips anything that looks like it saves, sends, deletes or pays, and it never types. Sign in first if you aren't, and keep this tab in front.",
        [
          ["Start", () => this.resume()],
          ["Not now", () => this.end("stopped")],
        ],
      );
    } else if (status === "running") {
      this.show("Mapping this app", `${screens} so far${doing ? `. ${doing}` : "."}`, [
        ["Pause", () => this.pause()],
        ["Finish", () => this.end("stopped")],
      ]);
    } else if (status === "paused") {
      this.show("Mapping is paused", `${screens} so far. The app is yours to use until you carry on.`, [
        ["Carry on", () => this.resume()],
        ["Finish", () => this.end("stopped")],
      ]);
    } else {
      const text =
        this.state.ended === "refused"
          ? `The mapping link ran out after ${screens}. Start again from your dashboard to map the rest.`
          : count === 0
            ? "Nothing was mapped. You can start again from your Haptic dashboard."
            : `Haptic mapped ${screens}${this.state.ended === "limit" ? ", which is as many as one run takes" : ""}. You can close this tab.`;
      this.show(count ? "Mapping is done" : "Mapping stopped", text, [["Close", () => this.panel.remove()]]);
    }
  }

  private resume() {
    this.state.status = "running";
    this.save();
    this.draw();
    void this.run();
  }

  private pause() {
    this.state.status = "paused";
    this.save();
    this.draw();
  }

  private end(why: MapState["ended"]) {
    const page = this.state.page;
    this.state = { ...this.state, status: "done", ended: why, todo: [], page: undefined, press: undefined };
    this.draw();
    // Kept only as long as it takes to say so. The pass is of no more use in this tab.
    write(undefined);
    if (page && why !== "refused") void this.send(page);
  }

  // Going through the app ------------------------------------------------------

  private async run() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.work();
    } catch (error) {
      console.warn("[Haptic]", error);
      this.pause();
    } finally {
      this.busy = false;
    }
  }

  private running() {
    return this.state.status === "running";
  }

  private async work() {
    const { host } = this.parts;
    await settle(host, { quietMs: 500, maxMs: 6000, patient: false });
    if (!this.running()) return;
    const path = here();
    const state = this.state;

    // A press on the last page that brought us here is a way from there to here.
    const press = state.press;
    state.press = undefined;
    if (press && press.from !== path && Date.now() - press.at < PRESS_WINDOW_MS) {
      if (state.page?.path === press.from) addLink(state.page, press.label, path);
      this.remember(press.key, `to ${path}`);
      // That page isn't finished. It is next, once this one is.
      if (!state.done.includes(press.from) && !state.todo.includes(press.url)) state.todo.unshift(press.url);
    }
    // What was found on the page just left goes up before this one is begun.
    if (state.page && state.page.path !== path) {
      if (!(await this.sent(state.page))) return;
      state.page = undefined;
    }
    this.save();
    if (state.done.includes(path)) return this.next();

    let snap = takeSnapshot(host);
    // A dialog the app opened by itself, like a welcome. It is closed so the page under it can be read.
    if (snap.snapshot.dialog !== undefined) {
      await this.closeDialog();
      snap = takeSnapshot(host);
    }
    if (snap.snapshot.dialog === undefined) {
      const found = outline(snap);
      state.page = state.page ? mergePage(state.page, found.page) : found.page;
      this.queue(found.urls);
      this.save();
    } else if (!state.page) {
      state.page = { path, title: "", headings: [], links: [], buttons: [], fields: [] };
    }

    const tried = (state.tried[path] ??= []);
    for (;;) {
      if (!this.running()) return;
      if (here() !== path) {
        // The address changed without a press of ours: the page sent us on, or the person clicked.
        // This page is taken as finished with what was found, so it can't be come back to forever.
        this.finished(path);
        return this.reload();
      }
      const now = takeSnapshot(host);
      if (now.snapshot.dialog !== undefined) {
        if (!(await this.closeDialog())) return this.reload();
        continue;
      }
      const candidate = tried.length < MAX_PRESSES ? this.pressable(now).find(({ element }) => !tried.includes(keyOf(element))) : undefined;
      if (!candidate) break;
      const key = keyOf(candidate.element);
      const name = nameIn(candidate.element);
      tried.push(key);

      // The same control did the same thing on two pages already, so it is not pressed again.
      const known = state.memo[key];
      if (known && known.times >= 2) {
        this.apply(known.result, name);
        this.save();
        continue;
      }

      state.press = { from: path, url: location.pathname + location.search, key, label: name, at: Date.now() };
      this.save();
      this.draw(`Looking at ${name}`);
      const pressed = await this.press(candidate.el, name, now);
      // The new page may have loaded with the guard up, so it is loaded afresh. The run picks up
      // there: it notes the way that led to it, and comes back to finish this page afterwards.
      if (pressed === "moved") return this.reload();
      state.press = undefined;
      this.remember(key, pressed.result);
      this.apply(pressed.result, name);
      this.queue(pressed.urls);
      this.save();
      // A dialog that would not close. A fresh load closes it, and the page carries on from the next control.
      if (pressed.stuck) return this.reload();
    }

    const page = state.page;
    state.page = undefined;
    this.finished(path);
    this.draw();
    if (page && !(await this.sent(page))) return;
    this.next();
  }

  private finished(path: string) {
    if (!this.state.done.includes(path)) {
      this.state.done.push(path);
      this.state.count++;
    }
    this.save();
  }

  /** Sends a page, and ends the run when the pass is no longer good. False when the run should not go on. */
  private async sent(page: PageNode): Promise<boolean> {
    const result = await this.send(page);
    if (result === "refused") this.end("refused");
    else if (result === "failed") this.pause();
    return result === "ok";
  }

  private reload() {
    if (++this.state.loads > MAX_LOADS) return this.end("limit");
    this.save();
    location.reload();
  }

  private next() {
    const state = this.state;
    while (state.todo.length && state.count < MAX_PAGES && state.loads < MAX_LOADS) {
      const url = state.todo.shift()!;
      const target = new URL(url, location.origin);
      const path = normalizePath(target.pathname);
      if (state.done.includes(path)) continue;
      if (!state.asked.includes(path)) state.asked.push(path);
      state.loads++;
      this.save();
      this.draw(`Opening ${target.pathname}`);
      if (target.href === location.href.split("#")[0]) location.reload();
      else location.assign(target.href);
      return;
    }
    this.end(state.todo.length ? "limit" : undefined);
  }

  private queue(urls: string[]) {
    const state = this.state;
    const waiting = new Set(state.todo.map((url) => normalizePath(new URL(url, location.origin).pathname)));
    for (const url of urls) {
      const path = normalizePath(new URL(url, location.origin).pathname);
      if (state.done.includes(path) || state.asked.includes(path) || waiting.has(path) || path === here()) continue;
      waiting.add(path);
      state.todo.push(url);
    }
  }

  private remember(key: string, result: string) {
    const known = this.state.memo[key];
    this.state.memo[key] = known && known.result === result ? { result, times: known.times + 1 } : { result, times: 1 };
  }

  /** Writes what a press did into the page: a way to another page, or what it showed. */
  private apply(result: string, name: string) {
    const page = this.state.page;
    if (!page || !result) return;
    if (result.startsWith("to ")) return addLink(page, name, result.slice(3));
    const opening = JSON.parse(result) as PageOpening;
    const opens = (page.opens ??= []);
    const at = opens.findIndex((had) => had.control === opening.control);
    if (at >= 0) opens[at] = opening;
    else if (opens.length < MAX_OPENINGS) opens.push(opening);
  }

  /** The controls on this page that may be pressed, in page order. */
  private pressable(snap: PageSnapshot): { element: SnapElement; el: Element }[] {
    const out: { element: SnapElement; el: Element }[] = [];
    for (const element of snap.snapshot.elements) {
      const el = snap.elements.get(element.id);
      if (!el || (element.role !== "button" && element.role !== "tab")) continue;
      const name = nameIn(element);
      if (!isLearnableLabel(name) || element.state?.includes("disabled")) continue;
      if (el.closest(`form, [role="form"], ${CELL}, a[href], [contenteditable=""], [contenteditable="true"]`)) continue;
      if (el instanceof HTMLButtonElement && el.type === "submit" && el.form) continue;
      if (el instanceof HTMLInputElement) continue;
      // A button that is on or off is a setting. Pressing it changes the setting.
      if (el.hasAttribute("aria-pressed") || el.hasAttribute("aria-checked") || el.getAttribute("role") === "switch") continue;
      if (NEVER.test(name)) continue;
      const opensSomething = element.role === "tab" || el.hasAttribute("aria-haspopup") || el.hasAttribute("aria-controls") || el.hasAttribute("aria-expanded") || el.tagName === "SUMMARY";
      if (RISKY.test(name) && !opensSomething) continue;
      if (isBlocked(element, this.parts.blocked)) continue;
      out.push({ element, el });
    }
    return out;
  }

  /**
   * Presses one control with the guard up, and says what came of it: "moved"
   * when the address changed, or else a result, which is an opening as JSON
   * when it showed something and empty when it didn't, with the addresses
   * found behind it. What it opened is closed again, and `stuck` says when it
   * would not close.
   */
  private async press(el: Element, name: string, before: PageSnapshot): Promise<"moved" | { result: string; urls: string[]; stuck?: true }> {
    const { host } = this.parts;
    const path = here();
    const shown = new Set(before.elements.values());
    raise();
    try {
      click(el);
      await settle(host, { quietMs: 300, maxMs: 2500, patient: false });
      if (here() !== path) return "moved";
      const after = takeSnapshot(host);
      const dialog = after.snapshot.dialog !== undefined;
      const fresh = after.snapshot.elements.filter((element) => {
        const found = after.elements.get(element.id);
        return found && (dialog || (!shown.has(found) && found !== el && !el.contains(found)));
      });
      const { opening, urls } = openingFrom(name, fresh, after, dialog);
      const result = opening ? JSON.stringify(opening) : "";
      if (dialog) {
        if (!(await this.closeDialog())) return { result, urls, stuck: true };
      } else if (fresh.length && el.getAttribute("role") !== "tab" && el.isConnected) {
        // A menu or panel is closed the way it was opened, or with Escape.
        if (el.getAttribute("aria-expanded") === "true" || (el.tagName === "SUMMARY" && (el.parentElement as HTMLDetailsElement | null)?.open)) click(el);
        else escape();
        await settle(host, { quietMs: 200, maxMs: 1200, patient: false });
      }
      return { result, urls };
    } finally {
      await lower();
    }
  }

  /** Closes the open dialog without choosing anything in it. False when it would not close. */
  private async closeDialog(): Promise<boolean> {
    const { host } = this.parts;
    const open = () => takeSnapshot(host);
    raise();
    try {
      escape();
      await settle(host, { quietMs: 200, maxMs: 1200, patient: false });
      let snap = open();
      if (snap.snapshot.dialog === undefined) return true;
      // Its own way out: Cancel, Close, or the cross in its corner.
      const closer = snap.snapshot.elements.find((element) => element.role === "button" && (CLOSERS.test(element.label) || /^(x|close|cross|x-mark|xmark|times)$/.test(element.icon ?? "")));
      const el = closer && snap.elements.get(closer.id);
      if (el) {
        click(el);
        await settle(host, { quietMs: 200, maxMs: 1200, patient: false });
        snap = open();
        if (snap.snapshot.dialog === undefined) return true;
      }
      for (const dialog of Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"))) if (!host.contains(dialog)) dialog.close();
      await settle(host, { quietMs: 200, maxMs: 800, patient: false });
      return open().snapshot.dialog === undefined;
    } finally {
      await lower(200);
    }
  }
}

/** A click as a person makes it. Some menus open on the press, not the release, so the whole of it is sent. */
function click(el: Element) {
  (el as HTMLElement).scrollIntoView?.({ block: "center", inline: "nearest" });
  const rect = el.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  const pointer = (type: string) => typeof PointerEvent === "function" && el.dispatchEvent(new PointerEvent(type, { ...at, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  pointer("pointerdown");
  el.dispatchEvent(new MouseEvent("mousedown", at));
  pointer("pointerup");
  el.dispatchEvent(new MouseEvent("mouseup", at));
  (el as HTMLElement).click();
}

function escape() {
  const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
  for (const type of ["keydown", "keyup"]) target.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true, composed: true }));
}

function addLink(page: PageNode, label: string, to: string) {
  if (!isLearnableLabel(label) || page.links.length >= MAX_LINKS || to === page.path) return;
  if (!page.links.some((link) => link.label === label && link.to === to)) page.links.push({ label, to });
}

function mergePage(known: PageNode, found: PageNode): PageNode {
  const union = (a: string[], b: string[], max: number) => [...new Set([...a, ...b])].slice(0, max);
  const links = [...known.links];
  for (const link of found.links) if (links.length < MAX_LINKS && !links.some((had) => had.label === link.label && had.to === link.to)) links.push(link);
  return { ...known, title: known.title || found.title, headings: known.headings.length ? known.headings : found.headings, links, buttons: union(known.buttons, found.buttons, MAX_BUTTONS), fields: union(known.fields, found.fields, MAX_FIELDS) };
}

/** Where a link really leads, when it stays on this site and is safe to open. The snapshot has only its normalized path. */
function followable(el: Element, label: string): string | undefined {
  const anchor = el.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement) || anchor.origin !== location.origin) return undefined;
  if (anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return undefined;
  if (NEVER.test(label) || RISKY_PATH.test(anchor.pathname + anchor.search)) return undefined;
  return anchor.pathname + anchor.search;
}

/** Sorts listed controls into links, buttons and fields, by label. Nothing in a table's cells, and no label with someone's details in it. */
function sort(elements: SnapElement[], snap: PageSnapshot) {
  const links: { label: string; to: string }[] = [];
  const buttons = new Set<string>();
  const fields = new Set<string>();
  const urls: string[] = [];
  for (const element of elements) {
    const el = snap.elements.get(element.id);
    if (!el || el.closest(CELL)) continue;
    const label = nameIn(element);
    if (!isLearnableLabel(label)) continue;
    // Anything with an address is a link, whatever it calls itself: a menu's items are often links with the role menuitem.
    if (element.href && !element.href.startsWith("external:")) {
      if (links.length < MAX_LINKS && !links.some((link) => link.label === label && link.to === element.href)) links.push({ label, to: element.href });
      const url = followable(el, label);
      if (url) urls.push(url);
    } else if (element.href) continue;
    else if (BUTTON_ROLES.has(element.role)) buttons.add(label);
    else if (FIELD_ROLES.has(element.role)) fields.add(label);
  }
  return { links, buttons: [...buttons], fields: [...fields], urls };
}

/** The page as it stands, and the addresses its links lead to. */
function outline(snap: PageSnapshot): { page: PageNode; urls: string[] } {
  const { links, buttons, fields, urls } = sort(snap.snapshot.elements, snap);
  const title = snap.snapshot.title;
  return {
    page: {
      path: snap.snapshot.path,
      title: isLearnableLabel(title) ? title : "",
      headings: snap.snapshot.headings.filter(isLearnableLabel).slice(0, 12),
      links,
      buttons: buttons.slice(0, MAX_BUTTONS),
      fields: fields.slice(0, MAX_FIELDS),
    },
    urls,
  };
}

/** What a press showed, as an opening behind the control that was pressed. Nothing when it showed no control worth naming. */
function openingFrom(control: string, fresh: SnapElement[], snap: PageSnapshot, dialog: boolean): { opening?: PageOpening; urls: string[] } {
  const { links, buttons, fields, urls } = sort(fresh, snap);
  if (!links.length && !buttons.length && !(dialog && fields.length)) return { urls: [] };
  const opening: PageOpening = { control, links: links.slice(0, 30), buttons: buttons.slice(0, 20) };
  // A dialog's fields say what it asks for: "New project" wants a name and a template.
  if (dialog && fields.length) opening.fields = fields.slice(0, 20);
  return { opening, urls };
}

const PANEL_CSS = `
.map { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); width: min(420px, calc(100vw - 24px)); box-sizing: border-box;
  pointer-events: auto; background: #fff; color: #111; border: 1px solid rgba(0,0,0,.12); border-radius: 14px; padding: 14px 16px;
  box-shadow: 0 8px 30px rgba(0,0,0,.16); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; display: flex; flex-direction: column; gap: 8px; }
.map strong { font-size: 15px; font-weight: 600; }
.map p { margin: 0; color: #555; }
.map .row { display: flex; gap: 8px; justify-content: flex-end; }
.map button { font: inherit; font-weight: 500; height: 32px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(0,0,0,.14); background: #fff; color: #111; cursor: pointer; }
.map button.main { background: var(--accent); border-color: var(--accent); color: #fff; }
.map button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-color-scheme: dark) {
  .map { background: #1c1c1e; color: #f2f2f2; border-color: rgba(255,255,255,.16); }
  .map p { color: #b5b5b5; }
  .map button { background: #1c1c1e; color: #f2f2f2; border-color: rgba(255,255,255,.2); }
}
`;
