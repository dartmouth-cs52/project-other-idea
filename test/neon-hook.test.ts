import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../web/worker/db";
import { base64url, EMAILS_PER_HOUR, EMAILS_PER_MAILBOX, forgetOldSignInEmails, neonHook, verifyNeonSignature, type KeyLookup } from "../web/worker/neon-hook";
import { FROM, REPLY_TO, signInEmail } from "../web/worker/sign-in-email";
import { exec, freshDatabase, psqlSql, TEST_DATABASE_URL, testDatabase } from "./psql.ts";

/** This file's own database, when TEST_DATABASE_URL is set. */
const DB = testDatabase("sign_in_emails");

// Signs a body the way Neon Auth does: a detached JWS whose payload is
// base64url(timestamp + "." + base64url(body)).
async function neonKey() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const kid = crypto.randomUUID();
  const encode = (text: string) => new TextEncoder().encode(text);
  async function sign(body: string, timestamp: number, header: object = { alg: "EdDSA", typ: "JWS", kid }) {
    const head = base64url(encode(JSON.stringify(header)));
    const payload = base64url(encode(`${timestamp}.${base64url(encode(body))}`));
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, encode(`${head}.${payload}`)));
    return new Headers({
      "content-type": "application/json",
      "x-neon-signature": `${head}..${base64url(signature)}`,
      "x-neon-signature-kid": kid,
      "x-neon-timestamp": String(timestamp),
      "x-neon-event-type": "send.magic_link",
      "x-neon-event-id": "ignored",
      "x-neon-delivery-attempt": "1",
    });
  }
  const lookup: KeyLookup = async (asked) => (asked === kid ? pair.publicKey : undefined);
  return { kid, jwk: { ...jwk, kid, alg: "EdDSA" }, sign, lookup };
}

const NOW = 1_800_000_000_000;
const event = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    event_id: "550e8400-e29b-41d4-a716-446655440000",
    event_type: "send.magic_link",
    timestamp: new Date(NOW).toISOString(),
    user: { email: "ada@acme.com" },
    event_data: { link_type: "sign-in", link_url: "https://auth.example/magic-link/verify?token=abc&callbackURL=https%3A%2F%2Fjoinhaptic.com%2Fdashboard%2F", token: "abc" },
    ...overrides,
  });

test("a body signed the way Neon signs it passes", async () => {
  const key = await neonKey();
  const body = event();
  assert.deepEqual(await verifyNeonSignature(body, await key.sign(body, NOW), key.lookup, NOW), { ok: true });
});

test("a changed body, an old or future timestamp, another key or another algorithm is turned away", async () => {
  const key = await neonKey();
  const body = event();
  const headers = await key.sign(body, NOW);

  const changed = await verifyNeonSignature(body.replace("ada@", "eve@"), headers, key.lookup, NOW);
  assert.equal(changed.ok, false);

  // The timestamp is signed, so moving it to look fresh breaks the signature.
  const moved = new Headers(headers);
  moved.set("x-neon-timestamp", String(NOW + 1));
  assert.equal((await verifyNeonSignature(body, moved, key.lookup, NOW)).ok, false);

  const old = await verifyNeonSignature(body, headers, key.lookup, NOW + 6 * 60_000);
  assert.equal(old.ok, false);
  const future = await verifyNeonSignature(body, headers, key.lookup, NOW - 6 * 60_000);
  assert.equal(future.ok, false);

  const other = await neonKey();
  assert.equal((await verifyNeonSignature(body, headers, other.lookup, NOW)).ok, false);

  const hs256 = await key.sign(body, NOW, { alg: "HS256", kid: key.kid });
  assert.equal((await verifyNeonSignature(body, hs256, key.lookup, NOW)).ok, false);

  // A signed header naming a different key than the unsigned one is a mismatch.
  const wrongKid = await key.sign(body, NOW, { alg: "EdDSA", kid: "someone-else" });
  assert.equal((await verifyNeonSignature(body, wrongKid, key.lookup, NOW)).ok, false);

  const attached = new Headers(headers);
  attached.set("x-neon-signature", headers.get("x-neon-signature")!.replace("..", ".e30."));
  assert.equal((await verifyNeonSignature(body, attached, key.lookup, NOW)).ok, false);

  const missing = new Headers(headers);
  missing.delete("x-neon-timestamp");
  assert.equal((await verifyNeonSignature(body, missing, key.lookup, NOW)).ok, false);
});

/** Stands in for the network: Neon's key list, and Resend. */
function network(jwks: object, resend: (init: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/.well-known/jwks.json")) return Response.json(jwks);
    if (url === "https://api.resend.com/emails") return resend(init!);
    throw new Error(`Unexpected fetch ${url}`);
  };
  return { fetch, calls };
}

let authN = 0;
const env = (extra: object = {}) => ({ NEON_AUTH_URL: `https://auth${++authN}.example/neondb/auth`, RESEND_API_KEY: "re_test", ...extra });

async function post(body: string | ReadableStream<Uint8Array>, headers: Headers, hookEnv: ReturnType<typeof env>, net: ReturnType<typeof network>, now = Date.now()) {
  const init = { method: "POST", headers, body, duplex: "half" } as RequestInit;
  return neonHook(new Request("https://joinhaptic.com/api/neon-auth-hook", init), hookEnv, { fetch: net.fetch, now: () => now });
}

/** A body made only as it is read, one chunk a pull, which counts what was read and whether the rest was cancelled. */
function counted(next: (pull: number) => Uint8Array | undefined) {
  const seen = { pulls: 0, bytes: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = next(seen.pulls++);
        if (!chunk) return controller.close();
        seen.bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        seen.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, seen };
}

/** Text sent as its UTF-8 in pieces of `size` bytes, which can end inside a character. */
function inPieces(text: string, size: number) {
  const bytes = new TextEncoder().encode(text);
  return counted((pull) => (pull * size < bytes.length ? bytes.subarray(pull * size, (pull + 1) * size) : undefined));
}

test("a signed sign-in link is emailed through Resend once, with the event id as the idempotency key", async () => {
  const key = await neonKey();
  const now = Date.now();
  const body = event();
  const net = network({ keys: [key.jwk] }, () => Response.json({ id: "email_1" }));
  const response = await post(body, await key.sign(body, now), env(), net, now);
  assert.equal(response.status, 200);

  const sent = net.calls.find((call) => call.url === "https://api.resend.com/emails")!;
  const headers = new Headers(sent.init!.headers);
  assert.equal(headers.get("authorization"), "Bearer re_test");
  assert.equal(headers.get("idempotency-key"), "neon-auth/550e8400-e29b-41d4-a716-446655440000");
  const payload = JSON.parse(String(sent.init!.body)) as { from: string; to: string[]; reply_to: string; subject: string; html: string; text: string };
  assert.equal(payload.from, FROM);
  assert.equal(payload.reply_to, REPLY_TO);
  assert.deepEqual(payload.to, ["ada@acme.com"]);
  assert.equal(payload.subject, "Sign in to Haptic");
  // The link is behind the button, with its & escaped, and not pasted into the HTML as text.
  assert.equal(payload.html.split("magic-link/verify").length, 2);
  assert.match(payload.html, /href="https:\/\/auth\.example\/magic-link\/verify\?token=abc&#38;callbackURL=/);
  assert.match(payload.text, /token=abc&callbackURL=/);
  // A hidden event id ends each email, so Gmail never folds a newer one's ending into "...".
  assert.match(payload.html, /display:none[^>]*>550e8400-e29b-41d4-a716-446655440000<\/span>/);
  for (const gone of [/1440/, /minute/i, /expire/i, /didn.t request/i, /ignore this/i, /neon/i]) {
    assert.doesNotMatch(payload.html, gone);
    assert.doesNotMatch(payload.text, gone);
  }
});

test("a Resend failure or a missing key asks Neon to try again, and a bad signature or other event does not", async () => {
  const key = await neonKey();
  const now = Date.now();
  const body = event();

  const down = network({ keys: [key.jwk] }, () => Response.json({ message: "Internal" }, { status: 500 }));
  assert.equal((await post(body, await key.sign(body, now), env(), down, now)).status, 502);

  const noKey = network({ keys: [key.jwk] }, () => Response.json({ id: "x" }));
  assert.equal((await post(body, await key.sign(body, now), env({ RESEND_API_KEY: undefined }), noKey, now)).status, 503);
  assert.equal(noKey.calls.some((call) => call.url.includes("resend")), false);

  const forged = network({ keys: [(await neonKey()).jwk] }, () => Response.json({ id: "x" }));
  const forgedResponse = await post(body, await key.sign(body, now), env(), forged, now);
  assert.equal(forgedResponse.status, 401);
  assert.equal(forged.calls.some((call) => call.url.includes("resend")), false);

  const otp = event({ event_type: "send.otp", event_data: { otp_code: "123456" } });
  const otpNet = network({ keys: [key.jwk] }, () => Response.json({ id: "x" }));
  assert.equal((await post(otp, await key.sign(otp, now), env(), otpNet, now)).status, 422);

  const notHttps = event({ event_data: { link_type: "sign-in", link_url: "javascript:alert(1)" } });
  assert.equal((await post(notHttps, await key.sign(notHttps, now), env(), otpNet, now)).status, 400);

  const keysDown = { fetch: async () => new Response("", { status: 502 }), calls: [] };
  assert.equal((await post(body, await key.sign(body, now), env(), keysDown, now)).status, 503);
});

test("a body too long is refused before it is all read, and before Neon's keys are fetched", async () => {
  const net = network({ keys: [] }, () => Response.json({ id: "x" }));
  // 100 MB, Cloudflare's request limit, in 64 KiB chunks with no length given.
  const chunk = new Uint8Array(64 * 1024).fill(0x20);
  const chunked = counted((pull) => (pull < 1600 ? chunk : undefined));
  const response = await post(chunked.body, new Headers({ "content-type": "application/json" }), env(), net);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { message: "That is too long." });
  // 64 KiB characters at three bytes each is 192 KiB, three chunks. The fourth goes over, and nothing after it is pulled.
  assert.equal(chunked.seen.pulls, 4);
  assert.equal(chunked.seen.bytes, 4 * chunk.byteLength);
  assert.equal(chunked.seen.cancelled, true);
  assert.equal(net.calls.length, 0);

  // A length given up front that is too long is enough: nothing is read.
  const declared = counted((pull) => (pull < 1600 ? chunk : undefined));
  const told = await post(declared.body, new Headers({ "content-type": "application/json", "content-length": String(1600 * chunk.byteLength) }), env(), net);
  assert.equal(told.status, 413);
  assert.equal(declared.seen.pulls, 0);
  assert.equal(net.calls.length, 0);
});

test("a signed event as long as the limit allows still passes, also sent in pieces that split its characters", async () => {
  const key = await neonKey();
  const now = Date.now();
  // 64 KiB characters, nearly all "€", three bytes of UTF-8 each, so the body is near the limit in bytes too.
  const room = 64 * 1024 - event({ padding: "" }).length;
  const body = event({ padding: "€".repeat(room) });
  assert.equal(body.length, 64 * 1024);
  const headers = await key.sign(body, now);
  const net = network({ keys: [key.jwk] }, () => Response.json({ id: "email_1" }));

  assert.equal((await post(body, headers, env(), net, now)).status, 200);
  // Pieces of 7 bytes end inside a "€" two times in three. The signature is checked over the text once decoded.
  const pieces = inPieces(body, 7);
  assert.equal((await post(pieces.body, headers, env(), net, now)).status, 200);
  assert.equal(pieces.seen.bytes, new TextEncoder().encode(body).byteLength);
  // A changed body still breaks the signature when it comes in pieces.
  const changed = inPieces(body.replace("ada@", "eve@"), 7);
  assert.equal((await post(changed.body, headers, env(), net, now)).status, 401);

  // One character more is too long, though it is within three bytes a character: the limit is in characters, as before.
  const longer = event({ padding: "€".repeat(room + 1) });
  assert.equal((await post(longer, await key.sign(longer, now), env(), net, now)).status, 413);
  assert.equal(net.calls.filter((call) => call.url.includes("resend")).length, 2);
});

test("each kind of link gets its own words, and what Neon sends is escaped", () => {
  const signIn = signInEmail({ to: "a@b.co", link: "https://x.example/?a=1&b=<2>", type: "sign-in" });
  assert.match(signIn.html, /href="https:\/\/x\.example\/\?a=1&#38;b=&#60;2&#62;"/);
  assert.match(signIn.html, />Sign in</);
  assert.equal(signInEmail({ to: "a@b.co", link: "https://x.example", type: "email-verification" }).subject, "Confirm your email for Haptic");
  assert.equal(signInEmail({ to: "a@b.co", link: "https://x.example", type: "forget-password" }).subject, "Reset your Haptic password");
  assert.equal(signInEmail({ to: "a@b.co", link: "https://x.example", type: "unknown" as never }).subject, "Sign in to Haptic");
  // DESIGN.md: commas and periods only in the words people read.
  for (const type of ["sign-in", "email-verification", "forget-password"] as const) {
    const { text } = signInEmail({ to: "a@b.co", link: "https://x.example", type });
    const words = text.split("\n").filter((line) => line && !line.startsWith("https://") && line !== "joinhaptic.com");
    for (const line of words) assert.doesNotMatch(line, /[:;!?()—–-]/, line);
  }
});

// How many sign-in emails go out. Anyone can ask for a link for any address, so each one is counted before it
// is sent: one mailbox gets 5 an hour and the site sends 300. Past either the event is answered as handled, so
// Neon doesn't try again, and nothing is sent.

let events = 0;
const nextEvent = () => `00000000-0000-4000-8000-${String(++events).padStart(12, "0")}`;

/** A signed send.magic_link event for `to` through the hook. Says what Neon was answered and whether Resend was asked. */
async function signInLink(key: Awaited<ReturnType<typeof neonKey>>, to: string, sql: Sql, eventId = nextEvent()) {
  const now = Date.now();
  const body = event({ event_id: eventId, user: { email: to } });
  const net = network({ keys: [key.jwk] }, () => Response.json({ id: `email_${eventId}` }));
  const response = await neonHook(new Request("https://joinhaptic.com/api/neon-auth-hook", { method: "POST", headers: await key.sign(body, now), body }), env(), { fetch: net.fetch, now: () => now, sql });
  const resend = net.calls.filter((call) => call.url === "https://api.resend.com/emails");
  return { status: response.status, message: ((await response.json()) as { message: string }).message, sent: resend.length, idempotency: resend.map((call) => new Headers(call.init!.headers).get("idempotency-key")) };
}

describe("sign-in emails counted, against Postgres", { skip: TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a local, empty database to run these" }, () => {
  const sql = () => psqlSql(DB) as unknown as Sql;
  const rows = async () => (await sql().query(`select event_id, recipient, sent_at from sign_in_emails order by sent_at, event_id`)) as { event_id: string; recipient: string }[];
  const quietly = async <T>(work: () => Promise<T>): Promise<T> => {
    const real = console.warn;
    console.warn = () => {};
    try {
      return await work();
    } finally {
      console.warn = real;
    }
  };

  test(`one mailbox gets ${EMAILS_PER_MAILBOX} an hour however its address is written, and the next is answered as handled and not sent`, async () => {
    freshDatabase(DB);
    const key = await neonKey();
    const spellings = ["ada@acme.com", "Ada@Acme.com", "ada+news@acme.com", " ADA@acme.com ", "ada+1@ACME.COM"];
    assert.equal(spellings.length, EMAILS_PER_MAILBOX);
    for (const to of spellings) assert.deepEqual((await signInLink(key, to, sql())).sent, 1, to);
    const sixth = await quietly(() => signInLink(key, "ada@acme.com", sql()));
    assert.equal(sixth.status, 200, "Neon is told it was handled, so it doesn't try again");
    assert.equal(sixth.sent, 0);
    assert.match(sixth.message, /over the limit/);
    assert.equal((await signInLink(key, "bob@acme.com", sql())).sent, 1, "another mailbox still gets its email");
    // A Gmail address is one mailbox with or without its dots.
    for (let i = 0; i < EMAILS_PER_MAILBOX; i++) await signInLink(key, i % 2 ? "g.race@gmail.com" : "grace+x@googlemail.com", sql());
    assert.equal((await quietly(() => signInLink(key, "grace@gmail.com", sql()))).sent, 0);
  });

  test("an event Neon sends again after a failed try is sent again, and counted once, even with the mailbox now full", async () => {
    freshDatabase(DB);
    const key = await neonKey();
    const first = nextEvent();
    assert.equal((await signInLink(key, "cy@acme.com", sql(), first)).sent, 1);
    for (let i = 1; i < EMAILS_PER_MAILBOX; i++) assert.equal((await signInLink(key, "cy@acme.com", sql())).sent, 1);
    const again = await signInLink(key, "cy@acme.com", sql(), first);
    assert.equal(again.sent, 1, "Resend is asked again, with the same key, and sends it once");
    assert.deepEqual(again.idempotency, [`neon-auth/${first}`]);
    assert.equal((await rows()).filter((row) => row.event_id === first).length, 1);
    assert.equal((await rows()).length, EMAILS_PER_MAILBOX);
  });

  test(`the site sends at most ${EMAILS_PER_HOUR} an hour, to everyone together, and those an hour old no longer count`, async () => {
    freshDatabase(DB);
    const key = await neonKey();
    exec(DB, `insert into sign_in_emails (event_id, recipient) select 'earlier-' || n, md5(n::text) from generate_series(1, ${EMAILS_PER_HOUR - 1}) as n`);
    assert.equal((await signInLink(key, "dee@acme.com", sql())).sent, 1);
    assert.equal((await quietly(() => signInLink(key, "eve@acme.com", sql()))).sent, 0, "a mailbox that has had none is still over the site's limit");
    exec(DB, `update sign_in_emails set sent_at = now() - interval '61 minutes'`);
    assert.equal((await signInLink(key, "eve@acme.com", sql())).sent, 1);
  });

  test("ten at the same moment to one mailbox send five: they take turns", async () => {
    freshDatabase(DB);
    const key = await neonKey();
    const all = await quietly(() => Promise.all(Array.from({ length: 10 }, () => signInLink(key, "fay@acme.com", sql()))));
    assert.equal(all.reduce((sum, one) => sum + one.sent, 0), EMAILS_PER_MAILBOX);
    assert.ok(all.every((one) => one.status === 200));
    assert.equal((await rows()).length, EMAILS_PER_MAILBOX);
  });

  test("only a hash of the mailbox is kept, and a record a day old is deleted by the next email and by the daily run", async () => {
    freshDatabase(DB);
    const key = await neonKey();
    await signInLink(key, "gus@acme.com", sql());
    const [row] = await rows();
    assert.match(row!.recipient, /^[0-9a-f]{32}$/);
    assert.ok(!JSON.stringify(await rows()).includes("gus"), "the address itself is not kept");
    exec(DB, `insert into sign_in_emails (event_id, recipient, sent_at) values ('old-1', 'r', now() - interval '25 hours')`);
    await signInLink(key, "hal@acme.com", sql());
    assert.deepEqual((await rows()).map((one) => one.event_id).filter((id) => id.startsWith("old")), []);
    exec(DB, `insert into sign_in_emails (event_id, recipient, sent_at) values ('old-2', 'r', now() - interval '30 hours')`);
    await forgetOldSignInEmails(sql());
    assert.equal((await rows()).length, 2);
  });
});

test("when the count can't be kept, the email is sent anyway: sign-in matters more", async () => {
  const key = await neonKey();
  const errors: unknown[] = [];
  const real = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    for (const failure of [Object.assign(new Error('relation "sign_in_emails" does not exist'), { code: "42P01" }), new Error("fetch failed")]) {
      // A query runs only once it is awaited, as Neon's do, and fails then.
      const later = { then: (done: (value: unknown) => unknown, failed: (error: unknown) => unknown) => Promise.reject(failure).then(done, failed) };
      const down = Object.assign(() => later, { query: () => later, transaction: () => Promise.reject(failure) }) as unknown as Sql;
      const answer = await signInLink(key, "ida@acme.com", down);
      assert.equal(answer.status, 200);
      assert.equal(answer.sent, 1);
    }
  } finally {
    console.error = real;
  }
  assert.equal(errors.length, 2, "and the log says why");
});
