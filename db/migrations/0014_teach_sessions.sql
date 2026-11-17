-- Teach Haptic: someone at the company shows Haptic the right way to do a
-- task by doing it in their own app (src/shared/teach.ts).
--
-- The dashboard makes a teach session and opens the company's app with a
-- random token in the address's fragment, which never reaches the app's
-- server. Only the token's SHA-256 is kept here. The widget on the page
-- claims the token once, with a secret of its own whose hash is kept too, so
-- the token works once and the session then belongs to that one browser tab.
-- A token can be claimed for 30 minutes after it is made, for its own site
-- only, and from an address the site allows. Once claimed, the tab has 30
-- minutes to finish.
--
-- What the tab posts is the steps: for each, the control's kind and name as
-- the page outline gives it, the page as a path with ids masked, and what was
-- done with it. Never what was typed. They wait here for the person to review
-- them in the dashboard. Saving keeps them as a taught route in the site's
-- context (sites.context: taught), beside the corrections, so the widget
-- server reads them with the site. Saving or discarding sets steps to null
-- here, and a session not saved is deleted after seven days, by the site
-- Worker's daily schedule (web/worker/teach.ts: forgetOldTeaching).
create table teach_sessions (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references sites(id) on delete cascade,
  -- SHA-256 of the token, in hex. The token itself is never stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- The question being taught, masked like every question kept.
  question text not null check (char_length(question) between 1 and 300),
  -- The failed guide it was started from, if any. No foreign key: a guide can be deleted on request.
  guide_id uuid,
  -- Who started it: the Neon Auth user id, and the name the dashboard shows.
  created_by text not null,
  created_by_name text,
  created_at timestamptz not null default now(),
  -- Before claiming: the end of the 30 minutes to claim it. After: the end of the 30 minutes to finish.
  expires_at timestamptz not null,
  claimed_at timestamptz,
  -- SHA-256 of the secret the claiming tab sent. Only that tab can post the steps or cancel.
  claim_hash text check (claim_hash ~ '^[0-9a-f]{64}$'),
  claimed_origin text check (char_length(claimed_origin) <= 200),
  -- When the tab posted its steps.
  finished_at timestamptz,
  steps jsonb check (steps is null or jsonb_typeof(steps) = 'array'),
  cancelled_at timestamptz,
  -- When the reviewed steps were kept as a taught route.
  saved_at timestamptz,
  check ((claimed_at is null) = (claim_hash is null))
);
create index teach_sessions_site on teach_sessions (site_id, created_at desc);
