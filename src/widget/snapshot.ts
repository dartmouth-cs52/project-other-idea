import { cleanText, describeElement, normalizePath, type SnapElement, type Snapshot } from "../shared/types.ts";

// Turns the live page into the list of elements the model sees. One read-only
// pass over the DOM. Input values are never read: labels only.

const MAX_ELEMENTS = 300;
const MAX_TEXT_CHARS = 2500;
const MAX_VISITED = 15000;

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "svg", "CANVAS", "VIDEO", "AUDIO", "IFRAME", "OBJECT"]);
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
const TEXT_TAGS = new Set(["P", "LI", "DD", "DT", "SPAN", "DIV", "SMALL", "STRONG", "LABEL", "TD", "FIGCAPTION"]);
const MAYBE_CLICKABLE = new Set(["DIV", "SPAN", "LI", "IMG", "TD", "TR", "P"]);
/**
 * Roles that say what an element is, a row or an item, and not whether it can
 * be clicked. Table and list libraries often make a whole row clickable with
 * nothing in it that is a control, so a row like this is looked at on its own.
 */
const ROW_ROLES = new Set(["row", "gridcell", "cell", "listitem", "article"]);
const ICON_CLASS = /(?:^|\s)(?:lucide|tabler-icon|bi|ri|fa|icon)-(?!solid|regular|brands|fw|lg|sm|xs|spin|btn|button)([a-z][a-z0-9-]+)/;

export interface PageSnapshot {
  snapshot: Snapshot;
  /** Live element for each id in the snapshot. */
  elements: Map<string, Element>;
}

interface Candidate extends SnapElement {
  el: Element;
  nav: boolean;
  /** A whole row added because nothing inside it is listed. It comes after everything else when the list is cut. */
  row?: true;
}

interface Scope {
  region: string;
  heading: string;
}

/**
 * Whether an element is somewhere the visitor writes: a rich-text box, as the
 * browser itself decides (so contenteditable="False" or "inherit" outside an
 * editor is not one), or anything the page calls a text field.
 */
function isWritingArea(el: Element): boolean {
  return (el as HTMLElement).isContentEditable || el.getAttribute("role") === "textbox";
}

/** Whether a node is in a writing area or is one, looking up through shadow roots to the elements that hold them. */
function inWritingArea(node: Node): boolean {
  for (let at: Node | null = node; at; ) {
    if (at instanceof Element && isWritingArea(at)) return true;
    const parent: Node | null = at.parentNode;
    at = parent instanceof ShadowRoot ? parent.host : parent;
  }
  return false;
}

/** A heading's words, leaving out any part of it the visitor writes in: "Notes for <span contenteditable>Jane</span>" reads "Notes for". */
function headingText(el: Element): string {
  let text = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
    else if (node instanceof Element && !isWritingArea(node)) for (const child of node.childNodes) walk(child);
  };
  for (const child of el.childNodes) walk(child);
  return text;
}

export function takeSnapshot(ignore: Element): PageSnapshot {
  const candidates: Candidate[] = [];
  const headings: string[] = [];
  const texts: { text: string; visible: boolean }[] = [];
  const viewportHeight = window.innerHeight;
  let visited = 0;

  // With a modal open only the modal is usable, so only the modal is listed.
  const modal = findOpenModal(ignore);
  const root = modal ?? document.body;

  /**
   * `insideWriting` is true below an area the visitor writes in. What is in
   * there is their own writing, so nothing of it is read: the area itself is
   * listed as a field, and its children, its shadow root and any island in it
   * the editor marks as not editable are all left out. It is passed down
   * rather than looked up, so it costs nothing per element.
   */
  const visit = (el: Element, scope: Scope, parentPointer: boolean, insideControl: boolean, insideWriting: boolean) => {
    if (insideWriting || visited++ > MAX_VISITED || el === ignore || SKIP_TAGS.has(el.tagName)) return;
    if (el.hasAttribute("inert") || el.hasAttribute("data-haptic-ignore") || el.getAttribute("aria-hidden") === "true") return;
    const writing = isWritingArea(el);
    if (!isRendered(el)) {
      // display:contents has no box of its own, but its children do.
      if (getComputedStyle(el).display === "contents") for (const child of el.children) visit(child, scope, parentPointer, insideControl, writing);
      return;
    }

    const explicitRole = (el.getAttribute("role") ?? "").split(/\s+/)[0] ?? "";
    const landmark = LANDMARKS[explicitRole] ?? LANDMARKS[el.tagName];
    const childScope = landmark && el !== root ? { region: landmark, heading: "" } : scope;

    if (!writing && (/^H[1-3]$/.test(el.tagName) || explicitRole === "heading")) {
      const text = cleanText(headingText(el), 80);
      if (text) {
        scope.heading = text;
        if (headings.length < 12) headings.push(text);
      }
    }

    // cursor:pointer is inherited, so only the element where it starts counts.
    const pointerHere = !explicitRole && MAYBE_CLICKABLE.has(el.tagName) ? getComputedStyle(el).cursor === "pointer" : parentPointer;
    const role = roleOf(el, explicitRole, pointerHere && !parentPointer && !insideControl);

    let added: Candidate | undefined;
    if (role) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        added = { el, id: "", role, label: labelOf(el, role), nav: ["nav", "header", "aside", "menu", "tabs"].includes(scope.region) };
        const icon = iconOf(el);
        if (icon) added.icon = icon;
        const state = stateOf(el);
        if (state.length) added.state = state;
        const href = hrefOf(el);
        if (href) added.href = href;
        const context = [scope.region === "page" ? "" : scope.region, scope.heading].filter(Boolean).join(" › ");
        if (context) added.context = context;
        if (rect.bottom <= 0) added.offscreen = "above";
        else if (rect.top >= viewportHeight) added.offscreen = "below";
        candidates.push(added);
      }
    } else if (!insideControl && TEXT_TAGS.has(el.tagName) && texts.length < 300) {
      const own = ownText(el);
      if (own.length >= 3) {
        const rect = el.getBoundingClientRect();
        texts.push({ text: cleanText(own, 160), visible: rect.bottom > 0 && rect.top < viewportHeight });
      }
    }

    const before = candidates.length;
    const inside = insideControl || role !== "";
    for (const child of el.children) visit(child, childScope, pointerHere, inside, writing);
    if (el.shadowRoot) for (const child of el.shadowRoot.children) visit(child, childScope, pointerHere, inside, writing);

    // A clickable wrapper around real buttons or links is just a container.
    if (added?.role === "clickable" && candidates.slice(before).some((c) => c.role !== "clickable")) {
      candidates.splice(candidates.indexOf(added), 1);
    }

    // A row the visitor clicks as a whole, where nothing inside it was listed: a table row
    // with only text in its cells, the way SAP and other grid libraries draw them. The
    // pointer cursor says it can be clicked. Only rows that would otherwise be missing
    // are added, so nothing listed above changes.
    if (!role && !insideControl && candidates.length === before && (ROW_ROLES.has(explicitRole) || (!explicitRole && el.tagName.includes("-")))) {
      const row = clickableRow(el, viewportHeight);
      if (row) {
        const context = [scope.region === "page" ? "" : scope.region, scope.heading].filter(Boolean).join(" › ");
        candidates.push({ el, id: "", role: "clickable", label: row.label, nav: false, row: true, ...(context ? { context } : {}), ...(row.offscreen ? { offscreen: row.offscreen } : {}) });
      }
    }
  };

  if (root) visit(root, { region: modal ? "dialog" : "page", heading: "" }, false, false, false);

  // Over the cap, keep what's on screen first, then navigation, then the rest, in page order.
  let chosen = candidates;
  if (candidates.length > MAX_ELEMENTS) {
    // A row added above comes after everything else, so it can never push out a control.
    const rank = (c: Candidate) => (c.row ? 3 : !c.offscreen ? 0 : c.nav ? 1 : 2);
    const keep = new Set([...candidates].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_ELEMENTS));
    chosen = candidates.filter((c) => keep.has(c));
  }

  const elements = new Map<string, Element>();
  const listed = chosen.map(({ el, nav: _nav, row: _row, ...element }, index) => {
    element.id = `e${index + 1}`;
    elements.set(element.id, el);
    return element;
  });

  const snapshot: Snapshot = {
    path: normalizePath(location.pathname),
    title: cleanText(document.title, 80),
    headings,
    text: chooseText(texts),
    elements: listed,
    truncated: candidates.length > chosen.length,
  };
  if (modal) snapshot.dialog = dialogLabel(modal);
  return { snapshot, elements };
}

/** Identifies the same control across two snapshots, where ids differ. */
export function elementKey(element: Pick<SnapElement, "role" | "label" | "icon" | "href">): string {
  return `${element.role}|${element.label}|${element.icon ?? ""}|${element.href ?? ""}`;
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

/**
 * A row as one clickable thing, when the pointer cursor starts on it (and not on
 * what holds it), it has words of its own, and it is not a header row or something
 * the size of half the screen. Its label is those words.
 */
function clickableRow(el: Element, viewportHeight: number): { label: string; offscreen?: "above" | "below" } | undefined {
  if (getComputedStyle(el).cursor !== "pointer") return undefined;
  const holder = el.parentElement ?? (el.getRootNode() as ShadowRoot).host;
  if (holder && getComputedStyle(holder).cursor === "pointer") return undefined;
  if (el.querySelector('th, [role="columnheader"], [role="rowheader"]')) return undefined;
  const rect = el.getBoundingClientRect();
  if ((rect.width === 0 && rect.height === 0) || rect.height > viewportHeight / 2) return undefined;
  const label = cleanText(visibleText(el), 80);
  if (!label) return undefined;
  return { label, ...(rect.bottom <= 0 ? { offscreen: "above" as const } : rect.top >= viewportHeight ? { offscreen: "below" as const } : {}) };
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
  if (el.hasAttribute("onclick") || pointerStartsHere) return "clickable";
  return "";
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
    else if (node instanceof Element && !isWritingArea(node) && !node.matches('select, textarea, input, button, datalist, output, [aria-hidden="true"]')) text += labelWords(node);
  }
  return text;
}

function labelOf(el: Element, role: string): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  // An element the label points to by id is skipped when it is somewhere the visitor writes, like an editable subject line.
  const byIds = (ids: string) =>
    ids
      .split(/\s+/)
      .map((id) => root.getElementById?.(id))
      .map((named) => (named && !inWritingArea(named) ? named.textContent ?? "" : ""))
      .join(" ")
      .trim();
  let raw = el.getAttribute("data-haptic-label") || byIds(el.getAttribute("aria-labelledby") ?? "") || el.getAttribute("aria-label")?.trim() || "";
  if (!raw && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
    raw = Array.from(el.labels ?? []).map(labelWords).join(" ").trim();
    // A button's value is its caption, not user data.
    if (!raw && el instanceof HTMLInputElement && role === "button") raw = el.value || el.type;
    raw ||= el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "";
  }
  // Never use a field's contents as its label.
  if (!raw && role !== "textbox" && role !== "select") raw = visibleText(el);
  raw ||= el.getAttribute("title") || "";
  // A picture inside a field is something the visitor put there, so it does not name the field.
  if (!raw && role !== "textbox") raw = (el instanceof HTMLImageElement ? el.alt : el.querySelector("img[alt]")?.getAttribute("alt")) || el.querySelector("svg title")?.textContent || "";
  return cleanText(raw, 80);
}

function visibleText(el: Element): string {
  let text = "";
  const walk = (node: Node) => {
    if (text.length > 160) return;
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
    if (!(node instanceof Element)) return;
    if (node.getAttribute("aria-hidden") === "true" || isWritingArea(node) || ["SCRIPT", "STYLE", "svg", "INPUT", "TEXTAREA", "SELECT"].includes(node.tagName)) return;
    for (const child of node.childNodes) walk(child);
    text += " ";
  };
  for (const child of el.childNodes) walk(child);
  return text;
}

/** Icon-only buttons are common in dashboards. The icon's class name is often the only clue. */
function iconOf(el: Element): string | undefined {
  const inside = Array.from(el.querySelectorAll("svg, i, [class*='icon']")).filter((candidate) => !inWritingArea(candidate));
  for (const candidate of [el, ...inside.slice(0, 4)]) {
    const dataIcon = candidate.getAttribute("data-icon");
    if (dataIcon) return dataIcon;
    const match = ICON_CLASS.exec(candidate.getAttribute("class") ?? "");
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function stateOf(el: Element): string[] {
  const state: string[] = [];
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") state.push("disabled");
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
  const raw = el.getAttribute("href");
  if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return undefined;
  try {
    const url = new URL(el.href, location.href);
    return url.origin === location.origin ? normalizePath(url.pathname) : `external:${url.hostname}`;
  } catch {
    return undefined;
  }
}

function findOpenModal(ignore: Element): Element | undefined {
  const modals: Element[] = [];
  try {
    document.querySelectorAll("dialog:modal").forEach((el) => modals.push(el));
  } catch {
    // :modal unsupported. ARIA modals below still work.
  }
  document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]').forEach((el) => {
    if (!ignore.contains(el) && isRendered(el)) modals.push(el);
  });
  return modals[modals.length - 1];
}

function dialogLabel(el: Element): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  const named = labelledBy ? document.getElementById(labelledBy) : null;
  // A heading or a label the visitor writes in, like a draft's subject, does not name the dialog.
  const heading = Array.from(el.querySelectorAll("h1, h2, h3, [role='heading']")).find((found) => !inWritingArea(found));
  const raw = el.getAttribute("aria-label") || (named && !inWritingArea(named) && named.textContent) || (heading && headingText(heading)) || "";
  return cleanText(raw, 60);
}
