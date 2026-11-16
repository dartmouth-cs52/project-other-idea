import { ASKED_CLASSES, checkAction, CLASS_DOES, classAsked, fold, grounded, isForwardName, isSearchName, isSecretField, isTypeToConfirm, readName, type CommitClass } from "../shared/act-rules.ts";
import { actingAllowedAt, actionsAllowed, ACTING_LIMITS, describeElement, type Act, type ActingSettings, type Refusal, type SnapElement, type Snapshot, type TurnReply } from "../shared/types.ts";
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
//  4. Writes the page declares: a native submit, `data-method`, `hx-post`, ...
//  5. A confirmation dialog is open: acting stops.
//  6. Commit words, by class (act-rules.ts).
//  7. Destructive styling: red, or a toolkit's danger class.
//  8. Safe by what it is: a same-origin link, a control that opens something,
//     a tab, a choice in a list Haptic opened, a staged field, Enter in a
//     search box.
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
 * - "link": a same-origin link, pressed to navigate.
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
  /** Arm `tripwire` on `el` just before acting: setting a tick box, switch, radio or select. */
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

/** Watches for a sign that a field Haptic just set was saved at once. */
export interface Tripwire {
  /** True once a data request finished, or a status or alert region appeared, since it was armed. */
  tripped(): boolean;
  stop(): void;
}

/** The widget's own sentences while acting. English in this version. `name` is the control as the visitor sees it. */
export const SAYS = {
  secret: "I don't type passwords, payment details or confirmations. Fill this in and I'll carry on.",
  leaves: (name: string) => `This opens somewhere else, so I'll leave it to you. Click ${name} and I'll carry on.`,
  unknown: (name: string) => `This could save something, so I'll leave it to you. Click ${name} and I'll carry on.`,
  live: (name: string) => `This may save as soon as it changes, so I'll leave it to you. Set ${name} and I'll carry on.`,
  ungrounded: "You'll need to fill this one in: I only enter what you told me.",
  covered: (name: string) => `Something is in the way, so I'll leave this one to you. Click ${name} and I'll carry on.`,
  off: (name: string) => `I'll leave this one to you. Use ${name} and I'll carry on.`,
  unfit: (name: string) => `I can't do this one myself. Use ${name} and I'll carry on.`,
  confirmation: "The page is asking you to confirm. Read it and choose.",
  class: (name: string, does: string) => `I stopped before ${name}: it ${does}, and you didn't ask for that.`,
  cap: "That's as far as I'll go on my own. Here's what I did.",
  tripwire: "That may have been saved straight away. Check it before going on.",
  failed: (name: string) => `I couldn't do this one. Click ${name} yourself and I'll carry on.`,
  handover: (name: string) => `Click ${name} when it looks right.`,
  actingOff: "I'll show you the way instead.",
  moved: "You moved to another page, so I stopped doing it. Ask again to carry on.",
  tookOver: "You took over, so I've paused.",
  answered: "You answered the page's question, so I've stopped.",
} as const;

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
  return (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true" || (CHOICE_ROLES.has(roleOf(el)) && el.hasAttribute("data-disabled"));
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
  return [labelled, el.getAttribute("aria-label") ?? "", own, el.getAttribute("title") ?? "", image, iconOf(el)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
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

/** Whether it says it opens a menu, a list or a dialog. */
function isOpener(el: Element): boolean {
  const popup = (el.getAttribute("aria-haspopup") ?? "").toLowerCase();
  return (popup !== "" && popup !== "false") || el.hasAttribute("aria-expanded") || el.tagName === "SUMMARY";
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
  // Rule 3: leaving the page or the tab.
  if (isAnchor(el)) {
    const anchor = el as HTMLAnchorElement;
    let url: URL | undefined;
    try {
      url = new URL(anchor.href, location.href);
    } catch {
      return { reason: "leaves", at: el };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return { reason: "leaves", at: el };
    if (url.origin !== location.origin) return { reason: "leaves", at: el };
    const target = (anchor.getAttribute("target") ?? document.querySelector("base[target]")?.getAttribute("target") ?? "").trim().toLowerCase();
    if (target && target !== "_self") return { reason: "leaves", at: el };
    if (anchor.hasAttribute("download")) return { reason: "leaves", at: el };
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
  const verdict = readName(liveName(el), { link: isAnchor(el) || roleOf(el) === "link", dialog: inDialog(el, session.host), opener: isOpener(el), extra: config.acting?.commitWords });
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
  if (isAnchor(el) || role === "link") return { control: "link" };
  if (el.closest("iframe, canvas")) return { unfit: true };
  return { control: "button" };
}

/** Whether `trigger` names `el`'s box as what it controls or owns. */
function isControlledBy(trigger: Element, el: Element): boolean {
  const root = trigger.getRootNode() as Document | ShadowRoot;
  for (const id of `${trigger.getAttribute("aria-controls") ?? ""} ${trigger.getAttribute("aria-owns") ?? ""}`.split(/\s+/).filter(Boolean)) {
    const box = root.getElementById?.(id) ?? document.getElementById(id);
    if (box && within(box, el)) return true;
  }
  return false;
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
  writes: "it may save something",
  words: "it may save something",
  styled: "it may save something",
  unknown: "it may save something",
  live: "it may save as soon as it changes",
  ungrounded: "the visitor did not say what to enter",
  covered: "something covers it",
  unfit: "you can't do that to it yourself",
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
      return SAYS.off(name);
    case "unfit":
    case "enter":
    case "changed":
      return SAYS.unfit(name);
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

function visitorPlan(el: Element, listed: SnapElement | undefined, reason: Refusal, act?: Act, value?: string): VisitorPlan {
  const name = nameFor(el, listed);
  const why = WHY[reason] ?? "it may save something";
  return { kind: "visitor", reason, el, say: sayFor(reason, name), event: `You did not ${verbFor(act, value)} ${describeFor(el, listed)}: ${why}, so the visitor has it.` };
}

function classStop(el: Element, listed: SnapElement | undefined, commit: CommitClass): StopPlan {
  const name = nameFor(el, listed);
  return { kind: "stop", reason: "class", el, say: SAYS.class(name, CLASS_DOES[commit]), event: `You stopped before ${describeFor(el, listed)}: it ${CLASS_DOES[commit]}, and the visitor did not ask for that.` };
}

/** The commit class of a control's own words, read as a button: what the hand-over check asks about. */
function commitClassOf(el: Element, listed: SnapElement | undefined, session: GateSession, config: GateConfig): CommitClass | undefined {
  const name = [listed?.label ?? "", liveName(el)].join(" ");
  return readName(name, { dialog: inDialog(el, session.host), extra: config.acting?.commitWords }).commit;
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
  const link = isAnchor(el) || roleOf(el) === "link" || listed?.role === "link";
  const name = [listed?.label ?? "", liveName(el)].join(" ");
  if (el.closest("[data-haptic-commit]")) return { reason: "marked", at: el };
  // A field's label says what it holds, not what it does: "Lock to one merchant" locks nothing until its form is sent.
  const verdict = isFieldLike(el) ? { safe: false } : readName(name, { link, dialog: inDialog(el, session.host), opener: isOpener(el), extra: config.acting?.commitWords });
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
  const was = new Set((fold(listed.label).match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length > 1));
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
    if (withheld && withheld !== "contradiction") return visitorPlan(el, listed, withheld === "changed" ? "unfit" : withheld, reply.do ?? undefined, reply.enter ?? undefined);
    return { kind: "visitor", reason: "asked", el, say: reply.say, event: "" };
  }

  const act = out.do;
  const value = typeof out.enter === "string" ? out.enter.trim() : undefined;
  const refuse = (reason: Refusal, at: Element = el, commit?: CommitClass): Plan => {
    if (unasked(commit, session)) return classStop(at, at === el ? listed : undefined, commit);
    return visitorPlan(el, listed, reason, act, value);
  };

  // Caps (4.2).
  if (session.actions >= actionsAllowed(config.acting)) return { kind: "stop", reason: "cap", say: SAYS.cap, event: "You have done as many actions as one request allows, so you stopped." };
  if (session.failures >= ACTING_LIMITS.failuresInARow) return { kind: "stop", reason: "cap", say: SAYS.cap, event: "Several steps could not be done, so you stopped acting." };
  if (act === "type" && value && session.typed + value.length > ACTING_LIMITS.typedChars) return { kind: "stop", reason: "cap", say: SAYS.cap, event: "You have typed as much as one request allows, so you stopped." };

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
    if (control === "link") return actPlan(el, act, control, name, { navigates: true });
    if (control === "option") {
      const opened = session.opened;
      const inOpened = !!opened && ((opened.popup && within(opened.popup, el)) || isControlledBy(opened.from, el));
      if (!inOpened) return refuse("unknown");
      const fromField = openedFromField(session);
      if (CHOICE_ROLES.has(roleOf(el)) && fromField && !grounded(liveName(el) || name, session.words)) return refuse("ungrounded");
      // A choice sets the field it was opened from, so that field must be one whose change waits.
      if (fromField && !isStaged(opened!.from, session, config)) return refuse("live");
      return actPlan(el, act, control, name, { tripwire: fromField });
    }
    return actPlan(el, act, control, name, {});
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
function judgePress(el: Element, control: ControlKind, listedName: string, session: GateSession, config: GateConfig): { refused?: Refused } {
  const link = control === "link";
  const choice = control === "option";
  const verdict = readName([listedName, liveName(el)].join(" "), { link: link || choice, dialog: inDialog(el, session.host), opener: isOpener(el), extra: config.acting?.commitWords });
  if (verdict.commit) return { refused: { reason: verdict.marked ? "marked" : "words", commit: verdict.commit, at: el } };
  if (styledDestructive(el)) return { refused: { reason: "styled", at: el } };
  // Rule 8: safe because of what it is. A choice is judged further where it is planned.
  if (link || choice || control === "tab" || control === "combobox" || isOpener(el)) return {};
  // Rule 9: safe because of its words. Rule 10: anything else is not pressed.
  return verdict.safe ? {} : { refused: { reason: "unknown", at: el } };
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
        return { ok: false, plan: visitorPlan(el, undefined, refused.reason, plan.act, plan.value) };
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
 * the visitor's, and no commit words of a class that stops a link. The engine
 * then calls `reachable` on it as for any press.
 */
export function planPick(option: Element, plan: ActPlan, session: GateSession, config: GateConfig): ActPlan | VisitorPlan | StopPlan {
  try {
    const words = (option.getAttribute("aria-label") || (option instanceof HTMLOptionElement ? option.label || option.text : wordsIn(option, 120))).replace(/\s+/g, " ").trim();
    const refuse = (reason: Refusal) => visitorPlan(plan.el, undefined, reason, "choose", plan.value);
    if (!option.isConnected || disabled(option) || (option instanceof HTMLOptionElement && option.disabled)) return refuse("unfit");
    const native = option instanceof HTMLOptionElement && option.parentElement !== null && plan.el instanceof HTMLSelectElement && within(plan.el, option);
    const opened = session.opened;
    const inOpened = native || isControlledBy(plan.el, option) || (!!opened && opened.from === plan.el && ((!!opened.popup && within(opened.popup, option)) || isControlledBy(opened.from, option)));
    if (!inOpened) return refuse("unknown");
    for (const part of ancestry(option)) {
      if (part.hasAttribute("data-haptic-commit")) return refuse("marked");
      if ((part.getAttribute("data-haptic-act") ?? "").toLowerCase() === "off") return refuse("off");
    }
    if (!words || !grounded(words, session.words)) return refuse("ungrounded");
    const verdict = readName(words, { link: true, extra: config.acting?.commitWords });
    if (verdict.commit) {
      if (unasked(verdict.commit, session)) return classStop(option, undefined, verdict.commit);
      return refuse(verdict.marked ? "marked" : "words");
    }
    return actPlan(option, "click", "option", words.slice(0, 60), { value: words, tripwire: plan.tripwire });
  } catch (error) {
    console.warn("[Haptic]", error);
    return visitorPlan(plan.el, undefined, "unknown", "choose", plan.value);
  }
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
export function tripwire(el: Element, host: Element, options: { ignoreOrigins?: string[] } = {}): Tripwire {
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
        if (entry.startTime >= armed - 50 && entry.responseEnd <= armed + TRIPWIRE_MS) tripped = true;
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
