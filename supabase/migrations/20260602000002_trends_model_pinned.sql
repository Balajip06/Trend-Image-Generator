-- 20260602000002_trends_model_pinned.sql
-- Phase 1: model_pinned column on trends + model column on trend_eval_runs.
--
-- model_pinned = true  → this trend uses its own explicit model value.
-- model_pinned = false → this trend inherits the global default from app_settings.
--
-- When the admin flips the global default, the settings action bulk-UPDATEs
-- trends SET model = <new> WHERE model_pinned = false, which fires
-- bump_trend_version → eval_status='untested' + is_active=false for each.
--
-- trend_eval_runs.model: records which model the run was generated with.
-- require_eval_proof_for_passed now requires a passing run for the CURRENT
-- (version, model) pair — a Gemini pass cannot certify an OpenAI serving.

-- 1. Add model_pinned to trends (existing trends default to pinned=true)
alter table public.trends
  add column if not exists model_pinned boolean not null default true;

-- New trends created via admin form will have model_pinned=false by default
-- (inherits global default). The form sends model_pinned explicitly.

-- 2. Add model column to trend_eval_runs
alter table public.trend_eval_runs
  add column if not exists model text;

-- Backfill existing runs with the trend's current model (best approximation)
update public.trend_eval_runs ter
   set model = t.model::text
  from public.trends t
 where ter.trend_id = t.id
   and ter.model is null;

-- 3. Extend require_eval_proof_for_passed to be model-aware
--    The trigger now requires a passing run matching (trend_id, prompt_version, model).
create or replace function public.require_eval_proof_for_passed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_pass_count int;
begin
  if new.eval_status is not distinct from old.eval_status then
    return new;
  end if;
  if new.eval_status <> 'passed' then
    return new;
  end if;

  -- Require at least one eval run with admin_rating='pass' matching
  -- the current (version, model). A Gemini-passing run does NOT certify
  -- an OpenAI generation, and vice versa (H-M1 from Phase 0 audit).
  select count(*) into v_pass_count
    from public.trend_eval_runs r
   where r.trend_id       = new.id
     and r.prompt_version = new.version
     and r.admin_rating   = 'pass'
     and (r.model = new.model::text or r.model is null);
     -- r.model IS NULL: backwards compat for runs created before this migration
     -- that were backfilled. Once all runs carry a model value, drop the IS NULL
     -- clause (add a comment to revisit after all historical runs are migrated).

  if v_pass_count = 0 then
    raise exception 'eval proof missing: trends.eval_status cannot be set to ''passed'' for trend % version % model % — no trend_eval_runs row with admin_rating=''pass'' exists for this (version, model)',
      new.id, new.version, new.model
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
