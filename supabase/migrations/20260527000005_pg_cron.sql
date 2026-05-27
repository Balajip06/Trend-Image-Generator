-- Migration 0005 — pg_cron scheduled jobs
-- Per amended plan §"Phased Build Plan Phase 4" + §"Decision Reversals R2, R3"

create extension if not exists pg_cron;

-- Weekly free quota reset — Sunday 00:00 UTC
-- Resets free_used_this_week for all profiles
select cron.schedule(
  'reset_free_weekly',
  '0 0 * * 0',
  $$
    update public.profiles
       set free_used_this_week = 0,
           free_week_starts_at = date_trunc('week', now())
     where deleted_at is null
       and free_used_this_week > 0;
  $$
);

-- Daily purge of expired free-tier generations + storage objects
-- Note: storage object deletion must be done separately via Edge Function or app code
-- (pg_cron cannot delete Storage objects). This job deletes the rows only.
select cron.schedule(
  'purge_expired_generations',
  '15 2 * * *',  -- 02:15 UTC daily
  $$
    delete from public.generations
     where purge_at is not null
       and purge_at < now();
  $$
);

-- Daily purge of expired anonymous attempts (24h TTL)
select cron.schedule(
  'purge_expired_anonymous',
  '30 2 * * *',  -- 02:30 UTC daily
  $$
    delete from public.anonymous_attempts
     where expires_at < now();
  $$
);

-- Daily purge of soft-deleted profiles older than 30 days (GDPR completion)
select cron.schedule(
  'purge_soft_deleted_profiles',
  '45 2 * * *',  -- 02:45 UTC daily
  $$
    delete from public.profiles
     where deleted_at is not null
       and deleted_at < now() - interval '30 days';
  $$
);
