-- Which networks a learned label was seen from, beside which visitors
-- (outline_labels in 0009, outline_openings in 0012).
--
-- A visitor is counted by a random id their browser keeps, and anything that
-- is not a browser can send as many ids as it likes. So a label is also
-- counted by the network each caller's address belongs to, which a caller
-- cannot choose, and it reaches the prompt only once enough visitors have seen
-- it from enough networks (three of each online).
--
-- A network is kept as the first two bytes of a hash of it (an IPv4 address
-- whole, the first three groups of an IPv6 one) made with the site's id. About
-- 65,000 IPv4 addresses share each value, so nothing here can be turned back
-- into an address, and it is still enough to tell three networks apart. A row
-- keeps up to ten.
--
-- Rows from before this have no networks, so every label has to be seen again,
-- from three networks, before the prompt gets it back. That is on purpose:
-- there is no telling which of them a single machine sent.
alter table outline_labels add column networks text[] not null default '{}';
alter table outline_labels add column network_count int generated always as (cardinality(networks)) stored;
alter table outline_openings add column networks text[] not null default '{}';
alter table outline_openings add column network_count int generated always as (cardinality(networks)) stored;
