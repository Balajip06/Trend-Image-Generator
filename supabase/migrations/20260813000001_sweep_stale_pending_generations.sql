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
