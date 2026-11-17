-- What Haptic learns about a site from real visits, beside what the crawl
-- found. The widget sends an outline of each page it sees: its title,
-- headings, and the labels of its links and buttons. Never what is typed into
-- a field, never what is in a table's cells, and with emails and numbers masked.
--
-- Each label is counted by distinct visitor. A visitor is a hash of a random
-- id their browser keeps, made with the site's id, so it means nothing on any
-- other site and says nothing about who they are. A row keeps up to ten. A
-- label reaches the prompt only once enough visitors have seen it (three
-- online), which keeps one person's own data out of everyone's prompt.
create table outline_labels (
  site_id text not null references sites(id) on delete cascade,
  -- The page, normalized like /orders/:id.
  route text not null,
  kind text not null check (kind in ('title', 'heading', 'link', 'button')),
  label text not null check (char_length(label) <= 60),
  -- Where a link leads. Empty for anything else. A link learned from a click
  -- has the click's place in its label, like "View, in a dialog".
  href text not null default '',
  visitors text[] not null default '{}',
  visitor_count int generated always as (cardinality(visitors)) stored,
  -- Every time it was sent. Used to rank, never to decide.
  seen_count bigint not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (site_id, route, kind, label, href)
);
create index outline_labels_known on outline_labels (site_id, visitor_count desc, seen_count desc);
