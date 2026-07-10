-- 20260710000001_model_lineup_rename.sql
-- Rename the trend_model lineup to the current shipping models and fix the
-- broken Gemini model IDs that caused generation to hang until timeout.
--
-- OLD label / key        →  NEW key            →  provider API id (in app code)
--   nano-banana          →  nano-banana-2       →  gemini-3.1-flash-image        (Nano Banana 2)
--   nano-banana-pro      →  nano-banana-2-lite  →  gemini-3.1-flash-lite-image   (Nano Banana 2 Lite)
--   gpt-image            →  gpt-image-2         →  gpt-image-2                   (ChatGPT Images 2.0)
--
-- Root cause of the "frozen then timeout" symptom: the code mapped
-- nano-banana-pro → 'gemini-3.0-pro-image', a model ID that does not exist.
-- The request stalled to the 170s AbortController deadline before failing.
-- The API-id fix lives in app code (lib/image-provider + the Edge function);
-- this migration only renames the DB enum values + dependent data.
--
-- ALTER TYPE ... RENAME VALUE renames in place: every trends.model row using
-- the old value automatically reads as the new value, with NO row UPDATE and
-- therefore NO bump_trend_version / eval-reset side effect. Existing eval
-- proofs stay valid. We then patch trend_eval_runs.model (plain text, not the
-- enum) and app_settings so the eval-proof trigger keeps matching.

-- 1. Rename the enum values in place (PG15+; each is its own statement).
alter type public.trend_model rename value 'nano-banana' to 'nano-banana-2';
alter type public.trend_model rename value 'nano-banana-pro' to 'nano-banana-2-lite';
alter type public.trend_model rename value 'gpt-image' to 'gpt-image-2';

-- 2. trend_eval_runs.model is TEXT (not the enum) and is compared verbatim by
--    require_eval_proof_for_passed against trends.model::text. Rewrite the old
--    strings so passing runs still certify their trend's (version, model).
update public.trend_eval_runs set model = 'nano-banana-2'      where model = 'nano-banana';
update public.trend_eval_runs set model = 'nano-banana-2-lite' where model = 'nano-banana-pro';
update public.trend_eval_runs set model = 'gpt-image-2'        where model = 'gpt-image';

-- 3. Global default stays "ChatGPT Images 2.0" (was already gpt-image →
--    now gpt-image-2). The enum rename already updated any trends.model rows,
--    but app_settings stores the value as free JSON text, so patch it too.
update public.app_settings
   set value = '"gpt-image-2"'::jsonb, updated_at = now()
 where key = 'default_image_model'
   and value = '"gpt-image"'::jsonb;
