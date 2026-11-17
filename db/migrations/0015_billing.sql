-- Billing through Stripe, for the plans in web/lib/site.ts.
--
-- A company is a neon_auth.organization, which Neon owns, so what billing
-- knows about one is kept here, a row a company, keyed by the organization's
-- id. There is no foreign key, for the reason given in 0002.
--
-- The webhook (web/worker/billing.ts) writes every column but the customer
-- from the subscription as Stripe has it at that moment, never from the
-- event's own copy, so events that arrive late or twice change nothing.
create table billing (
  organization_id uuid primary key,
  -- Made the first time someone at the company starts to subscribe.
  stripe_customer_id text unique,
  -- The company's newest subscription. Null before the first.
  stripe_subscription_id text,
  -- The plan in effect: an id from `pricing` in web/lib/site.ts. Back to
  -- early-access once a paid subscription has ended.
  plan text not null default 'early-access' check (plan ~ '^[a-z][a-z-]{1,39}$'),
  -- Stripe's word for the subscription: active, past_due, unpaid, canceled, incomplete…
  status text,
  -- The billing period under way, which the dashboard counts finished guides against.
  period_start timestamptz,
  period_end timestamptz,
  -- When a cancellation takes effect, while the subscription runs on until then.
  cancel_at timestamptz,
  -- Finished guides are sent to Stripe from when the subscription started to
  -- when it ended. Null from before the first subscription, so nothing is sent.
  metered_from timestamptz,
  metered_until timestamptz,
  -- Whether the ids above are from Stripe's live mode or its test mode. They
  -- mean nothing in the other, so a server with a key for the other mode
  -- treats the row as empty, and never sends this company's usage there.
  livemode boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Every webhook event already applied, so the same event twice is answered
-- and not applied again. Kept for 30 days, longer than Stripe retries one.
create table stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- When a finished guide reached Stripe as usage. Null for one not sent yet,
-- and for every guide that is not billed.
alter table guides add column billed_at timestamptz;
create index guides_unbilled on guides (ended_at) where outcome = 'finished' and billed_at is null;
