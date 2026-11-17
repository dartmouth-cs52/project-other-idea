import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { readName } from "../shared/act-rules.ts";
import { cleanTaughtSteps, hashTeachToken, TEACH_MINUTES, TEACH_TOKEN, type TaughtStep, type TeachSessionInfo } from "../shared/teach.ts";
import type { SiteContext } from "../shared/types.ts";

// The widget server's half of Teach Haptic (src/shared/teach.ts): the four
// calls a tab in teach mode makes. None of them calls the model.
//
//   POST /v1/teach/claim   {site, token, claim}         the token from the address, once, for this tab
//   POST /v1/teach/check   {site, token, claim}         after a page load in that tab: is the session still open?
//   POST /v1/teach/done    {site, token, claim, steps}  the steps, for the person to review in the dashboard
//   POST /v1/teach/cancel  {site, token, claim}         the person pressed Cancel
//
// The token is the only way in. It has to be one the dashboard made for this
// site, unexpired and never claimed, and the page has to be on an address
// the site allows. `claim` is a random secret the tab makes: the token is
// claimed once, with it, and from then on only the token and that secret
// together reach the session. Each caller is limited in how often it asks.

/** Why a token was turned away. The widget logs it and shows nothing on the page. */
export type TeachRefusal = "unknown" | "expired" | "used" | "closed";

export const TEACH_REFUSED: Record<TeachRefusal, string> = {
  unknown: "That teaching link isn't valid for this site.",
  expired: "That teaching link has expired. Start again from the Haptic dashboard.",
  used: "That teaching link has already been used. Start again from the Haptic dashboard.",
  closed: "That teaching session was closed. Start again from the Haptic dashboard.",
};

/** Where teach sessions are kept. Hashes only: neither the token nor the claim is ever stored. */
export interface TeachStore {
  /** Claims an unclaimed, unexpired token of this site for one tab, and gives it 30 minutes from now. */
  claim(site: string, tokenHash: string, claimHash: string, origin: string): Promise<TeachSessionInfo | TeachRefusal>;
  /** The session the token and claim reach, while it is open. */
  check(site: string, tokenHash: string, claimHash: string): Promise<TeachSessionInfo | TeachRefusal>;
  /** Keeps the steps and closes the session. */
  finish(site: string, tokenHash: string, claimHash: string, steps: TaughtStep[]): Promise<TeachSessionInfo | TeachRefusal>;
  /** Closes the session without steps. */
  cancel(site: string, tokenHash: string, claimHash: string): Promise<true | TeachRefusal>;
}

interface Call {
  site: string;
  token: string;
  claim: string;
  steps?: unknown;
}

function parseCall(body: unknown): Call | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw = body as Record<string, unknown>;
  if (typeof raw.site !== "string" || typeof raw.token !== "string" || typeof raw.claim !== "string") return undefined;
  if (!TEACH_TOKEN.test(raw.token) || !TEACH_TOKEN.test(raw.claim) || raw.token === raw.claim) return undefined;
  return { site: raw.site, token: raw.token, claim: raw.claim, steps: raw.steps };
}

/**
 * The steps a tab posted, as they are kept: checked and masked again
 * (`cleanTaughtSteps`), and each step whose words say it saves, sends, pays,
 * deletes and so on marked as one that commits, by the same word lists Do it
 * with me uses. That mark is the server's: the page cannot set or clear it.
 */
export function stepsToKeep(input: unknown): TaughtStep[] {
  return cleanTaughtSteps(input).map((step) => {
    const { commits: _fromPage, ...rest } = step;
    const pressed = rest.kind === "press" || rest.kind === "check" || rest.kind === "uncheck";
    const name = rest.label.replace(/^icon:/, "");
    // By the control's own words only. "Continue" or "OK" in a dialog is held back from Do it with me by the live check
    // (act-rules), which sees the dialog; marked here, the review would say a plain Continue saves or sends.
    const verdict = pressed && name ? readName(name) : undefined;
    return verdict?.commit ? { ...rest, commits: true as const } : rest;
  });
}

export interface TeachParts {
  loadSite(id: string): Promise<SiteContext | undefined>;
  teach?: TeachStore;
  /** True when this caller has asked too often lately. */
  overLimit(key: string): boolean | Promise<boolean>;
}

const PATHS: Record<string, "claim" | "check" | "done" | "cancel"> = {
  "/v1/teach/claim": "claim",
  "/v1/teach/check": "check",
  "/v1/teach/done": "done",
  "/v1/teach/cancel": "cancel",
};

/**
 * Answers the teach calls, or undefined for any other address. `body` reads
 * the request's JSON, `json` makes a response with the caller's CORS headers.
 */
export async function teachCall(
  parts: TeachParts,
  request: Request,
  url: URL,
  origin: string | undefined,
  caller: string,
  body: () => Promise<unknown>,
  json: (status: number, body: unknown) => Response,
): Promise<Response | undefined> {
  const what = PATHS[url.pathname];
  if (!what || request.method !== "POST") return undefined;
  // Counted before anything is looked up, so guessing tokens costs a caller its allowance and nothing else.
  if (await parts.overLimit(`teach ${caller}`)) return json(429, { error: "Too many requests. Try again in a minute." });
  const call = parseCall(await body());
  if (!call) return json(400, { error: "That isn't a valid teaching request." });
  const site = await parts.loadSite(call.site);
  if (!site) return json(404, { error: "No site with that id." });
  // Only from a page on an address the site allows. A request with no Origin is not from a page at all.
  if (!origin || !site.allowedOrigins.includes(origin)) return json(403, { error: `${origin ?? "That address"} isn't an allowed origin for this site.` });
  if (!parts.teach) return json(404, { error: "Teaching isn't set up on this server." });
  const [tokenHash, claimHash] = await Promise.all([hashTeachToken(call.token), hashTeachToken(call.claim)]);
  const refused = (why: TeachRefusal) => json(why === "unknown" ? 404 : 410, { error: TEACH_REFUSED[why], refused: why });

  if (what === "claim") {
    const result = await parts.teach.claim(site.id, tokenHash, claimHash, origin);
    return typeof result === "string" ? refused(result) : json(200, result);
  }
  if (what === "check") {
    const result = await parts.teach.check(site.id, tokenHash, claimHash);
    return typeof result === "string" ? refused(result) : json(200, result);
  }
  if (what === "cancel") {
    const result = await parts.teach.cancel(site.id, tokenHash, claimHash);
    return result === true ? json(200, { ok: true }) : refused(result);
  }
  const steps = stepsToKeep(call.steps);
  if (!steps.length) return json(400, { error: "There are no steps to send. Do the task first." });
  const result = await parts.teach.finish(site.id, tokenHash, claimHash, steps);
  return typeof result === "string" ? refused(result) : json(200, { ok: true, steps: steps.length });
}

// Kept in Neon -------------------------------------------------------------------

interface SessionRow {
  question: string;
  expires_at: string | Date;
  claimed_at?: string | Date | null;
}

const info = (row: SessionRow): TeachSessionInfo => ({ question: row.question, expiresAt: new Date(row.expires_at).toISOString() });

/** Teach sessions in the teach_sessions table (db/migrations/0014_teach_sessions.sql), which the dashboard writes. */
export class NeonTeachStore implements TeachStore {
  private readonly sql: NeonQueryFunction<false, false>;

  constructor(connection: string | NeonQueryFunction<false, false>) {
    this.sql = typeof connection === "string" ? neon(connection) : connection;
  }

  async claim(site: string, tokenHash: string, claimHash: string, origin: string): Promise<TeachSessionInfo | TeachRefusal> {
    const rows = (await this.sql`
      update teach_sessions set claimed_at = now(), claim_hash = ${claimHash}, claimed_origin = ${origin.slice(0, 200)},
        expires_at = now() + ${`${TEACH_MINUTES} minutes`}::interval
      where token_hash = ${tokenHash} and site_id = ${site} and claimed_at is null and finished_at is null and cancelled_at is null and expires_at > now()
      returning question, expires_at`) as SessionRow[];
    if (rows[0]) return info(rows[0]);
    return this.why(site, tokenHash);
  }

  async check(site: string, tokenHash: string, claimHash: string): Promise<TeachSessionInfo | TeachRefusal> {
    const rows = (await this.sql`
      select question, expires_at from teach_sessions
      where token_hash = ${tokenHash} and site_id = ${site} and claim_hash = ${claimHash} and finished_at is null and cancelled_at is null and expires_at > now()`) as SessionRow[];
    return rows[0] ? info(rows[0]) : this.why(site, tokenHash);
  }

  async finish(site: string, tokenHash: string, claimHash: string, steps: TaughtStep[]): Promise<TeachSessionInfo | TeachRefusal> {
    const rows = (await this.sql`
      update teach_sessions set finished_at = now(), steps = ${JSON.stringify(steps)}::jsonb
      where token_hash = ${tokenHash} and site_id = ${site} and claim_hash = ${claimHash} and finished_at is null and cancelled_at is null and expires_at > now()
      returning question, expires_at`) as SessionRow[];
    return rows[0] ? info(rows[0]) : this.why(site, tokenHash);
  }

  async cancel(site: string, tokenHash: string, claimHash: string): Promise<true | TeachRefusal> {
    const rows = await this.sql`
      update teach_sessions set cancelled_at = now()
      where token_hash = ${tokenHash} and site_id = ${site} and claim_hash = ${claimHash} and finished_at is null and cancelled_at is null
      returning id`;
    return rows[0] ? true : this.why(site, tokenHash);
  }

  /** Why a token did not reach an open session. A token of another site is not told apart from one that does not exist. */
  private async why(site: string, tokenHash: string): Promise<TeachRefusal> {
    const [row] = (await this.sql`
      select expires_at < now() as expired, cancelled_at is not null as closed from teach_sessions
      where token_hash = ${tokenHash} and site_id = ${site}`) as { expired: boolean; closed: boolean }[];
    if (!row) return "unknown";
    return row.closed ? "closed" : row.expired ? "expired" : "used";
  }
}

// Kept in memory -----------------------------------------------------------------

interface MemorySession {
  site: string;
  question: string;
  expiresAt: number;
  claimHash?: string;
  finished?: TaughtStep[];
  cancelled?: boolean;
}

/**
 * Teach sessions held in memory, for the Node server on a developer's machine
 * and for tests. The same rules as the table. `now` can be moved by a test.
 */
export class MemoryTeachStore implements TeachStore {
  readonly sessions = new Map<string, MemorySession>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Makes a session, as the dashboard does, and returns its token. */
  async create(site: string, question: string, token: string): Promise<string> {
    this.sessions.set(await hashTeachToken(token), { site, question, expiresAt: this.now() + TEACH_MINUTES * 60_000 });
    return token;
  }

  /** The steps a session's tab posted, by its token. */
  async stepsOf(token: string): Promise<TaughtStep[] | undefined> {
    return this.sessions.get(await hashTeachToken(token))?.finished;
  }

  private open(session: MemorySession | undefined, site: string): session is MemorySession {
    return !!session && session.site === site && !session.finished && !session.cancelled && session.expiresAt > this.now();
  }

  private why(session: MemorySession | undefined, site: string): TeachRefusal {
    if (!session || session.site !== site) return "unknown";
    if (session.cancelled) return "closed";
    return session.expiresAt <= this.now() ? "expired" : "used";
  }

  async claim(site: string, tokenHash: string, claimHash: string): Promise<TeachSessionInfo | TeachRefusal> {
    const session = this.sessions.get(tokenHash);
    if (!this.open(session, site) || session.claimHash) return this.why(session, site);
    session.claimHash = claimHash;
    session.expiresAt = this.now() + TEACH_MINUTES * 60_000;
    return { question: session.question, expiresAt: new Date(session.expiresAt).toISOString() };
  }

  async check(site: string, tokenHash: string, claimHash: string): Promise<TeachSessionInfo | TeachRefusal> {
    const session = this.sessions.get(tokenHash);
    if (!this.open(session, site) || session.claimHash !== claimHash) return this.why(session, site);
    return { question: session.question, expiresAt: new Date(session.expiresAt).toISOString() };
  }

  async finish(site: string, tokenHash: string, claimHash: string, steps: TaughtStep[]): Promise<TeachSessionInfo | TeachRefusal> {
    const known = await this.check(site, tokenHash, claimHash);
    if (typeof known === "string") return known;
    this.sessions.get(tokenHash)!.finished = steps;
    return known;
  }

  async cancel(site: string, tokenHash: string, claimHash: string): Promise<true | TeachRefusal> {
    const session = this.sessions.get(tokenHash);
    if (!session || session.site !== site || session.claimHash !== claimHash || session.finished || session.cancelled) return this.why(session, site);
    session.cancelled = true;
    return true;
  }
}
