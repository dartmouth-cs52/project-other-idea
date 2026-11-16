-- Controls an answer told the visitor to use, taken from a help article, that
-- are on neither the page the visitor was on nor any other page Haptic knows.
-- With the step's sources, this says which help articles may be out of date.
-- Null for nearly every step.
alter table steps add column unseen text[];
