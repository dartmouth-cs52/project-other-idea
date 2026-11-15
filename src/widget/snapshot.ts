import { cleanText as maskAndTrim, describeElement, normalizePath, namedIn, type SnapElement, type Snapshot } from "../shared/types.ts";

// Turns the live page into the list of elements the model sees. One read-only
// pass over the DOM. What a visitor typed is never read: not the value of a
// field, and not the words inside an editor. Every piece of text taken from
// the page goes through `wordsIn`, which passes over both.

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

/** Tags whose contents are never words on the page: code, a drawing, a dropdown's choices. */
const NOT_WORDS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SELECT", "svg"]);
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
  if (holdsTyping(el) || insideEditor(el)) return "";
  let text = "";
  let visited = 0;
  const walk = (node: Node) => {
    // A box can hold thousands of nodes and no words. Looking stops well before that costs anything.
    if (text.length > max || visited++ > MAX_NODES_FOR_WORDS) return;
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    if (!(node instanceof Element) || node === except) return;
    if (NOT_WORDS.has(node.tagName) || holdsTyping(node) || node.getAttribute("aria-hidden") === "true" || (skip && node.matches(skip))) return;
    if (!unseenToo && unseen(node)) return;
    for (const child of node.childNodes) walk(child);
    if (!WITHIN_A_SENTENCE.has(node.tagName)) text += " ";
  };
  for (const child of el.childNodes) walk(child);
  return text.replace(/\s+/g, " ").trim();
}

/**
 * What a control says, for telling the model which one a visitor clicked. It
 * is masked like everything else, and is empty for anything a visitor typed in.
 */
export function shownWords(el: Element, max = 60): string {
  return cleanText(wordsIn(el, max * 2) || wordsIn(el, max * 2, "", undefined, true), max);
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
  if (!(root instanceof Document) && !(root instanceof ShadowRoot)) return undefined;
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
      } else if (child instanceof Element) {
        if (NOT_WORDS.has(child.tagName) || holdsTyping(child) || child.getAttribute("aria-hidden") === "true" || getComputedStyle(child).display !== "inline") {
          text += " ";
          continue;
        }
        taken.add(child);
        walk(child, inControl || child.matches(CONTROLS));
      }
    }
  };
  walk(el, false);
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
 * A control's surroundings in one line: the region, the heading, the row and
 * its place among its like. When that is too long the heading gives way,
 * because the row and the place are what tell two controls apart.
 */
function contextOf(c: Candidate): string {
  const region = c.region === "page" ? "" : c.region;
  const rest = [c.row ? `row: ${c.row}` : "", c.place ?? ""].filter(Boolean);
  const room = MAX_CONTEXT - [region, ...rest].filter(Boolean).join(" › ").length - 3;
  const heading = c.heading.length > room ? (room > 12 ? `${c.heading.slice(0, room - 1).trimEnd()}…` : "") : c.heading;
  return [region, heading, ...rest].filter(Boolean).join(" › ");
}

interface Scope {
  region: string;
  heading: string;
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
  return found ? cleanText(wordsIn(found, 160), 80) : "";
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
const cleanText = (text: string, max = 80): string => maskAndTrim(text, max, own);

/**
 * Reads the page. `ignore` is Haptic's own element. `question` is what the
 * visitor asked: an email or a long number in it is the only one left
 * unmasked. Every reading within one guide has to be given the same question,
 * or one control would be named two ways. `near` is the control last used,
 * whose surroundings are the page text that matters most after the screen:
 * by default the one Haptic's pointer last pointed at, which the pointer
 * keeps on Haptic's element.
 */
export function takeSnapshot(ignore: Element, question: string, near = (ignore as Element & { pointedAt?: Element }).pointedAt): PageSnapshot {
  own = namedIn(question);
  const candidates: Candidate[] = [];
  const headings: Heading[] = [];
  const texts: TextBlock[] = [];
  const viewportHeight = window.innerHeight;
  let visited = 0;
  let hiddenChecked = 0;
  /** Elements whose words were read as part of a sentence around them. */
  const taken = new WeakSet<Element>();
  let order = 0;
  /** Where in the page's text the control last used sits, if it was given. */
  let nearAt = -1;

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
    if (visited++ > MAX_VISITED || el === ignore || SKIP_TAGS.has(el.tagName)) return;
    if (el === near) nearAt = order;
    /** Hidden from screen readers, but there for the mouse: a search box's magnifying glass. */
    let pressableOnly = false;
    if (el.hasAttribute("inert") || el.hasAttribute("data-haptic-ignore") || el.getAttribute("aria-hidden") === "true") {
      // An app hides the page behind its dialog this way, and the dialog itself is inside what it hid only by mistake.
      if (!modal || !el.contains(modal) || el === modal) {
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
        if (getComputedStyle(el).display === "contents" && !holdsTyping(el)) for (const child of el.children) visit(child, scope, parentPointer, insideControl);
        return;
      }
    }

    // An element can name more than one role. The one that says how it is used is the one that matters.
    const roles = (el.getAttribute("role") ?? "").split(/\s+/).filter(Boolean);
    const explicitRole = roles.find((name) => INTERACTIVE_ROLES.has(name)) ?? roles[0] ?? "";
    const landmark = LANDMARKS[explicitRole] ?? LANDMARKS[el.tagName];
    // A part of the page that is set apart keeps its heading to itself: a panel's title is not the heading of what comes after the panel.
    const section = !landmark && el !== root && el !== modal && (SECTION_TAGS.has(el.tagName) || SECTION_ROLES.has(explicitRole));
    const childScope: Scope =
      el === modal ? { region: "dialog", heading: "" }
      : landmark && el !== root ? { region: landmark, heading: nameOfBox(el) }
      : section ? { region: scope.region, heading: headingOfBox(el) || scope.heading }
      : scope;

    const headingTag = /^H([1-6])$/.exec(el.tagName);
    if ((headingTag || explicitRole === "heading") && !hoverBox) {
      const text = cleanText(wordsIn(el, 160), 80);
      if (text) {
        scope.heading = text;
        const level = Number(el.getAttribute("aria-level")) || Number(headingTag?.[1]) || 2;
        const rect = el.getBoundingClientRect();
        if (headings.length < 200) headings.push({ text, level, visible: rect.bottom > 0 && rect.top < viewportHeight });
      }
    }

    // cursor:pointer is inherited, so only the element where it starts counts.
    const pointerHere = !INTERACTIVE_ROLES.has(explicitRole) && !svg && MAYBE_CLICKABLE.has(el.tagName) ? getComputedStyle(el).cursor === "pointer" : parentPointer;
    const role = pressableOnly ? "clickable"
      : svg && !INTERACTIVE_ROLES.has(explicitRole) && !(el.tagName.toLowerCase() === "a" && (el.hasAttribute("href") || el.hasAttribute("xlink:href"))) ? ""
      : roleOf(el, explicitRole, pointerHere && !parentPointer && !insideControl);

    /** A table row is read as one line, so its cells are not read again on their own. */
    const isRow = !role && (el.tagName === "TR" || explicitRole === "row");
    let rowRead = false;
    let added: Candidate | undefined;
    if (role) {
      const rect = el.getBoundingClientRect();
      if (hasRealBox(el, rect) && (!hoverBox || liesInside(rect, hoverBox))) {
        added = { el, id: "", role, label: labelOf(el, role), nav: ["nav", "header", "aside", "menu", "tabs", "footer"].includes(scope.region), region: scope.region, heading: scope.heading, outside };
        const options = optionsOf(el);
        if (options.length) added.options = options;
        const icon = iconOf(el);
        if (icon) added.icon = icon;
        const state = stateOf(el, role);
        // Fully transparent controls have always been listed: row actions that fade in. One that a stylesheet shows on hover says so.
        const fades = !hoverBox && hiddenChecked < MAX_HIDDEN_CHECKED && getComputedStyle(el).opacity === "0" && ++hiddenChecked > 0 && shownWhenOver(el, false, true);
        if (hoverBox || (fades && liesInside(rect, fades))) state.push(SHOWS_ON_HOVER);
        if (state.length) added.state = state;
        const href = hrefOf(el);
        if (href) added.href = href;
        if (rect.bottom <= 0) added.offscreen = "above";
        else if (rect.top >= viewportHeight) added.offscreen = "below";
        candidates.push(added);
      }
    } else if ((!insideControl || held) && !svg && !outside && !hoverBox && (TEXT_TAGS.has(el.tagName) || isRow) && !taken.has(el) && (held ?? texts).length < MAX_TEXT_BLOCKS) {
      const words = isRow ? rowTextOf(el) : sentenceOf(el, taken);
      rowRead = isRow && !!words;
      if (words) {
        const rect = el.getBoundingClientRect();
        (held ?? texts).push({ text: cleanText(words, isRow ? 200 : 160), visible: rect.bottom > 0 && rect.top < viewportHeight, order: order++ });
      }
    }

    // What is inside an editor is what the visitor wrote, links and all. The editor is one control, and that is the end of it.
    // What is inside a part hidden from screen readers is not looked into either.
    if (holdsTyping(el) || pressableOnly) return;

    const before = candidates.length;
    const inside = insideControl || role !== "";
    // Only a box that is not a control in its own right can turn out to be a wrapper.
    const mayBeWrapper = !!added && (role === "clickable" || (!isNative(el) && !isFocusable(el)));
    // The words inside a row that was read as one line have been sent already, so what its cells give is set aside.
    const mine: TextBlock[] | undefined = mayBeWrapper || rowRead ? [] : role ? undefined : held;
    for (const child of el.children) visit(child, childScope, pointerHere, inside, svg, outside, mine, hoverBox);
    if (el.shadowRoot) for (const child of el.shadowRoot.children) visit(child, childScope, pointerHere, inside, svg, outside, mine, hoverBox);

    // A wrapper around real buttons or links is just a container, whether it
    // looked clickable or was given a role, like a menu entry around its link.
    // One that can be reached with the keyboard is a control in its own right:
    // a row that opens what it shows, with a button or two inside it.
    const within = added ? candidates.slice(before).filter((c) => c !== added) : [];
    let wrapper = false;
    if (added && !isNative(el) && !isFocusable(el) && within.some((c) => c.role !== "clickable" && isNative(c.el))) {
      wrapper = true;
    } else if (added?.role === "clickable" && within.some((c) => c.role === "clickable" && saysMostOf(c.label, added!.label))) {
      // A clickable box around a clickable box that says the same thing: the inner one is the control.
      // A panel named "Simple graph" around its legend, "A-series B-series", says something else and stays.
      wrapper = true;
    }
    if (added && wrapper) {
      candidates.splice(candidates.indexOf(added), 1);
      // Its words were held back as a control's own. It is no control, so they are the page's.
      if (mine?.length) (held ?? texts).push(...mine);
    }
    // A section that is only words, like a title and a line under it, introduces what comes after it.
    if (section && !added && candidates.length === before) scope.heading = childScope.heading;
  };

  if (root) visit(root, { region: "page", heading: "" }, false, false);

  // With a dialog open, the rest of the page counts only where it is drawn over the dialog. With a list
  // open over a layer that covers the window, only what is in the list's layer, or on top of it, can be
  // used, and the field the list belongs to, which has the keyboard and is typed in to narrow the list.
  const cover = modal ? undefined : coverOf(ignore, candidates);
  const inCover = (el: Element) => !!cover?.layer?.contains(el) || el === document.activeElement;
  let usable = mergeCells(
    modal ? candidates.filter((c) => !c.outside || onTop(c.el, ignore))
    : cover ? candidates.filter((c) => inCover(c.el) || onTop(c.el, ignore))
    : candidates,
  );
  nameRows(usable);
  tellTwinsApart(usable);
  for (const c of usable) {
    const context = contextOf(c);
    if (context) c.context = context;
  }

  // Over the cap, keep what's on screen first, then the page's furniture, then
  // the rest in page order. A region that is one long run of links, like a box
  // of related pages, does not get to crowd out everything after it.
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
  const listed = chosen.map(({ el, nav: _nav, region: _region, heading: _heading, row: _row, place: _place, outside: _outside, ...element }, index) => {
    element.id = `e${index + 1}`;
    elements.set(element.id, el);
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
  return { snapshot, elements };
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
function onTop(el: Element, ignore: Element): boolean {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
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
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return false;
  return Array.from(el.labels ?? []).some((label) => {
    const box = label.getBoundingClientRect();
    return box.width >= 2 && box.height >= 2;
  });
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
    if ((position !== "fixed" && position !== "absolute") || candidates.some((c) => top.contains(c.el))) continue;
    const parent = top.parentElement;
    return { el: top, layer: parent && parent !== document.body && parent !== document.documentElement ? parent : undefined };
  }
  return undefined;
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
      const row = rowOf(c.el);
      if (!row || isHeaderRow(row)) continue;
      // A row that is itself listed, or holds a listed box around this control, has already said what it is.
      // The outermost such box is the one that speaks for the row, in the words a person sees on it.
      let around: Candidate | undefined;
      for (let box: Element | null = c.el.parentElement; box; box = box === row ? null : box.parentElement) around = named.get(box) ?? around;
      const name = around ? cleanText(wordsIn(around.el, 80) || around.label, 40) : rowName(row, c.el, piecesOf);
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
    if (sameKind(row, row.previousElementSibling) || sameKind(row, row.nextElementSibling)) return row;
  }
  return null;
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
  if (row.tagName !== "LI" || !(list instanceof HTMLOListElement)) return "";
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
 * search stops there. `holds` says how many of them each box holds, and `not`
 * is a name already found to be shared, to look past.
 */
function wordsBeside(control: Element, holds: Map<Element, number>, not = ""): string {
  for (let box = control.parentElement, depth = 0; box && box !== document.body && depth < BESIDE_DEPTH; box = box.parentElement, depth++) {
    if ((holds.get(box) ?? 0) > 1) return "";
    // Marks left standing alone once the control is taken out, like the brackets around a link, are not words.
    const words = wordsIn(box, 60, CONTROLS, control).split(" ").filter((piece) => /[\p{L}\p{N}]/u.test(piece)).join(" ");
    // A box that says this much is a paragraph or a whole part of the page, not a name beside a control.
    if (words.length > BESIDE_CHARS) return "";
    if (words && words !== not) return cleanText(words, BESIDE_CHARS);
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
    const holds = new Map<Element, number>();
    for (const c of group) {
      for (let box = c.el.parentElement, depth = 0; box && depth < BESIDE_DEPTH; box = box.parentElement, depth++) holds.set(box, (holds.get(box) ?? 0) + 1);
    }
    const names = group.map((c) => wordsBeside(c.el, holds));
    group.forEach((c, index) => {
      let name = names[index] ?? "";
      // Two of them beside the same words, like "All": the next box out may say more.
      if (name && names.indexOf(name) !== names.lastIndexOf(name)) name = wordsBeside(c.el, holds, name) || name;
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
    if (!(node instanceof Element) || node.getAttribute("aria-hidden") === "true") return;
    if (["BUTTON", "SELECT", "SCRIPT", "STYLE", "svg"].includes(node.tagName) || holdsTyping(node) || unseen(node)) return;
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

function captionOf(el: Element, after: boolean): string {
  // A box that is a control, or holds one, is not a caption: its words are that control's, or what a visitor typed into it.
  const wordsOf = (node: Element): string => {
    if (holdsTyping(node) || node.matches(CONTROLS) || node.querySelector(CONTROLS)) return "";
    const text = cleanText(wordsIn(node, 120, "", undefined, true), 61);
    return text.length > 60 ? "" : text.replace(/\s*[:*]+$/, "");
  };
  const step = (from: Node) => (after ? from.nextSibling : from.previousSibling);
  let node: Element | null = el;
  for (let depth = 0; depth < 4 && node && node !== document.body; depth++) {
    // Inside an editor the words beside a control are the visitor's own.
    if ((node.parentElement as HTMLElement | null)?.isContentEditable) return "";
    // The nearest words beside it, whether bare words in the same box or a box of their own:
    // in "from account # [ ] to account # [ ]" the second field is "to account #".
    for (let beside = step(node), tried = 0; beside && tried < 3; beside = step(beside)) {
      if (beside.nodeType === Node.TEXT_NODE) {
        const text = cleanText(beside.textContent ?? "", 61);
        if (text.length > 1 && text.length <= 60 && /[\p{L}\p{N}]/u.test(text)) return text.replace(/\s*[:*]+$/, "");
        if (text) tried++;
        continue;
      }
      if (!(beside instanceof Element)) continue;
      tried++;
      // A heading names the part of the page the field is in, and what comes before it belongs to other parts.
      if (beside.matches(HEADINGS)) return "";
      const text = wordsOf(beside);
      if (text) return text;
      // Another field, or another field's box: the caption beyond it belongs to that field.
      if (holdsTyping(beside) || beside.matches("select") || beside.querySelector("input, select, textarea")) return "";
    }
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

function labelOf(el: Element, role: string): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  /** Named by a part of itself, which is then a name the visitor can see. */
  let namedByOwnWords = false;
  const byIds = (ids: string) =>
    ids
      .split(/\s+/)
      .map((id) => {
        const named = id ? root.getElementById?.(id) : null;
        if (named && el.contains(named)) namedByOwnWords = true;
        return named ? wordsIn(named, 200, "", undefined, true) : "";
      })
      .join(" ")
      .trim();
  // An editor's own words are the visitor's. It is named by what its page calls it, or by nothing.
  const typedIn = holdsTyping(el);
  /** The name the page gives for screen readers. */
  const given = byIds(el.getAttribute("aria-labelledby") ?? "") || el.getAttribute("aria-label")?.trim() || "";
  let raw = el.getAttribute("data-haptic-label") || (given && !typedIn && !namedByOwnWords && !SHOWS_A_VALUE.has(role) ? withShownWords(given, el) : given);
  const ticks = role === "checkbox" || role === "radio" || role === "switch";
  if (!raw && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
    // A label can carry its words as an aria-label of its own.
    raw = Array.from(el.labels ?? []).map((label) => labelWords(label) || label.getAttribute("aria-label") || "").join(" ").trim();
    // A button's value is its caption, not user data.
    if (!raw && el instanceof HTMLInputElement && role === "button") raw = el.value || el.type;
    if (!raw && ticks) raw = captionOf(el, true) || captionOf(el, false);
    raw ||= el.getAttribute("placeholder") || el.getAttribute("title") || "";
    if (!raw && !ticks) raw = captionOf(el, false);
    // The name attribute is for the server, but when it reads as words it is better than nothing.
    raw ||= wordsOfName(el.getAttribute("name") ?? "");
  }
  // Never use a field's contents as its label.
  if (!raw && role !== "textbox" && role !== "select" && !typedIn) raw = visibleText(el);
  // What the page shows in an empty field is the page's own words for it.
  if (!raw && typedIn) raw = el.getAttribute("placeholder") || el.getAttribute("aria-placeholder") || el.getAttribute("data-placeholder") || "";
  raw ||= el.getAttribute("title") || "";
  if (!raw && !typedIn) raw = (el instanceof HTMLImageElement ? el.alt : el.querySelector("img[alt]")?.getAttribute("alt")) || el.querySelector("svg title")?.textContent || "";
  // A custom field or tick box, built from boxes with no words of its own.
  if (!raw.trim() && (role === "textbox" || role === "combobox" || role === "searchbox" || role === "spinbutton" || role === "slider" || ticks)) raw = captionOf(el, ticks) || captionOf(el, !ticks);
  // Some pages hand over text that has been escaped twice.
  raw = raw.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return cleanText(raw, 80);
}

/** The words a control shows, or failing those the words it has for screen readers only, like an icon button's name. */
function visibleText(el: Element): string {
  return wordsIn(el, 160) || wordsIn(el, 160, "", undefined, true);
}

/** Icon-only buttons are common in dashboards. The icon's class name is often the only clue. */
function iconOf(el: Element): string | undefined {
  // Nothing inside an editor is the page's own, its pictures included.
  if ((el as HTMLElement).isContentEditable) return undefined;
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
    else if (node instanceof Element && !holdsTyping(node) && !NOT_WORDS.has(node.tagName)) for (const child of node.childNodes) walk(child);
  };
  walk(name);
  if (REQUIRED_MARK.test(text.replace(/\s+/g, " ").trim())) return true;
  return ["::before", "::after"].some((pseudo) => /^["']\s*\*\s*["']$/.test(getComputedStyle(name, pseudo).content));
}

/** The elements whose words name an element: its labels and what aria-labelledby points to. */
function namesOf(el: Element): Element[] {
  const names: Element[] = [];
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) names.push(...Array.from(el.labels ?? []));
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

/** A state is at most 16 characters: the server cuts anything longer. */
function stateOf(el: Element, role: string): string[] {
  const state: string[] = [];
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") state.push("disabled");
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
  const named = labelledBy ? document.getElementById(labelledBy) : null;
  const heading = el.querySelector("h1, h2, h3, [role='heading']");
  const raw = el.getAttribute("aria-label") || (named && wordsIn(named, 200, "", undefined, true)) || (heading && wordsIn(heading)) || "";
  return cleanText(raw, 60);
}
