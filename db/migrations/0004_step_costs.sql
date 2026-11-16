-- What each step cost, and how much of its prompt was read from the cache.
--
-- A step is cheap when the site's prompt is still in the provider's cache and
-- costs many times more when it is not, so the share read from the cache is
-- the number that decides what a site costs to serve. It differs for every
-- site: a busy one stays warm and a quiet one does not.
--
-- All of these are null for a step recorded before this, and for one answered
-- by the stand-in model, which has no tokens.
alter table steps
  add column input_tokens int,
  add column cache_read_tokens int,
  add column cache_write_tokens int,
  add column output_tokens int,
  -- US dollars, worked out from the tokens and the prices in src/server/prices.ts.
  add column usd numeric(10, 6),
  -- The rules in src/server/rules.ts that changed the sentence before it was shown,
  -- like "link". Null or empty for nearly every step.
  add column broke text[];
