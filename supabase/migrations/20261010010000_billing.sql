-- Track which Stripe subscription an organization is on, so an old
-- subscription ending can't undo a newer one.
alter table public.organizations
  add column stripe_subscription_id text,
  add column cancels_at_period_end boolean not null default false;
