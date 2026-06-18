-- 20260604000001_subscriptions.sql
-- Phase 3: subscription plan state. One active subscription per user enforced
-- by a partial unique index (H-C11). Writes: service-role only.

create type public.subscription_plan   as enum ('starter50', 'pro200', 'studio600');
create type public.subscription_status as enum ('active', 'past_due', 'canceled', 'incomplete', 'trialing');

create table public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  plan                     public.subscription_plan   not null,
  status                   public.subscription_status not null,
  stripe_subscription_id   text unique not null,
  stripe_customer_id       text,
  monthly_credit_allotment int  not null check (monthly_credit_allotment > 0),
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- One active/past_due/incomplete sub per user (H-C11)
create unique index subscriptions_one_active_per_user
  on public.subscriptions(user_id)
  where status in ('active', 'past_due', 'incomplete', 'trialing');

create index subscriptions_user_idx   on public.subscriptions(user_id);
create index subscriptions_stripe_idx on public.subscriptions(stripe_subscription_id);

alter table public.subscriptions enable row level security;
create policy "subscriptions_self_read" on public.subscriptions
  for select using (auth.uid() = user_id);
-- Writes: service-role only (no insert/update/delete policy for authenticated)
