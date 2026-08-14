-- Per-model USD cost limits, admin-editable.
--
-- WHY: nothing caps AI spend per model today. The two existing budgets are
-- env-var only (redeploy to change) and neither is per-model:
--   * ANONYMOUS_DAILY_BUDGET_USD sums `anonymous_attempts.cost_usd`, a column
--     nothing ever writes — it sums zeros and can never fire.
--   * /api/generate caps unlimited tiers with `UNLIMITED_DAILY_BUDGET_USD * 10`,
--     a hardcoded $0.10/generation assumption against real rates spanning
--     $0.002–$0.04 (a 20x spread).
--
-- This migration adds:
--   1. `app_settings.model_cost_limits` — the admin-editable ceilings.
--   2. `generations.model_key` — the LOGICAL model, alongside the existing
--      `model_used` (which stores the provider's wire id).
--   3. `public.model_spend_usd()` — one authoritative spend reader.
--   4. `trend_eval_runs.cost_usd` — admin eval spends real money and recorded
--      none of it, so eval was invisible to margins AND to any ceiling.

-- ---------------------------------------------------------------------------
-- 1. Limits
-- ---------------------------------------------------------------------------
-- Shape, per model: { daily_usd, monthly_usd, enabled }
-- SQL NULL for a bound means "no limit" (see 20260714000001 — `value` is
-- nullable and NULL is the established "no override" convention).
insert into public.app_settings (key, value)
values (
  'model_cost_limits',
  jsonb_build_object(
    'nano-banana-2',      jsonb_build_object('daily_usd', 25, 'monthly_usd', 500, 'enabled', true),
    'nano-banana-2-lite', jsonb_build_object('daily_usd', 10, 'monthly_usd', 200, 'enabled', true),
    'gpt-image-2',        jsonb_build_object('daily_usd', 50, 'monthly_usd', 900, 'enabled', true)
  )
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Logical model key on generations
-- ---------------------------------------------------------------------------
-- `model_used` holds the WIRE id the provider was called with
-- (e.g. 'gemini-3.1-flash-image', or whatever OPENAI_IMAGE_MODEL is set to),
-- not the logical key the limits are keyed on ('nano-banana-2'). Deriving one
-- from the other means maintaining a reverse map that silently breaks whenever
-- a wire id changes. Storing the logical key removes that hazard.
alter table public.generations
  add column if not exists model_key text;

comment on column public.generations.model_key is
  'Logical model id (nano-banana-2 | nano-banana-2-lite | gpt-image-2). Cost limits key on this; model_used holds the provider wire id.';

-- Spend lookups are always (model, time-window).
create index if not exists generations_model_key_created_idx
  on public.generations (model_key, created_at desc);

-- Backfill what can be inferred from the wire ids in use today. Rows whose wire
-- id is unrecognised stay NULL rather than being guessed into a bucket.
update public.generations
   set model_key = case
     when model_used like 'gemini-3.1-flash-lite%' then 'nano-banana-2-lite'
     when model_used like 'gemini-3.1-flash-image%' then 'nano-banana-2'
     when model_used like 'gpt-image%' then 'gpt-image-2'
     else null
   end
 where model_key is null
   and model_used is not null;

-- ---------------------------------------------------------------------------
-- 3. Eval cost tracking
-- ---------------------------------------------------------------------------
-- `runEval` calls the provider directly and recorded no cost at all, so every
-- eval run (~$0.04 on gpt-image-2) was invisible to margin and uncapped.
-- Declared BEFORE model_spend_usd(), which reads this column.
alter table public.trend_eval_runs
  add column if not exists cost_usd numeric(10,5) not null default 0;

create index if not exists trend_eval_runs_model_created_idx
  on public.trend_eval_runs (model, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Authoritative spend reader
-- ---------------------------------------------------------------------------
-- One function so the Edge gate and the admin UI can never disagree. Counts
-- BOTH customer generations and admin eval runs — eval spends real money on the
-- same models and must count against the same ceiling.
create or replace function public.model_spend_usd(p_model text)
returns table (daily_usd numeric, monthly_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((
      select sum(cost_usd) from public.generations
       where model_key = p_model
         and created_at >= date_trunc('day', now() at time zone 'utc')
    ), 0)
    + coalesce((
      select sum(cost_usd) from public.trend_eval_runs
       where model = p_model
         and created_at >= date_trunc('day', now() at time zone 'utc')
    ), 0) as daily_usd,
    coalesce((
      select sum(cost_usd) from public.generations
       where model_key = p_model
         and created_at >= date_trunc('month', now() at time zone 'utc')
    ), 0)
    + coalesce((
      select sum(cost_usd) from public.trend_eval_runs
       where model = p_model
         and created_at >= date_trunc('month', now() at time zone 'utc')
    ), 0) as monthly_usd;
$$;

revoke all on function public.model_spend_usd(text) from public;
grant execute on function public.model_spend_usd(text) to authenticated, service_role;

comment on function public.model_spend_usd is
  'Daily + month-to-date USD spend for one logical model, across customer generations and admin eval runs. Single source for the cost gate and the admin meters.';

-- ---------------------------------------------------------------------------
-- 5. Surface cost-limit blocks in the admin monitor
-- ---------------------------------------------------------------------------
-- The feed categorises error_message into a coarse reason. Without a branch
-- for cost limits, a blocked generation is indistinguishable from a generic
-- failure in /admin/generations.
create or replace function public.sync_admin_generations_feed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_slug        text;
  v_error_cat   text;
begin
  select slug into v_slug from public.trends where id = new.trend_id;

  v_error_cat := case
    when new.error_message ilike 'cost_limit:%' then 'cost_limit'
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
