# Trend Image Generator — Task Tracker

**Authoritative plan:** [../../.claude/plans/check-this-plan-c-users-balaj-projects-t-luminous-prism.md](../../../.claude/plans/check-this-plan-c-users-balaj-projects-t-luminous-prism.md)
**Current phase:** Phase 0 — Pre-Build
**Last updated:** 2026-05-27

Mark `[x]` only with proof (see CLAUDE.md → Workflow → Verification).

---

## Phase 0 — Pre-Build Checklist

External prerequisites (run in parallel where possible):

- [ ] Gemini API access confirmed (Nano Banana Pro pricing + region available, not preview-only)
- [ ] Stripe account — test mode active + production application submitted (1–2 wk verification window)
- [ ] Resend account + domain verified (SPF + DKIM + DMARC records live)
- [ ] VAPID key pair generated (`web-push generate-vapid-keys`)
- [ ] Cloudflare Turnstile — site keys for `localhost` + production domain
- [ ] Domain registered + Cloudflare DNS pointed
- [ ] ToS draft (no-refund-for-AI-quality clause, DMCA, AUP)
- [ ] Privacy Policy draft (GDPR Article 15 + 17 commitments)
- [ ] Acceptable Use Policy draft (Stripe will ask)
- [ ] Final credit-pack pricing decided (recommend $4.99=50, $14.99=200, $39.99=600)
- [ ] 5 launch trends drafted: prompt template + input_schema + 5+ eval reference photos each + sample before/after + FAQ (3–5 Qs)
- [ ] Upstash Redis account (or commit to in-memory LRU for v1)
- [ ] PostHog project created + project key in hand
- [x] **Sentry day-1** — YES (plan §Reversals R1)
- [x] **Anonymous 1-try trial** — YES (plan §Reversals R2)
- [x] **Free tier: 5/week refill** — YES (plan §Reversals R3)
- [x] **Test stack** — Vitest + Playwright (Playwright primary E2E, agent-browser supplemental for nightly agent-as-user smoke) (plan §Reversals R4)
- [x] `bonus_credits_earned` cap = **50** (5 referrals × 10 credits) — accepted default
- [x] Global anonymous-trial daily abuse budget = **$20/day** — accepted default
- [x] Package manager = **pnpm** (faster, Vercel-default, lockfile-friendly)

---

## Phase 1 — Foundation (3–4 days)

### 1.1 Scaffold
- [ ] `npx create-next-app@latest` — App Router, TS, Tailwind, src/ no
- [ ] shadcn/ui init
- [ ] ESLint + Prettier + strict TS
- [ ] pnpm/npm choice locked
- [ ] Git init + first commit

### 1.2 Supabase
- [ ] Supabase project created (US-East region for global latency balance)
- [ ] `supabase init` local + linked
- [ ] Migration 0001: profiles (with all amended columns — `credits_balance`, `free_used_this_week`, `free_week_starts_at`, `referral_code`, `referred_by`, `bonus_credits_earned`, `push_subscription`, `deleted_at`)
- [ ] Migration 0002: trends (`input_schema`, `prompt_template`, `version`, `prompt_template_history`, `expires_at`, `eval_status`, `seo_title`, `seo_description`, `faq`)
- [ ] Migration 0003: generations (`idempotency_key`, `attempts`, `cost_usd`, `trend_version`, `purge_at`, `is_public`, `share_count`)
- [ ] Migration 0004: referrals, trend_eval_inputs, trend_eval_runs, trend_suggestions, admin_audit_log, webhook_events, anonymous_attempts
- [ ] RLS policies — quota block (`free_used_this_week >= 5 AND credits_balance <= 0`), public gallery gate, soft-delete cascade
- [ ] DB trigger — admin_audit_log on admin actions
- [ ] DB trigger — credits_balance decrement on generation insert
- [ ] DB constraint — `is_active=true` requires `eval_status='passed'`
- [ ] Generated TS types committed to `lib/supabase/types.ts`

### 1.3 Auth
- [ ] Google OAuth provider configured in Supabase
- [ ] Magic-link email via Resend wired
- [ ] `(auth)` route group + login UI
- [ ] Auth middleware for `(app)` + `/admin` route groups
- [ ] Profile auto-create trigger (`auth.users` insert → `profiles` insert)
- [ ] `referral_code` auto-generated on profile create

### 1.4 Admin Gating
- [ ] `admin_users` table seeded with own user_id
- [ ] `/admin` middleware checks admin_users
- [ ] Audit-log trigger writes to `admin_audit_log` on admin actions

### 1.5 Stripe Test Mode
- [ ] Stripe SDK installed
- [ ] Test products created (credit packs)
- [ ] Webhook endpoint `/api/stripe/webhook` stub
- [ ] `webhook_events` idempotency table tested with duplicate event

### 1.6 Observability
- [ ] PostHog SDK installed (web + server)
- [ ] Sentry day-1: `@sentry/nextjs` installed, wrap Edge Functions, env `SENTRY_DSN`/`SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`

### 1.7 Test Stack
- [ ] Vitest installed (unit tests, same tsconfig)
- [ ] Playwright installed — projects: chromium + webkit
- [ ] CI workflow: lint → typecheck → vitest → playwright
- [ ] agent-browser installed for nightly cron (`cargo install agent-browser` or `npm i -g agent-browser`)

### 1.8 Anonymous Trial Infrastructure
- [ ] `anonymous_attempts (id, fingerprint_hash, ip_hash, trend_id, attempted_at, completed bool)` table + indexes
- [ ] `@fingerprintjs/fingerprintjs` (open-source) integrated; SHA-256 hash before persist
- [ ] `/api/generate-anonymous` endpoint with Turnstile gate
- [ ] Global daily abuse budget: $20/day; on breach auto-disable anonymous, fall back to login-wall
- [ ] Anonymous result page TTL: 24h (pg_cron job purges unsaved)
- [ ] "Sign up to save + share" CTA on anonymous result page

### 1.9 Verification (must pass to mark phase 1 done)
- [ ] `INSERT into generations` with `free_used_this_week=5, credits_balance=0` → RLS rejects
- [ ] `INSERT into generations` with `credits_balance=1` → succeeds + trigger decrements
- [ ] Admin route blocked for non-admin user
- [ ] Audit log row created on admin action
- [ ] Stripe duplicate webhook → 1 credit grant only
- [ ] Anonymous endpoint: 2nd attempt from same fingerprint+IP → rejected with "sign up to continue"
- [ ] Abuse budget breach simulation → anonymous endpoint returns 503
- [ ] Sentry test event fires from both Next API route + Edge Function

---

## Phase 2 — Trends + Admin (3–4 days)

- [ ] Admin trends CRUD route (`/admin/trends`)
- [ ] `SchemaBuilder` component — drag fields, set required, min/max counts
- [ ] Trend create form persists `input_schema jsonb`
- [ ] `prompt_template` interpolates `{{field_name}}` from schema
- [ ] `prompt_template_history` array appended on edit; admin "revert" button
- [ ] Eval workflow
  - [ ] Upload eval reference photos to `trend_eval_inputs`
  - [ ] "Test trend" button runs prompt × all eval inputs in parallel (8 concurrent)
  - [ ] Eval grid UI shows outputs
  - [ ] Admin marks pass/fail → `eval_status` updated
  - [ ] Re-run triggered on `prompt_template` or `model` change
- [ ] Public home grid lists `is_active=true` trends
- [ ] `/trend/[slug]` SSR page with:
  - [ ] OG image via `@vercel/og` (sample after-image + title)
  - [ ] JSON-LD `HowTo` schema
  - [ ] FAQ block from `trends.faq`
  - [ ] Sample gallery placeholder
- [ ] `/sitemap.xml` lists active trends with `lastmod`
- [ ] `/robots.txt` allows crawl, blocks `/admin/*` + `/result/*`
- [ ] ISR: `revalidate: 3600`
- [ ] Verification: `curl /trend/<slug>` returns full HTML + meta + JSON-LD; eval gate blocks publish

---

## Phase 3 — Core Generation (4–5 days)

- [ ] `SchemaForm` component renders dynamically from `trends.input_schema`
- [ ] Client-side: heic2any → JPEG, resize ≤ 2048px, Zod validate
- [ ] Multi-image upload to Supabase Storage (signed URLs)
- [ ] `/api/generate`:
  - [ ] Accepts `Idempotency-Key` header
  - [ ] RLS quota check (DB-enforced)
  - [ ] Inserts `generations` row (status=`pending`)
  - [ ] Per-IP rate limit (Upstash or in-memory LRU) — 20/hr
  - [ ] Returns `generation_id` for Realtime subscribe
- [ ] Edge Function `generate-image`:
  - [ ] Triggered by DB webhook on `generations` insert
  - [ ] 110s soft wall-time cap; 90s Gemini timeout
  - [ ] Gemini call w/ template interpolation + safetySettings
  - [ ] Record `cost_usd`
  - [ ] On success: upload result to Storage, update row to `completed`
  - [ ] On Gemini moderation reject: status=`failed`, refund quota, friendly message
  - [ ] On transient error: status=`failed_retryable`, `attempts++`
  - [ ] After 3 attempts: terminal `failed`, refund quota
- [ ] Result page `/result/[id]`:
  - [ ] Realtime subscription
  - [ ] Retry button (re-uses idempotency key, no quota rededuct)
  - [ ] Loading + completed + failed states
- [ ] Web Push:
  - [ ] VAPID env-stored
  - [ ] Service worker registered silent on first visit
  - [ ] Permission asked AFTER first successful generation completes
  - [ ] iOS Safari detect → "Add to Home Screen" hint
  - [ ] Push send from Edge Function on completion
- [ ] Email fallback via Resend if no push subscription
- [ ] Verification: idempotency replay (1 row, 1 call), retry path, refund on fail, push fires <1s, email fallback <30s

---

## Phase 4 — Virality + Polish (3 days)

- [ ] Download composer — corner-tag watermark (free tier), no-watermark (Pro)
- [ ] Web Share API integration; fallback copy-link + IG/TikTok deep links
- [ ] Referral system:
  - [ ] `referral_code` displayed in profile
  - [ ] Signup with `?ref=` populates `referred_by`
  - [ ] `referrals` row created
  - [ ] Reward credited ONLY after referee's first completed generation
  - [ ] Max bonus cap per referrer = 50 credits (5 referrals × 10)
  - [ ] Turnstile on signup
- [ ] `/me/creations` history grid
- [ ] `/me/settings` — soft-delete account + data export (zip of generations + profile.json)
- [ ] PostHog events: `trend_view`, `upload_started`, `generate_clicked`, `generate_completed`, `share_clicked`, `referral_redeemed`
- [ ] pg_cron daily job: delete `generations` where `purge_at < now()` + Storage objects
- [ ] pg_cron weekly job: reset `free_used_this_week = 0`, bump `free_week_starts_at` (Sunday 00:00 UTC)
- [ ] pg_cron daily job: purge anonymous result rows where `created_at < now() - 24h` AND not saved
- [ ] Anomaly alert: PostHog funnel if user spikes >5 gens/hr
- [ ] Verification: referral farming guard, GDPR delete cascades, pg_cron purge runs

---

## Phase 5 — Payments (when traction visible)

- [ ] Stripe Checkout credit packs ($4.99=50, $14.99=200, $39.99=600 — final)
- [ ] Webhook idempotency via `webhook_events.event_id`
- [ ] `checkout.session.completed` → credit grant
- [ ] Support refund flow (manual credit grant via admin route)
- [ ] Daily margin dashboard from `generations.cost_usd` vs revenue
- [ ] Gemini billing alerts (2 tiers)
- [ ] Verification: duplicate webhook → 1 grant only; refund flow works

---

## Phase 6 — Auto Trend Detector (post-MVP)

- [ ] Polling worker (cron Edge Function) for TikTok/IG/Reddit trending
- [ ] LLM proposer (Gemini for cost) — drafts prompt template
- [ ] Inserts `trend_suggestions` with `source='auto'`
- [ ] Admin inbox `/admin/suggestions` for review + approve→draft trend

---

## Review Section

_(populate at end of each phase)_

### Phase 0 review
- _pending_

### Phase 1 review
- _pending_

---

## Risks Actively Monitored

(from amended plan §"Future Issues, Risks & Mitigations" — Critical tier)

- [ ] Viral deepfake/abuse — mitigation: Gemini safety + 1-click trend banlist + audit log
- [ ] Stripe disputes for low-quality output — mitigation: ToS clause + free re-roll + support credit refund
- [ ] Gemini API price hike — mitigation: per-trend model field + cost tracking
- [ ] Edge Function 150s wall hit — mitigation: 110s soft cap + retry + p95 monitor
- [ ] Storage runaway — mitigation: 30d free purge + upload size cap + monthly alert
- [ ] GDPR delete request — mitigation: soft-delete + cascading purge + audit
- [ ] US sales tax thresholds — mitigation: monthly by-state gross tracker; revisit Lemon Squeezy if >5 states
