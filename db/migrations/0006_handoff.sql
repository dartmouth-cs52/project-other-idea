-- True when the visitor used the way to a person: the widget's form, the
-- company's contact page, or its email address. What they wrote is passed on
-- to the company and is not kept here.
alter table guides add column handed_off boolean not null default false;
