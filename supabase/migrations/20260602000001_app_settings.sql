-- 20260602000001_app_settings.sql
-- Phase 1: global app settings key-value store.
-- Used for: default_image_model (the global model default admins can toggle).
-- RLS: admin-read only (mirrors admin_audit_log_admin_read policy).
-- Writes: service-role only (admin server action + logAdminAction for audit trail).

create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Admin read: any row in admin_users can read all settings
create policy "app_settings_admin_read" on public.app_settings
  for select using (
    exists (select 1 from public.admin_users where user_id = auth.uid())
  );
-- No insert/update/delete policy — writes via service-role only

-- Seed the default model value
insert into public.app_settings (key, value)
values ('default_image_model', '"nano-banana-pro"'::jsonb);

comment on table public.app_settings is
  'Global app-level config key-value store. Currently: default_image_model.';
comment on column public.app_settings.value is
  'JSON scalar or object. For default_image_model: one of "nano-banana", "nano-banana-pro", "gpt-image".';
