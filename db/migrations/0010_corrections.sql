-- Corrections and controls Haptic must never point at are kept in the site's
-- context, beside what the crawl found, so the widget server reads them with
-- the site and a step never waits for them (sites.context: corrections and
-- blocked, in src/shared/corrections.ts).
--
-- One more way a question can end: the step was a control the site's owner
-- said never to point at, so the visitor was told Haptic can't help with that here.
alter table guides drop constraint guides_outcome_check;
alter table guides add constraint guides_outcome_check
  check (outcome in ('finished', 'shown', 'stopped', 'nothing_to_point_at', 'loop', 'step_limit', 'error', 'answered', 'not_covered', 'sensitive', 'off_topic', 'blocked'));
