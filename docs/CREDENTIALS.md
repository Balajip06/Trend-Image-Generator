# Credentials Reference

Every environment variable the app reads, grouped by external service. Use this as the source of truth when filling `.env.local`.

Two enforcement layers exist:
- **Zod schema** in `lib/env.ts:3` — runs at first `getServerEnv()` call. Missing required vars throw a startup error. Optional vars are read directly via `process.env.X` at the call site and degrade gracefully (see "What breaks if missing").
- **Per-call-site reads** — many optional vars are pulled via `process.env.X` and gated with truthy checks (`if (!key) return no-op`). Anything below marked "Optional" is in this category.

`NEXT_PUBLIC_` vars are bundled into the client JS. Any var without that prefix is server-only.

---

## App

| Var | Required | Where to get | Public | What breaks if missing |
|---|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | yes | Your canonical site URL (e.g. `https://trendly.app`). For local dev, `http://localhost:3008` matches `.env.local.example:7`. | yes | OG metadata + Stripe success/cancel URLs + push notification click-through URLs + sitemap base URL + `app/layout.tsx:21` `metadataBase` all silently fall back to `http://localhost:3000`. Sentry source-map upload pipeline expects a stable URL. |
| `ANONYMOUS_DAILY_BUDGET_USD` | optional (default `20`) | Decided in plan §Decision Reversals R2. Defaults to 20. | no | Anonymous-trial endpoint at `app/api/generate-anonymous/route.ts:65` falls back to `20`. Hard 503 once daily sum of `anonymous_attempts.cost_usd` crosses this number. |

---

## Supabase

| Var | Required | Where to get | Public | What breaks if missing |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase Dashboard → Project → Settings → API → "Project URL" | yes | Every Supabase client throws on init (`lib/supabase/client.ts:8`, `lib/supabase/server.ts:9`, `lib/supabase/middleware.ts:16`). Whole app is dead. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase Dashboard → Project → Settings → API → "Project API keys" → publishable (formerly anon). See commit `5bb647d` for the rename. | yes | Same — clients throw. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase Dashboard → Project → Settings → API → "Project API keys" → service_role. Never expose to the client. | no | `lib/supabase/server.ts:34` service client throws; Stripe webhook (`app/api/stripe/webhook/route.ts:39`), Edge Function notification dispatch (`app/api/push/dispatch/route.ts:36`), referral analytics route (`app/api/analytics/referral/route.ts:60`), and the seed script (`scripts/seed-trends.ts:16`) all fail. |

---

## Google Gemini

| Var | Required | Where to get | Public | What breaks if missing |
|---|---|---|---|---|
| `GEMINI_API_KEY` | optional in dev | https://aistudio.google.com/ → "Get API key". Confirm Nano Banana Pro pricing + region availability before going live. | no | `lib/gemini/client.ts:52` drops into mock mode and returns a deterministic 1px PNG header; Edge Function (`supabase/functions/generate-image/index.ts`) errors when deployed without the secret. `lib/trends/proposer.ts:67` falls back to `mockProposer` for the Phase 6 auto-detector. |

The Edge Function needs `GEMINI_API_KEY` set as a Supabase secret separately (not from `.env.local`):

```
pnpm supabase secrets set GEMINI_API_KEY=... --project-ref <ref>
```

---

## Stripe

| Var | Required | Where to get | Public | What breaks if missing |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | optional in dev | Stripe Dashboard → Developers → API keys → "Secret key" (use test mode key during dev) | no | `app/api/stripe/checkout/route.ts:15` and `app/api/stripe/webhook/route.ts:12` throw; checkout + webhook return 503. |
| `STRIPE_WEBHOOK_SECRET` | optional in dev | Created when you add the webhook endpoint in Stripe Dashboard → Developers → Webhooks. Shown as `whsec_…`. | no | `app/api/stripe/webhook/route.ts:18` returns 503 to incoming events — credits cannot be granted. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | optional | Stripe Dashboard → Developers → API keys → "Publishable key" | yes | Reserved for client-side Stripe Elements (not currently called — checkout uses server-side Session redirect). |
| `STRIPE_PRICE_ID_SMALL` | optional | Stripe Dashboard → Products → Create product "Credit pack – 50" + one-time price `$4.99`. Copy `price_…` id. | no | `lib/payments/packs.ts` `requirePackPriceId(pack)` throws on the first checkout for the small pack. |
| `STRIPE_PRICE_ID_MEDIUM` | optional | Same flow, product "Credit pack – 200" + price `$14.99`. | no | Same — medium pack checkout fails. |
| `STRIPE_PRICE_ID_LARGE` | optional | Same flow, product "Credit pack – 600" + price `$39.99`. | no | Same — large pack checkout fails. |

---

## Resend (transactional email + push fallback)

| Var | Required | Where to get | Public | What breaks if missing |
|---|---|---|---|---|
| `RESEND_API_KEY` | optional | Resend Dashboard → API Keys → "Create API Key" (full-access during dev, scoped key in prod). | no | `lib/email/send.ts:12` returns a no-op result; push-expired users get no email fallback at `app/api/push/dispatch/route.ts`. |
| `RESEND_FROM_EMAIL` | optional | Must be a verified domain or single-sender in Resend → Domains. SPF + DKIM + DMARC records live before send. | no | `lib/email/send.ts:32` throws when the API key is set but `FROM` is empty. Not in `lib/env.ts` Zod schema — caught at runtime instead. |

---

## Web Push (VAPID)

| Var | Required | Where to get | Public | What breaks if missing |
|---|---|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | optional | Generate once with `npx web-push generate-vapid-keys --json`. Keep both keys forever — rotating breaks existing subscriptions. | yes | `lib/push/client.ts` `ensurePushSubscription` returns `no_vapid_key`; service worker still registers but cannot subscribe. |
| `VAPID_PRIVATE_KEY` | optional | Same command, paired with public key. | no | `lib/push/send.ts:13` throws on first send. |
| `VAPID_SUBJECT` | optional | Any `mailto:owner@yourdomain.com` URL. Default in template is `mailto:you@example.com`. | no | `lib/push/send.ts:15` falls back to `mailto:noreply@example.com`. Not in `lib/env.ts` Zod schema. |

---

## Cloudflare Turnstile (anti-bot)

| Var | Required | Where to get | Public | What breaks if missing |
|---|---|---|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | optional | Cloudflare Dashboard → Turnstile → Add site. Create one widget per domain (separate localhost site recommended). | yes | `app/(auth)/login/LoginForms.tsx:18` `turnstileGated` is `false`; login submits without challenge. Anonymous-trial endpoint also skips client-side widget at `components/auth/TurnstileWidget.tsx:41`. |
| `TURNSTILE_SECRET_KEY` | optional | Same widget page — "Secret Key". | no | `lib/turnstile/verify.ts:12` returns `success: true` (no-op pass-through) — fine for dev, **must be set in prod** or signup + anonymous endpoints are unprotected. |

---

## PostHog (product analytics)

| Var | Required | Where to get | Public | What breaks if missing |
|---|---|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | optional | PostHog Cloud → Project Settings → "Project API Key". | yes | `components/providers/posthog-provider.tsx:35` short-circuits without initializing; all 15 events at `lib/analytics/events.ts` no-op. Funnel verification in `docs/RUNBOOK.md` Test 14 fails. |
| `NEXT_PUBLIC_POSTHOG_HOST` | optional | Same page; usually `https://us.i.posthog.com` (US) or `https://eu.i.posthog.com` (EU). | yes | Defaults to `https://us.i.posthog.com` at `components/providers/posthog-provider.tsx:38`. |

---

## Sentry (errors + perf)

| Var | Required | Where to get | Public | What breaks if missing |
|---|---|---|---|---|
| `SENTRY_DSN` | optional | Sentry → Project → Settings → "Client Keys (DSN)". | no | `sentry.server.config.ts:3` + `sentry.edge.config.ts:3` skip init — server + edge errors are not captured. |
| `NEXT_PUBLIC_SENTRY_DSN` | optional | Same DSN, exposed to the client bundle. | yes | `instrumentation-client.ts:3` skips browser SDK init; browser errors are not captured. |
| `SENTRY_AUTH_TOKEN` | optional | Sentry → User Settings → Auth Tokens. Needs `project:releases` + `project:write` scopes. | no | `next.config.ts:17` skips `withSentryConfig` source-map upload — Sentry traces show minified frames. Not in `lib/env.ts` Zod schema. |
| `SENTRY_ORG` | optional | The slug in your Sentry URL (e.g. `acme-co`). | no | Same — source-map upload is skipped. Not in `lib/env.ts` schema. |
| `SENTRY_PROJECT` | optional | The Sentry project slug. | no | Same. Not in `lib/env.ts` schema. |

---

## Upstash Redis (rate limit + abuse budget)

| Var | Required | Where to get | Public | What breaks if missing |
|---|---|---|---|---|
| `UPSTASH_REDIS_REST_URL` | optional | Upstash Console → Create database → "REST URL". | no | `lib/rate-limit.ts:17` returns a no-op limiter; per-IP and anonymous limits are not enforced. Acceptable on `localhost`, **not** in prod. |
| `UPSTASH_REDIS_REST_TOKEN` | optional | Same page — "REST Token". | no | Same — limiter is no-op. |

---

## Phase 6 (auto trend detector, post-MVP) — none of these required for MVP

| Var | Required | Where to get | Public | What breaks if missing |
|---|---|---|---|---|
| `TIKTOK_CREATIVE_CENTER_KEY` | optional | TikTok Creative Center — business account required. | no | `lib/trends/sources/tiktok.ts:14` returns empty array; the orchestrator skips TikTok. Not in `lib/env.ts` schema. |
| `INSTAGRAM_SESSION_COOKIE` | optional | Manual scrape — grey-area, deferred to post-MVP. | no | `lib/trends/sources/instagram.ts:12` returns empty array. Not in `lib/env.ts` schema. |
| `REDDIT_USER_AGENT` | optional | Any descriptive string. | no | Defaults to `TrendImageGenerator/0.1` at `lib/trends/sources/reddit.ts:41`. Not in `lib/env.ts` schema. |

---

## Dev-only flags

| Var | Required | Notes |
|---|---|---|
| `MOCK_TRENDS` | dev only | Set to `'true'` to short-circuit Supabase reads with the in-memory fixtures at `lib/dev/mock-data.ts:4`. `proxy.ts` and `lib/supabase/middleware.ts:9` also bypass auth gates when this is on. **Never set in production.** |
| `RUN_VISUAL_BASELINE` | test only | `cross-env RUN_VISUAL_BASELINE=true` opts into the 4 visual-baseline Playwright projects at `playwright.config.ts:11`. |
| `VISUAL_OUTPUT_DIR` | test only | Output directory for visual baseline PNGs at `e2e/visual-baseline.spec.ts:12` (default `baseline`). |
| `CI` | CI only | Playwright sets `forbidOnly`, retries, single worker, github reporter when present at `playwright.config.ts:16-19`. |

---

## Known schema gaps

These vars are read at runtime but are **not** declared in `lib/env.ts` Zod schema, so a missing/typoed value will not throw at startup — it will fail at the call site instead. Fix during the next env-schema pass:

| Var | Read at | Behaviour on missing |
|---|---|---|
| `SENTRY_AUTH_TOKEN` | `next.config.ts:23` | Source-map upload skipped silently. |
| `SENTRY_ORG` | `next.config.ts:21` | Same. |
| `SENTRY_PROJECT` | `next.config.ts:22` | Same. |
| `VAPID_SUBJECT` | `lib/push/send.ts:15` | Falls back to `mailto:noreply@example.com`. |
| `RESEND_FROM_EMAIL` | `lib/email/send.ts:32` | Throws on first email send. |
| `TIKTOK_CREATIVE_CENTER_KEY` | `lib/trends/sources/tiktok.ts:14` | Source returns `[]`. |
| `INSTAGRAM_SESSION_COOKIE` | `lib/trends/sources/instagram.ts:12` | Source returns `[]`. |
| `REDDIT_USER_AGENT` | `lib/trends/sources/reddit.ts:41` | Falls back to `TrendImageGenerator/0.1`. |
| `MOCK_TRENDS` | `lib/dev/mock-data.ts:18` | Treats only `'true'` as enabled. |
