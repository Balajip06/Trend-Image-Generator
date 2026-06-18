-- 20260604000002_monthly_credit_grants.sql
-- Phase 3: per-period grant idempotency table + RPCs.
-- The period key (stripe_subscription_id, period_start) prevents double-grants
-- across distinct Stripe events (invoice.paid + subscription.updated) for the
-- same billing cycle — webhook_events(source,event_id) alone cannot express this.

create table public.monthly_credit_grants (
  stripe_subscription_id text        not null,
  period_start           timestamptz not null,
  user_id                uuid        not null references public.profiles(id) on delete cascade,
  allotment              int         not null,
  granted_at             timestamptz not null default now(),
  primary key (stripe_subscription_id, period_start)
);

alter table public.monthly_credit_grants enable row level security;
-- Service-role only

-- grant_monthly_credits: idempotent SET (not increment) on monthly_credits.
-- ON CONFLICT DO NOTHING ensures repeat calls for the same period are no-ops.
create or replace function public.grant_monthly_credits(
  p_user_id         uuid,
  p_subscription_id text,
  p_period_start    timestamptz,
  p_allotment       int
)
returns boolean  -- true = granted, false = already granted (idempotent no-op)
language plpgsql security definer set search_path = public as $$
declare v_inserted boolean;
begin
  if p_allotment <= 0 then
    raise exception 'grant_monthly_credits: allotment must be positive';
  end if;

  insert into public.monthly_credit_grants (stripe_subscription_id, period_start, user_id, allotment)
  values (p_subscription_id, p_period_start, p_user_id, p_allotment)
  on conflict (stripe_subscription_id, period_start) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted then
    -- SET (use-it-or-lose-it, no rollover)
    update public.profiles
       set monthly_credits          = p_allotment,
           monthly_credits_reset_at = now()
     where id = p_user_id and deleted_at is null;

    insert into public.admin_audit_log (admin_id, action, target_table, target_id, after)
    values (null, 'monthly_credit_grant', 'profiles', p_user_id::text,
      jsonb_build_object(
        'allotment', p_allotment,
        'subscription_id', p_subscription_id,
        'period_start', p_period_start
      ));
  end if;

  return v_inserted;
end;
$$;

revoke all on function public.grant_monthly_credits(uuid, text, timestamptz, int) from public;
grant execute on function public.grant_monthly_credits(uuid, text, timestamptz, int) to service_role;

-- zero_monthly_credits: called on subscription.deleted at period end
create or replace function public.zero_monthly_credits(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set monthly_credits = 0 where id = p_user_id and deleted_at is null;

  insert into public.admin_audit_log (admin_id, action, target_table, target_id, after)
  values (null, 'monthly_credits_zeroed', 'profiles', p_user_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.zero_monthly_credits(uuid) from public;
grant execute on function public.zero_monthly_credits(uuid) to service_role;
