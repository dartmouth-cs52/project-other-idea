import assert from "node:assert/strict";
import { before, beforeEach, describe, test } from "node:test";
import { organizationOf } from "../web/worker/db.ts";
import { INVITES_PER_DAY, teamRoutes, type TeamRequest } from "../web/worker/team.ts";
import { exec, freshDatabase, psqlSql, TEST_DATABASE_URL, testDatabase } from "./psql.ts";

// The dashboard's Team page: who is at the company, adding people, roles and
// removing people. Neon Auth keeps people and companies in its own schema,
// which is made here with the columns production has.
//
// A first sign-in (joinOrganization in web/worker/db.ts) lets someone in
// exactly when an approval of their address or its domain exists, and puts
// them in the company that approval names. Its one query writes inside a WITH,
// which the psql stand-in for Neon can't run, so these tests check the
// approvals it reads, and then make the membership it would.

const DB = testDatabase("team");
const ORG = "00000000-0000-4000-8000-00000000a001";
const OTHER_ORG = "00000000-0000-4000-8000-00000000a002";
const OWNER = "00000000-0000-4000-8000-00000000b001";
const ADMIN = "00000000-0000-4000-8000-00000000b002";
const MEMBER = "00000000-0000-4000-8000-00000000b003";
const DOMAIN_MEMBER = "00000000-0000-4000-8000-00000000b004";
const STRANGER = "00000000-0000-4000-8000-00000000b005";

const NEON_AUTH = `
  drop schema if exists neon_auth cascade;
  create schema neon_auth;
  create table neon_auth."user" (id uuid primary key, name text, email text not null, "emailVerified" boolean not null default true, "createdAt" timestamptz not null default now());
  create table neon_auth.organization (id uuid primary key default gen_random_uuid(), name text not null, slug text, "createdAt" timestamptz not null default now());
  create table neon_auth.member (id uuid primary key default gen_random_uuid(), "organizationId" uuid not null, "userId" uuid not null, role text not null, "createdAt" timestamptz not null default now());`;

function seed() {
  exec(
    DB,
    `${NEON_AUTH}
    insert into neon_auth."user" (id, name, email) values
      ('${OWNER}', 'Olive Owner', 'olive@acme.test'),
      ('${ADMIN}', 'Ada Admin', 'ada@acme.test'),
      ('${MEMBER}', 'Max Member', 'max@acme.test'),
      ('${DOMAIN_MEMBER}', 'Dee Domain', 'dee@acme-group.test'),
      ('${STRANGER}', 'Sam Stranger', 'sam@other.test');
    insert into neon_auth.organization (id, name, slug) values ('${ORG}', 'Acme', 'acme'), ('${OTHER_ORG}', 'Other', 'other');
    insert into neon_auth.member ("organizationId", "userId", role, "createdAt") values
      ('${ORG}', '${OWNER}', 'owner', now() - interval '3 days'),
      ('${ORG}', '${ADMIN}', 'admin', now() - interval '2 days'),
      ('${ORG}', '${MEMBER}', 'member', now() - interval '1 day'),
      ('${ORG}', '${DOMAIN_MEMBER}', 'member', now()),
      ('${OTHER_ORG}', '${STRANGER}', 'owner', now());
    truncate approvals;
    insert into approvals (email, company, organization_id) values
      ('olive@acme.test', 'Acme', '${ORG}'), ('ada@acme.test', 'Acme', '${ORG}'), ('max@acme.test', 'Acme', '${ORG}'), ('sam@other.test', 'Other', '${OTHER_ORG}');
    insert into approvals (domain, company, organization_id) values ('acme-group.test', 'Acme', '${ORG}');`,
  );
}

const ROLES: Record<string, string> = { [OWNER]: "owner", [ADMIN]: "admin", [MEMBER]: "member", [STRANGER]: "owner" };

let links: string[] = [];
function call(as: string, path: string, method = "GET", body?: unknown) {
  const email = { [OWNER]: "olive@acme.test", [ADMIN]: "ada@acme.test", [MEMBER]: "max@acme.test", [STRANGER]: "sam@other.test" }[as]!;
  const org = as === STRANGER ? { id: OTHER_ORG, name: "Other", role: "owner" } : { id: ORG, name: "Acme", role: ROLES[as]! };
  return teamRoutes({
    request: new Request(`https://joinhaptic.com/api/app${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }),
    sql: psqlSql(DB) as never,
    org,
    user: { id: as, email },
    path,
    sendLink: async (to) => (links.push(to), true),
  } satisfies TeamRequest) as Promise<{ status: number; body: Record<string, any> }>;
}

async function memberId(user: string): Promise<string> {
  const [row] = await psqlSql(DB)`select id from neon_auth.member where "userId" = ${user}::uuid`;
  return String(row!.id);
}

/** The companies a first sign-in from this address would join: what joinOrganization reads. */
async function approvalsFor(email: string): Promise<string[]> {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const rows = await psqlSql(DB)`select distinct organization_id from approvals where email = ${email} or domain = ${domain}`;
  return rows.map((row) => String(row.organization_id));
}

describe("the Team page", { skip: !TEST_DATABASE_URL && "set TEST_DATABASE_URL to run against Postgres" }, () => {
  before(() => freshDatabase(DB));
  beforeEach(() => {
    seed();
    links = [];
  });

  test("everyone at the company sees everyone, owner first; a member can change nothing", async () => {
    const page = await call(MEMBER, "/team");
    assert.equal(page.status, 200);
    assert.equal(page.body.canManage, false);
    assert.deepEqual(
      page.body.members.map((m: any) => [m.email, m.role, m.you]),
      [
        ["olive@acme.test", "owner", false],
        ["ada@acme.test", "admin", false],
        ["max@acme.test", "member", true],
        ["dee@acme-group.test", "member", false],
      ],
    );
    assert.deepEqual(page.body.domains, ["acme-group.test"]);
    assert.equal((await call(MEMBER, "/team/invites", "POST", { email: "new@acme.test" })).status, 403);
    assert.equal((await call(MEMBER, `/team/members/${await memberId(DOMAIN_MEMBER)}`, "PATCH", { role: "admin" })).status, 403);
    assert.equal((await call(MEMBER, `/team/members/${await memberId(DOMAIN_MEMBER)}`, "DELETE")).status, 403);
    assert.deepEqual(links, []);
  });

  test("an admin adds someone, who is invited until their first sign-in puts them on the team", async () => {
    const added = await call(ADMIN, "/team/invites", "POST", { email: "  New.Person@Acme.test " });
    assert.equal(added.status, 201);
    assert.equal(added.body.email, "new.person@acme.test");
    assert.equal(added.body.sent, true);
    assert.deepEqual(links, ["new.person@acme.test"]);
    assert.deepEqual(
      added.body.invites.map((i: any) => [i.email, i.invitedBy]),
      [["new.person@acme.test", "Ada Admin"]],
    );

    // What their first sign-in reads: an approval of their address, for this company.
    assert.deepEqual(await approvalsFor("new.person@acme.test"), [ORG]);
    // And what it makes of it: a member of that company.
    const id = "00000000-0000-4000-8000-00000000b0aa";
    exec(
      DB,
      `insert into neon_auth."user" (id, name, email) values ('${id}', 'New Person', 'new.person@acme.test');
       insert into neon_auth.member ("organizationId", "userId", role) values ('${ORG}', '${id}', 'member');`,
    );
    assert.deepEqual(await organizationOf(psqlSql(DB) as never, id), { id: ORG, name: "Acme", role: "member" });

    const page = await call(OWNER, "/team");
    assert.deepEqual(page.body.invites, []);
    assert.ok(page.body.members.some((m: any) => m.email === "new.person@acme.test" && m.role === "member"));
  });

  test("adding the same address again only sends the email again", async () => {
    await call(OWNER, "/team/invites", "POST", { email: "new@acme.test" });
    const again = await call(OWNER, "/team/invites", "POST", { email: "new@acme.test" });
    assert.equal(again.status, 201);
    assert.equal(again.body.invites.length, 1);
    assert.deepEqual(links, ["new@acme.test", "new@acme.test"]);
  });

  test("someone already on the team, at another company, or approved for one, isn't added", async () => {
    const member = await call(ADMIN, "/team/invites", "POST", { email: "max@acme.test" });
    assert.equal(member.status, 409);
    assert.equal(member.body.field, "email");
    assert.equal((await call(ADMIN, "/team/invites", "POST", { email: "sam@other.test" })).status, 409);
    exec(DB, `insert into approvals (email, company) values ('waiting@else.test', 'Else');`);
    assert.equal((await call(ADMIN, "/team/invites", "POST", { email: "waiting@else.test" })).status, 409);
    const bad = await call(ADMIN, "/team/invites", "POST", { email: "not an email" });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.field, "email");
    assert.deepEqual(links, []);
  });

  test(`a company adds at most ${INVITES_PER_DAY} people a day`, async () => {
    exec(
      DB,
      `insert into approvals (email, company, organization_id, invited_by)
       select 'p' || n || '@acme.test', 'Acme', '${ORG}', '${ADMIN}' from generate_series(1, ${INVITES_PER_DAY}) n;`,
    );
    assert.equal((await call(ADMIN, "/team/invites", "POST", { email: "one-more@acme.test" })).status, 429);
  });

  test("an invitation can be taken back, and the company's own approvals can't", async () => {
    const added = await call(ADMIN, "/team/invites", "POST", { email: "new@acme.test" });
    const invite = added.body.invites[0].id;
    const taken = await call(OWNER, `/team/invites/${invite}`, "DELETE");
    assert.equal(taken.status, 200);
    assert.deepEqual(taken.body.invites, []);
    const [original] = await psqlSql(DB)`select id from approvals where email = 'olive@acme.test'`;
    assert.equal((await call(OWNER, `/team/invites/${original!.id}`, "DELETE")).status, 404);
  });

  test("an owner or admin makes people admins and members again", async () => {
    const max = await memberId(MEMBER);
    const promoted = await call(ADMIN, `/team/members/${max}`, "PATCH", { role: "admin" });
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.members.find((m: any) => m.id === max).role, "admin");
    const demoted = await call(OWNER, `/team/members/${max}`, "PATCH", { role: "member" });
    assert.equal(demoted.body.members.find((m: any) => m.id === max).role, "member");
    assert.equal((await call(OWNER, `/team/members/${max}`, "PATCH", { role: "owner" })).status, 400);
  });

  test("nobody changes the owner or themselves, or someone at another company", async () => {
    assert.equal((await call(ADMIN, `/team/members/${await memberId(OWNER)}`, "PATCH", { role: "member" })).status, 403);
    assert.equal((await call(ADMIN, `/team/members/${await memberId(OWNER)}`, "DELETE")).status, 403);
    assert.equal((await call(ADMIN, `/team/members/${await memberId(ADMIN)}`, "PATCH", { role: "member" })).status, 403);
    assert.equal((await call(STRANGER, `/team/members/${await memberId(MEMBER)}`, "PATCH", { role: "admin" })).status, 404);
    const [owner] = await psqlSql(DB)`select role from neon_auth.member where "userId" = ${OWNER}::uuid`;
    assert.equal(owner!.role, "owner");
  });

  test("someone removed loses access and doesn't get back in by signing in", async () => {
    const removed = await call(ADMIN, `/team/members/${await memberId(MEMBER)}`, "DELETE");
    assert.equal(removed.status, 200);
    assert.ok(!removed.body.members.some((m: any) => m.email === "max@acme.test"));
    assert.equal(await organizationOf(psqlSql(DB) as never, MEMBER), undefined);
    // Nothing approves their address or its domain any more, so a sign-in doesn't put them back.
    assert.deepEqual(await approvalsFor("max@acme.test"), []);
    // The company keeps the approvals that let everyone else in.
    assert.ok(await organizationOf(psqlSql(DB) as never, OWNER));
  });

  test("someone their whole email domain lets in can't be removed here, and is told why", async () => {
    const refused = await call(OWNER, `/team/members/${await memberId(DOMAIN_MEMBER)}`, "DELETE");
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /@acme-group\.test/);
    const [still] = await psqlSql(DB)`select 1 from neon_auth.member where "userId" = ${DOMAIN_MEMBER}::uuid`;
    assert.ok(still);
  });
});
