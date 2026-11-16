// The rules behind adding a site, one question per screen: the steps in order,
// where a reloaded page picks up, what the install status says, and the checks
// on what people type. The pages and the Worker both use this file, and it has
// no React in it, so the tests at the top of the repository can run it.

/** The steps, in order. A step is saved by its id, so one can be added later without moving anyone. */
export const SETUP_STEPS = [
  { id: "address", title: "Your app" },
  { id: "reading", title: "Reading your site" },
  { id: "learned", title: "What Haptic learned" },
  { id: "install", title: "Add the script" },
  { id: "connect", title: "See it connect" },
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number]["id"];

/** What is kept on the site, in sites.context.setup, so a reload lands on the same screen. */
export interface SetupState {
  step: SetupStepId;
  /** Chose Finish later. The dashboard then offers to continue, and does not send them back here. */
  later?: boolean;
  /** Left the last screen for the dashboard. */
  finishedAt?: string;
}

export function isSetupStep(value: unknown): value is SetupStepId {
  return SETUP_STEPS.some((step) => step.id === value);
}

export function stepIndex(id: SetupStepId): number {
  return SETUP_STEPS.findIndex((step) => step.id === id);
}

/** "Step 2 of 5". */
export function stepLabel(id: SetupStepId): string {
  return `Step ${stepIndex(id) + 1} of ${SETUP_STEPS.length}`;
}

export function nextStep(id: SetupStepId): SetupStepId | undefined {
  return SETUP_STEPS[stepIndex(id) + 1]?.id;
}

export function previousStep(id: SetupStepId): SetupStepId | undefined {
  return SETUP_STEPS[stepIndex(id) - 1]?.id;
}

/** What the setup screens need to know about a site. */
export interface SetupSiteState {
  connected: boolean;
  reading: { done: boolean } | null;
  setup?: SetupState | null;
}

/**
 * The screen to show when the page loads. It comes from the site, so a reload,
 * a second tab or another person at the company lands in the same place.
 */
export function stepFor(site: SetupSiteState | null): SetupStepId {
  if (!site) return "address";
  const saved = site.setup?.step;
  // Once the script is seen, the last screen says so, wherever they were.
  if (site.connected && (saved === "install" || saved === "connect")) return "connect";
  if (saved && saved !== "address") return saved;
  if (site.connected) return "connect";
  return site.reading && site.reading.done ? "learned" : "reading";
}

/** Whether the dashboard should send someone to the setup screens instead of showing the site. */
export function belongsInSetup(site: SetupSiteState): boolean {
  return !site.connected && Boolean(site.setup && !site.setup.finishedAt && !site.setup.later);
}

// The address ------------------------------------------------------------------

const LOCAL = /^(localhost|127\.|10\.|192\.168\.|\[::1\])/i;

/**
 * Checks an address the way the Worker does (siteAddress in worker/app-api.ts),
 * so most mistakes are caught before anything is sent. Returns the origin.
 */
export function checkAddress(input: string): { ok: true; origin: string; url: string } | { ok: false; message: string } {
  let text = input.trim();
  if (!text) return { ok: false, message: "Enter your app's address, like app.example.com." };
  if (/\s/.test(text)) return { ok: false, message: "An address has no spaces. Try something like app.example.com." };
  // With no scheme, a local or private address is a developer's own machine, which serves plain http. Anything else gets https.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `${LOCAL.test(text) ? "http" : "https"}://${text}`;
  if (!URL.canParse(text)) return { ok: false, message: "That isn't a web address. Try something like app.example.com." };
  const url = new URL(text);
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, message: "Use an address that starts with https://." };
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return { ok: false, message: "That address is missing its domain, like .com." };
  url.hash = "";
  return { ok: true, origin: url.origin, url: url.href };
}

// An email address -------------------------------------------------------------

const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i;

/** The address cleaned up, or a sentence saying what to type. */
export function checkEmail(input: unknown): { ok: true; email: string } | { ok: false; message: string } {
  const email = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (!email) return { ok: false, message: "Enter your developer's email." };
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false, message: "Enter a full email address, like name@company.com." };
  return { ok: true, email };
}

/**
 * The mailbox an address reaches, written one way, so the limit on emails to
 * one person can't be got round by spelling it differently: lower case, with
 * any +tag taken off, and on Gmail with the dots taken out too.
 */
export function mailboxOf(email: string): string {
  const at = email.lastIndexOf("@");
  let local = email.slice(0, at).trim().toLowerCase();
  let domain = email.slice(at + 1).trim().toLowerCase();
  local = local.split("+")[0] ?? local;
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

// What the reading found -------------------------------------------------------

/** The parts of a page the reader keeps that count as something to click or fill in. */
export interface ReadPage {
  path: string;
  title: string;
  links: { label: string; to: string }[];
  buttons: string[];
  fields: string[];
  opens?: { control: string; links: { label: string; to: string }[]; buttons: string[] }[];
}

/** Buttons, links and fields on a page, including what its menus and tabs show. Counted as the reader counts them. */
export function pageControls(page: ReadPage): number {
  const behind = (page.opens ?? []).reduce((sum, opening) => sum + opening.links.length + opening.buttons.length, 0);
  return page.links.length + page.buttons.length + page.fields.length + behind;
}

/** A reading's failure that means the page wanted someone signed in. */
export const NEEDS_SIGN_IN = /leads to another site|HTTP 40[13]\b/i;

/** Controls people should only ever use on purpose. Haptic suggests never pointing at them. */
const RISKY =
  /\b(delete|remove|erase|destroy|deactivate|close (my |your |the )?account|cancel (my |your |the )?(subscription|plan|account)|transfer( ownership)?|ownership|revoke|pay|payment|checkout|billing)\b/i;

export interface SuggestedControl {
  role?: string;
  label: string;
  /** Where the reader saw it. None for the ones every app is likely to have. */
  path?: string;
}

/** What is suggested for "Never touch" before the reading has found anything. Matched by name, like every blocked control. */
export const DEFAULT_NEVER_TOUCH: SuggestedControl[] = [{ label: "Delete" }, { label: "Pay" }, { label: "Transfer ownership" }, { label: "Change billing" }];

/** The controls the reader found that look like they delete, pay or hand something over, most common first. */
export function riskyControls(pages: ReadPage[], max = 8): SuggestedControl[] {
  const found = new Map<string, SuggestedControl & { seen: number }>();
  const note = (label: string, role: string, path: string) => {
    const text = label.replace(/\s+/g, " ").trim();
    if (!text || text.length > 40 || !RISKY.test(text)) return;
    const key = `${role} ${text.toLowerCase()}`;
    const known = found.get(key);
    if (known) known.seen += 1;
    else found.set(key, { role, label: text, path, seen: 1 });
  };
  for (const page of pages) {
    for (const button of page.buttons) note(button, "button", page.path);
    for (const link of page.links) note(link.label, "link", page.path);
    for (const opening of page.opens ?? []) {
      for (const button of opening.buttons) note(button, "button", page.path);
      for (const link of opening.links) note(link.label, "link", page.path);
    }
  }
  return [...found.values()]
    .sort((a, b) => b.seen - a.seen || a.label.localeCompare(b.label))
    .slice(0, max)
    .map(({ role, label, path }) => ({ role, label, path }));
}

/** The suggestions for "Never touch": what the reader found, then the usual ones, without repeating a name. */
export function neverTouchSuggestions(found: SuggestedControl[]): SuggestedControl[] {
  const out: SuggestedControl[] = [];
  for (const item of [...found, ...DEFAULT_NEVER_TOUCH]) {
    if (!out.some((other) => other.label.toLowerCase() === item.label.toLowerCase())) out.push(item);
  }
  return out;
}

// The install status ----------------------------------------------------------

export interface SeenOriginLike {
  origin: string;
  allowed: boolean;
  last_seen_at: string;
}

export type InstallStatus =
  | { kind: "idle" }
  /** The prompt was copied and nothing has been seen yet. After a minute this becomes waiting. */
  | { kind: "copied" }
  | { kind: "waiting" }
  /** The script ran on an address the site does not allow, such as localhost or staging. It works, and is hidden there. */
  | { kind: "refused"; origin: string }
  | { kind: "live"; origin: string };

/** How long after the copy "Paste to your agent" turns into "Waiting for your agent". Vercel's pill waits the same. */
export const WAITING_AFTER_MS = 60_000;

/**
 * Where an install has got to, from what the install check has seen. Seen on
 * an allowed address beats everything. Otherwise the newest refused address.
 */
export function installStatus(site: { connected: boolean; origins: SeenOriginLike[] }, copiedAt: number | null, now: number): InstallStatus {
  const allowed = site.origins.filter((row) => row.allowed).sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));
  if (site.connected && allowed[0]) return { kind: "live", origin: allowed[0].origin };
  const refused = site.origins.filter((row) => !row.allowed).sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));
  if (refused[0]) return { kind: "refused", origin: refused[0].origin };
  if (copiedAt === null) return { kind: "idle" };
  return now - copiedAt < WAITING_AFTER_MS ? { kind: "copied" } : { kind: "waiting" };
}

/** "app.example.com", or "localhost:3000". */
export function hostOf(origin: string): string {
  return URL.canParse(origin) ? new URL(origin).host : origin;
}

/** The words on the "Onboard your agent" pill for each status. */
export function pillLabel(status: InstallStatus): string {
  switch (status.kind) {
    case "idle":
      return "Onboard your agent";
    case "copied":
      return "Paste to your agent";
    case "waiting":
      return "Waiting for your agent";
    case "refused":
      return `Script added, on ${hostOf(status.origin)}`;
    case "live":
      return `Haptic is live on ${hostOf(status.origin)}`;
  }
}

// Changes against the range before --------------------------------------------

export interface Change {
  direction: "up" | "down" | "same";
  /** A whole sentence fragment, such as "Up 12% on the previous 30 days". */
  text: string;
}

/** A count against the same count in the range before. Null when both are zero, so there is nothing to say. */
export function countChange(now: number, before: number, period: string): Change | null {
  if (now === before) return now === 0 ? null : { direction: "same", text: `Same as ${period}` };
  if (before === 0) return { direction: "up", text: `Up from 0 in ${period}` };
  const share = Math.round((Math.abs(now - before) / before) * 100);
  return { direction: now > before ? "up" : "down", text: `${now > before ? "Up" : "Down"} ${share}% on ${period}` };
}

/** A rate against the rate before, in percentage points. Null when either range had nothing to count. */
export function rateChange(now: number | null, before: number | null, period: string): Change | null {
  if (now === null || before === null) return null;
  const points = Math.round(now * 100) - Math.round(before * 100);
  if (points === 0) return { direction: "same", text: `Same as ${period}` };
  return { direction: points > 0 ? "up" : "down", text: `${points > 0 ? "Up" : "Down"} ${Math.abs(points)} ${Math.abs(points) === 1 ? "point" : "points"} on ${period}` };
}

/** A time against the time before, to the second. */
export function durationChange(now: number | null, before: number | null, period: string): Change | null {
  if (now === null || before === null) return null;
  const seconds = Math.round(now / 1000) - Math.round(before / 1000);
  if (seconds === 0) return { direction: "same", text: `Same as ${period}` };
  return { direction: seconds > 0 ? "up" : "down", text: `${duration(Math.abs(seconds) * 1000)} ${seconds > 0 ? "slower" : "faster"} than ${period}` };
}

/** "42 s", "3 min 5 s", "1 h 4 min". */
export function duration(ms: number | null): string {
  if (ms === null) return "";
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return total % 60 ? `${minutes} min ${total % 60} s` : `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
