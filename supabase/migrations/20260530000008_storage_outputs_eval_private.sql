-- Migration 0027 — Restrict public read on outputs/eval/* to service role
--
-- Red-team MEDIUM M7: the `outputs_public_read` policy from migration
-- 0007 allowed unrestricted SELECT for any caller across the entire
-- `outputs` bucket. Eval-run outputs land under `outputs/eval/<trend_id>/<run_id>.png`
-- (per app/admin/(authed)/trends/[id]/eval/actions.ts), which means a
-- guessable URL pattern exposes admin-only QA outputs to the public.
-- Those outputs include the eval input photos (often staged demographic
-- samples used to validate the trend prompt) — not catastrophic, but
-- not intended to be public-discoverable either.
--
-- Fix: scope the existing public-read policy so it excludes the `eval/`
-- prefix. Eval outputs are still served to admins via the service-role
-- client (`createServiceClient`), which bypasses RLS.
--
-- Trade-off: any existing public link that pointed at outputs/eval/...
-- breaks. Acceptable — we never published those URLs anywhere.
--
-- Policy ops on storage.objects must run as supabase_storage_admin
-- (the table's owner). The migration runner role can't drop or create
-- policies there directly — wrap in a transaction-local role switch.

do $$
begin
  set local role to supabase_storage_admin;

  drop policy if exists "outputs_public_read" on storage.objects;

  create policy "outputs_public_read" on storage.objects
    for select using (
      bucket_id = 'outputs'
      and (
        auth.role() = 'service_role'
        or (storage.foldername(name))[1] <> 'eval'
      )
    );

  comment on policy "outputs_public_read" on storage.objects is
    'Public read on outputs/* EXCEPT outputs/eval/* (admin QA outputs, service-role only).';
end $$;
