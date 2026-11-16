// Runs inside a page, in a real browser, to outline it for Haptic. Both
// functions must stay self-contained, with no imports and nothing from the
// enclosing scope, because the browser is handed their source text.

export interface RawOutline {
  title: string;
  description: string;
  headings: string[];
  links: { label: string; href: string }[];
  buttons: string[];
  fields: string[];
  /** How many disclosure controls were opened to reveal more. */
  opened: number;
}

/**
 * Opens what navigation hides without changing anything: <details>, tabs, and
 * buttons that declare they show or hide something (aria-expanded=false with
 * aria-controls or aria-haspopup). Never a link, never a control inside a form,
 * never a submit button. Resolves with how many it opened.
 */
export async function openDisclosures(limit: number): Promise<number> {
  const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
  let opened = 0;
  for (const details of Array.from(document.querySelectorAll("details:not([open])")).slice(0, limit)) {
    details.setAttribute("open", "");
    opened++;
  }
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button[aria-expanded="false"], [role="button"][aria-expanded="false"], [role="tab"][aria-selected="false"], [role="tab"]:not([aria-selected])',
    ),
  ).filter((el) => {
    if (el.closest("form, [role='form']")) return false;
    if (el instanceof HTMLButtonElement && el.type === "submit" && el.form) return false;
    if (el.closest("a[href]:not([href='#'])")) return false;
    if (el.getAttribute("role") === "tab") return true;
    return el.hasAttribute("aria-controls") || el.hasAttribute("aria-haspopup");
  });
  const start = location.href;
  for (const el of candidates.slice(0, Math.max(0, limit - opened))) {
    if (location.href !== start || !el.isConnected) break;
    el.click();
    opened++;
    await pause();
  }
  return opened;
}

/** The page's outline: title, headings, where links lead, and the names of buttons and fields. */
export function outlinePage(): RawOutline {
  const text = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  const visible = (el: Element) => (el as HTMLElement).getClientRects().length > 0;
  const name = (el: Element) =>
    text(el.getAttribute("aria-label")) || text((el as HTMLElement).innerText) || text(el.getAttribute("title")) || text(el.getAttribute("value"));
  const unique = (items: string[], max: number) => Array.from(new Set(items.filter(Boolean))).slice(0, max);

  const links: { label: string; href: string }[] = [];
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    if (!a.href.startsWith("http")) continue;
    links.push({ label: visible(a) ? name(a) : text(a.getAttribute("aria-label")) || text(a.textContent), href: a.href });
  }
  const fields = Array.from(document.querySelectorAll<HTMLInputElement>("input, select, textarea"))
    .filter((el) => !["hidden", "submit", "button", "reset", "image", "password"].includes((el.type || "").toLowerCase()))
    .map((el) => {
      const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
      return text(byFor?.textContent) || text(el.closest("label")?.textContent) || text(el.getAttribute("aria-label")) || text(el.getAttribute("placeholder")) || text(el.name);
    });
  return {
    title: text(document.title) || text(document.querySelector("h1")?.textContent),
    description: text(document.querySelector('meta[name="description"]')?.getAttribute("content")),
    headings: unique(Array.from(document.querySelectorAll("h1, h2, h3")).filter(visible).map((el) => text(el.textContent)), 12),
    links: links.slice(0, 300),
    buttons: unique(
      Array.from(document.querySelectorAll("button, [role='button'], [role='tab'], [role='menuitem'], input[type='submit'], input[type='button'], summary"))
        .filter(visible)
        .map(name),
      40,
    ),
    fields: unique(fields, 30),
    opened: 0,
  };
}
