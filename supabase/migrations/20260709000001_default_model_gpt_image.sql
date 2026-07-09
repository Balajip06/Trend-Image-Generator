-- 20260709000001_default_model_gpt_image.sql
-- Switch the global default image model from nano-banana-pro (Gemini) to
-- gpt-image (OpenAI). Non-pinned live trends go dark until re-evaluated
-- (bump_trend_version trigger) — same behavior as the admin settings UI toggle.

update public.app_settings
set value = '"gpt-image"'::jsonb, updated_at = now()
where key = 'default_image_model';

update public.trends
set model = 'gpt-image'
where model_pinned = false;
