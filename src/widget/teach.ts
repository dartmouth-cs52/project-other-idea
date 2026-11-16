import { MAX_TAUGHT_STEPS, newTeachToken, sectionOf, stepText, TEACH_FRAGMENT, TEACH_TOKEN, type TaughtStep } from "../shared/teach.ts";
import { cleanText, type SnapElement } from "../shared/types.ts";
import { currentPath, nameOf, shownWords, takeSnapshot, type PageSnapshot } from "./snapshot.ts";
import { adoptStyles, make, topModal } from "./ui.ts";

// Teach mode (src/shared/teach.ts). Someone at the company pressed "Teach
// Haptic" in the dashboard, which opened this app with a token in the
// address's fragment. The widget takes the token out of the address bar at
// once, checks it with the widget server, and only for a valid, unexpired,
// unused token of this site, on an address the site allows, shows a bar
// across the page and records which controls the person uses.
//
// A step is the control as the page reading names it (its kind, its label and
// the section it sits in, masked as the outline is), the page as a path with
// ids masked, and what was done with it: pressed, chose X in a list, typed in
// field F. What is typed is never read. Teach mode never acts on the page,
// never asks the model anything, and starts no guide. The steps are kept for
// this tab in sessionStorage, so they survive page loads and route changes,
// until the server has them. A token that cannot be used says so on the page.

const KEY = "haptic.teach";
/** A press is read when the pointer goes down, before the page reacts to it. The click that follows within this long uses that reading. */
const DOWN_FRESH_MS = 1500;
/** How often the bar checks it is above the page's own modal dialog, outside which it could not be pressed. */
const PLACE_MS = 400;
/** How long the bar stays once the steps are sent. */
const SENT_SHOWN_MS = 8000;

/** The parts of a table or grid whose rows hold the company's records. A control in one is named only if every row has it, like Edit. */
const ROW = 'tr, [role="row"]';
const TABLE = 'table, [role="table"], [role="grid"], [role="treegrid"]';
const HEADER_CELL = 'th, [role="columnheader"], [role="rowheader"]';
/** What a click lands on that is a control, when the page reading did not list it. */
const CLICKABLE = 'a[href], button, summary, input:not([type="hidden"]), [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"]';
/** Fields typed into, whose clicks only put the cursor there. Their step is the typing. */
const TYPED_ROLES = new Set(["textbox", "searchbox", "spinbutton", "slider"]);
const TICKED_ROLES = new Set(["checkbox", "switch", "menuitemcheckbox"]);

/** A tab's teaching, as kept in sessionStorage. The token and the claim are the only way to the session. */
interface Teaching {
  token: string;
  claim: string;
  question: string;
  expiresAt: string;
  steps: TaughtStep[];
  /** Where the bar sits. */
  top?: boolean;
}

/** One call to the widget server, sent as text/plain so it needs no preflight. */
async function call(api: string, path: string, body: object): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const response = await fetch(`${api}${path}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok === true, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

/**
 * The teach token in the address's fragment, `#haptic-teach=<token>`, taken out
 * of the address bar straight away so it is not bookmarked, shared or left in
 * the tab's history. The rest of the fragment is kept.
 */
export function takeTeachToken(): string | undefined {
  const hash = location.hash.replace(/^#/, "");
  const parts = hash.split("&");
  const found = parts.find((part) => part.startsWith(`${TEACH_FRAGMENT}=`));
  if (found === undefined) return undefined;
  const rest = parts.filter((part) => part !== found).join("&");
  try {
    history.replaceState(history.state, "", location.pathname + location.search + (rest ? `#${rest}` : ""));
  } catch {
    // The address could not be changed. The token is single use, so it is spent once claimed all the same.
  }
  const token = found.slice(TEACH_FRAGMENT.length + 1);
  // Something is always returned, so a link cut short in an email says it is broken rather than nothing happening.
  return token;
}

function readTeaching(): Teaching | undefined {
  try {
    const held = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Teaching | null;
    return held && TEACH_TOKEN.test(held.token) && TEACH_TOKEN.test(held.claim) && Array.isArray(held.steps) ? held : undefined;
  } catch {
    return undefined;
  }
}

function keep(teaching: Teaching): boolean {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(teaching));
    return true;
  } catch {
    return false;
  }
}

function forget() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}

/**
 * Starts teach mode in this tab when it should: from a token just taken from
 * the address (`fresh`), or from a session this tab already claimed, after a
 * page load. True when it started, and then the widget starts no guide. A
 * token that cannot be used shows a notice on the page saying why.
 */
export async function startTeaching(api: string, site: string, fresh: string | undefined, accent: string): Promise<boolean> {
  let held = readTeaching();
  if (fresh !== undefined) {
    if (held?.token === fresh) {
      // The same link opened again in this tab, as a reload of the first address does: carry on.
    } else {
      const claim = newTeachToken();
      const answer = TEACH_TOKEN.test(fresh) ? await call(api, "/v1/teach/claim", { site, token: fresh, claim }) : undefined;
      if (answer?.ok && typeof answer.data.question === "string") {
        const claimed: Teaching = { token: fresh, claim, question: answer.data.question, expiresAt: String(answer.data.expiresAt ?? ""), steps: [] };
        keep(claimed);
        // Just claimed, so there is nothing to check.
        new Teacher(api, site, claimed, accent).start();
        return true;
      } else {
        const message = refusal(answer);
        console.warn(`[Haptic] ${message}`);
        showNotice(message, accent);
        // A session this tab already had is not lost to a bad link.
        if (!held) return false;
      }
    }
  }
  if (!held) return false;
  const answer = await call(api, "/v1/teach/check", { site, token: held.token, claim: held.claim });
  if (!answer.ok) {
    if (answer.status === 0 || answer.status >= 500 || answer.status === 429) {
      // The server could not be asked. The steps are kept, and the bar says so, so nothing is lost or silently dropped.
      new Teacher(api, site, held, accent, "Haptic's server couldn't be reached to check this teaching session. Your steps are kept.").start();
      return true;
    }
    forget();
    const message = refusal(answer);
    console.warn(`[Haptic] ${message}`);
    showNotice(message, accent);
    return false;
  }
  new Teacher(api, site, held, accent).start();
  return true;
}

/** What a refused token means, in the person's words. */
function refusal(answer: { status: number; data: Record<string, unknown> } | undefined): string {
  if (!answer) return "This teaching link is incomplete. Start again from your Haptic dashboard.";
  const why = answer.data.refused;
  if (why === "expired") return "This teaching link has expired. Start again from your Haptic dashboard.";
  if (why === "used") return "This teaching link has already been used. Start again from your Haptic dashboard.";
  if (why === "unknown") return "This teaching link isn't valid for this site. Start again from your Haptic dashboard.";
  if (why === "closed") return "This teaching session was closed. Start again from your Haptic dashboard.";
  if (answer.status === 403) return "Haptic can't teach on this address, because the site doesn't allow it. Add it under allowed addresses in your Haptic dashboard.";
  if (answer.status === 429) return "Too many tries with teaching links. Wait a minute, then start again from your Haptic dashboard.";
  if (answer.status === 0) return "Haptic's server couldn't be reached to check this teaching link. Reload the page to try again.";
  return "This teaching link couldn't be checked. Start again from your Haptic dashboard.";
}

const NOTICE_CSS = `
:host { all: initial; position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 2147483647; margin: 0; padding: 0; border: 0;
  background: transparent; overflow: visible; font: 14px/20px system-ui, -apple-system, "Segoe UI", sans-serif; color: #fafaf9; }
* { box-sizing: border-box; }
.notice { display: flex; align-items: center; gap: 12px; width: min(560px, calc(100vw - 32px)); padding: 12px 12px 12px 16px; border-radius: 14px;
  background: #1c1917; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
.notice p { flex: 1; margin: 0; }
button { font: inherit; cursor: pointer; flex: none; height: 32px; border: 1px solid #44403c; border-radius: 999px; padding: 0 14px; background: transparent; color: #fafaf9; }
`;

/** A short notice on the page that a teaching link could not be used, with a way to close it. Never silent. */
export function showNotice(message: string, accent: string) {
  const host = document.createElement("haptic-teach-notice");
  host.style.setProperty("--accent", accent);
  const root = host.attachShadow({ mode: "open" });
  adoptStyles(root, NOTICE_CSS);
  const close = make("button", { type: "button" }, "Close");
  root.append(make("div", { class: "notice", role: "alert" }, make("p", {}, message), close));
  close.addEventListener("click", () => host.remove());
  document.documentElement.appendChild(host);
  raise(host);
}

/** Puts our element in the top layer, above anything the page stacks, when the browser can. */
function raise(host: HTMLElement) {
  try {
    if (!host.hasAttribute("popover")) host.setAttribute("popover", "manual");
    host.showPopover();
  } catch {
    // No popover support, or shown already. The fixed position and z-index still apply.
  }
}

const BAR_CSS = `
:host { all: initial; position: fixed; left: 50%; transform: translateX(-50%); z-index: 2147483647; margin: 0; padding: 0; border: 0; inset: auto auto 16px 50%;
  background: transparent; overflow: visible; font: 14px/20px system-ui, -apple-system, "Segoe UI", sans-serif; color: #fafaf9; }
:host(.top) { inset: 16px auto auto 50%; }
* { box-sizing: border-box; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; width: min(760px, calc(100vw - 32px)); padding: 14px 14px 14px 18px;
  border-radius: 14px; background: #1c1917; box-shadow: 0 10px 30px rgba(0,0,0,.25), 0 0 0 1px rgba(255,255,255,.06); }
.words { flex: 1 1 320px; min-width: 0; }
.words p { margin: 0; }
.title { font-weight: 600; }
.title .dot { display: inline-block; width: 8px; height: 8px; margin: 0 8px 1px 0; border-radius: 999px; background: #e5484d; animation: rec 1.6s ease-in-out infinite; }
@keyframes rec { 50% { opacity: .35; } }
.how { color: #d6d3d1; font-size: 13px; line-height: 18px; }
.last { margin-top: 6px !important; color: #a8a29e; font-size: 13px; line-height: 18px; }
.last.error { color: #fca5a5; }
.buttons { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
button { font: inherit; font-size: 13px; cursor: pointer; height: 32px; border: 1px solid #44403c; border-radius: 999px; padding: 0 14px;
  background: transparent; color: #fafaf9; }
button:hover { background: #292524; }
button:disabled { opacity: .5; cursor: default; }
button.done { border-color: #fafaf9; background: #fafaf9; color: #1c1917; font-weight: 600; }
button.done:hover { background: #e7e5e4; }
button.move { width: 32px; padding: 0; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
[hidden] { display: none !important; }
@media (prefers-reduced-motion: reduce) { .title .dot { animation: none; } }
`;

/** A question as it ends a sentence: with its own mark if it has one. */
const sentence = (question: string) => (/[.?!]$/.test(question.trim()) ? question.trim() : `${question.trim()}.`);

/** Teach mode in one tab: the bar, and the recording of what the person does. */
export class Teacher {
  readonly host: HTMLElement;
  private readonly last: HTMLElement;
  private readonly buttons: HTMLElement;
  private readonly done: HTMLButtonElement;
  private readonly undo: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly move: HTMLButtonElement;
  private readonly words: HTMLElement;
  private down?: { path: EventTarget[]; at: number; reading: PageSnapshot; where: string };
  /** The element of the last step, and when, so the click a label passes on to its field is not counted twice. */
  private lastPressed?: { el: Element; at: number };
  private stopped = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly api: string,
    private readonly site: string,
    private readonly teaching: Teaching,
    accent: string,
    private readonly warning?: string,
  ) {
    this.host = document.createElement("haptic-teach");
    this.host.style.setProperty("--accent", accent);
    if (teaching.top) this.host.classList.add("top");
    const root = this.host.attachShadow({ mode: "open" });
    adoptStyles(root, BAR_CSS);
    this.last = make("p", { class: "last", "aria-live": "polite" });
    this.words = make(
      "div",
      { class: "words" },
      make("p", { class: "title" }, make("span", { class: "dot", "aria-hidden": "true" }), `Teaching Haptic: ${sentence(teaching.question)}`),
      make("p", { class: "how" }, "Do the task as a visitor would. Haptic records which controls you use, not what you type."),
      this.last,
    );
    this.done = make("button", { type: "button", class: "done" }, "Done");
    this.undo = make("button", { type: "button", class: "undo" }, "Undo last");
    this.cancel = make("button", { type: "button", class: "cancel" }, "Cancel");
    this.move = make("button", { type: "button", class: "move" }, teaching.top ? "↓" : "↑");
    this.buttons = make("div", { class: "buttons" }, this.undo, this.cancel, this.done, this.move);
    root.append(make("div", { class: "bar", role: "region", "aria-label": "Teaching Haptic" }, this.words, this.buttons));
    this.done.addEventListener("click", () => void this.send());
    this.undo.addEventListener("click", () => this.takeBack());
    this.cancel.addEventListener("click", () => void this.stop());
    this.move.addEventListener("click", () => this.toggleSide());
    // What is pressed on the bar is the bar's: the page's own "click outside" handlers are not told about it.
    for (const type of ["pointerdown", "mousedown", "click", "keydown"]) this.host.addEventListener(type, (event) => event.stopPropagation());
  }

  start() {
    this.show();
    if (this.warning) this.say(this.warning, true);
    // First, so nothing the page does to an event before it reaches the page's own handlers hides it from the recording.
    window.addEventListener("pointerdown", this.onDown, { capture: true, passive: true });
    window.addEventListener("click", this.onClick, { capture: true, passive: true });
    window.addEventListener("input", this.onInput, { capture: true, passive: true });
    window.addEventListener("change", this.onChange, { capture: true, passive: true });
    window.addEventListener("keydown", this.onKey, { capture: true, passive: true });
    this.timer = setInterval(() => this.place(), PLACE_MS);
    this.place();
  }

  private end() {
    this.stopped = true;
    window.removeEventListener("pointerdown", this.onDown, { capture: true });
    window.removeEventListener("click", this.onClick, { capture: true });
    window.removeEventListener("input", this.onInput, { capture: true });
    window.removeEventListener("change", this.onChange, { capture: true });
    window.removeEventListener("keydown", this.onKey, { capture: true });
    clearInterval(this.timer);
  }

  /** Inside the page's open modal dialog when there is one, where it can still be pressed, and in the top layer. */
  private place() {
    if (!this.host.isConnected && this.stopped) return;
    const home = topModal() ?? document.documentElement;
    if (this.host.parentNode !== home) {
      home.appendChild(this.host);
      raise(this.host);
    }
  }

  private show() {
    this.place();
    raise(this.host);
    this.render();
  }

  private toggleSide() {
    this.teaching.top = !this.teaching.top;
    this.host.classList.toggle("top", this.teaching.top);
    this.move.textContent = this.teaching.top ? "↓" : "↑";
    this.move.setAttribute("aria-label", this.teaching.top ? "Move this bar to the bottom" : "Move this bar to the top");
    keep(this.teaching);
  }

  private say(text: string, error = false) {
    this.last.textContent = text;
    this.last.classList.toggle("error", error);
    this.last.setAttribute("role", error ? "alert" : "status");
  }

  /** The count of steps and the last one, so the person sees each step land. */
  private render() {
    const steps = this.teaching.steps;
    this.undo.disabled = !steps.length;
    this.move.setAttribute("aria-label", this.teaching.top ? "Move this bar to the bottom" : "Move this bar to the top");
    if (!steps.length) return this.say("No steps yet. Start where a visitor would.");
    const latest = stepText(steps[steps.length - 1]!, steps[steps.length - 2]);
    this.say(`${steps.length} ${steps.length === 1 ? "step" : "steps"}. Last: ${latest}${/[.?!]$/.test(latest) ? "" : "."}`);
  }

  private record(step: TaughtStep, el?: Element) {
    if (this.stopped) return;
    if (this.teaching.steps.length >= MAX_TAUGHT_STEPS) {
      this.say(`That's the most steps one route can have (${MAX_TAUGHT_STEPS}). Press Done, or Undo last.`, true);
      return;
    }
    this.teaching.steps.push(step);
    if (el) this.lastPressed = { el, at: Date.now() };
    this.save();
    this.render();
  }

  /** Keeps the steps for this tab. When the browser will not keep them, the person is told, since a page load would lose them. */
  private save() {
    if (!keep(this.teaching)) this.say("This browser won't keep the steps if the page reloads. Finish without reloading, then press Done.", true);
  }

  private takeBack() {
    this.teaching.steps.pop();
    this.save();
    this.render();
  }

  private busy(on: boolean) {
    for (const button of [this.done, this.undo, this.cancel]) button.disabled = on;
    if (!on) this.undo.disabled = !this.teaching.steps.length;
  }

  /**
   * Sends the steps for the person to review in the dashboard. If that fails,
   * the steps stay in this tab and the bar says so, with Retry.
   */
  private async send() {
    if (!this.teaching.steps.length) return this.say("Do the task first, then press Done.", true);
    this.busy(true);
    this.say("Sending the steps to your Haptic dashboard…");
    const answer = await call(this.api, "/v1/teach/done", { site: this.site, token: this.teaching.token, claim: this.teaching.claim, steps: this.teaching.steps });
    this.busy(false);
    if (answer.ok) {
      this.end();
      forget();
      this.buttons.hidden = true;
      this.say(`Sent ${this.teaching.steps.length} ${this.teaching.steps.length === 1 ? "step" : "steps"}. Review them in your Haptic dashboard, then save.`);
      setTimeout(() => this.host.remove(), SENT_SHOWN_MS);
      return;
    }
    const why = typeof answer.data.error === "string" ? answer.data.error : answer.status === 0 ? "Haptic's server couldn't be reached." : `The server answered ${answer.status}.`;
    const gone = typeof answer.data.refused === "string";
    this.done.textContent = "Retry";
    if (gone) {
      // The session is over, so Retry could never work. Said plainly, and the bar stays until it is closed.
      this.end();
      forget();
      this.done.hidden = true;
      this.undo.hidden = true;
      const close = make("button", { type: "button" }, "Close");
      close.addEventListener("click", () => this.host.remove());
      this.cancel.replaceWith(close);
      return this.say(`The steps weren't sent: ${why}`, true);
    }
    this.say(`The steps weren't sent. ${why} They are kept in this tab: press Retry.`, true);
  }

  private async stop() {
    this.end();
    forget();
    this.host.remove();
    // Best effort: the session expires on its own if this does not arrive, and it can never be claimed again either way.
    await call(this.api, "/v1/teach/cancel", { site: this.site, token: this.teaching.token, claim: this.teaching.claim });
  }

  // Reading what the person does ----------------------------------------------------

  private ours(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }

  private read(): PageSnapshot {
    return takeSnapshot(this.host);
  }

  private readonly onDown = (event: Event) => {
    if (this.stopped || this.ours(event)) return;
    try {
      this.down = { path: event.composedPath(), at: Date.now(), reading: this.read(), where: currentPath() };
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  };

  private readonly onClick = (event: Event) => {
    if (this.stopped || this.ours(event)) return;
    try {
      this.pressed(event);
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  };

  /** A press, read from the page as it was when the pointer went down, or as it is now for a press made with the keyboard. */
  private pressed(event: Event) {
    const path = event.composedPath();
    const target = path[0];
    // The click lands on what the pointer went down and came up on, so the element pressed is that one or inside it.
    const pressedOn = this.down?.path[0];
    const down = this.down && Date.now() - this.down.at < DOWN_FRESH_MS && target instanceof Node && pressedOn instanceof Node && target.contains(pressedOn) ? this.down : undefined;
    this.down = undefined;
    const reading = down?.reading ?? this.read();
    const where = down?.where ?? currentPath();
    const found = controlIn(down?.path ?? path, reading);
    if (!found) return;
    const { el, listed } = found;
    // A click a label passes on to its field, straight after the label's own.
    if (this.lastPressed && Date.now() - this.lastPressed.at < 500 && this.lastPressed.el instanceof HTMLLabelElement && this.lastPressed.el.control === el) return;
    // A field's click only puts the cursor there. Its step is the typing. A native list's step is the choice, on change.
    if (TYPED_ROLES.has(listed.role) || el.tagName === "SELECT" || el.tagName === "OPTION" || (listed.role === "combobox" && isTextField(el))) return;
    if (el instanceof HTMLInputElement && ["text", "email", "search", "password", "tel", "url", "number", "date", "time", "datetime-local", "month", "week"].includes(el.type)) return;
    const base = stepFor(listed, el, reading, where);

    if (listed.role === "radio" || listed.role === "menuitemradio") {
      return this.record({ ...base, kind: "choose", role: "radio", label: groupName(el), choice: base.label || "" }, el);
    }
    if (listed.role === "option" || listed.role === "treeitem") return this.chose(el, listed, reading, where);
    if (TICKED_ROLES.has(listed.role)) {
      // Whether it is now on or off is read once the page has had its say.
      const step: TaughtStep = { ...base, kind: "check" };
      this.record(step, el);
      setTimeout(() => {
        step.kind = isOn(el) ? "check" : "uncheck";
        this.save();
        this.render();
      }, 60);
      return;
    }
    this.record({ ...base, kind: "press" }, el);
  }

  /**
   * A choice picked from a list the page draws itself. It is put in words as
   * "Choose Marketing in Department": the list is named by the field that
   * opened it, and the press that opened it, and any typing in its search
   * box, become this one step.
   */
  private chose(el: Element, listed: SnapElement, reading: PageSnapshot, where: string) {
    const choice = labelOf(listed);
    const steps = this.teaching.steps;
    // The field that opened the list: the one the reading shows open, or the press just before (and any typing to search it).
    const open = reading.snapshot.elements.find((element) => element.role === "combobox" && (element.state ?? []).includes("expanded"));
    let at = steps.length;
    while (at > 0 && steps[at - 1]!.kind === "type" && steps.length - at < 2) at--;
    const opener = steps[at - 1];
    const opened = opener && opener.kind === "press" && opener.path === where && (opener.role === "combobox" || opener.role === "button") && (!open || labelOf(open) === opener.label) ? opener : undefined;
    const list = open ? labelOf(open) : (opened?.label ?? listName(el));
    const step: TaughtStep = { kind: "choose", path: where, role: open?.role ?? opened?.role ?? "listbox", label: list, choice };
    const dialog = opened ? opened.dialog : reading.snapshot.dialog;
    if (dialog) step.dialog = dialog;
    const context = opened?.context ?? (open?.context ? sectionOf(open.context) : "");
    if (context) step.context = context;
    if (opened) steps.splice(at - 1);
    this.record(step, el);
  }

  private readonly onInput = (event: Event) => {
    if (this.stopped || this.ours(event)) return;
    try {
      const el = event.composedPath()[0];
      if (!(el instanceof Element)) return;
      if (el.tagName === "SELECT" || (el instanceof HTMLInputElement && ["checkbox", "radio", "range", "color", "file"].includes(el.type))) return;
      // One step for one field however many keys: never what the keys were.
      const latest = this.teaching.steps[this.teaching.steps.length - 1];
      if (latest?.kind === "type" && this.lastPressed?.el === el) return;
      const reading = this.read();
      const found = controlIn([el], reading);
      const listed = found?.listed ?? { id: "", role: "textbox", label: "" };
      this.record({ ...stepFor(listed, el, reading, currentPath()), kind: "type", role: TYPED_ROLES.has(listed.role) || listed.role === "combobox" ? listed.role : "textbox" }, el);
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  };

  /** A native list's choice. The choice is the page's own words for one of its options, as the page reading lists them. */
  private readonly onChange = (event: Event) => {
    if (this.stopped || this.ours(event)) return;
    try {
      const el = event.composedPath()[0];
      if (!(el instanceof HTMLSelectElement)) return;
      const reading = this.read();
      const found = controlIn([el], reading);
      const listed = found?.listed ?? { id: "", role: "select", label: "" };
      const picked = el.selectedOptions[0];
      const words = picked ? cleanText(picked.label || picked.text || "", 60) : "";
      // Only a choice the page lists for everyone, never one the reading left out.
      const choice = words && (listed.options ?? []).includes(words) ? words : "";
      const step: TaughtStep = { ...stepFor(listed, el, reading, currentPath()), kind: "choose", role: "select" };
      if (choice) step.choice = choice;
      this.record(step, el);
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  };

  /** Enter in a field: a list's choice when the field points at one, otherwise "press Enter in" it. */
  private readonly onKey = (event: Event) => {
    if (this.stopped || this.ours(event) || (event as KeyboardEvent).key !== "Enter" || (event as KeyboardEvent).isComposing) return;
    try {
      const el = event.composedPath()[0];
      if (!(el instanceof HTMLElement) || !isTextField(el) || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      const reading = this.read();
      const active = el.getAttribute("aria-activedescendant");
      const option = active ? (el.getRootNode() as Document | ShadowRoot).getElementById?.(active) : null;
      if (option) {
        const found = controlIn([option], reading);
        if (found && (found.listed.role === "option" || found.listed.role === "treeitem")) return this.chose(option, found.listed, reading, currentPath());
      }
      const found = controlIn([el], reading);
      const listed = found?.listed ?? { id: "", role: "textbox", label: "" };
      const latest = this.teaching.steps[this.teaching.steps.length - 1];
      if (latest?.kind === "enter" && this.lastPressed?.el === el) return;
      this.record({ ...stepFor(listed, el, reading, currentPath()), kind: "enter", role: listed.role || "textbox" }, el);
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  };
}

// Naming what was used ------------------------------------------------------------------

/** A listed control's name as the page outline gives it: its label, or its icon. */
function labelOf(element: Pick<SnapElement, "label" | "icon">): string {
  return element.label || (element.icon ? `icon:${element.icon}` : "");
}

/**
 * The control an event was on: the innermost listed control along its path,
 * with the reading's own name for it. A control the reading did not list, like
 * one past its limit, is named by the same rules from the element itself, and
 * a click on nothing that is a control is not a step.
 */
function controlIn(path: EventTarget[], reading: PageSnapshot): { el: Element; listed: SnapElement } | undefined {
  const byElement = new Map<Element, SnapElement>();
  for (const listed of reading.snapshot.elements) {
    const el = reading.elements.get(listed.id);
    if (el) byElement.set(el, listed);
  }
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    const listed = byElement.get(node);
    if (listed) return { el: node, listed };
  }
  for (const node of path) {
    if (!(node instanceof Element) || !node.matches(CLICKABLE)) continue;
    const { label, icon } = nameOf(node);
    return { el: node, listed: { id: "", role: roleGuess(node), label, ...(icon ? { icon } : {}) } };
  }
  return undefined;
}

function roleGuess(el: Element): string {
  const role = el.getAttribute("role");
  if (role) return role;
  if (el.matches("a[href]")) return "link";
  if (el instanceof HTMLInputElement) return el.type === "checkbox" ? "checkbox" : el.type === "radio" ? "radio" : ["button", "submit", "reset", "image"].includes(el.type) ? "button" : "textbox";
  return "button";
}

/**
 * The step for a listed control: its kind, its name, the section it is in,
 * the dialog it is in and the page. A control in a row of a table is the
 * company's record, so it keeps its name only when other rows have a control
 * of the same name too, like Edit, and never the row's own words.
 */
function stepFor(listed: Pick<SnapElement, "role" | "label" | "icon" | "context">, el: Element, reading: PageSnapshot, where: string): TaughtStep {
  const step: TaughtStep = { kind: "press", path: where, role: listed.role || "clickable", label: labelOf(listed) };
  const context = sectionOf(listed.context ?? "");
  if (context) step.context = context;
  const dialog = reading.snapshot.dialog;
  if (dialog) step.dialog = dialog;
  const row = el.closest(ROW);
  if (row && row.closest(TABLE) && !el.closest(HEADER_CELL)) {
    step.row = true;
    if (step.label && !sharedByRows(step.label, row.closest(TABLE)!, reading)) step.label = "";
  }
  return step;
}

/** Whether controls of this name are in more than one row of the table, so the name is the table's and not one record's. */
function sharedByRows(label: string, table: Element, reading: PageSnapshot): boolean {
  const rows = new Set<Element>();
  for (const listed of reading.snapshot.elements) {
    if (labelOf(listed) !== label) continue;
    const row = reading.elements.get(listed.id)?.closest(ROW);
    if (row && row.closest(TABLE) === table) rows.add(row);
  }
  return rows.size >= 2;
}

/** A set of radio buttons' name: the group's own label or its fieldset's legend, masked. Empty when the page gives none. */
function groupName(el: Element): string {
  const group = el.closest('[role="radiogroup"], fieldset');
  if (!group) return "";
  return nameGiven(group) || (group.tagName === "FIELDSET" && group.querySelector("legend") ? shownWords(group.querySelector("legend")!, 80) : "");
}

/** A list's own name, when it gives one. */
function listName(el: Element): string {
  const list = el.closest('[role="listbox"], [role="tree"], [role="menu"]');
  return list ? nameGiven(list) : "";
}

/** The name a page gives a box for screen readers, masked. Never words from a field. */
function nameGiven(box: Element): string {
  const ids = box.getAttribute("aria-labelledby");
  if (ids) {
    const root = box.getRootNode() as Document | ShadowRoot;
    const words = ids
      .split(/\s+/)
      .map((id) => root.getElementById?.(id))
      .filter((named): named is HTMLElement => !!named)
      .map((named) => shownWords(named, 80))
      .join(" ")
      .trim();
    if (words) return cleanText(words, 80);
  }
  return cleanText(box.getAttribute("aria-label") ?? "", 80);
}

function isTextField(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset", "image", "file", "hidden", "color", "range"].includes(el.type);
  return (el as HTMLElement).isContentEditable === true || /(?:^|\s)(?:textbox|searchbox)(?:\s|$)/.test(el.getAttribute("role") ?? "");
}

/** Whether a tick box or switch is on now. */
function isOn(el: Element): boolean {
  if (el instanceof HTMLInputElement) return el.checked;
  const input = el.querySelector?.('input[type="checkbox"]');
  if (input instanceof HTMLInputElement) return input.checked;
  return el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-pressed") === "true" || el.getAttribute("data-state") === "checked";
}

