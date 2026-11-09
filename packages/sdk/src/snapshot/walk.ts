import { cleanText, normalizePath, type ViewportPosition } from "@haptic/protocol";
import { describeLabel } from "./labels.ts";
import { isCovered } from "./occlusion.ts";

// One pass over the rendered page. Collects interactive elements with labels,
// landmark context and viewport position, plus headings and alerts. Only reads
// layout, never writes, so the browser computes layout once.

export interface Candidate {
  el: Element;
  role: string;
  label: string;
  icon?: string;
  hints: string[];
  href?: string;
  context?: string;
  state: string[];
  position: ViewportPosition;
  region: string;
  /** Document order, used to sort the final list. */
  order: number;
  /** Came from the cursor:pointer heuristic rather than markup. */
  inferred: boolean;
}

export interface TextBlock {
  text: string;
  visible: boolean;
  order: number;
}

export interface WalkResult {
  candidates: Candidate[];
  texts: TextBlock[];
  headings: string[];
  alerts: string[];
  dialog?: { el: Element; label: string };
  /** On-screen controls left out because something else is on top of them. */
  covered: number;
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "BR", "HR", "svg", "CANVAS", "VIDEO", "AUDIO", "OBJECT"]);
const ROLE_FOR_INPUT: Record<string, string> = {
  button: "button",
  submit: "button",
  reset: "button",
  image: "button",
  checkbox: "checkbox",
  radio: "radio",
  range: "slider",
  search: "searchbox",
  file: "file-upload",
  color: "color-picker",
  date: "date-picker",
  hidden: "",
};
const INTERACTIVE_ROLES = new Set([
  "button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "checkbox", "radio",
  "switch", "combobox", "treeitem", "textbox", "searchbox", "slider", "spinbutton", "gridcell", "row",
]);
const LANDMARK_BY_TAG: Record<string, string> = {
  HEADER: "header", NAV: "nav", MAIN: "main", ASIDE: "aside", FOOTER: "footer", FORM: "form", DIALOG: "dialog",
};
const LANDMARK_BY_ROLE: Record<string, string> = {
  banner: "header", navigation: "nav", main: "main", complementary: "aside", contentinfo: "footer",
  dialog: "dialog", alertdialog: "dialog", form: "form", search: "search", menu: "menu", menubar: "menu",
  listbox: "list", tablist: "tabs", toolbar: "toolbar", region: "section",
};
const MAX_CANDIDATES = 2000;
const MAX_TEXT_BLOCKS = 300;
const TEXT_TAGS = new Set(["P", "LI", "DD", "DT", "SPAN", "DIV", "SMALL", "STRONG", "B", "EM", "LABEL", "FIGCAPTION", "BLOCKQUOTE"]);
const MAX_VISITED = 15000;

interface Scope {
  region: string;
  regionLabel: string;
  heading: string;
}

export function walkPage(doc: Document, ignore: Element): WalkResult {
  const result: WalkResult = { candidates: [], texts: [], headings: [], alerts: [], covered: 0 };
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let order = 0;
  let visited = 0;
  const consumed = new WeakSet<Element>();

  // With a modal open, only the modal is usable, so only walk the modal.
  const modal = findOpenModal(doc, ignore);
  if (modal) result.dialog = modal;
  const start = modal?.el ?? doc.body;
  if (!start) return result;

  const rootScope: Scope = modal
    ? { region: "dialog", regionLabel: modal.label, heading: "" }
    : { region: "page", regionLabel: "", heading: "" };

  const visit = (el: Element, scope: Scope, offset: { x: number; y: number }, parentPointer: boolean, insideClickable: boolean) => {
    if (visited++ > MAX_VISITED || result.candidates.length >= MAX_CANDIDATES) return;
    if (el === ignore) return;
    if (SKIP_TAGS.has(el.tagName)) return;
    if (el.hasAttribute("data-haptic-ignore") || el.hasAttribute("inert")) return;
    if (el.getAttribute("aria-hidden") === "true") return;

    if (!isRendered(el)) {
      // display:contents boxes have no layout of their own but their children do.
      if (getComputedStyle(el).display === "contents") {
        for (const child of el.children) visit(child, scope, offset, parentPointer, insideClickable);
      }
      return;
    }

    // Landmarks start a new scope for context and headings.
    const landmark = landmarkOf(el);
    let childScope = scope;
    if (landmark && el !== start) {
      childScope = { region: landmark, regionLabel: landmarkLabel(el), heading: "" };
    }

    const tag = el.tagName;
    const explicitRole = (el.getAttribute("role") ?? "").split(/\s+/)[0] ?? "";
    if (/^H[1-3]$/.test(tag) || (explicitRole === "heading" && Number(el.getAttribute("aria-level") ?? "2") <= 3)) {
      const text = cleanText(el.textContent ?? "", 80);
      if (text) {
        scope.heading = text;
        if (result.headings.length < 12) result.headings.push(text);
      }
    }
    if ((explicitRole === "alert" || explicitRole === "status") && result.alerts.length < 5) {
      const text = cleanText(el.textContent ?? "", 120);
      if (text) result.alerts.push(text);
    }

    const style = needsStyle(el, explicitRole) ? getComputedStyle(el) : undefined;
    const pointerHere = style ? style.cursor === "pointer" : parentPointer;
    const role = roleOf(el, explicitRole, insideClickable, pointerHere, parentPointer);

    let addedIndex = -1;
    if (role) {
      const rect = el.getBoundingClientRect();
      const left = rect.left + offset.x;
      const top = rect.top + offset.y;
      const position = positionOf(left, top, rect.width, rect.height, viewportWidth, viewportHeight);
      // The user can't click what's buried under other content, so the
      // model shouldn't point at it.
      const covered = (rect.width > 0 || rect.height > 0) && position === "visible" && isCovered(el, rect, ignore);
      if (covered) result.covered++;
      if ((rect.width > 0 || rect.height > 0) && !covered) {
        const info = describeLabel(el, role);
        const candidate: Candidate = {
          el,
          role,
          label: info.label,
          ...(info.icon ? { icon: info.icon } : {}),
          hints: info.hints,
          state: stateOf(el),
          position,
          region: scope.region,
          order: order++,
          inferred: role === "clickable",
        };
        const href = hrefOf(el);
        if (href) candidate.href = href;
        const context = contextOf(scope);
        if (context) candidate.context = context;
        addedIndex = result.candidates.length;
        result.candidates.push(candidate);
      }
    }

    // Plain text blocks give the model the page's words, e.g. prices or
    // descriptions. Only leaf blocks, never table cells or form contents.
    if (!role && !insideClickable && TEXT_TAGS.has(tag) && result.texts.length < MAX_TEXT_BLOCKS && !consumed.has(el)) {
      const own = ownText(el, consumed);
      if (own.length >= 3) {
        const rect = el.getBoundingClientRect();
        result.texts.push({
          text: cleanText(own, 160),
          visible: positionOf(rect.left + offset.x, rect.top + offset.y, rect.width, rect.height, viewportWidth, viewportHeight) === "visible",
          order: order++,
        });
      }
    }

    const clickableHere = insideClickable || role !== "";
    for (const child of el.children) visit(child, childScope, offset, pointerHere, clickableHere);

    if (el.shadowRoot) {
      for (const child of el.shadowRoot.children) visit(child, childScope, offset, pointerHere, clickableHere);
    }

    if (tag === "IFRAME") {
      try {
        const frameDoc = (el as HTMLIFrameElement).contentDocument;
        if (frameDoc?.body) {
          const frameRect = el.getBoundingClientRect();
          visit(frameDoc.body, childScope, { x: offset.x + frameRect.left, y: offset.y + frameRect.top }, false, false);
        }
      } catch {
        // Cross-origin frames are off limits.
      }
    }

    // A clickable wrapper that contains real buttons or links is just a
    // container. Keep the real controls and drop the wrapper.
    if (addedIndex !== -1 && result.candidates[addedIndex]?.inferred) {
      const hasRealControlInside = result.candidates.slice(addedIndex + 1).some((c) => !c.inferred);
      if (hasRealControlInside) result.candidates.splice(addedIndex, 1);
    }
  };

  visit(start, rootScope, { x: 0, y: 0 }, false, false);
  return result;
}

/** Text directly inside an element, ignoring text in child elements. */
function ownText(el: Element, consumed: WeakSet<Element>): string {
  let text = "";
  for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
  // Inline formatting children (<b>, <span>) usually belong to the sentence.
  // Take their text here and skip them when the walk reaches them.
  if (el.children.length > 0 && el.children.length <= 4 && Array.from(el.children).every((child) => INLINE_TAGS.has(child.tagName))) {
    text = el.textContent ?? "";
    for (const child of el.children) consumed.add(child);
  }
  return text.replace(/\s+/g, " ").trim();
}

const INLINE_TAGS = new Set(["B", "STRONG", "EM", "I", "SPAN", "CODE", "SMALL", "SUP", "SUB", "MARK", "BR"]);

function isRendered(el: Element): boolean {
  if (typeof el.checkVisibility === "function") {
    // Opacity isn't checked on purpose: row actions that fade in on hover are
    // still real controls the user can reach.
    return el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true } as CheckVisibilityOptions);
  }
  return (el as HTMLElement).offsetParent !== null || el.getClientRects().length > 0;
}

/** Only elements that might be clickable without markup need a style lookup. */
function needsStyle(el: Element, explicitRole: string): boolean {
  if (explicitRole) return false;
  const tag = el.tagName;
  return tag === "DIV" || tag === "SPAN" || tag === "LI" || tag === "IMG" || tag === "TD" || tag === "TR" || tag === "LABEL" || tag === "P" || tag === "SECTION" || tag === "ARTICLE";
}

function roleOf(el: Element, explicitRole: string, insideClickable: boolean, pointerHere: boolean, parentPointer: boolean): string {
  if (explicitRole && INTERACTIVE_ROLES.has(explicitRole)) {
    // Table rows and cells are only interesting when they're clickable.
    if ((explicitRole === "row" || explicitRole === "gridcell") && !pointerHere) return "";
    return explicitRole === "gridcell" || explicitRole === "row" ? "clickable" : explicitRole;
  }
  const tag = el.tagName;
  if (tag === "A" && el.hasAttribute("href")) return "link";
  if (tag === "BUTTON") return "button";
  if (tag === "SELECT") return "select";
  if (tag === "TEXTAREA") return "textbox";
  if (tag === "SUMMARY") return "button";
  if (tag === "INPUT") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    if (type in ROLE_FOR_INPUT) return ROLE_FOR_INPUT[type] ?? "";
    return "textbox";
  }
  if ((el as HTMLElement).isContentEditable && !(el.parentElement as HTMLElement | null)?.isContentEditable) return "textbox";
  if (el.hasAttribute("tabindex") && Number(el.getAttribute("tabindex")) >= 0 && tag !== "DIV" && tag !== "SECTION") return "focusable";
  // cursor:pointer is inherited, so only the element where it starts counts.
  if (pointerHere && !parentPointer && !insideClickable && !explicitRole) return "clickable";
  return "";
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
  if ((el as HTMLInputElement).checked || el.getAttribute("aria-checked") === "true") state.push("checked");
  return state;
}

function positionOf(left: number, top: number, width: number, height: number, vw: number, vh: number): ViewportPosition {
  if (top + height <= 0) return "above";
  if (top >= vh) return "below";
  if (left + width <= 0) return "left";
  if (left >= vw) return "right";
  return "visible";
}

function hrefOf(el: Element): string | undefined {
  if (el.tagName !== "A") return undefined;
  const raw = el.getAttribute("href");
  if (!raw || raw.startsWith("javascript:")) return undefined;
  if (raw.startsWith("#")) return undefined;
  try {
    const url = new URL((el as HTMLAnchorElement).href, location.href);
    if (url.origin !== location.origin) return `external:${url.hostname}`;
    return normalizePath(url.pathname);
  } catch {
    return undefined;
  }
}

function landmarkOf(el: Element): string | undefined {
  const role = el.getAttribute("role");
  if (role && LANDMARK_BY_ROLE[role]) {
    if (role === "region" && !el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby")) return undefined;
    return LANDMARK_BY_ROLE[role];
  }
  return LANDMARK_BY_TAG[el.tagName];
}

function landmarkLabel(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label) return cleanText(label, 40);
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const text = root.getElementById?.(labelledBy.split(/\s+/)[0] ?? "")?.textContent;
    if (text) return cleanText(text, 40);
  }
  return "";
}

function contextOf(scope: Scope): string {
  const parts: string[] = [];
  if (scope.region !== "page") parts.push(scope.regionLabel ? `${scope.region} "${scope.regionLabel}"` : scope.region);
  if (scope.heading) parts.push(scope.heading);
  return parts.join(" › ");
}

function findOpenModal(doc: Document, ignore: Element): { el: Element; label: string } | undefined {
  const modals: Element[] = [];
  try {
    doc.querySelectorAll("dialog:modal").forEach((el) => modals.push(el));
  } catch {
    // :modal unsupported. Fall through to ARIA modals.
  }
  doc.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]').forEach((el) => {
    if (!ignore.contains(el) && isRendered(el)) modals.push(el);
  });
  const top = modals[modals.length - 1];
  if (!top) return undefined;
  return { el: top, label: dialogLabel(top) };
}

function dialogLabel(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return cleanText(aria, 60);
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = el.ownerDocument.getElementById(labelledBy)?.textContent;
    if (text?.trim()) return cleanText(text, 60);
  }
  const heading = el.querySelector("h1, h2, h3, [role='heading']");
  return heading ? cleanText(heading.textContent ?? "", 60) : "";
}
