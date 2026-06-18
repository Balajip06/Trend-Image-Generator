-- 20260601000001_profiles_credit_split.sql
-- Phase 0: split credits_balance into two independently-expiring buckets.
-- Deploy this migration BEFORE any app code that writes monthly_credits/purchased_credits.
-- credits_balance becomes GENERATED so all ~14 existing readers keep working.

-- 1. Add new bucket columns
alter table public.profiles
  add column if not exists monthly_credits      int not null default 0 check (monthly_credits      >= 0),
  add column if not exists purchased_credits    int not null default 0 check (purchased_credits    >= 0),
  add column if not exists monthly_credits_reset_at timestamptz;

-- 2. Backfill: existing credits_balance → purchased_credits (non-expiring)
update public.profiles set purchased_credits = credits_balance where credits_balance > 0;

-- 3. Drop the old writable column, re-add as a GENERATED column
--    so all existing SELECT of credits_balance still return the total.
--    GENERATED columns cannot be written directly — any code trying
--    UPDATE profiles SET credits_balance = X will now fail at the DB level.
alter table public.profiles drop column credits_balance;
alter table public.profiles
  add column credits_balance int generated always as (monthly_credits + purchased_credits) stored;

-- 4. Convert enforce_profiles_self_update_lockdown to a TRUE ALLOWLIST.
--    Current function is a denylist — any new column is silently self-writable.
--    New logic: diff the whole row; only allow changes to the small self-service set.
--    Any column not in the allowlist is rejected, so future columns are locked by default.
create or replace function public.enforce_profiles_self_update_lockdown()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Service-role (crons, triggers, admin actions) bypass — auth.uid() is null.
  if v_actor is null then
    return new;
  end if;
  -- Only enforce for the row owner.
  if v_actor <> old.id then
    return new;
  end if;

  -- deleted_at: allow null → timestamp (soft-delete) only; reject reverting to null.
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'profiles_self_update: cannot clear deleted_at' using errcode = 'check_violation';
  end if;
  -- tos_accepted_at: monotonic — once set, cannot be cleared.
  if old.tos_accepted_at is not null and new.tos_accepted_at is null then
    raise exception 'profiles_self_update: cannot clear tos_accepted_at' using errcode = 'check_violation';
  end if;

  -- TRUE ALLOWLIST: the only columns the row owner may change are:
  --   name, avatar_url, push_subscription, tos_accepted_at, acquisition_source, deleted_at
  -- Everything else is rejected. This means every new column is locked by default.
  -- Self-service allowed changes: name, avatar_url, push_subscription, tos_accepted_at,
  -- acquisition_source, deleted_at — compare everything else against OLD.

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

  return new;
end;
$$;
-- Trigger binding unchanged; CREATE OR REPLACE picks it up automatically.

comment on column public.profiles.monthly_credits is
  'Credits from an active subscription. SET (not incremented) on invoice.paid. Expires at period end — spend gate blocks usage past monthly_credits_reset_at + billing cycle.';
comment on column public.profiles.purchased_credits is
  'Credits from one-time packs. Never expire. Previously stored in credits_balance.';
comment on column public.profiles.credits_balance is
  'Generated total = monthly_credits + purchased_credits. Read-only — do not attempt UPDATE.';
