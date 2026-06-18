-- 20260601000004_retry_quota_relock.sql
-- Phase 0: re-gate quota on the retry path (H-C1).
-- /api/generate/retry flips status → 'pending' via service-role UPDATE.
-- The BEFORE INSERT consume trigger never fires on UPDATE, so retries
-- previously bypassed quota entirely (a 'failed' row could be retried
-- infinitely at zero quota cost).
--
-- This BEFORE UPDATE trigger fires when old.status is terminal and
-- new.status = 'pending'. It calls the same consume logic, ensuring
-- insert path and retry path are one DB-level chokepoint.
--
-- Note: the app-level guard (app/api/generate/retry/route.ts) already
-- blocks 'failed' (only 'failed_retryable' accepted) and caps attempts.
-- This trigger is defense-in-depth for any service-role caller.

create or replace function public.consume_quota_on_generation_retry()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_profile     public.profiles;
  v_kimp        boolean := false;
  v_vip         boolean := false;
begin
  -- Only fire on → pending transition from a 'failed' row (which was already
  -- refunded). 'failed_retryable' rows still hold their original quota
  -- deduction — re-consuming would double-charge. The app-layer retry route
  -- only accepts 'failed_retryable', so this branch is defense-in-depth for
  -- service-role callers who flip a 'failed' row back to 'pending'.
  if not (new.status = 'pending' and old.status = 'failed') then
    return new;
  end if;

  -- Fast-path bypass for kimp/vip (guard against undefined_column if Phase 2 not yet deployed)
  begin
    select coalesce(kimp_unlimited, false), coalesce(is_vip, false)
      into v_kimp, v_vip
    from public.profiles where id = new.user_id;
  exception when undefined_column then
    select coalesce(is_vip, false) into v_vip
    from public.profiles where id = new.user_id;
  end;

  if v_kimp or v_vip then
    new.tier_at_generation := case when v_kimp then 'kimp' else 'vip' end;
    return new;
  end if;

  -- Lock and decrement the appropriate bucket.
  select * into v_profile from public.profiles where id = new.user_id for update;

  if v_profile.deleted_at is not null then
    raise exception 'profile deleted';
  end if;

  if v_profile.monthly_credits > 0
     and (v_profile.monthly_credits_reset_at is null
          or v_profile.monthly_credits_reset_at >= now() - interval '31 days') then
    update public.profiles set monthly_credits = monthly_credits - 1 where id = new.user_id;
    new.tier_at_generation     := 'monthly';
    new.monthly_cycle_reset_at := v_profile.monthly_credits_reset_at;
  elsif v_profile.purchased_credits > 0 then
    update public.profiles set purchased_credits = purchased_credits - 1 where id = new.user_id;
    new.tier_at_generation := 'credit';
  elsif v_profile.free_used_this_week < 5 then
    update public.profiles set free_used_this_week = free_used_this_week + 1 where id = new.user_id;
    new.tier_at_generation := 'free';
  else
    raise exception 'quota exhausted';
  end if;

  return new;
end;
$$;

drop trigger if exists a_retry_consume_quota on public.generations;
create trigger a_retry_consume_quota
  before update on public.generations
  for each row execute function public.consume_quota_on_generation_retry();
