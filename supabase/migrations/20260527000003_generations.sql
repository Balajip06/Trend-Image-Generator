-- Migration 0003 — generations + RLS quota enforcement
-- Per amended plan §"Data Model additions" + §"Decision Reversals R3"

create type public.generation_status as enum (
  'pending',         -- row created, not yet picked up
  'processing',      -- Edge Function actively calling Gemini
  'completed',
  'failed',          -- terminal failure (quota refunded)
  'failed_retryable' -- transient failure, retry-able with same idempotency_key
);

create table public.generations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  trend_id         uuid not null references public.trends(id)   on delete restrict,
  trend_version    int  not null,
  idempotency_key  text not null,
  input_payload    jsonb not null,  -- { user_photo: url, ...schema fields }
  output_image_url text,
  status           generation_status not null default 'pending',
  attempts         int  not null default 0,
  error_message    text,
  model_used       text,
  cost_usd         numeric(10,5) not null default 0,
  is_public        boolean not null default false,
  share_count      int not null default 0,
  purge_at         timestamptz,   -- set on insert via trigger based on user tier
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (user_id, idempotency_key)
);

create index generations_user_idx        on public.generations(user_id, created_at desc);
create index generations_trend_idx       on public.generations(trend_id);
create index generations_status_idx      on public.generations(status) where status in ('pending', 'processing', 'failed_retryable');
create index generations_purge_idx       on public.generations(purge_at) where purge_at is not null;
create index generations_public_idx      on public.generations(trend_id, created_at desc) where is_public = true;

-- Set purge_at on insert based on user tier (Pro = NULL forever, Free = +30d)
create or replace function public.set_generation_purge_at()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_credits int;
begin
  select credits_balance into v_credits from public.profiles where id = new.user_id;
  if coalesce(v_credits, 0) > 0 then
    new.purge_at := null;  -- Pro = forever
  else
    new.purge_at := now() + interval '30 days';
  end if;
  return new;
end;
$$;

drop trigger if exists generations_set_purge on public.generations;
create trigger generations_set_purge
  before insert on public.generations
  for each row execute function public.set_generation_purge_at();

-- Decrement quota / credits on insert (atomic)
create or replace function public.consume_quota_on_generation_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = new.user_id for update;

  if v_profile.deleted_at is not null then
    raise exception 'profile deleted';
  end if;

  if v_profile.credits_balance > 0 then
    update public.profiles set credits_balance = credits_balance - 1 where id = new.user_id;
  elsif v_profile.free_used_this_week < 5 then
    update public.profiles set free_used_this_week = free_used_this_week + 1 where id = new.user_id;
  else
    raise exception 'quota exhausted';
  end if;

  return new;
end;
$$;

drop trigger if exists generations_consume_quota on public.generations;
create trigger generations_consume_quota
  before insert on public.generations
  for each row execute function public.consume_quota_on_generation_insert();

-- Refund quota on terminal failure (status -> 'failed')
create or replace function public.refund_quota_on_failure()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles;
begin
  if new.status = 'failed' and old.status is distinct from 'failed' then
    select * into v_profile from public.profiles where id = new.user_id for update;
    if v_profile.free_used_this_week > 0 then
      update public.profiles set free_used_this_week = free_used_this_week - 1 where id = new.user_id;
    else
      update public.profiles set credits_balance = credits_balance + 1 where id = new.user_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists generations_refund_quota on public.generations;
create trigger generations_refund_quota
  after update on public.generations
  for each row execute function public.refund_quota_on_failure();

-- RLS
alter table public.generations enable row level security;

create policy "generations_own_read" on public.generations
  for select using (auth.uid() = user_id);

-- Public gallery read — opt-in + completed
create policy "generations_public_gallery_read" on public.generations
  for select using (is_public = true and status = 'completed');

-- Users can insert only their own; trigger enforces quota
create policy "generations_own_insert" on public.generations
  for insert with check (auth.uid() = user_id);

-- Users can update is_public flag only (opt-in to gallery)
create policy "generations_own_update_share" on public.generations
  for update using (auth.uid() = user_id and status = 'completed')
  with check (auth.uid() = user_id);

-- Service role bypasses RLS for Edge Function updates (status, output_image_url, cost_usd)
