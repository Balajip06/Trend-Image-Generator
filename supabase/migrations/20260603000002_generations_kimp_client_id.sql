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
--    (also re-locks all kimp columns from Task 1 to keep function self-contained)
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
  -- KIMP columns
  if new.kimp_subject_id     is distinct from old.kimp_subject_id     then raise exception 'profiles_self_update: kimp_subject_id is locked'     using errcode = 'check_violation'; end if;
  if new.kimp_client_status  is distinct from old.kimp_client_status  then raise exception 'profiles_self_update: kimp_client_status is locked'  using errcode = 'check_violation'; end if;
  if new.kimp_unlimited       is distinct from old.kimp_unlimited       then raise exception 'profiles_self_update: kimp_unlimited is locked'       using errcode = 'check_violation'; end if;
  if new.kimp_linked_at      is distinct from old.kimp_linked_at      then raise exception 'profiles_self_update: kimp_linked_at is locked'      using errcode = 'check_violation'; end if;
  if new.kimp_verified_at    is distinct from old.kimp_verified_at    then raise exception 'profiles_self_update: kimp_verified_at is locked'    using errcode = 'check_violation'; end if;
  if new.kimp_client_id      is distinct from old.kimp_client_id      then raise exception 'profiles_self_update: kimp_client_id is locked'      using errcode = 'check_violation'; end if;
  -- Stripe column (added this migration)
  if new.stripe_customer_id  is distinct from old.stripe_customer_id  then raise exception 'profiles_self_update: stripe_customer_id is locked'  using errcode = 'check_violation'; end if;

  return new;
end;
$$;

-- 4. Update the quota consume trigger to snapshot kimp_client_id
--    Preserves all existing bucket logic from 20260601000003_quota_trigger_buckets.sql.
--    Adds: when v_kimp is true, also snapshot kimp_client_id from profiles.
--    The kimp_unlimited column NOW EXISTS (Task 1) so undefined_column guard is belt-and-suspenders.
create or replace function public.consume_quota_on_generation_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_profile     public.profiles;
  v_kimp        boolean := false;
  v_vip         boolean := false;
begin
  -- Read is_vip WITHOUT touching kimp_unlimited as a safety measure.
  select coalesce(is_vip, false) into v_vip
  from public.profiles where id = new.user_id;

  -- kimp_unlimited guard: attempt read, fall back to false if column absent (schema drift safety).
  -- Must be in its own BEGIN/EXCEPTION block so undefined_column is catchable at runtime.
  begin
    select coalesce(kimp_unlimited, false) into v_kimp
    from public.profiles where id = new.user_id;
  exception when undefined_column then
    v_kimp := false;
  end;

  if v_kimp is true then
    new.tier_at_generation := 'kimp';
    -- Snapshot kimp_client_id for per-client cost attribution (mirrors tier_at_generation pattern).
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

  -- Metered path: lock the profile row for the read-modify-write.
  select * into v_profile from public.profiles where id = new.user_id for update;

  if v_profile.deleted_at is not null then
    raise exception 'profile deleted';
  end if;

  if v_profile.monthly_credits > 0 then
    -- Expiry gate (H-C9): block if the last reset is from an expired billing cycle.
    -- Billing cycle = 31 days (conservative). The webhook sets monthly_credits_reset_at
    -- on invoice.paid. If it's been > 31 days and credits weren't re-granted, they're stale.
    if v_profile.monthly_credits_reset_at is not null
       and v_profile.monthly_credits_reset_at < now() - interval '31 days' then
      -- Stale monthly credits — fall through to purchased_credits.
      null;
    else
      update public.profiles
        set monthly_credits = monthly_credits - 1
      where id = new.user_id;
      new.tier_at_generation    := 'monthly';
      new.monthly_cycle_reset_at := v_profile.monthly_credits_reset_at;
      return new;
    end if;
  end if;

  if v_profile.purchased_credits > 0 then
    update public.profiles
      set purchased_credits = purchased_credits - 1
    where id = new.user_id;
    new.tier_at_generation := 'credit';
    return new;
  end if;

  if v_profile.free_used_this_week < 5 then
    update public.profiles
      set free_used_this_week = free_used_this_week + 1
    where id = new.user_id;
    new.tier_at_generation := 'free';
    return new;
  end if;

  -- Quota exhausted
  insert into public.trend_events (trend_slug, type, occurred_at)
  select t.slug, 'quota_blocked', now()
    from public.trends t where t.id = new.trend_id;

  raise exception 'quota exhausted';
end;
$$;
