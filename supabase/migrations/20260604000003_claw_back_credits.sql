-- 20260604000003_claw_back_credits.sql
-- Phase 3: chargeback / refund clawback (H-C5).
-- FOR UPDATE lock prevents race with concurrent spend.
-- greatest() clamp ensures CHECK(>=0) is never violated.
-- Shortfall (already-spent refunded amount) is audited, not thrown.

create or replace function public.claw_back_credits(
  p_user_id    uuid,
  p_amount     int,
  p_bucket     text,  -- 'monthly' or 'purchased'
  p_source     text,
  p_source_ref text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_profile  public.profiles;
  v_before   int;
  v_after    int;
  v_shortfall int;
begin
  if p_amount <= 0 then return; end if;
  if p_bucket not in ('monthly', 'purchased') then
    raise exception 'claw_back_credits: invalid bucket %', p_bucket;
  end if;

  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then return; end if;

  if p_bucket = 'monthly' then
    v_before := v_profile.monthly_credits;
    v_after  := greatest(v_before - p_amount, 0);
    update public.profiles set monthly_credits   = v_after where id = p_user_id;
  else
    v_before := v_profile.purchased_credits;
    v_after  := greatest(v_before - p_amount, 0);
    update public.profiles set purchased_credits = v_after where id = p_user_id;
  end if;

  v_shortfall := p_amount - (v_before - v_after);

  insert into public.admin_audit_log (admin_id, action, target_table, target_id, after)
  values (null, 'credit_clawback', 'profiles', p_user_id::text,
    jsonb_build_object(
      'bucket',      p_bucket,
      'requested',   p_amount,
      'clawed_back', v_before - v_after,
      'shortfall',   v_shortfall,
      'source',      p_source,
      'source_ref',  p_source_ref
    ));
end;
$$;

revoke all on function public.claw_back_credits(uuid, int, text, text, text) from public;
grant execute on function public.claw_back_credits(uuid, int, text, text, text) to service_role;
