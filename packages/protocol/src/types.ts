// Shapes shared by the SDK (browser) and the API (server). Keep this file free
// of DOM and Node APIs so both sides can import it.

/** Where an element sits relative to the visible viewport. */
export type ViewportPosition = "visible" | "above" | "below" | "left" | "right";

export interface SnapshotElement {
  /** Short handle like "e12", valid for one snapshot only. */
  id: string;
  /** link, button, textbox, checkbox, select, tab, menuitem, clickable, ... */
  role: string;
  /** Best visible or accessible label. Can be empty for unlabeled icons. */
  label: string;
  /** Icon name from the icon's class, e.g. "share-2" from lucide-share-2. */
  icon?: string;
  /** Extra signals: "short-text", "testid:create-key", "name:email". */
  hints?: string[];
  /** Normalized path for same-origin links, e.g. "/settings/:id". */
  href?: string;
  /** Landmark and nearest heading, e.g. "main › API keys". */
  context?: string;
  /** "disabled", "expanded", "collapsed", "current", "checked", "selected". */
  state?: string[];
  position: ViewportPosition;
}

export interface PageSnapshot {
  /** Normalized path of the current page, e.g. "/set/:id". */
  path: string;
  title: string;
  viewport: { width: number; height: number; scrollY: number; scrollHeight: number };
  headings: string[];
  /** Text of role=alert and role=status regions. */
  alerts: string[];
  /** Short visible text blocks (paragraphs, list items), masked and capped. */
  text?: string[];
  /** Label of the open modal dialog, if one is open. Elements behind it are left out. */
  dialog?: string;
  elements: SnapshotElement[];
  /** True when the element cap cut the list short. */
  truncated: boolean;
}

/** What happened on the page since the last step, for continue turns. */
export type ContinueEvent =
  /** id is empty when the user clicked something other than the pointed element. */
  | { type: "clicked"; id: string; label: string }
  /** The user typed into or picked a value in the pointed field. Values are never read. */
  | { type: "filled"; id: string; label: string }
  | { type: "navigated"; from: string; to: string }
  | { type: "changed" };

/** What changed on the page between the last step and this one. */
export interface PageChange {
  /** True when nothing in the element list, headings or text changed. */
  none: boolean;
  path?: { from: string; to: string };
  dialogOpened?: string;
  dialogClosed?: string;
  /** New controls, described like 'button "Create"'. Only listed within the same page and dialog. */
  added?: string[];
  addedMore?: number;
  removed?: string[];
  removedMore?: number;
  /** Flipped states, like 'checkbox "Remember me" is now checked'. */
  states?: string[];
  /** New alerts, headings and text. */
  text?: string[];
}

/**
 * Sent when the SDK holds back a step that points at the same element again.
 * "unchanged": the user just used it and nothing changed. "repeated": it's the
 * third step in a row on that element.
 */
export interface RepeatNudge {
  reason: "unchanged" | "repeated";
  /** The element, described like 'button "Team"'. */
  label: string;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  /** Plain text without tags. Element ids would be stale by the next turn. */
  text: string;
}

export interface TurnRequest {
  kind: "ask" | "continue";
  /** The user's question, for "ask" turns. */
  question?: string;
  /** The original goal, carried through "continue" turns. */
  goal?: string;
  event?: ContinueEvent;
  /** How the page changed since the last step, for continue turns. */
  change?: PageChange;
  nudge?: RepeatNudge;
  /** Steps taken so far in this guide, starting at 0. */
  step?: number;
  /** Normalized paths visited so far in this guide, oldest first. */
  visited?: string[];
  snapshot: PageSnapshot;
  history: HistoryTurn[];
  /** Customer-provided runtime context from Haptic.setContext(). */
  context?: Record<string, string | number | boolean>;
}

/** Events the API streams back to the SDK over SSE. */
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "point"; id: string }
  | { type: "wait" }
  | { type: "done" }
  | { type: "end"; usage?: TurnUsage }
  | { type: "error"; message: string };

export interface TurnUsage {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Milliseconds from request start to the model's first token. */
  firstTokenMs?: number;
  /** Milliseconds from request start to the first point event. */
  firstPointMs?: number;
}

export const DOCK_POSITIONS = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"] as const;
export type DockPosition = (typeof DOCK_POSITIONS)[number];
export type PanelPosition = DockPosition | "launcher";

export interface SiteAppearance {
  /** "auto" for black and white that adapts to the page, or a hex color. */
  accent: string;
  /** Where the persistent launcher sits. */
  position: DockPosition;
  /** Where the Ask bar and unanchored captions sit. "launcher" follows position. */
  panelPosition: PanelPosition;
  launcherStyle: "pill" | "icon";
  launcherLabel: string;
  showLauncher: boolean;
  /** Distance from the nearest horizontal and vertical screen edges, in pixels. */
  edgeOffsetX: number;
  edgeOffsetY: number;
  /** Ask bar width in pixels. It still shrinks to fit narrow viewports. */
  panelWidth: number;
  greeting?: string;
}

/** Public site config returned by /session and read by the SDK. */
export interface SiteConfig {
  siteName: string;
  appearance: SiteAppearance;
  voiceEnabled: boolean;
  learningEnabled: boolean;
}

export interface SessionResponse {
  token: string;
  expiresAt: number;
  config: SiteConfig;
}

/** A cleaned outline of one route, sent to build the learned site map. */
export interface PageOutline {
  path: string;
  title: string;
  headings: string[];
  links: { label: string; href: string }[];
  buttons: string[];
}

export const DEFAULT_APPEARANCE: SiteAppearance = {
  accent: "auto",
  position: "bottom-right",
  panelPosition: "launcher",
  launcherStyle: "pill",
  launcherLabel: "Ask",
  showLauncher: true,
  edgeOffsetX: 20,
  edgeOffsetY: 20,
  panelWidth: 380,
};

const PANEL_POSITIONS = ["launcher", ...DOCK_POSITIONS] as const;

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? (value as T) : fallback;
}

function integerBetween(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

/** Fill old or malformed stored appearance JSON with safe SDK defaults. */
export function normalizeAppearance(stored: unknown): SiteAppearance {
  const value = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const accent = typeof value.accent === "string" && (value.accent === "auto" || /^#[0-9a-f]{6}$/i.test(value.accent)) ? value.accent : DEFAULT_APPEARANCE.accent;
  const launcherLabel = typeof value.launcherLabel === "string" && value.launcherLabel.trim() ? value.launcherLabel.trim().slice(0, 24) : DEFAULT_APPEARANCE.launcherLabel;
  const greeting = typeof value.greeting === "string" ? value.greeting.trim().slice(0, 80) : "";

  return {
    accent,
    position: oneOf(value.position, DOCK_POSITIONS, DEFAULT_APPEARANCE.position),
    panelPosition: oneOf(value.panelPosition, PANEL_POSITIONS, DEFAULT_APPEARANCE.panelPosition),
    launcherStyle: oneOf(value.launcherStyle, ["pill", "icon"] as const, DEFAULT_APPEARANCE.launcherStyle),
    launcherLabel,
    showLauncher: typeof value.showLauncher === "boolean" ? value.showLauncher : DEFAULT_APPEARANCE.showLauncher,
    edgeOffsetX: integerBetween(value.edgeOffsetX, 0, 160, DEFAULT_APPEARANCE.edgeOffsetX),
    edgeOffsetY: integerBetween(value.edgeOffsetY, 0, 160, DEFAULT_APPEARANCE.edgeOffsetY),
    panelWidth: integerBetween(value.panelWidth, 280, 560, DEFAULT_APPEARANCE.panelWidth),
    ...(greeting ? { greeting } : {}),
  };
}
