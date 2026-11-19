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
import { boundedText } from "./body";
import { notMigrated, type Organization, type Sql } from "./db";
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

/** The most install emails in any 24 hours: from one company to one mailbox, however its address is written, */
export const EMAILS_PER_ADDRESS = 3;
/** to one mailbox from everyone together, */
export const EMAILS_PER_MAILBOX = 6;
/** from one site, */
export const EMAILS_PER_SITE = 10;
/** from one company, across its sites, */
export const EMAILS_PER_COMPANY = 20;
/** and from one person. */
export const EMAILS_PER_PERSON = 10;
/**
 * The most presses one person may have reach Resend in any hour, sent or turned down. An email Resend turns
 * down isn't counted above, so without this a person could press Send against a failing Resend for ever, on
 * the account the sign-in email uses.
 */
export const TRIES_PER_PERSON = 30;

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
/** The ranges the dashboard's top numbers come for, in days. */
const RANGES = [7, 30, 90];

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
    // The dashboard offers these three. Anything else, a fraction included, is a mistake to say so about.
    const days = Number(call.url.searchParams.get("days"));
    if (!RANGES.includes(days)) return refuse(400, "Ask for 7, 30 or 90 days.");
    if (!(await siteOf(call.sql, call.org, id))) return refuse(404, "No such site.");
    return { status: 200, body: await headline(call.sql, id, days) };
  }
  return undefined;
}

function refuse(status: number, error: string, field?: string): Answer {
  return { status, body: field ? { error, field } : { error } };
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await boundedText(request, 4_000);
  if (text === null) return {};
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
 * Only while the script has never called from an address the site allows. After
 * that the address may be in someone's live tag, so it changes on the dashboard
 * instead, by allowing the new one. A call from an address the site doesn't
 * allow is not counted: nothing is live there to break, and anyone who knows
 * the site's id can send one with a made-up Origin, which would otherwise stop
 * the company changing its address here. A made-up call that names the address
 * the site allows still counts, since nothing tells it from the script's own,
 * and no later sign is harder to make up: whoever knows the site's id and
 * guesses its address can end the change here, and the dashboard's way is left.
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
    where id = $1 and company_id = $2 and not exists (select 1 from site_origins o where o.site_id = $1 and o.allowed)
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

/** Deletes the records of emails sent more than a day ago. Each send does it, and so does the Worker's daily schedule. */
export async function forgetOldEmails(sql: Sql): Promise<void> {
  await sql.query(`delete from developer_emails where sent_at < now() - interval '1 day'`);
}

interface Counts {
  mailbox: number;
  everyone: number;
  site: number;
  company: number;
  person: number;
}

/**
 * Every limit says the same, naming no cause. A company told "that address has had its emails" would learn
 * that another company emailed it today.
 */
const LIMIT = "You've reached today's limit for install emails. Copy the link instead.";

function overLimit(counts: Counts): boolean {
  return (
    counts.mailbox >= EMAILS_PER_ADDRESS ||
    counts.everyone >= EMAILS_PER_MAILBOX ||
    counts.site >= EMAILS_PER_SITE ||
    counts.company >= EMAILS_PER_COMPANY ||
    counts.person >= EMAILS_PER_PERSON
  );
}

/** The day's counts for one email, worked out in the database. $1 mailbox, $2 site, $3 company, $4 person. */
const COUNTS = `
  count(*) filter (where e.recipient = $1 and e.company_id = $3)::int as mailbox,
  count(*) filter (where e.recipient = $1)::int as everyone,
  count(*) filter (where e.site_id = $2)::int as site,
  count(*) filter (where e.company_id = $3)::int as company,
  count(*) filter (where e.sender = $4)::int as person
  from developer_emails e
  where e.kind = 'email' and e.sent_at > now() - interval '1 day' and (e.recipient = $1 or e.company_id = $3 or e.sender = $4)`;

/** How long a press left pending waits before it may be tried again, once. Longer than any request to Resend takes. */
const PENDING_RETRY_AFTER = "1 minute";

/** A press already counted: sent, or pending and maybe being sent right now. */
interface Press {
  state: "pending" | "sent";
}

async function pressOf(sql: Sql, key: string): Promise<Press | undefined> {
  return ((await sql.query(`select state from developer_emails where key = $1`, [key])) as Press[])[0];
}

/**
 * Emails the install steps to a developer. Only someone signed in to the
 * company that owns the site gets here. In any 24 hours a company sends one
 * mailbox at most 3 and everyone together 6, a site sends 10, a company 20 and
 * one person 10, counted in their own table so deleting a site doesn't reset
 * them. A refusal names no cause.
 *
 * The browser makes a key for each press of Send, hashed here with the site
 * and the mailbox, so the same key with another address is another email, held
 * to every limit. A press is counted as pending before it goes to Resend, and
 * marked sent once Resend has it. A retry of a press already sent is answered
 * from that record and never goes to Resend. Only the request that counted an
 * email may take it off the count, and only when its own send failed. A press
 * left pending, by a request cut off between counting and sending, may be
 * tried once more after a minute, with the same key, so Resend sends it only
 * if the first never reached it. Whatever happens then, it stays counted.
 *
 * Every press that is about to reach Resend is also a try, kept whether it is
 * sent or turned down, and one person gets 30 tries in any hour. Past that the
 * press is refused like any limit, and what it counted or claimed is given back.
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
  const sentAnswer: Answer = { status: 200, body: { sent: true, to: checked.email } };
  /** True when this request counted the email, and so may take it off if its own send fails. */
  let counted = false;
  /** True when this request claimed a pending press's one retry. */
  let claimed = false;
  try {
    let press = await pressOf(sql, key);
    if (!press) {
      // Said plainly first. Then checked again as the row is written, after taking the locks for this
      // company and this mailbox, so presses at the same moment, here or at another company, take turns.
      const counts = ((await sql.query(`select ${COUNTS}`, [recipient, site.id, org.id, user.id]))[0] ?? {}) as Counts;
      if (overLimit(counts)) return refuse(429, LIMIT);
      const [, , kept] = await sql.transaction([
        sql.query(`select pg_advisory_xact_lock(hashtext('developer-email company ' || $1)), pg_advisory_xact_lock(hashtext('developer-email mailbox ' || $2))`, [org.id, recipient]),
        sql.query(`delete from developer_emails where sent_at < now() - interval '1 day'`),
        sql.query(
          `insert into developer_emails (key, company_id, site_id, sender, recipient)
          select $5, $3, $2, $4, $1 from (select ${COUNTS}) counts
          where counts.mailbox < $6 and counts.everyone < $7 and counts.site < $8 and counts.company < $9 and counts.person < $10
          on conflict (key) do nothing
          returning key`,
          [recipient, site.id, org.id, user.id, key, EMAILS_PER_ADDRESS, EMAILS_PER_MAILBOX, EMAILS_PER_SITE, EMAILS_PER_COMPANY, EMAILS_PER_PERSON],
        ),
      ]);
      counted = (kept as unknown[]).length > 0;
      // Not written: a limit was reached meanwhile, or the same press got there first.
      if (!counted) press = await pressOf(sql, key);
      if (!counted && !press) return refuse(429, LIMIT);
    }
    if (!counted) {
      if (press!.state === "sent") return sentAnswer;
      // Pending: being sent by another request right now, or left by one cut off before it heard back.
      const retry = await sql.query(
        `update developer_emails set retried = true
        where key = $1 and state = 'pending' and not retried and sent_at < now() - interval '${PENDING_RETRY_AFTER}'
        returning key`,
        [key],
      );
      if (!retry.length) return refuse(409, `This email is on its way, or may have gone already. If it doesn't arrive, ${COPY_INSTEAD.charAt(0).toLowerCase()}${COPY_INSTEAD.slice(1)}`);
      claimed = true;
    }
    // This press will reach Resend, so it is a try, if the person has a try left this hour. Checked as the row is
    // written, after this person's lock, so presses at the same moment take turns.
    const [, tried] = await sql.transaction([
      sql.query(`select pg_advisory_xact_lock(hashtext('developer-email person ' || $1))`, [user.id]),
      sql.query(
        `insert into developer_emails (key, kind, company_id, site_id, sender, recipient)
        select $1, 'try', $2, $3, $4, $5
        where (select count(*) from developer_emails t where t.kind = 'try' and t.sender = $4 and t.sent_at > now() - interval '1 hour') < $6
        on conflict (key) do nothing
        returning key`,
        [`try ${crypto.randomUUID()}`, org.id, site.id, user.id, recipient, TRIES_PER_PERSON],
      ),
    ]);
    if (!(tried as unknown[]).length) {
      // Nothing goes to Resend, so what this request counted comes off, and a claimed retry is left for later.
      if (counted) await sql.query(`delete from developer_emails where key = $1 and state = 'pending' and not retried`, [key]);
      if (claimed) await sql.query(`update developer_emails set retried = false where key = $1 and state = 'pending'`, [key]);
      return refuse(429, LIMIT);
    }
  } catch (error) {
    if (!notMigrated(error)) throw error;
    console.error("Install emails need db/migrations/0013, which isn't applied yet.");
    return refuse(503, NOT_SET_UP);
  }

  const sent = await sendEmail(env, email, `developer-email/${site.id}/${key}`, call.fetcher ?? ((input, init) => fetch(input, init)));
  // 409: Resend has a request with this key already, which only an email already handed over can have made.
  // Bound to the address as the key is, that was this email, so it went.
  if (sent.ok || sent.status === 409) {
    if (sent.ok) console.log("Sent an install email.", sent.id);
    else console.log("Resend already has this install email.", sent.detail);
    await sql.query(`update developer_emails set state = 'sent' where key = $1`, [key]).catch((error: Error) => console.error("Could not mark the install email sent:", error.message));
    return sentAnswer;
  }
  console.error("The install email was not sent:", sent.status, sent.detail);
  // This request counted it and its own send failed, so nothing went out: it comes off the count. A retry of a
  // press another request counted never takes it off, whatever Resend says, because that one may have gone.
  if (counted) {
    await sql
      .query(`delete from developer_emails where key = $1 and state = 'pending' and not retried`, [key])
      .catch((error: Error) => console.error("Could not take back the unsent email:", error.message));
  }
  const why = sent.status === 0 ? "The email service could not be reached." : `The email service turned it down, with status ${sent.status}.`;
  return refuse(502, `${why} ${COPY_INSTEAD}`);
}
