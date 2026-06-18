-- 20260605000001_admin_realtime.sql
-- Phase 4: realtime foundation for admin panel.
-- is_admin(): arg-free RLS helper for admin-gated Realtime channels.
-- admin_generations_feed: trigger-populated summary table for the live monitor.
--   PII excluded (no input_payload, no user email). replica identity full so
--   UPDATE payloads carry full row (needed for status transitions in monitor).
-- generations stays in supabase_realtime publication unchanged (ResultView depends on it).
-- trend_suggestions + anonymous_attempts get admin SELECT RLS for realtime.

-- 1. is_admin() helper (H-S13: arg-free, revoke from public)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid())
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- 2. admin_generations_feed: PII-free summary of generations for the live monitor.
--    Populated by AFTER INSERT/UPDATE trigger on generations.
--    Includes model, status, cost, attempts, error — NOT input_payload or output_image_url.
create table public.admin_generations_feed (
  id              uuid primary key,  -- same id as generations.id
  generation_id   uuid unique not null references public.generations(id) on delete cascade,
  user_id         uuid not null,
  trend_id        uuid,
  trend_slug      text,
  status          public.generation_status not null,
  tier            public.generation_tier,
  model_used      text,
  cost_usd        numeric(10,5) not null default 0,
  attempts        int not null default 0,
  error_reason    text,  -- generic error category, not raw error_message
  kimp_client_id  text,
  created_at      timestamptz not null,
  completed_at    timestamptz,
  updated_at      timestamptz not null default now()
);

-- replica identity full: UPDATE payloads carry full old+new row for the monitor
alter table public.admin_generations_feed replica identity full;

alter table public.admin_generations_feed enable row level security;

-- Admin-only SELECT (browser Realtime uses this)
create policy "admin_generations_feed_admin_read" on public.admin_generations_feed
  for select using (public.is_admin());

-- Add to supabase_realtime publication
alter publication supabase_realtime add table public.admin_generations_feed;

-- 3. Trigger to populate admin_generations_feed on generations INSERT/UPDATE
create or replace function public.sync_admin_generations_feed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_slug        text;
  v_error_cat   text;
begin
  -- Resolve trend slug (cached on the feed row to avoid join in monitor)
  select slug into v_slug from public.trends where id = new.trend_id;

  -- Categorize error without leaking full message
  v_error_cat := case
    when new.error_message ilike 'safety:%' then 'safety'
    when new.error_message ilike '%timeout%' or new.error_message ilike '%timed out%' then 'timeout'
    when new.error_message ilike 'terminal after%' then 'transient'
    when new.error_message is not null then 'error'
    else null
  end;

  insert into public.admin_generations_feed (
    id, generation_id, user_id, trend_id, trend_slug,
    status, tier, model_used, cost_usd, attempts, error_reason,
    kimp_client_id, created_at, completed_at, updated_at
  ) values (
    new.id, new.id, new.user_id, new.trend_id, v_slug,
    new.status, new.tier_at_generation, new.model_used, new.cost_usd,
    new.attempts, v_error_cat, new.kimp_client_id, new.created_at, new.completed_at, now()
  )
  on conflict (generation_id) do update set
    status       = excluded.status,
    tier         = excluded.tier,
    model_used   = coalesce(excluded.model_used, admin_generations_feed.model_used),
    cost_usd     = excluded.cost_usd,
    attempts     = excluded.attempts,
    error_reason = excluded.error_reason,
    completed_at = excluded.completed_at,
    updated_at   = now();

  return new;
end;
$$;

drop trigger if exists generations_sync_admin_feed on public.generations;
create trigger generations_sync_admin_feed
  after insert or update on public.generations
  for each row execute function public.sync_admin_generations_feed();

-- 4. trend_suggestions admin SELECT (enables Realtime for admin inbox)
create policy "trend_suggestions_admin_read" on public.trend_suggestions
  for select using (public.is_admin());

-- Add to publication (PK-only replica identity — payload is jsonb, don't broadcast full row H-R9)
alter publication supabase_realtime add table public.trend_suggestions;

-- 5. anonymous_attempts admin SELECT (enables monitor visibility into anon funnel H-R5)
create policy "anonymous_attempts_admin_read" on public.anonymous_attempts
  for select using (public.is_admin());

alter publication supabase_realtime add table public.anonymous_attempts;

-- Indexes for the monitor's initial query
create index admin_feed_created_idx on public.admin_generations_feed(created_at desc);
create index admin_feed_status_idx  on public.admin_generations_feed(status) where status in ('pending','processing','failed_retryable');
