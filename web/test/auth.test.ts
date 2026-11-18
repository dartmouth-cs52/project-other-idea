import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_CALLS } from "../worker/auth";
import { handle } from "../worker/handler";

// /api/auth passes on to Neon Auth only the calls the site's own pages make.
// Neon is stood in for here, so nothing leaves the machine: each test checks
// what would have reached it.

const NEON = "https://auth.example/neondb/auth";
const env = {
  ACCESS_REQUESTS: { put: async () => {}, get: async () => null },
  NEON_AUTH_URL: NEON,
  NEON_AUTH_COOKIE_SECRET: "c".repeat(32),
};
const assets = { fetch: () => new Response("static page") };

interface Asked {
  method: string;
  url: string;
  body: string;
  cookie: string;
}

/** Runs `work` with Neon stood in for. Neon answers each call with `answer`, and every call is kept. */
async function withNeon(work: (asked: Asked[]) => Promise<void>, answer: (url: URL) => Response = () => Response.json({ status: true })) {
  const asked: Asked[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== new URL(NEON).origin) throw new Error(`Nothing but Neon should be asked, not ${url}`);
    asked.push({ method: init?.method ?? "GET", url: url.href, body: typeof init?.body === "string" ? init.body : "", cookie: new Headers(init?.headers).get("cookie") ?? "" });
    return answer(url);
  };
  try {
    await work(asked);
  } finally {
    globalThis.fetch = real;
  }
}

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { origin: "https://joinhaptic.com", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handle(new Request(`https://joinhaptic.com/api/auth/${path}`, init), env, assets);
}

// These are what the built pages were seen to ask for in Chromium, signing in both ways, coming back with a
// verifier, on the dashboard and the setup screens, and signing out from each.
test("the calls passed on are exactly the ones the site makes", () => {
  assert.deepEqual(AUTH_CALLS, ["GET get-session", "POST sign-in/magic-link", "POST sign-in/social", "POST sign-out"]);
});

test("an emailed link, Google, the session check, the return from Google and signing out all still reach Neon as sent", async () => {
  await withNeon(
    async (asked) => {
      const callbackURL = "https://joinhaptic.com/dashboard/?view=sites";
      assert.equal((await call("POST", "sign-in/magic-link", { email: "ada@acme.com", callbackURL })).status, 200);
      const google = await call("POST", "sign-in/social", { provider: "google", callbackURL });
      assert.equal(google.status, 200);
      assert.deepEqual(await google.json(), { url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x", redirect: true }, "where to send the browser comes back as Neon said");
      assert.equal((await call("GET", "get-session")).status, 200);
      // Back from Google or the emailed link: the verifier in the address, and the challenge cookie set when sign-in started.
      const back = await call("GET", "get-session?neon_auth_session_verifier=v123", undefined, { cookie: "__Secure-neon-auth.session_challenge=c456" });
      assert.equal(back.status, 200);
      assert.equal(((await back.json()) as { user?: { email: string } }).user?.email, "ada@acme.com");
      assert.equal((await call("POST", "sign-out", {})).status, 200);

      assert.deepEqual(
        asked.map(({ method, url }) => `${method} ${url}`),
        [
          `POST ${NEON}/sign-in/magic-link`,
          `POST ${NEON}/sign-in/social`,
          `GET ${NEON}/get-session`,
          `GET ${NEON}/get-session?neon_auth_session_verifier=v123`,
          `POST ${NEON}/sign-out`,
        ],
      );
      assert.deepEqual(JSON.parse(asked[0]!.body), { email: "ada@acme.com", callbackURL });
      assert.deepEqual(JSON.parse(asked[1]!.body), { provider: "google", callbackURL });
      assert.match(asked[3]!.cookie, /__Secure-neon-auth\.session_challenge=c456/);
    },
    (url) => {
      if (url.pathname.endsWith("/sign-in/social")) return Response.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x", redirect: true });
      if (url.pathname.endsWith("/get-session")) return Response.json({ session: { id: "s1", userId: "u1" }, user: { id: "u1", email: "ada@acme.com" } });
      return Response.json({ status: true });
    },
  );
});

test("everything else Neon answers is a 404 here, and never reaches Neon", async () => {
  await withNeon(async (asked) => {
    const refused: [string, string][] = [
      // Neon's own API reference and the whole schema.
      ["GET", "reference"],
      ["GET", "open-api/generate-schema"],
      // Organizations, where team.ts's rules would not hold.
      ["POST", "organization/invite-member"],
      ["POST", "organization/accept-invitation"],
      ["POST", "organization/update-member-role"],
      ["POST", "organization/create"],
      ["GET", "organization/list"],
      ["POST", "admin/list-users"],
      // Ways in the site doesn't offer, and tokens it doesn't use.
      ["POST", "sign-in/email"],
      ["POST", "sign-up/email"],
      ["POST", "sign-in/email-otp"],
      ["GET", "token"],
      ["GET", "token/anonymous"],
      ["POST", "update-user"],
      ["POST", "delete-user"],
      // These are on Neon's own address, never this one.
      ["GET", "magic-link/verify?token=abc"],
      ["GET", "callback/google?code=abc"],
      // A known call with another method, or spelled another way.
      ["GET", "sign-in/magic-link"],
      ["GET", "sign-out"],
      ["POST", "get-session"],
      ["DELETE", "get-session"],
      ["POST", "sign-in/social/"],
      ["POST", "sign-in%2Fsocial"],
      ["POST", "Sign-In/Social"],
      ["GET", "get-session/../organization/list"],
      ["GET", "get-session/%2e%2e/organization/list"],
      ["GET", ""],
    ];
    for (const [method, path] of refused) {
      const response = await call(method, path, method === "GET" ? undefined : {});
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.deepEqual(await response.json(), { error: "Not found." }, `${method} ${path}`);
    }
    assert.deepEqual(asked, [], "Neon was never asked");
  });
});

test("with sign-in not set up, a call the site makes says so, and anything else is still a 404", async () => {
  const unset = { ACCESS_REQUESTS: env.ACCESS_REQUESTS };
  const get = (path: string) => handle(new Request(`https://joinhaptic.com/api/auth/${path}`), unset, assets);
  assert.equal((await get("get-session")).status, 503);
  assert.equal((await get("reference")).status, 404);
});
