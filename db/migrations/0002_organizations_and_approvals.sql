-- Companies are Neon Auth organizations from here on. Neon Auth keeps them in
-- neon_auth.organization, with neon_auth.member saying who belongs to which,
-- so our own companies, members and invites tables go. They held no rows.
--
-- sites.company_id now holds a neon_auth.organization id. There is no foreign
-- key: Neon owns that schema, and deleting an organization there should not
-- silently delete a customer's sites and their history here.

alter table sites drop constraint sites_company_id_fkey;
drop table members;
drop table invites;
drop table companies;
comment on column sites.company_id is 'The neon_auth.organization this site belongs to. Null for a site the team set up by hand.';

-- Who may sign in. Sign-up stays invite only: anyone can create a Neon Auth
-- account, but only an approved one gets an organization and a dashboard.
-- A row approves one email address, or every address at one domain.
create table approvals (
  id uuid primary key default gen_random_uuid(),
  -- Exactly one of these is set, in lower case.
  email text unique,
  domain text unique,
  -- The name the organization is created with, from the access request.
  company text not null,
  -- The organization made by the first sign-in. Later people from an approved
  -- domain join it, so a company has one account and not several.
  organization_id uuid,
  -- The access request this came from: its key in the ACCESS_REQUESTS store.
  request_key text,
  created_at timestamptz not null default now(),
  check ((email is null) <> (domain is null)),
  check (email is null or email = lower(email)),
  check (domain is null or domain = lower(domain))
);

-- Where a guide ran, and when it last moved. A guide with no outcome whose
-- last step is old was abandoned.
alter table guides
  add column origin text,
  add column last_step_at timestamptz,
  add column step_count int not null default 0;
create index guides_open on guides (site_id, last_step_at) where outcome is null;

-- Where the control pointed at sits on the page, such as "nav › Account".
alter table steps add column target_context text;

-- Reading the public pages at signup. Null until it starts. It holds the
-- queue of pages left, those read and those that failed, so the read can go a
-- few pages at a time and the dashboard can show "N pages read".
alter table sites add column reading jsonb;
