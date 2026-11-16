-- Answers: a reply can answer in words from the help docs, or say it cannot
-- help, as well as point. A site has to switch it on. See src/server/answers.ts.

-- Four more ways a question can end, which only happen on a site with Answers on:
-- answered in words, or declined as not covered by the docs, as one for a
-- person at the company, or as nothing to do with the site.
-- The constraint is the one 0003 made, and its endings, "shown" among them, are kept.
alter table guides drop constraint guides_outcome_check;
alter table guides add constraint guides_outcome_check
  check (outcome in ('finished', 'shown', 'stopped', 'nothing_to_point_at', 'loop', 'step_limit', 'error', 'answered', 'not_covered', 'sensitive', 'off_topic'));

-- What kind of reply each step was. All null for a step on a site without Answers.
alter table steps
  add column mode text check (mode in ('guide', 'answer', 'cannot_help')),
  -- Why, when the reply was that Haptic cannot help.
  add column reason text check (reason in ('not_covered', 'sensitive', 'off_topic')),
  -- The help docs an answer rested on, by the file or address each came from.
  -- A doc that is never here is one no answer has used.
  add column sources text[],
  -- Set when the server did not let the reply through as the model wrote it:
  -- no_source, no_words, never_decided or declined.
  add column overruled text;
