-- Migration 0030 — Loosen profiles_self_read USING clause
--
-- Bug surfaced by integration test: a user calling
--   update public.profiles set deleted_at = now() where id = auth.uid()
-- failed with SQLSTATE 42501 (ExecWithCheckOptions), even though my
-- replacement profiles_self_update policy (migration 0029) explicitly
-- permits `auth.uid() = id` on the post-image.
--
-- Root cause: Postgres composes SELECT policies into UPDATE evaluation.
-- For every UPDATE on an RLS-enabled table, Postgres runs the SELECT
-- policy's USING clause AGAINST THE POST-IMAGE to confirm the row
-- "remains visible" after the update. The old profiles_self_read used
--   USING (auth.uid() = id AND deleted_at IS NULL)
-- which means once the user sets deleted_at = now(), the post-image's
-- second clause is FALSE → SELECT visibility fails → UPDATE is rejected
-- → user can't soft-delete themselves.
--
-- Fix: drop the deleted_at gating from profiles_self_read. A user
-- mid-soft-delete remains entitled to "see" the row they just stamped;
-- the brief read window (until signOut redirects) is harmless. Apps
-- that need to hide soft-deleted users from their own view filter at
-- the application layer (the home/me pages already check
-- `profile.deleted_at IS NULL` before rendering).
--
-- This also fixes a latent UX bug: a previously soft-deleted user who
-- somehow regained a session could not have re-read their own row to
-- detect that state and show the right "your account is deleted" UI;
-- the read policy was over-eager.

drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles
  for select using (auth.uid() = id);
