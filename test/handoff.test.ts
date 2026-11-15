import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { parseHandoff, publicHandoff, webhookAllowed } from "../src/server/handoff.ts";
import { DEFAULT_APPEARANCE, type GuideReport, type SiteContext } from "../src/shared/types.ts";

// The stand-in model, so these run with no API key. See turn.test.ts.
process.env.HAPTIC_MODEL = "mock";
const { createApp } = await import("../src/server/app.ts");

const site: SiteContext = {
  version: 1,
  id: "site_test",
  name: "Test",
  origin: "https://app.test",
  allowedOrigins: ["https://app.test"],
  appearance: DEFAULT_APPEARANCE,
  notes: "",
  docs: [],
  pages: [],
  source: { url: "https://app.test", maxPages: 1, docs: [] },
  handoff: { webhook: "https://hooks.acme.test/haptic", secret: "s3cret", email: "help@acme.test" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const GUIDE = "0b6f2c1e-6a1d-4c3e-9f2a-3d4c5b6a7e8f";
const form = {
  site: site.id,
  guide: GUIDE,
  email: "sam@example.com",
  note: "I need to move my workspace to another owner.",
  path: "/settings",
  transcript: [
    { role: "user", text: "How do I transfer ownership?" },
    { role: "assistant", text: "The help docs don't cover that.", kind: "cannot_help" },
  ],
};

function makeApp(served: SiteContext = site, answer: (url: string, init: RequestInit) => Response | Promise<Response> = () => new Response("ok"), overLimit: (key: string) => boolean = () => false) {
  const posts: { url: string; init: RequestInit }[] = [];
  const reports: (GuideReport & { guide: string })[] = [];
  const app = createApp({
    loadSite: async (id) => (id === served.id ? served : undefined),
    widget: async () => "",
    widgetMaxAge: 0,
    overLimit,
    onReport: (_site, guide, report) => void reports.push({ guide, ...report }),
    fetch: (async (url: string, init: RequestInit) => {
      posts.push({ url, init });
      return answer(url, init);
    }) as typeof fetch,
  });
  const send = (body: unknown, origin = "https://app.test") =>
    app(new Request("https://widget.test/v1/handoff", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) }), "1.1.1.1");
  return { app, send, posts, reports };
}

test("the widget is told there is a way to a person, and never where the form goes", async () => {
  assert.deepEqual(publicHandoff(site.handoff), { label: "Contact support", form: true, email: "help@acme.test" });
  assert.deepEqual(publicHandoff({ label: "Talk to us", url: "https://acme.test/contact" }), { label: "Talk to us", url: "https://acme.test/contact" });
  assert.equal(publicHandoff(undefined), undefined);
  assert.equal(publicHandoff({ label: "Nothing to open" }), undefined);
  // An address that is not a web address is not handed to the widget to open.
  assert.deepEqual(publicHandoff({ url: "javascript:alert(1)", email: "help@acme.test" }), { label: "Contact support", email: "help@acme.test" });

  const { app } = makeApp();
  const config = await (await app(new Request(`https://widget.test/v1/sites/${site.id}`, { headers: { Origin: "https://app.test" } }), "1.1.1.1"))?.json();
  assert.deepEqual(config.handoff, { label: "Contact support", form: true, email: "help@acme.test" });
  assert.doesNotMatch(JSON.stringify(config), /hooks\.acme|s3cret/);
});

test("the form is passed on to the company with the conversation and the page, and signed", async () => {
  const { send, posts, reports } = makeApp();
  const response = await send(form);
  assert.equal(response?.status, 200);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.url, "https://hooks.acme.test/haptic");
  const body = String(posts[0]!.init.body);
  const post = JSON.parse(body);
  assert.deepEqual(
    { ...post, at: "" },
    {
      kind: "handoff",
      site: "site_test",
      site_name: "Test",
      at: "",
      email: "sam@example.com",
      note: "I need to move my workspace to another owner.",
      origin: "https://app.test",
      page: "/settings",
      guide: GUIDE,
      transcript: form.transcript,
      modes: ["cannot_help"],
    },
  );
  const headers = posts[0]!.init.headers as Record<string, string>;
  assert.equal(headers["X-Haptic-Signature"], `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`);
  // The guide is marked as handed to a person.
  assert.deepEqual(reports, [{ guide: GUIDE, site: site.id, handoff: true }]);
});

test("a form that can't be passed on says so, and is not marked as handed over", async () => {
  for (const answer of [() => new Response("no", { status: 500 }), () => Promise.reject(new Error("unreachable"))]) {
    const { send, reports } = makeApp(site, answer);
    assert.equal((await send(form))?.status, 502);
    assert.deepEqual(reports, []);
  }
});

test("a form is refused from another origin, without an email, or for a site with nowhere to send it", async () => {
  const { send, posts } = makeApp();
  assert.equal((await send(form, "https://elsewhere.test"))?.status, 403);
  assert.equal((await send({ ...form, email: "not an address" }))?.status, 400);
  assert.equal((await send({ ...form, site: "site_none" }))?.status, 404);
  assert.equal(posts.length, 0);
  const linkOnly = makeApp({ ...site, handoff: { url: "https://acme.test/contact" } });
  assert.equal((await linkOnly.send(form))?.status, 404);
  // An address inside the server's own network is never fetched, whatever the site says.
  const inside = makeApp({ ...site, handoff: { webhook: "https://169.254.169.254/latest/meta-data" } });
  assert.equal((await inside.send(form))?.status, 502);
  assert.equal(inside.posts.length, 0);
});

test("the form has an allowance of its own, apart from the one for steps", async () => {
  const keys: string[] = [];
  const { send } = makeApp(site, undefined, (key) => (keys.push(key), key.includes(" handoff ")));
  assert.equal((await send(form))?.status, 429);
  assert.deepEqual(keys, ["site_test handoff 1.1.1.1"]);
});

test("what is passed on is cut to size, and only Haptic's lines say what kind of reply they were", () => {
  const long = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `line ${index}`, kind: "answer" }));
  const parsed = parseHandoff({ ...form, note: "x".repeat(5000), transcript: long, guide: "not-a-guide" });
  assert.equal(parsed?.transcript.length, 16);
  assert.equal(parsed?.transcript[0]?.text, "line 14");
  assert.equal(parsed?.transcript[0]?.kind, undefined);
  assert.equal(parsed?.transcript[1]?.kind, "answer");
  assert.equal(parsed?.note.length, 1000);
  assert.equal(parsed?.guide, undefined);
  assert.equal(parseHandoff({ site: "s", email: "" }), undefined);
});

test("a webhook has to be an https address on the public internet", () => {
  assert.ok(webhookAllowed("https://hooks.acme.test/haptic"));
  for (const address of ["http://hooks.acme.test/haptic", "https://localhost/x", "https://10.0.0.5/x", "https://[::1]/x", "https://db.internal/x", "ftp://acme.test", "not a url"]) {
    assert.ok(!webhookAllowed(address), address);
  }
  // On a developer's machine a webhook may be on the same machine.
  assert.ok(webhookAllowed("http://localhost:4190/hook", true));
  assert.ok(!webhookAllowed("http://hooks.acme.test/haptic", true));
});

test("the widget can report that a visitor went to a person by a link or by email", async () => {
  const { app, reports } = makeApp();
  const response = await app(
    new Request(`https://widget.test/v1/guides/${GUIDE}/report`, { method: "POST", headers: { "Content-Type": "text/plain", Origin: "https://app.test" }, body: JSON.stringify({ site: site.id, handoff: true }) }),
    "1.1.1.1",
  );
  assert.equal(response?.status, 200);
  assert.deepEqual(reports, [{ guide: GUIDE, site: site.id, handoff: true }]);
});
