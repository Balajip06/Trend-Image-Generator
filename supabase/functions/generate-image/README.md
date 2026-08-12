# `generate-image` Edge Function

Picks up new `generations` rows via a DB trigger (`generations_invoke_edge`,
migration `20260713000001_generations_invoke_edge_function.sql`), calls
Gemini, uploads the result to Storage, updates the row.

## Deploy

```bash
pnpm supabase functions deploy generate-image --no-verify-jwt
```

`--no-verify-jwt` is required because the trigger posts a shared `WEBHOOK_SECRET`
in `Authorization`, not a user JWT — without this flag the platform's own JWT
gate rejects the request with 401 `UNAUTHORIZED_INVALID_JWT_FORMAT` before the
function's own auth check ever runs.

## Secrets

Set in Supabase Dashboard → Edge Functions → generate-image → Secrets:

| Key              | Value                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY` | from Google AI Studio                                                                                                                       |
| `WEBHOOK_SECRET` | shared secret; must equal the Vault `edge_webhook_secret` value the trigger sends                                                           |
| `SITE_URL`       | public origin of the Next.js app (e.g. `https://trendimage.com`) — used to POST `/api/push/dispatch` after marking a generation `completed` |

`SUPABASE_URL` and `SUPABASE_SECRET_KEYS` are auto-injected. Legacy JWT keys
(`anon`/`service_role`) are disabled on this project — the function reads the
secret key via `SUPABASE_SECRET_KEYS` (JSON `{"default": "sb_secret_..."}"`),
not the old `SUPABASE_SERVICE_ROLE_KEY` var.

## Invocation (DB trigger, not a Database Webhook)

The old approach — a manually-created Supabase Database Webhook — is
retired. It lived only in the dashboard, was never in version control, and
being missing/misconfigured was the root cause of generations getting stuck
at `pending` ("Queued") forever. It's now a committed migration instead:

`supabase/migrations/20260713000001_generations_invoke_edge_function.sql`
adds an `AFTER INSERT` trigger on `public.generations` that POSTs to this
function via `pg_net`, with the URL + `WEBHOOK_SECRET` read from Vault
(`edge_generate_image_url`, `edge_webhook_secret`) — see that migration's
header comment for one-time setup.

## Failure model

| Reason                        | DB status                                          | Quota                |
| ----------------------------- | -------------------------------------------------- | -------------------- |
| Gemini safety reject          | `failed`                                           | refunded (trigger)   |
| Timeout (90s)                 | `failed_retryable` until 3 attempts, then `failed` | refunded on terminal |
| Transient (5xx, 429, network) | same                                               | same                 |
| Storage upload error          | same                                               | same                 |
| `attempts ≥ 3`                | `failed`                                           | refunded             |

## Local testing

```bash
pnpm supabase functions serve generate-image --env-file .env.local
curl -X POST http://localhost:54321/functions/v1/generate-image \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{
    "type": "INSERT",
    "table": "generations",
    "schema": "public",
    "record": { …seeded row… }
  }'
```
