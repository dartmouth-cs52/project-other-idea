import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { emailText, INSTALL_FROM, UnsafeText } from "../web/worker/developer-email.ts";
import {
  EMAILS_PER_ADDRESS,
  EMAILS_PER_COMPANY,
  EMAILS_PER_PERSON,
  EMAILS_PER_SITE,
  forgetOldEmails,
  setupRoutes,
  type SetupRequest,
} from "../web/worker/setup-api.ts";
import { exec, freshDatabase, psqlSql, TEST_DATABASE_URL, testDatabase } from "./psql.ts";

/** This file's own database, when TEST_DATABASE_URL is set. */
const DB = testDatabase("developer_email");

// "Email it to my developer": only someone signed in to the company that owns
// the site can send. In any 24 hours one mailbox gets at most 3, a site sends
// at most 10, a company 20 and one person 10, counted in a table that deleting
// a site doesn't touch. A retry of one press never sends twice, and a failure
// says why and doesn't count. Signed out (401) and from another site (403) are
// answered by app-api.ts first, and are tested in web/test/worker.test.ts.

const ORG = { id: "00000000-0000-4000-8000-000000000001", name: "Example Co", role: "owner" };
const OTHER_ORG = { id: "00000000-0000-4000-8000-000000000002", name: "Other Co", role: "owner" };
const USER = { id: "00000000-0000-4000-8000-0000000000aa", email: "dana@example.com", name: "Dana Reyes", emailVerified: true };
const COLLEAGUE = { id: "00000000-0000-4000-8000-0000000000bb", email: "sam@example.com", name: "Sam", emailVerified: true };
const SITE = "site_a1b2c3d4e5f6";

interface Row {
  id: string;
  company_id: string;
  origin: string;
  context: Record<string, unknown>;
}

/**
 * The sites table in memory, for what happens before an email is counted: the
 * site's company, and where the setup is. With `noTable`, the emails table is
 * missing, as on a Worker deployed before db/migrations/0013 is applied.
 */
function fakeSql(rows: Row[], options: { noTable?: boolean } = {}) {
  const find = (id: unknown, org: unknown) => rows.find((row) => row.id === id && row.company_id === org);
  const query = async (text: string, params: unknown[] = []) => {
    if (text.includes("developer_emails")) {
      if (options.noTable) throw Object.assign(new Error('relation "developer_emails" does not exist'), { code: "42P01" });
      throw new Error("The fake doesn't count emails. Those tests run against Postgres.");
    }
    const row = find(params[0], params[1]);
    if (text.startsWith("select id, origin, context from sites")) return row ? [structuredClone(row)] : [];
    if (text.includes("'{setup}'")) {
      if (!row) return [];
      row.context.setup = { ...(row.context.setup as object), ...JSON.parse(String(params[2])) };
      return [{ setup: row.context.setup }];
    }
    throw new Error(`The fake doesn't know this query: ${text.slice(0, 80)}`);
  };
  return Object.assign(() => Promise.reject(new Error("not used")), { query, transaction: (queries: Promise<unknown>[]) => Promise.all(queries) });
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

/**
 * Resend, as its documentation describes idempotency keys: the same key with the same body answers as the
 * first time without sending again, and the same key with a different body is a 409. It keeps who got what.
 */
function resendLikeTheDocs() {
  const delivered: string[] = [];
  const seen = new Map<string, { body: string; id: string }>();
  const fetcher = async (_url: string, init?: RequestInit) => {
    const key = new Headers(init?.headers).get("idempotency-key") ?? "";
    const body = String(init?.body);
    const before = seen.get(key);
    if (before && before.body === body) return Response.json({ id: before.id });
    if (before) return Response.json({ statusCode: 409, name: "invalid_idempotent_request", message: "Same idempotency key used with a different request payload." }, { status: 409 });
    const id = `email_${delivered.length + 1}`;
    seen.set(key, { body, id });
    delivered.push((JSON.parse(body) as { to: string[] }).to[0]!);
    return Response.json({ id });
  };
  return { delivered, fetcher };
}

function call(
  sql: unknown,
  body: unknown,
  options: { org?: typeof ORG; user?: typeof USER; site?: string; fetcher?: SetupRequest["fetcher"]; key?: string | null; method?: string; what?: string } = {},
) {
  const what = options.what ?? "developer-email";
  const site = options.site ?? SITE;
  const url = new URL(`https://joinhaptic.com/api/app/sites/${site}/${what}`);
  return setupRoutes({
    request: new Request(url, { method: options.method ?? "POST", body: options.method === "GET" ? undefined : JSON.stringify(body) }),
    env: { RESEND_API_KEY: options.key === null ? undefined : (options.key ?? "re_test"), WIDGET_URL: "https://widget.joinhaptic.com" },
    sql: sql as SetupRequest["sql"],
    org: options.org ?? ORG,
    user: options.user ?? USER,
    path: `/sites/${site}/${what}`,
    url,
    fetcher: options.fetcher,
  });
}

const site = (): Row => ({ id: SITE, company_id: ORG.id, origin: "https://app.example.com", context: {} });

describe("before anything is counted", () => {
  test("someone signed in to another company can't send for this site, and learns nothing about it", async () => {
    const { sent, fetcher } = resend();
    const answer = await call(fakeSql([site()]), { to: "dev@example.com", key: "a".repeat(16) }, { org: OTHER_ORG, fetcher });
    assert.deepEqual(answer, { status: 404, body: { error: "No such site." } });
    assert.equal(sent.length, 0);
  });

  test("an address that isn't one, or a missing key, is refused before anything else", async () => {
    const sql = fakeSql([site()]);
    assert.deepEqual(await call(sql, { to: "dev", key: "press-e0001" }), { status: 400, body: { error: "Enter a full email address, like name@company.com.", field: "to" } });
    assert.deepEqual(await call(sql, { to: "dev@example.com" }), { status: 400, body: { error: "Send a key for this email." } });
    assert.deepEqual(await call(sql, { to: "dev@example.com", key: "short" }), { status: 400, body: { error: "Send a key for this email." } });
  });

  test("with no Resend key on the server, nothing is tried, and the person is told to copy the link", async () => {
    const { sent, fetcher } = resend();
    const answer = await call(fakeSql([site()]), { to: "dev@example.com", key: "press-d0001" }, { fetcher, key: null });
    assert.deepEqual(answer, { status: 503, body: { error: "Email isn't set up on this server yet. Copy the link and send it yourself." } });
    assert.equal(sent.length, 0);
  });

  test("on a Worker deployed before the emails table exists, nothing is sent, and the person is told to copy the link", async () => {
    const { sent, fetcher } = resend();
    const answer = await call(fakeSql([site()], { noTable: true }), { to: "dev@example.com", key: "press-d0002" }, { fetcher });
    assert.deepEqual(answer, { status: 503, body: { error: "Email isn't set up on this server yet. Copy the link and send it yourself." } });
    assert.equal(sent.length, 0);
  });
});

test("nothing that can carry a web address, an @ or an invisible character reaches an email from the site's own fields", () => {
  assert.equal(emailText("app.example.com"), "app.example.com");
  assert.equal(emailText("app\u202eexample.com\u200b"), "appexample.com", "right-to-left overrides and zero-width characters are taken out");
  assert.equal(emailText("dana@example.com", { at: true }), "dana@example.com");
  assert.throws(() => emailText("https://evil.example/h"), UnsafeText);
  assert.throws(() => emailText("evil@example.com"), UnsafeText, "an @ where none belongs");
  assert.throws(() => emailText("a@b.com@c.com", { at: true }), UnsafeText);
  assert.throws(() => emailText("dana@example.com", { at: false }), UnsafeText);
});

test("a new address is checked like any other, and only for the company's own site", async () => {
  const sql = fakeSql([site()]);
  assert.deepEqual(await call(sql, { url: "acme" }, { method: "PUT", what: "address" }), { status: 400, body: { error: "That address is missing its domain, like .com.", field: "url" } });
  assert.equal((await call(sql, { url: "www.example.com" }, { method: "PUT", what: "address", org: OTHER_ORG }))?.status, 404);
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

// Sending and counting, with the real queries, against a real Postgres. CI runs these with a Postgres of its own.

describe("sending and counting, against Postgres", { skip: TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a local, empty database to run these" }, () => {
  const addSite = (id: string, org = ORG.id) =>
    exec(DB, `insert into sites (id, company_id, name, origin, allowed_origins, context) values ('${id}', '${org}', 'Example Co', 'https://app.example.com', '{https://app.example.com}', '{"pages": [{"path": "/"}]}')`);
  const reset = () => {
    freshDatabase(DB);
    addSite(SITE);
  };
  const sql = () => psqlSql(DB);
  const rows = async () => (await sql().query(`select * from developer_emails order by sent_at`)) as { key: string; company_id: string; site_id: string; sender: string; recipient: string; sent_at: string }[];
  const context = async () => (await sql().query(`select context from sites where id = $1`, [SITE]))[0]!.context as Row["context"];
  let presses = 0;
  const press = () => `press-${String(++presses).padStart(6, "0")}`;

  test("the email goes from install@joinhaptic.com with replies to the sender, and only a hash of the mailbox is kept, with the site, company, sender and time", async () => {
    reset();
    const { sent, fetcher } = resend();
    const answer = await call(sql(), { to: " Dev@Example.com ", key: "press-0001" }, { fetcher });
    assert.deepEqual(answer, { status: 200, body: { sent: true, to: "dev@example.com" } });
    assert.equal(sent.length, 1);
    const { body, idempotency } = sent[0]!;
    assert.equal(body.from, INSTALL_FROM);
    assert.deepEqual(body.to, ["dev@example.com"]);
    assert.equal(body.reply_to, "dana@example.com");
    assert.match(idempotency ?? "", new RegExp(`^developer-email/${SITE}/[0-9a-f]{32}$`), "the press's key, bound to the site and the address");
    assert.ok(!idempotency?.includes("press-0001"));
    const [row] = await rows();
    assert.deepEqual(Object.keys(row!).sort(), ["company_id", "key", "recipient", "sender", "sent_at", "site_id"]);
    assert.equal(row!.site_id, SITE);
    assert.equal(row!.company_id, ORG.id);
    assert.equal(row!.sender, USER.id);
    assert.match(row!.recipient, /^[0-9a-f]{32}$/);
    assert.ok(!JSON.stringify(await rows()).includes("example.com"), "the address itself is not kept");
    assert.deepEqual((await context()).pages, [{ path: "/" }], "the site is untouched");
  });

  /** The review's six hostile cases: whatever name the sender gave themselves, and whatever site they added. */
  const hostile: [string, { name: string; email?: string; origin?: string }][] = [
    ["plain", { name: "Dana Reyes" }],
    ["html", { name: `"><img src=x onerror=alert(1)><a href='https://evil.example'>click</a>` }],
    ["header", { name: "Dana\r\nBcc: evil@example.com\r\n\r\n<b>body</b> X\u0085Y\u202egnp.exe" }],
    ["phish", { name: "Haptic Security: your account is locked. Verify now at https://evil.example/h", email: "attacker@evil.example", origin: "https://accounts.google.com" }],
    ["no name", { name: "   " }],
    ["long host", { name: "D", origin: `https://${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.example.com:8443` }],
  ];
  for (const [name, input] of hostile) {
    test(`the email carries no text the sender chose, only their sign-in address and the site's host: ${name}`, async () => {
      reset();
      const origin = input.origin ?? "https://app.example.com";
      exec(DB, `update sites set origin = '${origin}' where id = '${SITE}'`);
      const sender = { ...USER, name: input.name, email: input.email ?? USER.email };
      const { sent, fetcher } = resend();
      assert.equal((await call(sql(), { to: "dev@example.com", key: press() }, { fetcher, user: sender }))?.status, 200);
      const { body } = sent[0]!;
      const host = new URL(origin).host;
      assert.equal(body.subject, `${sender.email} asked you to add Haptic to ${host}`);
      assert.equal(body.reply_to, sender.email);
      for (const part of [body.subject, body.html, body.text]) {
        if (input.name.trim().length > 1) assert.ok(!part.includes(input.name.trim()), "the name never appears");
        assert.ok(!/evil\.example\/h|onerror|<b>body|Bcc:/i.test(part), "nothing from the name gets in");
        assert.ok(!/[\u0085\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(part), "no invisible or direction-changing characters");
      }
      assert.ok(!/[\u0000-\u001f]/.test(body.subject), "the subject is one line");
      assert.ok(body.text.includes(`If you don't know ${sender.email}, ignore this email.`));
      assert.ok(body.html.includes(`If you don&#39;t know ${sender.email}, ignore this email.`));
      const hrefs = [...body.html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
      assert.deepEqual(hrefs, [`https://joinhaptic.com/install/?site=${SITE}`, "https://joinhaptic.com"], "the only links are Haptic's");
    });
  }

  test("the email links the install page and carries the agent prompt and the tag, escaped", async () => {
    reset();
    const { sent, fetcher } = resend();
    await call(sql(), { to: "dev@example.com", key: press() }, { fetcher });
    const { html, text } = sent[0]!.body;
    assert.ok(html.includes(`Add Haptic to this app. Fetch https://joinhaptic.com/install/${SITE}.md and follow it.`));
    assert.ok(html.includes("&#60;script src=&#34;https://widget.joinhaptic.com/widget.js&#34; data-site=&#34;site_a1b2c3d4e5f6&#34; async&#62;&#60;/script&#62;"));
    assert.ok(text.includes(`https://joinhaptic.com/install/?site=${SITE}`));
    assert.ok(text.includes(`<script src="https://widget.joinhaptic.com/widget.js" data-site="${SITE}" async></script>`));
  });

  test("a retry of the same press sends the same request to Resend, which sends once, and counts once", async () => {
    reset();
    const { sent, fetcher } = resend();
    await call(sql(), { to: "dev@example.com", key: "press-0002" }, { fetcher });
    assert.equal((await call(sql(), { to: "dev@example.com", key: "press-0002" }, { fetcher }))?.status, 200);
    assert.equal(sent.length, 2);
    assert.equal(sent[1]!.idempotency, sent[0]!.idempotency);
    assert.equal((await rows()).length, 1);
  });

  test("a key sent again with another address can't take an email off the count, so one address still gets at most 3", async () => {
    reset();
    const resend = resendLikeTheDocs();
    for (let round = 0; round < 40; round++) {
      const key = `probe-key-${String(round).padStart(4, "0")}`;
      await call(sql(), { to: "victim@example.org", key }, { fetcher: resend.fetcher });
      await call(sql(), { to: `x${round}@example.net`, key }, { fetcher: resend.fetcher });
    }
    assert.equal(resend.delivered.filter((to) => to === "victim@example.org").length, EMAILS_PER_ADDRESS);
    assert.ok(resend.delivered.length <= EMAILS_PER_SITE, `${resend.delivered.length} delivered from one site`);
  });

  test("Resend answering 409 for a key it has seen means the email went, so it stays counted and the person is told it was sent", async () => {
    reset();
    const conflict = async () => Response.json({ statusCode: 409, name: "invalid_idempotent_request", message: "Same idempotency key used with a different request payload." }, { status: 409 });
    assert.deepEqual(await call(sql(), { to: "dev@example.com", key: "press-409x" }, { fetcher: conflict }), { status: 200, body: { sent: true, to: "dev@example.com" } });
    assert.equal((await rows()).length, 1);
  });

  test("when Resend turns the email down or can't be reached, the person is told why, and it doesn't count", async () => {
    reset();
    assert.deepEqual(await call(sql(), { to: "dev@example.com", key: "press-c0001" }, { fetcher: resend(403).fetcher }), {
      status: 502,
      body: { error: "The email service turned it down, with status 403. Copy the link and send it yourself." },
    });
    const unreachable = await call(sql(), { to: "dev@example.com", key: "press-c0002" }, { fetcher: () => Promise.reject(new Error("timed out")) });
    assert.equal(unreachable?.status, 502);
    assert.match((unreachable?.body as { error: string }).error, /^The email service could not be reached\./);
    assert.equal((await rows()).length, 0);
  });

  test(`one mailbox gets at most ${EMAILS_PER_ADDRESS} a day, however its address is written`, async () => {
    reset();
    const { sent, fetcher } = resend();
    const spellings = ["victim@gmail.com", "VICTIM@gmail.com", "victim+1@gmail.com", "v.ictim@gmail.com", "vic.tim+x@googlemail.com", "Victim@GoogleMail.com"];
    const answers = [];
    for (const to of spellings) answers.push((await call(sql(), { to, key: press() }, { fetcher }))?.status);
    assert.deepEqual(answers, [200, 200, 200, 429, 429, 429]);
    assert.equal(sent.length, EMAILS_PER_ADDRESS);
    const elsewhere = await call(sql(), { to: "jane+news@example.org", key: press() }, { fetcher });
    assert.equal(elsewhere?.status, 200, "another mailbox is still fine");
    // A +tag on any domain is the same mailbox. Dots only count on Gmail.
    for (const to of ["jane+a@example.org", "jane+b@example.org"]) assert.equal((await call(sql(), { to, key: press() }, { fetcher }))?.status, 200);
    assert.equal((await call(sql(), { to: "jane+c@example.org", key: press() }, { fetcher }))?.status, 429);
    assert.equal((await call(sql(), { to: "ja.ne@example.org", key: press() }, { fetcher }))?.status, 200);
  });

  test(`a site sends at most ${EMAILS_PER_SITE} a day, and deleting it and adding it again doesn't reset that`, async () => {
    reset();
    const { sent, fetcher } = resend();
    for (let i = 0; i < EMAILS_PER_SITE; i++) assert.equal((await call(sql(), { to: `dev${i}@example.com`, key: press() }, { fetcher }))?.status, 200, `email ${i + 1}`);
    const refused = await call(sql(), { to: "another@example.com", key: press() }, { fetcher });
    assert.equal(refused?.status, 429);
    assert.match((refused?.body as { error: string }).error, /This site has sent 10 install emails today/);
    // What DELETE /api/app/sites/:id and then POST /api/app/sites do to the row.
    exec(DB, `delete from sites where id = '${SITE}'`);
    addSite(SITE);
    assert.equal((await call(sql(), { to: "after@example.com", key: press() }, { fetcher }))?.status, 429);
    assert.equal(sent.length, EMAILS_PER_SITE);
  });

  test(`a company sends at most ${EMAILS_PER_COMPANY} a day across its sites, and one person at most ${EMAILS_PER_PERSON}`, async () => {
    reset();
    for (let s = 1; s < 5; s++) addSite(`site_more000${s}`);
    const { sent, fetcher } = resend();
    // One person, across three sites: 10, then no more, though no site has had 10.
    const mine = [];
    for (let i = 0; i < 12; i++) mine.push((await call(sql(), { to: `p${i}@example.com`, key: press() }, { fetcher, site: i % 3 === 0 ? SITE : `site_more000${i % 3}` }))?.status);
    assert.equal(mine.filter((status) => status === 200).length, EMAILS_PER_PERSON);
    const person = await call(sql(), { to: "late@example.com", key: press() }, { fetcher, site: "site_more0004" });
    assert.match((person?.body as { error: string }).error, /You have sent 10 install emails today/);
    // A colleague, on the other sites: the company stops at 20 in all.
    const theirs = [];
    for (let i = 0; i < 12; i++) theirs.push((await call(sql(), { to: `c${i}@example.com`, key: press() }, { fetcher, user: COLLEAGUE, site: i % 2 ? "site_more0003" : "site_more0004" }))?.status);
    assert.equal(theirs.filter((status) => status === 200).length, EMAILS_PER_COMPANY - EMAILS_PER_PERSON);
    assert.match(((await call(sql(), { to: "z@example.com", key: press() }, { fetcher, user: COLLEAGUE, site: "site_more0004" }))?.body as { error: string }).error, /Your company has sent 20/);
    assert.equal(sent.length, EMAILS_PER_COMPANY);
  });

  test("the database holds the limits itself, when presses race", async () => {
    reset();
    const { sent, fetcher } = resend();
    // Thirty presses at the same moment on one site: ten go.
    const site = await Promise.all(Array.from({ length: 30 }, (_, i) => call(sql(), { to: `race${i}@example.org`, key: press() }, { fetcher })));
    assert.equal(site.filter((answer) => answer?.status === 200).length, EMAILS_PER_SITE);
    assert.equal(sent.length, EMAILS_PER_SITE);

    // Two companies at the same moment, to one mailbox: three go between them.
    reset();
    addSite("site_other0001", OTHER_ORG.id);
    const mailbox = resend();
    const answers = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        call(sql(), { to: "shared@example.net", key: press() }, { fetcher: mailbox.fetcher, ...(i % 2 ? { org: OTHER_ORG, site: "site_other0001", user: COLLEAGUE } : {}) }),
      ),
    );
    assert.equal(answers.filter((answer) => answer?.status === 200).length, EMAILS_PER_ADDRESS);
    assert.equal(mailbox.sent.length, EMAILS_PER_ADDRESS);
  });

  test("records older than a day are deleted with the next email, and by the daily run", async () => {
    reset();
    exec(DB, `insert into developer_emails (key, company_id, site_id, sender, recipient, sent_at) values ('old1', '${ORG.id}', '${SITE}', 'u', 'r', now() - interval '25 hours'), ('old2', '${ORG.id}', '${SITE}', 'u', 'r', now() - interval '2 days')`);
    await call(sql(), { to: "dev@example.com", key: press() }, { fetcher: resend().fetcher });
    assert.deepEqual((await rows()).map((row) => row.key).filter((key) => key.startsWith("old")), []);
    exec(DB, `insert into developer_emails (key, company_id, site_id, sender, recipient, sent_at) values ('old3', '${ORG.id}', '${SITE}', 'u', 'r', now() - interval '30 hours')`);
    await forgetOldEmails(sql() as unknown as SetupRequest["sql"]);
    assert.equal((await rows()).length, 1);
  });

  test("a new address for a site the script has never called from changes it in place, keeping everything set up", async () => {
    reset();
    exec(
      DB,
      `update sites set allowed_origins = '{https://app.example.com,https://staging.example.com}', reading = '{"queue":[],"seen":["/"],"failed":[],"thin":[],"max":30,"startedAt":"2026-11-16T00:00:00Z","finishedAt":"2026-11-16T00:01:00Z"}',
        context = '{"origin":"https://app.example.com","notes":"Invoices live under Billing.","docs":[{"title":"Help","source":"pasted:help","text":"x"}],"corrections":[{"id":"c1"}],"blocked":[{"label":"Delete"}],"pages":[{"path":"/old"}],"source":{"url":"https://app.example.com/","maxPages":30,"docs":[]},"setup":{"step":"reading"}}'
        where id = '${SITE}'`,
    );
    const answer = await call(sql(), { url: "www.example.com/start" }, { method: "PUT", what: "address" });
    assert.deepEqual(answer, { status: 200, body: { id: SITE, origin: "https://www.example.com" } });
    const [row] = (await sql().query(`select origin, allowed_origins, reading, context from sites where id = $1`, [SITE])) as { origin: string; allowed_origins: string[]; reading: { queue: string[]; seen: string[]; finishedAt?: string }; context: Record<string, unknown> }[];
    assert.equal(row!.origin, "https://www.example.com");
    assert.deepEqual(row!.allowed_origins, ["https://www.example.com", "https://staging.example.com"], "the old address is replaced, the others kept");
    assert.deepEqual(row!.reading.queue, ["https://www.example.com/start"]);
    assert.equal(row!.reading.finishedAt, undefined, "reading starts again");
    assert.deepEqual(row!.context.pages, [], "the old site's pages go");
    assert.equal(row!.context.notes, "Invoices live under Billing.");
    assert.deepEqual(row!.context.blocked, [{ label: "Delete" }]);
    assert.deepEqual(row!.context.corrections, [{ id: "c1" }]);
    assert.equal((row!.context.docs as unknown[]).length, 1);
    assert.deepEqual(row!.context.setup, { step: "reading" });
    assert.equal((row!.context.source as { url: string }).url, "https://www.example.com/start");
  });

  test("once the script has called from anywhere, the address can't change here, and nothing is touched", async () => {
    reset();
    exec(DB, `insert into site_origins (site_id, origin, allowed) values ('${SITE}', 'http://localhost:3000', false)`);
    const answer = await call(sql(), { url: "www.example.com" }, { method: "PUT", what: "address" });
    assert.equal(answer?.status, 409);
    assert.match((answer?.body as { error: string }).error, /already run/);
    assert.equal((await sql().query(`select origin from sites where id = $1`, [SITE]))[0]!.origin, "https://app.example.com");
  });

  test("the setup's step is kept in the site, beside what the reader wrote", async () => {
    reset();
    assert.deepEqual(await call(sql(), { step: "learned", later: false }, { method: "PUT", what: "setup" }), { status: 200, body: { setup: { step: "learned", later: false } } });
    assert.deepEqual(await call(sql(), { later: true }, { method: "PUT", what: "setup" }), { status: 200, body: { setup: { step: "learned", later: true } } });
    assert.deepEqual((await context()).pages, [{ path: "/" }]);
  });
});
