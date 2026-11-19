-- How many steps verified routes (0008) answered for each network on each site
-- today, so that one network can have only so many answered without the model
-- in a day.
--
-- A step a route answers makes no model call, so the site's budget does not
-- hold it, and a guide that finishes on one is billed. A route is trusted only
-- once finished guides from three networks confirmed it (0018), but a trusted
-- route is the normal state of a site that serves them, and anything that can
-- send a request with the site's Origin could then be answered from it again
-- and again. Only the limit on steps a minute stood in the way, and that counts
-- an IPv6 caller by its /64, of which one /48 holds 65,536. Now each network
-- (an IPv4 address, or the /48 an IPv6 one is in, as learning counts it) has so
-- many steps a day answered from routes on one site (src/server/db.ts says how
-- many). Past that, its steps go to the model, inside the budget like any other.
--
-- A network is the two-byte hash of 0014, which tens of thousands of addresses
-- share. Only today's rows are kept: the widget server deletes earlier days.
create table route_network_days (
  site_id text not null references sites(id) on delete cascade,
  network text not null,
  day date not null default current_date,
  served int not null default 0,
  primary key (site_id, network, day)
);
create index route_network_days_day on route_network_days (day);
