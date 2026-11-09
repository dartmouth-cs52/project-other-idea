-- Count learned labels by distinct visitor, not by report. One person opening
-- their own set in three tabs used to count as three sightings, enough to push
-- their private content into the prompt.
--
-- Each row keeps up to 10 hashed visitor IDs. That's enough to apply any
-- threshold we'd use, while storage stays bounded per label. seen_count still
-- counts every report and is used for ranking.

alter table public.outline_labels
  add column visitors text[] not null default '{}',
  add column visitor_count integer generated always as (cardinality(visitors)) stored;

-- Rows learned before this change came from unknown visitors. Count them as one.
update public.outline_labels set visitors = array['legacy'];

drop function public.bump_outline_labels(uuid, jsonb);

create function public.bump_outline_labels(p_site uuid, p_visitor text, p_rows jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.outline_labels (site_id, route, kind, label, href, visitors)
  select p_site, r->>'route', r->>'kind', r->>'label', r->>'href', array[p_visitor]
  from jsonb_array_elements(p_rows) r
  on conflict (site_id, route, kind, label) do update
    set seen_count = public.outline_labels.seen_count + 1,
        last_seen = now(),
        href = coalesce(excluded.href, public.outline_labels.href),
        visitors = case
          when p_visitor = any(public.outline_labels.visitors) or cardinality(public.outline_labels.visitors) >= 10
            then public.outline_labels.visitors
          else public.outline_labels.visitors || p_visitor
        end;
$$;

revoke execute on function public.bump_outline_labels(uuid, text, jsonb) from public, anon, authenticated;
