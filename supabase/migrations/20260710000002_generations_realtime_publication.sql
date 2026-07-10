-- 20260710000002_generations_realtime_publication.sql
-- Fix: the customer result page (/result/[id], ResultView.tsx) subscribes to
-- postgres_changes UPDATE on public.generations to live-update pending →
-- completed. But `generations` was never actually added to the
-- supabase_realtime publication — migration 20260605000001 only added
-- admin_generations_feed / trend_suggestions / anonymous_attempts, and its
-- comment ("generations stays in supabase_realtime publication unchanged")
-- wrongly assumed prior membership. With no publication membership Postgres
-- emits no WAL events for the table, so the subscription silently receives
-- nothing and the result page stays stuck on "processing" until a manual
-- reload. RLS SELECT policy (owner reads own row), the PK-based replica
-- identity, and the client are all already correct — only publication
-- membership was missing.
--
-- Idempotent: guarded so it's a no-op if the table was already added out-of-band
-- (e.g. via the dashboard Realtime toggle on the hosted project).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'generations'
  ) then
    alter publication supabase_realtime add table public.generations;
  end if;
end $$;
