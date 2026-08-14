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
