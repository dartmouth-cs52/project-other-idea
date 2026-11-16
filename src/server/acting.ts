import { ACT_VERSION, actingAllowedAt, actionsAllowed, type ActingSettings, type PublicSiteConfig, type SiteContext, type TurnRequest } from "../shared/types.ts";

// "Do it with me" as the server sees it: whether a site has it on, and whether
// one step may be answered in act mode. The site is read again for every
// step, so a company that turns acting off stops it on the next step of a
// guide that is already running.

/** Problems with a site's acting settings, one sentence each. None when they can be read. */
export function actingProblems(acting: unknown): string[] {
  if (acting === undefined) return [];
  if (!acting || typeof acting !== "object" || Array.isArray(acting)) return ["acting has to be an object, like { \"enabled\": true }."];
  const given = acting as Record<string, unknown>;
  const words = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");
  const problems: string[] = [];
  if (typeof given.enabled !== "boolean") problems.push("acting.enabled has to be true or false.");
  if (given.paths !== undefined && !words(given.paths)) problems.push('acting.paths has to be a list of path prefixes, like ["/cards"].');
  if (given.commitWords !== undefined && !words(given.commitWords)) problems.push('acting.commitWords has to be a list of words, like ["Book"].');
  if (given.maxActions !== undefined && (typeof given.maxActions !== "number" || !Number.isFinite(given.maxActions))) problems.push("acting.maxActions has to be a number.");
  if (given.confirmFirst !== undefined && typeof given.confirmFirst !== "boolean") problems.push("acting.confirmFirst has to be true or false.");
  return problems;
}

/**
 * The site's acting settings when acting is on, or undefined. Settings that
 * cannot be read count as off: each of them can only have been meant to
 * narrow where or how Haptic acts, so reading them as anything else could
 * widen it.
 */
export function siteActing(site: SiteContext): ActingSettings | undefined {
  const acting = site.acting;
  if (acting?.enabled !== true || actingProblems(acting).length) return undefined;
  return acting;
}

/** What the widget is told of a site's acting, for its Do it button. Absent when acting is off, so a site without it sends what it always sent. */
export function publicActing(site: SiteContext): PublicSiteConfig["acting"] {
  const acting = siteActing(site);
  if (!acting) return undefined;
  const shown: NonNullable<PublicSiteConfig["acting"]> = {};
  if (acting.paths?.length) shown.paths = acting.paths;
  if (acting.commitWords?.length) shown.commitWords = acting.commitWords;
  shown.maxActions = actionsAllowed(acting);
  shown.confirmFirst = acting.confirmFirst !== false;
  return shown;
}

/** Why a step that asked to act is answered as a guide: the widget is too old to act, the site has acting off, or not at this page. */
export type NotActing = "version" | "site" | "path";

export type ActingDecision = { act: true; settings: ActingSettings } | { act: false; refused?: NotActing };

/**
 * Whether one step is answered in act mode: the widget asked for it, it
 * understands act replies, and the site allows acting at the page the
 * visitor is on. `refused` is set only when the widget asked.
 */
export function actingFor(site: SiteContext, request: TurnRequest): ActingDecision {
  if (request.mode !== "act") return { act: false };
  if ((request.version ?? 1) < ACT_VERSION) return { act: false, refused: "version" };
  const settings = siteActing(site);
  if (!settings) return { act: false, refused: "site" };
  if (!actingAllowedAt(settings, request.snapshot.path)) return { act: false, refused: "path" };
  return { act: true, settings };
}
