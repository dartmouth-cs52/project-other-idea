-- Each sign-in email Neon Auth hands the site's Worker to send, through its
-- send.magic_link webhook (web/worker/neon-hook.ts), kept only to hold its
-- limits: in any hour, 5 to one mailbox and 300 from the whole site. Anyone
-- can ask for a sign-in link for any address, on the sign-in page or straight
-- from Neon, so without them one person could fill someone's inbox, or use up
-- what Resend will send, and with it everyone else's sign-in.
--
-- The address itself is never kept: `recipient` is a hash of the mailbox it
-- reaches, written the same way however the address was (case, a +tag, dots
-- on Gmail). Rows older than a day are deleted with each new email and by the
-- site Worker's daily schedule, so none is kept beyond two days.
create table sign_in_emails (
  -- Neon's id for the event. Neon sends the same id again when a try fails, and it counts once.
  event_id text primary key,
  recipient text not null,
  sent_at timestamptz not null default now()
);
create index sign_in_emails_recipient on sign_in_emails (recipient, sent_at);
create index sign_in_emails_sent_at on sign_in_emails (sent_at);
