-- Haptic's database, on Neon. Project "haptic", database "neondb".
--
-- Sign-in is Neon Auth, which keeps its own tables in the neon_auth schema.
-- Everything in this file is Haptic's own. A user is referred to here by the
-- id Neon Auth gives them.

-- A customer.
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Who may sign in for a company.
create table members (
  company_id uuid not null references companies(id) on delete cascade,
  user_id text not null,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index members_user on members (user_id);

-- Sign-up is by invitation. A row is one sign-up link, sent after a request for access is approved.
create table invites (
  token text primary key,
  email text not null,
  company_name text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by text
);

-- A site the widget runs on. The id is the public key in the script tag.
-- It is not a secret: allowed_origins is what restricts it.
create table sites (
  id text primary key check (id ~ '^site_[a-z0-9_]{3,40}$'),
  -- Null for a site the team set up by hand, before its company has an account.
  company_id uuid references companies(id) on delete cascade,
  name text not null,
  origin text not null,
  allowed_origins text[] not null default '{}',
  -- What the server reads to answer a step: the SiteContext in src/shared/types.ts.
  context jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sites_company on sites (company_id);

-- Every origin the script has called from, allowed or not. The first allowed
-- row is how the dashboard knows a site is connected, and a row that is not
-- allowed explains an install that looks dead.
create table site_origins (
  site_id text not null references sites(id) on delete cascade,
  origin text not null,
  allowed boolean not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  requests bigint not null default 1,
  primary key (site_id, origin)
);

-- One question a visitor asked. The widget makes the id, so a guide's steps
-- can be tied together without an extra request. Nothing here says who the
-- visitor is.
create table guides (
  id uuid primary key,
  site_id text not null references sites(id) on delete cascade,
  -- As typed, with emails and long numbers masked.
  question text not null,
  -- Lower case with punctuation removed, so the same question asked twice groups together.
  question_key text not null,
  started_path text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- Null while a guide is under way. One left null for long was abandoned.
  outcome text check (outcome in ('finished', 'stopped', 'nothing_to_point_at', 'loop', 'step_limit', 'error')),
  -- The visitor's answer to "Did this help?", when they gave one.
  helped boolean
);
create index guides_site_time on guides (site_id, started_at desc);
create index guides_site_question on guides (site_id, question_key);

-- One step of a guide: what Haptic pointed at and said, and what the visitor
-- had just done. Page contents are not kept, and what people type is never read.
create table steps (
  guide_id uuid not null references guides(id) on delete cascade,
  n int not null,
  path text not null,
  -- Null when there was nothing to point at.
  target_role text,
  target_label text,
  said text not null,
  status text not null check (status in ('continue', 'done')),
  -- What the visitor did before this step, in words.
  event text,
  -- True when that was something other than the step they were shown.
  strayed boolean not null default false,
  ms int not null,
  ms_to_target int not null,
  model text not null,
  created_at timestamptz not null default now(),
  primary key (guide_id, n)
);
