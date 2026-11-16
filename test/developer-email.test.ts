// The Worker runs on Cloudflare, whose HTMLRewriter the reader uses. Declared for the Worker in its own folder.
/// <reference path="../web/worker/runtime.d.ts" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { appApi } from "../web/worker/app-api.ts";
import { developerEmail, INSTALL_FROM } from "../web/worker/developer-email.ts";
import { EMAILS_PER_ADDRESS, EMAILS_PER_SITE, setupRoutes, type SetupRequest } from "../web/worker/setup-api.ts";
import { exec, freshDatabase, psqlSql, TEST_DATABASE_URL, testDatabase } from "./psql.ts";

/** This file's own database, when TEST_DATABASE_URL is set. */
const DB = testDatabase("developer_email");

// "Email it to my developer": only someone signed in to the company that owns
// the site can send, 10 a day for a site and 3 to one address, a retry of one
// press never sends twice, and a failure says why and doesn't count.

const ORG = { id: "00000000-0000-4000-8000-000000000001", name: "Example Co", role: "owner" };
const OTHER_ORG = { id: "00000000-0000-4000-8000-000000000002", name: "Other Co", role: "owner" };
const USER = { id: "00000000-0000-4000-8000-0000000000aa", email: "dana@example.com", name: "Dana Reyes", emailVerified: true };
const SITE = "site_a1b2c3d4e5f6";

interface Row {
  id: string;
  company_id: string;
  origin: string;
  context: Record<string, unknown> & { developerEmails?: { at: string; to: string; key: string }[] };
}

/** The sites table in memory, answering the queries setup-api.ts sends the way Postgres would. */
function fakeSql(rows: Row[]) {
  const find = (id: unknown, org: unknown) => rows.find((row) => row.id === id && row.company_id === org);
  const recent = (row: Row) => (row.context.developerEmails ?? []).filter((item) => Date.now() - Date.parse(item.at) < 86_400_000);
  const query = async (text: string, params: unknown[] = []) => {
    const row = find(params[0], params[1]);
    if (text.startsWith("select id, origin, context from sites")) return row ? [structuredClone(row)] : [];
    if (text.includes("'{setup}'")) {
      if (!row) return [];
      row.context.setup = { ...(row.context.setup as object), ...JSON.parse(String(params[2])) };
      return [{ setup: row.context.setup }];
    }
    if (text.includes("'{developerEmails}'") && text.includes("returning id")) {
      if (!row) return [];
      const [, , to, key, perSite, perAddress] = params as [string, string, string, string, number, number];
      const kept = recent(row);
      if (kept.length >= perSite || kept.filter((item) => item.to === to).length >= perAddress || kept.some((item) => item.key === key)) return [];
      row.context.developerEmails = [...kept, { at: new Date().toISOString(), to, key }];
      return [{ id: row.id }];
    }
    if (text.includes("'{developerEmails}'")) {
      if (row) row.context.developerEmails = (row.context.developerEmails ?? []).filter((item) => item.key !== params[2]);
      return [];
    }
    throw new Error(`The fake doesn't know this query: ${text.slice(0, 80)}`);
  };
  return Object.assign(() => Promise.reject(new Error("not used")), { query, transaction: () => Promise.reject(new Error("not used")) });
}

interface Sent {
  idempotency: string | null;
  body: { from: string; to: string[]; reply_to: string; subject: string; html: string; text: string };
}

function resend(status = 200) {
  const sent: Sent[] = [];
  const fetcher = async (_url: string, init?: RequestInit) => {
    sent.push({ idempotency: new Headers(init?.headers).get("idempotency-key"), body: JSON.parse(String(init?.body)) });
    return status === 200 ? Response.json({ id: `email_${sent.length}` }) : Response.json({ message: "Domain not verified", name: "validation_error" }, { status });
  };
  return { sent, fetcher };
}

function call(sql: unknown, body: unknown, options: { org?: typeof ORG; fetcher?: SetupRequest["fetcher"]; key?: string | null; method?: string; what?: string } = {}) {
  const what = options.what ?? "developer-email";
  const url = new URL(`https://joinhaptic.com/api/app/sites/${SITE}/${what}`);
  return setupRoutes({
    request: new Request(url, { method: options.method ?? "POST", body: options.method === "GET" ? undefined : JSON.stringify(body) }),
    env: { RESEND_API_KEY: options.key === null ? undefined : (options.key ?? "re_test"), WIDGET_URL: "https://widget.joinhaptic.com" },
    sql: sql as SetupRequest["sql"],
    org: options.org ?? ORG,
    user: USER,
    path: `/sites/${SITE}/${what}`,
    url,
    fetcher: options.fetcher,
  });
}

const site = (): Row => ({ id: SITE, company_id: ORG.id, origin: "https://app.example.com", context: {} });

describe("who may send", () => {
  const appEnv = {
    DATABASE_URL: "postgresql://user:password@ep-test.us-east-1.aws.neon.tech/neondb",
    ACCESS_REQUESTS: { put: async () => {}, get: async () => null },
    RESEND_API_KEY: "re_test",
  };
  const post = (origin: string) =>
    new Request(`https://joinhaptic.com/api/app/sites/${SITE}/developer-email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ to: "dev@example.com", key: "k".repeat(16) }) });

  test("nobody signed in is turned away before anything is looked up", async () => {
    const response = await appApi(post("https://joinhaptic.com"), appEnv, new URL(post("https://joinhaptic.com").url));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Sign in first." });
  });

  test("a request from another site is turned away", async () => {
    const response = await appApi(post("https://evil.example"), appEnv, new URL(post("https://evil.example").url));
    assert.equal(response.status, 403);
  });

  test("someone signed in to another company can't send for this site, and learns nothing about it", async () => {
    const { sent, fetcher } = resend();
    const answer = await call(fakeSql([site()]), { to: "dev@example.com", key: "a".repeat(16) }, { org: OTHER_ORG, fetcher });
    assert.deepEqual(answer, { status: 404, body: { error: "No such site." } });
    assert.equal(sent.length, 0);
  });
});

describe("sending", () => {
  test("the email goes from install@joinhaptic.com, replies go to the person who sent it, and the address itself isn't kept", async () => {
    const rows = [site()];
    const { sent, fetcher } = resend();
    const answer = await call(fakeSql(rows), { to: " Dev@Example.com ", key: "press-0001" }, { fetcher });
    assert.deepEqual(answer, { status: 200, body: { sent: true, to: "dev@example.com" } });
    assert.equal(sent.length, 1);
    const { body, idempotency } = sent[0]!;
    assert.equal(body.from, "Haptic <install@joinhaptic.com>");
    assert.equal(body.from, INSTALL_FROM);
    assert.deepEqual(body.to, ["dev@example.com"]);
    assert.equal(body.reply_to, "dana@example.com");
    assert.equal(body.subject, "Dana Reyes asked you to add Haptic to app.example.com");
    assert.equal(idempotency, `developer-email/${SITE}/press-0001`);
    const kept = rows[0]!.context.developerEmails!;
    assert.equal(kept.length, 1);
    assert.match(kept[0]!.to, /^[0-9a-f]{32}$/);
    assert.ok(!JSON.stringify(rows).includes("dev@example.com"), "only a hash of the address is kept");
  });

  test("a retry of the same press sends the same request to Resend, which sends once, and counts once", async () => {
    const rows = [site()];
    const { sent, fetcher } = resend();
    await call(fakeSql(rows), { to: "dev@example.com", key: "press-0002" }, { fetcher });
    const again = await call(fakeSql(rows), { to: "dev@example.com", key: "press-0002" }, { fetcher });
    assert.equal(again?.status, 200);
    assert.equal(sent.length, 2);
    assert.equal(sent[1]!.idempotency, sent[0]!.idempotency);
    assert.equal(rows[0]!.context.developerEmails!.length, 1);
  });

  test(`no more than ${EMAILS_PER_ADDRESS} to one address in a day`, async () => {
    const rows = [site()];
    const { sent, fetcher } = resend();
    for (let i = 0; i < EMAILS_PER_ADDRESS; i++) assert.equal((await call(fakeSql(rows), { to: "dev@example.com", key: `press-a${i}xxxx` }, { fetcher }))?.status, 200);
    const refused = await call(fakeSql(rows), { to: "DEV@example.com", key: "press-a9xxxx" }, { fetcher });
    assert.equal(refused?.status, 429);
    assert.deepEqual(refused?.body, { error: `dev@example.com has had ${EMAILS_PER_ADDRESS} emails about this site today. Copy the link and send it yourself.`, field: "to" });
    assert.equal(sent.length, EMAILS_PER_ADDRESS);
  });

  test(`no more than ${EMAILS_PER_SITE} from one site in a day, and yesterday's don't count`, async () => {
    const rows = [site()];
    const day = new Date(Date.now() - 25 * 3_600_000).toISOString();
    rows[0]!.context.developerEmails = Array.from({ length: 5 }, (_, i) => ({ at: day, to: `old${i}`, key: `old-key-${i}` }));
    const { sent, fetcher } = resend();
    for (let i = 0; i < EMAILS_PER_SITE; i++) assert.equal((await call(fakeSql(rows), { to: `dev${i}@example.com`, key: `press-b${i}xxxx` }, { fetcher }))?.status, 200, `email ${i + 1}`);
    const refused = await call(fakeSql(rows), { to: "another@example.com", key: "press-bzxxxx" }, { fetcher });
    assert.equal(refused?.status, 429);
    assert.match((refused?.body as { error: string }).error, /This site has sent 10 install emails today/);
    assert.equal(sent.length, EMAILS_PER_SITE);
    assert.equal(rows[0]!.context.developerEmails!.length, EMAILS_PER_SITE, "the day-old ones were dropped as the new ones were kept");
  });

  test("when Resend turns the email down, the person is told, and it doesn't count against the day", async () => {
    const rows = [site()];
    const { fetcher } = resend(403);
    const answer = await call(fakeSql(rows), { to: "dev@example.com", key: "press-c0001" }, { fetcher });
    assert.deepEqual(answer, { status: 502, body: { error: "The email service turned it down, with status 403. Copy the link and send it yourself." } });
    assert.deepEqual(rows[0]!.context.developerEmails, []);
  });

  test("when Resend can't be reached, the person is told that", async () => {
    const answer = await call(fakeSql([site()]), { to: "dev@example.com", key: "press-c0002" }, { fetcher: () => Promise.reject(new Error("timed out")) });
    assert.equal(answer?.status, 502);
    assert.match((answer?.body as { error: string }).error, /^The email service could not be reached\./);
  });

  test("with no Resend key on the server, nothing is tried or kept, and the person is told to copy the link", async () => {
    const rows = [site()];
    const { sent, fetcher } = resend();
    const answer = await call(fakeSql(rows), { to: "dev@example.com", key: "press-d0001" }, { fetcher, key: null });
    assert.deepEqual(answer, { status: 503, body: { error: "Email isn't set up on this server yet. Copy the link and send it yourself." } });
    assert.equal(sent.length, 0);
    assert.equal(rows[0]!.context.developerEmails, undefined);
  });

  test("an address that isn't one, or a missing key, is refused before anything else", async () => {
    const sql = fakeSql([site()]);
    assert.deepEqual(await call(sql, { to: "dev", key: "press-e0001" }), { status: 400, body: { error: "Enter a full email address, like name@company.com.", field: "to" } });
    assert.deepEqual(await call(sql, { to: "dev@example.com" }), { status: 400, body: { error: "Send a key for this email." } });
    assert.deepEqual(await call(sql, { to: "dev@example.com", key: "short" }), { status: 400, body: { error: "Send a key for this email." } });
  });
});

test("the email says who asked, links the install page, and carries the agent prompt and the tag, all escaped", () => {
  const email = developerEmail({
    to: "dev@example.com",
    sender: { email: "dana@example.com", name: 'Dana <script>"x"</script>\nBcc: evil@example.com' },
    siteOrigin: "https://app.example.com",
    siteId: SITE,
    installOrigin: "https://joinhaptic.com",
    scriptUrl: "https://widget.joinhaptic.com/widget.js",
  });
  assert.equal(email.from, "Haptic <install@joinhaptic.com>");
  assert.equal(email.replyTo, "dana@example.com");
  assert.ok(!/[\n\r]/.test(email.subject), "a subject is one line");
  assert.ok(!email.html.includes("<script>"), "the name is escaped");
  assert.ok(email.html.includes(`href="https://joinhaptic.com/install/?site=${SITE}"`));
  assert.ok(email.html.includes(`Add Haptic to this app. Fetch https://joinhaptic.com/install/${SITE}.md and follow it.`));
  assert.ok(email.html.includes("&#60;script src=&#34;https://widget.joinhaptic.com/widget.js&#34; data-site=&#34;site_a1b2c3d4e5f6&#34; async&#62;&#60;/script&#62;"));
  assert.ok(email.text.includes(`https://joinhaptic.com/install/?site=${SITE}`));
  assert.ok(email.text.includes(`<script src="https://widget.joinhaptic.com/widget.js" data-site="${SITE}" async></script>`));
  assert.ok(email.text.includes("(dana@example.com) asked you to add Haptic to app.example.com"));
});

test("where the setup is: one step at a time, Finish later, done, and only for the company's own site", async () => {
  const rows = [site()];
  const sql = fakeSql(rows);
  assert.deepEqual(await call(sql, { step: "install", later: false }, { method: "PUT", what: "setup" }), { status: 200, body: { setup: { step: "install", later: false } } });
  assert.deepEqual(await call(sql, { later: true }, { method: "PUT", what: "setup" }), { status: 200, body: { setup: { step: "install", later: true } } });
  const done = await call(sql, { finished: true }, { method: "PUT", what: "setup" });
  assert.match((done?.body as { setup: { finishedAt: string } }).setup.finishedAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal((await call(sql, { step: "teleport" }, { method: "PUT", what: "setup" }))?.status, 400);
  assert.equal((await call(sql, {}, { method: "PUT", what: "setup" }))?.status, 400);
  assert.equal((await call(sql, { step: "connect" }, { method: "PUT", what: "setup", org: OTHER_ORG }))?.status, 404);
  assert.equal(await call(sql, {}, { method: "GET", what: "setup" }), undefined, "anything else is left to app-api.ts");
});

// The same, with the real queries, against a real Postgres -------------------

describe("against Postgres", { skip: TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a local, empty database to run these" }, () => {
  const reset = () => {
    freshDatabase(DB);
    exec(DB,
      `insert into sites (id, company_id, name, origin, allowed_origins, context) values ('${SITE}', '${ORG.id}', 'Example Co', 'https://app.example.com', '{https://app.example.com}', '{"pages": [{"path": "/"}]}')`,
    );
  };
  const context = async () => ((await psqlSql(DB).query(`select context from sites where id = $1`, [SITE]))[0]!.context as Row["context"]);

  test("sends, keeps a hash, holds the limits and gives back a failed one, leaving the rest of the site alone", async () => {
    reset();
    const sql = psqlSql(DB);
    const { sent, fetcher } = resend();
    assert.equal((await call(sql, { to: "dev@example.com", key: "pg-press-01" }, { org: OTHER_ORG, fetcher }))?.status, 404);
    for (let i = 0; i < EMAILS_PER_ADDRESS; i++) assert.equal((await call(sql, { to: "dev@example.com", key: `pg-press-a${i}` }, { fetcher }))?.status, 200);
    assert.equal((await call(sql, { to: "dev@example.com", key: "pg-press-a0" }, { fetcher }))?.status, 200, "a retry of a press that went");
    assert.equal((await call(sql, { to: "dev@example.com", key: "pg-press-a9" }, { fetcher }))?.status, 429);
    assert.equal((await context()).developerEmails!.length, EMAILS_PER_ADDRESS);
    assert.deepEqual((await context()).pages, [{ path: "/" }], "the pages read are untouched");

    const failing = resend(500);
    assert.equal((await call(sql, { to: "other@example.com", key: "pg-press-f1" }, { fetcher: failing.fetcher }))?.status, 502);
    assert.equal((await context()).developerEmails!.length, EMAILS_PER_ADDRESS, "the failed one was given back");
    assert.equal(sent.length, EMAILS_PER_ADDRESS + 1);
  });

  test("the database holds the day's limit itself, for two presses at the same moment", async () => {
    reset();
    const real = psqlSql(DB);
    const at = new Date().toISOString();
    const full = Array.from({ length: EMAILS_PER_SITE }, (_, i) => ({ at, to: `h${i}`, key: `pg-full-${i}` }));
    exec(DB, `update sites set context = jsonb_set(context, '{developerEmails}', '${JSON.stringify(full)}'::jsonb)`);
    // The Worker read the site a moment before another press filled the day: it sees none sent yet.
    const stale = Object.assign(() => Promise.reject(new Error("not used")), {
      query: async (text: string, params?: unknown[]) => {
        const rows = await real.query(text, params);
        if (text.startsWith("select id, origin, context from sites")) for (const row of rows) (row.context as Row["context"]).developerEmails = [];
        return rows;
      },
      transaction: real.transaction,
    });
    const { sent, fetcher } = resend();
    const answer = await call(stale, { to: "late@example.com", key: "pg-late-01" }, { fetcher });
    assert.deepEqual(answer, { status: 429, body: { error: "Too many emails at once. Wait a moment and try again." } });
    assert.equal(sent.length, 0);
  });

  test("the setup's step is kept in the site, beside what the reader wrote", async () => {
    reset();
    const sql = psqlSql(DB);
    assert.deepEqual(await call(sql, { step: "learned", later: false }, { method: "PUT", what: "setup" }), { status: 200, body: { setup: { step: "learned", later: false } } });
    assert.deepEqual(await call(sql, { later: true }, { method: "PUT", what: "setup" }), { status: 200, body: { setup: { step: "learned", later: true } } });
    assert.deepEqual((await context()).pages, [{ path: "/" }]);
  });
});
