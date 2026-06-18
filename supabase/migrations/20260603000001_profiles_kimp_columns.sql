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
  updated_at      timestamptz not null default now()
);

-- Expression-based unique constraint must be a separate index (not inline in CREATE TABLE)
create unique index kimp_allowlist_email_unique_idx on public.kimp_client_allowlist(lower(email));

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
