import { test } from "node:test";
import assert from "node:assert/strict";
import { base64url, neonHook, verifyNeonSignature, type KeyLookup } from "../web/worker/neon-hook";
import { FROM, REPLY_TO, signInEmail } from "../web/worker/sign-in-email";

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

async function post(body: string, headers: Headers, hookEnv: ReturnType<typeof env>, net: ReturnType<typeof network>, now = Date.now()) {
  return neonHook(new Request("https://joinhaptic.com/api/neon-auth-hook", { method: "POST", headers, body }), hookEnv, { fetch: net.fetch, now: () => now });
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
