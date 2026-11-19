-- Which networks confirmed a verified route (0008), so that one caller can
-- neither trust a route of its own making nor point a trusted one somewhere else.
--
-- A route was trusted once one finished guide had used it. Anything that can
-- send a request with a site's Origin could ask a question, have the model
-- answer it from a page of its own making, and report the guide finished. On a
-- site that serves routes, every later guide for that question was then
-- answered from the route without the model, and billed when it finished. And
-- a different answer replaced a trusted route at once, so the same one step and
-- one report could point every visitor at another control.
--
-- Now a route is trusted only once finished guides that used it came from
-- three different networks (HAPTIC_NETWORK_THRESHOLD online, as for learned
-- labels), each kept as two bytes of a hash of the network made with the
-- site's id, ten at most, the way 0014 keeps a learned label's. A trusted
-- route keeps what it serves when the model answers differently: the different
-- answer is kept beside it (next_*), with the networks of the finished guides
-- that used it, and takes the route's place only once it has as many networks
-- as trust takes.
--
-- Every route trusted before this was trusted by one guide, which anyone could
-- have sent, so none is trusted until three networks have confirmed it again.
alter table routes
  add column networks text[] not null default '{}',
  add column next_target_key text,
  add column next_target_context text,
  add column next_target_role text,
  add column next_target_label text,
  add column next_say text,
  add column next_status text check (next_status in ('continue', 'done')),
  add column next_networks text[] not null default '{}';
update routes set confirmed = false, confirmed_at = null;
