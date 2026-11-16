import type { Snapshot } from "../../src/shared/types.ts";

// Runs inside a page under test, as eval/toolkits/inpage.ts does, and is handed
// to the page as text (see run.ts). It reads the page and never changes it: no
// attributes are set, no events are sent, nothing is clicked. The one thing it
// does is scroll the window, for the launcher check at the foot of the page.
//
// Some parts need the toolkit suite's helpers (window.__hapticToolkit) and the
// widget's reader (window.__hapticProbe) beside it. Those parts are used only on
// pages with Haptic in them. The rest works on any page.

interface Probe {
  takeSnapshot(ignore: Element, question: string): { snapshot: Snapshot; elements: Map<string, Element> };
}

/** The toolkit suite's in-page helpers, as far as they are used here. */
interface Toolkit {
  reg(el: Element): number;
}

/** What this file reads from the window: the readers put in beside it, and what the sweep's start-up script counts. */
interface Beside {
  __hapticProbe?: Probe;
  __hapticProbeAll?: Probe;
  __hapticToolkit?: Toolkit;
  __hapticSweep?: unknown;
  /** Kept by the sweep's start-up script (context.ts): keys that reached the window. */
  __sweepKeys?: number;
}
const beside = window as unknown as Beside;

/** Elements by number. On a page with the toolkit's helpers the number is the toolkit's, so the two files name an element alike. */
const byHandle = new Map<number, Element>();
const ownHandles = new Map<Element, number>();
function reg(el: Element): number {
  let handle = beside.__hapticToolkit?.reg(el);
  if (handle === undefined) {
    handle = ownHandles.get(el) ?? ownHandles.size;
    ownHandles.set(el, handle);
  }
  byHandle.set(handle, el);
  return handle;
}
const at = (handle: number): Element | undefined => byHandle.get(handle);

/** Parent across shadow roots. */
/**
 * The parent as the page is drawn: a node put into a <slot> is drawn inside
 * the slot, not where it sits among its host's children; a shadow root sits
 * in its host.
 */
const up = (node: Node): Node | null => (node as Element | Text).assignedSlot ?? node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);

function within(outer: Element, inner: Node | null): boolean {
  for (let node: Node | null = inner; node; node = up(node)) if (node === outer) return true;
  return false;
}

/** Every element of the page, through open shadow roots, up to a limit. */
function deepAll(limit = 60_000): Element[] {
  const out: Element[] = [];
  const walk = (root: Document | ShadowRoot) => {
    for (const el of root.querySelectorAll("*")) {
      if (out.length >= limit) return;
      out.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  return out;
}

/** Haptic's own element, wherever it has moved. */
function host(): Element | undefined {
  return document.querySelector("haptic-root") ?? deepAll().find((el) => el.tagName === "HAPTIC-ROOT");
}
const isHaptic = (node: Node | null) => {
  const h = host();
  return !!h && !!node && within(h, node);
};

/** The closest box around an element matching a selector, across shadow roots. */
function closestDeep(el: Element, selector: string): Element | null {
  for (let node: Node | null = el; node; node = up(node)) if (node instanceof Element && node.matches(selector)) return node;
  return null;
}

/** A stable name for an element: its path of tags from the root, counting same-tag siblings, through shadow roots. */
function pathOf(el: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = el; node && node !== document.documentElement; ) {
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      const root: Node | null = node.parentNode;
      if (root instanceof ShadowRoot) {
        parts.unshift("#shadow");
        node = root.host;
        continue;
      }
      break;
    }
    const here: Element = node;
    const same = Array.from(parent.children).filter((child: Element) => child.tagName === here.tagName);
    parts.unshift(same.length > 1 ? `${tag}:${same.indexOf(here) + 1}` : tag);
    node = parent;
  }
  return parts.join(">");
}

function markup(el: Element | undefined | null, max = 300): string {
  if (!el) return "";
  const open = el.outerHTML.slice(0, el.outerHTML.indexOf(">") + 1).replace(/\s(style)="[^"]*"/g, "");
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const tag = el.tagName.toLowerCase();
  const inner = el.children.length ? `${text ? `${text.slice(0, 50)} ` : ""}[${el.children.length} children]` : text.slice(0, 60);
  return `${open.length > max ? open.slice(0, max) + "…>" : open}${inner}</${tag}>`;
}

/** Words of an element, for a report: its label or its text. */
function wordsOf(el: Element): string {
  return (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** What has the keyboard, through shadow roots. "body" for nothing, "haptic" for Haptic's own. */
function focusName(): string {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body || el === document.documentElement) return "body";
  if (isHaptic(el)) return "haptic";
  return `${pathOf(el)} "${wordsOf(el).slice(0, 30)}"`;
}

const CONTROL =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="textbox"], [role="option"], [role="slider"], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Everything at a point, topmost first, through open shadow roots, with Haptic's own parts left out. */
function pageAt(x: number, y: number): Element[] {
  const out: Element[] = [];
  for (const el of document.elementsFromPoint(x, y)) {
    if (isHaptic(el)) continue;
    let inner: Element = el;
    // Into open shadow roots, for what is really there. When the topmost thing a shadow root sees is its own host, the
    // host is what is hit, as a tab is by the words the page put in its slot: what lies under it is not.
    for (let depth = 0; inner.shadowRoot && depth < 20; depth++) {
      const deeper = inner.shadowRoot.elementsFromPoint(x, y).find((hit) => !isHaptic(hit));
      if (!deeper || deeper === inner) break;
      inner = deeper;
    }
    out.push(inner);
  }
  return out;
}

/** Whether the element, or a box it sits in, stays put on screen when the page scrolls. */
function pinned(el: Element): boolean {
  for (let node: Node | null = el; node; node = up(node)) {
    if (!(node instanceof Element)) continue;
    const position = getComputedStyle(node).position;
    if (position === "fixed" || position === "sticky") return true;
  }
  return false;
}

/** Whether a box is where descendants with this position are laid out from, which is what makes it clip them. As in the toolkit suite. */
function holds(box: CSSStyleDeclaration, position: string): boolean {
  const makesBlock = box.transform !== "none" || box.filter !== "none" || /paint|layout|strict|content/.test(box.contain) || box.willChange.includes("transform");
  if (position === "fixed") return makesBlock;
  if (position === "absolute") return box.position !== "static" || makesBlock;
  return true;
}

/** The part of an element's box not clipped away by a scrolling or clipping box around it, as the page is drawn. As in the toolkit suite. */
function visibleRect(el: Element): DOMRect | undefined {
  const rect = el.getBoundingClientRect();
  let [left, top, right, bottom] = [rect.left, rect.top, rect.right, rect.bottom];
  let position = getComputedStyle(el).position;
  let node = up(el);
  for (let depth = 0; node && depth < 80; depth++, node = up(node)) {
    if (!(node instanceof Element)) continue;
    const style = getComputedStyle(node);
    if (!holds(style, position)) continue;
    if (style.position !== "static" || position === "fixed") position = style.position === "static" ? "relative" : style.position;
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const clip = node.getBoundingClientRect();
    if (style.overflowX !== "visible") [left, right] = [Math.max(left, clip.left), Math.min(right, clip.right)];
    if (style.overflowY !== "visible") [top, bottom] = [Math.max(top, clip.top), Math.min(bottom, clip.bottom)];
  }
  if (right - left <= 0 || bottom - top <= 0) return undefined;
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Whether the element is drawn so that nobody sees it: no opacity, hidden, or clipped to nothing by its own style. */
function drawnInvisible(el: Element): boolean {
  for (let node: Node | null = el; node; node = up(node)) {
    if (!(node instanceof Element)) continue;
    const style = getComputedStyle(node);
    if (Number(style.opacity) === 0 || style.visibility === "hidden") return true;
    if (style.clipPath !== "none" && /inset\(50%|circle\(0|polygon\(0/.test(style.clipPath)) return true;
    if (style.clip && style.clip !== "auto" && /rect\(\s*(0|1)px,?\s*(0|1)px/.test(style.clip)) return true;
  }
  return false;
}

/** Why something of the page's is over a control: what kind of thing the blocker is. */
function blockerKind(blocker: Element): string {
  for (let node: Node | null = blocker; node; node = up(node)) {
    if (!(node instanceof Element)) continue;
    const named = `${node.id} ${typeof node.className === "string" ? node.className : ""} ${node.getAttribute("title") ?? ""}`;
    if (/cookie|consent|gdpr|cmp|onetrust|didomi|usercentrics|sp_message|privacy/i.test(named)) return "a consent notice";
    if (node.matches('dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]') || /overlay|backdrop|modal/i.test(named)) {
      return node.getRootNode() instanceof ShadowRoot ? "a dialog inside a shadow root" : "a dialog or its backdrop";
    }
  }
  if (blocker.tagName === "IFRAME") return "a frame";
  if (pinned(blocker)) return "a bar pinned to the window";
  return "something else of the page's";
}

/**
 * The frame an element is in, when it is in a frame of the page's own origin,
 * and where that frame's window starts in the page's window.
 */
function frameOf(el: Element): { frame?: Element; dx: number; dy: number } {
  const frame = el.ownerDocument === document ? undefined : (el.ownerDocument.defaultView?.frameElement ?? undefined);
  if (!frame) return { dx: 0, dy: 0 };
  const box = frame.getBoundingClientRect();
  return { frame, dx: box.left + frame.clientLeft, dy: box.top + frame.clientTop };
}

/** A box of an element, where it lies in the page's window: one in a frame is moved by where the frame is. */
function inPageWindow(el: Element, r: DOMRect): DOMRect {
  const { dx, dy } = frameOf(el);
  return new DOMRect(r.left + dx, r.top + dy, r.width, r.height);
}

/**
 * Whether a click on the element reaches it: at its middle and four points
 * around it, and at the middle of each line of a link that wraps, whose box
 * takes in words of the lines around it. A click on it, on its label, or on a
 * small box around it counts. A point in a frame of the page's own origin is
 * tried in the frame, once the page shows the frame there. Haptic's own parts
 * are seen through, and said apart.
 */
function clickReaches(el: Element): { reached: boolean; blocker?: Element; byHaptic: boolean } {
  const { frame, dx, dy } = frameOf(el);
  const r = el.getBoundingClientRect();
  const labels = Array.from((el as HTMLInputElement).labels ?? []);
  const own = (hit: Element | undefined) => !!hit && (within(el, hit) || labels.some((label) => within(label, hit)) || (within(hit, el) && hit.getBoundingClientRect().width * hit.getBoundingClientRect().height <= Math.max(4 * r.width * r.height, 2500)));
  const points: [number, number][] = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]].map(([fx, fy]) => [r.left + r.width * fx!, r.top + r.height * fy!]);
  const lines = Array.from(el.getClientRects());
  if (lines.length > 1) for (const line of lines.slice(0, 4)) points.push([line.left + line.width / 2, line.top + line.height / 2]);
  let blocker: Element | undefined;
  let byHaptic = false;
  for (const [lx, ly] of points) {
    const [x, y] = [lx + dx, ly + dy];
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const top = document.elementFromPoint(x, y);
    if (isHaptic(top)) {
      byHaptic = true;
      continue;
    }
    let hit = pageAt(x, y)[0];
    if (frame && hit === frame) {
      hit = el.ownerDocument.elementFromPoint(lx, ly) ?? undefined;
      for (let depth = 0; hit?.shadowRoot && depth < 20; depth++) {
        const inner: Element | null = hit.shadowRoot.elementFromPoint(lx, ly);
        if (!inner || inner === hit) break;
        hit = inner;
      }
    }
    if (own(hit)) return { reached: true, byHaptic };
    blocker ??= hit;
  }
  return { reached: false, blocker, byHaptic };
}

/** Where the widget draws a thing of its own, if it is on show. */
function boxOfHaptic(selector: string): { left: number; top: number; right: number; bottom: number } | undefined {
  const el = host()?.shadowRoot?.querySelector(selector) as HTMLElement | null | undefined;
  if (!el || el.hidden) return undefined;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return undefined;
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** The question every reading in a run is given, so that the widget masks the same things the same way. */
export const QUESTION = "Where can I see more about this?";

const CONSENT = /cookie|consent|privacy|gdpr|datenschutz|einwillig|vie privée|confidentialit|privacidad|privacybeleid|toestemming|tracking/i;

const sweep = {
  pathOf: (handle: number) => {
    const el = at(handle);
    return el ? pathOf(el) : "";
  },

  /**
   * Signs that the page is a bot check or a block, not the site. A captcha
   * frame on an ordinary page, like a contact form's, is not one: only a
   * short page counts, or one whose title says so.
   */
  blockSigns(status: number): string {
    const title = document.title;
    const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
    const short = text.length < 1500;
    const frames = Array.from(document.querySelectorAll("iframe")).map((frame) => frame.src);
    if (/just a moment|attention required|access denied|are you a robot|robot check|security check|verify you are human|pardon our interruption|request unsuccessful|bot verification/i.test(title)) return `the page's title is "${title}"`;
    if (document.querySelector("#challenge-form, #cf-challenge-running, .cf-browser-verification, [name='cf-turnstile-response'], #px-captcha, #sec-if-cpt-container")) return "a bot check is on the page";
    if (frames.some((src) => /challenges\.cloudflare\.com|captcha-delivery\.com|geo\.captcha|perimeterx|px-cdn|hcaptcha\.com\/captcha/.test(src)) && short) return "a bot check is in a frame";
    if (short && /verify you are (a )?human|unusual traffic|are you a robot|press (&|and) hold|captcha|you have been blocked|access denied|automated (access|queries)|incapsula incident|enable javascript and cookies to continue|checking your browser/i.test(text))
      return `the page says "${text.slice(0, 120)}"`;
    // A single-page app can answer 404 and draw itself all the same: only a page that says it is not there is gone.
    if ((status === 404 || status === 410) && short && /not found|n.t exist|does not exist|no longer|\b404\b/i.test(`${title} ${text}`)) return `gone: the address answered ${status}, "${text.slice(0, 80)}"`;
    if (status >= 400 && short) return `the site answered ${status} with "${text.slice(0, 100)}"`;
    // A challenge that runs as a script and then reloads the page: "202 Accepted" with next to nothing in it.
    if (status === 202 && text.length < 200) return `the site answered 202 with a page of ${text.length} characters, a challenge that has to send its answer back`;
    return "";
  },

  /** Where the page's own elements are, by path, measured from the top of the document. */
  layout(max = 800) {
    const anchors: Record<string, string> = {};
    let count = 0;
    for (const el of document.querySelectorAll("a[href], button, input, select, textarea, summary, h1, h2, h3, img, label, [role]")) {
      if (count >= max) break;
      if (isHaptic(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      anchors[pathOf(el)] = `${Math.round(r.left + scrollX)},${Math.round(r.top + scrollY)},${Math.round(r.width)},${Math.round(r.height)}`;
      count++;
    }
    const doc = document.documentElement;
    return { anchors, scroll: `${doc.scrollWidth}x${doc.scrollHeight}` };
  },

  focusName,

  keys: () => beside.__sweepKeys ?? 0,

  /**
   * Where Haptic's launcher is, whether it is on top, and which of the page's
   * controls it covers. Points across the launcher are tried, and whatever the
   * page has topmost at each is what the launcher hides there.
   */
  launcher() {
    const h = host();
    const box = boxOfHaptic(".launcher");
    if (!h || !box) return { there: !!h, shown: false, onTop: false, covered: [] as Covered[] };
    const inWindow = box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight;
    const midX = (box.left + box.right) / 2;
    const midY = (box.top + box.bottom) / 2;
    const top = document.elementFromPoint(midX, midY);
    const onTop = isHaptic(top);
    const over = onTop ? "" : markup(top, 160);
    const hits = new Map<Element, number>();
    const points: [number, number][] = [];
    for (let fx = 0.1; fx < 1; fx += 0.2) for (let fy = 0.2; fy < 1; fy += 0.3) points.push([box.left + (box.right - box.left) * fx, box.top + (box.bottom - box.top) * fy]);
    for (const [x, y] of points) {
      const topmost = pageAt(x, y)[0];
      const control = topmost && closestDeep(topmost, CONTROL);
      if (control && control !== document.body) hits.set(control, (hits.get(control) ?? 0) + 1);
    }
    const covered: Covered[] = [];
    for (const [el, n] of hits) {
      const r = el.getBoundingClientRect();
      const ix = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left));
      const iy = Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top));
      const share = r.width * r.height > 0 ? (ix * iy) / (r.width * r.height) : 0;
      const middle = r.left + r.width / 2 >= box.left && r.left + r.width / 2 <= box.right && r.top + r.height / 2 >= box.top && r.top + r.height / 2 <= box.bottom;
      covered.push({ markup: markup(el, 200), words: wordsOf(el), share: Math.round(share * 100) / 100, middle, pinned: pinned(el), launcherShare: n / points.length });
    }
    return { there: true, shown: inWindow, onTop, over, covered, box };
  },

  /** Scrolls to the foot of the page, as a visitor reading to the end would. */
  toBottom() {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return { y: scrollY, max: document.documentElement.scrollHeight - innerHeight };
  },
  toTop() {
    window.scrollTo(0, 0);
  },

  /** What the widget cannot read at all, and what it could: frames, canvases, shadow roots, dialogs and consent notices. */
  inventory() {
    const all = deepAll();
    const view = innerWidth * innerHeight;
    const shownBox = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 30) return undefined;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return undefined;
      return r;
    };
    const frames = [];
    for (const el of all) {
      if (!el.matches("iframe, frame, embed, object")) continue;
      const r = shownBox(el);
      if (!r) continue;
      let sameOrigin = false;
      try {
        sameOrigin = !!(el as HTMLIFrameElement).contentDocument;
      } catch {
        sameOrigin = false;
      }
      const src = el.getAttribute("src") ?? el.getAttribute("data") ?? "";
      let from = "";
      try {
        from = src ? new URL(src, location.href).host : "(no address)";
      } catch {
        from = src.slice(0, 40);
      }
      frames.push({ sameOrigin, from, width: Math.round(r.width), height: Math.round(r.height), onScreen: r.bottom > 0 && r.top < innerHeight, title: el.getAttribute("title") ?? "" });
    }
    let canvasLargest = 0;
    let canvasTotal = 0;
    let canvases = 0;
    for (const el of all) {
      if (el.tagName !== "CANVAS") continue;
      const r = shownBox(el);
      if (!r) continue;
      canvases++;
      const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      canvasLargest = Math.max(canvasLargest, area / view);
      canvasTotal += area / view;
    }
    const openShadow = all.filter((el) => el.shadowRoot && !isHaptic(el)).length;
    const customElements = all.filter((el) => el.tagName.includes("-") && !isHaptic(el)).length;
    // Dialogs on show, and whether they are about cookies.
    const dialogs = all
      .filter((el) => el.matches('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]') && !isHaptic(el) && !!shownBox(el))
      .map((el) => ({ markup: markup(el, 160), consent: CONSENT.test((el.textContent ?? "").slice(0, 3000)), modal: el.matches("dialog:modal") || el.getAttribute("aria-modal") === "true" }));
    // A consent notice that is not a dialog: a box pinned to the window that talks about cookies.
    const notices = all
      .filter((el) => !isHaptic(el) && /cookie|consent|onetrust|didomi|cmp|sp_message|usercentrics|cybot|truste|privacy/i.test(`${el.id} ${typeof el.className === "string" ? el.className : ""}`) && !!shownBox(el) && pinned(el) && CONSENT.test((el.textContent ?? "").slice(0, 2000)))
      .slice(0, 3)
      .map((el) => markup(el, 160));
    const consentFrames = frames.filter((frame) => /consent|cmp|privacy-mgmt|sourcepoint|cookiebot|onetrust|didomi|usercentrics|trustarc/i.test(frame.from + frame.title));
    // A layer pinned to the window over nearly all of it, holding what shows at its middle: it shuts out the page under it as a modal dialog does, whatever it says of itself.
    const middle = document.elementsFromPoint(innerWidth / 2, innerHeight / 2).find((el) => !isHaptic(el));
    let blocking: Element | undefined;
    for (let node: Element | null = middle ?? null; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const r = node.getBoundingClientRect();
      if (getComputedStyle(node).position === "fixed" && r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9) blocking = node;
    }
    return {
      ...(blocking ? { blockedBy: markup(blocking, 160) } : {}),
      frames,
      canvases,
      canvasLargest: Math.round(canvasLargest * 100) / 100,
      canvasTotal: Math.round(canvasTotal * 100) / 100,
      openShadow,
      customElements,
      dialogs,
      notices,
      consentFrames: consentFrames.length,
      nodes: all.length,
      rtl: getComputedStyle(document.documentElement).direction === "rtl" || document.dir === "rtl",
      lang: document.documentElement.lang,
    };
  },

  /**
   * The widget's reading of the page, three times, timed, with the list of the
   * fastest and how many controls there would be without its length limits.
   */
  readTimes(n = 3) {
    const probe = beside.__hapticProbe;
    const ignore = host();
    if (!probe || !ignore) throw new Error("The widget's reader is not in the page.");
    const times: number[] = [];
    let snapshot: Snapshot | undefined;
    for (let i = 0; i < n; i++) {
      const started = performance.now();
      snapshot = probe.takeSnapshot(ignore, QUESTION).snapshot;
      times.push(Math.round((performance.now() - started) * 10) / 10);
    }
    let unlimited = -1;
    if (beside.__hapticProbeAll) {
      try {
        unlimited = beside.__hapticProbeAll.takeSnapshot(ignore, QUESTION).snapshot.elements.length;
      } catch {
        unlimited = -1;
      }
    }
    // Controls listed from frames of the page's own origin, which the widget reads as part of the page.
    const inFrames = [...probe.takeSnapshot(ignore, QUESTION).elements.values()].filter((el) => el.ownerDocument !== document).length;
    return { times, controls: snapshot!.elements.length, truncated: snapshot!.truncated, dialog: snapshot!.dialog, unlimited, offscreen: snapshot!.elements.filter((e) => e.offscreen).length, inFrames };
  },

  /**
   * The widget's reading of the page as it is now, with a number for each
   * listed element. The toolkit suite's own `snap` cannot be used here: it
   * calls the reader without a question, which the reader now needs.
   */
  snap(all: boolean) {
    const probe = all ? beside.__hapticProbeAll : beside.__hapticProbe;
    const ignore = host();
    if (!probe || !ignore) throw new Error("The widget's reader is not in the page.");
    const { snapshot, elements: listed } = probe.takeSnapshot(ignore, QUESTION);
    const ids: Record<string, number> = {};
    for (const [id, el] of listed) ids[id] = reg(el);
    return { snapshot, ids, inDemo: Object.fromEntries(Object.keys(ids).map((id) => [id, true])) };
  },

  /** Gives an element its number. Every element the sweep asks about is numbered here. */
  reg,

  /**
   * For controls the accessibility tree has and the list lacks: where each
   * is, to say why it is missing. In a closed shadow root it can never be
   * read; elsewhere it could be.
   */
  whereMissing(list: number[]) {
    const dialogOpen = deepAll().find((el) => !isHaptic(el) && el.matches('dialog:modal, [aria-modal="true"]') && el.getClientRects().length > 0);
    return list.map((handle) => {
      const el = at(handle);
      if (!el) return { closed: false, open: false, onScreen: false, outOfReach: false, outsideDialog: false, tag: "", pinned: false, haptic: false };
      let closed = false;
      let open = false;
      for (let node: Node | null = el; node; node = up(node)) {
        if (node instanceof ShadowRoot) {
          if (node.mode === "closed") closed = true;
          else open = true;
        }
      }
      const r = el.getBoundingClientRect();
      const onScreen = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      return {
        closed,
        open,
        onScreen,
        // Nobody sees it or can click it where it is: drawn invisible, clipped away, or something of the page's is over all of it.
        outOfReach: onScreen && !closed && (drawnInvisible(el) || !visibleRect(el) || (() => {
          const reach = clickReaches(el);
          return !reach.reached && !!reach.blocker;
        })()),
        outsideDialog: !!dialogOpen && !within(dialogOpen, el),
        tag: el.tagName.toLowerCase(),
        pinned: pinned(el),
        // Haptic's own, found by walking up to its element, which holds even where a page patches the DOM.
        haptic: (() => {
          for (let node: Node | null = el; node; node = up(node)) if (node instanceof Element && node.tagName === "HAPTIC-ROOT") return true;
          return false;
        })(),
      };
    });
  },

  /** Whether each element's box is in the window now. */
  onScreen(list: number[]) {
    return list.map((handle) => {
      const r = at(handle)?.getBoundingClientRect();
      return !!r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    });
  },

  /**
   * What each listed control is, to choose a safe one to point at: a tab, a
   * part that opens and closes, a link to a place on the same page, or a menu.
   */
  candidates(list: number[]) {
    return list.map((handle) => {
      const el = at(handle);
      if (!el) return undefined;
      const tag = el.tagName.toLowerCase();
      const href = el.getAttribute("href");
      let inPage = false;
      let targetThere = false;
      if (href !== null && el instanceof HTMLAnchorElement) {
        try {
          const url = new URL(el.href, location.href);
          inPage = url.origin === location.origin && url.pathname === location.pathname && url.search === location.search && url.hash.length > 1 && !url.hash.startsWith("#/") && !url.hash.startsWith("#!");
          if (inPage) {
            const id = decodeURIComponent(url.hash.slice(1));
            targetThere = !!(document.getElementById(id) ?? document.getElementsByName(id)[0]);
          }
        } catch {
          inPage = false;
        }
      }
      const form = closestDeep(el, "form");
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      const submits = (tag === "button" && !!form && (type === "" || type === "submit")) || (tag === "input" && /^(submit|image)$/.test(type));
      const dialog = closestDeep(el, 'dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]');
      const consentBox = closestDeep(el, '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [id*="onetrust" i], [id*="didomi" i], [id^="sp_message" i], [id*="usercentrics" i], [id*="CybotCookiebot" i]');
      const r = el.getBoundingClientRect();
      const details = tag === "summary" ? el.parentElement : null;
      return {
        tag,
        role: el.getAttribute("role") ?? "",
        type,
        href: href ?? undefined,
        inPage,
        targetThere,
        newWindow: el.getAttribute("target") === "_blank",
        submits,
        inForm: !!form,
        expanded: el.getAttribute("aria-expanded") ?? undefined,
        popup: el.getAttribute("aria-haspopup") ?? undefined,
        selected: el.getAttribute("aria-selected") ?? undefined,
        controls: el.getAttribute("aria-controls") ?? undefined,
        detailsClosed: !!details && details.tagName === "DETAILS" && !(details as HTMLDetailsElement).open,
        consent: !!consentBox || (!!dialog && CONSENT.test((dialog.textContent ?? "").slice(0, 3000))),
        inNav: !!closestDeep(el, 'nav, header, [role="navigation"], [role="banner"]'),
        words: wordsOf(el),
        onScreen: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
        // On screen, a click at its middle lands on it: nothing of the page's is over it, and it is not drawn away to nothing.
        hitsItself: (() => {
          if (!(r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth)) return true;
          const hit = pageAt(r.left + r.width / 2, r.top + r.height / 2)[0];
          return !!hit && (within(el, hit) || within(hit, el));
        })(),
        // A box a visitor can bring into the window by scrolling: not a skip link parked above the page, not a speck.
        reachable:
          r.width >= 4 &&
          r.height >= 4 &&
          r.top + scrollY >= -1 &&
          r.left + scrollX >= -1 &&
          r.left + scrollX < document.documentElement.scrollWidth &&
          (typeof el.checkVisibility !== "function" || el.checkVisibility({ visibilityProperty: true, opacityProperty: true })),
        top: Math.round(r.top + scrollY),
        markup: markup(el, 240),
        disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      };
    });
  },

  /**
   * For listed controls inside the window: whether a click anywhere on them
   * would land on something else of the page's, and on what. Haptic's own
   * parts are seen through, and said apart. A control drawn as a speck under
   * its label, as styled tick boxes are, counts as its label.
   */
  covered(list: number[]) {
    const out: { handle: number; blocker: string; byHaptic: boolean; why: string }[] = [];
    for (const handle of list) {
      const el = at(handle);
      if (!el) continue;
      const r = inPageWindow(el, el.getBoundingClientRect());
      if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
      const { reached, blocker, byHaptic } = clickReaches(el);
      if (!reached && (blocker || byHaptic)) {
        // Why a click misses it: the control is not drawn where its box says, or something is over it.
        const why = drawnInvisible(el) ? "drawn invisible" : !visibleRect(el) ? "clipped out of view inside a scrolling or clipping box" : blocker ? `under ${blockerKind(blocker)}` : "under Haptic";
        out.push({ handle, blocker: blocker ? markup(blocker, 200) : "", byHaptic: byHaptic && !blocker, why });
      }
    }
    return out;
  },

  /** What a control and the page say now, to tell what a click did. */
  stateOf(handle: number) {
    const el = at(handle);
    const details = el?.tagName === "SUMMARY" ? (el.parentElement as HTMLDetailsElement | null) : null;
    return {
      connected: !!el?.isConnected,
      expanded: el?.getAttribute("aria-expanded") ?? "",
      selected: el?.getAttribute("aria-selected") ?? "",
      pressed: el?.getAttribute("aria-pressed") ?? "",
      open: details ? String(details.open) : "",
      url: location.href,
      scrollY: Math.round(scrollY),
      focus: focusName(),
    };
  },

  /**
   * Where Haptic's pointer, caption, ring and launcher are now, and what is
   * under the pointer's tip. The tip is where ui.ts puts it: the pointer's
   * box, moved by its transform, plus the tip's place in the drawing.
   */
  pointer(handle: number) {
    const root = host()?.shadowRoot;
    const cursor = root?.querySelector(".cursor") as HTMLElement | null | undefined;
    const el = at(handle);
    if (!root || !cursor || cursor.hidden || !el) return undefined;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(cursor).transform === "none" ? undefined : getComputedStyle(cursor).transform);
    const tip = { x: matrix.e + 3.81, y: matrix.f + 3.14 };
    const pointedAt = (host() as Element & { pointedAt?: Element }).pointedAt;
    const r = el.getBoundingClientRect();
    const target = pointedAt?.getBoundingClientRect();
    const hit = pageAt(tip.x, tip.y)[0];
    const labels = Array.from((el as HTMLInputElement).labels ?? []);
    const tipHits = !!hit && (within(el, hit) || (pointedAt ? within(pointedAt, hit) : false) || labels.some((label) => within(label, hit)));
    const inBox = (b: DOMRect | undefined) => !!b && tip.x >= b.left - 2 && tip.x <= b.right + 2 && tip.y >= b.top - 2 && tip.y <= b.bottom + 2;
    const caption = boxOfHaptic(".caption");
    const dock = boxOfHaptic(".dock");
    const overlap = (b: { left: number; top: number; right: number; bottom: number } | undefined) => {
      if (!b || r.width * r.height === 0) return 0;
      const ix = Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left));
      const iy = Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top));
      return Math.round(((ix * iy) / (r.width * r.height)) * 100) / 100;
    };
    const mx = r.left + r.width / 2;
    const my = r.top + r.height / 2;
    const over = (b: { left: number; top: number; right: number; bottom: number } | undefined) => !!b && mx >= b.left && mx <= b.right && my >= b.top && my <= b.bottom;
    return {
      tip: { x: Math.round(tip.x), y: Math.round(tip.y) },
      box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      pointedAtSame: pointedAt === el || (!!pointedAt && (within(el, pointedAt) || within(pointedAt, el))),
      tipInBox: inBox(r) || inBox(target),
      tipHits,
      underTip: hit ? markup(hit, 140) : "",
      caption: caption ? { x: Math.round(caption.left), y: Math.round(caption.top), w: Math.round(caption.right - caption.left), h: Math.round(caption.bottom - caption.top) } : undefined,
      captionShare: overlap(caption),
      captionOverMiddle: over(caption),
      dockShare: overlap(dock),
      dockOverMiddle: over(dock),
      ring: !!boxOfHaptic(".ring"),
    };
  },

  /** The words Haptic shows: its caption, or the status in its box. */
  said() {
    const root = host()?.shadowRoot;
    const caption = root?.querySelector(".caption") as HTMLElement | null | undefined;
    const status = root?.querySelector(".status") as HTMLElement | null | undefined;
    return {
      caption: caption && !caption.hidden ? (caption.textContent ?? "").trim() : "",
      status: status && !status.hidden ? (status.textContent ?? "").replace("Stop", "").trim() : "",
      state: (host() as (Element & { guideState?: string }) | undefined)?.guideState ?? "",
    };
  },

  /** Whether Haptic's launcher is drawn with its own styles, as a check that its stylesheet was allowed. */
  styled() {
    const launcher = host()?.shadowRoot?.querySelector(".launcher");
    if (!launcher) return { launcher: false, styled: false, position: "" };
    const style = getComputedStyle(launcher);
    const hostStyle = getComputedStyle(host()!);
    return { launcher: true, styled: style.borderRadius === "999px" || style.backgroundColor === "rgb(28, 25, 23)", position: hostStyle.position };
  },
};

interface Covered {
  markup: string;
  words: string;
  /** How much of the control's box is under the launcher. */
  share: number;
  /** The control's middle is under the launcher. */
  middle: boolean;
  /** It stays on screen when the page scrolls, so a visitor cannot scroll it out from under. */
  pinned: boolean;
  /** How much of the launcher lies over it. */
  launcherShare: number;
}

beside.__hapticSweep = sweep;
