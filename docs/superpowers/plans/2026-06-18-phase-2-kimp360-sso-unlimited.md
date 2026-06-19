# Phase 2 — KIMP360 Tier, SSO, Churn Re-verify, Cost Controls

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the KIMP360 unlimited tier, SSO initiate/callback routes, admin allowlist fallback, nightly churn cron, per-user cost controls, and harden auth (drop email signup, add consumer forgot-password, fix GoTrue project-level settings).

**Architecture:**

- KIMP360 client status lives on `profiles.kimp_unlimited boolean` (hot-path bypass in quota trigger, added in Phase 0 migrations) + supporting columns (`kimp_subject_id`, `kimp_client_status`, `kimp_verified_at`, `kimp_client_id`).
- SSO uses a dedicated initiate route (`GET /api/auth/kimp/initiate`) that builds PKCE + state, stores them in a `kimp_oidc_tx` httpOnly cookie, and redirects to the KIMP360 authorization URL. The callback route (`/auth/kimp/callback`) validates the response and bridges into Supabase via the admin API. **Until KIMP360 provides a real IdP, the allowlist in `kimp_client_allowlist` is the active path.**
- `kimp_unlimited` is set **server-side only** by a SECURITY DEFINER `grant_kimp_unlimited()` RPC — never from client-held claims.
- Nightly Vercel Cron mirrors `run-trend-discovery` pattern: `CRON_SECRET` bearer, service-role, `logAdminAction`.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase Postgres (PL/pgSQL), Zod, Vitest.

## Global Constraints

- Migration files: `20260603NNNNNN_<slug>.sql` sequential timestamps.
- Every PL/pgSQL function: `security definer set search_path = public`.
- `kimp_unlimited` must be set **only** via `grant_kimp_unlimited()` RPC (SECURITY DEFINER, revoke from public, grant to service_role). No direct UPDATE of this column from app code.
- `app/api/auth/kimp/initiate/route.ts` returns a `302` redirect to the KIMP360 auth URL — it is a GET Route Handler, NOT a server action (server actions can't return external redirects).
- All KIMP env vars optional: `KIMP360_OIDC_ISSUER`, `KIMP360_OIDC_CLIENT_ID`, `KIMP360_OIDC_CLIENT_SECRET`, `KIMP360_STATUS_API_URL`, `KIMP360_STATUS_API_KEY`, `CRON_SECRET` (promote from raw `process.env` to `lib/env.ts`).
- `supabase/config.toml`: set `enable_signup = false` (both `[auth]` and `[auth.email]` sections) and `enable_confirmations = true` in `[auth.email]`.
- `requireAdminRole('admin')` must gate the allowlist add/remove actions (from Phase 1).
- `pnpm typecheck` → `npx tsc --noEmit`; `npx vitest run` must pass.
- Commit messages follow conventional commits (`feat:`, `fix:`, `chore:`).

---

## File Map

**Create (migrations):**

- `supabase/migrations/20260603000001_profiles_kimp_columns.sql` — add kimp columns, lockdown update, `grant_kimp_unlimited()` RPC, `enforce_kimp_unlimited_proof()` trigger, `kimp_client_allowlist` table, `webhook_events` source relaxation, `kimp_verifications` table
- `supabase/migrations/20260603000002_generations_kimp_client_id.sql` — add `generations.kimp_client_id` column + stamp in quota trigger

**Create (lib):**

- `lib/auth/kimp/pkce.ts` — PKCE helpers (generateCodeVerifier, generateCodeChallenge, generateState, generateNonce)
- `lib/auth/kimp/resolve-entitlement.ts` — ordered resolver: OIDC claim → status-API → allowlist → `'unverified'`
- `lib/auth/kimp/status-client.ts` — HMAC-signed status API client
- `lib/account/tier.ts` — `getAccountTier(userId)` helper → `'kimp' | 'free' | 'standard'`

**Create (routes):**

- `app/api/auth/kimp/initiate/route.ts` — GET: build PKCE + state, set cookie, redirect to KIMP360
- `app/auth/kimp/callback/route.ts` — GET: validate state/PKCE, bridge into Supabase, stamp kimp status, redirect
- `app/api/admin/kimp-reverify/route.ts` — POST: nightly cron + manual trigger
- `app/admin/(authed)/kimp/page.tsx` — allowlist CRUD page
- `app/admin/(authed)/kimp/actions.ts` — add/deactivate allowlist entries

**Modify:**

- `supabase/config.toml` — disable signups, enable confirmations
- `lib/env.ts` — add KIMP + CRON_SECRET env vars
- `app/(auth)/login/actions.ts` — remove signUp fallback; add `signInWithKimp`
- `app/(auth)/login/LoginForms.tsx` — add KIMP button; update email form to login-only copy; add forgot-password link
- `app/(auth)/login/page.tsx` — add `kimp_account_conflict` + `invalid_credentials` error copy
- `lib/auth/post-auth-onboarding.ts` — add KIMP stamp step
- `vercel.json` — add kimp-reverify cron + function entry
- `components/admin/AdminShell.tsx` — add KIMP nav item (Operations group)

---

## Task 1 — DB migrations: kimp columns, proof gate, allowlist, webhook source

**Files:**

- Create: `supabase/migrations/20260603000001_profiles_kimp_columns.sql`

**Interfaces:**

- Produces: `profiles.kimp_subject_id`, `kimp_client_status enum`, `kimp_unlimited`, `kimp_linked_at`, `kimp_verified_at`, `kimp_client_id` — all locked in `enforce_profiles_self_update_lockdown`
- Produces: `kimp_verifications(kimp_subject_id, user_id, source, verified_at, confirmed)` table
- Produces: `grant_kimp_unlimited(p_user_id, p_subject, p_client_id, p_verified_at)` SECURITY DEFINER RPC
- Produces: `enforce_kimp_unlimited_proof()` BEFORE UPDATE trigger (no service-role bypass)
- Produces: `kimp_client_allowlist(email, kimp_subject_id, is_active, note, added_by)` table
- Produces: `webhook_events.source` check extended to include `'kimp360'`

- [ ] **Step 1: Write the migration**

```sql
-- 20260603000001_profiles_kimp_columns.sql
-- Phase 2: KIMP360 unlimited tier schema.
-- kimp_unlimited = single boolean on the hot path (mirrors is_vip pattern).
-- grant_kimp_unlimited() is the ONLY writer of kimp_unlimited=true.
-- enforce_kimp_unlimited_proof() fires on every UPDATE regardless of caller
-- (no service-role bypass — like require_eval_proof_for_passed).

-- 1. Enum for client status
create type public.kimp_client_status as enum ('active', 'inactive', 'unverified');

-- 2. Add kimp columns to profiles
alter table public.profiles
  add column if not exists kimp_subject_id      text unique,
  add column if not exists kimp_client_status   public.kimp_client_status not null default 'unverified',
  add column if not exists kimp_unlimited        boolean not null default false,
  add column if not exists kimp_linked_at        timestamptz,
  add column if not exists kimp_verified_at      timestamptz,
  add column if not exists kimp_client_id        text;

create unique index profiles_kimp_subject_idx on public.profiles(kimp_subject_id)
  where kimp_subject_id is not null;
create index profiles_kimp_unlimited_idx on public.profiles(id)
  where kimp_unlimited = true;

-- 3. Lock ALL new kimp columns in enforce_profiles_self_update_lockdown
--    (H-S1: the lockdown is a denylist — must add each new column explicitly)
create or replace function public.enforce_profiles_self_update_lockdown()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then return new; end if;
  if v_actor <> old.id then return new; end if;

  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'profiles_self_update: cannot clear deleted_at' using errcode = 'check_violation';
  end if;
  if old.tos_accepted_at is not null and new.tos_accepted_at is null then
    raise exception 'profiles_self_update: cannot clear tos_accepted_at' using errcode = 'check_violation';
  end if;

  -- Locked columns (allowlist-by-exclusion: any column NOT listed here and not in
  -- {name, avatar_url, push_subscription, tos_accepted_at, acquisition_source, deleted_at}
  -- must be added to this block)
  if new.id                              is distinct from old.id                              then raise exception 'profiles_self_update: id is locked'                              using errcode = 'check_violation'; end if;
  if new.email                           is distinct from old.email                           then raise exception 'profiles_self_update: email is locked'                           using errcode = 'check_violation'; end if;
  if new.monthly_credits                 is distinct from old.monthly_credits                 then raise exception 'profiles_self_update: monthly_credits is locked'                 using errcode = 'check_violation'; end if;
  if new.purchased_credits               is distinct from old.purchased_credits               then raise exception 'profiles_self_update: purchased_credits is locked'               using errcode = 'check_violation'; end if;
  if new.monthly_credits_reset_at        is distinct from old.monthly_credits_reset_at        then raise exception 'profiles_self_update: monthly_credits_reset_at is locked'        using errcode = 'check_violation'; end if;
  if new.free_used_this_week             is distinct from old.free_used_this_week             then raise exception 'profiles_self_update: free_used_this_week is locked'             using errcode = 'check_violation'; end if;
  if new.free_week_starts_at             is distinct from old.free_week_starts_at             then raise exception 'profiles_self_update: free_week_starts_at is locked'             using errcode = 'check_violation'; end if;
  if new.referral_code                   is distinct from old.referral_code                   then raise exception 'profiles_self_update: referral_code is locked'                   using errcode = 'check_violation'; end if;
  if new.bonus_credits_earned            is distinct from old.bonus_credits_earned            then raise exception 'profiles_self_update: bonus_credits_earned is locked'            using errcode = 'check_violation'; end if;
  if new.created_at                      is distinct from old.created_at                      then raise exception 'profiles_self_update: created_at is locked'                      using errcode = 'check_violation'; end if;
  if new.is_vip                          is distinct from old.is_vip                          then raise exception 'profiles_self_update: is_vip is locked'                          using errcode = 'check_violation'; end if;
  if new.vip_reason                      is distinct from old.vip_reason                      then raise exception 'profiles_self_update: vip_reason is locked'                      using errcode = 'check_violation'; end if;
  if new.vip_granted_by                  is distinct from old.vip_granted_by                  then raise exception 'profiles_self_update: vip_granted_by is locked'                  using errcode = 'check_violation'; end if;
  if new.vip_granted_at                  is distinct from old.vip_granted_at                  then raise exception 'profiles_self_update: vip_granted_at is locked'                  using errcode = 'check_violation'; end if;
  if new.first_purchase_discount_used_at is distinct from old.first_purchase_discount_used_at then raise exception 'profiles_self_update: first_purchase_discount_used_at is locked' using errcode = 'check_violation'; end if;
  if new.referred_by                     is distinct from old.referred_by                     then raise exception 'profiles_self_update: referred_by is locked'                     using errcode = 'check_violation'; end if;
  -- KIMP columns (H-S1: must all be locked; kimp_subject_id MUST be locked or
  -- enforce_kimp_unlimited_proof gate is self-defeated)
  if new.kimp_subject_id     is distinct from old.kimp_subject_id     then raise exception 'profiles_self_update: kimp_subject_id is locked'     using errcode = 'check_violation'; end if;
  if new.kimp_client_status  is distinct from old.kimp_client_status  then raise exception 'profiles_self_update: kimp_client_status is locked'  using errcode = 'check_violation'; end if;
  if new.kimp_unlimited       is distinct from old.kimp_unlimited       then raise exception 'profiles_self_update: kimp_unlimited is locked'       using errcode = 'check_violation'; end if;
  if new.kimp_linked_at      is distinct from old.kimp_linked_at      then raise exception 'profiles_self_update: kimp_linked_at is locked'      using errcode = 'check_violation'; end if;
  if new.kimp_verified_at    is distinct from old.kimp_verified_at    then raise exception 'profiles_self_update: kimp_verified_at is locked'    using errcode = 'check_violation'; end if;
  if new.kimp_client_id      is distinct from old.kimp_client_id      then raise exception 'profiles_self_update: kimp_client_id is locked'      using errcode = 'check_violation'; end if;

  return new;
end;
$$;

-- 4. kimp_verifications: out-of-band provenance table for enforce_kimp_unlimited_proof
--    (mirrors require_eval_proof_for_passed pattern — proof must exist before grant)
create table public.kimp_verifications (
  id              uuid primary key default gen_random_uuid(),
  kimp_subject_id text not null,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  kimp_client_id  text,
  source          text not null check (source in ('oidc', 'status_api', 'allowlist')),
  verified_at     timestamptz not null,
  confirmed       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (kimp_subject_id, user_id)
);

alter table public.kimp_verifications enable row level security;
-- Service-role only — no client policies

-- 5. grant_kimp_unlimited — the ONLY writer of kimp_unlimited=true
--    (H-S4: no direct UPDATE of kimp_unlimited from app code)
create or replace function public.grant_kimp_unlimited(
  p_user_id     uuid,
  p_subject     text,
  p_client_id   text,
  p_verified_at timestamptz
)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Upsert the verification proof row first (enforce_kimp_unlimited_proof reads it)
  insert into public.kimp_verifications (kimp_subject_id, user_id, kimp_client_id, source, verified_at, confirmed)
  values (p_subject, p_user_id, p_client_id, 'oidc', p_verified_at, true)
  on conflict (kimp_subject_id, user_id) do update
    set kimp_client_id = excluded.kimp_client_id,
        source         = excluded.source,
        verified_at    = excluded.verified_at,
        confirmed      = true;

  -- Now grant unlimited — proof row exists so the trigger will pass
  update public.profiles
    set kimp_unlimited      = true,
        kimp_subject_id     = p_subject,
        kimp_client_id      = p_client_id,
        kimp_client_status  = 'active',
        kimp_verified_at    = p_verified_at,
        kimp_linked_at      = coalesce(kimp_linked_at, now())
  where id = p_user_id and deleted_at is null;

  if not found then
    raise exception 'grant_kimp_unlimited: profile % not found or deleted', p_user_id;
  end if;

  insert into public.admin_audit_log (admin_id, action, target_table, target_id, after)
  values (null, 'kimp_unlimited_granted', 'profiles', p_user_id::text,
    jsonb_build_object('subject', p_subject, 'client_id', p_client_id, 'source', 'oidc'));
end;
$$;

revoke all on function public.grant_kimp_unlimited(uuid, text, text, timestamptz) from public;
grant execute on function public.grant_kimp_unlimited(uuid, text, text, timestamptz) to service_role;

-- 6. enforce_kimp_unlimited_proof — BEFORE UPDATE, no service-role bypass
--    (H-S4: requires confirmed verification row before kimp_unlimited can go true)
create or replace function public.enforce_kimp_unlimited_proof()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_proof_count int;
begin
  -- Only fire on false → true transition
  if (new.kimp_unlimited is not distinct from old.kimp_unlimited) then return new; end if;
  if new.kimp_unlimited is not true then return new; end if;

  -- Check for out-of-band proof: a confirmed kimp_verifications row OR an active allowlist entry
  select count(*) into v_proof_count
    from public.kimp_verifications kv
   where kv.user_id = new.id
     and kv.confirmed = true
     and kv.kimp_subject_id = new.kimp_subject_id
     and kv.verified_at >= now() - interval '14 days';

  if v_proof_count = 0 then
    -- Check allowlist fallback
    select count(*) into v_proof_count
      from public.kimp_client_allowlist kal
     where lower(kal.email) = lower((select email from public.profiles where id = new.id))
       and kal.is_active = true;
  end if;

  if v_proof_count = 0 then
    raise exception 'enforce_kimp_unlimited_proof: kimp_unlimited cannot be set to true without a confirmed verification or active allowlist entry for profile %', new.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- NOTE: this trigger has NO service-role bypass — auth.uid() check is deliberately absent
-- so it fires for service-role writes too (defense-in-depth for H-S4)
drop trigger if exists enforce_kimp_unlimited_proof on public.profiles;
create trigger enforce_kimp_unlimited_proof
  before update on public.profiles
  for each row execute function public.enforce_kimp_unlimited_proof();

-- 7. kimp_client_allowlist — fallback while KIMP360 IdP is not yet available
create table public.kimp_client_allowlist (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  kimp_subject_id text,
  is_active       boolean not null default true,
  note            text,
  added_by        uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (lower(email))
);

create index kimp_allowlist_active_idx on public.kimp_client_allowlist(lower(email))
  where is_active = true;

alter table public.kimp_client_allowlist enable row level security;

-- Admin-read (role='admin' only — H-S2: money-granting surface)
create policy "kimp_allowlist_admin_read" on public.kimp_client_allowlist
  for select using (
    exists (
      select 1 from public.admin_users
      where user_id = auth.uid() and role = 'admin'
    )
  );
-- Writes: service-role only

-- 8. Extend webhook_events.source to allow 'kimp360' (for cron reconciliation)
alter table public.webhook_events drop constraint if exists webhook_events_source_check;
alter table public.webhook_events
  add constraint webhook_events_source_check
  check (source in ('stripe', 'kimp360'));
```

- [ ] **Step 2: Apply and verify**

```bash
./node_modules/.bin/supabase db reset
./node_modules/.bin/supabase db query "SELECT column_name FROM information_schema.columns WHERE table_name='profiles' AND column_name='kimp_unlimited';" 2>&1
./node_modules/.bin/supabase db query "SELECT table_name FROM information_schema.tables WHERE table_name IN ('kimp_verifications','kimp_client_allowlist');" 2>&1
```

Expected: column and both tables exist.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: 570/572.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260603000001_profiles_kimp_columns.sql
git commit -m "feat(db): kimp_unlimited column, proof gate, allowlist, grant_kimp_unlimited RPC"
```

---

## Task 2 — Stamp kimp_client_id on generations + lockdown update for stripe

**Files:**

- Create: `supabase/migrations/20260603000002_generations_kimp_client_id.sql`

**Interfaces:**

- Produces: `generations.kimp_client_id text` — stamped by the quota consume trigger for per-client attribution

- [ ] **Step 1: Write the migration**

```sql
-- 20260603000002_generations_kimp_client_id.sql
-- Phase 2: snapshot kimp_client_id onto each generation for per-client margin attribution.
-- Also add stripe_customer_id to profiles + lock it in the self-update trigger.

-- 1. Add kimp_client_id to generations (stamped by consume trigger)
alter table public.generations
  add column if not exists kimp_client_id text;

-- 2. Add stripe_customer_id to profiles (needed for Phase 3 Stripe subscriptions)
alter table public.profiles
  add column if not exists stripe_customer_id text unique;

-- 3. Lock stripe_customer_id in the self-update trigger
create or replace function public.enforce_profiles_self_update_lockdown()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then return new; end if;
  if v_actor <> old.id then return new; end if;

  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'profiles_self_update: cannot clear deleted_at' using errcode = 'check_violation';
  end if;
  if old.tos_accepted_at is not null and new.tos_accepted_at is null then
    raise exception 'profiles_self_update: cannot clear tos_accepted_at' using errcode = 'check_violation';
  end if;

  if new.id                              is distinct from old.id                              then raise exception 'profiles_self_update: id is locked'                              using errcode = 'check_violation'; end if;
  if new.email                           is distinct from old.email                           then raise exception 'profiles_self_update: email is locked'                           using errcode = 'check_violation'; end if;
  if new.monthly_credits                 is distinct from old.monthly_credits                 then raise exception 'profiles_self_update: monthly_credits is locked'                 using errcode = 'check_violation'; end if;
  if new.purchased_credits               is distinct from old.purchased_credits               then raise exception 'profiles_self_update: purchased_credits is locked'               using errcode = 'check_violation'; end if;
  if new.monthly_credits_reset_at        is distinct from old.monthly_credits_reset_at        then raise exception 'profiles_self_update: monthly_credits_reset_at is locked'        using errcode = 'check_violation'; end if;
  if new.free_used_this_week             is distinct from old.free_used_this_week             then raise exception 'profiles_self_update: free_used_this_week is locked'             using errcode = 'check_violation'; end if;
  if new.free_week_starts_at             is distinct from old.free_week_starts_at             then raise exception 'profiles_self_update: free_week_starts_at is locked'             using errcode = 'check_violation'; end if;
  if new.referral_code                   is distinct from old.referral_code                   then raise exception 'profiles_self_update: referral_code is locked'                   using errcode = 'check_violation'; end if;
  if new.bonus_credits_earned            is distinct from old.bonus_credits_earned            then raise exception 'profiles_self_update: bonus_credits_earned is locked'            using errcode = 'check_violation'; end if;
  if new.created_at                      is distinct from old.created_at                      then raise exception 'profiles_self_update: created_at is locked'                      using errcode = 'check_violation'; end if;
  if new.is_vip                          is distinct from old.is_vip                          then raise exception 'profiles_self_update: is_vip is locked'                          using errcode = 'check_violation'; end if;
  if new.vip_reason                      is distinct from old.vip_reason                      then raise exception 'profiles_self_update: vip_reason is locked'                      using errcode = 'check_violation'; end if;
  if new.vip_granted_by                  is distinct from old.vip_granted_by                  then raise exception 'profiles_self_update: vip_granted_by is locked'                  using errcode = 'check_violation'; end if;
  if new.vip_granted_at                  is distinct from old.vip_granted_at                  then raise exception 'profiles_self_update: vip_granted_at is locked'                  using errcode = 'check_violation'; end if;
  if new.first_purchase_discount_used_at is distinct from old.first_purchase_discount_used_at then raise exception 'profiles_self_update: first_purchase_discount_used_at is locked' using errcode = 'check_violation'; end if;
  if new.referred_by                     is distinct from old.referred_by                     then raise exception 'profiles_self_update: referred_by is locked'                     using errcode = 'check_violation'; end if;
  if new.kimp_subject_id     is distinct from old.kimp_subject_id     then raise exception 'profiles_self_update: kimp_subject_id is locked'     using errcode = 'check_violation'; end if;
  if new.kimp_client_status  is distinct from old.kimp_client_status  then raise exception 'profiles_self_update: kimp_client_status is locked'  using errcode = 'check_violation'; end if;
  if new.kimp_unlimited       is distinct from old.kimp_unlimited       then raise exception 'profiles_self_update: kimp_unlimited is locked'       using errcode = 'check_violation'; end if;
  if new.kimp_linked_at      is distinct from old.kimp_linked_at      then raise exception 'profiles_self_update: kimp_linked_at is locked'      using errcode = 'check_violation'; end if;
  if new.kimp_verified_at    is distinct from old.kimp_verified_at    then raise exception 'profiles_self_update: kimp_verified_at is locked'    using errcode = 'check_violation'; end if;
  if new.kimp_client_id      is distinct from old.kimp_client_id      then raise exception 'profiles_self_update: kimp_client_id is locked'      using errcode = 'check_violation'; end if;
  if new.stripe_customer_id  is distinct from old.stripe_customer_id  then raise exception 'profiles_self_update: stripe_customer_id is locked'  using errcode = 'check_violation'; end if;

  return new;
end;
$$;

-- 4. Update the quota consume trigger to snapshot kimp_client_id
--    (mirrors how tier_at_generation is snapshotted)
create or replace function public.consume_quota_on_generation_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_profile     public.profiles;
  v_kimp        boolean := false;
  v_vip         boolean := false;
begin
  select coalesce(is_vip, false) into v_vip
  from public.profiles where id = new.user_id;

  begin
    select coalesce(kimp_unlimited, false) into v_kimp
    from public.profiles where id = new.user_id;
  exception when undefined_column then
    v_kimp := false;
  end;

  if v_kimp is true then
    new.tier_at_generation := 'kimp';
    -- Snapshot kimp_client_id for per-client cost attribution
    begin
      select kimp_client_id into new.kimp_client_id
      from public.profiles where id = new.user_id;
    exception when undefined_column then null;
    end;
    return new;
  end if;

  if v_vip is true then
    new.tier_at_generation := 'vip';
    return new;
  end if;

  select * into v_profile from public.profiles where id = new.user_id for update;

  if v_profile.deleted_at is not null then
    raise exception 'profile deleted';
  end if;

  if v_profile.monthly_credits > 0
     and (v_profile.monthly_credits_reset_at is null
          or v_profile.monthly_credits_reset_at >= now() - interval '31 days') then
    update public.profiles set monthly_credits = monthly_credits - 1 where id = new.user_id;
    new.tier_at_generation    := 'monthly';
    new.monthly_cycle_reset_at := v_profile.monthly_credits_reset_at;
    return new;
  end if;

  if v_profile.purchased_credits > 0 then
    update public.profiles set purchased_credits = purchased_credits - 1 where id = new.user_id;
    new.tier_at_generation := 'credit';
    return new;
  end if;

  if v_profile.free_used_this_week < 5 then
    update public.profiles set free_used_this_week = free_used_this_week + 1 where id = new.user_id;
    new.tier_at_generation := 'free';
    return new;
  end if;

  insert into public.trend_events (trend_slug, type, occurred_at)
  select t.slug, 'quota_blocked', now()
    from public.trends t where t.id = new.trend_id;

  raise exception 'quota exhausted';
end;
$$;
```

- [ ] **Step 2: Apply + run tests**

```bash
./node_modules/.bin/supabase db reset
npx vitest run
```

Expected: 570/572.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260603000002_generations_kimp_client_id.sql
git commit -m "feat(db): kimp_client_id on generations, stripe_customer_id on profiles, lockdown update"
```

---

## Task 3 — Env vars, PKCE helpers, status-client, resolve-entitlement, tier helper

**Files:**

- Modify: `lib/env.ts`
- Modify: `supabase/config.toml`
- Create: `lib/auth/kimp/pkce.ts`
- Create: `lib/auth/kimp/status-client.ts`
- Create: `lib/auth/kimp/resolve-entitlement.ts`
- Create: `lib/account/tier.ts`

**Interfaces:**

- Produces: `generateCodeVerifier()`, `generateCodeChallenge(verifier)`, `generateState()`, `generateNonce()` — Web Crypto API, works in Node + Edge
- Produces: `checkKimpStatus(subjects: string[]): Promise<KimpStatusResult>` — HMAC-signed S2S call, Zod-validated response
- Produces: `resolveKimpEntitlement(userId, email, sub?): Promise<'active' | 'inactive' | 'unverified'>` — ordered resolver
- Produces: `getAccountTier(userId): Promise<'kimp' | 'standard' | 'free'>` — for UI gating of paid UI

- [ ] **Step 1: Update `supabase/config.toml`**

Find `[auth]` section and change:

```toml
enable_signup = false   # was true — H-S2b: disable at GoTrue level, not just server action
```

Find `[auth.email]` section and change:

```toml
enable_signup = false       # was true
enable_confirmations = true # was false — H-S5: confirmations required for verified email gate
```

- [ ] **Step 2: Add KIMP env vars to `lib/env.ts`**

Add after `GEMINI_API_KEY`:

```typescript
CRON_SECRET: z.string().min(1).optional(),          // promote from raw process.env
KIMP360_OIDC_ISSUER: z.string().url().optional(),
KIMP360_OIDC_CLIENT_ID: z.string().min(1).optional(),
KIMP360_OIDC_CLIENT_SECRET: z.string().min(1).optional(),
KIMP360_STATUS_API_URL: z.string().url().optional(),
KIMP360_STATUS_API_KEY: z.string().min(1).optional(),
```

- [ ] **Step 3: Create `lib/auth/kimp/pkce.ts`**

```typescript
/**
 * PKCE + state/nonce helpers for KIMP360 OIDC flow.
 * Uses Web Crypto API — works in Node 18+ and Edge runtime.
 */

export async function generateCodeVerifier(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(64))
  return base64urlEncode(bytes)
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', encoded)
  return base64urlEncode(new Uint8Array(hash))
}

export function generateState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64urlEncode(bytes)
}

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64urlEncode(bytes)
}

function base64urlEncode(bytes: Uint8Array): string {
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
```

- [ ] **Step 4: Create `lib/auth/kimp/status-client.ts`**

```typescript
/**
 * Server-to-server KIMP360 status API client.
 * Authenticates with HMAC over (timestamp + body) to prevent replay attacks.
 * Response is Zod-validated — untrusted JSON must not drive entitlements directly.
 *
 * See plan H-S7: response schema prevents cross-account grants and unknown status values.
 */

import { z } from 'zod'
import { createHmac } from 'node:crypto'

const StatusResultSchema = z.object({
  results: z.array(
    z.object({
      sub: z.string().min(1),
      status: z.enum(['active', 'inactive']),
      checked_at: z.string().datetime(),
    })
  ),
})

export type KimpStatusResult = z.infer<typeof StatusResultSchema>['results'][number]

export async function checkKimpStatus(subjects: string[]): Promise<KimpStatusResult[]> {
  const apiUrl = process.env.KIMP360_STATUS_API_URL
  const apiKey = process.env.KIMP360_STATUS_API_KEY

  if (!apiUrl || !apiKey) throw new Error('KIMP360_STATUS_API_URL / KEY not configured')
  if (subjects.length === 0) return []

  const timestamp = Date.now().toString()
  const body = JSON.stringify({ subjects })
  const signature = createHmac('sha256', apiKey)
    .update(timestamp + body)
    .digest('hex')

  const res = await fetch(`${apiUrl}/clients/status`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-timestamp': timestamp,
      'x-signature': signature,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new Error(
      `KIMP360 status API ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`
    )
  }

  const parsed = StatusResultSchema.safeParse(await res.json())
  if (!parsed.success)
    throw new Error(`KIMP360 status API invalid response: ${parsed.error.message}`)

  // Intersect: only return results for subjects we requested (H-S7: drop extras)
  const requestedSet = new Set(subjects)
  return parsed.data.results.filter((r) => requestedSet.has(r.sub))
}
```

- [ ] **Step 5: Create `lib/auth/kimp/resolve-entitlement.ts`**

```typescript
/**
 * Ordered entitlement resolver for KIMP360 unlimited tier.
 * H-S7 / H-S4: unlimited is set server-side only via grant_kimp_unlimited() RPC.
 * Fail-closed: any error path returns 'unverified'.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { checkKimpStatus } from './status-client'

export type KimpEntitlement = 'active' | 'inactive' | 'unverified'

interface ResolveArgs {
  userId: string
  email: string
  oidcSub?: string // from OIDC id_token claim
  oidcStatus?: 'active' | 'inactive' // from id_token claim if provided
}

/**
 * Resolve whether a user is an active KIMP360 client.
 * Order: OIDC claim → status API → allowlist → unverified.
 * Never throws — returns 'unverified' on any error (fail-closed).
 */
export async function resolveKimpEntitlement({
  userId,
  email,
  oidcSub,
  oidcStatus,
}: ResolveArgs): Promise<KimpEntitlement> {
  try {
    // 1. OIDC claim present (from id_token)
    if (oidcSub && oidcStatus) {
      return oidcStatus
    }

    // 2. Status API (server-to-server, HMAC-signed)
    if (oidcSub && process.env.KIMP360_STATUS_API_URL) {
      const results = await checkKimpStatus([oidcSub])
      const match = results.find((r) => r.sub === oidcSub)
      if (match) return match.status
    }

    // 3. Allowlist fallback (admin-managed, email-based)
    const service = createServiceClient()
    const { data } = await service
      .from('kimp_client_allowlist')
      .select('is_active')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .maybeSingle()

    if (data?.is_active) return 'active'

    return 'unverified'
  } catch {
    return 'unverified'
  }
}
```

- [ ] **Step 6: Create `lib/account/tier.ts`**

```typescript
/**
 * Account tier helper for UI gating.
 * KIMP clients see no paid UI (plans/packs/credit counters).
 */

import { createClient } from '@/lib/supabase/server'

export type AccountTier = 'kimp' | 'standard' | 'free'

export async function getAccountTier(userId: string): Promise<AccountTier> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('kimp_unlimited, purchased_credits, monthly_credits')
    .eq('id', userId)
    .maybeSingle()

  if (!data) return 'free'
  if (data.kimp_unlimited) return 'kimp'
  if ((data.purchased_credits ?? 0) > 0 || (data.monthly_credits ?? 0) > 0) return 'standard'
  return 'free'
}
```

- [ ] **Step 7: Run typecheck + tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: clean, 570/572.

- [ ] **Step 8: Commit**

```bash
git add supabase/config.toml lib/env.ts lib/auth/kimp/pkce.ts \
        lib/auth/kimp/status-client.ts lib/auth/kimp/resolve-entitlement.ts \
        lib/account/tier.ts
git commit -m "feat(auth): KIMP360 PKCE helpers, status client, entitlement resolver, tier helper; disable email signups in config"
```

---

## Task 4 — KIMP SSO initiate route + callback route

**Files:**

- Create: `app/api/auth/kimp/initiate/route.ts`
- Create: `app/auth/kimp/callback/route.ts`
- Modify: `lib/auth/post-auth-onboarding.ts` (add kimp stamp step)

**Interfaces:**

- Consumes: `generateCodeVerifier`, `generateCodeChallenge`, `generateState`, `generateNonce` (Task 3)
- Consumes: `resolveKimpEntitlement` (Task 3), `grant_kimp_unlimited` RPC (Task 1)
- Produces: `GET /api/auth/kimp/initiate` → 302 to KIMP360 authorization URL (if OIDC configured) or 302 to `/login?error=kimp_unavailable` (if not)
- Produces: `GET /auth/kimp/callback` → validates state/code, bridges Supabase session, stamps kimp status, redirects to `/me/studio`

- [ ] **Step 1: Create `app/api/auth/kimp/initiate/route.ts`**

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateNonce,
} from '@/lib/auth/kimp/pkce'
import { safeNextPath } from '@/lib/auth/safe-next-path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const issuer = process.env.KIMP360_OIDC_ISSUER
  const clientId = process.env.KIMP360_OIDC_CLIENT_ID
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  // Fallback: IdP not yet configured — surface clean error
  if (!issuer || !clientId) {
    return NextResponse.redirect(new URL('/login?error=kimp_unavailable', request.url))
  }

  const url = new URL(request.url)
  const next = safeNextPath(url.searchParams.get('next') ?? '/me/studio')

  const codeVerifier = await generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = generateState()
  const nonce = generateNonce()

  // Build OIDC authorization URL
  const authUrl = new URL(`${issuer}/authorize`)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', `${siteUrl}/auth/kimp/callback`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid email profile kimp.client_status')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  // Store PKCE transaction in a short-lived httpOnly cookie
  const txValue = JSON.stringify({ codeVerifier, state, nonce, next })
  const response = NextResponse.redirect(authUrl.toString())
  response.cookies.set('kimp_oidc_tx', txValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  })

  return response
}
```

- [ ] **Step 2: Create `app/auth/kimp/callback/route.ts`**

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { runPostAuthOnboarding } from '@/lib/auth/post-auth-onboarding'
import { resolveKimpEntitlement } from '@/lib/auth/kimp/resolve-entitlement'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IdTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean().optional(),
  nonce: z.string().optional(),
  'kimp:client_status': z.enum(['active', 'inactive']).optional(),
  'kimp:client_id': z.string().optional(),
})

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  if (errorParam) {
    return NextResponse.redirect(new URL(`/login?error=kimp_oauth_${errorParam}`, request.url))
  }

  // Validate PKCE transaction cookie
  const txCookie = request.cookies.get('kimp_oidc_tx')?.value
  if (!txCookie || !code || !returnedState) {
    return NextResponse.redirect(new URL('/login?error=kimp_state_invalid', request.url))
  }

  let tx: { codeVerifier: string; state: string; nonce: string; next: string }
  try {
    tx = JSON.parse(txCookie)
  } catch {
    return NextResponse.redirect(new URL('/login?error=kimp_state_invalid', request.url))
  }

  if (tx.state !== returnedState) {
    return NextResponse.redirect(new URL('/login?error=kimp_state_mismatch', request.url))
  }

  const issuer = process.env.KIMP360_OIDC_ISSUER
  const clientId = process.env.KIMP360_OIDC_CLIENT_ID
  const clientSecret = process.env.KIMP360_OIDC_CLIENT_SECRET
  if (!issuer || !clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/login?error=kimp_unavailable', request.url))
  }

  // Exchange code for tokens
  const tokenRes = await fetch(`${issuer}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${siteUrl}/auth/kimp/callback`,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: tx.codeVerifier,
    }),
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL('/login?error=kimp_token_failed', request.url))
  }

  const tokens = (await tokenRes.json()) as { access_token?: string; id_token?: string }
  if (!tokens.id_token) {
    return NextResponse.redirect(new URL('/login?error=kimp_token_failed', request.url))
  }

  // Decode id_token claims (signature validation is Supabase's job if using native OIDC;
  // for hand-rolled path, trust HTTPS + client_secret bound token exchange)
  const [, payloadB64] = tokens.id_token.split('.')
  const claims = IdTokenClaimsSchema.safeParse(
    JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
  )
  if (!claims.success) {
    return NextResponse.redirect(new URL('/login?error=kimp_claims_invalid', request.url))
  }

  const { sub, email, nonce: claimNonce } = claims.data
  // Verify nonce (replay protection)
  if (claimNonce && claimNonce !== tx.nonce) {
    return NextResponse.redirect(new URL('/login?error=kimp_nonce_mismatch', request.url))
  }

  // Bridge into Supabase: look up existing user by email
  const service = createServiceClient()
  const { data: existingUsers } = await service.auth.admin.listUsers()
  const existingUser = existingUsers?.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  )

  let supabaseUserId: string

  if (existingUser) {
    // Link to existing account
    // Guard: if sub is already linked to DIFFERENT profile → conflict
    const { data: conflictRow } = await service
      .from('profiles')
      .select('id')
      .eq('kimp_subject_id', sub)
      .neq('id', existingUser.id)
      .maybeSingle()
    if (conflictRow) {
      return NextResponse.redirect(new URL('/login?error=kimp_account_conflict', request.url))
    }
    supabaseUserId = existingUser.id
  } else {
    // Create new Supabase user
    const { data: newUser, error: createError } = await service.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { provider: 'kimp360', kimp_subject_id: sub },
    })
    if (createError || !newUser.user) {
      return NextResponse.redirect(new URL('/login?error=kimp_create_failed', request.url))
    }
    supabaseUserId = newUser.user.id
  }

  // Establish a session for this user and get the tokens
  const { data: sessionData, error: sessionError } = await service.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (sessionError || !sessionData?.properties?.action_link) {
    return NextResponse.redirect(new URL('/login?error=kimp_session_failed', request.url))
  }

  // Resolve KIMP entitlement
  const entitlement = await resolveKimpEntitlement({
    userId: supabaseUserId,
    email,
    oidcSub: sub,
    oidcStatus: claims.data['kimp:client_status'],
  })

  // Grant unlimited if active
  if (entitlement === 'active') {
    await service.rpc('grant_kimp_unlimited', {
      p_user_id: supabaseUserId,
      p_subject: sub,
      p_client_id: claims.data['kimp:client_id'] ?? null,
      p_verified_at: new Date().toISOString(),
    })
  }

  // Clear PKCE cookie and redirect to the magic link (which will complete the session)
  // The magic link will land at /auth/callback which calls runPostAuthOnboarding
  const response = NextResponse.redirect(sessionData.properties.action_link)
  response.cookies.delete('kimp_oidc_tx')
  return response
}
```

- [ ] **Step 3: Run tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: 570/572.

- [ ] **Step 4: Commit**

```bash
git add app/api/auth/kimp/initiate/route.ts app/auth/kimp/callback/route.ts
git commit -m "feat(auth): KIMP360 OIDC initiate route + callback with PKCE, entitlement grant"
```

---

## Task 5 — Login UI: drop signUp fallback, add KIMP button, add forgot-password

**Files:**

- Modify: `app/(auth)/login/actions.ts`
- Modify: `app/(auth)/login/LoginForms.tsx`
- Modify: `app/(auth)/login/page.tsx`

**Interfaces:**

- Consumes: none new
- Produces: `signInWithEmail` no longer calls `signUp`; `LoginForms` has KIMP button + forgot-password link

- [ ] **Step 1: Update `app/(auth)/login/actions.ts`**

Remove the `signUp` fallback block (lines 65–85 that call `supabase.auth.signUp`). The new failed-login branch simply redirects to `?error=invalid_credentials`:

```typescript
export async function signInWithEmail(formData: FormData): Promise<void> {
  // ... (keep existing validation and Turnstile check unchanged) ...

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (!signInError) {
    redirect(next)
  }

  // Password wrong or account doesn't exist — single generic error (no enumeration)
  redirect('/login?error=invalid_credentials')
}
```

Also add `signInWithKimp` action — it delegates to the initiate route:

```typescript
export async function signInWithKimp(formData: FormData): Promise<void> {
  const rawNext = (formData.get('next') as string) || '/me/studio'
  const next = resolveNext(rawNext)
  const tosAccepted = (formData.get('tos_accepted') as string) || '0'

  if (tosAccepted !== '1') redirect('/login?error=tos_required')

  // Delegate to the dedicated initiate route (GET redirect — server actions can't
  // return external OAuth redirects directly; the route handler does the redirect)
  redirect(`/api/auth/kimp/initiate?next=${encodeURIComponent(next)}`)
}
```

- [ ] **Step 2: Update `app/(auth)/login/LoginForms.tsx`**

Add the KIMP button (shown only when `KIMP360_OIDC_ISSUER` env is set — available as `NEXT_PUBLIC_KIMP_SSO_ENABLED`). Add forgot-password link below the email form.

Key changes:

1. Add `process.env.NEXT_PUBLIC_KIMP_SSO_ENABLED` check — show the KIMP button only when set
2. Add `signInWithKimp` import
3. Add KIMP form button below the Google button (same pattern: hidden inputs for next + tos)
4. Change email form label from "Min 8 characters" placeholder to "Sign in to your existing account" (login-only copy — H-S2b)
5. Add a `<Link href="/login/forgot-password">Forgot password?</Link>` link below the email form submit button

- [ ] **Step 3: Add `invalid_credentials` + `kimp_unavailable` + `kimp_account_conflict` to `page.tsx` error copy**

```typescript
const ERROR_COPY: Record<string, string> = {
  // ... existing entries ...
  invalid_credentials: 'Email or password is incorrect. Try again.',
  kimp_unavailable: 'KIMP360 sign-in is not available right now. Try Google or email.',
  kimp_account_conflict: 'This KIMP360 account is linked to a different email. Contact support.',
}
```

Also add `NEXT_PUBLIC_KIMP_SSO_ENABLED` to `lib/env.ts` (public, optional):

```typescript
NEXT_PUBLIC_KIMP_SSO_ENABLED: z.string().optional(),
```

- [ ] **Step 4: Add consumer forgot-password page**

Create `app/(auth)/login/forgot-password/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default function ForgotPasswordPage() {
  async function sendReset(formData: FormData) {
    'use server'
    const email = formData.get('email') as string
    const supabase = await createClient()
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/auth/confirm?type=recovery`,
    })
    redirect('/login?sent=1')
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">Reset password</h1>
        <p className="text-muted-foreground text-sm">
          Enter your email and we&apos;ll send a reset link.
        </p>
      </header>
      <form action={sendReset} className="flex flex-col gap-3">
        <input
          type="email"
          name="email"
          required
          placeholder="you@example.com"
          className="border-input h-12 rounded-xl border bg-transparent px-3 text-sm"
        />
        <button
          type="submit"
          className="bg-primary text-primary-foreground h-12 rounded-full text-sm font-semibold"
        >
          Send reset link
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 5: Run tests + build**

```bash
npx tsc --noEmit && npx vitest run && npx next build
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/\(auth\)/login/actions.ts app/\(auth\)/login/LoginForms.tsx \
        app/\(auth\)/login/page.tsx app/\(auth\)/login/forgot-password/page.tsx
git commit -m "feat(auth): drop signUp fallback, add KIMP button, add forgot-password; H-S2b"
```

---

## Task 6 — Nightly KIMP churn re-verify cron + admin allowlist page

**Files:**

- Create: `app/api/admin/kimp-reverify/route.ts`
- Create: `app/admin/(authed)/kimp/page.tsx`
- Create: `app/admin/(authed)/kimp/actions.ts`
- Modify: `vercel.json`
- Modify: `components/admin/AdminShell.tsx`

**Interfaces:**

- Consumes: `checkKimpStatus` (Task 3), `resolveKimpEntitlement` (Task 3), `requireAdminRole` (Phase 1)
- Produces: POST `/api/admin/kimp-reverify` — nightly cron + manual trigger; fail-safe (never mass-revokes on API down)
- Produces: `/admin/kimp` — allowlist CRUD (add email, deactivate entry)

- [ ] **Step 1: Create `app/api/admin/kimp-reverify/route.ts`**

Mirror `run-trend-discovery/route.ts` exactly for the CRON_SECRET bearer + admin auth pattern. Use `timingSafeEqual` from `lib/auth/service-role-bearer.ts` for the CRON_SECRET check (H-S14).

Key logic:

1. Auth: constant-time CRON_SECRET check OR authenticated admin session (same pattern as trend-discovery)
2. Load all profiles with `kimp_subject_id IS NOT NULL` (the linked cohort)
3. Batch `checkKimpStatus` in chunks of 200
4. For each result:
   - `active` → update `kimp_verified_at = now()`, ensure `kimp_unlimited = true` (via `grant_kimp_unlimited()` if not already set)
   - `inactive` → **revoke**: update `kimp_unlimited = false`, `kimp_client_status = 'inactive'`, `kimp_verified_at = now()`, write `admin_audit_log` action `'kimp_revoke_churn'`
5. **Fail-safe on API down**: if `checkKimpStatus` throws `KimpStatusUnavailableError`, abort the run, write `admin_audit_log` action `'kimp_reverify_failed'`, return 503 — never mass-revoke
6. **14-day grace**: only revoke users whose `kimp_verified_at < now() - 14 days` AND current status is `inactive` (avoids revoking on transient API downtime)
7. Reconcile allowlist-only users (no `kimp_subject_id`): check `kimp_client_allowlist.is_active`; if allowlist row deactivated → revoke
8. Write summary `admin_audit_log` row with counts
9. Write `webhook_events` row `source='kimp360', event_id='reverify:' || current_date` for cron idempotency

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { logAdminAction } from '@/lib/admin/audit'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkKimpStatus } from '@/lib/auth/kimp/status-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function verifyCronBearer(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !authHeader) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const provided = Buffer.from(authHeader)
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get('authorization')
  const isCron = verifyCronBearer(auth)
  let adminId: string | null = null

  if (!isCron) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    const svc = createServiceClient()
    const { data: adminRow } = await svc
      .from('admin_users')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!adminRow || adminRow.role !== 'admin')
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    adminId = user.id
  }

  const service = createServiceClient()

  // Idempotency: only run once per day via cron
  const eventId = `reverify:${new Date().toISOString().slice(0, 10)}`
  if (isCron) {
    const { error: dupError } = await service.from('webhook_events').insert({
      source: 'kimp360',
      event_id: eventId,
      payload: {},
    })
    if (dupError?.code === '23505') {
      return NextResponse.json({ skipped: true, reason: 'already_run_today' })
    }
  }

  // Load all linked profiles
  const { data: linkedProfiles } = await service
    .from('profiles')
    .select('id, email, kimp_subject_id, kimp_verified_at, kimp_unlimited, kimp_client_id')
    .not('kimp_subject_id', 'is', null)
    .is('deleted_at', null)

  const profiles = linkedProfiles ?? []
  let checked = 0,
    active = 0,
    revoked = 0,
    errors = 0

  // Batch status API calls in chunks of 200
  const CHUNK_SIZE = 200
  for (let i = 0; i < profiles.length; i += CHUNK_SIZE) {
    const chunk = profiles.slice(i, i + CHUNK_SIZE)
    const subs = chunk.map((p) => p.kimp_subject_id!).filter(Boolean)

    let results
    try {
      results = await checkKimpStatus(subs)
    } catch (err) {
      // Fail-safe: API down → abort, never mass-revoke (H-S7)
      await logAdminAction({
        adminId,
        action: 'kimp_reverify_failed',
        targetTable: 'profiles',
        targetId: null,
        after: { error: err instanceof Error ? err.message : 'unknown', checked_so_far: checked },
      })
      return NextResponse.json({ error: 'status_api_unavailable' }, { status: 503 })
    }

    const resultMap = new Map(results.map((r) => [r.sub, r.status]))
    checked += chunk.length

    for (const profile of chunk) {
      const status = resultMap.get(profile.kimp_subject_id!)
      if (!status) continue // not returned = unverified this cycle; let staleness grace handle it

      if (status === 'active') {
        active++
        if (!profile.kimp_unlimited) {
          await service.rpc('grant_kimp_unlimited', {
            p_user_id: profile.id,
            p_subject: profile.kimp_subject_id,
            p_client_id: profile.kimp_client_id ?? null,
            p_verified_at: new Date().toISOString(),
          })
        } else {
          await service
            .from('profiles')
            .update({ kimp_verified_at: new Date().toISOString() })
            .eq('id', profile.id)
        }
      } else if (status === 'inactive') {
        // 14-day grace: only revoke if verified_at is >14 days stale OR never verified
        const verifiedAt = profile.kimp_verified_at
          ? new Date(profile.kimp_verified_at).getTime()
          : 0
        const stale = Date.now() - verifiedAt > 14 * 24 * 60 * 60 * 1000
        if (stale && profile.kimp_unlimited) {
          revoked++
          await service
            .from('profiles')
            .update({
              kimp_unlimited: false,
              kimp_client_status: 'inactive',
              kimp_verified_at: new Date().toISOString(),
            })
            .eq('id', profile.id)
          await logAdminAction({
            adminId,
            action: 'kimp_revoke_churn',
            targetTable: 'profiles',
            targetId: profile.id,
            after: { sub_hash: profile.kimp_subject_id!.slice(0, 8) + '...', reason: 'churn' },
          })
        }
      }
    }
  }

  await logAdminAction({
    adminId,
    action: 'kimp_reverify_complete',
    targetTable: 'profiles',
    targetId: null,
    after: { checked, active, revoked, errors, triggered_by: isCron ? 'cron' : 'admin' },
  })

  return NextResponse.json({ checked, active, revoked, errors })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return POST(request)
}
```

- [ ] **Step 2: Update `vercel.json`**

Add to `functions` and `crons`:

```json
"app/api/admin/kimp-reverify/route.ts": { "maxDuration": 60 }
```

```json
{ "path": "/api/admin/kimp-reverify", "schedule": "30 3 * * *" }
```

- [ ] **Step 3: Create `app/admin/(authed)/kimp/actions.ts`**

```typescript
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logAdminAction } from '@/lib/admin/audit'
import { requireAdminRole } from '@/lib/admin/require-role'
import { createServiceClient } from '@/lib/supabase/server'

const AddAllowlistSchema = z.object({
  email: z.string().email(),
  note: z.string().max(500).optional(),
})

export async function addAllowlistEntry(formData: FormData) {
  const { userId } = await requireAdminRole('admin')
  const parsed = AddAllowlistSchema.safeParse({
    email: formData.get('email'),
    note: formData.get('note') ?? undefined,
  })
  if (!parsed.success) return { error: 'Invalid email' }

  const service = createServiceClient()
  const { error } = await service.from('kimp_client_allowlist').insert({
    email: parsed.data.email.toLowerCase(),
    note: parsed.data.note ?? null,
    added_by: userId,
    is_active: true,
  })

  if (error) return { error: error.message }

  await logAdminAction({
    adminId: userId,
    action: 'kimp_allowlist_add',
    targetTable: 'kimp_client_allowlist',
    targetId: parsed.data.email,
    after: { email: parsed.data.email, note: parsed.data.note },
  })

  revalidatePath('/admin/kimp')
  return { ok: true }
}

export async function deactivateAllowlistEntry(formData: FormData) {
  const { userId } = await requireAdminRole('admin')
  const email = formData.get('email') as string
  if (!email) return { error: 'Missing email' }

  const service = createServiceClient()
  await service
    .from('kimp_client_allowlist')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('email', email.toLowerCase())

  await logAdminAction({
    adminId: userId,
    action: 'kimp_allowlist_deactivate',
    targetTable: 'kimp_client_allowlist',
    targetId: email,
    after: { email, is_active: false },
  })

  revalidatePath('/admin/kimp')
  return { ok: true }
}
```

- [ ] **Step 4: Create `app/admin/(authed)/kimp/page.tsx`**

RSC page reading `kimp_client_allowlist` via service-role. Show a table of entries + add form + deactivate buttons. Follow the VIP page pattern.

- [ ] **Step 5: Add KIMP nav item to `AdminShell.tsx`**

Import `Shield` (or `Users2`) from lucide-react. Add to Operations group:

```typescript
{ href: '/admin/kimp', label: 'KIMP360', icon: <Shield className="size-4" /> },
```

- [ ] **Step 6: Run full suite + build**

```bash
npx tsc --noEmit && npx vitest run && npx next build
```

Expected: clean, 570/572, build passes.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/kimp-reverify/route.ts vercel.json \
        app/admin/\(authed\)/kimp/page.tsx app/admin/\(authed\)/kimp/actions.ts \
        components/admin/AdminShell.tsx
git commit -m "feat(admin): KIMP360 allowlist page + nightly churn re-verify cron"
```

---

## Task 7 — Regenerate types + add per-user cost controls

**Files:**

- Run: `supabase gen types`
- Modify: `lib/rate-limit.ts` (already has `generationUserLimiter` from Phase 0 — verify it's applied to generate-anonymous too)
- Modify: `app/api/generate-anonymous/route.ts` (verify per-fingerprint + global budget guards still correct)

- [ ] **Step 1: Regenerate types**

```bash
./node_modules/.bin/supabase db reset
./node_modules/.bin/supabase gen types typescript --local > lib/supabase/database.types.ts
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 2: Verify UNLIMITED_DAILY_BUDGET_USD guard exists**

Read `app/api/generate/route.ts`. Confirm there is an unlimited-tier daily budget guard that sums `estimated_cost_usd` (or `cost_usd`) for `tier_at_generation = 'kimp'` rows today. If not present, add it — sum kimp/vip generations in the last 24h and compare to `UNLIMITED_DAILY_BUDGET_USD` env (default 50):

```typescript
// Add to lib/env.ts:
UNLIMITED_DAILY_BUDGET_USD: z.coerce.number().positive().default(50),
```

The check in `app/api/generate/route.ts` before the DB insert:

```typescript
// Global unlimited budget guard (H-C7: cost_usd is post-completion; use count as backstop)
// The per-user generationUserLimiter (30/hr) is the primary hard backstop.
// This is a secondary alerting/soft-fallback control for the unlimited tier.
```

- [ ] **Step 3: Run full suite**

```bash
npx vitest run
```

Expected: 570/572.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/database.types.ts lib/env.ts app/api/generate/route.ts
git commit -m "chore(phase-2): regenerate db types; add UNLIMITED_DAILY_BUDGET_USD env"
```

---

## Self-Review

**Spec coverage check:**

| Requirement                                                                   | Task   |
| ----------------------------------------------------------------------------- | ------ |
| `kimp_unlimited` column + all kimp columns locked in self-update trigger      | Task 1 |
| `grant_kimp_unlimited()` SECURITY DEFINER RPC — only writer of kimp_unlimited | Task 1 |
| `enforce_kimp_unlimited_proof()` trigger — no service-role bypass             | Task 1 |
| `kimp_verifications` out-of-band proof table                                  | Task 1 |
| `kimp_client_allowlist` table + admin-read RLS (`role='admin'`)               | Task 1 |
| `webhook_events.source` extended to `'kimp360'`                               | Task 1 |
| `generations.kimp_client_id` stamped at quota consume                         | Task 2 |
| `profiles.stripe_customer_id` column + locked                                 | Task 2 |
| KIMP env vars + `CRON_SECRET` in `lib/env.ts`                                 | Task 3 |
| `config.toml`: `enable_signup=false`, `enable_confirmations=true`             | Task 3 |
| PKCE helpers (Web Crypto)                                                     | Task 3 |
| HMAC-signed status client + Zod response validation                           | Task 3 |
| Ordered entitlement resolver (OIDC → status API → allowlist → unverified)     | Task 3 |
| `getAccountTier()` for UI gating                                              | Task 3 |
| `GET /api/auth/kimp/initiate` → PKCE + state cookie + redirect                | Task 4 |
| `GET /auth/kimp/callback` → validate state, bridge Supabase, stamp kimp       | Task 4 |
| `signInWithEmail` drops signUp fallback (H-S2b)                               | Task 5 |
| `signInWithKimp` server action delegates to initiate route                    | Task 5 |
| KIMP button in LoginForms (shown when env set)                                | Task 5 |
| Consumer forgot-password page                                                 | Task 5 |
| `invalid_credentials` error (no enumeration)                                  | Task 5 |
| Nightly cron `POST /api/admin/kimp-reverify` with fail-safe                   | Task 6 |
| 14-day grace before revoke                                                    | Task 6 |
| Admin allowlist CRUD page at `/admin/kimp`                                    | Task 6 |
| `requireAdminRole('admin')` gates allowlist actions                           | Task 6 |
| KIMP nav item in AdminShell                                                   | Task 6 |
| Types regenerated; `UNLIMITED_DAILY_BUDGET_USD` env                           | Task 7 |
