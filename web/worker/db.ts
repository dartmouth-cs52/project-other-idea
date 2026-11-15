// The website's view of Haptic's database on Neon. The tables are in
// db/migrations at the top of the repository. Neon Auth's own tables, in the
// neon_auth schema, say who belongs to which organization.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type Sql = NeonQueryFunction<false, false>;

let held: { url: string; sql: Sql } | undefined;

/** One client per isolate. */
export function database(url: string): Sql {
  if (held?.url !== url) held = { url, sql: neon(url) };
  return held.sql;
}

export interface Organization {
  id: string;
  name: string;
  role: string;
}

/** The organization a user belongs to. Haptic gives each person one; if they somehow have several, the oldest wins. */
export async function organizationOf(sql: Sql, userId: string): Promise<Organization | undefined> {
  const rows = await sql`
    select o.id, o.name, m.role from neon_auth.member m join neon_auth.organization o on o.id = m."organizationId"
    where m."userId" = ${userId} order by m."createdAt" limit 1`;
  return rows[0] as Organization | undefined;
}

export interface Approval {
  id: string;
  email: string | null;
  domain: string | null;
  company: string;
  organization_id: string | null;
}

/** The approval that lets this address in: its own row first, then its domain's. */
export async function approvalFor(sql: Sql, email: string): Promise<Approval | undefined> {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const rows = await sql`
    select id, email, domain, company, organization_id from approvals
    where email = ${email} or domain = ${domain} order by (email is not null) desc limit 1`;
  return rows[0] as Approval | undefined;
}

/**
 * Puts a newly approved person in their company's organization. The first
 * person from an approval creates it and owns it. Everyone after them from an
 * approved domain joins it as a member. One statement, with the approval row
 * locked, so two people signing in at the same moment cannot make two.
 */
export async function joinOrganization(sql: Sql, approval: Approval, userId: string): Promise<Organization> {
  const slug = `${slugify(approval.company)}-${crypto.randomUUID().slice(0, 6)}`;
  const rows = await sql`
    with a as (select id, company, organization_id from approvals where id = ${approval.id} for update),
    made as (
      insert into neon_auth.organization (name, slug, "createdAt")
      select company, ${slug}, now() from a where organization_id is null
      returning id, name
    ),
    claimed as (update approvals set organization_id = (select id from made) where id = ${approval.id} and exists (select 1 from made) returning id),
    org as (
      select id, name, 'owner' as role from made
      union all
      select o.id, o.name, 'member' from a join neon_auth.organization o on o.id = a.organization_id
    ),
    joined as (
      insert into neon_auth.member ("organizationId", "userId", role, "createdAt")
      select id, ${userId}, role, now() from org
      returning "organizationId"
    )
    select org.id, org.name, org.role from org, joined, (select count(*) from claimed) c`;
  const org = rows[0] as Organization | undefined;
  if (!org) throw new Error("The organization could not be made or found for this approval.");
  return org;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "company"
  );
}
