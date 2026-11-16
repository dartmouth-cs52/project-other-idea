-- Each install email a company sends its developer from the dashboard
-- ("Email it to my developer", web/worker/setup-api.ts), kept only to hold the
-- limits: in any 24 hours, 3 to one mailbox, 10 from a site, 20 from a company
-- and 10 from one person.
--
-- The address itself is never kept: `recipient` is a hash of the mailbox it
-- reaches, written the same way however the address was (case, a +tag, dots
-- on Gmail). Rows older than a day are deleted with each new email and by the
-- site Worker's daily schedule, so none is kept beyond two days.
--
-- No foreign key to sites, on purpose: deleting a site and adding it again
-- must not reset what it has sent.
create table developer_emails (
  -- The press of Send, hashed with the site and the mailbox, so a retry of one press counts once.
  key text primary key,
  company_id uuid not null,
  site_id text not null,
  -- The Neon Auth user id of the person who pressed Send.
  sender text not null,
  recipient text not null,
  -- When Send was pressed.
  sent_at timestamptz not null default now(),
  -- Pending from the moment it is counted until Resend takes it, then sent. A row left pending, by a
  -- request cut off between the two, may be tried again once, after a minute. Either way it counts.
  state text not null default 'pending' check (state in ('pending', 'sent')),
  retried boolean not null default false
);
create index developer_emails_company on developer_emails (company_id, sent_at);
create index developer_emails_recipient on developer_emails (recipient, sent_at);
create index developer_emails_sender on developer_emails (sender, sent_at);
