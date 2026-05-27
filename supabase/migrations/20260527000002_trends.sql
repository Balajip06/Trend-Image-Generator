-- Migration 0002 — trends
-- Per amended plan §"Data Model additions"

create type public.trend_model as enum ('nano-banana', 'nano-banana-pro');
create type public.trend_aspect_ratio as enum ('1:1', '3:4', '16:9', '9:16');
create type public.eval_status as enum ('untested', 'passed', 'failed');

create table public.trends (
  id                       uuid primary key default gen_random_uuid(),
  slug                     text unique not null,
  title                    text not null,
  description              text,
  thumbnail_url            text,
  sample_before_url        text,
  sample_after_url         text,
  prompt_template          text not null,
  prompt_template_history  jsonb not null default '[]'::jsonb,
  version                  int not null default 1,
  model                    trend_model not null default 'nano-banana-pro',
  reference_image_urls     text[] not null default '{}',
  aspect_ratio             trend_aspect_ratio not null default '1:1',
  input_schema             jsonb not null default '{"fields":[{"type":"image","name":"user_photo","label":"Your photo","required":true,"min_count":1,"max_count":1}]}'::jsonb,
  is_active                boolean not null default false,
  display_order            int not null default 0,
  expires_at               timestamptz,
  eval_status              eval_status not null default 'untested',
  seo_title                text,
  seo_description          text,
  faq                      jsonb not null default '[]'::jsonb,
  created_by               uuid references auth.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index trends_active_order_idx on public.trends(display_order) where is_active = true;
create index trends_slug_idx          on public.trends(slug);
create index trends_expires_idx       on public.trends(expires_at) where expires_at is not null;

-- Eval gate — cannot activate without passing eval
alter table public.trends
  add constraint trends_eval_gate
  check (is_active = false or eval_status = 'passed');

-- Append to prompt_template_history on prompt_template change + bump version
create or replace function public.bump_trend_version()
returns trigger language plpgsql as $$
begin
  if new.prompt_template is distinct from old.prompt_template
     or new.model         is distinct from old.model then
    new.version := old.version + 1;
    new.prompt_template_history := old.prompt_template_history
      || jsonb_build_object(
        'version', old.version,
        'prompt_template', old.prompt_template,
        'model', old.model,
        'replaced_at', now()
      );
    -- Force re-eval on substantive change
    new.eval_status := 'untested';
    new.is_active   := false;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trends_bump_version on public.trends;
create trigger trends_bump_version
  before update on public.trends
  for each row execute function public.bump_trend_version();

-- RLS
alter table public.trends enable row level security;

-- Public read: only active + not expired
create policy "trends_public_read" on public.trends
  for select using (
    is_active = true
    and (expires_at is null or expires_at > now())
  );

-- Admin writes via service role (RLS bypassed)
