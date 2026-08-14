-- Fire the generate-image Edge Function on RETRY, not just on INSERT.
--
-- ROOT CAUSE this fixes: `generations_invoke_edge` (migration 20260713000001)
-- is declared `after insert ... when (new.status = 'pending')`. But
-- `/api/generate/retry` re-queues a failed row with an UPDATE:
--
--     update generations set status='pending', attempts=attempts+1 where id=...
--
-- An UPDATE never fires an INSERT-only trigger, so nothing ever picked the row
-- back up. The route returned `{ ok: true }`, the row sat at `pending`, and the
-- user-facing "Try again" button in ResultView.tsx spun forever — until the
-- hourly `sweep_stale_pending_generations` job marked it failed 6 hours later.
--
-- That sweep exists (migration 20260813000001) because four rows sat pending
-- for 31-34 days. Its header attributes them to a worker that "never claimed"
-- them; this INSERT-only trigger is one reason why.
--
-- The Edge Function is safe to invoke again: it claims work with a conditional
-- `update ... where status='pending'` and returns early if the row was already
-- claimed, so a double delivery is a no-op rather than a double charge.
--
-- Quota is NOT double-consumed on this path: `consume_quota_on_generation_retry`
-- (migration 20260601000004) only re-consumes on a `failed -> pending`
-- transition, and the retry route only accepts `failed_retryable` rows, which
-- keep their original deduction.

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
      -- The Edge Function only accepts type='INSERT' (it ignores everything
      -- else), and a retry is semantically a fresh dispatch of the same row,
      -- so both paths report 'INSERT'.
      'type', 'INSERT',
      'table', 'generations',
      'schema', 'public',
      'record', to_jsonb(new)
    )
  );

  return new;
end;
$$;

-- INSERT path: unchanged.
drop trigger if exists generations_invoke_edge on public.generations;
create trigger generations_invoke_edge
  after insert on public.generations
  for each row
  when (new.status = 'pending')
  execute function public.invoke_generate_image();

-- RETRY path: a terminal row flipped back to 'pending'. Scoped to that exact
-- transition so ordinary status churn (pending -> processing -> completed)
-- cannot re-dispatch a row mid-flight.
drop trigger if exists generations_invoke_edge_on_retry on public.generations;
create trigger generations_invoke_edge_on_retry
  after update on public.generations
  for each row
  when (
    new.status = 'pending'
    and old.status is distinct from new.status
    and old.status in ('failed', 'failed_retryable')
  )
  execute function public.invoke_generate_image();

comment on function public.invoke_generate_image is
  'Dispatches a generations row to the generate-image Edge Function. Fired on INSERT of a pending row and on a terminal->pending retry transition. Skips silently when Vault secrets are unset.';
