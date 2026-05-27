-- Migration 0004 — ancillary tables (referrals, eval, suggestions, audit, webhooks, anonymous)
-- Per amended plan §"Data Model additions" + §"Decision Reversals R1, R2"

create type public.admin_role        as enum ('admin', 'editor');
create type public.referral_status   as enum ('pending', 'rewarded');
create type public.suggestion_source as enum ('auto', 'user');
create type public.suggestion_status as enum ('pending', 'approved', 'rejected');

-- admin_users
create table public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       admin_role not null default 'editor',
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create policy "admin_users_self_read" on public.admin_users
  for select using (auth.uid() = user_id);

-- referrals (farming-guarded reward)
create table public.referrals (
  id           uuid primary key default gen_random_uuid(),
  referrer_id  uuid not null references public.profiles(id) on delete cascade,
  referred_id  uuid not null unique references public.profiles(id) on delete cascade,
  status       referral_status not null default 'pending',
  rewarded_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index referrals_referrer_idx on public.referrals(referrer_id);

alter table public.referrals enable row level security;

create policy "referrals_self_read" on public.referrals
  for select using (auth.uid() = referrer_id or auth.uid() = referred_id);

-- Reward on referee's first completed generation
create or replace function public.maybe_reward_referral()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ref public.referrals;
        v_prior int;
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    select count(*) into v_prior
      from public.generations
      where user_id = new.user_id and status = 'completed' and id <> new.id;
    if v_prior = 0 then
      select * into v_ref from public.referrals
        where referred_id = new.user_id and status = 'pending'
        for update;
      if found then
        update public.referrals set status = 'rewarded', rewarded_at = now() where id = v_ref.id;
        update public.profiles
          set credits_balance       = credits_balance + 10,
              bonus_credits_earned  = least(bonus_credits_earned + 10, 50)
          where id = v_ref.referrer_id
            and bonus_credits_earned < 50;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists generations_reward_referral on public.generations;
create trigger generations_reward_referral
  after update on public.generations
  for each row execute function public.maybe_reward_referral();

-- trend_eval_inputs
create table public.trend_eval_inputs (
  id               uuid primary key default gen_random_uuid(),
  trend_id         uuid not null references public.trends(id) on delete cascade,
  label            text not null,
  image_url        text not null,
  demographic_tag  text,
  created_at       timestamptz not null default now()
);

create index trend_eval_inputs_trend_idx on public.trend_eval_inputs(trend_id);

alter table public.trend_eval_inputs enable row level security;
-- Service role only

-- trend_eval_runs
create table public.trend_eval_runs (
  id              uuid primary key default gen_random_uuid(),
  trend_id        uuid not null references public.trends(id) on delete cascade,
  prompt_version  int  not null,
  eval_input_id   uuid not null references public.trend_eval_inputs(id) on delete cascade,
  output_url      text,
  admin_rating    text,  -- 'pass' | 'fail' | null
  rated_by        uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index trend_eval_runs_trend_idx on public.trend_eval_runs(trend_id, created_at desc);

alter table public.trend_eval_runs enable row level security;
-- Service role only

-- trend_suggestions
create table public.trend_suggestions (
  id           uuid primary key default gen_random_uuid(),
  source       suggestion_source not null,
  payload      jsonb not null,
  status       suggestion_status not null default 'pending',
  reviewed_by  uuid references auth.users(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index trend_suggestions_status_idx on public.trend_suggestions(status, created_at desc);

alter table public.trend_suggestions enable row level security;
-- Service role only

-- admin_audit_log
create table public.admin_audit_log (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid references auth.users(id) on delete set null,
  action        text not null,
  target_table  text not null,
  target_id     text,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);

create index admin_audit_log_admin_idx  on public.admin_audit_log(admin_id, created_at desc);
create index admin_audit_log_target_idx on public.admin_audit_log(target_table, target_id);

alter table public.admin_audit_log enable row level security;

create policy "admin_audit_log_admin_read" on public.admin_audit_log
  for select using (exists (select 1 from public.admin_users where user_id = auth.uid()));

-- webhook_events (Stripe idempotency)
create table public.webhook_events (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('stripe')),
  event_id     text not null,
  payload      jsonb not null,
  processed_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (source, event_id)
);

create index webhook_events_unprocessed_idx
  on public.webhook_events(source, created_at)
  where processed_at is null;

alter table public.webhook_events enable row level security;
-- Service role only

-- anonymous_attempts (1-per-fingerprint+IP lifetime)
create table public.anonymous_attempts (
  id                uuid primary key default gen_random_uuid(),
  fingerprint_hash  text not null,    -- SHA-256
  ip_hash           text not null,    -- SHA-256
  trend_id          uuid not null references public.trends(id) on delete cascade,
  output_image_url  text,
  status            generation_status not null default 'pending',
  cost_usd          numeric(10,5) not null default 0,
  expires_at        timestamptz not null default now() + interval '24 hours',
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  -- One attempt per fingerprint OR per IP (whichever was used first)
  unique (fingerprint_hash, ip_hash)
);

create index anonymous_attempts_fingerprint_idx on public.anonymous_attempts(fingerprint_hash);
create index anonymous_attempts_ip_idx          on public.anonymous_attempts(ip_hash);
create index anonymous_attempts_expires_idx     on public.anonymous_attempts(expires_at);
create index anonymous_attempts_cost_day_idx    on public.anonymous_attempts(created_at, cost_usd);

alter table public.anonymous_attempts enable row level security;
-- Service role only (no auth.uid)
