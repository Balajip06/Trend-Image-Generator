-- Migration — invoke the generate-image Edge Function on new generations rows.
--
-- ROOT CAUSE this fixes: /api/generate inserts a `pending` ("Queued") row and
-- returns; the only thing that moves pending->processing is the generate-image
-- Edge Function, which was invoked ONLY by a Supabase Database Webhook created
-- by hand in the dashboard. That webhook lived nowhere in version control, so
-- if it was missing/misconfigured every generation sat at "Queued" forever.
--
-- This migration replaces that hidden manual webhook with an in-database
-- AFTER INSERT trigger that POSTs the same payload the dashboard webhook would,
-- via pg_net. Secrets are read from Vault (never hardcoded) so this is safe to
-- commit and re-run.
--
-- REQUIRED ONE-TIME SETUP (per environment, run once with the real values):
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/generate-image',
--     'edge_generate_image_url');
--   select vault.create_secret('<WEBHOOK_SECRET>', 'edge_webhook_secret');
--   -- WEBHOOK_SECRET must equal the value set on the function:
--   --   supabase secrets set WEBHOOK_SECRET=<same value>
-- If the secrets already exist, update them with vault.update_secret instead.

create extension if not exists pg_net with schema extensions;

-- Trigger function: fire-and-forget POST to the Edge Function, mirroring the
-- Supabase DB webhook payload shape ({ type, table, schema, record }).
create or replace function public.invoke_generate_image()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  fn_url    text;
  fn_secret text;
begin
  -- Pull config from Vault. If either secret is missing (environment not yet
  -- configured), skip silently rather than erroring the INSERT — the row still
  -- lands as `pending` and can be retried once secrets are set.
  select decrypted_secret into fn_url
    from vault.decrypted_secrets where name = 'edge_generate_image_url';
  select decrypted_secret into fn_secret
    from vault.decrypted_secrets where name = 'edge_webhook_secret';

  if fn_url is null or fn_secret is null then
    raise warning 'invoke_generate_image: missing Vault secret(s); skipping webhook for generation %', new.id;
    return new;
  end if;

  perform net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || fn_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'generations',
      'schema', 'public',
      'record', to_jsonb(new)
    )
  );

  return new;
end;
$$;

-- Fire only on the initial pending insert (belt-and-suspenders; all inserts
-- from /api/generate are pending). Conditional update inside the function
-- already guards against double-processing on webhook retries.
drop trigger if exists generations_invoke_edge on public.generations;
create trigger generations_invoke_edge
  after insert on public.generations
  for each row
  when (new.status = 'pending')
  execute function public.invoke_generate_image();
