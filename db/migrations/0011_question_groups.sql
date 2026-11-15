-- Questions grouped by meaning, for the dashboard's lead ("what people can't
-- find") and for guide health. A group is the question's words without
-- filler like "how do I", with a plural s taken off, in order: "How do I
-- export invoices?" and "export my invoices" are both "export invoice".
-- src/shared/questions.ts does the same in TypeScript, and a test holds the
-- list of filler words here to the one there.
create function question_group(key text) returns text language sql immutable parallel safe as $$
  select coalesce(
    (select string_agg(word, ' ' order by word collate "C") from (
      select distinct case when length(token) > 3 and token like '%s' and token not like '%ss' then left(token, -1) else token end as word
      from unnest(string_to_array(key, ' ')) as token
      where length(token) > 1 and token <> all (array['a', 'an', 'and', 'are', 'can', 'could', 'do', 'does', 'for', 'from', 'get', 'go', 'have', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'please', 'the', 'there', 'this', 'to', 'want', 'we', 'what', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your'])
    ) as words),
    key)
$$;

alter table guides add column question_group text generated always as (question_group(question_key)) stored;
create index guides_site_group on guides (site_id, question_group, started_at desc);

-- Who asked, as far as counting goes: a hash of the random id the widget keeps
-- in the browser, made with the site's id. It says how many different people
-- asked something, so one person asking ten times counts once. It says nothing
-- about who they are, and means nothing on any other site. Null when the
-- browser keeps no storage, and then each such guide counts as its own visitor.
alter table guides add column visitor text;

-- Each email sent to a company about a common question whose guides stopped
-- finishing, so the same news is not sent again within a fortnight.
create table health_alerts (
  site_id text not null references sites(id) on delete cascade,
  question_group text not null,
  sent_at timestamptz not null default now(),
  finished_before real not null,
  finished_now real not null,
  -- False when the Worker had no way to send email, so the alert is on the dashboard only.
  emailed boolean not null,
  primary key (site_id, question_group, sent_at)
);
