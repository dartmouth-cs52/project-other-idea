import { cleanText as maskAndTrim, describeElement, normalizePath, namedIn, type SnapElement, type Snapshot } from "../shared/types.ts";

// Turns the live page into the list of elements the model sees. One read-only
// pass over the DOM. Input values are never read: labels only.

const MAX_ELEMENTS = 300;
const MAX_TEXT_CHARS = 2500;
const MAX_VISITED = 15000;

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "CANVAS", "VIDEO", "AUDIO", "IFRAME", "OBJECT"]);
const ROLE_FOR_INPUT: Record<string, string> = {
  button: "button", submit: "button", reset: "button", image: "button",
  checkbox: "checkbox", radio: "radio", range: "slider", file: "file-upload", hidden: "",
};
const INTERACTIVE_ROLES = new Set([
  "button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "checkbox", "radio",
  "switch", "combobox", "treeitem", "textbox", "searchbox", "slider", "spinbutton",
]);
const LANDMARKS: Record<string, string> = {
  HEADER: "header", NAV: "nav", MAIN: "main", ASIDE: "aside", FOOTER: "footer", FORM: "form",
  banner: "header", navigation: "nav", main: "main", complementary: "aside", contentinfo: "footer",
  form: "form", search: "search", menu: "menu", menubar: "menu", listbox: "list", tablist: "tabs", toolbar: "toolbar",
};
const TEXT_TAGS = new Set(["P", "LI", "DD", "DT", "SPAN", "DIV", "SMALL", "STRONG", "B", "EM", "LABEL", "TD", "TH", "FIGCAPTION", "H4", "H5", "H6", "A"]);
const MAYBE_CLICKABLE = new Set(["DIV", "SPAN", "LI", "IMG", "TD", "TR", "TH", "P", "I", "A", "SECTION", "ARTICLE"]);
/** Tags that take a tabindex so that they can be scrolled or jumped to, not so that they can be clicked. */
const FOCUSABLE_NOT_CLICKABLE = new Set(["BODY", "MAIN", "PRE", "CODE", "TABLE", "FORM", "DIALOG"]);
const ICON_CLASS =
  /(?:^|\s)(?:lucide|tabler-icon|bi|ri|fa|mdi|pi|ti|anticon|aui-iconfont|oo-ui-icon|glyphicon|codicon|octicon|icon)-(?!solid|regular|brands|fw|lg|sm|xs|spin|btn|button|default|container|wrapper|small|medium|large|only)([a-z][a-z0-9-]+)/;
/** What repeats down a page: the row, card or entry a control sits in. */
const ROW = 'tr, li, article, [role="row"], [role="listitem"], [role="option"], [role="treeitem"], [role="gridcell"]';
/** A select's choices are part of the page, so they are listed: this many, each this long. */
const MAX_OPTIONS = 12;
const MAX_OPTION_CHARS = 30;
/** Controls far down a region that is all links, like a list of related pages, wait behind the rest of the page. */
const REGION_SHARE = 40;

export interface PageSnapshot {
  snapshot: Snapshot;
  /** Live element for each id in the snapshot. */
  elements: Map<string, Element>;
}

interface Candidate extends SnapElement {
  el: Element;
  /** In the page's furniture (header, navigation, footer, tabs), which leads everywhere else. */
  nav: boolean;
  region: string;
  /** Outside the open dialog. Kept only if it is drawn on top of it, like a list the dialog opened. */
  outside: boolean;
}

interface Scope {
  region: string;
  heading: string;
}

/**
 * What the visitor named in their question, for as long as one page is being
 * read. The same email or long number on the page is left readable.
 */
let own: ReadonlySet<string> = new Set();
const cleanText = (text: string, max = 80): string => maskAndTrim(text, max, own);

/**
 * Reads the page. `question` is what the visitor asked: an email or a long
 * number in it is the only one left unmasked. Every reading within one guide
 * has to be given the same question, or one control would be named two ways.
 */
export function takeSnapshot(ignore: Element, question: string): PageSnapshot {
  own = namedIn(question);
  const candidates: Candidate[] = [];
  const headings: string[] = [];
  const texts: { text: string; visible: boolean }[] = [];
  const viewportHeight = window.innerHeight;
  let visited = 0;

  // With a modal open only the modal is usable, so only the modal is listed,
  // along with anything drawn on top of it: many apps put the list that a
  // dropdown opens at the end of the page, outside the dialog it belongs to.
  const modal = findOpenModal(ignore);
  const root = document.body;

  const visit = (el: Element, scope: Scope, parentPointer: boolean, insideControl: boolean, inSvg = false, outside = !!modal) => {
    if (visited++ > MAX_VISITED || el === ignore || SKIP_TAGS.has(el.tagName)) return;
    if (el.hasAttribute("inert") || el.hasAttribute("data-haptic-ignore") || el.getAttribute("aria-hidden") === "true") {
      // An app hides the page behind its dialog this way, and the dialog itself is inside what it hid only by mistake.
      if (!modal || !el.contains(modal) || el === modal) return;
    }
    if (el === modal) outside = false;
    // A drawing is not read, but controls and ordinary page content placed inside one are.
    const svg = el.tagName === "svg" || (inSvg && el.tagName !== "foreignObject");
    if (!isRendered(el)) {
      // display:contents has no box of its own, but its children do.
      if (getComputedStyle(el).display === "contents") for (const child of el.children) visit(child, scope, parentPointer, insideControl);
      return;
    }

    // An element can name more than one role. The one that says how it is used is the one that matters.
    const roles = (el.getAttribute("role") ?? "").split(/\s+/).filter(Boolean);
    const explicitRole = roles.find((name) => INTERACTIVE_ROLES.has(name)) ?? roles[0] ?? "";
    const landmark = LANDMARKS[explicitRole] ?? LANDMARKS[el.tagName];
    const childScope = el === modal ? { region: "dialog", heading: "" } : landmark && el !== root ? { region: landmark, heading: "" } : scope;

    if (/^H[1-3]$/.test(el.tagName) || explicitRole === "heading") {
      const text = cleanText(el.textContent ?? "", 80);
      if (text) {
        scope.heading = text;
        if (headings.length < 12) headings.push(text);
      }
    }

    // cursor:pointer is inherited, so only the element where it starts counts.
    const pointerHere = !INTERACTIVE_ROLES.has(explicitRole) && !svg && MAYBE_CLICKABLE.has(el.tagName) ? getComputedStyle(el).cursor === "pointer" : parentPointer;
    const role = svg && !INTERACTIVE_ROLES.has(explicitRole) && !(el.tagName.toLowerCase() === "a" && (el.hasAttribute("href") || el.hasAttribute("xlink:href")))
      ? ""
      : roleOf(el, explicitRole, pointerHere && !parentPointer && !insideControl);

    let added: Candidate | undefined;
    if (role) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        added = { el, id: "", role, label: labelOf(el, role), nav: ["nav", "header", "aside", "menu", "tabs", "footer"].includes(scope.region), region: scope.region, outside };
        const options = optionsOf(el);
        if (options.length) added.options = options;
        const icon = iconOf(el);
        if (icon) added.icon = icon;
        const state = stateOf(el, role);
        if (state.length) added.state = state;
        const href = hrefOf(el);
        if (href) added.href = href;
        const context = [scope.region === "page" ? "" : scope.region, scope.heading].filter(Boolean).join(" › ");
        if (context) added.context = context;
        if (rect.bottom <= 0) added.offscreen = "above";
        else if (rect.top >= viewportHeight) added.offscreen = "below";
        candidates.push(added);
      }
    } else if (!insideControl && !svg && !outside && TEXT_TAGS.has(el.tagName) && texts.length < 300) {
      const own = ownText(el);
      if (own.length >= 3) {
        const rect = el.getBoundingClientRect();
        texts.push({ text: cleanText(own, 160), visible: rect.bottom > 0 && rect.top < viewportHeight });
      }
    }

    const before = candidates.length;
    const inside = insideControl || role !== "";
    for (const child of el.children) visit(child, childScope, pointerHere, inside, svg, outside);
    if (el.shadowRoot) for (const child of el.shadowRoot.children) visit(child, childScope, pointerHere, inside, svg, outside);

    // A wrapper around real buttons or links is just a container, whether it
    // looked clickable or was given a role, like a menu entry around its link.
    // One that can be reached with the keyboard is a control in its own right:
    // a row that opens what it shows, with a button or two inside it.
    const within = added ? candidates.slice(before).filter((c) => c !== added) : [];
    if (added && !isNative(el) && !isFocusable(el) && within.some((c) => c.role !== "clickable" && isNative(c.el))) {
      candidates.splice(candidates.indexOf(added), 1);
    } else if (added?.role === "clickable" && within.some((c) => c.role === "clickable" && c.label.length >= added!.label.length * 0.6)) {
      // A clickable box around a clickable box that says the same thing: the inner one is the control.
      candidates.splice(candidates.indexOf(added), 1);
    }
  };

  if (root) visit(root, { region: "page", heading: "" }, false, false);

  // With a dialog open, the rest of the page counts only where it is drawn over the dialog.
  let usable = mergeCells(modal ? candidates.filter((c) => !c.outside || onTop(c.el)) : candidates);
  nameRows(usable);

  // Over the cap, keep what's on screen first, then the page's furniture, then
  // the rest in page order. A region that is one long run of links, like a box
  // of related pages, does not get to crowd out everything after it.
  let chosen = usable;
  if (usable.length > MAX_ELEMENTS) {
    const perRegion = new Map<string, number>();
    const rank = (c: Candidate) => {
      if (!c.offscreen) return 0;
      if (!c.nav) return 2;
      const seen = (perRegion.get(c.context ?? c.region) ?? 0) + 1;
      perRegion.set(c.context ?? c.region, seen);
      return seen > REGION_SHARE ? 3 : 1;
    };
    const ranked = usable.map((c) => ({ c, rank: rank(c) }));
    const keep = new Set(ranked.sort((a, b) => a.rank - b.rank).slice(0, MAX_ELEMENTS).map((entry) => entry.c));
    chosen = usable.filter((c) => keep.has(c));
  }
  usable = [];

  const elements = new Map<string, Element>();
  const listed = chosen.map(({ el, nav: _nav, region: _region, outside: _outside, ...element }, index) => {
    element.id = `e${index + 1}`;
    elements.set(element.id, el);
    return element;
  });

  const snapshot: Snapshot = {
    path: currentPath(),
    title: cleanText(document.title, 80),
    headings,
    text: chooseText(texts),
    elements: listed,
    truncated: chosen.length < candidates.filter((c) => !c.outside).length && chosen.length >= MAX_ELEMENTS,
  };
  if (modal) snapshot.dialog = dialogLabel(modal);
  return { snapshot, elements };
}

/** Identifies the same control across two snapshots, where ids differ. */
export function elementKey(element: Pick<SnapElement, "role" | "label" | "icon" | "href" | "context">): string {
  // The row a control is in is part of what it is: "Remove" beside Sam is not "Remove" beside Priya.
  const row = /row: (.*)$/.exec(element.context ?? "")?.[1] ?? "";
  return `${element.role}|${element.label}|${element.icon ?? ""}|${element.href ?? ""}|${row}`;
}

/**
 * Where the visitor is. An app that keeps its place after a "#/" shows the
 * same address path on every screen, so that part counts too.
 */
export function currentPath(): string {
  const route = location.hash.startsWith("#/") ? normalizePath(location.hash.slice(1)) : "";
  return normalizePath(location.pathname) + (route && route !== "/" ? `#${route}` : "");
}

/**
 * What changed between the page before the user acted and the page now, in
 * words. Without this the model can't tell whether a click did anything and
 * repeats itself.
 */
export function describeChange(before: Snapshot, after: Snapshot): string {
  const lines: string[] = [];
  if (before.path !== after.path) lines.push(`The page went from ${before.path} to ${after.path}.`);
  if (before.dialog !== after.dialog) {
    if (before.dialog !== undefined) lines.push(`Dialog "${before.dialog}" closed.`);
    if (after.dialog !== undefined) lines.push(`Dialog "${after.dialog}" opened.`);
  }
  // A new page or dialog swaps most of the list, and the model reads the new
  // list anyway. Element-level changes only matter within one view.
  if (!lines.length) {
    const added = without(after.elements, before.elements, elementKey).map(describeElement);
    const removed = without(before.elements, after.elements, elementKey).map(describeElement);
    if (added.length) lines.push(`New: ${listSome(added)}.`);
    if (removed.length) lines.push(`Gone: ${listSome(removed)}.`);
    lines.push(...stateChanges(before.elements, after.elements).slice(0, 8));
  }
  const beforeText = [...before.headings, ...before.text];
  const afterText = [...after.headings, ...after.text];
  const newText = without(afterText, beforeText, (text) => text);
  if (newText.length) lines.push(`New text: ${newText.slice(0, 5).map((text) => `"${text.slice(0, 100)}"`).join(", ")}.`);
  else if (!lines.length && without(beforeText, afterText, (text) => text).length) lines.push("Some text on the page went away.");
  return lines.length ? lines.join("\n") : "Nothing visible on the page changed.";
}

export const NOTHING_CHANGED = "Nothing visible on the page changed.";

function listSome(items: string[]): string {
  return items.length > 8 ? `${items.slice(0, 8).join(", ")} and ${items.length - 8} more` : items.join(", ");
}

/** Items of `list` left after matching each item of `other` once. */
function without<T>(list: T[], other: T[], key: (item: T) => string): T[] {
  const counts = new Map<string, number>();
  for (const item of other) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return list.filter((item) => {
    const left = counts.get(key(item)) ?? 0;
    if (left === 0) return true;
    counts.set(key(item), left - 1);
    return false;
  });
}

function stateChanges(before: SnapElement[], after: SnapElement[]): string[] {
  const unique = (elements: SnapElement[]) => {
    const byKey = new Map<string, SnapElement | null>();
    for (const element of elements) byKey.set(elementKey(element), byKey.has(elementKey(element)) ? null : element);
    return byKey;
  };
  const was = unique(before);
  const changes: string[] = [];
  for (const [key, element] of unique(after)) {
    const old = was.get(key);
    if (!element || !old) continue;
    const gained = (element.state ?? []).filter((state) => !old.state?.includes(state));
    const lost = (old.state ?? []).filter((state) => !element.state?.includes(state));
    if (!gained.length && !lost.length) continue;
    const parts: string[] = [];
    if (gained.length) parts.push(`is now ${gained.join(", ")}`);
    if (lost.length) parts.push(`is no longer ${lost.join(", ")}`);
    changes.push(`${describeElement(element)} ${parts.join(" and ")}.`);
  }
  return changes;
}

function chooseText(blocks: { text: string; visible: boolean }[]): string[] {
  const seen = new Set<string>();
  const keep = new Set<number>();
  let total = 0;
  // On-screen text gets the budget first, and the result stays in page order.
  for (const wantVisible of [true, false]) {
    blocks.forEach((block, index) => {
      if (block.visible !== wantVisible || seen.has(block.text) || total + block.text.length > MAX_TEXT_CHARS) return;
      seen.add(block.text);
      keep.add(index);
      total += block.text.length;
    });
  }
  return blocks.filter((_, index) => keep.has(index)).map((block) => block.text);
}

/** Text directly inside an element, not in its child elements. */
function ownText(el: Element): string {
  let text = "";
  for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
}

function isRendered(el: Element): boolean {
  // Opacity isn't checked on purpose: row actions that fade in on hover are real controls.
  if (typeof el.checkVisibility === "function") return el.checkVisibility({ visibilityProperty: true });
  return el.getClientRects().length > 0;
}

function roleOf(el: Element, explicitRole: string, pointerStartsHere: boolean): string {
  if (INTERACTIVE_ROLES.has(explicitRole)) return explicitRole;
  const tag = el.tagName;
  if (tag === "A" && el.hasAttribute("href")) return "link";
  if (tag === "BUTTON" || tag === "SUMMARY") return "button";
  if (tag === "SELECT") return "select";
  if (tag === "TEXTAREA") return "textbox";
  if (tag === "INPUT") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    return type in ROLE_FOR_INPUT ? (ROLE_FOR_INPUT[type] ?? "") : "textbox";
  }
  if ((el as HTMLElement).isContentEditable && !(el.parentElement as HTMLElement | null)?.isContentEditable) return "textbox";
  // A link with no address is still a link to whoever is looking at it: the app handles the click itself.
  if (tag === "A" && (el.hasAttribute("onclick") || pointerStartsHere || isFocusable(el))) return "link";
  if (el.hasAttribute("onclick") || pointerStartsHere) return "clickable";
  // Something the keyboard can land on is there to be used, whatever it looks like: a row, a card, a tile.
  if (isFocusable(el) && !FOCUSABLE_NOT_CLICKABLE.has(tag) && !scrolls(el)) return "clickable";
  return "";
}

/** A tag the browser itself treats as a control. */
function isNative(el: Element): boolean {
  const tag = el.tagName;
  return (tag === "A" && el.hasAttribute("href")) || tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "SUMMARY";
}

/** Lists, grids and menus whose entries take turns at being the one the Tab key lands on. */
const ROVING = new Set(["list", "listbox", "grid", "treegrid", "tree", "menu", "menubar", "tablist", "toolbar", "radiogroup"]);

/**
 * Given a place in the tab order on purpose. In a list that the arrow keys
 * move through, only one entry has that place at a time and the rest are
 * marked -1, so there a -1 means the same thing.
 */
function isFocusable(el: Element): boolean {
  const tabindex = el.getAttribute("tabindex");
  if (tabindex === null) return false;
  if (Number(tabindex) >= 0) return true;
  const parent = el.parentElement;
  if (!parent) return false;
  if (ROVING.has(parent.getAttribute("role") ?? "") || parent.tagName === "UL" || parent.tagName === "OL" || parent.tagName === "TBODY") {
    return Array.from(parent.children).some((other) => other !== el && other.tagName === el.tagName && other.hasAttribute("tabindex"));
  }
  return false;
}

/** A box that scrolls is given a tabindex so the keyboard can scroll it. */
function scrolls(el: Element): boolean {
  const overflow = getComputedStyle(el).overflowY;
  return (overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight + 4;
}

/** Whether the element is what a click at its middle would reach, which is not so for anything behind a dialog's backdrop. */
function onTop(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  const hit = document.elementFromPoint(x, y);
  return !!hit && (el.contains(hit) || hit.contains(el));
}

/** The choices of a real <select>. They are the page's own words, not the visitor's: which one is chosen is never read. */
function optionsOf(el: Element): string[] {
  if (!(el instanceof HTMLSelectElement)) return [];
  return Array.from(el.options)
    .map((option) => cleanText(option.label || option.text, MAX_OPTION_CHARS))
    .filter(Boolean)
    .slice(0, MAX_OPTIONS);
}

/**
 * A table whose rows open what they show often makes every cell clickable,
 * which lists one row ten times over, most of them with nothing to say. The
 * cells of one row become one entry, named by what the row says.
 */
function mergeCells(candidates: Candidate[]): Candidate[] {
  const isCell = (c: Candidate) => c.role === "clickable" && !c.icon && c.el.matches('td, [role="cell"], [role="gridcell"]');
  const byRow = new Map<Element, Candidate[]>();
  for (const c of candidates) {
    if (!isCell(c)) continue;
    const row = c.el.closest('tr, [role="row"]');
    if (row) byRow.set(row, [...(byRow.get(row) ?? []), c]);
  }
  const dropped = new Set<Candidate>();
  for (const cells of byRow.values()) {
    if (cells.length < 2) continue;
    const named = cells.filter((c) => c.label);
    const keep = named[0];
    for (const c of cells) if (c !== keep) dropped.add(c);
    if (keep) keep.label = cleanText(named.map((c) => c.label).join(" "), 80);
  }
  return dropped.size ? candidates.filter((c) => !dropped.has(c)) : candidates;
}

/**
 * Tells apart controls that would otherwise be listed word for word the same,
 * by the row, card or entry each sits in: "Remove [row: Priya]". Without it a
 * table with the same button on every line is a list of identical buttons.
 */
function nameRows(candidates: Candidate[]) {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = `${c.role}|${c.label}|${c.icon ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const c of group) {
      const row = c.el.parentElement?.closest(ROW);
      if (!row) continue;
      // A row that is itself listed, or holds a listed box around this control, has already said what it is.
      const around = candidates.find((other) => other !== c && other.label && other.el !== c.el && other.el.contains(c.el) && (row.contains(other.el) || other.el === row));
      const name = around ? cleanText(around.label, 40) : rowName(row, c.el);
      if (name) c.context = [c.context, `row: ${name}`].filter(Boolean).join(" › ");
    }
  }
}

/** What a row is about: its heading, or else the first words in it that are not a control's. */
function rowName(row: Element, control: Element): string {
  const heading = row.querySelector("h1, h2, h3, h4, h5, h6, th, [role='rowheader'], [role='heading'], [class*='title' i], [class*='name' i], strong, b");
  if (heading && !heading.contains(control)) {
    const text = cleanText(heading.textContent ?? "", 50);
    if (text) return text;
  }
  // The first real words the row says, and failing that the first thing in
  // it: a price, a currency, a date or a masked number says less than a name.
  const pieces: string[] = [];
  const walk = (node: Node) => {
    if (pieces.length >= 6) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = cleanText(node.textContent ?? "", 50);
      if (text.length > 1) pieces.push(text);
      return;
    }
    if (!(node instanceof Element) || node === control || node.getAttribute("aria-hidden") === "true") return;
    if (["BUTTON", "SELECT", "INPUT", "TEXTAREA", "SCRIPT", "STYLE", "svg"].includes(node.tagName)) return;
    for (const child of node.childNodes) walk(child);
  };
  walk(row);
  const letters = (text: string) => (text.replace(/\[(?:number|email)\]/g, "").match(/\p{L}/gu) ?? []).length;
  return pieces.find((text) => letters(text) >= 4) ?? pieces[0] ?? "";
}

/**
 * The words beside a field that say what it is for, when the page has not
 * tied them to it. Forms built from table cells or from a grid of boxes put
 * the caption in the cell or box before the field, and nothing in the markup
 * says so. A tick box or a switch usually has its words after it.
 */
function captionOf(el: Element, after: boolean): string {
  const wordsOf = (node: Element): string => {
    if (node.querySelector("input, select, textarea, button, a[href], [role='button'], [role='combobox'], [contenteditable='true']")) return "";
    const text = cleanText(node.textContent ?? "", 61);
    return text.length > 60 ? "" : text.replace(/\s*[:*]+$/, "");
  };
  let node: Element | null = el;
  for (let depth = 0; depth < 4 && node && node !== document.body; depth++) {
    const step = (from: Element) => (after ? from.nextElementSibling : from.previousElementSibling);
    for (let beside = step(node), tried = 0; beside && tried < 2; beside = step(beside), tried++) {
      const text = wordsOf(beside);
      if (text) return text;
      // Another field's box: the caption beyond it belongs to that field.
      if (beside.querySelector("input, select, textarea")) break;
    }
    // Bare words sitting next to the field inside the same box.
    const loose = Array.from(node.parentElement?.childNodes ?? [])
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => cleanText(child.textContent ?? "", 61))
      .find((text) => text.length > 1 && text.length <= 60);
    if (loose) return loose.replace(/\s*[:*]+$/, "");
    node = node.parentElement;
    if (node && ["FORM", "TABLE", "TBODY", "FIELDSET", "UL", "OL"].includes(node.tagName)) break;
  }
  return "";
}

/** A field's name attribute as words, when it is made of words: "customer.phoneNumber" is, "_r_4_" is not. */
function wordsOfName(name: string): string {
  if (!name || /^[:_]|\d{3,}/.test(name)) return "";
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 1 && !["input", "field", "txt", "text", "value", "data", "form", "id"].includes(word));
  return words.length ? words.join(" ") : "";
}

/** True for fields the user fills in or picks from, where a click alone isn't the action. */
export function isField(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset", "image"].includes(el.type);
  return (el as HTMLElement).isContentEditable;
}

/**
 * A label's own words. When the label wraps its field, the field's options or
 * contents are part of the label's text, and those must not end up in its name.
 * Neither must decoration hidden from screen readers, like the star on a required field.
 */
function labelWords(label: Element): string {
  let text = "";
  for (const node of label.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
    else if (node instanceof Element && !node.matches('select, textarea, input, button, datalist, output, [aria-hidden="true"]')) text += labelWords(node);
  }
  return text;
}

function labelOf(el: Element, role: string): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  const byIds = (ids: string) => ids.split(/\s+/).map((id) => root.getElementById?.(id)?.textContent ?? "").join(" ").trim();
  let raw = el.getAttribute("data-haptic-label") || byIds(el.getAttribute("aria-labelledby") ?? "") || el.getAttribute("aria-label")?.trim() || "";
  const ticks = role === "checkbox" || role === "radio" || role === "switch";
  if (!raw && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
    // A label can carry its words as an aria-label of its own.
    raw = Array.from(el.labels ?? []).map((label) => labelWords(label).trim() || label.getAttribute("aria-label") || "").join(" ").trim();
    // A button's value is its caption, not user data.
    if (!raw && el instanceof HTMLInputElement && role === "button") raw = el.value || el.type;
    if (!raw && ticks) raw = captionOf(el, true) || captionOf(el, false);
    raw ||= el.getAttribute("placeholder") || el.getAttribute("title") || "";
    if (!raw && !ticks) raw = captionOf(el, false);
    // The name attribute is for the server, but when it reads as words it is better than nothing.
    raw ||= wordsOfName(el.getAttribute("name") ?? "");
  }
  // Never use a field's contents as its label.
  if (!raw && role !== "textbox" && role !== "select") raw = visibleText(el).trim();
  raw ||= el.getAttribute("title") || (el instanceof HTMLImageElement ? el.alt : el.querySelector("img[alt]")?.getAttribute("alt")) || el.querySelector("svg title")?.textContent || "";
  // A custom field or tick box, built from boxes with no words of its own.
  if (!raw.trim() && (role === "textbox" || role === "combobox" || role === "searchbox" || role === "spinbutton" || role === "slider" || ticks)) raw = captionOf(el, ticks) || captionOf(el, !ticks);
  // Some pages hand over text that has been escaped twice.
  raw = raw.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return cleanText(raw, 80);
}

function visibleText(el: Element): string {
  let text = "";
  const walk = (node: Node) => {
    if (text.length > 160) return;
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
    if (!(node instanceof Element)) return;
    if (node.getAttribute("aria-hidden") === "true" || ["SCRIPT", "STYLE", "svg", "INPUT", "TEXTAREA", "SELECT"].includes(node.tagName)) return;
    for (const child of node.childNodes) walk(child);
    text += " ";
  };
  for (const child of el.childNodes) walk(child);
  return text;
}

/** Icon-only buttons are common in dashboards. The icon's class name is often the only clue. */
function iconOf(el: Element): string | undefined {
  for (const candidate of [el, ...Array.from(el.querySelectorAll("svg, i, [class*='icon']")).slice(0, 4)]) {
    const dataIcon = candidate.getAttribute("data-icon");
    if (dataIcon) return dataIcon;
    const match = ICON_CLASS.exec(candidate.getAttribute("class") ?? "");
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/**
 * What using a control opens, when the page says so: a menu, a list or a
 * dialog. A field says it only because it suggests entries as it is typed in,
 * and its role has already said that.
 */
function opens(el: Element, role: string): string {
  const popup = (el.getAttribute("aria-haspopup") ?? "").toLowerCase();
  if (!popup || popup === "false" || role === "combobox" || role === "textbox" || role === "searchbox" || role === "select") return "";
  if (popup === "dialog") return "opens a dialog";
  return popup === "listbox" || popup === "tree" || popup === "grid" ? "opens a list" : "opens a menu";
}

/** A state is at most 16 characters: the server cuts anything longer. */
function stateOf(el: Element, role: string): string[] {
  const state: string[] = [];
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") state.push("disabled");
  const popup = opens(el, role);
  if (popup) state.push(popup);
  const expanded = el.getAttribute("aria-expanded");
  if (expanded === "true") state.push("expanded");
  else if (expanded === "false") state.push("collapsed");
  const current = el.getAttribute("aria-current");
  if (current && current !== "false") state.push("current");
  if (el.getAttribute("aria-selected") === "true") state.push("selected");
  if (el.getAttribute("aria-pressed") === "true") state.push("pressed");
  const checkable = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
  if ((checkable && el.checked) || el.getAttribute("aria-checked") === "true") state.push("checked");
  if (el instanceof HTMLDetailsElement ? el.open : el.tagName === "SUMMARY" && (el.parentElement as HTMLDetailsElement | null)?.open) state.push("expanded");
  return state;
}

function hrefOf(el: Element): string | undefined {
  if (!(el instanceof HTMLAnchorElement)) return undefined;
  // A link that opens a menu or unfolds a section does that when clicked. The
  // address it carries is for a browser without scripts, and would be taken for where a click leads.
  if (el.hasAttribute("aria-expanded") || !["", "false"].includes((el.getAttribute("aria-haspopup") ?? "").toLowerCase())) return undefined;
  const raw = el.getAttribute("href");
  if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return undefined;
  try {
    const url = new URL(el.href, location.href);
    return url.origin === location.origin ? normalizePath(url.pathname) + whichPage(url.searchParams) : `external:${url.hostname}`;
  } catch {
    return undefined;
  }
}

/**
 * The part of a link's query that says where it leads, on sites that send
 * every page through one address: "?action=history". Short, wordlike values
 * only, so that ids, tokens and search text stay out.
 */
function whichPage(params: URLSearchParams): string {
  const kept: string[] = [];
  for (const [key, value] of params) {
    if (kept.length === 2) break;
    if (!/^[A-Za-z][\w-]{0,15}$/.test(key) || !/^[A-Za-z][A-Za-z_:.-]{0,29}$/.test(value)) continue;
    kept.push(`${key}=${value}`);
  }
  return kept.length ? `?${kept.join("&")}` : "";
}

export function findOpenModal(ignore: Element): Element | undefined {
  const modals: Element[] = [];
  try {
    document.querySelectorAll("dialog:modal").forEach((el) => modals.push(el));
  } catch {
    // :modal unsupported. ARIA modals below still work.
  }
  document.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach((el) => {
    if (ignore.contains(el) || !isRendered(el)) return;
    // Many dialogs never say they are modal. One that sits over the middle of the page, with the page dimmed or blocked behind it, is.
    if (el.getAttribute("aria-modal") === "true" || coversThePage(el, ignore)) modals.push(el);
  });
  return modals[modals.length - 1];
}

/** Whether a dialog has taken the page over: the middle of the window is the dialog, or a backdrop drawn with it. */
function coversThePage(dialog: Element, ignore: Element): boolean {
  const rect = dialog.getBoundingClientRect();
  if (rect.width < 120 || rect.height < 60) return false;
  const hits = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2).filter((el) => !ignore.contains(el));
  const top = hits[0];
  if (!top) return false;
  if (dialog.contains(top)) return true;
  // A backdrop is a sibling or an ancestor's sibling of the dialog, covering the window.
  const cover = top.getBoundingClientRect();
  const coversWindow = cover.width >= window.innerWidth * 0.95 && cover.height >= window.innerHeight * 0.95;
  if (!coversWindow || top === document.body || top === document.documentElement) return false;
  // Either it lies beside the dialog, or it wraps the dialog and is pinned to the window.
  return !top.contains(dialog) || getComputedStyle(top).position === "fixed";
}

function dialogLabel(el: Element): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  const raw =
    el.getAttribute("aria-label") ||
    (labelledBy && document.getElementById(labelledBy)?.textContent) ||
    el.querySelector("h1, h2, h3, [role='heading']")?.textContent ||
    "";
  return cleanText(raw, 60);
}
