-- 20260601000003_quota_trigger_buckets.sql
-- Phase 0: rewrite all quota/credit triggers for the two-bucket model.
-- Spend precedence: kimp_unlimited → is_vip → monthly_credits → purchased_credits → free_used_this_week → block.
-- Refund: returns credit to the EXACT bucket that was consumed (snapshotted in tier_at_generation).
-- set_generation_purge_at: reads tier_at_generation, not live credits_balance.
-- grant_credits: now writes purchased_credits (packs = non-expiring).
-- maybe_reward_referral: writes purchased_credits (referral bonus = non-expiring).

-- 1. Add monthly_cycle_reset_at to generations for refund-cycle guard (H-C10).
alter table public.generations
  add column if not exists monthly_cycle_reset_at timestamptz;

-- 2. Rewrite consume_quota_on_generation_insert
create or replace function public.consume_quota_on_generation_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_profile     public.profiles;
  v_kimp        boolean := false;
  v_vip         boolean := false;
begin
  -- Read is_vip WITHOUT touching kimp_unlimited (column doesn't exist until Phase 2).
  select coalesce(is_vip, false) into v_vip
  from public.profiles where id = new.user_id;

  -- kimp_unlimited guard: attempt read, fall back to false if column absent (Phase 2 not yet deployed).
  -- Must be in its own BEGIN/EXCEPTION block so undefined_column is catchable at runtime.
  begin
    select coalesce(kimp_unlimited, false) into v_kimp
    from public.profiles where id = new.user_id;
  exception when undefined_column then
    v_kimp := false;
  end;

  if v_kimp is true then
    new.tier_at_generation := 'kimp';
    -- Cost tracked via cost_usd written by Edge Function on completion.
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

-- 3. Rewrite refund_quota_on_failure (bucket-aware, cycle-safe H-C10)
create or replace function public.refund_quota_on_failure()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'failed' and old.status is distinct from 'failed' then
    if new.tier_at_generation = 'monthly' then
      -- H-C10: only refund if the billing cycle hasn't rolled over since spend.
      -- If it has, the credit was from a past cycle and refunding into the new
      -- cycle would silently exceed the allotment.
      declare v_current_reset timestamptz;
      begin
        select monthly_credits_reset_at into v_current_reset
          from public.profiles where id = new.user_id;
        if new.monthly_cycle_reset_at is not distinct from v_current_reset then
          update public.profiles
            set monthly_credits = monthly_credits + 1
          where id = new.user_id;
        end if;
        -- If cycle reset since spend, silently skip — the credit was from a past cycle.
      end;
    elsif new.tier_at_generation = 'credit' then
      update public.profiles
        set purchased_credits = purchased_credits + 1
      where id = new.user_id;
    elsif new.tier_at_generation = 'free' then
      update public.profiles
        set free_used_this_week = greatest(free_used_this_week - 1, 0)
      where id = new.user_id;
    end if;
    -- 'kimp' + 'vip': no quota to refund; cost_usd stays attributed for margin.
  end if;
  return new;
end;
$$;

-- 4. Rewrite set_generation_purge_at to use tier_at_generation snapshot (H-C8)
--    Consume trigger runs before purge trigger alphabetically (generations_consume_quota
--    vs generations_set_purge), so tier_at_generation is already stamped when this fires.
create or replace function public.set_generation_purge_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- tier_at_generation was just stamped by consume_quota_on_generation_insert.
  -- 'kimp', 'vip', 'monthly', 'credit' → keep forever (Pro-equivalent).
  -- 'free' → 30-day TTL.
  if new.tier_at_generation in ('kimp', 'vip', 'monthly', 'credit') then
    new.purge_at := null;
  else
    new.purge_at := now() + interval '30 days';
  end if;
  return new;
end;
$$;

-- Trigger order check: consume_quota fires as 'generations_consume_quota' (alphabetically
-- after 'generations_set_purge'). Re-register both to enforce correct order.
drop trigger if exists generations_set_purge    on public.generations;
drop trigger if exists generations_consume_quota on public.generations;

-- set_purge must run AFTER consume_quota so tier_at_generation is already set.
-- Postgres BEFORE triggers on the same table run alphabetically. Rename to control order:
--   a_consume_quota → runs first
--   b_set_purge     → runs second (reads tier_at_generation)
drop trigger if exists a_consume_quota on public.generations;
drop trigger if exists b_set_purge     on public.generations;

create trigger a_consume_quota
  before insert on public.generations
  for each row execute function public.consume_quota_on_generation_insert();

create trigger b_set_purge
  before insert on public.generations
  for each row execute function public.set_generation_purge_at();

-- 5. Repoint grant_credits to write purchased_credits (packs are non-expiring)
create or replace function public.grant_credits(
  p_user_id     uuid,
  p_amount      int,
  p_source      text,
  p_source_ref  text
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_amount <= 0 then
    raise exception 'grant_credits amount must be positive';
  end if;

  update public.profiles
    set purchased_credits = purchased_credits + p_amount
  where id = p_user_id and deleted_at is null;

  if not found then
    raise exception 'profile % not found or deleted', p_user_id;
  end if;

  insert into public.admin_audit_log (admin_id, action, target_table, target_id, after)
  values (
    null, 'credit_grant', 'profiles', p_user_id::text,
    jsonb_build_object('amount', p_amount, 'source', p_source, 'source_ref', p_source_ref)
  );
end;
$$;

revoke all on function public.grant_credits(uuid, int, text, text) from public;
grant execute on function public.grant_credits(uuid, int, text, text) to service_role;

-- 6. Repoint maybe_reward_referral to write purchased_credits (referral bonus = non-expiring)
create or replace function public.maybe_reward_referral()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ref         public.referrals;
  v_prior       int;
  v_email_hash  text;
  v_already     int;
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    select count(*) into v_prior
      from public.generations
     where user_id = new.user_id and status = 'completed' and id <> new.id;
    if v_prior = 0 then
      select * into v_ref from public.referrals
        where referred_id = new.user_id and status = 'pending'
        for update;
      if found then
        select email_to_hash(email) into v_email_hash
          from public.profiles where id = new.user_id;

        select count(*) into v_already
          from public.referral_rewards
         where referrer_id = v_ref.referrer_id
           and referee_email_hash = v_email_hash;

        update public.referrals
          set status = 'rewarded', rewarded_at = now()
         where id = v_ref.id;

        if v_already = 0 then
          insert into public.referral_rewards (referrer_id, referee_email_hash, source_referral_id)
          values (v_ref.referrer_id, v_email_hash, v_ref.id);

          -- Use purchased_credits (non-expiring, like buying a pack)
          update public.profiles
            set purchased_credits    = purchased_credits    + 10,
                bonus_credits_earned = least(bonus_credits_earned + 10, 50)
           where id = v_ref.referrer_id
             and bonus_credits_earned < 50;
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;
