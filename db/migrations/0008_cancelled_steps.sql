-- Steps the widget hung up on before they were ready, because the page
-- changed while the model was answering, such as a page that took a moment
-- to load after a click. The widget asks for the step again from the new
-- page, and that is the one recorded in steps. A guide with many of these is
-- on pages that load slowly.
alter table guides add column cancelled_steps int not null default 0;
