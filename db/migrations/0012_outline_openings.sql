-- What a menu, tab or accordion shows once a visitor opens it, learned from
-- real visits beside outline_labels (0009). The widget notes the controls that
-- appear after a visitor opens one, and sends their labels with the label of
-- the control that opened them. Labels only, under the same rules: nothing
-- typed, nothing in a table's cells, emails and numbers masked.
--
-- Each item is counted by distinct visitor, ten hashes at most, and reaches
-- the prompt only once enough visitors have seen it (three online). A menu
-- that lists a visitor's own workspaces or name never gets there.
create table outline_openings (
  site_id text not null references sites(id) on delete cascade,
  route text not null,
  -- The control that has to be opened first, like "Help" or "More actions".
  control text not null check (char_length(control) <= 60),
  label text not null check (char_length(label) <= 60),
  -- Where a link leads. Empty for a button or a menu item.
  href text not null default '',
  visitors text[] not null default '{}',
  visitor_count int generated always as (cardinality(visitors)) stored,
  seen_count bigint not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (site_id, route, control, label, href)
);
create index outline_openings_known on outline_openings (site_id, visitor_count desc, seen_count desc);
