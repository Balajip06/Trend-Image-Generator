-- Migration 0029 — Replace profiles_self_update WITH-CHECK column locks
-- with a BEFORE UPDATE trigger.
--
-- Migration 0020 attempted column-equality lockdown via RLS WITH CHECK
-- subqueries (`new.credits_balance = (select credits_balance from
-- public.profiles where id = auth.uid())`). That approach has a
-- subtle bug: in Postgres, a WITH CHECK sub-SELECT against the SAME
-- table being updated sees the POST-image (the updated row in the
-- same statement's snapshot), so the equality is always trivially
-- true when the user is updating themselves — and the lock doesn't
-- bite. Worse, the `deleted_at` allow-null→timestamp condition fails
-- the wrong way on soft-delete (CI integration test caught it on
-- first run: 42501 ExecWithCheckOptions blocking
-- `update profiles set deleted_at = now()`).
--
-- Fix: BEFORE UPDATE trigger using `OLD` (real pre-image) for every
-- comparison. RLS USING still gates which rows the user can target
-- (`auth.uid() = id and deleted_at is null`); the trigger enforces
-- column allowlist + monotonicity.

-- Restore the simpler RLS policy (USING-only, no column lockdown
-- in WITH CHECK). All sensitive-column enforcement moves to the
-- trigger below.
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update
  using (auth.uid() = id and deleted_at is null)
  with check (auth.uid() = id);

create or replace function public.enforce_profiles_self_update_lockdown()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Service-role mutations bypass this trigger via the explicit
  -- guard. The current_setting bypass lets system jobs (credit
  -- grant, pg_cron weekly reset, audit triggers) write freely
  -- without auth.uid() being set.
  if v_actor is null then
    return new;
  end if;
  -- Only enforce when the user is mutating THEIR OWN row. Admin
  -- service-role paths are exempted above.
  if v_actor <> old.id then
    return new;
  end if;

  -- deleted_at: allow null → timestamp (user soft-delete) or
  -- unchanged; reject timestamp → null (self-resurrect).
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'profiles_self_update: cannot clear deleted_at'
      using errcode = 'check_violation';
  end if;

  -- tos_accepted_at: monotonic. Once stamped, cannot be nulled.
  if old.tos_accepted_at is not null and new.tos_accepted_at is null then
    raise exception 'profiles_self_update: cannot clear tos_accepted_at'
      using errcode = 'check_violation';
  end if;

  -- Locked columns. Any attempt to change these by the row owner
  -- via the authenticated role is rejected. Service-role + the
  -- legitimate triggers (consume_quota_on_generation_insert,
  -- refund_quota_on_failure, grant_credits SQL function) all
  -- bypass via the v_actor is null guard above.
  if new.id                              is distinct from old.id                              then raise exception 'profiles_self_update: id is locked'                              using errcode = 'check_violation'; end if;
  if new.email                           is distinct from old.email                           then raise exception 'profiles_self_update: email is locked'                           using errcode = 'check_violation'; end if;
  if new.credits_balance                 is distinct from old.credits_balance                 then raise exception 'profiles_self_update: credits_balance is locked'                 using errcode = 'check_violation'; end if;
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

drop trigger if exists profiles_self_update_lockdown on public.profiles;
create trigger profiles_self_update_lockdown
  before update on public.profiles
  for each row execute function public.enforce_profiles_self_update_lockdown();

comment on function public.enforce_profiles_self_update_lockdown is
  'Column-allowlist enforcement on profiles UPDATE for the row owner via authenticated role. Replaces the WITH CHECK subquery approach (migration 0020), which silently allowed mutation because Postgres WITH CHECK sub-SELECTs against the same table see the post-image. Service-role bypasses via auth.uid() is null guard.';
