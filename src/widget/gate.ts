import { ASKED_CLASSES, checkAction, CLASS_DOES, classAsked, fold, grounded, isDismissName, isForwardName, isSearchName, isSecretField, isTypeToConfirm, namesADay, opensAFormPage, opensByName, readAddress, readName, type CommitClass } from "../shared/act-rules.ts";
import { actingAllowedAt, actionsAllowed, ACTING_LIMITS, describeElement, type Act, type ActingSettings, type Refusal, type SnapElement, type Snapshot, type TurnReply } from "../shared/types.ts";
import { SAYS } from "./says.ts";
import { currentPath, findOpenModal } from "./snapshot.ts";

// The DOM half of acting's safety gate (DESIGN section 4). It decides, on the
// live element at the moment of acting, whether Haptic may do a step itself,
// must give that one step to the visitor, has reached the hand-over, or must
// stop. It never trusts the model: the reply can only make it more careful.
// It refuses whatever it cannot classify, never reads what is written in a
// field, and never throws into the page.
//
// The rules, in order, the first that applies deciding (DESIGN 4.1):
//  0. A press reaches the control, its label or its own part, and nothing
//     else; the element under the press and all its ancestors pass the rest.
//  1. The company's marks: `data-haptic-commit`, the site's commit words,
//     `data-haptic-act="off"`.
//  2. Fields never typed into: passwords, payment details, codes, secrets,
//     files, "type DELETE to confirm".
//  3. Leaving: another origin, another tab, a download, a non-web address.
//     A "javascript:" address is a script on this page, judged as a button.
//  4. Writes the page declares: a native submit, `data-method`, `hx-post`, ...
//  5. A confirmation dialog is open: acting stops.
//  6. Commit words, by class (act-rules.ts), on links as on buttons, and
//     the words of a link's address: "/expenses/7/approve" approves. One
//     exception: a visit to a page that plainly holds a form ("/cards/new",
//     `visitsAFormPage`) is stopped by its words only as a choice is, since
//     "Issue card" there names what the form will do.
//  7. Destructive styling: red, or a toolkit's danger class.
//  8. Safe by what it is: a link that visits another page of the site
//     (`visitsAnotherPage`), pressed with the tripwire armed, a control that opens something,
//     a tab, a choice in a list Haptic opened or the visitor opened from a
//     field, a staged field, Enter in a search box. Also a button outside any
//     form whose name says it opens something ("Edit limits", "New budget"),
//     pressed with the tripwire armed. Any other link ("#", "javascript:",
//     role="link", one a script answers) is judged as a button, and pressed
//     with the tripwire armed.
//  9. Safe by its words: "Next", "Back", "Cancel", ...
// 10. Anything else is not acted on.

/** What the gate knows of the acting request it decides for. The guide keeps it; the engine adds to it as it acts. */
export interface GateSession {
  /** The visitor's question, as they wrote it. Every value typed or chosen must be grounded in it. */
  words: string;
  /** Haptic's own element. Hit tests look through it, and nothing in it is ever a target. */
  host: Element;
  /**
   * The control Haptic last opened a list, menu or popup from, and what it
   * opened when that is known. An option, menu entry or day inside it may be
   * pressed, Enter may be pressed in it, and a search box in it may be typed
   * in. The engine sets it after a press that opened something and clears it
   * when that closes.
   */
  opened?: { from: Element; popup?: Element };
  /** Actions taken in this request so far. */
  actions: number;
  /** Characters typed in this request so far. */
  typed: number;
  /** The control last acted on, and how many actions in a row it has had with no change to the page in between. */
  repeats?: { el: Element; count: number };
  /** "I couldn't do this one" hand-backs in a row. */
  failures: number;
  /**
   * The last press the gate let through on its name alone, while a save it
   * started may still be on its way: when it was armed (`performance.now()`)
   * and how the control is named. The engine looks once more before its next
   * action, and stops if such a request has come back since.
   */
  lastPress?: { armed: number; name: string; described: string };
}

/** The site's settings as the widget has them, and what the page itself says. */
export interface GateConfig {
  /** `PublicSiteConfig.acting`: present only when the site has acting on. Absent: nothing is acted on. */
  acting?: Omit<ActingSettings, "enabled">;
  /** `data-acting="off"` on the script tag. */
  pageOff?: boolean;
}

/**
 * How the engine should treat a control it may act on:
 * - "link": a link that visits another page of the site (`visitsAnotherPage`), pressed to navigate.
 * - "button": a button or menu entry, pressed.
 * - "tab": a tab, pressed.
 * - "option": an option, menu entry or tree item in a list Haptic opened, pressed.
 * - "text": a text field or text area, typed into.
 * - "select": a native `<select>`, set without opening it.
 * - "combobox": a custom select or combobox, opened and then picked from.
 * - "tick": a checkbox, radio or switch, set to `want`.
 */
export type ControlKind = "link" | "button" | "tab" | "option" | "text" | "select" | "combobox" | "tick";

/** Haptic does the step. */
export interface ActPlan {
  kind: "act";
  act: Act;
  /** What the act is aimed at: the listed target, or for a tick box hidden under its label, still the input (the engine presses `reachable`'s point). */
  el: Element;
  control: ControlKind;
  /** The control's name as the visitor sees it, for sentences and "What I did". */
  name: string;
  /** For "type": the exact text, already grounded. For "choose": the choice to look for; the option found must pass `planPick`. */
  value?: string;
  /** For "check", "uncheck" and a radio: the state to reach. */
  want?: boolean;
  /** A tick box or radio set by Haptic whose words the visitor did not write: listed at the hand-over as "my choice, check it". */
  mine?: boolean;
  /** Arm `tripwire` on `el` just before acting: setting a tick box, switch, radio or select, or pressing a button that opens something by its words. */
  tripwire: boolean;
  /** The press may load another page: the guide records the load it expects (DESIGN 4.6) before the press. */
  navigates: boolean;
}

/** The visitor does this one step, with the pointer on it. Acting resumes when the hearing hears them do it. */
export interface VisitorPlan {
  kind: "visitor";
  /** "asked": the model gave no `do` and asked the visitor. Anything else: the rule that declined the step. */
  reason: Refusal | "asked";
  /** Where the pointer goes. */
  el: Element;
  /** The sentence to show: the model's own when it asked, the gate's otherwise (`SAYS`). */
  say: string;
  /** For the next request's event, when Haptic declined: what it did not do and why. "" when the model asked. */
  event: string;
}

/** The final step: the visitor makes the click that commits. */
export interface HandoverPlan {
  kind: "handover";
  el: Element;
  /** The commit's class by its words, when it has one. */
  commit?: CommitClass;
  /** The model's sentence, with "Click {name} when it looks right." added when it does not name the control. */
  say: string;
}

/** Acting ends here. */
export interface StopPlan {
  kind: "stop";
  reason: Refusal;
  say: string;
  /** What to point at, if anything: a confirmation's action button, or the commit refused by its class. */
  el?: Element;
  /** For the history, when there is a next request: what Haptic did not do and why. */
  event: string;
}

/** The control is gone or is no longer the one the reply named: read the page again and ask again. */
export interface AgainPlan {
  kind: "again";
  reason: "changed";
}

export type Plan = ActPlan | VisitorPlan | HandoverPlan | StopPlan | AgainPlan;

/** Where to press, after the engine has brought the control on screen. */
export type Reach = { ok: true; x: number; y: number; hit: Element } | { ok: false; plan: VisitorPlan | StopPlan };

/** Watches for a sign that a field Haptic just set, or a button it just pressed, saved at once. */
export interface Tripwire {
  /** True once a data request finished, or a status or alert region appeared, since it was armed. */
  tripped(): boolean;
  stop(): void;
  /** When it was armed, on the page's clock (`performance.now()`). */
  armed: number;
}

/** The widget's own sentences while acting, in their own file: the guide shows some of them without loading the code that acts. */
export { SAYS };

// Reading a control ----------------------------------------------------------

const FIELD_ROLES = new Set(["checkbox", "radio", "switch", "combobox", "textbox", "searchbox", "spinbutton", "slider", "listbox", "option", "menuitemcheckbox", "menuitemradio", "treeitem", "gridcell", "tab"]);
const CHOICE_ROLES = new Set(["option", "treeitem", "gridcell"]);
const MENU_CHOICE_ROLES = new Set(["menuitemradio", "menuitemcheckbox"]);
const TEXT_TYPES = new Set(["", "text", "search", "email", "tel", "url", "number"]);
const DATE_TYPES = new Set(["date", "time", "datetime-local", "month", "week"]);
const DANGER = new Set(["danger", "destructive", "dangerous", "error", "negative", "critical"]);
/** Attributes toolkits use to say how a button looks: `design="Negative"` (UI5), `kind="danger"` (Carbon), `variant`, `color`. */
const LOOK_ATTRIBUTES = ["variant", "design", "color", "kind", "appearance", "intent", "tone", "severity", "data-variant", "data-color", "data-intent", "data-tone"];
/** What a page writes when its fields save the moment they change, in every shipped language. */
const AUTOSAVE =
  /auto-?sav|saves? automatically|saved automatically|changes are saved|guarda(?:do|n)? automaticamente|se guardan? automaticamente|enregistr\w* automatiquement|sauvegard\w* automatiquement|automatisch gespeichert|speichert automatisch|salv\w* automaticamente|automatisch opgeslagen|自動保存|自动保存|自動儲存/;

const roleOf = (el: Element) => (el.getAttribute("role") ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";

/** The element above `el`, out of a shadow root to its host when it is at the top of one. */
function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** `el` and every element above it, through shadow roots, up to the body. */
function ancestry(el: Element): Element[] {
  const chain: Element[] = [];
  for (let at: Element | null = el; at && at !== document.body && at !== document.documentElement && chain.length < 200; at = parentOf(at)) chain.push(at);
  return chain;
}

/** Whether `node` is `el` or inside it, shadow roots included. */
function within(el: Element, node: Element): boolean {
  for (let at: Element | null = node; at; at = parentOf(at)) if (at === el) return true;
  return false;
}

function disabled(el: Element): boolean {
  // Radix writes data-disabled with no value on a disabled option; cmdk writes data-disabled="false" on every option that is not.
  const flag = el.getAttribute("data-disabled");
  return (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true" || (CHOICE_ROLES.has(roleOf(el)) && flag !== null && flag !== "false");
}

/** Words of an element for reading, capped. Never the inside of a field: what a visitor typed is not read. */
function wordsIn(el: Element, max = 160): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable) return "";
  let words = "";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      if (node instanceof Element) {
        if (node.matches("input, textarea, select, script, style, template, [contenteditable]:not([contenteditable='false'])")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(), seen = 0; node && words.length < max && seen < 400; node = walker.nextNode(), seen++) words += ` ${node.nodeValue ?? ""}`;
  return words.replace(/\s+/g, " ").trim().slice(0, max);
}

/** The icon a control shows, when its class or data attributes give it away: "trash-2" from lucide-trash-2. */
function iconOf(el: Element): string {
  for (const part of [el, ...Array.from(el.querySelectorAll("svg, i, span[class*='icon' i], [data-icon], [data-lucide]")).slice(0, 4)]) {
    const named = part.getAttribute("data-icon") || part.getAttribute("data-lucide") || part.getAttribute("icon") || part.getAttribute("name");
    if (named && part !== el) return named;
    const match = /(?:^|\s)(?:lucide|fa|fas|far|fal|bi|icon|ti|ri|mdi|glyphicon|feather|ph|tabler|heroicon|octicon)-([a-z][a-z0-9-]*)/i.exec(part.getAttribute("class") ?? "");
    if (match?.[1]) return match[1];
  }
  return "";
}

/** Everything a control is called by, for reading its words: what names it, its own words, its title, its icon. Never a field's contents. */
function liveName(el: Element): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  const labelled = (el.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => (id ? root.getElementById?.(id) : null))
    .map((named) => (named ? wordsIn(named, 120) : ""))
    .join(" ");
  const own = el instanceof HTMLInputElement && ["button", "submit", "reset"].includes(el.type) ? el.value || el.type : wordsIn(el);
  const image = el.querySelector("img[alt]")?.getAttribute("alt") ?? (el instanceof HTMLImageElement ? el.alt : "");
  const words = [labelled, el.getAttribute("aria-label") ?? "", own, el.getAttribute("title") ?? "", image].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  // An icon names a control only when nothing else does: beside words it is decoration. A dialog's "Close" with an X icon is not "Close x".
  return (words || iconOf(el)).slice(0, 300);
}

/** The words that describe a field, for knowing what it asks for. Its labels, names and hints, never its value. */
function describedAs(field: Element): string {
  const root = field.getRootNode() as Document | ShadowRoot;
  const labels = Array.from((field as HTMLInputElement).labels ?? []).map((label) => wordsIn(label, 160));
  const labelled = (field.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => (id ? root.getElementById?.(id) : null)).map((named) => (named ? wordsIn(named, 160) : ""));
  const parts = [
    ...labels,
    ...labelled,
    field.getAttribute("aria-label"),
    field.getAttribute("placeholder"),
    field.getAttribute("title"),
    field.getAttribute("name"),
    field.id,
    field.getAttribute("autocomplete"),
    field.getAttribute("aria-description"),
  ];
  return parts.filter(Boolean).join(" ").slice(0, 600);
}

/**
 * The words just around a field: the text of the largest of its first three
 * wrappers that holds no other field, when that is short enough to be about
 * this field alone. Never what is typed in it.
 */
function wordsAround(field: Element): string {
  let words = "";
  for (let box = field.parentElement, depth = 0; box && box !== document.body && depth < 3; box = box.parentElement, depth++) {
    const others = Array.from(box.querySelectorAll("input, textarea, select, [contenteditable]:not([contenteditable='false'])")).some((other) => other !== field && !(other instanceof HTMLInputElement && other.type === "hidden"));
    if (others) break;
    const text = wordsIn(box, 240);
    if (text.length > 200) break;
    words = text;
  }
  return words;
}

/** A link or something that behaves as one. */
const isAnchor = (el: Element) => (el instanceof HTMLAnchorElement || el instanceof HTMLAreaElement) && el.hasAttribute("href");
/** Drawn or announced as a link, whatever it does: an address, or `role="link"`. Its press is watched (the tripwire). */
const isLinkLike = (el: Element) => isAnchor(el) || roleOf(el) === "link";

/** Attributes through which a page's script answers a click, so a link that has one may not go where its address says. */
const CLICK_HANDLER = /^(?:on(?:click|auxclick|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend)|ng-click|v-on:click|@click|x-on:click|wire:click|phx-click|data-action)(?:[.:].*)?$/i;

/** A link's address, or undefined when it cannot be read. */
function addressOf(el: Element): URL | undefined {
  try {
    return new URL((el as HTMLAnchorElement).href, location.href);
  } catch {
    return undefined;
  }
}

/** A route after "#/" or "#!/", which is a page of an app that keeps its place there. Any other "#" is a place on this page. */
const routeOf = (hash: string) => (/^#!?\//.test(hash) ? hash : "");

/**
 * Whether a press on `el` is a visit to another page of this site: the one
 * kind of link pressed for what it is (rule 8). An `<a href>` or `<area
 * href>` with no role but link, no click handler written on it, and an
 * address on this site whose path, query or "#/" route differ from this
 * page's. "#", "#top", "javascript:", `role="link"` without an address, and
 * a link a script answers are not visits: each is judged as a button.
 */
function visitsAnotherPage(el: Element): boolean {
  if (!isAnchor(el)) return false;
  const role = roleOf(el);
  if (role && role !== "link") return false;
  if ((el as HTMLElement).onclick || Array.from(el.attributes).some((attribute) => CLICK_HANDLER.test(attribute.name))) return false;
  const url = addressOf(el);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== location.origin) return false;
  return url.pathname !== location.pathname || url.search !== location.search || routeOf(url.hash) !== routeOf(location.hash);
}

/** A visit's address as it is read: its path, its query and a route after "#/". */
const visitedAddress = (url: URL) => url.pathname + url.search + routeOf(url.hash);

/**
 * Whether a press on `el` is a visit to a page that plainly holds a form to
 * fill in: a real visit (`visitsAnotherPage`) whose address ends in "new",
 * "edit" or the like and carries no commit word (act-rules.ts,
 * opensAFormPage). Such a link is named for what its form will do, "Issue
 * card" to "/cards/new", so its words stop it only as a choice's would. A
 * link a script answers, "#", "javascript:" and `role="link"` are never one.
 */
function visitsAFormPage(el: Element, config: GateConfig): boolean {
  if (!visitsAnotherPage(el)) return false;
  return opensAFormPage(visitedAddress(addressOf(el)!), config.acting?.commitWords);
}

/** What a visit to another page says it does, by the words of its address. Undefined for a link that is not a visit, or that visits a form page. */
function addressCommits(el: Element, config: GateConfig): Refused | undefined {
  if (!visitsAnotherPage(el) || visitsAFormPage(el, config)) return undefined;
  const verdict = readAddress(visitedAddress(addressOf(el)!), config.acting?.commitWords);
  return verdict.commit ? { reason: verdict.marked ? "marked" : "words", commit: verdict.commit, at: el } : undefined;
}

/** A native field a visitor fills in or picks from. */
function isNativeField(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !["button", "submit", "reset", "image", "hidden"].includes(el.type);
}

/** A field, native or by its role: set or typed in, so judged by whether it is staged, not by the words of its label. */
function isFieldLike(el: Element): boolean {
  return isNativeField(el) || (el as HTMLElement).isContentEditable || ["checkbox", "radio", "switch", "combobox", "textbox", "searchbox", "spinbutton", "slider"].includes(roleOf(el));
}

/** A button that sends its form: what the browser's own activation does with a click on it. */
function submitterOf(el: Element): HTMLButtonElement | HTMLInputElement | undefined {
  if (el instanceof HTMLButtonElement && el.type === "submit" && el.form) return el;
  if (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "image") && el.form) return el;
  return undefined;
}

/** A form that only searches: marked as a search, or whose one text field is a search box. Never one that posts. */
function isSearchForm(form: HTMLFormElement, submitter: HTMLButtonElement | HTMLInputElement): boolean {
  if ((submitter.formMethod || form.method).toLowerCase() === "post") return false;
  if (form.getAttribute("role") === "search" || form.closest("[role='search'], search")) return true;
  const texts = Array.from(form.elements).filter((field) => (field instanceof HTMLInputElement && TEXT_TYPES.has(field.type)) || field instanceof HTMLTextAreaElement);
  return texts.length === 1 && ((texts[0] as HTMLInputElement).type === "search" || roleOf(texts[0]!) === "searchbox");
}

/** A control a click would use: a native one, or one with a role that is pressed. Rows and lists are not. */
function isControl(el: Element): boolean {
  if (isAnchor(el) || el instanceof HTMLButtonElement || el.tagName === "SUMMARY") return true;
  if (el instanceof HTMLInputElement && ["button", "submit", "reset", "image"].includes(el.type)) return true;
  return ["button", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "tab", "treeitem"].includes(roleOf(el));
}

/** Whether it sits in a form, or is tied to one: a script can send a form from any button in it. */
function inForm(el: Element): boolean {
  return !!(el as HTMLButtonElement).form || !!el.closest("form, [role='form']");
}

/** Whether it says it opens a menu, a list or a dialog. */
function isOpener(el: Element): boolean {
  const popup = (el.getAttribute("aria-haspopup") ?? "").toLowerCase();
  return (popup !== "" && popup !== "false") || el.hasAttribute("aria-expanded") || el.tagName === "SUMMARY";
}

/**
 * What the dialog a control sits in says its buttons do, when its own name
 * holds words of a kind the visitor has to ask for: "Show card details?" with
 * a "Show details" button, "Delete workspace?" with "Continue". A button that
 * only puts the dialog away is not judged by it.
 */
function dialogAsks(el: Element, session: GateSession): CommitClass | undefined {
  const dialog = el.closest("dialog, [role='dialog'], [role='alertdialog']");
  if (!dialog || within(session.host, dialog) || isDismissName(liveName(el))) return undefined;
  const root = dialog.getRootNode() as Document | ShadowRoot;
  const labelled = (dialog.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => (id ? root.getElementById?.(id) : null))
    .map((named) => (named ? wordsIn(named, 160) : ""))
    .join(" ");
  const heading = dialog.querySelector("h1, h2, h3, [role='heading']");
  const name = dialog.getAttribute("aria-label") || labelled.trim() || (heading ? wordsIn(heading, 160) : "");
  const commit = name ? readName(name).commit : undefined;
  return commit && ASKED_CLASSES.includes(commit) ? commit : undefined;
}

/** Whether it sits in a dialog, where "OK", "Yes", "Done" and "Continue" commit. */
function inDialog(el: Element, host: Element): boolean {
  if (el.closest("dialog, [role='dialog'], [role='alertdialog']")) return true;
  const modal = findOpenModal(host);
  return !!modal && within(modal, el);
}

// Colours --------------------------------------------------------------------

/** An sRGB colour from what `getComputedStyle` gives, in 0 to 1 with its alpha, or undefined when it cannot be read. */
function parseColour(value: string): { r: number; g: number; b: number; a: number } | undefined {
  const numbers = (text: string) => text.split(/[\s,/]+/).filter(Boolean).map((part) => (part.endsWith("%") ? parseFloat(part) / 100 : parseFloat(part)));
  let match = /^rgba?\(([^)]*)\)$/i.exec(value.trim());
  if (match) {
    const [r = 0, g = 0, b = 0, a = 1] = numbers(match[1]!);
    return { r: r / 255, g: g / 255, b: b / 255, a };
  }
  match = /^color\(srgb\s+([^)]*)\)$/i.exec(value.trim());
  if (match) {
    const [r = 0, g = 0, b = 0, a = 1] = numbers(match[1]!);
    return { r, g, b, a };
  }
  match = /^(oklch|oklab)\(([^)]*)\)$/i.exec(value.trim());
  if (match) {
    const [l0 = 0, x = 0, y = 0, a = 1] = numbers(match[2]!);
    const l = l0 > 1 ? l0 / 100 : l0;
    let A = x;
    let B = y;
    if (match[1]!.toLowerCase() === "oklch") {
      A = x * Math.cos((y * Math.PI) / 180);
      B = x * Math.sin((y * Math.PI) / 180);
    }
    const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const linear = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_];
    const [r = 0, g = 0, b = 0] = linear.map((c) => Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
    return { r, g, b, a };
  }
  return undefined;
}

/** Red as a danger colour is red: hue within 15 degrees of red, saturation over 50%, lightness 30% to 70%, not see-through. */
function isRed(value: string): boolean {
  const colour = parseColour(value);
  if (!colour || colour.a < 0.5) return false;
  const { r, g, b } = colour;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min || lightness < 0.3 || lightness > 0.7) return false;
  const saturation = (max - min) / (1 - Math.abs(2 * lightness - 1));
  if (saturation <= 0.5 || max !== r) return false;
  const hue = (((g - b) / (max - min)) * 60 + 360) % 360;
  return hue <= 15 || hue >= 345;
}

/** Rule 7: styled as destructive, by its colours or by a class or attribute a toolkit uses for danger. It can only add a refusal. */
function styledDestructive(el: Element): boolean {
  const classes = (el.getAttribute("class") ?? "").split(/\s+/);
  const parts = classes.flatMap((name) => name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s\-_:/.]+/));
  if (parts.some((part) => DANGER.has(part))) return true;
  if (LOOK_ATTRIBUTES.some((name) => DANGER.has((el.getAttribute(name) ?? "").trim().toLowerCase()))) return true;
  const style = getComputedStyle(el);
  return isRed(style.backgroundColor) || isRed(style.color);
}

// Judging one control ----------------------------------------------------------

/** Why a control may not be pressed or set, with the class of its commit words when that was the reason. */
interface Refused {
  reason: Refusal;
  commit?: CommitClass;
  /** The control that was refused: the target, or the part of its chain that was. */
  at: Element;
}

/** Rules 1, 3, 4, 6 and 7 for one element of an activation chain. `self` is the target itself, whose own kind was judged already. */
function judgeChainPart(el: Element, session: GateSession, config: GateConfig, self: boolean): Refused | undefined {
  if (el.hasAttribute("data-haptic-commit")) return { reason: "marked", at: el };
  if ((el.getAttribute("data-haptic-act") ?? "").toLowerCase() === "off") return { reason: "off", at: el };
  // Rule 3: leaving the page or the tab. A "javascript:" address runs a script on this page, as a button's click does.
  const url = isAnchor(el) ? addressOf(el) : undefined;
  if (isAnchor(el) && url?.protocol !== "javascript:") {
    const anchor = el as HTMLAnchorElement;
    if (!url) return { reason: "leaves", at: el };
    if (url.protocol !== "http:" && url.protocol !== "https:") return { reason: "leaves", at: el };
    if (url.origin !== location.origin) return { reason: "leaves", at: el };
    const target = (anchor.getAttribute("target") ?? document.querySelector("base[target]")?.getAttribute("target") ?? "").trim().toLowerCase();
    if (target && target !== "_self") return { reason: "leaves", at: el };
    if (anchor.hasAttribute("download")) return { reason: "leaves", at: el };
    // Rule 6 on where a visit leads: "/expenses/7/approve".
    const address = addressCommits(el, config);
    if (address) return address;
  }
  // Rule 4: a write the page declares before the click.
  const submitter = submitterOf(el);
  if (submitter) {
    const form = submitter.form!;
    try {
      // `formAction` gives the page's own address when the button has no `formaction` of its own, so the form's is read then.
      const action = submitter.hasAttribute("formaction") ? submitter.formAction : form.action;
      if (new URL(action || location.href, location.href).origin !== location.origin) return { reason: "leaves", at: el };
    } catch {
      return { reason: "leaves", at: el };
    }
    const target = (submitter.formTarget || form.target || "").trim().toLowerCase();
    if (target && target !== "_self") return { reason: "leaves", at: el };
    if (!isSearchForm(form, submitter)) return { reason: "writes", at: el };
  }
  if ((el instanceof HTMLButtonElement || el instanceof HTMLInputElement) && el.type === "reset" && el.form) return { reason: "writes", at: el };
  for (const name of ["data-method", "data-turbo-method"]) {
    const method = el.getAttribute(name);
    if (method && method.trim().toLowerCase() !== "get") return { reason: "writes", at: el };
  }
  for (const name of ["hx-post", "hx-put", "hx-patch", "hx-delete", "data-hx-post", "data-hx-put", "data-hx-patch", "data-hx-delete", "data-confirm", "data-turbo-confirm", "hx-confirm", "data-hx-confirm"]) {
    if (el.hasAttribute(name)) return { reason: "writes", at: el };
  }
  // The target's own words and look were judged for its kind. Every other control the click passes through is judged as a press.
  if (self || !isControl(el)) return undefined;
  const verdict = readName(liveName(el), { dialog: inDialog(el, session.host), opener: isOpener(el), extra: config.acting?.commitWords });
  if (verdict.commit) return { reason: verdict.marked ? "marked" : "words", commit: verdict.commit, at: el };
  if (styledDestructive(el)) return { reason: "styled", at: el };
  return undefined;
}

/** What a click on `el` would also activate: a label's control, which the browser clicks for it. */
function activated(el: Element): Element[] {
  const also: Element[] = [];
  for (const part of ancestry(el)) if (part instanceof HTMLLabelElement && part.control && !ancestry(el).includes(part.control)) also.push(part.control);
  return also;
}

/** Rules 1, 3, 4, 6 and 7 on the whole activation chain of a press on `hit` aimed at `target`. */
function judgeChain(hit: Element, target: Element, session: GateSession, config: GateConfig): Refused | undefined {
  for (const part of [...ancestry(hit), ...activated(hit)]) {
    if (within(session.host, part)) continue;
    const refused = judgeChainPart(part, session, config, part === target);
    if (refused) return refused;
  }
  return undefined;
}

/** The kind of control, as the engine treats it, and whether this act fits it. */
function kindOf(el: Element, act: Act, session: GateSession): { control: ControlKind } | { unfit: true } {
  const role = roleOf(el);
  const opened = session.opened;
  const inOpened = !!opened && ((opened.popup && within(opened.popup, el)) || isControlledBy(opened.from, el));
  if (el instanceof HTMLInputElement) {
    const type = el.type;
    if (type === "checkbox" || type === "radio") return act === "type" || act === "choose" || act === "press_enter" || (type === "radio" && act === "uncheck") ? { unfit: true } : { control: "tick" };
    if (type === "file" || type === "range" || type === "color" || type === "hidden" || DATE_TYPES.has(type)) return { unfit: true };
    if (["button", "submit", "reset", "image"].includes(type)) return act === "click" ? { control: "button" } : { unfit: true };
    if (act === "type" || act === "press_enter") return el.readOnly ? { unfit: true } : { control: "text" };
    if (act === "choose" && (role === "combobox" || el.hasAttribute("aria-autocomplete") || el.hasAttribute("list"))) return { control: "combobox" };
    if (act === "click" && role === "combobox") return { control: "combobox" };
    return { unfit: true };
  }
  if (el instanceof HTMLTextAreaElement) return act === "type" && !el.readOnly ? { control: "text" } : { unfit: true };
  if (el instanceof HTMLSelectElement) return act === "choose" && !el.multiple ? { control: "select" } : { unfit: true };
  // Editors are not typed into in this version.
  if ((el as HTMLElement).isContentEditable) return { unfit: true };
  if (role === "checkbox" || role === "switch" || role === "menuitemcheckbox") return act === "click" || act === "check" || act === "uncheck" ? { control: role === "menuitemcheckbox" && act === "click" && inOpened ? "option" : "tick" } : { unfit: true };
  if (role === "radio" || role === "menuitemradio") return act === "click" || act === "check" ? { control: role === "menuitemradio" && inOpened ? "option" : "tick" } : { unfit: true };
  if (role === "slider" || role === "scrollbar" || role === "textbox" || role === "searchbox" || role === "spinbutton") return { unfit: true };
  const opensList = role === "combobox" || ["listbox", "tree", "grid"].includes((el.getAttribute("aria-haspopup") ?? "").toLowerCase());
  if (act === "choose") return opensList ? { control: "combobox" } : { unfit: true };
  if (act !== "click") return { unfit: true };
  if (opensList) return { control: "combobox" };
  if (CHOICE_ROLES.has(role)) return { control: "option" };
  if (role === "tab") return { control: "tab" };
  // Only a visit to another page is pressed as a link. "#", "javascript:", role="link" and a link a script answers are pressed as buttons.
  if (visitsAnotherPage(el)) return { control: "link" };
  if (el.closest("iframe, canvas")) return { unfit: true };
  return { control: "button" };
}

/**
 * The list an option is in, with what opened it: the one Haptic opened, or
 * one the visitor opened, which a control on the page names as its own
 * (`aria-controls` or `aria-owns`) and says is open (`aria-expanded="true"`).
 * Undefined when nothing on the page says the list is its own: an option
 * that no field opened is not pressed.
 */
function openedHolding(el: Element, session: GateSession): GateSession["opened"] {
  const opened = session.opened;
  if (opened && ((opened.popup && within(opened.popup, el)) || isControlledBy(opened.from, el))) return opened;
  const root = el.getRootNode() as Document | ShadowRoot;
  const triggers = new Set([...Array.from(root.querySelectorAll(OPEN_TRIGGER)), ...(root === document ? [] : Array.from(document.querySelectorAll(OPEN_TRIGGER)))]);
  for (const trigger of Array.from(triggers).slice(0, 60)) {
    if (within(session.host, trigger) || within(trigger, el) || disabled(trigger)) continue;
    const popup = boxControlledBy(trigger, el);
    if (popup) return { from: trigger, popup };
  }
  return undefined;
}

/** A control that says it is open and names what it opened. */
const OPEN_TRIGGER = "[aria-expanded='true'][aria-controls], [aria-expanded='true'][aria-owns]";

/** The box `trigger` controls or owns that holds `el`, if any. */
function boxControlledBy(trigger: Element, el: Element): Element | undefined {
  const root = trigger.getRootNode() as Document | ShadowRoot;
  for (const id of `${trigger.getAttribute("aria-controls") ?? ""} ${trigger.getAttribute("aria-owns") ?? ""}`.split(/\s+/).filter(Boolean)) {
    const box = root.getElementById?.(id) ?? document.getElementById(id);
    if (box && within(box, el)) return box;
  }
  return undefined;
}

/** Whether `trigger` names `el`'s box as what it controls or owns. */
function isControlledBy(trigger: Element, el: Element): boolean {
  return !!boxControlledBy(trigger, el);
}

/** Whether the field Haptic opened a list from is one a visitor picks a value in, so what is chosen there must be their own words. */
function openedFromField(session: GateSession): boolean {
  const from = session.opened?.from;
  if (!from) return false;
  const role = roleOf(from);
  return isNativeField(from) || role === "combobox" || role === "textbox" || role === "searchbox" || ["listbox", "tree", "grid", "dialog"].includes((from.getAttribute("aria-haspopup") ?? "").toLowerCase());
}

/** A field that is a search box: by its type or role, the search it sits in, or what it is called. */
function isSearchField(field: Element): boolean {
  if (field instanceof HTMLInputElement && field.type === "search") return true;
  if (roleOf(field) === "searchbox" || field.closest("[role='search'], search")) return true;
  return isSearchName(describedAs(field));
}

/** Buttons that do something when pressed: not ones that open a list or a menu, and not the parts of a field. */
function actingButtons(box: Element, field: Element): Element[] {
  const found: Element[] = [];
  for (const button of Array.from(box.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button'], input[type='image']")).slice(0, 60)) {
    if (within(field, button) || within(button, field)) continue;
    const role = roleOf(button);
    if (role && FIELD_ROLES.has(role)) continue;
    if (isOpener(button)) continue;
    found.push(button);
  }
  return found;
}

/** A button that moves the form on, or commits it: what a staged field waits for. */
function waitsFor(button: Element, session: GateSession, config: GateConfig): boolean {
  if (submitterOf(button)) return true;
  const name = liveName(button);
  if (isForwardName(name)) return true;
  const verdict = readName(name, { dialog: inDialog(button, session.host), extra: config.acting?.commitWords });
  return verdict.commit === "save" || verdict.commit === "send" || verdict.commit === "money" || verdict.commit === "dialog";
}

/**
 * Live or staged (DESIGN 4.1): whether a change to this field waits for a
 * later click, so Haptic may make it. Staged: marked so by the company, in a
 * list Haptic opened, a search box, in a form, in a dialog with buttons of its
 * own, or beside a button that moves the form on or commits it. Live: the
 * page says it saves as you go, or nothing around the field waits.
 */
function isStaged(field: Element, session: GateSession, config: GateConfig): boolean {
  if (field.closest("[data-haptic-act='staged']")) return true;
  const opened = session.opened;
  if (opened && ((opened.popup && within(opened.popup, field)) || isControlledBy(opened.from, field))) return true;
  // A page that says its fields save as they change is believed, whatever surrounds them.
  for (let box = field.parentElement, depth = 0; box && box !== document.body && depth < 6; box = box.parentElement, depth++) {
    const text = fold(wordsIn(box, 1500));
    if (AUTOSAVE.test(text)) return false;
  }
  if (isSearchField(field)) return true;
  if ((field as HTMLInputElement).form || field.closest("form")) return true;
  const dialog = field.closest("dialog, [role='dialog'], [role='alertdialog']");
  if (dialog && actingButtons(dialog, field).length) return true;
  let at: Element | null = parentOf(field);
  for (let depth = 0; at && at !== document.body && depth < 8; at = parentOf(at), depth++) {
    const buttons = actingButtons(at, field);
    if (buttons.length) return buttons.some((button) => waitsFor(button, session, config));
  }
  return false;
}

/** The name of a control as the visitor sees it: the listed name, else its own words. */
function nameFor(el: Element, listed: SnapElement | undefined): string {
  const name = listed?.label || liveName(el) || describedAs(el);
  return name.replace(/\s+/g, " ").trim().slice(0, 60) || "this";
}

/**
 * Whether a control picks a date, which Haptic leaves to the visitor in this
 * version: a field the browser gives a date picker, or a day in a calendar. A
 * day is a cell of a grid or a table, named by the day it is, in a row that
 * holds at least three cells named so.
 */
function picksADate(el: Element): boolean {
  if (el instanceof HTMLInputElement) return DATE_TYPES.has(el.type) && el.type !== "time";
  const cell = el.closest('td, [role="gridcell"]');
  const row = cell?.closest('tr, [role="row"]');
  if (!cell || !row?.closest('table, [role="grid"]')) return false;
  // A calendar names a day on its cell or on the button inside it, for screen readers or as a tooltip.
  const dated = (part: Element) =>
    [part, ...Array.from(part.querySelectorAll("[aria-label], [title]")).slice(0, 3)].some((node) => namesADay(`${node.getAttribute("aria-label") ?? ""} ${node.getAttribute("title") ?? ""}`));
  if (!dated(cell)) return false;
  let days = 0;
  for (const other of Array.from(row.querySelectorAll('td, [role="gridcell"]')).slice(0, 14)) if (dated(other) && ++days >= 3) return true;
  return false;
}

/** How the visitor is told which date to pick: a day by the date it names, a field by its name. */
function dateName(el: Element, listed: SnapElement | undefined): string {
  const named = [el.getAttribute("aria-label"), el.getAttribute("title")].find((words) => !!words && namesADay(words));
  if (named) return named.replace(/\s+/g, " ").trim().slice(0, 60);
  return el instanceof HTMLInputElement ? `a date in ${nameFor(el, listed)}` : nameFor(el, listed);
}

/** How the model reads a control in an event: as the list named it. */
function describeFor(el: Element, listed: SnapElement | undefined): string {
  if (listed) return describeElement(listed);
  return `${roleOf(el) || el.tagName.toLowerCase()} "${nameFor(el, undefined)}"`;
}

const WHY: Partial<Record<Refusal, string>> = {
  marked: "the site keeps it for the visitor",
  off: "the site keeps it for the visitor",
  secret: "you never type passwords, payment details or confirmations",
  leaves: "it opens somewhere else",
  writes: "it sends something to the site",
  words: "its words say it commits",
  styled: "the page marks it as dangerous",
  unknown: "you can't tell what it does",
  live: "it may save as soon as it changes",
  ungrounded: "the visitor did not say what to enter",
  covered: "something covers it",
  unfit: "you can't do that to it yourself",
  date: "you do not pick dates in this version",
  enter: "Enter is pressed only in a search box",
  cap: "you have done as much as one request allows",
  failed: "you could not do it",
};

function verbFor(act: Act | undefined, value: string | undefined): string {
  switch (act) {
    case "type":
      return value ? `type "${value}" in` : "type in";
    case "choose":
      return value ? `choose "${value}" in` : "choose in";
    case "check":
      return "turn on";
    case "uncheck":
      return "turn off";
    case "press_enter":
      return "press Enter in";
    default:
      return "click";
  }
}

/** The sentence the visitor sees for a step the gate gives them. */
function sayFor(reason: Refusal, name: string, commit?: CommitClass): string {
  switch (reason) {
    case "secret":
      return SAYS.secret;
    case "leaves":
      return SAYS.leaves(name);
    case "live":
      return SAYS.live(name);
    case "ungrounded":
      return SAYS.ungrounded;
    case "covered":
      return SAYS.covered(name);
    case "off":
    case "marked":
      return SAYS.off(name);
    case "words":
      return commit ? SAYS.commits(name, CLASS_DOES[commit]) : SAYS.unknown(name);
    case "writes":
      return SAYS.writes(name);
    case "styled":
      return SAYS.styled(name);
    case "unfit":
    case "enter":
    case "changed":
      return SAYS.unfit(name);
    case "date":
      return SAYS.date(name);
    case "failed":
    case "cap":
      return SAYS.failed(name);
    case "confirmation":
      return SAYS.confirmation;
    case "class":
      return SAYS.class(name, CLASS_DOES[commit ?? "destroy"]);
    case "tripwire":
      return SAYS.tripwire;
    default:
      return SAYS.unknown(name);
  }
}

/** A step the gate gives the visitor, with a sentence for them and one for the model that each say the real reason. `commit` is the class of the words that stopped it, when words did. */
function visitorPlan(el: Element, listed: SnapElement | undefined, reason: Refusal, act?: Act, value?: string, commit?: CommitClass): VisitorPlan {
  const name = reason === "date" ? dateName(el, listed) : nameFor(el, listed);
  const why = reason === "words" && commit ? `its words say it ${CLASS_DOES[commit]}` : (WHY[reason] ?? "you can't tell what it does");
  return { kind: "visitor", reason, el, say: sayFor(reason, name, commit), event: `You did not ${verbFor(act, value)} ${describeFor(el, listed)}: ${why}, so the visitor has it.` };
}

function classStop(el: Element, listed: SnapElement | undefined, commit: CommitClass): StopPlan {
  const name = nameFor(el, listed);
  return { kind: "stop", reason: "class", el, say: SAYS.class(name, CLASS_DOES[commit]), event: `You stopped before ${describeFor(el, listed)}: it ${CLASS_DOES[commit]}, and the visitor did not ask for that.` };
}

/** The commit class of a control's own words, read as a button, or else of where a visit leads: what the hand-over check asks about. */
function commitClassOf(el: Element, listed: SnapElement | undefined, session: GateSession, config: GateConfig): CommitClass | undefined {
  const name = [listed?.label ?? "", liveName(el)].join(" ");
  return readName(name, { dialog: inDialog(el, session.host), extra: config.acting?.commitWords }).commit ?? addressCommits(el, config)?.commit;
}

/** Whether a class of commit needs asking for, and was not: the hand-over check (4.5). */
function unasked(commit: CommitClass | undefined, session: GateSession): commit is CommitClass {
  return !!commit && ASKED_CLASSES.includes(commit) && !classAsked(commit, session.words);
}

/**
 * Whether the gate itself would refuse to press this control as a commit:
 * rules 1, 4, 6 or 7 on the control and its chain. What the hand-over needs.
 */
function judgeCommit(el: Element, listed: SnapElement | undefined, session: GateSession, config: GateConfig): Refused | undefined {
  const name = [listed?.label ?? "", liveName(el)].join(" ");
  if (el.closest("[data-haptic-commit]")) return { reason: "marked", at: el };
  // A field's label says what it holds, not what it does: "Lock to one merchant" locks nothing until its form is sent.
  const verdict = isFieldLike(el) ? { safe: false } : readName(name, { dialog: inDialog(el, session.host), opener: isOpener(el), extra: config.acting?.commitWords });
  if (verdict.commit) return { reason: verdict.marked ? "marked" : "words", commit: verdict.commit, at: el };
  for (const part of ancestry(el)) {
    if (within(session.host, part)) continue;
    const refused = judgeChainPart(part, session, config, part === el);
    if (refused && refused.reason !== "off" && refused.reason !== "leaves") return refused;
  }
  if (!isNativeField(el) && styledDestructive(el)) return { reason: "styled", at: el };
  return undefined;
}

/** Whether the live control is still the one the reading listed. Only a control named by its own words, renamed outright, counts as another. */
function stillListed(el: Element, listed: SnapElement): boolean {
  if (!listed.label || !["button", "link", "tab", "menuitem"].includes(listed.role) || el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")) return true;
  const own = wordsIn(el, 200);
  if (!own) return true;
  // What the reading masked, or took out as typed, says nothing of the words it stood for.
  const was = new Set((fold(listed.label.replace(/\[(?:typed|number|email)\]/g, " ")).match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length > 1));
  const now = fold(own).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!was.size || !now.length) return true;
  return now.some((word) => was.has(word));
}

/** A reading that holds only this control, for `checkAction`, which judges by what a reading lists. */
function readingOf(listed: SnapElement, dialog: boolean): Pick<Snapshot, "elements" | "dialog"> & Snapshot {
  return { path: "", title: "", headings: [], text: [], elements: [listed], truncated: false, ...(dialog ? { dialog: "dialog" } : {}) };
}

// Deciding a step ----------------------------------------------------------------

function decide(reply: TurnReply, target: Element | undefined, listed: SnapElement | undefined, session: GateSession, config: GateConfig): Plan {
  if (!target?.isConnected || within(session.host, target)) return { kind: "again", reason: "changed" };
  // A label is its control: a click on it is a click on the box it names.
  const el = target instanceof HTMLLabelElement && target.control ? target.control : target;
  const name = nameFor(el, listed);
  // Acting happens only where the site has it on, the page allows it, and the server answered in act mode.
  if (!config.acting || config.pageOff || reply.mode !== "act" || !actingAllowedAt(config.acting, currentPath())) {
    return { kind: "visitor", reason: "acting-off", el, say: reply.say, event: "" };
  }
  // Rule 5: while the page asks the visitor to confirm, acting stops.
  const confirmation = openConfirmation(session.host);
  if (confirmation) return { kind: "stop", reason: "confirmation", el: actionOf(confirmation, session) ?? el, say: SAYS.confirmation, event: "The page is asking the visitor to confirm, so you stopped." };
  if (listed && !stillListed(el, listed)) return { kind: "again", reason: "changed" };

  // The model's own reply, checked without trusting the server's check.
  const dialog = inDialog(el, session.host);
  const checked = listed ? checkAction(reply, { goal: session.words, snapshot: readingOf({ ...listed, id: reply.target ?? listed.id }, dialog) }, { commitWords: config.acting.commitWords }) : undefined;
  const out = checked?.reply ?? { ...reply, do: null, enter: null };
  const withheld = checked?.withheld ?? reply.withheld;
  if (reply.do && !listed) return { kind: "again", reason: "changed" };

  if (!out.do) {
    // The hand-over, or a step the model gives the visitor.
    const commit = judgeCommit(el, listed, session, config);
    const wordsClass = commit?.commit ?? (isFieldLike(el) ? undefined : commitClassOf(el, listed, session, config));
    if (unasked(wordsClass, session)) return classStop(el, listed, wordsClass);
    if (out.commits === true || out.status === "done") {
      if (commit) {
        const say = fold(reply.say).includes(fold(name)) ? reply.say : `${reply.say} ${SAYS.handover(name)}`.trim();
        return { kind: "handover", el, ...(wordsClass ? { commit: wordsClass } : {}), say };
      }
      return { kind: "visitor", reason: "asked", el, say: reply.say, event: "" };
    }
    if (withheld && withheld !== "contradiction") {
      const reason = withheld === "changed" ? "unfit" : withheld;
      return visitorPlan(el, listed, reason, reply.removed ?? reply.do ?? undefined, reply.enter ?? undefined, reason === "words" ? commitClassOf(el, listed, session, config) : undefined);
    }
    return { kind: "visitor", reason: "asked", el, say: reply.say, event: "" };
  }

  const act = out.do;
  const value = typeof out.enter === "string" ? out.enter.trim() : undefined;
  const refuse = (reason: Refusal, at: Element = el, commit?: CommitClass): Plan => {
    if (unasked(commit, session)) return classStop(at, at === el ? listed : undefined, commit);
    return visitorPlan(el, listed, reason, act, value, commit);
  };

  // Caps (4.2).
  if (session.actions >= actionsAllowed(config.acting)) return { kind: "stop", reason: "cap", say: SAYS.cap, event: "You have done as many actions as one request allows, so you stopped." };
  if (session.failures >= ACTING_LIMITS.failuresInARow) return { kind: "stop", reason: "cap", say: SAYS.cap, event: "Several steps could not be done, so you stopped acting." };
  if (act === "type" && value && session.typed + value.length > ACTING_LIMITS.typedChars) return { kind: "stop", reason: "cap", say: SAYS.cap, event: "You have typed as much as one request allows, so you stopped." };

  // Dates are not picked in this version, and the visitor is told so.
  if (picksADate(el)) return refuse("date");
  const kind = kindOf(el, act, session);
  if ("unfit" in kind || disabled(el)) return refuse("unfit");
  const { control } = kind;
  if (session.repeats && session.repeats.el === el && session.repeats.count >= ACTING_LIMITS.sameControl) return refuse("cap");

  // Rule 1, 3 and 4 on the control and everything a click on it passes through.
  const chain = judgeChain(el, el, session, config);
  if (chain) return refuse(chain.reason, chain.at, chain.commit);
  // Opening a combobox changes nothing; choosing in it does, and is judged as a field.
  const field = control === "text" || control === "select" || control === "tick" || (control === "combobox" && act === "choose");
  // Rule 2: fields Haptic never types into or reads.
  if (field || act === "press_enter") {
    if (el instanceof HTMLInputElement && (el.type === "password" || el.type === "file")) return refuse("secret");
    const words = describedAs(el);
    if (isSecretField(words) || isTypeToConfirm(wordsAround(el))) return refuse("secret");
  }
  // Rules 6 and 7 on what is pressed. A field is judged by whether it is staged instead.
  if (!field) {
    const pressed = judgePress(el, control, listed?.label ?? "", session, config);
    if (pressed.refused) return refuse(pressed.refused.reason, el, pressed.refused.commit);
    // A visit is watched too: a page whose script answers the click and sends something stops acting at once (act.ts).
    if (control === "link") return actPlan(el, act, control, name, { navigates: true, tripwire: true });
    if (control === "option") {
      const opened = openedHolding(el, session);
      if (!opened) return refuse("unknown");
      // A list the visitor opened on their turn is picked from as one Haptic opened: the field it belongs to is known, and judged.
      session.opened = opened;
      const fromField = openedFromField(session);
      if (CHOICE_ROLES.has(roleOf(el)) && fromField && !grounded(liveName(el) || name, session.words)) return refuse("ungrounded");
      // A choice sets the field it was opened from, so that field must be one whose change waits.
      if (fromField && !isStaged(opened!.from, session, config)) return refuse("live");
      return actPlan(el, act, control, name, { tripwire: fromField });
    }
    return actPlan(el, act, control, name, { tripwire: !!pressed.opens || isLinkLike(el) });
  }

  // Fields: Enter only in a search box or a list Haptic opened.
  if (act === "press_enter") {
    const opened = session.opened;
    const inOpened = !!opened && (opened.from === el || (!!opened.popup && within(opened.popup, el)));
    if (!isSearchField(el) && !inOpened) return refuse("enter");
    return actPlan(el, act, "text", name, {});
  }
  if (!isStaged(el, session, config)) return refuse("live");
  if (control === "tick") {
    const ticked = el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-checked") === "true";
    const radio = (el instanceof HTMLInputElement && el.type === "radio") || roleOf(el) === "radio" || roleOf(el) === "menuitemradio";
    const want = act === "check" || (act === "click" && radio) ? true : act === "uncheck" ? false : !ticked;
    return actPlan(el, act, control, name, { want, mine: !grounded(name, session.words), tripwire: true });
  }
  if (act === "type") return actPlan(el, act, control, name, { value });
  return actPlan(el, act, control, name, { value, tripwire: true });
}

/**
 * Rules 6 to 10 for a control that is pressed: its words, its look, and then
 * whether it is safe by what it is or by its words. Run when the step is
 * planned and again right before the press, so a "Next" that has become
 * "Delete" in between is not pressed.
 */
function judgePress(el: Element, control: ControlKind, listedName: string, session: GateSession, config: GateConfig): { refused?: Refused; opens?: boolean } {
  const link = control === "link";
  const choice = control === "option";
  const name = [listedName, liveName(el)].join(" ");
  // A link is read as a button is: only a choice in a list is read as the page's value, and a visit to a page that
  // plainly holds a form, whose words name what the form will do ("Issue card" to "/cards/new").
  const verdict = readName(name, { choice: choice || (link && visitsAFormPage(el, config)), dialog: inDialog(el, session.host), opener: isOpener(el), extra: config.acting?.commitWords });
  if (verdict.commit) return { refused: { reason: verdict.marked ? "marked" : "words", commit: verdict.commit, at: el } };
  const asks = dialogAsks(el, session);
  if (asks) return { refused: { reason: "words", commit: asks, at: el } };
  if (styledDestructive(el)) return { refused: { reason: "styled", at: el } };
  // Rule 8: safe because of what it is: a visit whose words and address commit nothing (its address is judged on its chain). A choice is judged further where it is planned.
  if (link || choice || control === "tab" || control === "combobox" || isOpener(el)) return {};
  // Rule 9: safe because of its words.
  if (verdict.safe) return {};
  // Also rule 8, by its words: a button whose name says it opens something to look at or fill in, with no commit word of any
  // class, outside any form, which it could send. Nothing before the press can tell it from one that also saves, so the press
  // is watched: one that sends anything to the site stops acting at once (the engine's tripwire).
  if (control === "button" && !inForm(el) && opensByName(name)) return { opens: true };
  // Rule 10: anything else is not pressed.
  return { refused: { reason: "unknown", at: el } };
}

function actPlan(el: Element, act: Act, control: ControlKind, name: string, extra: { value?: string; want?: boolean; mine?: boolean; tripwire?: boolean; navigates?: boolean }): ActPlan {
  const plan: ActPlan = { kind: "act", act, el, control, name, tripwire: !!extra.tripwire, navigates: !!extra.navigates };
  if (extra.value !== undefined) plan.value = extra.value;
  if (extra.want !== undefined) plan.want = extra.want;
  if (extra.mine) plan.mine = true;
  return plan;
}

/**
 * Decides one act-mode reply that names a control, on the live element, at
 * the moment of acting. `el` is the live element for `reply.target` and
 * `listed` its entry in the reading the reply answered; a missing or
 * disconnected `el` gives "again". The reply is checked with `checkAction`
 * first, whatever the server did. A reply without `mode: "act"` gives a
 * visitor step with reason "acting-off". A reply with no `do` gives a visitor
 * step ("asked"), or at `commits: true` the hand-over once 4.5 passes.
 */
export function planFor(reply: TurnReply, el: Element | undefined, listed: SnapElement | undefined, session: GateSession, config: GateConfig): Plan {
  try {
    return decide(reply, el, listed, session, config);
  } catch (error) {
    console.warn("[Haptic]", error);
    return el?.isConnected ? visitorPlan(el, listed, "unknown", reply.do ?? undefined) : { kind: "again", reason: "changed" };
  }
}

// Pressing --------------------------------------------------------------------

/** What a press at this point lands on, looking through Haptic's own element and into open shadow roots. */
function hitAt(x: number, y: number, host: Element): Element | null {
  let hit: Element | null = document.elementsFromPoint(x, y).find((found) => !within(host, found)) ?? null;
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementsFromPoint(x, y).find((found) => !within(host, found));
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

const OWN_PARTS = "label, [role='option'], [role='row'], tr, li, [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='listitem'], [role='treeitem'], [role='tab'], [role='radio'], [role='checkbox'], [role='switch']";

/** The label that shows for a tick box drawn as a speck or hidden under it. */
function shownLabel(el: Element): Element | undefined {
  if (!(el instanceof HTMLInputElement)) return undefined;
  const label = el.labels?.[0] ?? el.closest("label");
  return label ?? undefined;
}

/**
 * Rule 0, run by the engine right before each press, once the control is on
 * screen and still: the point a person would press (the middle, or another of
 * eight spots), and the element a press there would really reach. That
 * element and every ancestor up to the body (the activation chain) pass the
 * gate's rules again: a span inside a submit button is that button, a label
 * is its control. Covered, or refused on the chain: a visitor step.
 */
export function reachable(el: Element, plan: ActPlan, session: GateSession, config: GateConfig): Reach {
  try {
    if (!el.isConnected) return { ok: false, plan: visitorPlan(el, undefined, "changed", plan.act, plan.value) };
    let box = el.getBoundingClientRect();
    const label = shownLabel(el);
    const style = getComputedStyle(el);
    if (label && (box.width < 8 || box.height < 8 || style.opacity === "0" || style.visibility === "hidden")) box = label.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return { ok: false, plan: visitorPlan(el, undefined, "covered", plan.act, plan.value) };
    const frame = el.closest(OWN_PARTS) ?? label;
    const own = (hit: Element | null): hit is Element =>
      !!hit && (within(el, hit) || (!!label && within(label, hit)) || (!!frame && frame !== el && within(frame, hit) && !isControlOtherThan(hit, el, frame)));
    const inWindow = (x: number, y: number) => x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight;
    const spots: [number, number][] = [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.2], [0.5, 0.8], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]];
    for (const [fx, fy] of spots) {
      const x = box.left + box.width * fx;
      const y = box.top + box.height * fy;
      if (!inWindow(x, y)) continue;
      const hit = hitAt(x, y, session.host);
      if (!own(hit)) continue;
      const pressedNow = plan.control === "text" || plan.control === "select" || plan.control === "tick" || plan.act === "choose" ? undefined : judgePress(el, plan.control, plan.name, session, config).refused;
      const refused = judgeChain(hit, el, session, config) ?? pressedNow;
      if (refused) {
        const commit = refused.commit;
        if (unasked(commit, session)) return { ok: false, plan: classStop(refused.at, undefined, commit) };
        return { ok: false, plan: visitorPlan(el, undefined, refused.reason, plan.act, plan.value, commit) };
      }
      return { ok: true, x, y, hit };
    }
    return { ok: false, plan: visitorPlan(el, undefined, "covered", plan.act, plan.value) };
  } catch (error) {
    console.warn("[Haptic]", error);
    return { ok: false, plan: visitorPlan(el, undefined, "covered", plan.act, plan.value) };
  }
}

/** Whether `hit` is, or is inside, a control of its own between it and the row that holds `el`: another button in the same row is not `el`'s part. */
function isControlOtherThan(hit: Element, el: Element, frame: Element): boolean {
  for (let at: Element | null = hit; at && at !== frame; at = parentOf(at)) if (at !== el && (isControl(at) || isNativeField(at))) return true;
  return false;
}

/**
 * Whether the engine may press an option it found in a list it opened for a
 * "choose": inside what Haptic opened, not disabled, its own words grounded in
 * the visitor's, and no commit words of a class that stops a choice. The engine
 * then calls `reachable` on it as for any press.
 */
export function planPick(option: Element, plan: ActPlan, session: GateSession, config: GateConfig): ActPlan | VisitorPlan | StopPlan {
  try {
    const words = (option.getAttribute("aria-label") || (option instanceof HTMLOptionElement ? option.label || option.text : wordsIn(option, 120))).replace(/\s+/g, " ").trim();
    const refuse = (reason: Refusal, commit?: CommitClass) => visitorPlan(plan.el, undefined, reason, "choose", plan.value, commit);
    if (!option.isConnected || disabled(option) || (option instanceof HTMLOptionElement && option.disabled)) return refuse("unfit");
    const native = option instanceof HTMLOptionElement && option.parentElement !== null && plan.el instanceof HTMLSelectElement && within(plan.el, option);
    const opened = session.opened;
    const inOpened = native || isControlledBy(plan.el, option) || (!!opened && opened.from === plan.el && ((!!opened.popup && within(opened.popup, option)) || isControlledBy(opened.from, option)));
    if (!inOpened) return refuse("unknown");
    for (const part of ancestry(option)) {
      if (part.hasAttribute("data-haptic-commit")) return refuse("marked");
      if ((part.getAttribute("data-haptic-act") ?? "").toLowerCase() === "off") return refuse("off");
    }
    if (!words || !(grounded(words, session.words) || namesOption(plan.value, words, session.words))) return refuse("ungrounded");
    const verdict = readName(words, { choice: true, extra: config.acting?.commitWords });
    if (verdict.commit) {
      if (unasked(verdict.commit, session)) return classStop(option, undefined, verdict.commit);
      return refuse(verdict.marked ? "marked" : "words", verdict.commit);
    }
    return actPlan(option, "click", "option", words.slice(0, 60), { value: words, tripwire: plan.tripwire });
  } catch (error) {
    console.warn("[Haptic]", error);
    return visitorPlan(plan.el, undefined, "unknown", "choose", plan.value);
  }
}

/**
 * Whether the visitor's own value names this option by its first words: the
 * value is grounded in what they wrote, and the option's words begin with it.
 * A person in a list is often shown with their title or email after the name
 * ("Malika Cummerata  Senior Accountant"): the visitor named the person, and
 * the words after the name only describe them. "Per day" does not begin with
 * "Per month", so it stays the visitor's to pick.
 */
function namesOption(value: string | undefined, option: string, words: string): boolean {
  const plain = (text: string) => fold(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const [named, shown] = [plain(value ?? ""), plain(option)];
  return !!named && grounded(value!, words) && (shown === named || shown.startsWith(`${named} `));
}

const FREE_KEYS = new Set(["Escape", "Esc", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown"]);

/**
 * Whether the engine may dispatch this key on `el`. Escape, Tab and the arrow
 * keys: yes. Space and Enter: only on the control the plan acts on, which has
 * passed the gate, or Enter in a search box or inside a list Haptic opened.
 * A printable character: only while typing into the plan's field or a search
 * box in a list Haptic opened.
 */
export function keyAllowed(el: Element, key: string, plan: ActPlan, session: GateSession): boolean {
  try {
    if (FREE_KEYS.has(key)) return true;
    const opened = session.opened;
    const inOpened = !!opened && ((!!opened.popup && within(opened.popup, el)) || (opened.from === el && (el.getAttribute("aria-expanded") === "true" || !!opened.popup?.isConnected)));
    const onPlan = el === plan.el || within(plan.el, el) || (plan.el instanceof HTMLInputElement && shownLabel(plan.el) === el);
    if (key === " " || key === "Spacebar") return onPlan && ["button", "tab", "tick", "option", "combobox"].includes(plan.control);
    if (key === "Enter") {
      if (inOpened) return true;
      if (onPlan && ["button", "tab", "option", "combobox"].includes(plan.control)) return true;
      return onPlan && plan.act === "press_enter" && isSearchField(el);
    }
    if ([...key].length === 1) {
      if (plan.act !== "type" && plan.act !== "choose") return false;
      if (onPlan) return true;
      return inOpened && (el instanceof HTMLInputElement || roleOf(el) === "searchbox" || roleOf(el) === "combobox") && !isSecretField(describedAs(el));
    }
    return false;
  } catch (error) {
    console.warn("[Haptic]", error);
    return false;
  }
}

/**
 * Whether a finished request is one the tripwire counts: it carries data and
 * went out within a second of `armed`. A field's tripwire counts only one
 * that also came back within that second; a press's (`byStart`) counts one
 * that went out in it, however long it took.
 */
function sentInWindow(entry: PerformanceResourceTiming, armed: number, byStart: boolean): boolean {
  if (!DATA_REQUEST.has(entry.initiatorType)) return false;
  if (entry.startTime < armed - 50 || entry.startTime > armed + TRIPWIRE_MS) return false;
  return byStart || entry.responseEnd <= armed + TRIPWIRE_MS;
}

/**
 * Whether the page sent a data request within a second of `armed` that has
 * come back since the tripwire stopped watching: a slow save started by a
 * press, found before Haptic acts again. Read from the page's own list of
 * finished requests; nothing is installed.
 */
export function sentAfter(armed: number): boolean {
  try {
    return (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).some((entry) => sentInWindow(entry, armed, true));
  } catch {
    return false;
  }
}

/** Whether a request a page made carries data: fetch, XHR and beacons, not pictures and styles. */
const DATA_REQUEST = new Set(["fetch", "xmlhttprequest", "beacon", "other"]);
/** How soon after Haptic set a field a request, or a status, means the page may have saved it. */
const TRIPWIRE_MS = 1000;

/**
 * Arms the tripwire for a field Haptic is about to set (DESIGN 4.1): a data
 * request that finishes within a second, or a status or alert region that
 * appears or changes, means the page may have saved. Requests to
 * `ignoreOrigins` (Haptic's own server) do not count. Stop it once the step is
 * checked.
 */
export function tripwire(el: Element, host: Element, options: { ignoreOrigins?: string[]; byStart?: boolean } = {}): Tripwire {
  const armed = performance.now();
  let tripped = false;
  let resources: PerformanceObserver | undefined;
  let mutations: MutationObserver | undefined;
  const ignored = (url: string) => {
    try {
      return (options.ignoreOrigins ?? []).includes(new URL(url, location.href).origin);
    } catch {
      return false;
    }
  };
  try {
    resources = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        if (!DATA_REQUEST.has(entry.initiatorType) || ignored(entry.name)) continue;
        if (sentInWindow(entry, armed, !!options.byStart)) tripped = true;
      }
    });
    resources.observe({ type: "resource", buffered: false });
  } catch {
    resources = undefined;
  }
  const isStatus = (node: Node | null): boolean => {
    const element = node instanceof Element ? node : node?.parentElement;
    if (!element || within(host, element)) return false;
    return !!element.closest("[role='status'], [role='alert'], [aria-live='assertive'], output");
  };
  try {
    mutations = new MutationObserver((records) => {
      if (performance.now() > armed + TRIPWIRE_MS) return;
      for (const record of records) {
        if (record.type === "characterData" ? isStatus(record.target) : false) tripped = true;
        for (const node of Array.from(record.addedNodes)) {
          if (!(node instanceof Element || node instanceof Text)) continue;
          const holds = node instanceof Element && (node.matches("[role='status'], [role='alert']") || !!node.querySelector("[role='status'], [role='alert']"));
          if ((holds || isStatus(node)) && (node.textContent ?? "").trim() && !(node instanceof Element && within(host, node))) tripped = true;
        }
      }
    });
    mutations.observe(document.body, { subtree: true, childList: true, characterData: true });
  } catch {
    mutations = undefined;
  }
  void el;
  return {
    armed,
    tripped: () => tripped,
    stop: () => {
      resources?.disconnect();
      mutations?.disconnect();
    },
  };
}

/** The buttons of a dialog that do something, apart from cancelling or closing it. */
function actionsIn(dialog: Element, session: GateSession): Element[] {
  return Array.from(dialog.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']"))
    .filter((button) => !within(session.host, button))
    .filter((button) => {
      const verdict = readName(liveName(button));
      return !(verdict.safe && !verdict.commit);
    });
}

/** The one action of a confirmation, which the pointer goes to when acting stops there. */
function actionOf(dialog: Element, session: GateSession): Element | undefined {
  return actionsIn(dialog, session)[0];
}

/** The action of a confirmation dialog, for the guide to point at when the engine stops at one (rule 5). */
export function confirmationAction(dialog: Element, host: Element): Element | undefined {
  try {
    return actionOf(dialog, { words: "", host, actions: 0, typed: 0, failures: 0 });
  } catch (error) {
    console.warn("[Haptic]", error);
    return undefined;
  }
}

/**
 * The confirmation dialog open on the page, if one is (rule 5). An alert
 * dialog always is. Another open dialog is when it holds one action besides
 * Cancel or Close, that action commits (by its words, its look, or as a
 * submit), and it has no field but, at most, one that asks the visitor to
 * type something to confirm. A dialog with a field of any other kind is a
 * small form, whose own commit the other rules stop.
 */
export function openConfirmation(host: Element): Element | undefined {
  try {
    const session: GateSession = { words: "", host, actions: 0, typed: 0, failures: 0 };
    const candidates = new Set<Element>();
    const modal = findOpenModal(host);
    if (modal) candidates.add(modal);
    for (const dialog of Array.from(document.querySelectorAll("[role='alertdialog'], dialog[open]"))) {
      if (!within(host, dialog) && dialog.getClientRects().length) candidates.add(dialog);
    }
    for (const dialog of candidates) {
      if (roleOf(dialog) === "alertdialog") return dialog;
      const actions = actionsIn(dialog, session);
      if (actions.length !== 1) continue;
      const action = actions[0]!;
      const commits = !!submitterOf(action) || !!readName(liveName(action), { dialog: true }).commit || styledDestructive(action);
      if (!commits) continue;
      const fields = Array.from(dialog.querySelectorAll("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='combobox']")).filter(
        (field) => !(field instanceof HTMLInputElement && ["hidden", "button", "submit", "reset", "image"].includes(field.type)) && field.getClientRects().length,
      );
      if (fields.length === 0 || (fields.length === 1 && (isTypeToConfirm(describedAs(fields[0]!)) || isTypeToConfirm(wordsAround(fields[0]!))))) return dialog;
    }
    return undefined;
  } catch (error) {
    console.warn("[Haptic]", error);
    return undefined;
  }
}
