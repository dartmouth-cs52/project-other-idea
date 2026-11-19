// The company's Team page, /dashboard/?view=team.
//
//   GET    /api/app/team                    everyone at the company, the people invited, and who may change what
//   POST   /api/app/team/invites            add someone by email
//   DELETE /api/app/team/invites/:id        take an invitation back
//   PATCH  /api/app/team/members/:id        make someone an admin, or a member again
//   DELETE /api/app/team/members/:id        take someone off the team
//
// A company is a Neon Auth organization, and its people are rows in
// neon_auth.member, each an owner, an admin or a member. Everyone at the
// company sees the page. Owners and admins add people, change roles and remove
// people, and they are also the ones who may pay (billing.ts). Nobody can
// change or remove the owner, or change or remove themselves, so a company
// always keeps someone who can manage it.
//
// Sign-up stays invite only. Adding someone approves their address for this
// company, which is what approving an access request does, and emails them a
// sign-in link. Their first sign-in puts them on the team as a member
// (joinOrganization in db.ts). Until then they are listed as invited.

import { boundedText } from "./body";
import type { Organization, Sql } from "./db";

export type Answer = { status: number; body: unknown };

export interface TeamRequest {
  request: Request;
  sql: Sql;
  org: Organization;
  user: { id: string; email: string };
  path: string;
  /**
   * Emails someone a sign-in link that lands on the dashboard: sendSignInLink in
   * auth.ts. Handed in, so this file and its tests don't need Neon Auth's package.
   */
  sendLink: (email: string) => Promise<boolean>;
}

/** The roles that may add people, change roles and remove people. */
export const MANAGERS = ["owner", "admin"];
/** People one company may add in any 24 hours. Each one sends an email. */
export const INVITES_PER_DAY = 20;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export async function teamRoutes(call: TeamRequest): Promise<Answer | undefined> {
  const match = /^\/team(?:\/(invites|members)(?:\/([^/]+))?)?$/.exec(call.path);
  if (!match) return undefined;
  const [, kind, id] = match;
  const method = call.request.method;
  try {
    if (!kind && method === "GET") return { status: 200, body: await team(call) };
    if (kind === "invites" && !id && method === "POST") return { status: 201, body: await invite(call, await body(call.request)) };
    if (kind === "invites" && id && method === "DELETE") return { status: 200, body: await cancelInvite(call, id) };
    if (kind === "members" && id && method === "PATCH") return { status: 200, body: await changeRole(call, id, await body(call.request)) };
    if (kind === "members" && id && method === "DELETE") return { status: 200, body: await remove(call, id) };
    return { status: 404, body: { error: "Not found." } };
  } catch (error) {
    if (error instanceof Refused) return { status: error.status, body: error.field ? { error: error.message, field: error.field } : { error: error.message } };
    throw error;
  }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  // Read only so far: a body past the limit is never read in full, and reads as empty.
  const text = await boundedText(request, 2_000);
  if (text === null) return {};
  try {
    const value = JSON.parse(text || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function canManage(org: Organization): boolean {
  return MANAGERS.includes(org.role);
}

function manager(call: TeamRequest) {
  if (!canManage(call.org)) throw new Refused(403, "Only an owner or admin can change the team.");
}

// Who is on the team -------------------------------------------------------------

export async function team(call: Pick<TeamRequest, "sql" | "org" | "user">) {
  const { sql, org, user } = call;
  const members = (await sql`
    select m.id, m."userId" as user_id, u.name, u.email, m.role, m."createdAt" as joined
    from neon_auth.member m join neon_auth."user" u on u.id = m."userId"
    where m."organizationId" = ${org.id}::uuid
    order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m."createdAt"`) as {
    id: string;
    user_id: string;
    name: string | null;
    email: string;
    role: string;
    joined: string;
  }[];
  // Invited and not yet signed in: an invitation whose address isn't on the team.
  const invites = (await sql`
    select a.id, a.email, a.created_at as invited_at, inviter.name as invited_by
    from approvals a left join neon_auth."user" inviter on inviter.id::text = a.invited_by
    where a.organization_id = ${org.id}::uuid and a.invited_by is not null and a.email is not null
      and not exists (
        select 1 from neon_auth.member m join neon_auth."user" u on u.id = m."userId"
        where m."organizationId" = ${org.id}::uuid and lower(u.email) = a.email)
    order by a.created_at desc`) as { id: string; email: string; invited_at: string; invited_by: string | null }[];
  const domains = (await sql`select domain from approvals where organization_id = ${org.id}::uuid and domain is not null order by domain`) as { domain: string }[];
  return {
    canManage: canManage(org),
    members: members.map((member) => ({
      id: member.id,
      name: member.name || null,
      email: member.email,
      role: member.role,
      joined: member.joined,
      you: member.user_id === user.id,
    })),
    invites: invites.map((item) => ({ id: item.id, email: item.email, invitedAt: item.invited_at, invitedBy: item.invited_by || null })),
    domains: domains.map((row) => row.domain),
  };
}

// Adding people ------------------------------------------------------------------

async function invite(call: TeamRequest, input: Record<string, unknown>) {
  manager(call);
  const { sql, org, user } = call;
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!email) throw new Refused(400, "Enter their email.", "email");
  if (email.length > 254 || email.indexOf("@") > 64 || !EMAIL.test(email)) throw new Refused(400, "Enter a full email address, like name@company.com.", "email");

  const [member] = await sql`
    select 1 from neon_auth.member m join neon_auth."user" u on u.id = m."userId"
    where m."organizationId" = ${org.id}::uuid and lower(u.email) = ${email}`;
  if (member) throw new Refused(409, "They're already on the team.", "email");

  const [elsewhere] = await sql`
    select 1 from neon_auth.member m join neon_auth."user" u on u.id = m."userId"
    where m."organizationId" <> ${org.id}::uuid and lower(u.email) = ${email}
      and exists (select 1 from approvals a where a.organization_id = m."organizationId")`;
  if (elsewhere) throw new Refused(409, "That address already belongs to another company on Haptic.", "email");

  const [count] = await sql`
    select count(*)::int as sent from approvals
    where organization_id = ${org.id}::uuid and invited_by is not null and created_at > now() - interval '1 day'`;
  if (Number(count?.sent ?? 0) >= INVITES_PER_DAY) throw new Refused(429, `Your company has added ${INVITES_PER_DAY} people today. Try again tomorrow.`);

  // The approval is the invitation. An address already approved for this company, by the team or an earlier invite, is only sent the email again.
  const [existing] = await sql`select organization_id from approvals where email = ${email}`;
  if (existing && String(existing.organization_id) !== org.id) throw new Refused(409, "That address is already approved for another company. Email us if it should be yours.", "email");
  if (!existing) {
    await sql`
      insert into approvals (email, company, organization_id, invited_by) values (${email}, ${org.name.slice(0, 200)}, ${org.id}::uuid, ${user.id})
      on conflict (email) do nothing`;
  }
  const sent = await call.sendLink(email);
  return { ...(await team(call)), sent, email };
}

async function cancelInvite(call: TeamRequest, id: string) {
  manager(call);
  if (!ID.test(id)) throw new Refused(404, "No such invitation.");
  const removed = await call.sql`
    delete from approvals a
    where a.id = ${id}::uuid and a.organization_id = ${call.org.id}::uuid and a.invited_by is not null
      and not exists (
        select 1 from neon_auth.member m join neon_auth."user" u on u.id = m."userId"
        where m."organizationId" = a.organization_id and lower(u.email) = a.email)
    returning a.id`;
  if (!removed.length) throw new Refused(404, "No such invitation. They may have joined already.");
  return team(call);
}

// Roles and removing people -------------------------------------------------------

interface Target {
  id: string;
  user_id: string;
  email: string;
  role: string;
}

async function target(call: TeamRequest, id: string): Promise<Target> {
  manager(call);
  if (!ID.test(id)) throw new Refused(404, "No such person on the team.");
  const [found] = (await call.sql`
    select m.id, m."userId" as user_id, u.email, m.role
    from neon_auth.member m join neon_auth."user" u on u.id = m."userId"
    where m.id = ${id}::uuid and m."organizationId" = ${call.org.id}::uuid`) as Target[];
  if (!found) throw new Refused(404, "No such person on the team.");
  if (found.role === "owner") throw new Refused(403, "The owner can't be changed or removed.");
  if (found.user_id === call.user.id) throw new Refused(403, "You can't change or remove yourself. Ask another owner or admin.");
  return found;
}

async function changeRole(call: TeamRequest, id: string, input: Record<string, unknown>) {
  const role = input.role;
  if (role !== "admin" && role !== "member") throw new Refused(400, "Choose admin or member.");
  const found = await target(call, id);
  if (found.role !== role) await call.sql`update neon_auth.member set role = ${role} where id = ${found.id}::uuid and role <> 'owner'`;
  return team(call);
}

/**
 * Takes someone off the team. Their own approval goes too, so signing in again
 * doesn't put them back. Someone covered by an approval of their whole email
 * domain would be put back, so that is refused, with the reason. A company
 * always keeps at least one approval, which is what lets its people in.
 */
async function remove(call: TeamRequest, id: string) {
  const found = await target(call, id);
  const { sql, org } = call;
  const domain = found.email.slice(found.email.lastIndexOf("@") + 1).toLowerCase();
  const [covered] = await sql`select 1 from approvals where organization_id = ${org.id}::uuid and domain = ${domain}`;
  if (covered) throw new Refused(409, `Everyone with an @${domain} address can join your company, so removing them wouldn't keep them out. Email us to change that.`);
  await sql.transaction([
    sql`delete from neon_auth.member where id = ${found.id}::uuid and "organizationId" = ${org.id}::uuid and role <> 'owner'`,
    sql`
      delete from approvals a where a.organization_id = ${org.id}::uuid and a.email = lower(${found.email})
        and exists (select 1 from approvals other where other.organization_id = a.organization_id and other.id <> a.id)`,
  ]);
  return team(call);
}
