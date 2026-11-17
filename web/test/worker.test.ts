import assert from "node:assert/strict";
import { test } from "node:test";
import { appApi, approveLink } from "../worker/app-api";
import { handle } from "../worker/handler";

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
