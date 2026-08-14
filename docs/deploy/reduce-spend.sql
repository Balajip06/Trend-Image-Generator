-- ===========================================================================
-- REDUCE AI SPEND — run in the Supabase SQL editor
-- Project: rkvhpiienwdeawqkrdxm
-- ===========================================================================
--
-- Your global default is `gpt-image-2` at ~$0.04/image. `nano-banana-2` is
-- ~$0.0039 — about 10x cheaper. That default is the single biggest lever on
-- your bill, and it does NOT require deploying anything: the currently
-- deployed Edge Function already reads `trends.model`.
--
-- The per-model cost CEILINGS are a different story. They are seeded in
-- app_settings, but the code that enforces them (checkCostLimit) ships with
-- the Edge Function, which is not deployed yet. Until you run
--   pnpm supabase functions deploy generate-image
-- STEP 3 below changes a number that nothing reads.
--
-- Run STEP 0 and STEP 1 first and read the output before running STEP 2.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- STEP 0 — Where is the money actually going? (read-only)
-- ---------------------------------------------------------------------------

select value as current_default_model
  from public.app_settings where key = 'default_image_model';

select model,
       count(*)                          as trends,
       count(*) filter (where is_active) as live,
       count(*) filter (where model_pinned) as pinned_wont_change
  from public.trends
 group by model
 order by trends desc;

-- Spend by model, last 30 days. Uses `model_used` (the provider wire id)
-- because `model_key` only starts populating after the function deploys.
select coalesce(model_used, '(unrecorded)') as model,
       count(*)                             as generations,
       round(sum(cost_usd)::numeric, 2)     as usd
  from public.generations
 where created_at >= now() - interval '30 days'
 group by 1
 order by usd desc nulls last;

-- Daily trend, last 14 days.
select date_trunc('day', created_at)::date as day,
       count(*)                            as gens,
       round(sum(cost_usd)::numeric, 2)    as usd
  from public.generations
 where created_at >= now() - interval '14 days'
 group by 1
 order by 1 desc;


-- ---------------------------------------------------------------------------
-- STEP 1 — Impact preview: what would switching the default take offline?
-- ---------------------------------------------------------------------------
--
-- Changing `trends.model` fires bump_trend_version, which sets
-- eval_status='untested' AND is_active=false. Every trend listed here goes
-- DARK until you re-run eval on it. Read this list before STEP 2.

select id, slug, title, model, is_active
  from public.trends
 where model_pinned = false
   and model <> 'nano-banana-2'
 order by is_active desc, display_order;

select count(*) filter (where is_active)  as live_trends_that_will_go_dark,
       count(*)                           as total_trends_affected
  from public.trends
 where model_pinned = false
   and model <> 'nano-banana-2';


-- ---------------------------------------------------------------------------
-- STEP 2 — Switch the default to the ~10x cheaper model
-- ---------------------------------------------------------------------------
--
-- ONLY run this once you have read STEP 1 and accept those trends going
-- offline pending re-eval. Wrapped in a transaction: if anything fails,
-- nothing changes.
--
-- Prefer doing this from /admin/settings instead if you want the change
-- written to the audit log with your admin id as the actor. This SQL path
-- records it as a system change.

/*
begin;

update public.app_settings
   set value = '"nano-banana-2"'::jsonb,
       updated_at = now()
 where key = 'default_image_model';

-- Non-pinned trends follow the global default. Pinned trends keep their model
-- on purpose — pin your best-performing trends to gpt-image-2 first if its
-- output quality is worth the 10x on those specific trends.
update public.trends
   set model = 'nano-banana-2'
 where model_pinned = false
   and model <> 'nano-banana-2';

-- Leaves an attributable trail even though this ran as SQL, not via the UI.
insert into public.admin_audit_log (admin_id, action, target_table, target_id, before, after)
values (null, 'model_provider_switched', 'app_settings', 'default_image_model',
        jsonb_build_object('model', 'gpt-image-2', 'via', 'sql'),
        jsonb_build_object('model', 'nano-banana-2', 'via', 'sql', 'reason', 'cost reduction'));

commit;
*/


-- ---------------------------------------------------------------------------
-- STEP 3 — Tighten the ceilings
-- ---------------------------------------------------------------------------
--
-- INERT until `pnpm supabase functions deploy generate-image` has run.
-- Safe to set now so the limits are already in place when it does.
--
--   gpt-image-2        $5/day  = ~125 images   (hard brake on the pricey one)
--   nano-banana-2      $10/day = ~2,500 images
--   nano-banana-2-lite $5/day  = ~2,500 images
--
-- Total daily ceiling $20 (down from the seeded $85). Adjust from your STEP 0
-- numbers — these are reasoned from list prices, not your actual traffic.

/*
update public.app_settings
   set value = jsonb_build_object(
         'gpt-image-2',        jsonb_build_object('daily_usd', 5,  'monthly_usd', 100, 'enabled', true),
         'nano-banana-2',      jsonb_build_object('daily_usd', 10, 'monthly_usd', 200, 'enabled', true),
         'nano-banana-2-lite', jsonb_build_object('daily_usd', 5,  'monthly_usd', 100, 'enabled', true)
       ),
       updated_at = now()
 where key = 'model_cost_limits';

select jsonb_pretty(value) from public.app_settings where key = 'model_cost_limits';
*/


-- ---------------------------------------------------------------------------
-- STEP 4 (optional) — Kill switch
-- ---------------------------------------------------------------------------
-- Disables gpt-image-2 outright. Also only takes effect after the deploy.

/*
update public.app_settings
   set value = jsonb_set(value, '{gpt-image-2,enabled}', 'false'::jsonb),
       updated_at = now()
 where key = 'model_cost_limits';
*/
