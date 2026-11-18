// Neon Auth's webhook, which lets Haptic send its own sign-in email.
//
// While the webhook is switched on for the send.magic_link event, Neon does not
// send its own email. It POSTs the link here instead, and waits up to 15 seconds,
// over at most 3 tries, for a 2xx. If none comes, the person's sign-in fails, so
// this answers quickly and only says yes once the email is handed to Resend.
//
// Every request is signed by Neon with an Ed25519 key it publishes at
// <NEON_AUTH_URL>/.well-known/jwks.json, as a detached JWS that also covers the
// timestamp. Only the body and the timestamp are signed, so the event's type and
// id are read from the body, never from the other headers.
// See https://neon.com/docs/auth/guides/webhooks
//
// Anyone can ask for a sign-in link for any address, on the sign-in page or
// straight from Neon, past any limit this Worker keeps on its own pages. So each
// email is counted here before it goes, in sign_in_emails (db/migrations/0017),
// and one mailbox gets at most 5 an hour, and the site sends at most 300.

import { mailboxOf } from "../lib/setup";
import { boundedText } from "./body";
import { database, notMigrated, type Sql } from "./db";
import { sendEmail, signInEmail, type LinkType, type SendEnv } from "./sign-in-email";

export interface HookEnv extends SendEnv {
  /** Neon Auth's address for the branch, ending in /neondb/auth. Its signing keys are published under it. */
  NEON_AUTH_URL?: string;
  /** Where the emails sent are counted. */
  DATABASE_URL?: string;
}

export const HOOK_PATH = "/api/neon-auth-hook";

/** The most sign-in emails one mailbox gets in any hour, however its address is written. */
export const EMAILS_PER_MAILBOX = 5;
/** The most the site sends in any hour, to everyone together. */
export const EMAILS_PER_HOUR = 300;

/** Older than this, a request could be a replay, so it is turned away. */
const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_BODY = 64 * 1024;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface HookDeps {
  fetch: Fetch;
  now: () => number;
  /** Where the emails are counted. Without it, DATABASE_URL's database is, and with neither nothing is. */
  sql?: Sql;
}

interface MagicLinkEvent {
  event_id: string;
  event_type: string;
  user?: { email?: string };
  event_data?: { link_type?: string; link_url?: string };
}

/** Answers Neon's webhook. Neon retries a 5xx, 408 or 429 at once, and gives up on any other 4xx. */
export async function neonHook(request: Request, env: HookEnv, deps: HookDeps = { fetch: (input, init) => fetch(input, init), now: Date.now }): Promise<Response> {
  if (request.method !== "POST") return reply(405, "Use POST.");
  if (!env.NEON_AUTH_URL) return reply(503, "Sign-in is not set up on this server.");

  const raw = await boundedText(request, MAX_BODY);
  if (raw === null) return reply(413, "That is too long.");
  let checked: Awaited<ReturnType<typeof verifyNeonSignature>>;
  try {
    checked = await verifyNeonSignature(raw, request.headers, keysFor(env.NEON_AUTH_URL, deps.fetch), deps.now());
  } catch (error) {
    // Neon's keys could not be fetched. That can pass, so Neon is asked to try again.
    console.error("Could not fetch Neon Auth's signing keys:", (error as Error).message);
    return reply(503, "Could not check the signature yet.");
  }
  if (!checked.ok) {
    console.error("Turned away a Neon Auth webhook:", checked.reason);
    return reply(401, checked.reason);
  }

  let event: MagicLinkEvent;
  try {
    event = JSON.parse(raw) as MagicLinkEvent;
  } catch {
    return reply(400, "That was not valid JSON.");
  }
  // Haptic only subscribes to send.magic_link. Anything else would otherwise be dropped without a word,
  // so it is refused, and Neon's log shows why.
  if (event.event_type !== "send.magic_link") return reply(422, `Haptic does not handle ${String(event.event_type)}.`);

  const to = event.user?.email?.trim();
  const link = event.event_data?.link_url;
  if (!to || !link || !isHttps(link) || typeof event.event_id !== "string") return reply(400, "The event is missing its address or link.");

  // Past a limit, the event is answered as handled, so Neon doesn't try it again, and nothing is sent.
  const sql = deps.sql ?? (env.DATABASE_URL ? database(env.DATABASE_URL) : undefined);
  if (sql && (await counted(sql, event.event_id, to)) === "over") {
    console.warn(`Did not send the sign-in email for event ${event.event_id}: its mailbox, or the site, has had as many as it may this hour.`);
    return reply(200, "Not sent: over the limit for sign-in emails.");
  }

  const email = signInEmail({ to, link, type: (event.event_data?.link_type ?? "sign-in") as LinkType, id: event.event_id });
  // Neon resends the same event id when a try fails or times out. Resend keeps the key for 24 hours and sends once.
  const sent = await sendEmail(env, email, `neon-auth/${event.event_id}`, deps.fetch);
  if (!sent.ok) {
    console.error("The sign-in email was not sent:", sent.status, sent.detail);
    // Any failure is worth one more try, and the idempotency key keeps a retry from sending twice.
    return reply(sent.status === 0 ? 503 : 502, "The email could not be sent.");
  }
  console.log("Sent a sign-in email.", sent.id);
  return reply(200, "Sent.");
}

function reply(status: number, message: string): Response {
  return Response.json({ message }, { status, headers: { "cache-control": "no-store" } });
}

// ---------------------------------------------------------------------------
// Limits

/**
 * Counts a sign-in email before it is sent. "send" when it was counted now; "again" for an event already
 * counted, which Neon sends again when a try failed, and which Resend's idempotency key keeps to one email;
 * "over" when the mailbox or the site has had all it may this hour. The limits are checked as the row is
 * written, under one lock for every sign-in email, so emails at the same moment take turns.
 *
 * Sign-in matters more than the count, so when the count can't be kept, because the database is down or
 * its migration isn't applied yet, the email is sent, and the log says so.
 */
async function counted(sql: Sql, eventId: string, to: string): Promise<"send" | "again" | "over"> {
  try {
    const recipient = await mailboxHash(to);
    const [, , kept] = await sql.transaction([
      sql.query(`select pg_advisory_xact_lock(hashtext('sign-in-email'))`),
      sql.query(`delete from sign_in_emails where sent_at < now() - interval '1 day'`),
      sql.query(
        `insert into sign_in_emails (event_id, recipient)
        select $1, $2
        where (select count(*) from sign_in_emails where recipient = $2 and sent_at > now() - interval '1 hour') < $3
          and (select count(*) from sign_in_emails where sent_at > now() - interval '1 hour') < $4
        on conflict (event_id) do nothing
        returning event_id`,
        [eventId, recipient, EMAILS_PER_MAILBOX, EMAILS_PER_HOUR],
      ),
    ]);
    if ((kept as unknown[]).length) return "send";
    return (await sql.query(`select 1 from sign_in_emails where event_id = $1`, [eventId])).length ? "again" : "over";
  } catch (error) {
    if (notMigrated(error)) console.error("Sign-in emails are counted once db/migrations/0017 is applied. Until then they are sent uncounted.");
    else console.error("Could not count a sign-in email, so it was sent uncounted:", (error as Error).message);
    return "send";
  }
}

/** A mailbox, written one way however its address is, as a hash: the address itself is never kept. */
async function mailboxHash(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`sign-in mailbox ${mailboxOf(email)}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** Deletes the records of sign-in emails sent more than a day ago. Each email does it, and so does the Worker's daily schedule. */
export async function forgetOldSignInEmails(sql: Sql): Promise<void> {
  await sql.query(`delete from sign_in_emails where sent_at < now() - interval '1 day'`);
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Signature

export type KeyLookup = (kid: string) => Promise<CryptoKey | undefined>;

/**
 * Checks Neon's detached JWS. The signing input is the JWS header, a period, and
 * base64url(timestamp + "." + base64url(body)): the body is encoded twice because
 * the timestamp is bound into the signed payload.
 */
export async function verifyNeonSignature(raw: string, headers: Headers, keyFor: KeyLookup, now: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  const signature = headers.get("x-neon-signature") ?? "";
  const kid = headers.get("x-neon-signature-kid") ?? "";
  const timestamp = headers.get("x-neon-timestamp") ?? "";
  if (!signature || !kid || !/^\d{10,16}$/.test(timestamp)) return { ok: false, reason: "The signature headers are missing." };

  const age = now - Number(timestamp);
  if (Math.abs(age) > MAX_AGE_MS) return { ok: false, reason: "The request is too old, or from the future." };

  const parts = signature.split(".");
  if (parts.length !== 3 || parts[1] !== "") return { ok: false, reason: "The signature is not a detached JWS." };
  const [header, , sig] = parts as [string, string, string];
  let protectedHeader: { alg?: string; kid?: string };
  try {
    protectedHeader = JSON.parse(decoder.decode(fromBase64url(header))) as { alg?: string; kid?: string };
  } catch {
    return { ok: false, reason: "The signature's header could not be read." };
  }
  // The header is signed, so its kid, when it has one, must agree with the unsigned one used to find the key.
  if (protectedHeader.alg !== "EdDSA" || (protectedHeader.kid && protectedHeader.kid !== kid)) return { ok: false, reason: "The signature's header does not match." };

  const key = await keyFor(kid);
  if (!key) return { ok: false, reason: `No signing key ${kid}.` };

  const payload = base64url(encoder.encode(`${timestamp}.${base64url(encoder.encode(raw))}`));
  let signatureBytes: Uint8Array<ArrayBuffer>;
  try {
    signatureBytes = fromBase64url(sig);
  } catch {
    return { ok: false, reason: "The signature could not be read." };
  }
  const valid = await crypto.subtle.verify({ name: "Ed25519" }, key, signatureBytes, encoder.encode(`${header}.${payload}`));
  return valid ? { ok: true } : { ok: false, reason: "The signature does not match." };
}

interface Jwk {
  kid?: string;
  kty?: string;
  crv?: string;
  x?: string;
  alg?: string;
}

/** Each isolate keeps Neon's keys, and looks again when a key it has not seen turns up, at most every 10 seconds. */
const keyCache = new Map<string, { keys: Map<string, CryptoKey>; fetchedAt: number }>();
const REFETCH_MS = 10_000;

/** Finds the key for a kid. Throws when the keys cannot be fetched, which is worth a retry, unlike an unknown kid. */
export function keysFor(authUrl: string, fetcher: Fetch): KeyLookup {
  const url = `${authUrl.replace(/\/+$/, "")}/.well-known/jwks.json`;
  return async (kid) => {
    const held = keyCache.get(url);
    if (held?.keys.has(kid)) return held.keys.get(kid);
    if (held && Date.now() - held.fetchedAt < REFETCH_MS) return undefined;
    const response = await fetcher(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`The key list answered ${response.status}.`);
    const { keys = [] } = (await response.json()) as { keys?: Jwk[] };
    const imported = new Map<string, CryptoKey>();
    for (const jwk of keys) {
      if (!jwk.kid || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) continue;
      imported.set(jwk.kid, await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, { name: "Ed25519" }, false, ["verify"]));
    }
    keyCache.set(url, { keys: imported, fetchedAt: Date.now() });
    return imported.get(kid);
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("Not base64url.");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
