import { cleanText } from "@haptic/protocol";

// Working out what to call an element. Order follows roughly how assistive
// tech names things, plus hints for icon-only buttons, which are common in
// dashboards (Flasht has 163 buttons and 10 aria-labels).

const ICON_CLASS_PATTERNS: RegExp[] = [
  /(?:^|\s)lucide-([a-z0-9-]+)/,
  /(?:^|\s)tabler-icon-([a-z0-9-]+)/,
  /(?:^|\s)bi-([a-z0-9-]+)/,
  /(?:^|\s)ri-([a-z0-9-]+?)(?:-line|-fill)?(?:\s|$)/,
  /(?:^|\s)fa-(?!solid|regular|light|thin|duotone|brands|sharp|fw|lg|xs|sm|xl|[0-9]x|spin|pulse)([a-z0-9-]+)/,
];
/** Loose "icon-name" convention. Only trusted on the icon element itself. */
const GENERIC_ICON_CLASS = /(?:^|\s)icon-(?!btn|button|wrap|wrapper|container|only|left|right|sm|md|lg)([a-z0-9-]+)/;
const MATERIAL_ICON_CLASS = /material-(icons|symbols)/;
const GENERATED_ID = /^(?::r|radix-|headlessui-|react-|mui-|ember\d|ng-|__)|\d{3,}|^[a-z0-9]{12,}$/i;

export interface LabelInfo {
  label: string;
  icon?: string;
  hints: string[];
}

export function describeLabel(el: Element, role: string): LabelInfo {
  const hints: string[] = [];
  const icon = findIcon(el);
  let label = cleanText(rawLabel(el, role) ?? "", 80);

  // Material icon ligatures put the icon name in the text. Prefer it as the icon.
  if (icon && label === icon.replace(/-/g, "_")) label = "";

  if (/^[A-Z]{1,2}$/.test(label)) hints.push("short-text");

  const testId = el.getAttribute("data-testid") ?? el.getAttribute("data-test") ?? el.getAttribute("data-cy");
  if (testId) hints.push(`testid:${cleanText(testId, 40)}`);
  const hapticId = el.getAttribute("data-haptic-id");
  if (hapticId) hints.push(`haptic-id:${cleanText(hapticId, 40)}`);

  if (!label && !icon) {
    const name = el.getAttribute("name");
    const id = el.id;
    if (name) hints.push(`name:${cleanText(name, 40)}`);
    else if (id && !GENERATED_ID.test(id)) hints.push(`id:${cleanText(id, 40)}`);
  }

  if (el instanceof HTMLSelectElement) {
    const options = Array.from(el.options)
      .slice(0, 8)
      .map((option) => cleanText(option.text, 24))
      .filter(Boolean);
    if (options.length) hints.push(`options:${options.join("/")}`);
  }

  return { label, ...(icon ? { icon } : {}), hints };
}

function rawLabel(el: Element, role: string): string | undefined {
  const explicit = el.getAttribute("data-haptic-label");
  if (explicit) return explicit;

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const text = labelledBy
      .split(/\s+/)
      .map((id) => root.getElementById?.(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return text;
  }

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel?.trim()) return ariaLabel;

  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const fromLabels = Array.from(el.labels ?? [])
      .map((label) => label.textContent ?? "")
      .join(" ")
      .trim();
    if (fromLabels) return fromLabels;
    if (el instanceof HTMLInputElement && ["submit", "button", "reset"].includes(el.type)) {
      // A button's value is its visible caption, not user data.
      return el.value || el.type;
    }
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return placeholder;
    return el.getAttribute("title") ?? undefined;
  }

  // Never use a text field's contents as its label.
  if (role !== "textbox") {
    const text = visibleText(el);
    if (text) return text;
  }

  const title = el.getAttribute("title");
  if (title) return title;

  const img = el instanceof HTMLImageElement ? el : el.querySelector("img[alt]");
  const alt = img?.getAttribute("alt");
  if (alt) return alt;

  const svgTitle = el.querySelector("svg title")?.textContent;
  if (svgTitle) return svgTitle;

  return undefined;
}

/** Text content without descending into hidden or ignored parts. */
function visibleText(el: Element): string {
  // textContent is much cheaper than innerText and close enough for labels.
  // It does include visually hidden helper text, which usually helps.
  let text = "";
  const walk = (node: Node) => {
    if (text.length > 160) return;
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.hasAttribute("data-haptic-ignore") || node.getAttribute("aria-hidden") === "true") return;
    if (node.tagName === "SCRIPT" || node.tagName === "STYLE" || node.tagName === "svg") return;
    if (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.tagName === "SELECT") return;
    for (const child of node.childNodes) walk(child);
    text += " ";
  };
  for (const child of el.childNodes) walk(child);
  return text.replace(/\s+/g, " ").trim();
}

function findIcon(el: Element): string | undefined {
  // Icons are usually the first few descendants of a button.
  const nested = Array.from(el.querySelectorAll("svg, i, span[class*='icon'], span[class*='material'], img[src$='.svg']")).slice(0, 6);
  const candidates: Element[] = [el, ...nested];

  for (const candidate of candidates) {
    const dataIcon = candidate.getAttribute("data-icon");
    if (dataIcon) return dataIcon;
    const className = candidate.getAttribute("class") ?? "";
    if (!className) continue;
    if (MATERIAL_ICON_CLASS.test(className)) {
      const ligature = candidate.textContent?.trim();
      if (ligature && /^[a-z_]+$/.test(ligature)) return ligature.replace(/_/g, "-");
    }
    for (const pattern of ICON_CLASS_PATTERNS) {
      const match = pattern.exec(className);
      if (match?.[1] && match[1] !== "icon") return match[1];
    }
  }
  for (const candidate of nested) {
    const match = GENERIC_ICON_CLASS.exec(candidate.getAttribute("class") ?? "");
    if (match?.[1]) return match[1];
  }
  return undefined;
}
