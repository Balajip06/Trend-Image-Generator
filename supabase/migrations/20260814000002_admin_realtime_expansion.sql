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
