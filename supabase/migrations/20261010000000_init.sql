-- Haptic schema: organizations own sites; sites have a publishable key, an
-- allowed-origin list, notes for the model, and a learned site map. The public
-- API reads with the service role. The dashboard reads as the signed-in user,
-- limited by row level security to their own organizations.

create extension if not exists pgcrypto with schema extensions;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  stripe_customer_id text unique,
  plan text not null default 'trial' check (plan in ('trial', 'starter', 'growth')),
  subscription_status text not null default 'trialing',
  trial_ends_at timestamptz not null default now() + interval '14 days',
  current_period_end timestamptz,
  monthly_turn_limit integer not null default 500,
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  url text not null default '',
  publishable_key text not null unique
    default 'pk_live_' || encode(extensions.gen_random_bytes(18), 'hex'),
  allowed_origins text[] not null default '{}',
  notes text not null default '' check (char_length(notes) <= 8000),
  appearance jsonb not null default '{}'::jsonb,
  voice_enabled boolean not null default false,
  learning_enabled boolean not null default true,
  installed_at timestamptz,
  installed_origin text,
  created_at timestamptz not null default now()
);
create index sites_org_idx on public.sites (org_id);

-- Learned site map. One row per label per route; seen_count is how many
-- browser sessions reported it. Only labels seen often reach the model.
create table public.outline_labels (
  site_id uuid not null references public.sites on delete cascade,
  route text not null,
  kind text not null check (kind in ('title', 'heading', 'link', 'button')),
  label text not null,
  href text,
  seen_count integer not null default 1,
  hidden boolean not null default false,
  last_seen timestamptz not null default now(),
  primary key (site_id, route, kind, label)
);

create table public.turns (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.sites on delete cascade,
  session_id text not null,
  kind text not null,
  question text,
  path text,
  step integer not null default 0,
  outcome text not null,
  model text not null,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  first_token_ms integer,
  first_point_ms integer,
  created_at timestamptz not null default now()
);
create index turns_site_created_idx on public.turns (site_id, created_at desc);

create table public.usage_monthly (
  org_id uuid not null references public.organizations on delete cascade,
  month date not null,
  turns integer not null default 0,
  primary key (org_id, month)
);

-- Membership check used by every policy. Security definer so policies on
-- memberships itself don't recurse.
create function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m where m.org_id = org and m.user_id = auth.uid()
  );
$$;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.sites enable row level security;
alter table public.outline_labels enable row level security;
alter table public.turns enable row level security;
alter table public.usage_monthly enable row level security;

create policy "members read their organizations" on public.organizations
  for select to authenticated using (public.is_member(id));
create policy "members rename their organizations" on public.organizations
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

create policy "members see memberships of their organizations" on public.memberships
  for select to authenticated using (public.is_member(org_id));

create policy "members manage sites" on public.sites
  for all to authenticated using (public.is_member(org_id)) with check (public.is_member(org_id));

create policy "members manage learned pages" on public.outline_labels
  for all to authenticated
  using (exists (select 1 from public.sites s where s.id = site_id and public.is_member(s.org_id)))
  with check (exists (select 1 from public.sites s where s.id = site_id and public.is_member(s.org_id)));

create policy "members read turns" on public.turns
  for select to authenticated
  using (exists (select 1 from public.sites s where s.id = site_id and public.is_member(s.org_id)));

create policy "members read usage" on public.usage_monthly
  for select to authenticated using (public.is_member(org_id));

-- Members can only change harmless columns. Billing fields, keys and install
-- status are written by the server with the service role.
revoke insert, update, delete on public.organizations from anon, authenticated;
grant select on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;

revoke insert, update, delete on public.memberships from anon, authenticated;
grant select on public.memberships to authenticated;

revoke all on public.sites from anon;
revoke update on public.sites from authenticated;
grant select, insert, delete on public.sites to authenticated;
grant update (name, url, allowed_origins, notes, appearance, voice_enabled, learning_enabled)
  on public.sites to authenticated;

revoke all on public.outline_labels from anon;
revoke insert, update on public.outline_labels from authenticated;
grant select, delete on public.outline_labels to authenticated;
grant update (hidden) on public.outline_labels to authenticated;

revoke all on public.turns from anon;
revoke insert, update, delete on public.turns from authenticated;
grant select on public.turns to authenticated;

revoke all on public.usage_monthly from anon;
revoke insert, update, delete on public.usage_monthly from authenticated;
grant select on public.usage_monthly to authenticated;

-- Signup creates an organization and makes the user its owner.
create function public.create_organization(org_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into public.organizations (name) values (org_name) returning id into new_id;
  insert into public.memberships (org_id, user_id, role) values (new_id, auth.uid(), 'owner');
  return new_id;
end;
$$;
revoke execute on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;

create function public.rotate_site_key(site uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  new_key text := 'pk_live_' || encode(extensions.gen_random_bytes(18), 'hex');
begin
  update public.sites set publishable_key = new_key
  where id = site and public.is_member(org_id);
  if not found then
    raise exception 'site not found';
  end if;
  return new_key;
end;
$$;
revoke execute on function public.rotate_site_key(uuid) from public, anon;
grant execute on function public.rotate_site_key(uuid) to authenticated;

-- Server-side helpers, called with the service role only.

create function public.bump_outline_labels(p_site uuid, p_rows jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.outline_labels (site_id, route, kind, label, href)
  select p_site, r->>'route', r->>'kind', r->>'label', r->>'href'
  from jsonb_array_elements(p_rows) r
  on conflict (site_id, route, kind, label) do update
    set seen_count = public.outline_labels.seen_count + 1,
        last_seen = now(),
        href = coalesce(excluded.href, public.outline_labels.href);
$$;

create function public.record_turn(
  p_site uuid, p_org uuid, p_session text, p_kind text, p_question text, p_path text, p_step integer,
  p_outcome text, p_model text, p_tokens_in integer, p_tokens_out integer,
  p_first_token_ms integer, p_first_point_ms integer
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.turns (site_id, session_id, kind, question, path, step, outcome, model,
    tokens_in, tokens_out, first_token_ms, first_point_ms)
  values (p_site, p_session, p_kind, p_question, p_path, p_step, p_outcome, p_model,
    p_tokens_in, p_tokens_out, p_first_token_ms, p_first_point_ms);
  insert into public.usage_monthly (org_id, month, turns)
  values (p_org, date_trunc('month', now())::date, 1)
  on conflict (org_id, month) do update set turns = public.usage_monthly.turns + 1;
end;
$$;

revoke execute on function public.bump_outline_labels(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.record_turn(uuid, uuid, text, text, text, text, integer, text, text, integer, integer, integer, integer)
  from public, anon, authenticated;
