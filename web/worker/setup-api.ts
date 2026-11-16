// The dashboard's routes for adding a site one screen at a time, emailing the
// developer, and the numbers at the top of a site's dashboard. Kept apart from
// app-api.ts, which hands these paths over once it knows who is signed in and
// which company they belong to:
//
//   PUT  /api/app/sites/:id/setup            the screen the setup is on, Finish later, or done
//   PUT  /api/app/sites/:id/address          a new address, for a site the script has never called from
//   POST /api/app/sites/:id/developer-email  email the install steps to the company's developer
//   GET  /api/app/sites/:id/metrics?days=    finished guides, finish rate, couldn't guide, time to finish, by day
//
// Where the setup is lives in the site's context, as `setup`, which the widget
// server doesn't read. The emails sent are counted in their own table,
// developer_emails (db/migrations/0013), so deleting a site doesn't reset them.

import { checkAddress, checkEmail, isSetupStep, mailboxOf, NEEDS_SIGN_IN, pageControls, riskyControls, type SetupState } from "../lib/setup";
import type { PageNode, SiteContext } from "../../src/shared/types";
import type { Organization, Sql } from "./db";
import { developerEmail, UnsafeText } from "./developer-email";
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

/** The most install emails in any 24 hours: to one mailbox, however its address is written, */
export const EMAILS_PER_ADDRESS = 3;
/** from one site, */
export const EMAILS_PER_SITE = 10;
/** from one company, across its sites, */
export const EMAILS_PER_COMPANY = 20;
/** and from one person. */
export const EMAILS_PER_PERSON = 10;

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

type SetupContext = SiteContext & { setup?: SetupState };

interface SiteRow {
  id: string;
  origin: string;
  context: SetupContext;
}

const ROUTE = /^\/sites\/(site_[a-z0-9_]{3,40})\/(setup|address|developer-email|metrics)$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** Answers the paths above, or undefined for any other path, which app-api.ts then answers itself. */
export async function setupRoutes(call: SetupRequest): Promise<Answer | undefined> {
  const match = ROUTE.exec(call.path);
  if (!match) return undefined;
  const [, id = "", what] = match;
  const method = call.request.method;
  if (what === "setup" && method === "PUT") return saveSetup(call, id, await body(call.request));
  if (what === "address" && method === "PUT") return changeAddress(call, id, await body(call.request));
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
  if (input.neverTouchSaved === true) patch.neverTouchSaved = true;
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

/**
 * A new address for a site, from the setup's first screen, changed in place so
 * nothing set up is lost: notes, help docs, corrections, Never point at and the
 * setup itself stay, and the site keeps its id, so a tag or a link already sent
 * still works. The old address is replaced in the allowed list, the pages read
 * from it are dropped, and reading starts again from the new one.
 *
 * Only while the script has never called from anywhere. After that the address
 * may be in someone's live tag, so it changes on the dashboard instead, by
 * allowing the new one.
 */
async function changeAddress(call: SetupRequest, id: string, input: Record<string, unknown>): Promise<Answer> {
  const checked = checkAddress(typeof input.url === "string" ? input.url : "");
  if (!checked.ok) return refuse(400, checked.message, "url");
  const site = await siteOf(call.sql, call.org, id);
  if (!site) return refuse(404, "No such site.");
  if (checked.origin === site.origin) return { status: 200, body: { id, origin: site.origin } };
  const reading = { queue: [checked.url], seen: [], failed: [], thin: [], max: site.context.source?.maxPages ?? 30, startedAt: new Date().toISOString() };
  const rows = await call.sql.query(
    `update sites set
      origin = $3,
      allowed_origins = case when $3 = any(allowed_origins) then array_remove(allowed_origins, origin) else array_replace(allowed_origins, origin, $3) end,
      context = jsonb_set(jsonb_set(jsonb_set(context, '{origin}', to_jsonb($3::text)), '{pages}', '[]'::jsonb), '{source}',
        coalesce(context->'source', '{}'::jsonb) || jsonb_build_object('url', $4::text)),
      reading = $5::jsonb,
      updated_at = now()
    where id = $1 and company_id = $2 and not exists (select 1 from site_origins o where o.site_id = $1)
    returning id, origin`,
    [id, call.org.id, checked.origin, checked.url, JSON.stringify(reading)],
  );
  if (!rows[0]) return refuse(409, "Haptic's script has already run for this site, so its address can't change here. Allow the new address under Where Haptic may run on your dashboard.", "url");
  return { status: 200, body: rows[0] };
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

const COPY_INSTEAD = "Copy the link and send it yourself.";
const NOT_SET_UP = `Email isn't set up on this server yet. ${COPY_INSTEAD}`;

/** True for Postgres saying a table or column is missing: a Worker deployed before db/migrations/0013 was applied. */
function notMigrated(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "42P01" || code === "42703";
}

/** Deletes the records of emails sent more than a day ago. Each send does it, and so does the Worker's daily schedule. */
export async function forgetOldEmails(sql: Sql): Promise<void> {
  await sql.query(`delete from developer_emails where sent_at < now() - interval '1 day'`);
}

interface Counts {
  mailbox: number;
  site: number;
  company: number;
  person: number;
}

/** The limit an email would go past, if any, as the sentence to show. The mailbox's is said under the address field. */
function overLimit(counts: Counts): { error: string; field?: string } | undefined {
  if (counts.mailbox >= EMAILS_PER_ADDRESS) return { error: `That address can't be sent more install emails today. ${COPY_INSTEAD}`, field: "to" };
  if (counts.site >= EMAILS_PER_SITE) return { error: `This site has sent ${EMAILS_PER_SITE} install emails today, which is the most for a day. ${COPY_INSTEAD}` };
  if (counts.company >= EMAILS_PER_COMPANY) return { error: `Your company has sent ${EMAILS_PER_COMPANY} install emails today, which is the most for a day. ${COPY_INSTEAD}` };
  if (counts.person >= EMAILS_PER_PERSON) return { error: `You have sent ${EMAILS_PER_PERSON} install emails today, which is the most for a day. ${COPY_INSTEAD}` };
  return undefined;
}

/** The day's counts for one email, worked out in the database. $1 mailbox, $2 site, $3 company, $4 person. */
const COUNTS = `
  count(*) filter (where e.recipient = $1)::int as mailbox,
  count(*) filter (where e.site_id = $2)::int as site,
  count(*) filter (where e.company_id = $3)::int as company,
  count(*) filter (where e.sender = $4)::int as person
  from developer_emails e
  where e.sent_at > now() - interval '1 day' and (e.recipient = $1 or e.company_id = $3 or e.sender = $4)`;

/**
 * Emails the install steps to a developer. Only someone signed in to the
 * company that owns the site gets here. In any 24 hours one mailbox gets at
 * most 3, a site sends 10, a company 20 and one person 10, counted in their
 * own table so deleting a site doesn't reset them.
 *
 * The browser makes a key for each press of Send. It is hashed with the site
 * and the mailbox, so a key sent again with another address is a new email,
 * held to every limit, and only a true retry, the same press to the same
 * address, is let past them. Resend holds the key for a day, so a retry is
 * answered as the first try was, without a second email.
 */
async function emailDeveloper(call: SetupRequest, id: string, input: Record<string, unknown>): Promise<Answer> {
  const { sql, org, user, env } = call;
  const checked = checkEmail(input.to);
  if (!checked.ok) return refuse(400, checked.message, "to");
  if (typeof input.key !== "string" || !KEY.test(input.key)) return refuse(400, "Send a key for this email.");
  const site = await siteOf(sql, org, id);
  if (!site) return refuse(404, "No such site.");
  if (!env.RESEND_API_KEY) return refuse(503, NOT_SET_UP);

  // Made before anything is counted. It names the sender by their sign-in address, never a name they typed.
  const widget = (env.WIDGET_URL ?? "https://widget.joinhaptic.com").replace(/\/$/, "");
  let email: ReturnType<typeof developerEmail>;
  try {
    email = developerEmail({ to: checked.email, sender: { email: user.email }, siteOrigin: site.origin, siteId: site.id, installOrigin: call.url.origin, scriptUrl: `${widget}/widget.js` });
  } catch (error) {
    if (!(error instanceof UnsafeText)) throw error;
    console.error("Refused to send an install email:", error.message);
    return refuse(400, `This email can't be sent from here. ${COPY_INSTEAD}`);
  }

  const mailbox = mailboxOf(checked.email);
  const recipient = await hashOf(`mailbox ${mailbox}`);
  const key = await hashOf(`press ${input.key} ${site.id} ${mailbox}`);
  try {
    const seen = await sql.query(`select 1 from developer_emails where key = $1`, [key]);
    if (!seen.length) {
      // Said plainly first. Then checked again as the row is written, after taking the locks for this
      // company and this mailbox, so presses at the same moment, here or at another company, take turns.
      const counts = ((await sql.query(`select ${COUNTS}`, [recipient, site.id, org.id, user.id]))[0] ?? {}) as Counts;
      const over = overLimit(counts);
      if (over) return refuse(429, over.error, over.field);
      const [, , kept] = await sql.transaction([
        sql.query(`select pg_advisory_xact_lock(hashtext('developer-email company ' || $1)), pg_advisory_xact_lock(hashtext('developer-email mailbox ' || $2))`, [org.id, recipient]),
        sql.query(`delete from developer_emails where sent_at < now() - interval '1 day'`),
        sql.query(
          `insert into developer_emails (key, company_id, site_id, sender, recipient)
          select $5, $3, $2, $4, $1 from (select ${COUNTS}) counts
          where counts.mailbox < $6 and counts.site < $7 and counts.company < $8 and counts.person < $9
          on conflict (key) do nothing
          returning key`,
          [recipient, site.id, org.id, user.id, key, EMAILS_PER_ADDRESS, EMAILS_PER_SITE, EMAILS_PER_COMPANY, EMAILS_PER_PERSON],
        ),
      ]);
      if (!(kept as unknown[]).length) return refuse(429, "Too many emails at once. Wait a moment and try again.");
    }
  } catch (error) {
    if (!notMigrated(error)) throw error;
    console.error("Install emails need db/migrations/0013, which isn't applied yet.");
    return refuse(503, NOT_SET_UP);
  }

  const sent = await sendEmail(env, email, `developer-email/${site.id}/${key}`, call.fetcher ?? ((input, init) => fetch(input, init)));
  // 409: Resend has a request with this key already, which only an email already handed over can have made.
  // Bound to the address as the key is, that was this email, so it went: it stays counted and is said to have gone.
  if (!sent.ok && sent.status === 409) console.log("Resend already has this install email.", sent.detail);
  else if (!sent.ok) {
    console.error("The install email was not sent:", sent.status, sent.detail);
    // Nothing went out, so it doesn't count against the day's emails.
    await sql.query(`delete from developer_emails where key = $1`, [key]).catch((error: Error) => console.error("Could not take back the unsent email:", error.message));
    const why = sent.status === 0 ? "The email service could not be reached." : `The email service turned it down, with status ${sent.status}.`;
    return refuse(502, `${why} ${COPY_INSTEAD}`);
  }
  if (sent.ok) console.log("Sent an install email.", sent.id);
  return { status: 200, body: { sent: true, to: checked.email } };
}
