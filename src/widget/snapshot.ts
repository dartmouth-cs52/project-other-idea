import { cleanText as maskAndTrim, describeElement, normalizePath, namedIn, type SnapElement, type Snapshot } from "../shared/types.ts";

// Turns the live page into the list of elements the model sees. One read-only
// pass over the DOM. What a visitor typed is never read: not the value of a
// field, and not the words inside an editor. Every piece of text taken from
// the page goes through `wordsIn`, which passes over both.

const MAX_ELEMENTS = 300;

// A frame from the page's own origin is read as part of the page, and what is in it comes from another window. So
// what a node is, is told from the node itself, never from which window's constructor made it.
const isElement = (node: unknown): node is Element => (node as Node | null | undefined)?.nodeType === 1;
const isDocument = (node: unknown): node is Document => (node as Node | null | undefined)?.nodeType === 9;
const isShadowRoot = (node: unknown): node is ShadowRoot => (node as Node | null | undefined)?.nodeType === 11 && !!(node as ShadowRoot).host;
const HTML = "http://www.w3.org/1999/xhtml";
function isTag<K extends keyof HTMLElementTagNameMap>(node: unknown, tag: K): node is HTMLElementTagNameMap[K] {
  return isElement(node) && node.namespaceURI === HTML && node.localName === tag;
}
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
const MAYBE_CLICKABLE = new Set(["DIV", "SPAN", "LI", "IMG", "TD", "TR", "TH", "P", "I", "A", "SECTION", "ARTICLE", "LABEL"]);
/** Tags that take a tabindex so that they can be scrolled or jumped to, not so that they can be clicked. */
const FOCUSABLE_NOT_CLICKABLE = new Set(["BODY", "MAIN", "PRE", "CODE", "TABLE", "FORM", "DIALOG"]);
const ICON_CLASS =
  /(?:^|\s)(?:lucide|tabler-icon|bi|ri|fa|mdi|pi|ti|anticon|aui-iconfont|oo-ui-icon|glyphicon|codicon|octicon|icon)-(?!solid|regular|brands|fw|lg|sm|xs|spin|btn|button|default|container|wrapper|small|medium|large|only)([a-z][a-z0-9-]*)/;
/** What repeats down a page: the row, card or entry a control sits in. */
const ROW = 'tr, li, article, [role="row"], [role="listitem"], [role="option"], [role="treeitem"], [role="gridcell"]';
/** A select's choices are part of the page, so they are listed: this many, each this long. */
const MAX_OPTIONS = 12;
const MAX_OPTION_CHARS = 30;
/** Controls far down a region that is all links, like a list of related pages, wait behind the rest of the page. */
const REGION_SHARE = 40;

/** Tags whose contents are never words on the page: code, a drawing, a dropdown's choices. */
const NOT_WORDS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SELECT", "svg"]);
/** Tags whose contents are code or markup for later, never words, wherever they stand. */
const CODE_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);
/** Tags that only style a few words within a sentence, so no space is owed after them. */
const WITHIN_A_SENTENCE = new Set(["B", "I", "EM", "STRONG", "U", "S", "SUB", "SUP", "MARK", "SMALL", "CODE", "ABBR", "CITE", "Q", "VAR", "KBD", "WBR"]);

/**
 * Whether an element holds what a visitor wrote: an input, a text area, an
 * editor, or a box that says it is a text field. Nothing is ever read from
 * inside one, because Haptic's promise is that it never reads what is typed.
 * Such a control is named by what its page calls it, or by nothing.
 */
function holdsTyping(el: Element): boolean {
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable === true) return true;
  const role = el.getAttribute("role");
  return !!role && /(?:^|\s)(?:textbox|searchbox)(?:\s|$)/.test(role);
}

/** Whether an element sits inside an editor, even as a part the visitor cannot edit, like a name they mentioned. */
function insideEditor(el: Element): boolean {
  for (let host = el.closest("[contenteditable]"); host; host = host.parentElement?.closest("[contenteditable]") ?? null) {
    if ((host as HTMLElement).isContentEditable) return true;
  }
  return false;
}

const MAX_NODES_FOR_WORDS = 600;

/**
 * Whether an element's words are out of sight, though a screen reader may still
 * read them: not shown at all, or squeezed into a box of a pixel or none and
 * clipped, cut off or set at no size. That is how pages hide words meant only
 * for screen readers, like "Emphasized" before a price. Only a box that small
 * is looked at further, so this costs little.
 */
function unseen(el: Element): boolean {
  const box = el.getBoundingClientRect();
  if (box.width > 1 || box.height > 1) return false;
  const style = getComputedStyle(el);
  if (style.display === "contents") return false;
  return style.display === "none" || style.overflow === "hidden" || style.overflow === "clip" || (style.clip !== "" && style.clip !== "auto") || style.clipPath !== "none" || parseFloat(style.fontSize) === 0;
}

/**
 * The words in an element as a person reads them, and never anything a
 * visitor typed. An input, a text area and an editor are passed over, and so
 * are a dropdown's choices, anything hidden from screen readers and, unless
 * `unseenToo` is set, words that are out of sight (see `unseen`). Set it to
 * read a name meant for screen readers, such as a label or what
 * aria-labelledby points to. `skip` is a selector for more to pass over, and
 * `except` one element to pass over. Reading stops once `max` characters are in hand.
 */
function wordsIn(el: Element, max = 200, skip = "", except?: Element, unseenToo = false): string {
  // A script beside a field is code, not its caption. A select's choice is the visitor's.
  if (CODE_TAGS.has(el.tagName) || holdsTyping(el) || insideEditor(el) || choiceBoxes.has(el)) return "";
  let text = "";
  let visited = 0;
  const walk = (node: Node) => {
    // A box can hold thousands of nodes and no words. Looking stops well before that costs anything.
    if (text.length > max || visited++ > MAX_NODES_FOR_WORDS) return;
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    if (!isElement(node) || node === except) return;
    if (NOT_WORDS.has(node.tagName) || holdsTyping(node) || choiceBoxes.has(node) || node.getAttribute("aria-hidden") === "true" || (skip && node.matches(skip))) return;
    if (!unseenToo && unseen(node)) return;
    // Words in a box of their own are apart from the words before and after it, as the accessibility tree has them:
    // a tab's "My cards" and the count in its badge are "My cards 3", not "My cards3". Words styled within a line are not.
    let apart: boolean | undefined;
    const ownBox = () => (apart ??= boxOfItsOwn(node));
    if (text && !/\s$/.test(text) && ownBox()) text += " ";
    for (const child of shownChildren(node)) walk(child);
    if (!WITHIN_A_SENTENCE.has(node.tagName) || ownBox()) text += " ";
  };
  for (const child of shownChildren(el)) walk(child);
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Whether an element is laid out as a box of its own, apart from the line of
 * words around it: a block, a flex or grid item, or an inline block like a
 * badge. A box that only styles a few words, or has no box at all, is not.
 */
function boxOfItsOwn(el: Element): boolean {
  const display = getComputedStyle(el).display;
  return display !== "inline" && display !== "contents";
}

/**
 * What is shown inside an element. A component with a shadow root shows what
 * its shadow root holds, and what the page put into the component is shown
 * where a <slot> in there says: the words of an option among them, and the
 * slot's own content only when the page put nothing there.
 */
function shownChildren(el: Element): Iterable<Node> {
  if (el.tagName === "SLOT") {
    const assigned = (el as HTMLSlotElement).assignedNodes?.({ flatten: true }) ?? [];
    if (assigned.length) return assigned;
  }
  return el.shadowRoot?.childNodes ?? el.childNodes;
}

/**
 * What a control says, for telling the model which one a visitor clicked. It
 * is masked like everything else, and is empty for anything a visitor typed in.
 */
export function shownWords(el: Element, max = 60): string {
  return cleanText(wordsIn(el, max * 2) || wordsIn(el, max * 2, "", undefined, true), max);
}

/**
 * What a reading would call a day picked in a calendar that a field opened
 * after the page was read: a cell a pointer starts on, in a row of at least
 * three like it. Empty for anything else, and above all for an entry of a
 * list, which can repeat what the visitor typed into the field that opened
 * it. A calendar's days are its own words. The name is masked like every name.
 */
export function nameOfPicked(el: Element): string {
  if (!el.matches('td, [role="gridcell"], [role="cell"]') || holdsTyping(el) || insideEditor(el)) return "";
  const startsPointer = (cell: Element) => getComputedStyle(cell).cursor === "pointer" && !!cell.parentElement && getComputedStyle(cell.parentElement).cursor !== "pointer";
  if (!startsPointer(el)) return "";
  const like = Array.from(el.parentElement?.children ?? []).filter((cell) => cell.tagName === el.tagName && startsPointer(cell));
  return like.length >= MIN_ROW_OF_LIKE ? cleanText(labelOf(el, "clickable"), 60) : "";
}

// Controls that show only while the mouse is over the box around them --------

/** A stylesheet rule that shows something while the mouse is over a box around it, or the keyboard is inside that box. */
interface Reveal {
  /** The rule's selector with the mouse and keyboard conditions taken out: what it shows. */
  shown: string;
  /** The part of the selector that picks the box the mouse has to be over. */
  box: string;
  visibility: boolean;
  opacity: boolean;
}

/** What marks a rule as one of these. `:not(:hover)` and the like, where it sits inside brackets, mean something else and are passed over. */
const OVER = /:(?:hover|focus-within)(?![\w-])/g;
/** Stylesheets are read once and read again only when their rules have changed. A page can have thousands of rules. */
const REVEALS = new WeakMap<Document | ShadowRoot, { stamp: string; rules: Reveal[] }>();
const MAX_RULES_READ = 20_000;
/** How many hidden boxes are checked against those rules while one page is read. */
const MAX_HIDDEN_CHECKED = 200;
/** The state such a control is listed with. */
const SHOWS_ON_HOVER = "shows on hover";

/** A selector list cut at its commas, leaving alone the commas inside brackets. */
function selectorParts(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(list.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(list.slice(from));
  return parts;
}

/**
 * Reads one selector such as ".panel:hover .menu" as "the mouse over .panel
 * shows .menu". Nothing is returned when the mouse would have to be over the
 * hidden thing itself, or over something beside it and not around it.
 */
function readReveal(part: string): Pick<Reveal, "shown" | "box"> | undefined {
  let end = -1;
  for (const match of part.matchAll(OVER)) {
    let depth = 0;
    for (let i = 0; i < match.index; i++) depth += part[i] === "(" || part[i] === "[" ? 1 : part[i] === ")" || part[i] === "]" ? -1 : 0;
    if (depth > 0) return undefined;
    end = match.index + match[0].length;
  }
  if (end < 0) return undefined;
  // The box is everything up to the end of the piece that carries the condition.
  let depth = 0;
  let cut = end;
  for (; cut < part.length; cut++) {
    const ch = part[cut] ?? "";
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(ch)) break;
  }
  const rest = part.slice(cut);
  if (!rest.trim()) return undefined;
  depth = 0;
  for (const ch of rest) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && (ch === "+" || ch === "~")) return undefined;
  }
  const box = part.slice(0, cut).replace(OVER, "").trim();
  return box ? { shown: part.replace(OVER, "").trim(), box } : undefined;
}

/** The rules, among the stylesheets of a document or a shadow root, that show something while the mouse is over a box. */
function revealsIn(root: Document | ShadowRoot): Reveal[] {
  const lists: CSSRuleList[] = [];
  let stamp = "";
  for (const sheet of [...Array.from(root.styleSheets ?? []), ...(root.adoptedStyleSheets ?? [])]) {
    try {
      const rules = sheet.cssRules;
      lists.push(rules);
      stamp += `${rules.length},`;
    } catch {
      // A stylesheet from another site cannot be read. What it hides stays unlisted.
      stamp += "x,";
    }
  }
  const known = REVEALS.get(root);
  if (known?.stamp === stamp) return known.rules;

  const found: Reveal[] = [];
  let read = 0;
  const walk = (rules: CSSRuleList, depth: number) => {
    for (let i = 0; i < rules.length && read < MAX_RULES_READ; i++) {
      const rule = rules[i] as CSSRule & { selectorText?: string; style?: CSSStyleDeclaration; cssRules?: CSSRuleList; media?: MediaList };
      read++;
      const selector = rule.selectorText;
      if (typeof selector === "string") {
        if (!rule.style || (selector.indexOf(":hover") < 0 && selector.indexOf(":focus-within") < 0)) continue;
        const visibility = rule.style.visibility === "visible";
        const opacity = rule.style.opacity !== "" && Number(rule.style.opacity) > 0;
        if (!visibility && !opacity) continue;
        for (const part of selectorParts(selector)) {
          const reveal = readReveal(part);
          if (reveal) found.push({ ...reveal, visibility, opacity });
        }
      } else if (depth < 3 && rule.cssRules) {
        // Rules for another kind of screen do not apply here.
        if (rule.media?.mediaText && !window.matchMedia(rule.media.mediaText).matches) continue;
        walk(rule.cssRules, depth + 1);
      }
    }
  };
  try {
    for (const rules of lists) walk(rules, 0);
  } catch {
    // A rule this browser cannot be asked about. What was found so far stands.
  }
  REVEALS.set(root, { stamp, rules: found });
  return found;
}

/**
 * The box a hidden element shows in when the mouse is over it, if a
 * stylesheet says so: a menu button that a panel shows only while the mouse
 * is over the panel. `seeThrough` is whether the element is also fully
 * transparent, which the same rules then have to undo.
 */
function shownWhenOver(el: Element, hiddenByVisibility: boolean, seeThrough: boolean): DOMRect | undefined {
  const root = el.getRootNode();
  if (!isDocument(root) && !isShadowRoot(root)) return undefined;
  let box: Element | undefined;
  let visibility = false;
  let opacity = false;
  for (const rule of revealsIn(root)) {
    try {
      if (!el.matches(rule.shown)) continue;
      const over = el.parentElement?.closest(rule.box);
      if (!over) continue;
      box ??= over;
      visibility ||= rule.visibility;
      opacity ||= rule.opacity;
    } catch {
      // A selector that cannot be read once the condition is taken out of it.
    }
  }
  if (!box || (hiddenByVisibility && !visibility) || (seeThrough && !opacity)) return undefined;
  return box.getBoundingClientRect();
}

/** Whether one box lies inside another, give or take a pixel. */
function liesInside(inner: DOMRect, outer: DOMRect): boolean {
  return inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
}

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
  /** The heading the control comes under. */
  heading: string;
  /** What tells it apart from others listed the same: the row it is in, or the words beside it. */
  row?: string;
  /** Its place among controls that nothing else tells apart: "2 of 3". */
  place?: string;
  /** Outside the open dialog. Kept only if it is drawn on top of it, like a list the dialog opened. */
  outside: boolean;
  /** Its name is the name of the box it is in, as it has none of its own. */
  boxNamed?: boolean;
  /** Taken for a control because the pointer cursor starts on it. */
  pointer?: boolean;
  /** One of the like things a box the keyboard moves through holds, each a control of its own: a calendar's day. */
  single?: boolean;
  /** Found by its pointer inside a box the keyboard moves through, and kept only if that box is a grid of such things. */
  loose?: boolean;
  /** Why it cannot be used, when it cannot and the page says why: "Only Admin can do this." */
  why?: string;
  /** Where in the window a control with no name and no picture sits: "top right". */
  spot?: string;
  /** Its box when it was read, in its own document's window. */
  rect: DOMRect;
  /** The frame it is in, when it is in a frame of the page's own origin. */
  frame?: FrameView;
}

/** A frame of the page's own origin being read: where its window starts in the page's window, and how large it is. */
interface FrameView {
  el: Element;
  dx: number;
  dy: number;
  width: number;
  height: number;
}

/** A box of a frame's document, where it lies in the page's window. */
function inPageWindow(rect: DOMRect, frame: FrameView | undefined): DOMRect {
  return frame ? new DOMRect(rect.x + frame.dx, rect.y + frame.dy, rect.width, rect.height) : rect;
}

/** Controls with a role of their own, whose words are theirs and not the words of a box around them. */
const HAS_A_ROLE = '[role]:not([role="presentation"]):not([role="none"]), input, select, textarea, button, a[href]';

/**
 * The control with a role of its own inside `outer`, when `outer` says nothing
 * but what the controls inside it say. A box the page names itself, like a
 * pager's "Next Page" around a button that shows only an arrow, is not a frame.
 */
function framed(outer: Candidate, within: Candidate[]): Candidate | undefined {
  if (["title", "aria-label", "aria-labelledby"].some((name) => outer.el.hasAttribute(name))) return undefined;
  const inner = within.find((c) => c.role !== "clickable");
  return inner && !wordsIn(outer.el, 160, HAS_A_ROLE) ? inner : undefined;
}

/** A clickable box inside `outer`, named otherwise, that shows the words `outer` is named by. Only a small box, like a select's, is looked into. */
function showingTheSame(outer: Candidate, within: Candidate[]): Candidate | undefined {
  if (!outer.label || within.length > 3) return undefined;
  return within.find((c) => c.role === "clickable" && !c.boxNamed && c.label !== outer.label && saysMostOf(visibleText(c.el), outer.label));
}

/** Whether controls a pointer goes to lie in rows of at least this many alike, as a calendar's days do. */
const MIN_ROW_OF_LIKE = 3;

/** Whether some of these controls, found by the pointer starting on them, sit side by side in a row of like things. */
function keyedGrid(within: Candidate[]): boolean {
  const rows = new Map<Element, number>();
  for (const c of within) {
    const parent = c.el.parentElement;
    if (!c.pointer || !parent) continue;
    const count = (rows.get(parent) ?? 0) + 1;
    if (count >= MIN_ROW_OF_LIKE) return true;
    rows.set(parent, count);
  }
  return false;
}

/** A piece of page text, whether it is on screen, and its place in the page. */
interface TextBlock {
  text: string;
  visible: boolean;
  order: number;
}

/** How many pieces of page text are gathered before the budget is shared out. Enough for a long article. */
const MAX_TEXT_BLOCKS = 3000;
/** How far into a block of text its words are looked for. */
const MAX_NODES_FOR_SENTENCE = 400;
const ROW_CELLS = "td, th, [role='cell'], [role='gridcell'], [role='columnheader'], [role='rowheader']";

/**
 * The words of a block of text, with the words styled within it: a link, a
 * bold name, a footnote. Those are what the browser lays out in the line, and
 * leaving them out leaves holes in the sentence. Each element read this way is
 * put in `taken`, so that its words are not sent a second time on their own.
 * A block that says nothing but what its links say gives nothing: those are
 * listed as controls. Nothing inside a field, an editor or a part hidden from
 * screen readers is read.
 */
function sentenceOf(el: Element, taken: WeakSet<Element>): string {
  let text = "";
  let own = false;
  let visited = 0;
  const walk = (node: Element, inControl: boolean) => {
    for (const child of node.childNodes) {
      if (visited++ > MAX_NODES_FOR_SENTENCE) return;
      if (child.nodeType === Node.TEXT_NODE) {
        const words = child.textContent ?? "";
        text += words;
        if (!inControl && /[\p{L}\p{N}]/u.test(words)) own = true;
      } else if (isElement(child)) {
        if (NOT_WORDS.has(child.tagName) || holdsTyping(child) || choiceBoxes.has(child) || child.getAttribute("aria-hidden") === "true" || getComputedStyle(child).display !== "inline") {
          text += " ";
          continue;
        }
        taken.add(child);
        walk(child, inControl || child.matches(CONTROLS));
      }
    }
  };
  if (!choiceBoxes.has(el)) walk(el, false);
  return own ? text.replace(/\s+/g, " ").trim() : "";
}

/**
 * A table row as one line, its cells kept apart: "Hammer | 2 | $14.50". A cell
 * of one or two characters, or one that says what the cell above it said, is
 * what the row is about as much as any other.
 */
function rowTextOf(row: Element): string {
  const cells = Array.from(row.children).filter((cell) => cell.matches(ROW_CELLS));
  if (cells.length < 2) return "";
  const words = cells.map((cell) => wordsIn(cell, 80, CONTROLS.replace("a[href], ", "")));
  return words.some((piece) => /[\p{L}\p{N}]/u.test(piece)) ? words.join(" | ") : "";
}

/** The server keeps this much of a control's surroundings, so the parts are fitted to it here. */
const MAX_CONTEXT = 120;

/**
 * A control's surroundings in one line: the region, the heading, why it cannot
 * be used, the row and its place among its like. When that is too long the
 * heading gives way, because the rest is what tells two controls apart and
 * what a visitor asks about one that is grey. Why it cannot be used goes here
 * and not in its state: the server on main keeps 16 characters of a state,
 * and 120 of the surroundings.
 */
function contextOf(c: Candidate): string {
  const region = c.region === "page" ? "" : c.region;
  const rest = [c.why ? `disabled: ${c.why}` : "", c.row ? `row: ${c.row}` : "", c.place ?? ""].filter(Boolean);
  const room = MAX_CONTEXT - [region, c.spot ?? "", ...rest].filter(Boolean).join(" › ").length - 3;
  const heading = c.heading.length > room ? (room > 12 ? `${c.heading.slice(0, room - 1).trimEnd()}…` : "") : c.heading;
  return [region, heading, c.spot ?? "", ...rest].filter(Boolean).join(" › ");
}

interface Scope {
  region: string;
  heading: string;
  /** The name of the box the control is in, when that box is set apart and named: a panel, a group, a named landmark. */
  box?: string;
}

/** Controls inside a heading, like a search box and its button in a dialog's title bar. Their words are theirs, not the heading's. */
const NOT_HEADING_WORDS = "button, [role='button'], select, [role='combobox'], [role='checkbox'], [role='switch'], [role='slider']";

/** A heading's own words, leaving out the words of controls set inside it. */
function headingWords(heading: Element): string {
  return cleanText(wordsIn(heading, 160, NOT_HEADING_WORDS), 80);
}

/** A heading on the page, with what decides whether it is among the few that are sent. */
interface Heading {
  text: string;
  /** 1 for the page's title down to 6. */
  level: number;
  visible: boolean;
}

/** The server keeps this many headings. */
const MAX_HEADINGS = 12;

/** Boxes that set a part of the page apart, so that a heading inside one is the heading of that part and of nothing after it. */
const SECTION_TAGS = new Set(["SECTION", "ARTICLE", "FIELDSET"]);
const SECTION_ROLES = new Set(["region", "group", "radiogroup", "article", "tabpanel"]);
const HEADINGS = "h1, h2, h3, h4, h5, h6, [role='heading']";

/** The name a box is given by its page: the element it says names it, or its aria-label. */
function nameOfBox(el: Element): string {
  const ids = el.getAttribute("aria-labelledby");
  if (ids) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const named = ids.split(/\s+/).map((id) => (id ? root.getElementById?.(id) : null)).find(Boolean);
    const words = named ? cleanText(wordsIn(named, 160, "", undefined, true), 80) : "";
    if (words) return words;
  }
  return cleanText(el.getAttribute("aria-label") ?? "", 80);
}

/** Whether a box is named only for screen readers: by its aria-label, with no element named as what names it. */
function namedForScreenReaders(el: Element): boolean {
  return !!el.getAttribute("aria-label")?.trim() && !el.getAttribute("aria-labelledby")?.trim();
}

/**
 * The heading of a box that sets a part of the page apart: its name, its
 * legend, or a heading in the first few boxes inside it, where a panel keeps
 * its title beside its menu. Looked up when the box is entered, so that what
 * comes before the heading inside the box is listed under it too.
 */
function headingOfBox(el: Element): string {
  const name = nameOfBox(el);
  if (name) return name;
  let found: Element | null = null;
  let looked = 0;
  const look = (box: Element, depth: number) => {
    for (const child of box.children) {
      if (found || looked++ > 24) return;
      if (child.matches(depth === 0 ? `legend, ${HEADINGS}` : HEADINGS)) found = child;
      else if (depth < 2 && !SECTION_TAGS.has(child.tagName)) look(child, depth + 1);
    }
  };
  look(el, 0);
  return found ? headingWords(found) : "";
}

/** Which of a long page's headings are sent: the ones on screen first, then the higher levels, kept in page order. */
function chooseHeadings(all: Heading[]): string[] {
  const seen = new Set<string>();
  const unique = all.filter((heading) => !seen.has(heading.text) && seen.add(heading.text));
  if (unique.length <= MAX_HEADINGS) return unique.map((heading) => heading.text);
  const rank = (heading: Heading) => (heading.visible ? 0 : heading.level);
  const keep = new Set(
    unique
      .map((heading, index) => ({ heading, index }))
      .sort((a, b) => rank(a.heading) - rank(b.heading) || a.index - b.index)
      .slice(0, MAX_HEADINGS)
      .map((entry) => entry.heading),
  );
  return unique.filter((heading) => keep.has(heading)).map((heading) => heading.text);
}

/**
 * What the visitor named in their question, for as long as one page is being
 * read. The same email or long number on the page is left readable.
 */
let own: ReadonlySet<string> = new Set();
/** Whether the page being read has a <label> tied to no field, looked up once a reading. Without one, no caption is looked for in labels. */
let untiedLabels = false;
/** Boxes that show the choice made in a select built around a field, looked up once a reading. See `choiceBoxesOf`. */
let choiceBoxes: WeakSet<Element> = new WeakSet();
/**
 * What the visitor's fields hold, in lower case, for as long as one page is
 * being read. It is only compared with the page's words, here in the page,
 * and is never sent or kept: see `echoesTyping`.
 */
let typed: string[] = [];

/** Input types a visitor writes in. A tick box, a button, a file or a hidden field holds nothing typed. */
const NOT_TYPED_IN = new Set(["checkbox", "radio", "button", "submit", "reset", "image", "file", "hidden", "color", "range"]);
/** A value shorter than this is a word too common to tell that the page repeats it. */
const MIN_ECHO = 3;
const MAX_TYPED_FIELDS = 50;

/** How many frames from the page's own origin are read as part of the page. */
const MAX_FRAMES = 10;

/**
 * The page's document and the documents of its frames from the page's own
 * origin, which are read as part of the page: an editor in a frame, a demo, a
 * wall of cookie choices drawn in a frame of the page's own. A frame from
 * another origin cannot be read by any script on the page, and is not.
 */
function documentsOfPage(): Document[] {
  const documents = [document];
  for (const frame of Array.from(document.querySelectorAll("iframe, frame"))) {
    if (documents.length > MAX_FRAMES) break;
    try {
      const inner = (frame as HTMLIFrameElement).contentDocument;
      if (inner?.body && !documents.includes(inner)) documents.push(inner);
    } catch {
      // A frame from another origin.
    }
  }
  return documents;
}

/** The documents being read: the page's, and its frames' from its own origin. Set for one reading. */
let pageDocuments: Document[] = [document];

/** What the fields and editors on the page hold now, each as one lower-case line of words. */
function typedValues(): string[] {
  const values: string[] = [];
  const fields = pageDocuments.flatMap((doc) => Array.from(doc.querySelectorAll("input, textarea, [contenteditable]")));
  for (const field of fields.slice(0, 400)) {
    let value = "";
    if (isTag(field, "input")) value = NOT_TYPED_IN.has(field.type) ? "" : field.value;
    else if (isTag(field, "textarea")) value = field.value;
    else if ((field as HTMLElement).isContentEditable && !insideEditor(field.parentElement ?? field.ownerDocument.body)) value = field.textContent ?? "";
    value = value.replace(/\s+/g, " ").trim().toLowerCase();
    if (value.length >= MIN_ECHO) values.push(value);
    if (values.length >= MAX_TYPED_FIELDS) break;
  }
  return values;
}

/**
 * Whether words of the page repeat what a field holds: a card's preview that
 * shows the name being typed for it, or a total that shows the amount. They
 * are what the visitor typed, so they are not sent as page text. Headings and
 * titles are not held to this: a form that edits a record holds its name, and
 * the page's heading and its dialogs' titles say it too. The value has to stand
 * whole, with no letter or digit run on to it: "Settings" does not repeat a
 * search for "set".
 */
function echoesTyping(words: string): boolean {
  if (!typed.length || words.length < MIN_ECHO) return false;
  const line = words.replace(/\s+/g, " ").toLowerCase();
  const runsOn = (at: number) => at >= 0 && at < line.length && /[\p{L}\p{N}]/u.test(line[at] ?? "");
  return typed.some((value) => {
    for (let at = line.indexOf(value); at >= 0; at = line.indexOf(value, at + 1)) if (!runsOn(at - 1) && !runsOn(at + value.length)) return true;
    return false;
  });
}

/** Fields that open a list and show what was picked from it beside themselves, not in themselves. */
const CHOICE_FIELDS = 'input[role="combobox"], input[aria-haspopup="listbox"], input[aria-haspopup="tree"], input[aria-haspopup="grid"]';

/**
 * The boxes in which a select built around a field draws the visitor's
 * choice: the box the field fills, where the choice is written beside it
 * ("Lucy" beside the field of a select). Nothing in such a box is read, for a
 * name, a caption, a row or page text, since what it says is the visitor's.
 */
function choiceBoxesOf(): WeakSet<Element> {
  const boxes = new WeakSet<Element>();
  for (const field of pageDocuments.flatMap((doc) => Array.from(doc.querySelectorAll(CHOICE_FIELDS))).slice(0, 200)) {
    const box = field.parentElement;
    if (!box || box === field.ownerDocument.body || box.tagName === "LABEL" || box.querySelectorAll("input, select, textarea, label").length > 1) continue;
    const outer = box.getBoundingClientRect();
    const inner = field.getBoundingClientRect();
    if (outer.width * outer.height > 0 && inner.width * inner.height >= (outer.width * outer.height) / 2) boxes.add(box);
  }
  return boxes;
}
const cleanText = (text: string, max = 80): string => maskAndTrim(text, max, own);

/**
 * Reads the page. `ignore` is Haptic's own element. `question` is what the
 * visitor asked: an email or a long number in it is the only one left
 * unmasked. Every reading within one guide has to be given the same question,
 * or one control would be named two ways. `near` is the control last used,
 * whose surroundings are the page text that matters most after the screen:
 * by default the one Haptic's pointer last pointed at, which the pointer
 * keeps on Haptic's element. A reading given no question, as by a tool that
 * reads the page beside the widget, leaves nothing unmasked.
 */
export function takeSnapshot(ignore: Element, question = "", near = (ignore as Element & { pointedAt?: Element }).pointedAt): PageSnapshot {
  own = namedIn(question);
  pageDocuments = documentsOfPage();
  untiedLabels = pageDocuments.some((doc) => Array.from(doc.querySelectorAll("label")).some((label) => !label.hasAttribute("for") && !(label as HTMLLabelElement).control));
  choiceBoxes = choiceBoxesOf();
  typed = typedValues();
  const candidates: Candidate[] = [];
  const headings: Heading[] = [];
  const texts: TextBlock[] = [];
  const viewportHeight = window.innerHeight;
  let visited = 0;
  let hiddenChecked = 0;
  /** Elements whose words were read as part of a sentence around them. */
  const taken = new WeakSet<Element>();
  let order = 0;
  /** How many boxes the keyboard moves through, with no pointer of their own, the element being read is inside. See `keysOnly`. */
  let keysBoxes = 0;
  /** Where in the page's text the control last used sits, if it was given. */
  let nearAt = -1;
  /** How far apart the places of pieces of text are. A part of the page read later fits its pieces between two places. */
  let orderStep = 1;
  const nextOrder = () => {
    const at = order;
    order += orderStep;
    return at;
  };
  // A page with more elements than one reading visits is read where the visitor is first. A part of it wholly above
  // or below the window waits, and is read once the rest has been, with what is left of the budget, in its place.
  let deferring = document.getElementsByTagName("*").length > MAX_VISITED;
  /** The frame being read, while the reading is inside one. */
  let frame: FrameView | undefined;
  /** Whether a box is out of view: out of the frame's own window first, when it is in a frame, then out of the page's. */
  const outOfView = (rect: DOMRect): "above" | "below" | undefined => {
    if (frame && rect.bottom <= 0) return "above";
    if (frame && rect.top >= frame.height) return "below";
    const box = inPageWindow(rect, frame);
    return box.bottom <= 0 ? "above" : box.top >= viewportHeight ? "below" : undefined;
  };
  /** Reads a frame from the page's own origin as part of the page, where it is drawn. A page that is all one editor, as a rich text field's frame is, is named by the frame. */
  const readFrame = (el: Element, scope: Scope, outside: boolean) => {
    let inner: Document | null = null;
    try {
      inner = (el as HTMLIFrameElement).contentDocument;
    } catch {
      inner = null;
    }
    if (frame || !inner?.body || !pageDocuments.includes(inner) || !isRendered(el)) return;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return;
    const style = getComputedStyle(el);
    const [left, top] = [el.clientLeft + parseFloat(style.paddingLeft || "0"), el.clientTop + parseFloat(style.paddingTop || "0")];
    frame = { el, dx: box.left + left, dy: box.top + top, width: el.clientWidth - left + el.clientLeft - parseFloat(style.paddingRight || "0"), height: el.clientHeight - top + el.clientTop - parseFloat(style.paddingBottom || "0") };
    const before = candidates.length;
    try {
      visit(inner.body, { ...scope }, false, false, false, outside);
    } finally {
      frame = undefined;
    }
    const name = cleanText(nameOfBox(el) || el.getAttribute("title") || "", 80);
    for (const c of candidates.slice(before)) if (!c.label && name && (c.el === inner.body || c.el === inner.documentElement)) c.label = name;
  };
  const later: { el: Element; scope: Scope; parentPointer: boolean; outside: boolean; at: number; headingAt: number; orderAt: number }[] = [];

  // With a modal open only the modal is usable, so only the modal is listed,
  // along with anything drawn on top of it: many apps put the list that a
  // dropdown opens at the end of the page, outside the dialog it belongs to.
  const modal = findOpenModal(ignore);
  const root = document.body;

  // `held` collects the page text inside a box that was taken for a control but
  // may yet turn out to be only a wrapper. If it does, its words are page text after all.
  //
  // `hoverBox` is set inside something that shows only while the mouse is over
  // the box around it, and is that box. A control in there is listed if it
  // lies inside the box, so that the visitor's mouse arriving at the pointer
  // is what shows it. A menu that opens somewhere else stays unlisted until it is open.
  const visit = (el: Element, scope: Scope, parentPointer: boolean, insideControl: boolean, inSvg = false, outside = !!modal, held?: TextBlock[], hoverBox?: DOMRect) => {
    if (visited++ > MAX_VISITED || el === ignore) return;
    if ((el.tagName === "IFRAME" || el.tagName === "FRAME") && !insideControl && !hoverBox) return readFrame(el, scope, outside);
    if (SKIP_TAGS.has(el.tagName)) return;
    // Only a part that is not inside a control or a box being read as one waits: what is around it does not depend on it.
    if (deferring && !frame && el.firstElementChild && el !== root && !insideControl && !held && !hoverBox && !inSvg && keysBoxes === 0) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && (box.bottom < 0 || box.top > viewportHeight)) {
        later.push({ el, scope: { ...scope }, parentPointer, outside, at: candidates.length, headingAt: headings.length, orderAt: order });
        order += 1;
        visited--;
        return;
      }
    }
    if (el === near) nearAt = order;
    /** Hidden from screen readers, but there for the mouse: a search box's magnifying glass. */
    let pressableOnly = false;
    if (el.hasAttribute("inert") || el.hasAttribute("data-haptic-ignore") || el.getAttribute("aria-hidden") === "true") {
      // An app hides the page behind its dialog this way, and the dialog itself is inside what it hid only by mistake.
      if (!modal || !drawnWithin(el, modal) || el === modal) {
        const forMouse = !el.hasAttribute("inert") && !el.hasAttribute("data-haptic-ignore") && !insideControl && !parentPointer && !outside && !hoverBox;
        if (!forMouse || !pressableThoughHidden(el, ignore)) return;
        pressableOnly = true;
      }
    }
    if (el === modal) outside = false;
    // A drawing is not read, but controls and ordinary page content placed inside one are.
    const svg = el.tagName === "svg" || (inSvg && el.tagName !== "foreignObject");
    if (hoverBox ? !hasBox(el) : !isRendered(el)) {
      // Hidden, but with a box: a stylesheet may show it while the mouse is over the box around it.
      if (!hoverBox && hiddenChecked < MAX_HIDDEN_CHECKED && hasBox(el)) {
        hiddenChecked++;
        hoverBox = shownWhenOver(el, true, getComputedStyle(el).opacity === "0");
      }
      if (!hoverBox) {
        // display:contents has no box of its own, but its children do.
        // What is inside it is where it is: in the open dialog or not, and inside a box that may turn out to be a wrapper.
        if (getComputedStyle(el).display === "contents" && !holdsTyping(el)) for (const child of el.children) visit(child, scope, parentPointer, insideControl, inSvg, outside, held);
        return;
      }
    }

    // An element can name more than one role. The one that says how it is used is the one that matters.
    const roles = (el.getAttribute("role") ?? "").split(/\s+/).filter(Boolean);
    const explicitRole = roles.find((name) => INTERACTIVE_ROLES.has(name)) ?? roles[0] ?? "";
    const landmark = LANDMARKS[explicitRole] ?? LANDMARKS[el.tagName];
    // A part of the page that is set apart keeps its heading to itself: a panel's title is not the heading of what comes after the panel.
    const section = !landmark && el !== root && el !== modal && (SECTION_TAGS.has(el.tagName) || SECTION_ROLES.has(explicitRole));
    const boxName = el === modal || (landmark && el !== root) ? nameOfBox(el) : section ? headingOfBox(el) : "";
    const childScope: Scope =
      el === modal ? { region: "dialog", heading: "", box: boxName }
      : landmark && el !== root ? { region: landmark, heading: boxName, box: boxName }
      : section ? { region: scope.region, heading: boxName || scope.heading, box: boxName || scope.box }
      : scope;

    const headingTag = /^H([1-6])$/.exec(el.tagName);
    if ((headingTag || explicitRole === "heading") && !hoverBox) {
      const text = headingWords(el);
      if (text) {
        scope.heading = text;
        const level = Number(el.getAttribute("aria-level")) || Number(headingTag?.[1]) || 2;
        const rect = el.getBoundingClientRect();
        if (headings.length < 200) headings.push({ text, level, visible: !outOfView(rect) });
      }
    }

    // cursor:pointer is inherited, so only the element where it starts counts.
    // A component's own element, like a select drawn in a shadow root, passes its pointer on to what is drawn inside
    // it, which does not start one. It is not taken for a control by its pointer alone.
    const component = el.tagName.includes("-");
    const pointerHere = !INTERACTIVE_ROLES.has(explicitRole) && !svg && (MAYBE_CLICKABLE.has(el.tagName) || component) ? getComputedStyle(el).cursor === "pointer" : parentPointer;
    const pointerStarts = pointerHere && !parentPointer && !insideControl && !component && !pressedForAField(el);
    const role = pressableOnly ? "clickable"
      : svg && !INTERACTIVE_ROLES.has(explicitRole) && !(el.tagName.toLowerCase() === "a" && (el.hasAttribute("href") || el.hasAttribute("xlink:href"))) ? ""
      : roleOf(el, explicitRole, pointerStarts);
    // A box listed only because the keyboard can reach it, which shows no pointer and takes no click of its own, is
    // often how a calendar's panel or a grid takes the arrow keys. A pointer that starts on something inside it marks
    // a control of its own, like a day, so what is inside it is looked at as if it were not inside a control.
    const keysOnly = role === "clickable" && !pressableOnly && !pointerHere && !el.hasAttribute("onclick");

    /** A table row is read as one line, so its cells are not read again on their own. */
    const isRow = !role && (el.tagName === "TR" || explicitRole === "row");
    let rowRead = false;
    let added: Candidate | undefined;
    if (role) {
      const rect = el.getBoundingClientRect();
      if (hasRealBox(el, rect) && (!hoverBox || liesInside(rect, hoverBox))) {
        added = { el, id: "", role, label: labelOf(el, role), nav: ["nav", "header", "aside", "menu", "tabs", "footer"].includes(scope.region), region: scope.region, heading: scope.heading, outside, rect };
        if (role === "clickable" && pointerStarts) {
          added.pointer = true;
          // Found only because the box around it is one the keyboard moves through. It stays if that box is a grid of such things.
          if (keysBoxes > 0) added.loose = true;
        }
        const options = optionsOf(el);
        if (options.length) added.options = options;
        const icon = iconOf(el);
        if (icon) added.icon = icon;
        // A menu button with no name and no picture, like an account menu that shows only initials hidden from screen
        // readers, is named by the menu it opens or by the box just around it, when the page names either.
        const unnamedMenu = !added.label && !icon && opens(el, role) === OPENS_A_MENU;
        if (unnamedMenu) added.label = cleanText(nameOfWhatItOpens(el) || nameAround(el), 80);
        // A chart or a tile with no name of its own is known by the box that names it, and says so:
        // "part of Simple graph". Otherwise an event reads "The user clicked clickable."
        if (!added.label && !icon && scope.box && !SHOWS_A_VALUE.has(role)) {
          added.label = cleanText(`part of ${scope.box}`, 80);
          added.boxNamed = true;
        }
        // One that is still nameless is known by where it sits, as a visitor would point it out: "top right".
        if (unnamedMenu && !added.label) added.spot = spotOf(inPageWindow(rect, frame), viewportHeight);
        const state = stateOf(el, role);
        if (state.includes("disabled")) giveReason(added, reasonOf(el));
        // Fully transparent controls have always been listed: row actions that fade in. One that a stylesheet shows on hover says so.
        const fades = !hoverBox && hiddenChecked < MAX_HIDDEN_CHECKED && getComputedStyle(el).opacity === "0" && ++hiddenChecked > 0 && shownWhenOver(el, false, true);
        if (hoverBox || (fades && liesInside(rect, fades))) state.push(SHOWS_ON_HOVER);
        if (state.length) added.state = state;
        const href = hrefOf(el);
        if (href) added.href = href;
        const away = outOfView(rect);
        if (away) added.offscreen = away;
        if (frame) added.frame = frame;
        candidates.push(added);
      }
    } else if ((!insideControl || held) && !svg && !outside && !hoverBox && (TEXT_TAGS.has(el.tagName) || isRow) && !taken.has(el) && (held ?? texts).length < MAX_TEXT_BLOCKS) {
      const words = isRow ? rowTextOf(el) : sentenceOf(el, taken);
      rowRead = isRow && !!words;
      // Words that repeat what the visitor typed in a field are theirs, wherever the page shows them.
      if (words && !echoesTyping(words)) {
        const rect = el.getBoundingClientRect();
        (held ?? texts).push({ text: cleanText(words, isRow ? 200 : 160), visible: !outOfView(rect), order: nextOrder() });
      }
    }

    // What is inside an editor is what the visitor wrote, links and all. The editor is one control, and that is the end of it.
    // What is inside a part hidden from screen readers is not looked into either.
    if (holdsTyping(el) || pressableOnly) return;

    const before = candidates.length;
    const inside = insideControl || (role !== "" && !keysOnly);
    // Only a box that is not a control in its own right can turn out to be a wrapper.
    const mayBeWrapper = !!added && (role === "clickable" || (!isNative(el) && !isFocusable(el)));
    // The words inside a row that was read as one line have been sent already, so what its cells give is set aside.
    const mine: TextBlock[] | undefined = mayBeWrapper || rowRead ? [] : role ? undefined : held;
    if (keysOnly) keysBoxes++;
    for (const child of el.children) visit(child, childScope, pointerHere, inside, svg, outside, mine, hoverBox);
    if (el.shadowRoot) for (const child of el.shadowRoot.children) visit(child, childScope, pointerHere, inside, svg, outside, mine, hoverBox);
    if (keysOnly) keysBoxes--;

    // A wrapper around real buttons or links is just a container, whether it
    // looked clickable or was given a role, like a menu entry around its link.
    // One that can be reached with the keyboard is a control in its own right:
    // a row that opens what it shows, with a button or two inside it.
    let within = added ? candidates.slice(before).filter((c) => c !== added) : [];
    let wrapper = false;
    let inner: Candidate | undefined;
    // A box the keyboard moves through, holding rows of like things a pointer goes to, is not one control: a
    // calendar's panel holds its days. Each of those is a control of its own, and its row is not one entry. In a box
    // that holds no such rows, what the pointer alone marked inside it is part of it, as it always was: a wizard's
    // step and the drawing of the step inside it.
    const grid = keysOnly && !!added && keyedGrid(within);
    if (grid) {
      for (const c of within) if (c.pointer) c.single = true;
    } else if (keysOnly && added) {
      const loose = new Set(within.filter((c) => c.loose && !c.single));
      if (loose.size) {
        for (let index = candidates.length - 1; index >= before; index--) if (loose.has(candidates[index]!)) candidates.splice(index, 1);
        within = within.filter((c) => !loose.has(c));
      }
    }
    // A box the keyboard can reach, with no pointer or click of its own, around controls that cannot be used: the box a
    // page puts around a disabled button so that a tooltip can say why, since the button itself takes no mouse or
    // keyboard. It is those controls, not one more. What the page says about it, or prints in it beside them, is why.
    const unusable = keysOnly && added && isFocusable(el) ? disabledWithin(within) : [];
    if (grid) {
      wrapper = true;
    } else if (unusable.length) {
      wrapper = true;
      const why = reasonOf(el) || wordsIn(el, 200, `${CONTROLS}, label`);
      for (const c of unusable) giveReason(c, why);
    } else if (added && opensRecord(el, added)) {
      // A table row that opens what it shows is a control of its own, whatever it holds, and is no frame of its tick box.
    } else if (added && !isNative(el) && !isFocusable(el) && within.some((c) => c.role !== "clickable" && isNative(c.el))) {
      wrapper = true;
    } else if (added?.role === "clickable" && within.some((c) => c.role === "clickable" && saysMostOf(c.boxNamed ? "" : c.label, added!.label))) {
      // A clickable box around a clickable box that says the same thing: the inner one is the control.
      // A panel named "Simple graph" around its legend, "A-series B-series", says something else and stays.
      wrapper = true;
    } else if (added?.role === "clickable" && (inner = showingTheSame(added, within))) {
      // The same, where the inner box is named by its caption and shows the same words as the box around it: a
      // custom select, "-- Select --" around "-- Select --", whose inner box is called "Job Title". The picture on
      // the box around it, an arrow that says it opens a list, goes with it.
      wrapper = true;
      if (!inner.icon && added.icon) inner.icon = added.icon;
    } else if (added?.role === "clickable" && (inner = framed(added, within))) {
      // A box that says nothing but what a control inside it says, around a control with a role of its own, is that
      // control's frame: the track of a slider, or the box around a select that shows its choice. The picture on the
      // frame, an arrow that says it opens a list, goes with the control.
      wrapper = true;
      if (!inner.icon && added.icon) inner.icon = added.icon;
    } else if (added && pointerOnly(added) && !added.label && !added.icon && (within.length > 0 || !iconSized(added.rect))) {
      // A box that only the pointer marks, that says nothing and shows no picture, is no control a visitor can tell:
      // the gap between two cards that takes a dragged card, or a panel around controls of its own. One the size of
      // an icon, drawn by its stylesheet, is still a control.
      wrapper = true;
    }
    if (added && wrapper) {
      candidates.splice(candidates.indexOf(added), 1);
      // Its words were held back as a control's own. It is no control, so they are the page's.
      if (mine?.length) (held ?? texts).push(...mine);
    }
    // A section that is only words, like a title and a line under it, introduces what comes after it. One that shows
    // no words, or whose only title is a name heard by a screen reader alone, introduces nothing: a toaster's region,
    // named "Notifications alt+T" and empty until a message comes, is not the surroundings of what the page puts after it.
    const heardOnly = childScope.heading === boxName && namedForScreenReaders(el);
    if (section && !added && candidates.length === before && !heardOnly && wordsIn(el, 40)) scope.heading = childScope.heading;
  };

  if (root) visit(root, { region: "page", heading: "" }, false, false);
  deferring = false;
  let shifted = 0;
  let headingsShifted = 0;
  for (const part of later) {
    if (visited > MAX_VISITED) break;
    const before = candidates.length;
    const headingsBefore = headings.length;
    order = part.orderAt;
    orderStep = 1 / (MAX_TEXT_BLOCKS + 1);
    visit(part.el, part.scope, part.parentPointer, false, false, part.outside);
    const found = candidates.splice(before);
    candidates.splice(part.at + shifted, 0, ...found);
    shifted += found.length;
    const named = headings.splice(headingsBefore);
    headings.splice(part.headingAt + headingsShifted, 0, ...named);
    headingsShifted += named.length;
  }

  // With a dialog open, the rest of the page counts only where it is drawn over the dialog. With a list
  // open over a layer that covers the window, only what is in the list's layer, or on top of it, can be
  // used, and the field the list belongs to, which has the keyboard and is typed in to narrow the list.
  const cover = modal ? undefined : coverOf(ignore, candidates);
  const inCover = (el: Element) => !!cover?.layer?.contains(el) || el === document.activeElement;
  // What no visitor can reach is left out, and what scrolling reaches says which way it is. A layer over the
  // middle of the window, like a wall of cookie choices, is then the part of the page that can be used.
  const reach = keepReachable(
    modal ? candidates.filter((c) => !c.outside || onTop(c.el, ignore, c.frame))
    : cover ? candidates.filter((c) => inCover(c.el) || onTop(c.el, ignore, c.frame))
    : candidates,
    ignore,
    !modal && !cover,
  );
  let usable = mergeCells(reach.kept);
  markChosen(usable);
  nameRows(usable);
  tellTwinsApart(usable);
  for (const c of usable) {
    const context = contextOf(c);
    if (context) c.context = context;
  }

  // Over the cap, keep what's on screen first, then the page's furniture, then
  // the rest in page order. A region that is one long run of links, like a box
  // of related pages, does not get to crowd out everything after it.
  // Kept beside the reading, and never sent, so that what changed is told from the whole page and not from what was cut.
  const everything = { elements: usable.map((c) => ({ ...c })), text: texts.map((block) => block.text), headings: [...new Set(headings.map((heading) => heading.text))] };
  let chosen = usable;
  if (usable.length > MAX_ELEMENTS) {
    const perRegion = new Map<string, number>();
    const rank = (c: Candidate) => {
      if (!c.offscreen) return 0;
      if (!c.nav) return 2;
      const where = `${c.region}|${c.heading}`;
      const seen = (perRegion.get(where) ?? 0) + 1;
      perRegion.set(where, seen);
      return seen > REGION_SHARE ? 3 : 1;
    };
    const ranked = usable.map((c) => ({ c, rank: rank(c) }));
    const keep = new Set(ranked.sort((a, b) => a.rank - b.rank).slice(0, MAX_ELEMENTS).map((entry) => entry.c));
    chosen = usable.filter((c) => keep.has(c));
  }
  usable = [];

  const elements = new Map<string, Element>();
  const strip = ({ el: _el, nav: _nav, region: _region, heading: _heading, row: _row, place: _place, outside: _outside, boxNamed: _boxNamed, pointer: _pointer, single: _single, loose: _loose, why: _why, spot: _spot, rect: _rect, frame: _frame, ...element }: Candidate): SnapElement => element;
  const listed = chosen.map((c, index) => {
    const element = strip(c);
    element.id = `e${index + 1}`;
    elements.set(element.id, c.el);
    return element;
  });

  const snapshot: Snapshot = {
    path: currentPath(),
    title: cleanText(document.title, 80),
    headings: chooseHeadings(headings),
    text: chooseText(texts, nearAt),
    elements: listed,
    truncated: chosen.length < candidates.filter((c) => !c.outside).length && chosen.length >= MAX_ELEMENTS,
  };
  if (modal) snapshot.dialog = dialogLabel(modal);
  else if (reach.layer) snapshot.dialog = layerLabel(reach.layer);
  uncut.set(snapshot, { elements: everything.elements.map(strip), text: everything.text, headings: everything.headings });
  // What the fields held is let go with the reading.
  typed = [];
  return { snapshot, elements };
}

/**
 * Every control, piece of text and heading a reading found, before what is
 * sent was cut to its limits. A long page sends what is on screen first, so
 * scrolling alone moves controls, text and headings in and out of what is
 * sent without anything on the page changing.
 */
const uncut = new WeakMap<Snapshot, WholePage>();

export interface WholePage {
  elements: SnapElement[];
  text: string[];
  headings: string[];
}

/**
 * The whole page as a reading found it, which is what two readings are
 * compared by: whether the page changed, and how. A reading made elsewhere,
 * with nothing kept beside it, is its own whole.
 */
export function wholePage(snapshot: Snapshot): WholePage {
  return uncut.get(snapshot) ?? { elements: snapshot.elements, text: snapshot.text, headings: snapshot.headings };
}

/** Identifies the same control across two snapshots, where ids differ. */
export function elementKey(element: Pick<SnapElement, "role" | "label" | "icon" | "href" | "context">): string {
  // The row a control is in is part of what it is: "Remove" beside Sam is not "Remove" beside Priya.
  // Its place among its like ("2 of 3") is left out: that shifts when one of them goes, and the control is still the same one.
  const row = /row: (.*?)(?: › \d+ of \d+)?$/.exec(element.context ?? "")?.[1] ?? "";
  return `${element.role}|${element.label}|${element.icon ?? ""}|${element.href ?? ""}|${row}`;
}

/**
 * Where the visitor is. An app that keeps its place after a "#/" shows the
 * same address path on every screen, so that part counts too.
 */
export function currentPath(): string {
  return normalizePath(location.pathname) + routeOf(location.hash);
}

/** The screen of an app that keeps its place after a "#/", as "#/orders/:id", or nothing for its first screen and for any other "#". */
function routeOf(hash: string): string {
  const route = hash.startsWith("#/") ? normalizePath(hash.slice(1)) : "";
  return route && route !== "/" ? `#${route}` : "";
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
  // A listed control is new only if the page had no such control before, listed or not, and gone only if the page has none now.
  const was = uncut.get(before);
  const now = uncut.get(after);
  const whole = !!was && !!now;
  if (!lines.length) {
    const added = without(after.elements, whole ? was.elements : before.elements, elementKey).map(describeElement);
    const removed = without(before.elements, whole ? now.elements : after.elements, elementKey).map(describeElement);
    if (added.length) lines.push(`New: ${listSome(added)}.`);
    if (removed.length) lines.push(`Gone: ${listSome(removed)}.`);
    lines.push(...stateChanges(whole ? was.elements : before.elements, whole ? now.elements : after.elements).slice(0, 8));
  }
  const beforeText = whole ? [...was.headings, ...was.text] : [...before.headings, ...before.text];
  const afterText = whole ? [...now.headings, ...now.text] : [...after.headings, ...after.text];
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

/**
 * Which of the page's text is sent. On-screen text gets the budget first, then
 * the text nearest the control last used (`nearAt`, a place in page order),
 * then the rest from the top. The result stays in page order.
 */
function chooseText(blocks: TextBlock[], nearAt = -1): string[] {
  const ranked = [...blocks].sort((a, b) => {
    if (a.visible !== b.visible) return a.visible ? -1 : 1;
    if (!a.visible && nearAt >= 0) return Math.abs(a.order - nearAt) - Math.abs(b.order - nearAt) || a.order - b.order;
    return a.order - b.order;
  });
  const seen = new Set<string>();
  const keep: TextBlock[] = [];
  let total = 0;
  for (const block of ranked) {
    if (seen.has(block.text) || total + block.text.length > MAX_TEXT_CHARS) continue;
    seen.add(block.text);
    keep.push(block);
    total += block.text.length;
  }
  return keep.sort((a, b) => a.order - b.order).map((block) => block.text);
}

/** Whether an element takes up room on the page, shown or not: it is not left out of the layout altogether. */
function hasBox(el: Element): boolean {
  if (typeof el.checkVisibility === "function") return el.checkVisibility();
  return el.getClientRects().length > 0;
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
  // A label that shows the pointer is pressed for its field, which is listed. Only when the field cannot be seen is the label what the visitor presses.
  if (tag === "LABEL") {
    const field = labelTarget(el as HTMLLabelElement);
    if (field && isRendered(field)) return "";
  }
  if (el.hasAttribute("onclick") || pointerStartsHere) return "clickable";
  // Something the keyboard can land on is there to be used, whatever it looks like: a row, a card, a tile. A list,
  // a menu or a grid that takes the keyboard does so to move it among its entries, which are what is used.
  if (isFocusable(el) && !FOCUSABLE_NOT_CLICKABLE.has(tag) && !ROVING.has(explicitRole) && !scrolls(el)) return "clickable";
  return "";
}

/** Elements HTML lets a <label> name: its fields, and its buttons. */
function isLabelable(el: Element): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement {
  return isTag(el, "input") || isTag(el, "select") || isTag(el, "textarea") || isTag(el, "button");
}

/** Whether an element says by its role that it is a control. */
function hasControlRole(el: Element): boolean {
  return (el.getAttribute("role") ?? "").split(/\s+/).some((role) => INTERACTIVE_ROLES.has(role));
}

/**
 * The <label>s that name a control: those tied to it by `for` and the one
 * around it. HTML ties them to its fields and buttons, a switch or a tick box
 * drawn as a <button> among them. A box that is a control only by its role,
 * like a switch drawn as a <div>, is named by a <label for> that points at it
 * all the same, the way the page means it.
 */
function labelsOf(el: Element): HTMLLabelElement[] {
  if (isLabelable(el)) return Array.from(el.labels ?? []);
  if (!el.id || !hasControlRole(el)) return [];
  const root = el.getRootNode() as Document | ShadowRoot;
  try {
    return Array.from(root.querySelectorAll<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`));
  } catch {
    // A root that cannot be searched. The control is named some other way.
    return [];
  }
}

/** The control a <label> names: the field or button HTML ties it to, or a control by role that its `for` points at. */
function labelTarget(label: HTMLLabelElement): Element | null {
  if (label.control) return label.control;
  const id = label.getAttribute("for");
  if (!id) return null;
  const target = (label.getRootNode() as Document | ShadowRoot).getElementById?.(id) ?? null;
  return target && hasControlRole(target) ? target : null;
}

/**
 * Whether a box that takes clicks is a table row that opens the record it
 * shows: a row the pointer starts on, or that says it takes clicks, with
 * words of its own besides those of its controls. It holds a tick box to
 * select it and buttons for its actions, and is a control all the same.
 */
function opensRecord(el: Element, c: Candidate): boolean {
  if (!isRowOfTable(el)) return false;
  if (!c.pointer && !el.hasAttribute("onclick")) return false;
  return /[\p{L}\p{N}]/u.test(wordsIn(el, 40, `${CONTROLS}, label`));
}

/** Boxes that are ticked, whatever they are drawn with. */
const TICKS = "[role='checkbox'], [role='switch'], [role='radio']";

/** What a table row holds for its actions. */
const ROW_ACTIONS = "button, [role='button']";

/** Whether an element is a row of a table, by its tag or its role. */
function isRowOfTable(el: Element): boolean {
  return el.tagName === "TR" || el.getAttribute("role") === "row";
}

/** A tag the browser itself treats as a control. */
function isNative(el: Element): boolean {
  const tag = el.tagName;
  return (tag === "A" && el.hasAttribute("href")) || tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "SUMMARY";
}

/** The words of a name, for comparing two names by what they say. */
function wordsOfLabel(label: string): string[] {
  return label.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Whether `inner` says most of what `outer` says: at least three in five of its words. An outer box that says nothing says nothing more. */
function saysMostOf(inner: string, outer: string): boolean {
  const wanted = wordsOfLabel(outer);
  if (!wanted.length) return true;
  const said = new Set(wordsOfLabel(inner));
  return wanted.filter((word) => said.has(word)).length >= wanted.length * 0.6;
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

/**
 * Whether the element is what a click at its middle would reach, which is not
 * so for anything behind a dialog's backdrop. Haptic's own pointer and caption
 * are looked through: they sit over the very control they point at, and
 * exactly where a list opens under it.
 */
function onTop(el: Element, ignore: Element, frame?: FrameView): boolean {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (frame) {
    // In a frame, the click has to land in the frame's window, and the frame has to be what the page draws there.
    if (x < 0 || y < 0 || x > frame.width || y > frame.height || x + frame.dx > window.innerWidth || y + frame.dy > window.innerHeight) return false;
    const hit = hitAt(x, y, ignore, frame);
    return !!hit && (drawnWithin(el, hit) || drawnWithin(hit, el));
  }
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  const hit = document.elementsFromPoint(x, y).find((over) => over !== ignore && !ignore.contains(over));
  return !!hit && (el.contains(hit) || hit.contains(el));
}

/**
 * A box of at least two pixels each way, which a visitor can see and press.
 * A zero-height box, or a screen reader's one-pixel copy of a control, is not
 * one. A tick box hidden under its label is pressed through the label, so the
 * label's box counts for it.
 */
function hasRealBox(el: Element, rect: DOMRect): boolean {
  if (rect.width >= 2 && rect.height >= 2) return true;
  // A switch drawn by its label, around a button the size of a pixel, is pressed through the label too.
  if (!(isTag(el, "input") || isTag(el, "select") || isTag(el, "textarea") || isTag(el, "button"))) return false;
  return Array.from(el.labels ?? []).some((label) => {
    const box = label.getBoundingClientRect();
    return box.width >= 2 && box.height >= 2;
  });
}

/** Whether a control was taken for one only because the pointer cursor starts on it: it has no role, takes no keyboard and says it takes no click. */
function pointerOnly(c: Candidate): boolean {
  return c.role === "clickable" && !!c.pointer && !c.el.hasAttribute("onclick") && !isFocusable(c.el);
}

/** The largest box drawn as an icon. */
const ICON_SIZE = 64;
const iconSized = (rect: DOMRect) => rect.width <= ICON_SIZE && rect.height <= ICON_SIZE;

/**
 * Whether a box is part of a label tied to a field that can be seen, like the
 * drawing of a switch inside its label. Pressing it presses the field, which
 * is listed, so its pointer does not make it a control of its own.
 */
function pressedForAField(el: Element): boolean {
  const label = el.parentElement?.closest("label");
  const field = label ? labelTarget(label) : null;
  return !!field && isRendered(field);
}

/**
 * Whether something hidden from screen readers is there for the mouse all the
 * same: it shows the pointer cursor itself, rather than taking it from the box
 * around it, has a real box, and is what a click at its middle reaches.
 */
function pressableThoughHidden(el: Element, ignore: Element): boolean {
  if (!MAYBE_CLICKABLE.has(el.tagName) || !isRendered(el) || getComputedStyle(el).cursor !== "pointer") return false;
  if (el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer") return false;
  const rect = el.getBoundingClientRect();
  return rect.width >= 2 && rect.height >= 2 && onTop(el, ignore);
}

/**
 * A layer drawn over the whole window with no control in it, which an open
 * list puts behind itself so that a click anywhere else only closes the list.
 * `layer` is the box that holds it and the list, when that is not the whole page.
 */
function coverOf(ignore: Element, candidates: Candidate[]): { el: Element; layer?: Element } | undefined {
  for (const [x, y] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]] as const) {
    const top = document.elementsFromPoint(window.innerWidth * x, window.innerHeight * y).find((el) => el !== ignore && !ignore.contains(el));
    if (!top || top === document.body || top === document.documentElement) continue;
    const box = top.getBoundingClientRect();
    if (box.width < window.innerWidth * 0.95 || box.height < window.innerHeight * 0.95) continue;
    const position = getComputedStyle(top).position;
    if ((position !== "fixed" && position !== "absolute") || candidates.some((c) => drawnWithin(top, c.el))) continue;
    const parent = top.parentElement;
    return { el: top, layer: parent && parent !== document.body && parent !== document.documentElement ? parent : undefined };
  }
  return undefined;
}

// What a visitor can reach ------------------------------------------------------

/** The state of a control that comes into view when the keyboard reaches it, like a link that skips to the page's content. */
const SHOWS_ON_FOCUS = "shows on focus";

/**
 * The parent of a node as the page is drawn: a node put into a <slot> is
 * drawn in the slot, a shadow root in its host, and the document of a frame
 * in the frame.
 */
function drawnParent(node: Node): Node | null {
  return (node as Element | Text).assignedSlot ?? node.parentNode ?? (isShadowRoot(node) ? node.host : isDocument(node) ? (node.defaultView?.frameElement ?? null) : null);
}

/** Whether an element is its own document's body or root, past which a box is the window's and not the page's. */
const isPageEdge = (node: Element) => node === node.ownerDocument.body || node === node.ownerDocument.documentElement;

/** Whether `inner` is drawn inside `outer`, across shadow roots and slots. */
function drawnWithin(outer: Element, inner: Node | null): boolean {
  for (let node = inner, depth = 0; node && depth < 200; node = drawnParent(node), depth++) if (node === outer) return true;
  return false;
}

/** What decides how a box clips what is inside it. Read once a reading for each box, since controls share their boxes. */
interface BoxFacts {
  position: string;
  overflowX: string;
  overflowY: string;
  /** Lays out positioned boxes inside it from itself even when it is not positioned: a transform, a filter, containment. */
  makesBlock: boolean;
  /** Clipped to nothing, the way words meant only for screen readers are hidden. */
  clippedAway: boolean;
  rtl: boolean;
}

function factsOf(el: Element, facts: Map<Element, BoxFacts>): BoxFacts {
  let known = facts.get(el);
  if (!known) {
    const style = getComputedStyle(el);
    known = {
      position: style.position,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      makesBlock: style.transform !== "none" || style.filter !== "none" || /paint|layout|strict|content/.test(style.contain) || style.willChange.includes("transform"),
      clippedAway: clippedToNothing(style),
      rtl: style.direction === "rtl",
    };
    facts.set(el, known);
  }
  return known;
}

/** `clip: rect(0 0 0 0)`, `clip: rect(1px, 1px, 1px, 1px)`, `clip-path: inset(50%)` and the like: a box cut down to nothing. */
function clippedToNothing(style: CSSStyleDeclaration): boolean {
  const path = style.clipPath;
  if (path && path !== "none" && /^(?:inset\(\s*50%|circle\(\s*0(?:px)?\s*(?:at\b|\))|polygon\(\s*0(?:px)?\s+0(?:px)?\s*,\s*0(?:px)?\s+0(?:px)?\s*,\s*0(?:px)?\s+0(?:px)?\s*\))/.test(path)) return true;
  // `clip` applies only to a box positioned absolutely.
  if ((style.position !== "absolute" && style.position !== "fixed") || !style.clip || style.clip === "auto") return false;
  const [top, right, bottom, left] = (style.clip.match(/-?[\d.]+/g) ?? []).map(Number);
  return left !== undefined && (bottom! - top! <= 1 || right! - left <= 1);
}

/** Whether a box is one that positioned boxes of this kind inside it are laid out from, which is what lets it clip them. */
function laysOut(box: BoxFacts, position: string): boolean {
  if (position === "fixed") return box.makesBlock;
  if (position === "absolute") return box.position !== "static" || box.makesBlock;
  return true;
}

const scrollsBy = (overflow: string) => overflow === "auto" || overflow === "scroll";

/** Where a control is, as far as the boxes around it let it be seen. */
interface Seen {
  /** Nothing of it can be seen or brought into view: clipped away by a box that does not scroll, or cut down to nothing. */
  hidden?: boolean;
  /** It is scrolled out of a box that scrolls: before or after what that box shows. */
  scroll?: "above" | "below";
  /** The part of its box that is drawn. */
  rect?: DOMRect;
  /** It stays where it is in the window when the page scrolls. */
  fixed?: boolean;
}

/**
 * Where a control is drawn once the boxes around it have clipped it, as the
 * browser draws it: a box clips only what is laid out from it, so a list
 * placed over the page from a box of no height is still seen. A control cut
 * away by a box that scrolls is reached by scrolling that box, and is said to
 * be before ("above") or after ("below") what the box shows, across as well as
 * down. One cut away by a box that only clips, like a strip of slides moved by
 * its own arrows, cannot be reached at all.
 */
function seenOf(el: Element, rect: DOMRect, facts: Map<Element, BoxFacts>): Seen {
  const own = factsOf(el, facts);
  if (own.clippedAway) return { hidden: true };
  let [left, top, right, bottom] = [rect.left, rect.top, rect.right, rect.bottom];
  let position = own.position;
  let scroll: Seen["scroll"];
  for (let node = drawnParent(el), depth = 0; node && depth < 100; node = drawnParent(node), depth++) {
    if (!isElement(node)) continue;
    // The page's own scrolling is the window's, and is told from where the control is in the window. A frame's is the frame's.
    if (isPageEdge(node)) break;
    const box = factsOf(node, facts);
    if (!laysOut(box, position)) continue;
    if (box.position !== "static" || position === "fixed") position = box.position === "static" ? "relative" : box.position;
    if (box.clippedAway) return { hidden: true };
    if (box.overflowX === "visible" && box.overflowY === "visible") continue;
    const clip = node.getBoundingClientRect();
    const [wasLeft, wasTop, wasRight] = [left, top, right];
    if (box.overflowX !== "visible") [left, right] = [Math.max(left, clip.left), Math.min(right, clip.right)];
    if (box.overflowY !== "visible") [top, bottom] = [Math.max(top, clip.top), Math.min(bottom, clip.bottom)];
    const acrossGone = right - left <= 0;
    const downGone = bottom - top <= 0;
    if (!acrossGone && !downGone) continue;
    if ((downGone && !(scrollsBy(box.overflowY) && node.scrollHeight > node.clientHeight + 1)) || (acrossGone && !(scrollsBy(box.overflowX) && node.scrollWidth > node.clientWidth + 1))) return { hidden: true };
    scroll ??= downGone ? (wasTop < clip.top ? "above" : "below") : (box.rtl ? wasLeft >= clip.right : wasRight <= clip.left) ? "above" : "below";
    // Scrolled into view, it is as far into view as the box it scrolls in.
    [left, top, right, bottom] = [clip.left, clip.top, clip.right, clip.bottom];
    position = box.position;
  }
  if (scroll) return { scroll };
  return { rect: new DOMRect(left, top, right - left, bottom - top), fixed: position === "fixed" };
}

/**
 * Whether a box lies where no scrolling can bring it: above the top of the
 * page, or before its start, as a link that skips to the content is parked
 * until the keyboard reaches it. A box pinned to the window has to be in it.
 */
function parkedOutside(rect: DOMRect, fixed: boolean, rtl: boolean, view: Window): boolean {
  if (fixed) return rect.bottom <= 0 || rect.right <= 0 || rect.left >= view.innerWidth || rect.top >= view.innerHeight;
  if (rect.bottom + view.scrollY <= 0) return true;
  return rtl ? rect.left + view.scrollX >= view.document.documentElement.clientWidth : rect.right + view.scrollX <= 0;
}

/**
 * What a click at a point lands on, through open shadow roots, looking
 * through Haptic's own element. A point in a frame being read is in the
 * frame's window: the click lands in the frame only if the frame is what the
 * page draws there.
 */
function hitAt(x: number, y: number, ignore: Element, frame?: FrameView): Element | undefined {
  if (frame) {
    const outer = hitAt(x + frame.dx, y + frame.dy, ignore);
    if (outer !== frame.el) return outer;
  }
  const doc = frame ? (frame.el as HTMLIFrameElement).contentDocument : document;
  if (!doc) return undefined;
  let hit: Element | null | undefined = doc.elementFromPoint(x, y);
  if (hit && (hit === ignore || ignore.contains(hit))) hit = doc.elementsFromPoint(x, y).find((el) => el !== ignore && !ignore.contains(el));
  for (let depth = 0; hit?.shadowRoot && depth < 30; depth++) {
    const inner: Element | null = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit ?? undefined;
}

/**
 * Whether a click that lands on `hit` reaches the control: on it or a part of
 * it, on its label, or in a box around it of about its size, which is the
 * control's own frame, as a label around a tick box is, or the box of a select
 * that draws the chosen value over a see-through field. A large box around it
 * takes a click that lands there for itself.
 */
function reaches(el: Element, area: number, hit: Element | undefined): boolean {
  if (!hit) return false;
  if (drawnWithin(el, hit)) return true;
  if (isLabelable(el) && Array.from(el.labels ?? []).some((label) => drawnWithin(label, hit))) return true;
  const most = Math.max(4 * area, 2500);
  for (let node = drawnParent(el), depth = 0; node && depth < 4; node = drawnParent(node), depth++) {
    if (!isElement(node)) continue;
    if (isPageEdge(node)) return false;
    const box = node.getBoundingClientRect();
    if (box.width * box.height > most) return false;
    if (drawnWithin(node, hit)) return true;
  }
  return false;
}

/**
 * What a click on a control in the window lands on, when that is not the
 * control: what is in front of it at its middle. Nothing when a click at its
 * middle, or at any of four points around it, reaches it.
 */
function inFrontOf(el: Element, seen: DOMRect, ignore: Element, frame?: FrameView): Element | undefined {
  // What can be clicked is in the window, and in a frame, in the frame's window too.
  const [dx, dy] = frame ? [frame.dx, frame.dy] : [0, 0];
  const left = Math.max(seen.left, -dx, frame ? 0 : -Infinity);
  const right = Math.min(seen.right, window.innerWidth - dx, frame ? frame.width : Infinity);
  const top = Math.max(seen.top, -dy, frame ? 0 : -Infinity);
  const bottom = Math.min(seen.bottom, window.innerHeight - dy, frame ? frame.height : Infinity);
  if (right - left < 1 || bottom - top < 1) return undefined;
  const area = (right - left) * (bottom - top);
  let first: Element | undefined;
  for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]] as const) {
    const hit = hitAt(left + (right - left) * fx, top + (bottom - top) * fy, ignore, frame);
    if (reaches(el, area, hit)) return undefined;
    first ??= hit;
  }
  return first;
}

/** Whether a control has a <label> that can be seen, which is pressed for it. */
function shownLabel(el: Element, facts: Map<Element, BoxFacts>): boolean {
  return labelsOf(el).some((label) => {
    const box = label.getBoundingClientRect();
    return box.width >= 2 && box.height >= 2 && !seenOf(label, box, facts).hidden;
  });
}

/** The box, at or around an element, that stays put in the window or in its scrolling box when the page scrolls. */
function pinnedBoxOf(el: Element, facts: Map<Element, BoxFacts>): Element | undefined {
  for (let node: Node | null = el, depth = 0; node && depth < 100; node = drawnParent(node), depth++) {
    if (!isElement(node) || isPageEdge(node)) continue;
    const position = factsOf(node, facts).position;
    if (position === "fixed" || position === "sticky") return node;
  }
  return undefined;
}

/** The nearest box around an element that the visitor can scroll up and down. */
function scrollBoxOf(el: Element, facts: Map<Element, BoxFacts>): Element | undefined {
  for (let node = drawnParent(el), depth = 0; node && depth < 100; node = drawnParent(node), depth++) {
    if (!isElement(node)) continue;
    if (isPageEdge(node)) return undefined;
    if (scrollsBy(factsOf(node, facts).overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
  }
  return undefined;
}

/** The box in an element's ancestry, itself included, that draws it fully see-through, if one does. */
function seeThroughBox(el: Element): Element | undefined {
  for (let node: Node | null = el, depth = 0; node && depth < 100; node = drawnParent(node), depth++) {
    if (isElement(node) && getComputedStyle(node).opacity === "0") return node;
  }
  return undefined;
}

/** Whether something is on its way into view: it, or the see-through box around it, is fading in. */
function fadingIn(box: Element): boolean {
  try {
    return typeof box.getAnimations === "function" && box.getAnimations().some((animation) => animation.playState === "running");
  } catch {
    return false;
  }
}

/** How many hidden controls are checked against the stylesheets' rules for focus while one page is read. */
const MAX_FOCUS_CHECKED = 100;
/** Properties a rule sets to bring a box into view, or to take it out of view until it has the keyboard. */
const PLACING = ["opacity", "visibility", "clip", "clip-path", "transform", "translate", "top", "left", "right", "bottom", "inset-inline-start", "inset-block-start", "width", "height", "margin-top", "margin-left", "margin-inline-start"];
const FOCUSED = /:(?:focus|focus-visible|focus-within)(?![\w-])/;
const EVERY_FOCUSED = new RegExp(FOCUSED.source, "g");
/** A rule's selector that names a kind of thing, not every link or every box. */
const NAMES_A_KIND = /[.#[]/;
/** A selector for what a rule shows when it, or a box around it, has the keyboard, or hides until then. */
interface FocusRule {
  selector: string;
  /** The keyboard may be anywhere inside the box the selector picks, not only on the control itself. */
  within: boolean;
}
const FOCUS_RULES = new WeakMap<Document | ShadowRoot, { stamp: string; rules: FocusRule[] }>();

/**
 * The rules, among the stylesheets of a document or a shadow root, that move
 * something into view when the keyboard reaches it: `.skip:focus { top: 0 }`,
 * `.links:focus-within { opacity: 1 }`, or the other way about,
 * `.skip:not(:focus) { clip: rect(0 0 0 0) }`.
 */
function focusRulesIn(root: Document | ShadowRoot): FocusRule[] {
  const lists: CSSRuleList[] = [];
  let stamp = "";
  for (const sheet of [...Array.from(root.styleSheets ?? []), ...(root.adoptedStyleSheets ?? [])]) {
    try {
      const rules = sheet.cssRules;
      lists.push(rules);
      stamp += `${rules.length},`;
    } catch {
      stamp += "x,";
    }
  }
  const known = FOCUS_RULES.get(root);
  if (known?.stamp === stamp) return known.rules;
  const found: FocusRule[] = [];
  let read = 0;
  const walk = (rules: CSSRuleList, depth: number) => {
    for (let i = 0; i < rules.length && read < MAX_RULES_READ; i++) {
      const rule = rules[i] as CSSRule & { selectorText?: string; style?: CSSStyleDeclaration; cssRules?: CSSRuleList; media?: MediaList };
      read++;
      const selector = rule.selectorText;
      if (typeof selector === "string") {
        if (!rule.style || selector.indexOf(":focus") < 0 || !PLACING.some((name) => rule.style!.getPropertyValue(name) !== "")) continue;
        for (const part of selectorParts(selector)) {
          const within = part.includes(":focus-within");
          // Hidden until it has the keyboard: the whole selector matches it while it does not.
          if (/:not\([^)]*:focus/.test(part)) found.push({ selector: part.trim(), within });
          else if (FOCUSED.test(part)) {
            const shown = part.replace(EVERY_FOCUSED, "").trim();
            if (shown && NAMES_A_KIND.test(shown) && !/[>+~]$/.test(shown)) found.push({ selector: shown, within });
          }
        }
      } else if (depth < 3 && rule.cssRules) {
        if (rule.media?.mediaText && !window.matchMedia(rule.media.mediaText).matches) continue;
        walk(rule.cssRules, depth + 1);
      }
    }
  };
  try {
    for (const rules of lists) walk(rules, 0);
  } catch {
    // A rule this browser cannot be asked about. What was found so far stands.
  }
  FOCUS_RULES.set(root, { stamp, rules: found });
  return found;
}

/** Whether the keyboard can land on a control: a field, a button or a link that is not disabled, or a box given a place in the tab order. */
function takesTheKeyboard(el: Element): boolean {
  const tabindex = el.getAttribute("tabindex");
  if (tabindex !== null) return Number(tabindex) >= 0;
  return isNative(el) && !(el as HTMLButtonElement).disabled;
}

/** Whether a stylesheet brings a hidden control into view when the keyboard reaches it, or a box around it. */
function shownOnFocus(el: Element): boolean {
  if (!takesTheKeyboard(el)) return false;
  const root = el.getRootNode();
  if (!isDocument(root) && !isShadowRoot(root)) return false;
  for (const rule of focusRulesIn(root)) {
    try {
      // Only the control itself takes the keyboard, unless the rule is for the keyboard anywhere inside a box around it.
      if (rule.within ? el.closest(rule.selector) : el.matches(rule.selector)) return true;
    } catch {
      // A selector that cannot be read once the condition is taken out of it.
    }
  }
  return false;
}

/**
 * A layer pinned to the window over the middle of it, covering nearly all of
 * it, which holds what is drawn there: a wall of cookie choices, a dialog's
 * backdrop that says nothing of being one, or a frame over the whole window.
 * The innermost such box comes first.
 */
function layersOverPage(ignore: Element): Element[] {
  const top = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2).find((el) => el !== ignore && !ignore.contains(el));
  const layers: Element[] = [];
  for (let node: Element | null = top ?? null; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const position = getComputedStyle(node).position;
    if (position !== "fixed" && !(node === top && node.matches("iframe, frame") && position === "absolute")) continue;
    const box = node.getBoundingClientRect();
    if (box.width >= window.innerWidth * 0.9 && box.height >= window.innerHeight * 0.9) layers.push(node);
  }
  return layers;
}

/** What a layer over the page is called: the dialog in it, its own name, a frame's title, or its first words. */
function layerLabel(layer: Element): string {
  let inner: Document | null = null;
  try {
    inner = layer.matches("iframe, frame") ? (layer as HTMLIFrameElement).contentDocument : null;
  } catch {
    inner = null;
  }
  const dialog = layer.matches(DIALOGS) ? layer : (inner ?? layer).querySelector(DIALOGS);
  if (dialog) return dialogLabel(dialog);
  if (layer.matches("iframe, frame")) return cleanText(nameOfBox(layer) || layer.getAttribute("title") || "", 60);
  return dialogLabel(layer);
}

/**
 * The controls a visitor can reach, out of those found. One that nothing of
 * can be seen or scrolled to is left out: clipped away, cut down to nothing,
 * parked outside the page, or drawn see-through with something else taking
 * the click. Such a one is kept, and says so, when the mouse or the keyboard
 * brings it into view. One scrolled out of a box that scrolls, or lying under
 * a bar pinned to the window, is kept and said to be above or below, as one
 * out of the window is: scrolling brings it out. A layer that covers the
 * middle of the window and hides controls under it is, for as long as it is
 * there, all of the page that can be used, as a dialog that shuts out the page
 * is. `findLayer` is false when a dialog or an open list already decided that.
 */
function keepReachable(candidates: Candidate[], ignore: Element, findLayer: boolean): { kept: Candidate[]; layer?: Element } {
  const facts = new Map<Element, BoxFacts>();
  const rtl = getComputedStyle(document.documentElement).direction === "rtl";
  const kept: Candidate[] = [];
  const under: { c: Candidate; blocker: Element }[] = [];
  let checked = 0;
  const showsAnyway = (c: Candidate, box?: Element): boolean => {
    if (checked >= MAX_FOCUS_CHECKED) return false;
    checked++;
    const shownWhenOverIt = box && shownWhenOver(box, false, true);
    if (shownWhenOverIt && liesInside(c.rect, shownWhenOverIt)) c.state = [...(c.state ?? []), SHOWS_ON_HOVER];
    else if (shownOnFocus(c.el)) {
      c.state = [...(c.state ?? []), SHOWS_ON_FOCUS];
      // It comes into view where the keyboard brings it, wherever it is parked now.
      delete c.offscreen;
    } else return false;
    return true;
  };
  for (const c of candidates) {
    const seen = seenOf(c.el, c.rect, facts);
    const hover = !!c.state?.includes(SHOWS_ON_HOVER);
    const view = c.el.ownerDocument.defaultView ?? window;
    if (seen.scroll) {
      c.offscreen ??= seen.scroll;
      kept.push(c);
      continue;
    }
    if (seen.hidden || parkedOutside(c.rect, !!seen.fixed, c.frame ? getComputedStyle(c.el.ownerDocument.documentElement).direction === "rtl" : rtl, view)) {
      // A tick box or a switch hidden away and drawn by its label is pressed through the label.
      if (shownLabel(c.el, facts) || (!hover && showsAnyway(c))) kept.push(c);
      continue;
    }
    // The field that has the keyboard is typed in, whatever is drawn over it, like the list it opened.
    if (!hover && !c.offscreen && seen.rect && c.el !== document.activeElement) {
      const blocker = inFrontOf(c.el, seen.rect, ignore, c.frame);
      if (blocker) {
        // See-through and under something else: nobody sees it, and a click there takes the other thing. One fading in is on its way.
        const clear = seeThroughBox(c.el);
        if (clear && !fadingIn(clear)) {
          if (showsAnyway(c, clear)) kept.push(c);
          continue;
        }
        under.push({ c, blocker });
      }
    }
    kept.push(c);
  }
  if (!under.length) return { kept };
  if (findLayer) {
    const covered = new Set(under.map((u) => u.c));
    for (const layer of layersOverPage(ignore)) {
      // A layer over the page hides more of the page's controls than it holds. A layout pinned to the window holds the page.
      const inside = new Set(kept.filter((c) => drawnWithin(layer, c.el)));
      const hides = under.filter((u) => drawnWithin(layer, u.blocker)).length;
      if (!hides || hides < inside.size) continue;
      // Only what is in the layer, or drawn over it, can be used, and nothing out of the window can be scrolled to past it.
      return { kept: kept.filter((c) => inside.has(c) || (!c.offscreen && !covered.has(c))), layer };
    }
  }
  // Under a bar that stays put while the page scrolls, as headers and cookie notices do: scrolling brings it out.
  // Nothing comes out from under one as tall as the window.
  const buried = new Set<Candidate>();
  for (const { c, blocker } of under) {
    const bar = pinnedBoxOf(blocker, facts);
    if (bar && !drawnWithin(bar, c.el)) {
      const box = inPageWindow(bar.getBoundingClientRect(), bar.ownerDocument === document ? undefined : c.frame);
      if (box.top <= 0 && box.bottom >= window.innerHeight) buried.add(c);
      else c.offscreen = box.top + box.height / 2 < window.innerHeight / 2 ? "above" : "below";
      continue;
    }
    // At the edge of the box it scrolls in, under what that box draws over its edge, like a fading border: scrolling the box brings it out.
    const scroller = scrollBoxOf(c.el, facts);
    if (scroller && drawnWithin(blocker, scroller)) {
      const box = scroller.getBoundingClientRect();
      c.offscreen = c.rect.top + c.rect.height / 2 < box.top + box.height / 2 ? "above" : "below";
    }
  }
  return { kept: buried.size ? kept.filter((c) => !buried.has(c)) : kept };
}

/** The choices of a real <select>. They are the page's own words, not the visitor's: which one is chosen is never read. */
function optionsOf(el: Element): string[] {
  if (!isTag(el, "select")) return [];
  return Array.from(el.options)
    .map((option) => cleanText(option.label || option.text, MAX_OPTION_CHARS))
    .filter(Boolean)
    .slice(0, MAX_OPTIONS);
}

/**
 * A table whose rows open what they show often makes every cell clickable,
 * which lists one row ten times over, most of them with nothing to say. The
 * cells of one row become one entry, named by what the row says. A cell the
 * page treats as a control of its own stays one: a calendar's day, which says
 * whether it is the one chosen, is named for itself, or is one of the like
 * things a box the keyboard moves through holds.
 */
function mergeCells(candidates: Candidate[]): Candidate[] {
  const ownCell = (c: Candidate) => c.single || c.el.hasAttribute("aria-selected") || c.el.hasAttribute("aria-label");
  const isCell = (c: Candidate) => c.role === "clickable" && !c.icon && !ownCell(c) && c.el.matches('td, [role="cell"], [role="gridcell"]');
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

/** A class name that marks the chosen one of a set: "page-selected", "active", "is-current". "inactive" is not one. */
const MARKS_CHOSEN = /(?:^|[-_]|is)(?:selected|active|current)$/i;

/**
 * Marks the current one of a row of controls, like a pager's page buttons,
 * when the page says which only with a class name. When no control in the row
 * says it is current, selected, pressed or checked, and exactly one carries a
 * class name ending in "selected", "active" or "current" that the others lack,
 * on itself or on a box it alone fills, that one is "current". Without it the
 * model pointed at page 1 for "page 2" every time.
 */
function markChosen(candidates: Candidate[]) {
  const rows = new Map<Element, Candidate[]>();
  for (const c of candidates) {
    // A button alone in a list entry stands in that entry's place in the row.
    const slot = c.el.parentElement?.childElementCount === 1 ? c.el.parentElement : c.el;
    const row = slot.parentElement;
    if (!row) continue;
    const list = rows.get(row);
    if (list) list.push(c);
    else rows.set(row, [c]);
  }
  const marks = (c: Candidate) => {
    const slot = c.el.parentElement?.childElementCount === 1 ? c.el.parentElement : undefined;
    return [...Array.from(c.el.classList), ...Array.from(slot?.classList ?? [])].filter((name) => MARKS_CHOSEN.test(name));
  };
  for (const row of rows.values()) {
    if (row.length < 2 || row.some((c) => c.state?.some((state) => ["current", "selected", "pressed", "checked"].includes(state)))) continue;
    const each = row.map(marks);
    const seen = new Map<string, number>();
    for (const names of each) for (const name of new Set(names)) seen.set(name, (seen.get(name) ?? 0) + 1);
    const chosen = row.filter((_, index) => each[index]!.some((name) => seen.get(name) === 1));
    if (chosen.length === 1) chosen[0]!.state = [...(chosen[0]!.state ?? []), "current"];
  }
}

/**
 * Tells apart controls that would otherwise be listed word for word the same,
 * by the row, card or entry each sits in: "Remove [row: Priya]". Without it a
 * table with the same button on every line is a list of identical buttons.
 */
function nameRows(candidates: Candidate[]) {
  const groups = new Map<string, Candidate[]>();
  const named = new Map<Element, Candidate>();
  for (const c of candidates) {
    const key = `${c.role}|${c.label}|${c.icon ?? ""}`;
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]);
    if (c.label) named.set(c.el, c);
  }
  const pieces = new Map<Element, Piece[]>();
  const piecesOf = (row: Element) => pieces.get(row) ?? pieces.set(row, rowPieces(row)).get(row)!;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const c of group) {
      // A calendar's day is one of a row of days, and the other days do not say which one it is.
      if (c.single) continue;
      const row = rowOf(c.el);
      if (!row || isHeaderRow(row)) continue;
      // A row that is itself listed, or holds a listed box around this control, has already said what it is.
      // The outermost such box is the one that speaks for the row, in the words a person sees on it.
      let around: Candidate | undefined;
      for (let box: Element | null = c.el.parentElement; box; box = box === row ? null : box.parentElement) around = named.get(box) ?? around;
      // A table row that is listed is told by the words it shows outside its controls, the same for each of them: an
      // invoice's link is not told apart by its own number.
      const words = around && isRowOfTable(around.el) ? wordsIn(around.el, 80, CONTROLS) : around ? wordsIn(around.el, 80) : "";
      const name = around ? cleanText(words || around.label, 40) : rowName(row, c.el, piecesOf);
      if (name) c.row = entryNumber(row) + name;
    }
  }
}

/**
 * The row a control sits in: the nearest box around it that repeats, like a
 * table row, a list entry or a card among cards. A box with nothing of its
 * kind beside it is a part of the page, not a row, and the search goes on outward.
 */
function rowOf(control: Element): Element | null {
  for (let row = control.parentElement?.closest(ROW) ?? null, tries = 0; row && tries < 4; row = row.parentElement?.closest(ROW) ?? null, tries++) {
    if (sameKind(row, row.previousElementSibling) || sameKind(row, row.nextElementSibling) || isTableRow(row)) return row;
  }
  return null;
}

/**
 * A row of a table, which is a row by what it is, whatever stands beside it.
 * A table drawn with a box around each row, so that it can be measured or
 * shown on hover, leaves each row with nothing of its kind beside it.
 */
function isTableRow(row: Element): boolean {
  return isRowOfTable(row) && !!row.parentElement?.closest('table, [role="table"], [role="grid"], [role="treegrid"]');
}

function sameKind(row: Element, other: Element | null): other is Element {
  return !!other && other.tagName === row.tagName && other.getAttribute("role") === row.getAttribute("role");
}

/** A row of column headings, which names the columns and not a row. */
function isHeaderRow(row: Element): boolean {
  if (row.tagName !== "TR" && row.getAttribute("role") !== "row") return false;
  const cells = Array.from(row.children).filter((cell) => cell.matches(ROW_CELLS));
  return cells.length > 0 && cells.every((cell) => cell.matches("th, [role='columnheader']"));
}

/** An entry of a numbered list starts with its number, which is how a visitor refers to it: "3. Mobile devices". */
function entryNumber(row: Element): string {
  const list = row.parentElement;
  if (row.tagName !== "LI" || !isTag(list, "ol")) return "";
  const value = (row as HTMLLIElement).getAttribute("value");
  if (value && /^\d+$/.test(value)) return `${value}. `;
  const index = Array.from(list.children).filter((entry) => entry.tagName === "LI").indexOf(row);
  return `${(list.start || 1) + index}. `;
}

/** How many boxes out from a control to look for words that stand beside it alone. */
const BESIDE_DEPTH = 6;
const BESIDE_CHARS = 40;

/**
 * The words beside a control in the nearest box around it that says anything:
 * the value next to its "Remove", the name next to its "Edit". A box that
 * holds another control listed the same cannot tell the two apart, so the
 * search stops there. `holds` says how many of them each box holds, `not`
 * is a name already found to be shared, to look past, and `caption` is the
 * control's own name, which tells nothing apart either.
 */
function wordsBeside(control: Element, holds: Map<Element, number>, not = "", caption = ""): string {
  for (let box = control.parentElement, depth = 0; box && box !== document.body && depth < BESIDE_DEPTH; box = box.parentElement, depth++) {
    if ((holds.get(box) ?? 0) > 1) return "";
    // Marks left standing alone once the control is taken out, like the brackets around a link, are not words.
    const words = wordsIn(box, 60, CONTROLS, control).split(" ").filter((piece) => /[\p{L}\p{N}]/u.test(piece)).join(" ");
    // A box that says this much is a paragraph or a whole part of the page, not a name beside a control.
    if (words.length > BESIDE_CHARS) return "";
    // The control's own caption, like the label of a tick box, says nothing more about which one it is.
    if (words && words !== not && !(caption && saysMostOf(words, caption) && saysMostOf(caption, words))) return cleanText(words, BESIDE_CHARS);
  }
  return "";
}

/** Controls listed word for word the same, in groups. */
function twins(candidates: Candidate[]): Candidate[][] {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = `${c.role}|${c.label}|${c.icon ?? ""}|${c.href ?? ""}|${c.region}|${c.heading}|${c.row ?? ""}`;
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

/**
 * Tells apart the controls that are still listed word for word the same once
 * rows have been named. First by the words beside each, when it has some to
 * itself: three "Remove" buttons, each next to the value it removes. What is
 * left is told apart by its place among its like, in page order: "2 of 3".
 * Two fields with the same placeholder and nothing else to go by are the usual case.
 */
function tellTwinsApart(candidates: Candidate[]) {
  for (const group of twins(candidates)) {
    // A row that names several of them has said all it can.
    if (group[0]?.row) continue;
    // The page's own tooltip on each, when each has a different one, says best which is which: two days "8" are
    // "2026-11-08" and "2026-12-08". A field that shows a choice can carry that choice as its tooltip, so it is not read.
    const titles = group.map((c) => (showsAChoice(c.el, c.role) ? "" : cleanText(c.el.getAttribute("title") ?? "", BESIDE_CHARS)));
    if (titles.every(Boolean) && new Set(titles).size > 1) {
      // The same day shown in two months' panels is the same day, and is told apart from itself by its place.
      group.forEach((c, index) => (c.row = titles[index]));
      continue;
    }
    // The words beside a calendar's day are other days. Only its place tells it apart.
    if (group.some((c) => c.single)) continue;
    const holds = new Map<Element, number>();
    for (const c of group) {
      for (let box = c.el.parentElement, depth = 0; box && depth < BESIDE_DEPTH; box = box.parentElement, depth++) holds.set(box, (holds.get(box) ?? 0) + 1);
    }
    const names = group.map((c) => wordsBeside(c.el, holds, "", c.label));
    group.forEach((c, index) => {
      let name = names[index] ?? "";
      // Two of them beside the same words, like "All": the next box out may say more.
      if (name && names.indexOf(name) !== names.lastIndexOf(name)) name = wordsBeside(c.el, holds, name, c.label) || name;
      if (name) c.row = name;
    });
  }
  for (const group of twins(candidates)) group.forEach((c, index) => (c.place = `${index + 1} of ${group.length}`));
}

/** A piece of a row's text, and the text node it came from. */
interface Piece {
  text: string;
  node: Node;
}

const ROW_HEADING = "h1, h2, h3, h4, h5, h6, th, [role='rowheader'], [role='heading'], [class*='title' i], [class*='name' i], strong, b";

/** The first pieces of text in a row, in page order, leaving out buttons, fields, and words out of sight or hidden from screen readers. */
function rowPieces(row: Element): Piece[] {
  const pieces: Piece[] = [];
  let visited = 0;
  const walk = (node: Node) => {
    if (pieces.length >= 10 || visited++ > 400) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = cleanText(node.textContent ?? "", 50);
      if (text.length > 1) pieces.push({ text, node });
      return;
    }
    if (!isElement(node) || node.getAttribute("aria-hidden") === "true") return;
    if (["BUTTON", "SELECT", "SCRIPT", "STYLE", "svg"].includes(node.tagName) || holdsTyping(node) || choiceBoxes.has(node) || unseen(node)) return;
    for (const child of node.childNodes) walk(child);
  };
  walk(row);
  return pieces;
}

/**
 * What a row is about: its heading, or else the first words in it that are
 * not a control's own and that the rows beside it do not also say. Words every
 * row has ("prev", "Details", a customer's own name on each of their invoices)
 * tell no row apart, nor does a heading that is only a number.
 */
function rowName(row: Element, control: Element, piecesOf: (row: Element) => Piece[]): string {
  const shared = new Set<string>();
  for (const other of [row.previousElementSibling, row.nextElementSibling]) if (sameKind(row, other)) for (const piece of piecesOf(other)) shared.add(piece.text);
  const heading = row.querySelector(ROW_HEADING);
  if (heading && !heading.contains(control)) {
    const text = cleanText(wordsIn(heading, 100), 50);
    if (/\p{L}/u.test(text) && !shared.has(text)) return text;
  }
  const letters = (text: string) => (text.replace(/\[(?:number|email)\]/g, "").match(/\p{L}/gu) ?? []).length;
  const digits = (text: string) => /\d/.test(text.replace(/\[(?:number|email)\]/g, ""));
  const mine = piecesOf(row).filter((piece) => !control.contains(piece.node));
  const own = mine.filter((piece) => !shared.has(piece.text));
  // Real words first, then a date or an amount of the row's own, and only then what the rows beside it say too.
  const found = own.find((piece) => letters(piece.text) >= 4) ?? own.find((piece) => letters(piece.text) > 0 || digits(piece.text)) ?? mine.find((piece) => letters(piece.text) >= 4) ?? mine[0];
  return found?.text ?? "";
}

/**
 * The words beside a field that say what it is for, when the page has not
 * tied them to it. Forms built from table cells or from a grid of boxes put
 * the caption in the cell or box before the field, and nothing in the markup
 * says so. A tick box or a switch usually has its words after it.
 */
const CONTROLS = "input, select, textarea, button, a[href], [role='button'], [role='combobox'], [role='textbox'], [role='searchbox'], [contenteditable]:not([contenteditable='false'])";

/** Anything that takes a value or a tick, whatever it is built from. */
const FIELDS =
  "input, select, textarea, [role='switch'], [role='slider'], [role='checkbox'], [role='radio'], [role='spinbutton'], [role='combobox'], [role='textbox'], [role='searchbox']";

/**
 * Whether a box holds something pressed on its own, shown by a pointer cursor
 * that starts there: the cross on a chosen value's tag. Such a box is that
 * value, not a caption.
 */
function holdsPressable(box: Element): boolean {
  // Only the first few boxes inside are looked at: a tag is small, and a large box is no caption anyway.
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_ELEMENT);
  for (let inner = walker.nextNode() as Element | null, looked = 0; inner && looked < 30; inner = walker.nextNode() as Element | null, looked++) {
    if (getComputedStyle(inner).cursor === "pointer" && inner.parentElement && getComputedStyle(inner.parentElement).cursor !== "pointer") return true;
  }
  return false;
}

/**
 * Whether a box is pressed on its own, the way the widget tells a control from
 * a box of words: it takes clicks, has a control's role, can be reached with
 * the keyboard, or shows the pointer cursor from itself rather than from the
 * box around it. Its words are then that control's name. A label is pressed
 * for the field it names, so its words stay a caption.
 */
function pressedOnItsOwn(box: Element): boolean {
  if (box.tagName === "LABEL") return false;
  if (box.hasAttribute("onclick") || (box.getAttribute("role") ?? "").split(/\s+/).some((role) => INTERACTIVE_ROLES.has(role))) return true;
  if (isFocusable(box) && !FOCUSABLE_NOT_CLICKABLE.has(box.tagName)) return true;
  if (!MAYBE_CLICKABLE.has(box.tagName) || getComputedStyle(box).cursor !== "pointer") return false;
  return !box.parentElement || getComputedStyle(box.parentElement).cursor !== "pointer";
}

function captionOf(el: Element, after: boolean): string {
  return captionNode(el, after).text;
}

/**
 * The caption beside a field, and the box it was read from, when that was a
 * box and not bare words. A `<label>` that is tied to no other field is the
 * page saying plainly what the field is called.
 */
function captionNode(el: Element, after: boolean): { text: string; from?: Element } {
  // A box that is a control, or holds one, is not a caption: its words are that control's, or what a visitor typed into it.
  // Before a field, that holds for a box listed as a control because it takes clicks as much as for a button. After a
  // tick box, words that take clicks are usually its own caption, pressed to tick it.
  const wordsOf = (node: Element): string => {
    if (holdsTyping(node) || node.matches(CONTROLS) || node.querySelector(CONTROLS) || (!after && pressedOnItsOwn(node)) || holdsPressable(node)) return "";
    const text = cleanText(wordsIn(node, 120), 61);
    return text.length > 60 ? "" : text.replace(/\s*[:*]+$/, "");
  };
  const step = (from: Node) => (after ? from.nextSibling : from.previousSibling);
  let node: Element | null = el;
  for (let depth = 0; depth < 6 && node && node !== document.body; depth++) {
    // Inside an editor the words beside a control are the visitor's own.
    if ((node.parentElement as HTMLElement | null)?.isContentEditable) return { text: "" };
    // Beside a select's field, in the box it fills, is the choice the visitor made: the caption is outside that box.
    if (node.parentElement && choiceBoxes.has(node.parentElement)) {
      node = node.parentElement;
      continue;
    }
    // A column heading names its column. The heading beside it names another.
    if (depth > 0 && node.matches("th, [role='columnheader']")) return { text: "" };
    // The nearest words beside it, whether bare words in the same box or a box of their own:
    // in "from account # [ ] to account # [ ]" the second field is "to account #".
    for (let beside = step(node), tried = 0; beside && tried < 3; beside = step(beside)) {
      if (beside.nodeType === Node.TEXT_NODE) {
        const text = cleanText(beside.textContent ?? "", 61);
        if (text.length > 1 && text.length <= 60 && /[\p{L}\p{N}]/u.test(text)) return { text: text.replace(/\s*[:*]+$/, "") };
        if (text) tried++;
        continue;
      }
      if (!isElement(beside)) continue;
      tried++;
      // A heading names the part of the page the field is in, and what comes before it belongs to other parts.
      if (beside.matches(HEADINGS)) return { text: "" };
      const text = wordsOf(beside);
      if (text) return { text, from: beside };
      // Another field, or another field's box: the caption beyond it belongs to that field. A switch or a slider
      // is a field too: "Disabled:" before a switch is the switch's, not the slider's before it.
      if (holdsTyping(beside) || beside.matches(FIELDS) || beside.querySelector(FIELDS)) return { text: "" };
    }
    node = node.parentElement;
    if (node && ["FORM", "TABLE", "TBODY", "FIELDSET", "UL", "OL"].includes(node.tagName)) break;
  }
  return { text: "" };
}

/** The `<label>` a caption was read from, when it was one, or the only one in its box, and is tied to no field. */
function untiedLabel(from: Element | undefined): HTMLLabelElement | undefined {
  const label = isTag(from, "label") ? from : from?.querySelectorAll("label").length === 1 ? from.querySelector("label") : null;
  return label && !label.control && !label.hasAttribute("for") ? label : undefined;
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
  if (isTag(el, "textarea") || isTag(el, "select")) return true;
  if (isTag(el, "input")) return !["checkbox", "radio", "button", "submit", "reset", "image"].includes(el.type);
  return (el as HTMLElement).isContentEditable;
}

/**
 * A label's own words. When the label wraps its field, the field's options or
 * contents are part of the label's text, and those must not end up in its name.
 * Neither must decoration hidden from screen readers, like the star on a required field.
 */
function labelWords(label: Element): string {
  return wordsIn(label, 200, "button, datalist, output", undefined, true);
}

/** Roles whose own words are what is entered or chosen in them, not a name. */
const SHOWS_A_VALUE = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider", "select"]);

/**
 * A name given for screen readers can leave out the words on the control
 * itself: a filter chip that shows "state = firing" and is named "Edit filter
 * with key state". A person finds a control by the words they see, so when the
 * name does not hold them both are given, the words shown first. The words of
 * a button or link inside the control are that one's, not this one's.
 */
function withShownWords(name: string, el: Element): string {
  const shown = wordsIn(el, 120, "button, a[href], select, [role='button']");
  if (!shown) return name;
  const words = wordsOfLabel;
  const inName = new Set(words(name));
  const inShown = new Set(words(shown));
  if (words(shown).every((word) => inName.has(word))) return name;
  // The name is some of the words shown. On a button those are a fuller name. On a box of text the name is the page's own summary.
  if (words(name).every((word) => inShown.has(word))) return shown.length <= 48 ? shown : name;
  return `${shown.length > 48 ? `${shown.slice(0, 47).trimEnd()}…` : shown} (${name})`;
}

/** Whether a control shows the choice made in a list it opens: a combobox, or a button that opens a listbox. */
function opensAList(el: Element, role: string): boolean {
  return role === "combobox" || ["listbox", "tree", "grid"].includes((el.getAttribute("aria-haspopup") ?? "").toLowerCase());
}

/**
 * Whether a control shows a choice the visitor made: a select, or a control
 * that opens a list and shows what was picked from it. Its own words are that
 * choice, which is never sent as its name.
 */
function showsAChoice(el: Element, role: string): boolean {
  return role === "select" || opensAList(el, role);
}

/**
 * What the page calls a field, for a control that says it is named by that
 * field: what names the field in turn, its placeholder or its tooltip. Never
 * what was written in it.
 */
function nameOfField(field: Element): string {
  const root = field.getRootNode() as Document | ShadowRoot;
  const byIds = (field.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => (id ? root.getElementById?.(id) : null))
    .map((named) => (named && !holdsTyping(named) && !named.contains(field) ? wordsIn(named, 200, "", undefined, true) : ""))
    .join(" ")
    .trim();
  const labels = isTag(field, "input") || isTag(field, "textarea") ? Array.from(field.labels ?? []).map(labelWords).join(" ").trim() : "";
  return byIds || field.getAttribute("aria-label")?.trim() || labels || field.getAttribute("placeholder") || field.getAttribute("aria-placeholder") || field.getAttribute("title") || "";
}

/**
 * The name of what a control opens, when it says what that is and the page
 * names it: a menu labelled "Account". A menu named by the button that opens
 * it says nothing more.
 */
function nameOfWhatItOpens(el: Element): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  for (const id of (el.getAttribute("aria-controls") ?? "").split(/\s+/).slice(0, 3)) {
    const opened = id ? root.getElementById?.(id) : null;
    if (!opened || opened.contains(el)) continue;
    const byIds = (opened.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
    const name = byIds.includes(el.id) ? opened.getAttribute("aria-label")?.trim() ?? "" : nameOfBox(opened);
    if (name) return name;
  }
  return "";
}

/**
 * Where a box sits in the window, by thirds: "top right", "bottom left", or
 * "middle". A box above or below the window is placed only from side to side.
 */
function spotOf(rect: DOMRect, viewportHeight: number): string {
  const third = (at: number, size: number, ends: [string, string]) => (at < size / 3 ? ends[0] : at > (size * 2) / 3 ? ends[1] : "middle");
  const across = third(rect.left + rect.width / 2, window.innerWidth, ["left", "right"]);
  if (rect.bottom <= 0 || rect.top >= viewportHeight) return across === "middle" ? "" : across;
  const down = third(rect.top + rect.height / 2, viewportHeight, ["top", "bottom"]);
  return down === "middle" && across === "middle" ? "middle" : `${down} ${across}`;
}

/** The aria-label or aria-labelledby of the box just around a control, which some pages put there rather than on the control. */
function nameAround(el: Element): string {
  for (let box = el.parentElement, depth = 0; box && box !== document.body && depth < 2; box = box.parentElement, depth++) {
    if (box.matches(CONTROLS) || box.hasAttribute("role")) return "";
    const name = nameOfBox(box);
    if (name) return name;
  }
  return "";
}

function labelOf(el: Element, role: string): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  /** Named by a part of itself, which is then a name the visitor can see. */
  let namedByOwnWords = false;
  /** A field that shows the choice made in a list it opens. Its own words are that choice, which is the visitor's. */
  const choice = showsAChoice(el, role);
  const byIds = (ids: string) =>
    ids
      .split(/\s+/)
      .map((id) => {
        const named = id ? root.getElementById?.(id) : null;
        if (!named) return "";
        if (el.contains(named)) {
          // A select that names itself by its own words as well as its caption ("Age Ten") is named by the caption.
          if (choice) return "";
          namedByOwnWords = true;
        }
        // A control named by a field is named by what the page calls that field, never by what is written in it.
        return holdsTyping(named) ? nameOfField(named) : wordsIn(named, 200, "", undefined, true);
      })
      .join(" ")
      .trim();
  // An editor's own words are the visitor's. It is named by what its page calls it, or by nothing.
  const typedIn = holdsTyping(el);
  /** The name the page gives for screen readers. */
  const given = byIds(el.getAttribute("aria-labelledby") ?? "") || el.getAttribute("aria-label")?.trim() || "";
  let raw = el.getAttribute("data-haptic-label") || (given && !typedIn && !namedByOwnWords && !choice && !SHOWS_A_VALUE.has(role) ? withShownWords(given, el) : given);
  const ticks = role === "checkbox" || role === "radio" || role === "switch";
  // A button, or a control by its role, that a <label> names: a switch or a tick box drawn as a button, or the button
  // of a date picker. The label is its name, as the accessibility tree has it, even when only a screen reader can
  // see it. The words the button shows are not added: a picker's are the date the visitor chose.
  if (!raw && !(isTag(el, "input") || isTag(el, "select") || isTag(el, "textarea"))) {
    raw = labelsOf(el)
      .map((label) => labelWords(label) || label.getAttribute("aria-label") || "")
      .join(" ")
      .trim();
  }
  if (!raw && (isTag(el, "input") || isTag(el, "select") || isTag(el, "textarea"))) {
    // A label can carry its words as an aria-label of its own.
    raw = Array.from(el.labels ?? []).map((label) => labelWords(label) || label.getAttribute("aria-label") || "").join(" ").trim();
    // A button's value is its caption, not user data.
    if (!raw && isTag(el, "input") && role === "button") raw = el.value || el.type;
    if (!raw && ticks) raw = captionOf(el, true) || captionOf(el, false);
    // A placeholder is often a hint ("yyyy-dd-mm", "Type for hints...") and the page's caption sits in a
    // <label> beside the field, tied to nothing. Then the caption is the name and the hint follows it, so
    // two date fields are not both called "yyyy-dd-mm".
    const hint = el.getAttribute("placeholder");
    if (!raw && hint && untiedLabels) {
      const caption = captionNode(el, false);
      if (caption.text && untiedLabel(caption.from) && caption.text !== hint) raw = `${caption.text} (${hint})`;
    }
    raw ||= hint || el.getAttribute("title") || "";
    if (!raw && !ticks) raw = captionOf(el, false);
    // The name attribute is for the server, but when it reads as words it is better than nothing.
    raw ||= wordsOfName(el.getAttribute("name") ?? "");
  }
  // A control that shows the choice it opens a list for is named by what its page calls it, not by that choice.
  if (!raw && !typedIn && opensAList(el, role)) raw = nameAround(el) || captionOf(el, false);
  // A box the keyboard can reach, standing where a field stands under a <label> tied to nothing, is that
  // field: a custom select that shows "-- Select --" is "Job Title".
  if (!raw && untiedLabels && role === "clickable" && isFocusable(el)) {
    const caption = captionNode(el, false);
    if (untiedLabel(caption.from)) raw = caption.text;
  }
  // Never use a field's contents as its label, nor the choice a select shows.
  // A table row is named by what it shows, and not by the words of the buttons for its actions.
  if (!raw && role !== "textbox" && !choice && !typedIn) raw = visibleText(el, isRowOfTable(el) ? `${NESTED_ENTRIES}, ${ROW_ACTIONS}` : NESTED_ENTRIES);
  // What the page shows in an empty field is the page's own words for it.
  if (!raw && typedIn) raw = el.getAttribute("placeholder") || el.getAttribute("aria-placeholder") || el.getAttribute("data-placeholder") || "";
  raw ||= el.getAttribute("title") || "";
  // A select can show its choice as a picture, a flag for a country, whose words are that choice too.
  if (!raw && !typedIn && !choice) raw = pictureName(el) || drawnWords(el);
  // A custom field or tick box, built from boxes with no words of its own.
  // A tick box is captioned by the words after it. A field that is typed in or chosen from is captioned by the words
  // before it only: the words after it belong to whatever comes next, a paragraph or the next part of the page.
  if (!raw.trim() && (role === "textbox" || role === "combobox" || role === "searchbox" || role === "spinbutton" || role === "slider" || ticks)) raw = ticks ? captionOf(el, true) || captionOf(el, false) : captionOf(el, false);
  // Some pages hand over text that has been escaped twice.
  raw = raw.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return cleanText(raw, 80);
}

/** Pictures that can carry a name: an image, a drawing, or a box that says it is a picture. */
const PICTURES = 'img, svg, [role="img"]';
/** How many pictures inside a control are looked at for a name. */
const MAX_PICTURES = 4;

/**
 * The name of the picture a control shows, when the page gives it one and the
 * control has no words: an image's alt text, or the aria-label, the
 * aria-labelledby or the <title> of a drawing or of a box that says it is a
 * picture. That is how the accessibility tree names a button that shows only
 * an icon. Pictures in a component's shadow root are looked at too, and one
 * hidden from screen readers is passed over.
 */
function pictureName(el: Element): string {
  const named = (picture: Element): string => {
    if (picture.closest('[aria-hidden="true"]') && picture.closest('[aria-hidden="true"]') !== el.closest('[aria-hidden="true"]')) return "";
    const root = picture.getRootNode() as Document | ShadowRoot;
    const byIds = (picture.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id) => (id ? root.getElementById?.(id) : null))
      .map((node) => (node && !holdsTyping(node) ? wordsIn(node, 120, "", undefined, true) : ""))
      .join(" ")
      .trim();
    if (byIds) return byIds;
    const label = picture.getAttribute("aria-label")?.trim();
    if (label) return label;
    if (isTag(picture, "img")) return picture.alt.trim();
    const title = picture.tagName === "svg" ? Array.from(picture.children).find((child) => child.tagName === "title") : undefined;
    return title?.textContent?.trim() ?? "";
  };
  if (el.matches(PICTURES)) return named(el);
  let looked = 0;
  const look = (root: Element | ShadowRoot, depth: number): string => {
    for (const picture of Array.from(root.querySelectorAll(PICTURES))) {
      if (looked++ >= MAX_PICTURES) return "";
      const name = named(picture);
      if (name) return name;
    }
    // A picture drawn by a component inside the control, like an icon element, is in that component's shadow root.
    if (depth < 2) {
      for (const host of Array.from(root.querySelectorAll("*")).slice(0, 20)) {
        if (!host.shadowRoot || host.getAttribute("aria-hidden") === "true") continue;
        const name = (host.getAttribute("role") === "img" && host.getAttribute("aria-label")?.trim()) || look(host.shadowRoot, depth + 1);
        if (name) return name;
      }
    }
    return "";
  };
  return look(el.shadowRoot ?? el, 0);
}

/** Characters a font of icons draws pictures with, which are no words: the Unicode range set aside for private use. */
const ICON_GLYPHS = /^[\uE000-\uF8FF\s]*$/u;

/**
 * Words a stylesheet writes into an empty control before or after its
 * content, like the "§" of a link to a section of a long document. A screen
 * reader reads them, and a visitor sees them. A character of a font of icons
 * says nothing.
 */
function drawnWords(el: Element): string {
  if (el.childElementCount > 2) return "";
  let words = "";
  for (const pseudo of ["::before", "::after"]) {
    const content = getComputedStyle(el, pseudo).content;
    const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(content);
    if (quoted) words += quoted[1]!.replace(/\\(.)/g, "$1");
  }
  return ICON_GLYPHS.test(words) ? "" : words.trim();
}

/** The words a control shows, or failing those the words it has for screen readers only, like an icon button's name. */
function visibleText(el: Element, skip = ""): string {
  return wordsIn(el, 160, skip) || wordsIn(el, 160, skip, undefined, true);
}

/** The entries a tree's or a menu's entry holds under it, which are listed on their own and are not part of its name. */
const NESTED_ENTRIES = '[role="group"], [role="tree"], [role="menu"], [role="listbox"]';

/** Icon-only buttons are common in dashboards. The icon's class name is often the only clue. */
function iconOf(el: Element): string | undefined {
  // Nothing inside an editor is the page's own, its pictures included.
  if ((el as HTMLElement).isContentEditable) return undefined;
  // The pencil on a table row's edit button is that button's picture, and the tick in its tick box is the tick box's.
  const pictures = Array.from(el.querySelectorAll("svg, i, [class*='icon']"));
  const owner = (picture: Element) => picture.parentElement?.closest(`${CONTROLS}, label, ${TICKS}`);
  const own = isRowOfTable(el) ? pictures.filter((picture) => !el.contains(owner(picture) ?? null)) : pictures;
  for (const candidate of [el, ...own.slice(0, 4)]) {
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
  return popup === "listbox" || popup === "tree" || popup === "grid" ? "opens a list" : OPENS_A_MENU;
}

const OPENS_A_MENU = "opens a menu";

/** Roles a visitor fills in, picks from or ticks, which a form can require. */
const CAN_BE_REQUIRED = new Set(["textbox", "searchbox", "combobox", "select", "spinbutton", "slider", "checkbox", "radio", "switch", "file-upload"]);
/** A required mark in the words that name a field: "(required)", or a star at either end. */
const REQUIRED_MARK = /\(\s*required\s*\)|^\*|\*$/i;

/**
 * Whether the words that name a field carry a required mark. The mark is
 * usually hidden from screen readers, since the field says it another way, so
 * hidden words count here. A star drawn by the stylesheet counts too. Nothing
 * inside a field is read.
 */
function markedRequired(name: Element): boolean {
  if (holdsTyping(name) || insideEditor(name)) return false;
  let text = "";
  let visited = 0;
  const walk = (node: Node) => {
    if (visited++ > 60 || text.length > 200) return;
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
    else if (isElement(node) && !holdsTyping(node) && !NOT_WORDS.has(node.tagName)) for (const child of node.childNodes) walk(child);
  };
  walk(name);
  if (REQUIRED_MARK.test(text.replace(/\s+/g, " ").trim())) return true;
  return ["::before", "::after"].some((pseudo) => /^["']\s*\*\s*["']$/.test(getComputedStyle(name, pseudo).content));
}

/** The elements whose words name an element: its labels and what aria-labelledby points to. */
function namesOf(el: Element): Element[] {
  const names: Element[] = [...labelsOf(el)];
  const root = el.getRootNode() as Document | ShadowRoot;
  for (const id of (el.getAttribute("aria-labelledby") ?? "").split(/\s+/)) {
    const named = id ? root.getElementById?.(id) : null;
    if (named) names.push(named);
  }
  return names;
}

/**
 * Whether the page says a field must be filled in or ticked. Without this the
 * model cannot know why the browser refuses "Next", which it does with a bubble
 * of its own and no change to the page. A radio or a tick box usually takes it
 * from its group: the group's attributes, or a mark in the group's legend or label.
 */
function isRequired(el: Element, role: string): boolean {
  if (!CAN_BE_REQUIRED.has(role)) return false;
  if ((el as HTMLInputElement).required === true || el.getAttribute("aria-required") === "true") return true;
  const names = namesOf(el);
  if (!names.length && untiedLabels && role !== "radio" && role !== "checkbox" && role !== "switch") {
    const label = untiedLabel(captionNode(el, false).from);
    if (label) names.push(label);
  }
  if (role === "radio" || role === "checkbox" || role === "switch") {
    const group = el.parentElement?.closest("fieldset, [role='radiogroup'], [role='group']");
    if (group) {
      if (group.getAttribute("aria-required") === "true" || group.getAttribute("data-required") === "true") return true;
      const legend = group.tagName === "FIELDSET" ? group.querySelector(":scope > legend") : null;
      names.push(...(legend ? [legend] : []), ...namesOf(group));
    }
  }
  return names.some(markedRequired);
}

/**
 * Whether a control cannot be used: it says so, a disabled group of fields
 * holds it, or it is inside an entry that says so, like the link inside a
 * menu's disabled item, or a tick box inside a list's disabled option.
 */
function isDisabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return true;
  try {
    if (isNative(el) && el.matches(":disabled")) return true;
  } catch {
    // :disabled unsupported. What the control says of itself stands.
  }
  return !!el.parentElement?.closest('[aria-disabled="true"]');
}

/** The controls with a role of their own among these, when there are some and none of them can be used. */
function disabledWithin(within: Candidate[]): Candidate[] {
  const controls = within.filter((c) => c.role !== "clickable");
  return controls.length && controls.every((c) => c.state?.includes("disabled")) ? controls : [];
}

/** The longest reason given for a control that cannot be used. A longer text is a paragraph, not a reason. */
const MAX_REASON = 72;

/**
 * What the page says about a control, read as why it cannot be used when it
 * cannot: what aria-describedby points to, such as a tooltip that is open,
 * its aria-description, or its tooltip. Nothing inside a field is read.
 */
function reasonOf(el: Element): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  const described = (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .map((id) => (id ? root.getElementById?.(id) : null))
    .map((node) => (node && !holdsTyping(node) && !insideEditor(node) ? wordsIn(node, 200, "", undefined, true) : ""))
    .join(" ")
    .trim();
  return described || el.getAttribute("aria-description")?.trim() || el.getAttribute("title")?.trim() || "";
}

/** Gives a control that cannot be used the reason the page gives, unless it has one, or the reason only says its name again. */
function giveReason(c: Candidate, reason: string) {
  const why = cleanText(reason, MAX_REASON);
  if (c.why || !why || (saysMostOf(why, c.label) && saysMostOf(c.label, why))) return;
  c.why = why;
}

/** A state is at most 16 characters: the server cuts anything longer. */
function stateOf(el: Element, role: string): string[] {
  const state: string[] = [];
  if (isDisabled(el)) state.push("disabled");
  if (isRequired(el, role)) state.push("required");
  const popup = opens(el, role);
  if (popup) state.push(popup);
  const expanded = el.getAttribute("aria-expanded");
  if (expanded === "true") state.push("expanded");
  else if (expanded === "false") state.push("collapsed");
  const current = el.getAttribute("aria-current");
  if (current && current !== "false") state.push("current");
  if (el.getAttribute("aria-selected") === "true") state.push("selected");
  if (el.getAttribute("aria-pressed") === "true") state.push("pressed");
  const checkable = isTag(el, "input") && (el.type === "checkbox" || el.type === "radio");
  if ((checkable && el.checked) || el.getAttribute("aria-checked") === "true") state.push("checked");
  if (isTag(el, "details") ? el.open : el.tagName === "SUMMARY" && (el.parentElement as HTMLDetailsElement | null)?.open) state.push("expanded");
  return state;
}

function hrefOf(el: Element): string | undefined {
  if (!isTag(el, "a")) return undefined;
  // A link that opens a menu or unfolds a section does that when clicked. The
  // address it carries is for a browser without scripts, and would be taken for where a click leads.
  if (el.hasAttribute("aria-expanded") || !["", "false"].includes((el.getAttribute("aria-haspopup") ?? "").toLowerCase())) return undefined;
  const raw = el.getAttribute("href");
  // "#reviews" is a place further down this page. "#/orders" is a screen of an app that keeps its place after the "#".
  if (!raw || (raw.startsWith("#") && !raw.startsWith("#/")) || raw.startsWith("javascript:")) return undefined;
  try {
    const url = new URL(el.href, location.href);
    // The route is kept in the same form as the page's own path, or every link of such an app would show one address.
    return url.origin === location.origin ? normalizePath(url.pathname) + whichPage(url.searchParams) + routeOf(url.hash) : `external:${url.hostname}`;
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
    // One that says it is not modal, like a notice about cookies in a corner, is not, whatever is drawn over the page.
    const modal = el.getAttribute("aria-modal");
    if (modal === "true" || (modal !== "false" && coversThePage(el, ignore))) modals.push(el);
  });
  return modals[modals.length - 1] ?? modalInShadow(ignore);
}

const DIALOGS = 'dialog, [role="dialog"], [role="alertdialog"]';

/**
 * A modal dialog drawn inside a component's open shadow root, which a search
 * of the page does not see into. It is looked for where a dialog that shuts
 * out the page is seen, at the middle of the window: in the shadow roots of
 * what is drawn there, the innermost first. Only one that says it is modal,
 * or that the browser shows as modal, counts.
 */
function modalInShadow(ignore: Element): Element | undefined {
  const x = window.innerWidth / 2;
  const y = window.innerHeight / 2;
  const roots: ShadowRoot[] = [];
  let hit = document.elementsFromPoint(x, y).find((el) => el !== ignore && !ignore.contains(el));
  for (let depth = 0; hit?.shadowRoot && depth < 30; depth++) {
    const root: ShadowRoot = hit.shadowRoot;
    roots.unshift(root);
    const inner: Element | undefined = root.elementsFromPoint(x, y).find((el) => el !== hit);
    if (!inner) break;
    hit = inner;
  }
  for (const root of roots) {
    for (const dialog of Array.from(root.querySelectorAll(DIALOGS))) {
      if (!isRendered(dialog)) continue;
      let modal = dialog.getAttribute("aria-modal") === "true";
      try {
        modal ||= dialog.matches(":modal");
      } catch {
        // :modal unsupported. What the dialog says of itself stands.
      }
      if (modal) return dialog;
    }
  }
  return undefined;
}

/** Whether what is drawn at the middle of the part of a box that is in the window is that box, or in it. */
function seenAtItsMiddle(el: Element, rect: DOMRect, ignore: Element): boolean {
  const left = Math.max(rect.left, 0);
  const right = Math.min(rect.right, window.innerWidth);
  const top = Math.max(rect.top, 0);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  if (right <= left || bottom <= top) return false;
  const hit = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2).find((over) => over !== ignore && !ignore.contains(over));
  return !!hit && (el.contains(hit) || hit.contains(el));
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
  // A dialog that is itself under the layer, like a notice under the layer a list puts behind itself, is not what took the page over.
  if (!seenAtItsMiddle(dialog, rect, ignore)) return false;
  // Either it lies beside the dialog, or it wraps the dialog and is pinned to the window.
  return !top.contains(dialog) || getComputedStyle(top).position === "fixed";
}

/**
 * A dialog's name: what aria-labelledby points to, or its aria-label, or else
 * the first heading in it that has words of its own. A title bar that holds a
 * search box and a "Clear" button is not called "Clear".
 */
function dialogLabel(el: Element): string {
  const named = nameOfBox(el);
  if (named) return cleanText(named, 60);
  let words = "";
  for (const heading of Array.from(el.querySelectorAll(HEADINGS)).slice(0, 4)) if ((words = headingWords(heading))) break;
  // A dialog with no name and no heading is named by its first words, which are its title drawn as text,
  // unless those are a field's caption or a link's.
  words ||= rowPieces(el).find((piece) => /\p{L}{3}/u.test(piece.text) && !piece.node.parentElement?.closest(`label, ${CONTROLS}`))?.text ?? "";
  return cleanText(words, 60);
}
