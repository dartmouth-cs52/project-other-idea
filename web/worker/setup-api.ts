// The dashboard's routes for adding a site one screen at a time, emailing the
// developer, and the numbers at the top of a site's dashboard. Kept apart from
// app-api.ts, which hands these paths over once it knows who is signed in and
// which company they belong to:
//
//   PUT  /api/app/sites/:id/setup            the screen the setup is on, Finish later, or done
//   POST /api/app/sites/:id/developer-email  email the install steps to the company's developer
//   GET  /api/app/sites/:id/metrics?days=    finished guides, finish rate, couldn't guide, time to finish, by day
//
// What the setup and the emails sent need to remember lives in the site's
// context, as `setup` and `developerEmails`, so no table has to be added first.
// The widget server reads neither.

import { checkEmail, isSetupStep, NEEDS_SIGN_IN, pageControls, riskyControls, type SetupState } from "../lib/setup";
import type { PageNode, SiteContext } from "../../src/shared/types";
import type { Organization, Sql } from "./db";
import { developerEmail } from "./developer-email";
import { headline } from "./insights";
import { sendEmail, type SendEnv } from "./sign-in-email";

// This file imports nothing that needs web/'s own packages (auth.ts needs
// @neon/auth, reader.ts needs @cloudflare/puppeteer), so the tests at the top
// of the repository can load it with the root install alone, as CI does. The
// two shapes it needs from those files are named here instead.

/** Who is signed in, as worker/auth.ts's SignedInUser gives it. */
interface Caller {
  id: string;
  email: string;
  name: string;
}

/** The parts of a reading (worker/reader.ts) that readingExtras looks at. */
interface ReadingSoFar {
  thin: string[];
  failed: { url: string; reason: string }[];
}

/** At most this many install emails per site in any 24 hours. */
export const EMAILS_PER_SITE = 10;
/** And at most this many to one address. */
export const EMAILS_PER_ADDRESS = 3;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SetupEnv extends SendEnv {
  WIDGET_URL?: string;
}

export interface SetupRequest {
  request: Request;
  env: SetupEnv;
  sql: Sql;
  org: Organization;
  user: Caller;
  /** The path after /api/app, such as /sites/site_abc/setup. */
  path: string;
  url: URL;
  /** Resend is called through this. Tests pass their own. */
  fetcher?: Fetch;
}

export type Answer = { status: number; body: unknown };

/** One email sent from a site, as kept in its context. `to` is a hash: the address itself is not kept. */
interface SentEmail {
  at: string;
  to: string;
  key: string;
}

type SetupContext = SiteContext & { setup?: SetupState; developerEmails?: SentEmail[] };

interface SiteRow {
  id: string;
  origin: string;
  context: SetupContext;
}

const ROUTE = /^\/sites\/(site_[a-z0-9_]{3,40})\/(setup|developer-email|metrics)$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** Answers the paths above, or undefined for any other path, which app-api.ts then answers itself. */
export async function setupRoutes(call: SetupRequest): Promise<Answer | undefined> {
  const match = ROUTE.exec(call.path);
  if (!match) return undefined;
  const [, id = "", what] = match;
  const method = call.request.method;
  if (what === "setup" && method === "PUT") return saveSetup(call, id, await body(call.request));
  if (what === "developer-email" && method === "POST") return emailDeveloper(call, id, await body(call.request));
  if (what === "metrics" && method === "GET") {
    if (!(await siteOf(call.sql, call.org, id))) return refuse(404, "No such site.");
    const days = Math.min(Math.max(Number(call.url.searchParams.get("days")) || 30, 1), 365);
    return { status: 200, body: await headline(call.sql, id, days) };
  }
  return undefined;
}

function refuse(status: number, error: string, field?: string): Answer {
  return { status, body: field ? { error, field } : { error } };
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 4_000) return {};
  try {
    const value = JSON.parse(text || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A site, only if it belongs to the caller's company. A site id alone, which is public, is never enough. */
async function siteOf(sql: Sql, org: Organization, id: string): Promise<SiteRow | undefined> {
  const rows = (await sql.query(`select id, origin, context from sites where id = $1 and company_id = $2`, [id, org.id])) as SiteRow[];
  return rows[0];
}

// Where the setup is ----------------------------------------------------------

async function saveSetup(call: SetupRequest, id: string, input: Record<string, unknown>): Promise<Answer> {
  const patch: Partial<SetupState> = {};
  if (input.step !== undefined) {
    if (!isSetupStep(input.step)) return refuse(400, "That isn't a step of the setup.");
    patch.step = input.step;
  }
  if (typeof input.later === "boolean") patch.later = input.later;
  if (input.finished === true) patch.finishedAt = new Date().toISOString();
  if (!Object.keys(patch).length) return refuse(400, "Say which step, or Finish later.");
  // Only the setup changes, so a page read finishing meanwhile keeps its pages.
  const rows = (await call.sql.query(
    `update sites set context = jsonb_set(context, '{setup}', coalesce(context->'setup', '{}'::jsonb) || $3::jsonb)
    where id = $1 and company_id = $2 returning context->'setup' as setup`,
    [id, call.org.id, JSON.stringify(patch)],
  )) as { setup: SetupState }[];
  if (!rows[0]) return refuse(404, "No such site.");
  return { status: 200, body: { setup: rows[0].setup } };
}

/** The setup as the dashboard reads it with the site. Null for a site added before there were setup screens. */
export function setupOf(context: SiteContext): SetupState | null {
  return (context as SetupContext).setup ?? null;
}

/**
 * More of what the reading found, for the reading screen and "Never touch":
 * how many controls, how many pages seem to need signing in, and the controls
 * that look like they delete, pay or hand something over.
 */
export function readingExtras(reading: ReadingSoFar, pages: PageNode[]) {
  return {
    controls: pages.reduce((sum, page) => sum + pageControls(page), 0),
    signIn: reading.thin.length + reading.failed.filter((failure) => NEEDS_SIGN_IN.test(failure.reason)).length,
    risky: riskyControls(pages),
  };
}

// Emailing the developer ------------------------------------------------------

async function hashOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** The emails a site sent in the last 24 hours. */
function recentEmails(context: SetupContext, now: number): SentEmail[] {
  const sent = Array.isArray(context.developerEmails) ? context.developerEmails : [];
  return sent.filter((item) => typeof item?.at === "string" && now - Date.parse(item.at) < 86_400_000);
}

/**
 * Emails the install steps to a developer. Only someone signed in to the
 * company that owns the site gets here. Each site may send 10 a day, and 3 to
 * one address. The browser makes a key for each press of Send, so a retry of
 * the same press never sends twice: the key is kept with the email, and Resend
 * holds it for a day too.
 */
async function emailDeveloper(call: SetupRequest, id: string, input: Record<string, unknown>): Promise<Answer> {
  const { sql, org, user, env } = call;
  const checked = checkEmail(input.to);
  if (!checked.ok) return refuse(400, checked.message, "to");
  if (typeof input.key !== "string" || !KEY.test(input.key)) return refuse(400, "Send a key for this email.");
  const key = input.key;
  const site = await siteOf(sql, org, id);
  if (!site) return refuse(404, "No such site.");
  if (!env.RESEND_API_KEY) return refuse(503, "Email isn't set up on this server yet. Copy the link and send it yourself.");

  const to = await hashOf(`${site.id} ${checked.email}`);
  const recent = recentEmails(site.context, Date.now());
  const again = recent.some((item) => item.key === key);
  if (!again) {
    if (recent.length >= EMAILS_PER_SITE) return refuse(429, `This site has sent ${EMAILS_PER_SITE} install emails today, which is the most for a day. Copy the link and send it yourself.`);
    if (recent.filter((item) => item.to === to).length >= EMAILS_PER_ADDRESS) {
      return refuse(429, `${checked.email} has had ${EMAILS_PER_ADDRESS} emails about this site today. Copy the link and send it yourself.`, "to");
    }
    // The limits are checked again as the row is written, so two presses at once can't both slip under them.
    const kept = await sql.query(
      `update sites set context = jsonb_set(context, '{developerEmails}',
        coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(context->'developerEmails', '[]'::jsonb)) e
          where (e->>'at')::timestamptz > now() - interval '1 day'), '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('at', now(), 'to', $3::text, 'key', $4::text)))
      where id = $1 and company_id = $2
        and (select count(*) from jsonb_array_elements(coalesce(context->'developerEmails', '[]'::jsonb)) e
          where (e->>'at')::timestamptz > now() - interval '1 day') < $5
        and (select count(*) from jsonb_array_elements(coalesce(context->'developerEmails', '[]'::jsonb)) e
          where (e->>'at')::timestamptz > now() - interval '1 day' and e->>'to' = $3::text) < $6
        and not exists (select 1 from jsonb_array_elements(coalesce(context->'developerEmails', '[]'::jsonb)) e where e->>'key' = $4::text)
      returning id`,
      [site.id, org.id, to, key, EMAILS_PER_SITE, EMAILS_PER_ADDRESS],
    );
    if (!kept.length) return refuse(429, "Too many emails at once. Wait a moment and try again.");
  }

  const widget = (env.WIDGET_URL ?? "https://widget.joinhaptic.com").replace(/\/$/, "");
  const email = developerEmail({
    to: checked.email,
    sender: { email: user.email, name: user.name },
    siteOrigin: site.origin,
    siteId: site.id,
    installOrigin: call.url.origin,
    scriptUrl: `${widget}/widget.js`,
  });
  const sent = await sendEmail(env, email, `developer-email/${site.id}/${key}`, call.fetcher ?? ((input, init) => fetch(input, init)));
  if (!sent.ok) {
    console.error("The install email was not sent:", sent.status, sent.detail);
    // Nothing went out, so it doesn't count against the day's emails.
    await sql
      .query(
        `update sites set context = jsonb_set(context, '{developerEmails}',
          coalesce((select jsonb_agg(e) from jsonb_array_elements(context->'developerEmails') e where e->>'key' <> $3::text), '[]'::jsonb))
        where id = $1 and company_id = $2 and jsonb_typeof(context->'developerEmails') = 'array'`,
        [site.id, org.id, key],
      )
      .catch((error: Error) => console.error("Could not take back the unsent email:", error.message));
    const why = sent.status === 0 ? "The email service could not be reached." : `The email service turned it down, with status ${sent.status}.`;
    return refuse(502, `${why} Copy the link and send it yourself.`);
  }
  console.log("Sent an install email.", sent.id);
  return { status: 200, body: { sent: true, to: checked.email } };
}
