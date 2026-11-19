-- Each sign-in email Neon Auth hands the site's Worker to send, through its
-- send.magic_link webhook (web/worker/neon-hook.ts), kept only to hold its
-- limits. Anyone can ask for a sign-in link for any address, on the sign-in
-- page or straight from Neon, so without them one person could fill someone's
-- inbox, or send a flood of email from joinhaptic.com. In any hour one mailbox
-- gets 5. The people Haptic knows, approved by their own address or on an
-- approved company's team, have only that, so nobody else's emails can use up
-- their sign-in. The people an approved domain covers who haven't signed in
-- yet get 50 together, and everyone else 300 together.
--
-- The address itself is never kept: `recipient` is a hash of the mailbox it
-- reaches, written the same way however the address was (case, a +tag, dots
-- on Gmail). Rows older than a day are deleted with each new email and by the
-- site Worker's daily schedule, so none is kept beyond two days.
create table sign_in_emails (
  -- Neon's id for the event. Neon sends the same id again when a try fails, and it counts once.
  event_id text primary key,
  recipient text not null,
  -- Who else the email counts against: 'known' for nobody, 'domain ' and a hash of the approved
  -- domain for the people it covers who haven't signed in yet, and 'others' for everyone else.
  pool text not null,
  sent_at timestamptz not null default now()
);
create index sign_in_emails_recipient on sign_in_emails (recipient, sent_at);
create index sign_in_emails_pool on sign_in_emails (pool, sent_at);
create index sign_in_emails_sent_at on sign_in_emails (sent_at);
