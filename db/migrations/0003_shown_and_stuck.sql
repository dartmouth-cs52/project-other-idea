-- Only finished guides are billed, as the pricing on joinhaptic.com says, so
-- "finished" now means the visitor followed the steps and arrived, or used the
-- control the last answer pointed at.
--
-- A first answer that the visitor did not act on, or that only needed words,
-- ends as "shown": answered, and free. A step where the model found no way
-- forward has the status "stuck", kept apart from "done", because a guide
-- that gets stuck is free too.

alter table guides drop constraint guides_outcome_check;
alter table guides add constraint guides_outcome_check
  check (outcome in ('finished', 'shown', 'stopped', 'nothing_to_point_at', 'loop', 'step_limit', 'error'));

alter table steps drop constraint steps_status_check;
alter table steps add constraint steps_status_check check (status in ('continue', 'done', 'stuck'));

-- The dashboard lists every finished guide, month by month, so a bill can be checked against it.
create index guides_finished on guides (site_id, ended_at) where outcome = 'finished';
