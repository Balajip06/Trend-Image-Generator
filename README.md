# Trend Image Generator

Viral-trend image generator. Next.js 16 + Supabase + Google Gemini (Nano Banana / Nano Banana Pro). Consumer-facing, IG + TikTok distribution.

> **Authoritative plan:** [`trend-image-app-plan.md`](trend-image-app-plan.md) (original) — amendments live in `.claude/plans/check-this-plan-c-users-balaj-projects-t-luminous-prism.md` and supersede the original on conflict.
>
> **Project instructions for AI agents:** [`CLAUDE.md`](CLAUDE.md).

## Stack

- **Frontend:** Next.js 16.2 App Router, React 19.2, TypeScript 5.9, Tailwind v4, shadcn/ui
- **Backend:** Supabase (Postgres + Auth + Storage + Realtime + Edge Functions + pg_cron)
- **AI:** Google Gemini — Nano Banana Pro default, v1 quick toggle
- **Payments:** Stripe Checkout, USD, one-time credit packs
- **Email:** Resend
- **Push:** Web Push (VAPID); iOS via PWA install
- **Anti-bot:** Cloudflare Turnstile
- **Observability:** PostHog (analytics) + Sentry (errors)
- **Rate limit:** Upstash Redis (sliding window)
- **Testing:** Vitest + Playwright (chromium / webkit / mobile-chrome / mobile-safari)

## Quick start

```bash
pnpm install
cp .env.local.example .env.local        # fill secrets
pnpm exec playwright install chromium webkit
pnpm supabase start                     # requires Docker Desktop
pnpm supabase db reset                  # applies migrations
pnpm supabase:types                     # regenerate lib/supabase/database.types.ts
pnpm dev
```

Open <http://localhost:3000>.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Next dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm lint:fix` | ESLint 9 (flat config) |
| `pnpm format` / `pnpm format:check` | Prettier 3 + tailwind plugin |
| `pnpm test` / `pnpm test:watch` / `pnpm test:ui` | Vitest |
| `pnpm test:e2e` / `pnpm test:e2e:ui` | Playwright |
| `pnpm supabase:start` / `pnpm supabase:stop` / `pnpm supabase:reset` | Local Supabase stack |
| `pnpm supabase:types` | Regenerate `lib/supabase/database.types.ts` from live schema |
| `pnpm supabase:diff` | Diff local DB against migrations (catches drift) |
| `pnpm supabase:migration:new <name>` | Create timestamped migration |
| `pnpm test:e2e` / `pnpm test:e2e:ui` | Playwright E2E (chromium, webkit, mobile-chrome, mobile-safari) |
| `pnpm test:e2e:visual` | Visual baseline run (`RUN_VISUAL_BASELINE=true`) |

## Folder layout

```
/app                  Routes — (public), (auth), (app), admin, api
/lib
  /supabase           Browser + server + service-role clients, middleware helper, generated types
  /utils              cn, …
/components           UI primitives
/e2e                  Playwright specs
/supabase/migrations  Timestamped SQL migrations
/.claude              Project tracker (todo, lessons, session-log)
/.github/workflows    CI pipelines
```

## Non-negotiables

- **RLS-enforced quota.** DB trigger blocks generation insert when `free_used_this_week ≥ 5 AND credits_balance ≤ 0`.
- **Idempotency.** `/api/generate` accepts `Idempotency-Key`; duplicate POST = 1 Gemini call.
- **Eval gate.** `is_active=true` requires `eval_status='passed'` (DB constraint).
- **Cost tracking.** Every `generations` row records `cost_usd`.
- **Soft-delete + audit log.** GDPR-compliant, cascading via `deleted_at`.
- **Stripe webhook idempotency.** `webhook_events.event_id` unique.
- **Per-IP rate limit.** 20 generations / hour / IP at Edge.
- **Anonymous trial.** Exactly 1 attempt per fingerprint + IP lifetime; global $20/day abuse budget.

See [`CLAUDE.md`](CLAUDE.md) for the full list and current phase state.

## Verification

The full ship gate is a 14-test matrix in [`docs/RUNBOOK.md`](docs/RUNBOOK.md) (RLS quota, idempotency replay, retry + refund, schema-driven form, eval gate, push + email fallback, SSR HTML, pg_cron purges, referral farming guard, Stripe webhook dedup, GDPR cascade, PostHog funnel). Run after every external credential is in `.env.local`.

Quick local sanity check (no creds needed):

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Documentation

| File | Purpose |
|---|---|
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Step-by-step from creds-arrival to MVP ship, plus the 14-test verification matrix |
| [`docs/CREDENTIALS.md`](docs/CREDENTIALS.md) | Every env var, where to get it, what breaks if missing |

## Database Webhooks (configure in Supabase Dashboard)

Bridges between Postgres state changes and the Next.js app.

| Name | Table | Event | URL | Headers |
|---|---|---|---|---|
| `generate-on-insert` | `public.generations` | INSERT | `${SITE_URL}/functions/v1/generate-image` (the Edge Function) | `Authorization: Bearer <service-role-key>` |
| `referral-redeemed` | `public.referrals` | UPDATE | `${SITE_URL}/api/analytics/referral` | `Authorization: Bearer <service-role-key>` |

`referral-redeemed` filters internally for the `pending → rewarded` transition; other UPDATEs return `{ skipped: true }`.

## Plan + state docs

| File | Purpose |
|---|---|
| `CLAUDE.md` | Project conventions, non-negotiables, active skills |
| `trend-image-app-plan.md` | Original product plan |
| `../../.claude/plans/check-this-plan-c-users-balaj-projects-t-luminous-prism.md` | Amended plan (authoritative) — decision reversals + verification gates |
| `.claude/todo.md` | Per-phase task tracker |
| `.claude/session-log.md` | Session-by-session change log |
| `.claude/lessons.md` | Patterns learned + corrections (read at every session start) |

## License

Proprietary — all rights reserved.
