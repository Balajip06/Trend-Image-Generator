-- MANUAL PUSH BUNDLE — 5 migrations, in order.
-- Target project: rkvhpiienwdeawqkrdxm
-- Generated for paste into the Supabase SQL editor.
--
-- Run as ONE transaction. If any statement fails, nothing is applied.
-- All statements are additive + idempotent (add column if not exists,
-- create index if not exists, on conflict do nothing, drop trigger if exists),
-- so re-running is a no-op. No DROP TABLE / TRUNCATE / DELETE anywhere.

begin;

-- ============================================================
-- 20260813000001_sweep_stale_pending_generations.sql
-- ============================================================
-- Migration — sweep generations that were never picked up (hourly pg_cron)
--
-- Four rows sat in `pending` for 31–34 days with `attempts = 0` and no
-- `error_message`: created 10–13 July, never claimed by the generation
-- worker. Nothing reaped them, so /admin/generations kept counting them as
-- "in progress" a month later, and the users who submitted them never saw a
-- terminal state — the request simply hung forever.
--
-- A row that has sat in `pending` or `processing` past the cutoff is not in
-- flight; the worker either never claimed it or died mid-call. Marking it
-- `failed` is what should have happened at the time:
--
--   * `refund_quota_on_failure` fires on the transition and restores the
--     credit or free-tier use (vip/kimp rows have nothing to refund, so the
--     trigger correctly no-ops for them)
--   * the row reaches a terminal state, so the admin counter tells the truth
--   * the user sees a failure instead of an indefinite spinner
--
-- The 6h cutoff is deliberately far above the ~8s typical render and the
-- Edge Function's own retry window, so this can only catch genuinely
-- abandoned work, never a slow-but-live generation.
--
-- Schedule wrapped in a pg_extension guard so `supabase reset` works on a
-- dev stack without pg_cron — matches 20260527000005_pg_cron.sql.

create or replace function public.sweep_stale_pending_generations()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_swept int;
begin
  with stale as (
    update public.generations
       set status = 'failed',
           error_message = coalesce(
             error_message,
             'Generation worker never reported back; swept as stale.'
           )
     where status in ('pending', 'processing')
       and created_at < now() - interval '6 hours'
    returning id
  )
  select count(*) into v_swept from stale;

  if v_swept > 0 then
    raise notice 'sweep_stale_pending_generations: marked % row(s) failed', v_swept;
  end if;
end;
$$;

comment on function public.sweep_stale_pending_generations() is
  'Marks generations abandoned by the worker as failed so quota is refunded and admin counters stay accurate.';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('sweep-stale-pending-generations')
      where exists (
        select 1 from cron.job where jobname = 'sweep-stale-pending-generations'
      );

    perform cron.schedule(
      'sweep-stale-pending-generations',
      '17 * * * *',
      $cron$select public.sweep_stale_pending_generations();$cron$
    );
  end if;
end;
$$;

-- ============================================================
-- 20260814000001_invoke_edge_on_retry.sql
-- ============================================================
-- Fire the generate-image Edge Function on RETRY, not just on INSERT.
--
-- ROOT CAUSE this fixes: `generations_invoke_edge` (migration 20260713000001)
-- is declared `after insert ... when (new.status = 'pending')`. But
-- `/api/generate/retry` re-queues a failed row with an UPDATE:
--
--     update generations set status='pending', attempts=attempts+1 where id=...
--
-- An UPDATE never fires an INSERT-only trigger, so nothing ever picked the row
-- back up. The route returned `{ ok: true }`, the row sat at `pending`, and the
-- user-facing "Try again" button in ResultView.tsx spun forever — until the
-- hourly `sweep_stale_pending_generations` job marked it failed 6 hours later.
--
-- That sweep exists (migration 20260813000001) because four rows sat pending
-- for 31-34 days. Its header attributes them to a worker that "never claimed"
-- them; this INSERT-only trigger is one reason why.
--
-- The Edge Function is safe to invoke again: it claims work with a conditional
-- `update ... where status='pending'` and returns early if the row was already
-- claimed, so a double delivery is a no-op rather than a double charge.
--
-- Quota is NOT double-consumed on this path: `consume_quota_on_generation_retry`
-- (migration 20260601000004) only re-consumes on a `failed -> pending`
-- transition, and the retry route only accepts `failed_retryable` rows, which
-- keep their original deduction.

create or replace function public.invoke_generate_image()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  fn_url    text;
  fn_secret text;
begin
  -- Pull config from Vault. If either secret is missing (environment not yet
  -- configured), skip silently rather than erroring the INSERT — the row still
  -- lands as `pending` and can be retried once secrets are set.
  select decrypted_secret into fn_url
    from vault.decrypted_secrets where name = 'edge_generate_image_url';
  select decrypted_secret into fn_secret
    from vault.decrypted_secrets where name = 'edge_webhook_secret';

  if fn_url is null or fn_secret is null then
    raise warning 'invoke_generate_image: missing Vault secret(s); skipping webhook for generation %', new.id;
    return new;
  end if;

  perform net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || fn_secret
    ),
    body := jsonb_build_object(
      -- The Edge Function only accepts type='INSERT' (it ignores everything
      -- else), and a retry is semantically a fresh dispatch of the same row,
      -- so both paths report 'INSERT'.
      'type', 'INSERT',
      'table', 'generations',
      'schema', 'public',
      'record', to_jsonb(new)
    )
  );

  return new;
end;
$$;

-- INSERT path: unchanged.
drop trigger if exists generations_invoke_edge on public.generations;
create trigger generations_invoke_edge
  after insert on public.generations
  for each row
  when (new.status = 'pending')
  execute function public.invoke_generate_image();

-- RETRY path: a terminal row flipped back to 'pending'. Scoped to that exact
-- transition so ordinary status churn (pending -> processing -> completed)
-- cannot re-dispatch a row mid-flight.
drop trigger if exists generations_invoke_edge_on_retry on public.generations;
create trigger generations_invoke_edge_on_retry
  after update on public.generations
  for each row
  when (
    new.status = 'pending'
    and old.status is distinct from new.status
    and old.status in ('failed', 'failed_retryable')
  )
  execute function public.invoke_generate_image();

comment on function public.invoke_generate_image is
  'Dispatches a generations row to the generate-image Edge Function. Fired on INSERT of a pending row and on a terminal->pending retry transition. Skips silently when Vault secrets are unset.';

-- ============================================================
-- 20260814000002_admin_realtime_expansion.sql
-- ============================================================
-- Realtime for the admin console.
--
-- Two things are required for a browser subscription to receive anything, and
-- BOTH were missing for every table below:
--
--   1. Publication membership. With no membership Postgres emits no WAL events
--      at all, so the channel reaches SUBSCRIBED and then sits silent. This
--      exact trap already cost us once — migration 20260710000002 exists solely
--      because an earlier migration ASSUMED `generations` was in the
--      publication when it never had been.
--
--   2. An RLS SELECT policy the admin actually satisfies. postgres_changes
--      re-checks RLS per row, per subscriber. `admin_marketing_spend` and
--      `trend_events` have no SELECT policy at all; `profiles`, `referrals`,
--      and `trends` have only self/public policies that an admin viewing OTHER
--      users' rows does not match.
--
-- Deliberately NOT setting `replica identity full` on `profiles`: that would
-- broadcast every column of every changed user row (including email) to every
-- admin socket. PK-only identity is enough for the refresh-on-change pattern,
-- and matches the same call made for `trend_suggestions` in 20260605000001.

-- ---------------------------------------------------------------------------
-- 1. Admin SELECT policies (via the existing arg-free is_admin() helper)
-- ---------------------------------------------------------------------------

-- Admins need to see ALL trends, including drafts; `trends_public_read` only
-- exposes active, unexpired, already-live rows.
drop policy if exists "trends_admin_read" on public.trends;
create policy "trends_admin_read" on public.trends
  for select using (public.is_admin());

-- `profiles_self_read` matches only the admin's own row.
drop policy if exists "profiles_admin_read" on public.profiles;
create policy "profiles_admin_read" on public.profiles
  for select using (public.is_admin());

-- `referrals_self_read` matches only referrals the admin is party to.
drop policy if exists "referrals_admin_read" on public.referrals;
create policy "referrals_admin_read" on public.referrals
  for select using (public.is_admin());

-- No SELECT policy existed on either of these.
drop policy if exists "admin_marketing_spend_admin_read" on public.admin_marketing_spend;
create policy "admin_marketing_spend_admin_read" on public.admin_marketing_spend
  for select using (public.is_admin());

drop policy if exists "trend_events_admin_read" on public.trend_events;
create policy "trend_events_admin_read" on public.trend_events
  for select using (public.is_admin());

-- `admin_audit_log` + `kimp_client_allowlist` already have admin SELECT
-- policies (migrations 20260527000004 / 20260603000001); nothing to add.

-- ---------------------------------------------------------------------------
-- 2. Publication membership (idempotent — mirrors 20260710000002's guard so a
--    re-run, or a table already toggled on via the dashboard, is a no-op)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'admin_audit_log',
    'trends',
    'profiles',
    'referrals',
    'kimp_client_allowlist',
    'admin_marketing_spend',
    'trend_events'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Index for the audit page's ordering
-- ---------------------------------------------------------------------------

-- /admin/audit runs `order by created_at desc limit 100` with no filter. The
-- existing indexes are (admin_id, created_at desc) and (target_table,
-- target_id) — neither has a usable leading column for that scan.
create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);

-- ============================================================
-- 20260814000003_model_cost_limits.sql
-- ============================================================
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

-- ============================================================
-- 20260814000004_anonymous_generation_dispatch.sql
-- ============================================================
-- Make the anonymous trial actually work.
--
-- IT IS CURRENTLY DEAD END-TO-END:
--   * `/api/generate-anonymous` validates the upload, then inserts a row with
--     only (fingerprint_hash, ip_hash, trend_id, status) — the user's photo and
--     field values are DISCARDED, because no column exists to hold them.
--   * No trigger dispatches anonymous rows, and the generate-image Edge
--     Function has no anonymous handling at all (`grep anonymous` → nothing).
--     Rows sit at `pending` forever; `/api/anonymous/[id]/status` polls a status
--     that never changes.
--   * Because nothing ever completes, `cost_usd` is never written — so the
--     $20/day anonymous budget in that route sums zeros and can never fire.
--
-- This migration adds the missing input column and the dispatch trigger. The
-- Edge Function is taught to process both row shapes separately.

-- ---------------------------------------------------------------------------
-- 1. Somewhere to put the input
-- ---------------------------------------------------------------------------
alter table public.anonymous_attempts
  add column if not exists input_payload jsonb;

comment on column public.anonymous_attempts.input_payload is
  'Schema-driven field values + uploaded image URLs, same shape as generations.input_payload. Without this the Edge Function has nothing to generate from.';

-- Track which model ran, for cost attribution — mirrors generations.model_key
-- so anonymous spend lands in the same per-model ceiling as customer traffic.
alter table public.anonymous_attempts
  add column if not exists model_key text;

alter table public.anonymous_attempts
  add column if not exists error_message text;

create index if not exists anonymous_attempts_model_key_created_idx
  on public.anonymous_attempts (model_key, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Count anonymous spend toward the per-model ceiling
-- ---------------------------------------------------------------------------
-- Anonymous traffic is unauthenticated and costs real money, so it must be
-- visible to the same gate as everything else. The separate $20/day anonymous
-- budget stays as a second, independent bound.
create or replace function public.model_spend_usd(p_model text)
returns table (daily_usd numeric, monthly_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
  with day_start as (select date_trunc('day', now() at time zone 'utc') as t),
       month_start as (select date_trunc('month', now() at time zone 'utc') as t)
  select
    coalesce((select sum(cost_usd) from public.generations
               where model_key = p_model and created_at >= (select t from day_start)), 0)
    + coalesce((select sum(cost_usd) from public.trend_eval_runs
               where model = p_model and created_at >= (select t from day_start)), 0)
    + coalesce((select sum(cost_usd) from public.anonymous_attempts
               where model_key = p_model and created_at >= (select t from day_start)), 0)
      as daily_usd,
    coalesce((select sum(cost_usd) from public.generations
               where model_key = p_model and created_at >= (select t from month_start)), 0)
    + coalesce((select sum(cost_usd) from public.trend_eval_runs
               where model = p_model and created_at >= (select t from month_start)), 0)
    + coalesce((select sum(cost_usd) from public.anonymous_attempts
               where model_key = p_model and created_at >= (select t from month_start)), 0)
      as monthly_usd;
$$;

revoke all on function public.model_spend_usd(text) from public;
grant execute on function public.model_spend_usd(text) to authenticated, service_role;

comment on function public.model_spend_usd is
  'Daily + month-to-date USD spend for one logical model across ALL spend paths: customer generations, admin eval runs, and anonymous trials. Single source for the cost gate and the admin meters.';

-- ---------------------------------------------------------------------------
-- 3. Dispatch anonymous rows to the Edge Function
-- ---------------------------------------------------------------------------
-- Mirrors invoke_generate_image (20260713000001 / 20260814000001) but reports
-- the source table so the function knows which shape it received. Fires only
-- once the input payload is present — a row without it cannot be generated.
create or replace function public.invoke_generate_anonymous()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  fn_url    text;
  fn_secret text;
begin
  select decrypted_secret into fn_url
    from vault.decrypted_secrets where name = 'edge_generate_image_url';
  select decrypted_secret into fn_secret
    from vault.decrypted_secrets where name = 'edge_webhook_secret';

  -- Same fail-soft posture as the authenticated dispatcher: an unconfigured
  -- environment leaves the row pending rather than erroring the INSERT.
  if fn_url is null or fn_secret is null then
    raise warning 'invoke_generate_anonymous: missing Vault secret(s); skipping webhook for attempt %', new.id;
    return new;
  end if;

  perform net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || fn_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'anonymous_attempts',
      'schema', 'public',
      'record', to_jsonb(new)
    )
  );

  return new;
end;
$$;

drop trigger if exists anonymous_attempts_invoke_edge on public.anonymous_attempts;
create trigger anonymous_attempts_invoke_edge
  after insert on public.anonymous_attempts
  for each row
  when (new.status = 'pending' and new.input_payload is not null)
  execute function public.invoke_generate_anonymous();

comment on function public.invoke_generate_anonymous is
  'Dispatches an anonymous_attempts row to the generate-image Edge Function. Anonymous rows were previously never dispatched at all, so the trial never completed.';

commit;
