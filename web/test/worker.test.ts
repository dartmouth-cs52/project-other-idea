import assert from "node:assert/strict";
import { test } from "node:test";
import { signForTest } from "../../src/shared/stripe";
import { appApi, approveLink } from "../worker/app-api";
import { handle } from "../worker/handler";
import worker from "../worker/index";

// The site's Worker as a whole, which needs web/'s own packages (Neon Auth,
// Browser Rendering), so these run with the site: `npm test` in web/, as the
// Website job in CI does. The routes' own rules are tested at the top of the
// repository, in test/setup-flow.test.ts and test/developer-email.test.ts.

const SITE = "site_a1b2c3d4e5f6";
const env = {
  DATABASE_URL: "postgresql://user:password@ep-test.us-east-1.aws.neon.tech/neondb",
  ACCESS_REQUESTS: { put: async () => {}, get: async () => null },
  RESEND_API_KEY: "re_test",
  WIDGET_URL: "https://widget.joinhaptic.com",
};
const assets = { fetch: () => new Response("static page", { status: 200 }) };

const post = (path: string, origin: string, body: unknown) =>
  new Request(`https://joinhaptic.com/api/app${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });

test("emailing a developer needs someone signed in, before anything is looked up", async () => {
  const request = post(`/sites/${SITE}/developer-email`, "https://joinhaptic.com", { to: "dev@example.com", key: "k".repeat(16) });
  const response = await appApi(request, env, new URL(request.url));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Sign in first." });
});

test("a change sent from another site is turned away, for every new route", async () => {
  for (const path of [`/sites/${SITE}/developer-email`, `/sites/${SITE}/setup`, `/sites/${SITE}/address`]) {
    const request = post(path, "https://evil.example", {});
    assert.equal((await appApi(request, env, new URL(request.url))).status, 403, path);
  }
});

test("the Worker hands /install/<site>.md to the install steps before the static pages, and the install page stays static", async () => {
  const steps = await handle(new Request(`https://joinhaptic.com/install/${SITE}.md`), env, assets);
  assert.equal(steps.status, 200);
  assert.equal(steps.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.ok((await steps.text()).includes(`data-site="${SITE}"`));
  assert.equal(await (await handle(new Request(`https://joinhaptic.com/install/?site=${SITE}`), env, assets)).text(), "static page");
  assert.equal((await handle(new Request("https://joinhaptic.com/install/nope.md"), env, assets)).status, 404);
});

test("the request access form turns away a page with no address of ours, Origin: null included, without failing", async () => {
  const form = (origin: string | null, body: unknown = {}) =>
    handle(
      new Request("https://joinhaptic.com/api/request-access", { method: "POST", headers: { "content-type": "application/json", ...(origin === null ? {} : { origin }) }, body: JSON.stringify(body) }),
      env,
      assets,
    );
  // A sandboxed frame, a saved page and some privacy settings send "null", which new URL() can't read.
  for (const origin of ["null", "not an address", "https://evil.example", "https://joinhaptic.com.evil.example"]) {
    const response = await form(origin);
    assert.equal(response.status, 403, origin);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.deepEqual(await response.json(), { error: "Not allowed from this site." });
  }
  // Our own page, and a program that sends no Origin, get as far as checking the entry. Nothing is sent or saved.
  for (const origin of ["https://joinhaptic.com", null]) {
    const response = await form(origin);
    assert.equal(response.status, 400, String(origin));
    assert.equal(((await response.json()) as { field?: string }).field, "email");
  }
});

test("a failure anywhere under /api answers JSON, and an address under /api nothing answers is a JSON 404", async () => {
  const broken = { limit: async (): Promise<{ success: boolean }> => { throw new Error("The rate limit binding is down."); } };
  const failing = { ...env, FORM_LIMIT: broken, AUTH_LIMIT: broken };
  const errors: unknown[][] = [];
  const real = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    for (const path of ["/api/request-access", "/api/auth/sign-in/magic-link"]) {
      const response = await handle(new Request(`https://joinhaptic.com${path}`, { method: "POST", headers: { origin: "https://joinhaptic.com" }, body: "{}" }), failing, assets);
      assert.equal(response.status, 500, path);
      assert.equal(response.headers.get("content-type"), "application/json");
      assert.deepEqual(await response.json(), { error: "Something went wrong on our side." });
    }
  } finally {
    console.error = real;
  }
  assert.equal(errors.length, 2, "each failure is logged");
  for (const path of ["/api/nothing-here", "/api/app", "/api/auth"]) {
    const response = await handle(new Request(`https://joinhaptic.com${path}`), env, assets);
    assert.equal(response.status, 404, path);
    assert.deepEqual(await response.json(), { error: "Not found." });
  }
});

test("every answer carries the security headers: a static page, a redirect, a preview, the install steps and /api", async () => {
  const expected = {
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors 'none'",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
  const answers = {
    page: await handle(new Request("https://joinhaptic.com/pricing/"), env, assets),
    redirect: await handle(new Request("https://www.joinhaptic.com/sign-in/"), env, assets),
    preview: await handle(new Request("https://haptic-web.joinhaptic.workers.dev/"), env, assets),
    steps: await handle(new Request(`https://joinhaptic.com/install/${SITE}.md`), env, assets),
    signedOut: await handle(new Request("https://joinhaptic.com/api/app/me"), env, assets),
    form: await handle(new Request("https://joinhaptic.com/api/request-access", { method: "POST", headers: { origin: "null" }, body: "{}" }), env, assets),
    notFound: await handle(new Request("https://joinhaptic.com/api/nothing-here"), env, assets),
  };
  for (const [name, response] of Object.entries(answers)) {
    for (const [header, value] of Object.entries(expected)) assert.equal(response.headers.get(header), value, `${name}: ${header}`);
  }
  // What each answer said for itself is still there.
  assert.equal(answers.page.status, 200);
  assert.equal(await answers.page.text(), "static page");
  assert.equal(answers.redirect.status, 301);
  assert.equal(answers.redirect.headers.get("location"), "https://joinhaptic.com/sign-in/");
  assert.equal(answers.preview.headers.get("x-robots-tag"), "noindex");
  assert.equal(answers.steps.headers.get("access-control-allow-origin"), "*");
  assert.equal(answers.signedOut.status, 401);
  assert.equal(answers.signedOut.headers.get("cache-control"), "no-store");
  assert.equal(answers.form.status, 403);
});

test("the standard entry adds them too, even when the site's files are missing", async () => {
  const served = await worker.fetch(new Request("https://joinhaptic.com/"), { ...env, ASSETS: assets });
  assert.equal(served.headers.get("x-frame-options"), "DENY");
  const missing = await worker.fetch(new Request("https://joinhaptic.com/"), env);
  assert.equal(missing.status, 500);
  assert.equal(missing.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
});

test("a header an answer sets for itself is kept, not replaced", async () => {
  const own = { fetch: () => new Response("framed on purpose", { headers: { "content-security-policy": "frame-ancestors https://partner.example", "x-frame-options": "SAMEORIGIN" } }) };
  const response = await handle(new Request("https://joinhaptic.com/embed/"), env, own);
  assert.equal(response.headers.get("content-security-policy"), "frame-ancestors https://partner.example");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff", "the rest are still added");
});

test("the form's and sign-in's limits count an IPv6 caller by its /64, and an IPv4 caller by its address", async () => {
  const keys: string[] = [];
  const counting = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) };
  const limited = { ...env, FORM_LIMIT: counting, AUTH_LIMIT: counting };
  const from = async (ip: string) => {
    keys.length = 0;
    const headers = { origin: "https://joinhaptic.com", "cf-connecting-ip": ip };
    const form = await handle(new Request("https://joinhaptic.com/api/request-access", { method: "POST", headers, body: "{}" }), limited, assets);
    const signIn = await handle(new Request("https://joinhaptic.com/api/auth/sign-in/magic-link", { method: "POST", headers, body: "{}" }), limited, assets);
    assert.equal(form.status, 429);
    assert.equal(signIn.status, 429);
    assert.equal(keys[0], keys[1], "both count the caller the same way");
    return keys[0];
  };
  const network = "2001:db8:1:2::/64";
  for (const ip of ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2:ffff::1", "2001:0DB8:0001:0002::9", "2001:db8:1:2::", "2001:db8:1:2:0:0:0:1"]) assert.equal(await from(ip), network, ip);
  assert.equal(await from("2001:db8:1:3::1"), "2001:db8:1:3::/64", "the next /64 is another caller");
  assert.equal(await from("::1"), "0:0:0:0::/64");
  assert.equal(await from("203.0.113.7"), "203.0.113.7");
  assert.equal(await from("::ffff:203.0.113.7"), "203.0.113.7", "IPv4 written as IPv6 is that IPv4 address");
  assert.equal(await from("2001:db8::1::2"), "2001:db8::1::2", "anything that isn't an address is counted as it is");
});

/** A body of `piece` over and over, `pieces` times, made only as it is read. Counts what was read, and whether the rest was cancelled. */
function long(piece: Uint8Array, pieces: number) {
  const seen = { bytes: 0, cancelled: false };
  let sent = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent++ === pieces) return controller.close();
        seen.bytes += piece.byteLength;
        controller.enqueue(piece);
      },
      cancel() {
        seen.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, seen };
}

test("no route under /api reads a body past its limit: not Neon's sign-in proxy, and not Stripe's webhook, before any signature or sign-in", async () => {
  const piece = new Uint8Array(64 * 1024).fill(0x20);
  const signing = { ...env, NEON_AUTH_URL: "https://auth.example/neondb/auth", NEON_AUTH_COOKIE_SECRET: "c".repeat(32), STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" };
  const real = globalThis.fetch;
  globalThis.fetch = async () => assert.fail("nothing should be fetched for a body that is too long");
  try {
    for (const [path, limit] of [["/api/auth/sign-in/magic-link", 16 * 1024], ["/api/stripe/webhook", 1_000_000]] as const) {
      // Ten megabytes with no length given, as a program can send.
      const sent = long(piece, 160);
      const init = { method: "POST", headers: { origin: "https://joinhaptic.com", "content-type": "application/json" }, body: sent.body, duplex: "half" };
      const response = await handle(new Request(`https://joinhaptic.com${path}`, init as RequestInit), signing, assets);
      assert.equal(response.status, 413, path);
      assert.deepEqual(await response.json(), { error: "That is too long." });
      assert.ok(sent.seen.bytes <= limit + 2 * piece.byteLength, `${path}: read ${sent.seen.bytes.toLocaleString()} bytes for a limit of ${limit.toLocaleString()}`);
      assert.ok(sent.seen.cancelled, `${path}: the rest is cancelled`);

      // A length given up front that is too long is enough: nothing is read.
      const told = long(piece, 160);
      const toldInit = { ...init, headers: { ...init.headers, "content-length": String(160 * piece.byteLength) }, body: told.body };
      assert.equal((await handle(new Request(`https://joinhaptic.com${path}`, toldInit as RequestInit), signing, assets)).status, 413);
      assert.equal(told.seen.bytes, 0, `${path}: nothing read`);
    }
  } finally {
    globalThis.fetch = real;
  }
});

test("a body within the limit reaches its route byte for byte, so Stripe's signature over it still holds", async () => {
  const secret = "whsec_test_secret";
  // A live event to a test key is checked and then set aside, which needs no database: the signature is what is tested.
  const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", created: 1, livemode: true, data: { object: { customer_name: "Zoë Ångström 請求書" } } });
  const bytes = new TextEncoder().encode(body);
  const pieces = [bytes.subarray(0, 37), bytes.subarray(37, 101), bytes.subarray(101)];
  const stream = new ReadableStream<Uint8Array>({ pull: (controller) => void (pieces.length ? controller.enqueue(pieces.shift()!) : controller.close()) });
  const init = { method: "POST", headers: { "stripe-signature": await signForTest(body, secret) }, body: stream, duplex: "half" };
  const response = await handle(new Request("https://joinhaptic.com/api/stripe/webhook", init as RequestInit), { ...env, STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: secret }, assets);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, ignored: "other mode" });
});

test("a site's name is saved on one line, since it goes into the subject of the emails about the site", async () => {
  const SIGNED_IN = { ...env, NEON_AUTH_URL: "https://auth.example/neondb/auth", NEON_AUTH_COOKIE_SECRET: "c".repeat(32) };
  const ORG = "00000000-0000-4000-8000-000000000001";
  let saved = "Acme";
  // Neon Auth says who is signed in, and Neon's database answers over HTTP, as its driver asks, with the fields named and typed.
  const answer = (query: string, params: unknown[]): { fields: [string, number][]; rows: (string | null)[][] } => {
    if (query.includes("from neon_auth.member m join neon_auth.organization")) return { fields: [["id", 25], ["name", 25], ["role", 25]], rows: [[ORG, "Acme", "owner"]] };
    if (query.startsWith("update sites set name")) return (saved = String(params[0])), { fields: [], rows: [] };
    if (query.includes("from sites where id")) {
      const fields: [string, number][] = [["id", 25], ["name", 25], ["origin", 25], ["allowed_origins", 1009], ["context", 3802], ["reading", 3802], ["routes_mode", 25], ["created_at", 25]];
      return { fields, rows: [[SITE, saved, "https://app.example.com", "{https://app.example.com}", JSON.stringify({ pages: [] }), null, "shadow", "2026-11-18T00:00:00Z"]] };
    }
    return { fields: [], rows: [] };
  };
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const address = input instanceof Request ? input.url : String(input);
    if (address.startsWith("https://auth.example/")) return Response.json({ session: { id: "s1", userId: "u1" }, user: { id: "u1", email: "dana@example.com", name: "Dana", emailVerified: true } });
    const { query, params } = JSON.parse(String(init?.body)) as { query: string; params: unknown[] };
    const { fields, rows } = answer(query.trim(), params);
    return Response.json({ fields: fields.map(([name, dataTypeID]) => ({ name, dataTypeID })), rows, command: "SELECT", rowCount: rows.length });
  };
  try {
    const name = `  Acme\r\nBcc: everyone@example.com${String.fromCodePoint(0x2028, 0x202e)}Evil  `;
    const request = new Request(`https://joinhaptic.com/api/app/sites/${SITE}`, { method: "PATCH", headers: { origin: "https://joinhaptic.com", "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const response = await appApi(request, SIGNED_IN, new URL(request.url));
    assert.equal(response.status, 200);
    assert.equal(saved, "Acme Bcc: everyone@example.com Evil");
    assert.equal(((await response.json()) as { name: string }).name, saved);
  } finally {
    globalThis.fetch = real;
  }
});

test("approving a request emails a sign-in link that comes back to the list of sites", async () => {
  const entry = { email: "dana@example.com", company: "Example Co", firstName: "Dana", lastName: "Reyes", details: "" };
  const approving = {
    ...env,
    APPROVE_SECRET: "a".repeat(32),
    NEON_AUTH_URL: "https://auth.example/neondb/auth",
    NEON_AUTH_COOKIE_SECRET: "c".repeat(32),
    ACCESS_REQUESTS: { put: async () => {}, get: async () => JSON.stringify(entry) },
  };
  const link = new URL((await approveLink(approving, "https://joinhaptic.com", "request-1"))!);
  // Neon Auth and the database are both stood in for, so no email is sent and nothing is written.
  const asked: { url: string; body: unknown }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const address = input instanceof Request ? input.url : String(input);
    if (!address.startsWith("https://auth.example/")) return Response.json({ fields: [], rows: [], command: "INSERT", rowCount: 1, rowAsArray: true });
    asked.push({ url: address, body: JSON.parse(String(init?.body)) });
    return Response.json({ status: true });
  };
  try {
    const request = post("/approve", "https://joinhaptic.com", { key: link.searchParams.get("key"), sig: link.searchParams.get("sig") });
    const response = await appApi(request, approving, new URL(request.url));
    assert.deepEqual(await response.json(), { ok: true, scope: "email", sent: true, email: "dana@example.com" });
    assert.deepEqual(asked, [
      { url: "https://auth.example/neondb/auth/sign-in/magic-link", body: { email: "dana@example.com", callbackURL: "https://joinhaptic.com/dashboard/?view=sites" } },
    ]);
  } finally {
    globalThis.fetch = real;
  }
});
