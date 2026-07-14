-- Allow app_settings.value to be SQL NULL.
--
-- ROOT CAUSE this fixes: the banner-trend admin setting could never be cleared
-- back to "no override". The write path did `value: null` which PostgREST maps
-- to SQL NULL, and the column was `jsonb NOT NULL` — so the UPDATE failed
-- silently (error swallowed by the server action) and the banner never changed.
--
-- Additionally, saved banner values were double-encoded: the action called
-- JSON.stringify() before handing the value to supabase-js, which JSON-encodes
-- the request body again, so the jsonb column stored "\"<uuid>\"" instead of
-- "<uuid>". The homepage read then compared a quoted string against trend ids
-- and never matched. The action code now passes raw values (single-encode) and
-- treats SQL NULL as "no override".
--
-- This migration: relax NOT NULL, then normalize any existing corrupt rows.

alter table public.app_settings
  alter column value drop not null;

-- Normalize "no override" from jsonb null to SQL NULL for consistency.
update public.app_settings
set value = null
where key = 'banner_trend_id' and value = 'null'::jsonb;

-- Repair any double-encoded banner id written by the old action
-- (jsonb string whose parsed text is itself a quoted string: "\"<uuid>\"").
update public.app_settings
set value = to_jsonb(trim(both '"' from (value #>> '{}')))
where key = 'banner_trend_id'
  and jsonb_typeof(value) = 'string'
  and (value #>> '{}') like '"%"';

-- Repair any double-encoded default_image_model similarly.
update public.app_settings
set value = to_jsonb(trim(both '"' from (value #>> '{}')))
where key = 'default_image_model'
  and jsonb_typeof(value) = 'string'
  and (value #>> '{}') like '"%"';
