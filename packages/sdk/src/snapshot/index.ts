import { cleanText, normalizePath, type PageSnapshot, type SnapshotElement } from "@haptic/protocol";
import { walkPage, type Candidate } from "./walk.ts";

export const MAX_ELEMENTS = 400;
/** Total characters of plain page text sent with a snapshot. */
const MAX_TEXT_CHARS = 2500;

export interface Fingerprint {
  role: string;
  label: string;
  icon?: string;
  context?: string;
}

interface RegistryEntry {
  ref: WeakRef<Element>;
  fingerprint: Fingerprint;
  element: SnapshotElement;
}

/** Maps a snapshot's short IDs back to live elements. */
export class Registry {
  private entries = new Map<string, RegistryEntry>();

  add(id: string, el: Element, element: SnapshotElement) {
    const fingerprint: Fingerprint = {
      role: element.role,
      label: element.label,
      ...(element.icon ? { icon: element.icon } : {}),
      ...(element.context ? { context: element.context } : {}),
    };
    this.entries.set(id, { ref: new WeakRef(el), fingerprint, element });
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  element(id: string): SnapshotElement | undefined {
    return this.entries.get(id)?.element;
  }

  fingerprint(id: string): Fingerprint | undefined {
    return this.entries.get(id)?.fingerprint;
  }

  /** The live element, if it's still in the page. */
  resolve(id: string): Element | undefined {
    const el = this.entries.get(id)?.ref.deref();
    return el?.isConnected ? el : undefined;
  }

  /** Find an element by fingerprint, for when a re-render replaced the node. */
  find(fingerprint: Fingerprint): { id: string; el: Element } | undefined {
    let loose: { id: string; el: Element } | undefined;
    for (const [id, entry] of this.entries) {
      const el = entry.ref.deref();
      if (!el?.isConnected) continue;
      const fp = entry.fingerprint;
      if (fp.role !== fingerprint.role || fp.label !== fingerprint.label || fp.icon !== fingerprint.icon) continue;
      if (fp.context === fingerprint.context) return { id, el };
      loose ??= { id, el };
    }
    return loose;
  }
}

export interface SnapshotResult {
  snapshot: PageSnapshot;
  registry: Registry;
  /** Milliseconds the walk took, for the latency HUD. */
  ms: number;
}

export function takeSnapshot(ignore: Element): SnapshotResult {
  const started = performance.now();
  const walked = walkPage(document, ignore);
  const chosen = choose(walked.candidates);
  const registry = new Registry();

  const elements = chosen.map((candidate, index) => {
    const element = toElement(candidate, `e${index + 1}`);
    registry.add(element.id, candidate.el, element);
    return element;
  });

  const scrolling = document.scrollingElement ?? document.documentElement;
  const snapshot: PageSnapshot = {
    path: normalizePath(location.pathname),
    title: cleanText(document.title, 80),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollY: Math.round(scrolling.scrollTop),
      scrollHeight: Math.round(scrolling.scrollHeight),
    },
    headings: walked.headings,
    alerts: walked.alerts,
    elements,
    truncated: walked.candidates.length > chosen.length,
  };
  if (walked.dialog) snapshot.dialog = walked.dialog.label;
  const text = chooseText(walked.texts);
  if (text.length) snapshot.text = text;

  return { snapshot, registry, ms: performance.now() - started };
}

/**
 * Keep the most useful elements when a page has more than the cap: what's on
 * screen first, then navigation, then everything else, and present the result
 * in reading order.
 */
function choose(candidates: Candidate[]): Candidate[] {
  if (candidates.length <= MAX_ELEMENTS) return candidates;
  const navRegions = new Set(["header", "nav", "aside", "menu", "tabs", "toolbar"]);
  const rank = (c: Candidate) => (c.position === "visible" ? 0 : navRegions.has(c.region) ? 1 : 2);
  return [...candidates]
    .sort((a, b) => rank(a) - rank(b) || a.order - b.order)
    .slice(0, MAX_ELEMENTS)
    .sort((a, b) => a.order - b.order);
}

/** On-screen text first, then the rest, up to the character budget, in reading order. */
function chooseText(blocks: { text: string; visible: boolean; order: number }[]): string[] {
  const seen = new Set<string>();
  const ranked = [...blocks].sort((a, b) => Number(b.visible) - Number(a.visible) || a.order - b.order);
  const chosen: typeof blocks = [];
  let total = 0;
  for (const block of ranked) {
    if (seen.has(block.text) || total + block.text.length > MAX_TEXT_CHARS) continue;
    seen.add(block.text);
    chosen.push(block);
    total += block.text.length;
  }
  return chosen.sort((a, b) => a.order - b.order).map((block) => block.text);
}

function toElement(candidate: Candidate, id: string): SnapshotElement {
  const element: SnapshotElement = {
    id,
    role: candidate.role,
    label: candidate.label,
    position: candidate.position,
  };
  if (candidate.icon) element.icon = candidate.icon;
  if (candidate.hints.length) element.hints = candidate.hints;
  if (candidate.href) element.href = candidate.href;
  if (candidate.context) element.context = candidate.context;
  if (candidate.state.length) element.state = candidate.state;
  return element;
}
