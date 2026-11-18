-- How many learned labels (0009) and items behind controls (0012) each network
-- has taught a site today, so that one network can teach a site only so many
-- in a day.
--
-- A label reaches the prompt once three networks have seen it (0014), and
-- each row counts up to ten. Callers on ten networks could put themselves on
-- as many rows as they liked, as fast as they could post, and fill every
-- visitor's prompt with labels of their own. Now each network is counted on at
-- most so many rows a day for the first time (src/server/db.ts says how many,
-- a few times what one visitor's first pages on a new site send). A row it is
-- already counted on is not counted again, and an outline past the share loses
-- only its new rows past it.
--
-- A network is the two-byte hash of 0014, which tens of thousands of addresses
-- share. Only today's rows are kept: the widget server deletes earlier days.
create table outline_network_days (
  site_id text not null references sites(id) on delete cascade,
  network text not null,
  day date not null default current_date,
  labels int not null default 0,
  openings int not null default 0,
  primary key (site_id, network, day)
);
create index outline_network_days_day on outline_network_days (day);
