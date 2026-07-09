-- 20260709000004_banner_trend_setting.sql
-- Admin-settable homepage banner trend. Overrides trends[0] (normally the
-- lowest display_order) so an admin can pin any active trend as the hero
-- banner regardless of its catalogue sort position.
-- Null value = no override, homepage falls back to normal display_order sort.

insert into public.app_settings (key, value)
values ('banner_trend_id', 'null'::jsonb)
on conflict (key) do nothing;

comment on column public.app_settings.value is
  'JSON scalar or object. default_image_model: one of "nano-banana", "nano-banana-pro", "gpt-image". banner_trend_id: trend UUID string or null.';
