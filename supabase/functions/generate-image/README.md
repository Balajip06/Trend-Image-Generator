# `generate-image` Edge Function

Picks up new `generations` rows via Database Webhook, calls Gemini, uploads the result to Storage, updates the row.

## Deploy

```bash
pnpm supabase functions deploy generate-image --no-verify-jwt
```

`--no-verify-jwt` is required because the DB webhook posts with the service-role key in `Authorization`, not a user JWT.

## Secrets

Set in Supabase Dashboard → Edge Functions → generate-image → Secrets:

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | from Google AI Studio |
| `SITE_URL` | public origin of the Next.js app (e.g. `https://trendimage.com`) — used to POST `/api/push/dispatch` after marking a generation `completed` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected.

## Database Webhook

Dashboard → Database → Webhooks → Create:

- **Name:** `generate-image-on-insert`
- **Table:** `public.generations`
- **Events:** `INSERT`
- **Method:** `POST`
- **URL:** `https://<project-ref>.supabase.co/functions/v1/generate-image`
- **HTTP Headers:**
  - `Authorization: Bearer <service-role-key>`
  - `content-type: application/json`

## Failure model

| Reason | DB status | Quota |
|---|---|---|
| Gemini safety reject | `failed` | refunded (trigger) |
| Timeout (90s) | `failed_retryable` until 3 attempts, then `failed` | refunded on terminal |
| Transient (5xx, 429, network) | same | same |
| Storage upload error | same | same |
| `attempts ≥ 3` | `failed` | refunded |

## Local testing

```bash
pnpm supabase functions serve generate-image --env-file .env.local
curl -X POST http://localhost:54321/functions/v1/generate-image \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "content-type: application/json" \
  -d '{
    "type": "INSERT",
    "table": "generations",
    "schema": "public",
    "record": { …seeded row… }
  }'
```
