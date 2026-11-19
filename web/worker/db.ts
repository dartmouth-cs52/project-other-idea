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

/**
 * True for Postgres saying a table or column is missing: this Worker was
 * deployed before a migration its code needs was applied (`npm run db:migrate`).
 */
export function notMigrated(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return code === "42P01" || code === "42703";
}

export interface Organization {
  id: string;
  name: string;
  role: string;
}

/**
 * The organization a user belongs to, if it is one Haptic made from an
 * approval. Neon Auth lets any signed-in person create an organization of
 * their own through its API, so membership alone proves nothing: only an
 * organization the approved list points at lets someone in. A member the
 * owner invited into such an organization counts too.
 */
export async function organizationOf(sql: Sql, userId: string): Promise<Organization | undefined> {
  const rows = await sql`
    select o.id, o.name, m.role from neon_auth.member m join neon_auth.organization o on o.id = m."organizationId"
    where m."userId" = ${userId}::uuid and exists (select 1 from approvals a where a.organization_id = o.id)
    order by m."createdAt" limit 1`;
  return rows[0] as Organization | undefined;
}

/**
 * Puts an approved person in their company's organization, or returns nothing
 * when neither their address nor its domain is approved.
 *
 * An address can be covered by two approvals, its own and its domain's. If
 * either already has an organization, the person joins that one as a member
 * and the other approval is pointed at it too. Only when neither has one is
 * an organization made, with this person as its owner. That keeps a company
 * to one organization whichever order its people were approved in.
 *
 * Two statements in one transaction. The first locks the approvals, so two
 * sign-ins at the same moment take turns. The second then starts with a fresh
 * view of the database, and sees whatever the sign-in before it made. Joining
 * twice changes nothing: Neon's member table would accept a second row.
 */
export async function joinOrganization(sql: Sql, email: string, userId: string): Promise<Organization | undefined> {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const suffix = crypto.randomUUID().slice(0, 6);
  const [, rows] = await sql.transaction([
    sql`select id from approvals where email = ${email} or domain = ${domain} order by id for update`,
    sql`
      with a as (
        select id, company, organization_id, (email is not null) as own from approvals where email = ${email} or domain = ${domain}
      ),
      existing as (
        select o.id, o.name from a join neon_auth.organization o on o.id = a.organization_id order by a.own desc limit 1
      ),
      made as (
        insert into neon_auth.organization (name, slug, "createdAt")
        select company,
          coalesce(nullif(left(trim(both '-' from regexp_replace(lower(company), '[^a-z0-9]+', '-', 'g')), 40), ''), 'company') || '-' || ${suffix},
          now()
        from a where not exists (select 1 from existing) order by own desc limit 1
        returning id, name
      ),
      org as (
        select id, name, 'owner'::text as role from made
        union all
        select id, name, 'member'::text from existing
      ),
      claimed as (
        update approvals set organization_id = (select id from org)
        where id in (select id from a) and exists (select 1 from org) and organization_id is distinct from (select id from org)
        returning id
      ),
      joined as (
        insert into neon_auth.member ("organizationId", "userId", role, "createdAt")
        select org.id, ${userId}::uuid, org.role, now() from org
        where not exists (select 1 from neon_auth.member m where m."organizationId" = org.id and m."userId" = ${userId}::uuid)
        returning role
      )
      select org.id, org.name,
        coalesce(
          (select role from joined),
          (select m.role from neon_auth.member m where m."organizationId" = org.id and m."userId" = ${userId}::uuid order by m."createdAt" limit 1)
        ) as role,
        (select count(*) from claimed) as claimed
      from org`,
  ]);
  const org = (rows as Organization[])[0];
  return org ? { id: org.id, name: org.name, role: org.role } : undefined;
}


/**
 * Deletes the days before today of how many labels each network taught a site, and how many of its steps
 * verified routes answered (db/migrations/0019 and 0020). Only today's are read. The widget server deletes
 * them too, the first time each day it learns or answers from a route, so a site that stops doing either
 * would keep its last day's: the site's daily schedule deletes them as well.
 */
export async function forgetOldNetworkDays(sql: Sql): Promise<void> {
  await sql`delete from outline_network_days where day < current_date`;
  await sql`delete from route_network_days where day < current_date`;
}
