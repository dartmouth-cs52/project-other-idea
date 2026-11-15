import { cleanText, type SnapElement } from "../shared/types.ts";
import { findOpenModal, takeSnapshot } from "../widget/snapshot.ts";

// Runs inside a page the intake has loaded in a browser, and reads it with the
// widget's own reading, so the map uses the names the model will see live.
// It only reads: it never clicks, types, focuses or scrolls anything.
// src/intake/browse.ts bundles this file and hands it to the page.

/** A control as the widget lists it, with what the map needs to know besides. */
export interface ReadControl extends Pick<SnapElement, "role" | "label" | "icon" | "context"> {
  /** The full address of a link, for following it and naming where it leads. */
  address?: string;
  /** In the page's furniture: navigation, header, side bar, menu, tabs or footer. */
  nav: boolean;
  /** Inside a row, cell, card or entry of the page's data, like a name in a table. */
  record: boolean;
  /** Opens a menu or a panel rather than going somewhere, though it may have an address. */
  opensMenu: boolean;
}

export interface PageReading {
  /** Where the browser ended up, after any redirect. */
  address: string;
  title: string;
  description: string;
  headings: string[];
  /** Set when a dialog covered the page as it loaded. The page under it is what was read. */
  dialog?: string;
  controls: ReadControl[];
  /** Every link on the page with an address, listed or not, so pages under closed menus can be found. */
  links: { address: string; label: string; nav: boolean; record: boolean; marked: boolean }[];
  /** The page asks for a password: a sign-in page, or a page that sent the reader to one. */
  signIn: boolean;
}

const NAV = "nav, header, aside, footer, [role='navigation'], [role='banner'], [role='complementary'], [role='contentinfo'], [role='menu'], [role='menubar'], [role='tablist'], [role='toolbar']";
const RECORD = "tr, td, th, [role='row'], [role='gridcell'], [role='cell'], [role='rowheader'], article, [role='article'], [role='feed'] > *";

function linkOf(el: Element): HTMLAnchorElement | undefined {
  const anchor = el.closest("a[href]");
  return anchor instanceof HTMLAnchorElement ? anchor : undefined;
}

function opensMenu(el: Element): boolean {
  const popup = el.getAttribute("aria-haspopup");
  return (!!popup && popup !== "false") || el.hasAttribute("aria-expanded");
}

/**
 * The page's own headings, at every level: many apps title a page with an h5
 * or h6. Headings inside the page's data, like a card's title, are left out.
 */
function headings(ignore: Element): string[] {
  const found: string[] = [];
  for (const el of Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading']"))) {
    if (found.length >= 12) break;
    // A heading inside a list item titles one entry of a list, like a post in a feed.
    if (ignore.contains(el) || el.closest(RECORD) || el.closest("li, [role='listitem'], [aria-hidden='true'], [inert]")) continue;
    if (typeof el.checkVisibility === "function" ? !el.checkVisibility({ visibilityProperty: true }) : !el.getClientRects().length) continue;
    const text = cleanText(el.textContent ?? "", 60);
    if (text && !found.includes(text)) found.push(text);
  }
  return found;
}

/** Only the number of controls listed, to tell when a page has finished drawing. */
export function count(): number {
  return takeSnapshot(document.createElement("div"), "").snapshot.elements.length;
}

export function read(): PageReading {
  // A dialog that covers the page as it loads (a cookie notice, a tour) would be
  // all the widget lists. The intake never closes it, so it reads past it.
  let ignore: Element = document.createElement("div");
  const modal = findOpenModal(ignore);
  if (modal) ignore = modal;
  // No visitor and no question: every long number and email is masked.
  const { snapshot, elements } = takeSnapshot(ignore, "");

  const controls: ReadControl[] = snapshot.elements.map((element) => {
    const el = elements.get(element.id);
    const anchor = el && linkOf(el);
    const control: ReadControl = {
      role: element.role,
      label: element.label,
      nav: !!el?.closest(NAV),
      record: !!el?.closest(RECORD),
      opensMenu: !!el && opensMenu(el),
    };
    if (element.icon) control.icon = element.icon;
    if (element.context) control.context = element.context;
    if (anchor?.href) control.address = anchor.href;
    return control;
  });

  const links: PageReading["links"] = [];
  const seen = new Set<string>();
  for (const anchor of Array.from(document.querySelectorAll("a[href], area[href]")) as (HTMLAnchorElement | HTMLAreaElement)[]) {
    if (!anchor.href || seen.has(anchor.href) || anchor.closest("[data-haptic-ignore]")) continue;
    seen.add(anchor.href);
    links.push({
      address: anchor.href,
      label: cleanText(anchor.getAttribute("aria-label") || anchor.textContent || anchor.getAttribute("title") || "", 60),
      nav: !!anchor.closest(NAV),
      record: !!anchor.closest(RECORD),
      // Marked by the page as a download or as something other than a plain visit: Rails and Turbo send these as a form.
      marked: anchor.hasAttribute("download") || anchor.hasAttribute("data-method") || anchor.hasAttribute("data-turbo-method") || anchor.hasAttribute("data-confirm"),
    });
    if (links.length >= 400) break;
  }

  const reading: PageReading = {
    address: location.href,
    title: snapshot.title,
    description: cleanText(document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "", 200),
    headings: headings(ignore),
    controls,
    links,
    signIn: !!document.querySelector("input[type='password']"),
  };
  if (modal) reading.dialog = cleanText(modal.getAttribute("aria-label") || modal.querySelector("h1, h2, h3, [role='heading']")?.textContent || "", 60);
  return reading;
}
