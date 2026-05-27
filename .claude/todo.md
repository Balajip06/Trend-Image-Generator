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
- [x] `pnpm dlx create-next-app@latest` — Next 16.2, App Router, TS strict, Tailwind v4, no src/ — scaffolded via `scaffold-tmp/` then merged (folder-name caps+space workaround)
- [ ] shadcn/ui init (deferred — primitives installed: clsx, tailwind-merge, cva, lucide; init when first component built)
- [x] ESLint 9 (flat config from create-next-app) + Prettier 3 with tailwind plugin
- [x] Strict TS (tsconfig from scaffold; `pnpm typecheck` clean)
- [x] pnpm chosen + `pnpm-workspace.yaml` present
- [x] Git initial commit `ff8f84a` — feat: phase 1 foundation scaffold

### 1.2 Supabase
- [ ] Supabase project created (US-East region for global latency balance) — **BLOCKED on user-created project**
- [x] `pnpm supabase init` local (config.toml + .gitignore + .temp/ created)
- [x] Migration 0001: profiles — with credits_balance, free_used_this_week, free_week_starts_at, referral_code, referred_by, bonus_credits_earned cap=50, push_subscription, deleted_at, auto-create-on-signup trigger, RLS self-read/self-update
- [x] Migration 0002: trends — input_schema JSONB default, prompt_template_history + version-bump trigger (forces re-eval), expires_at, eval_status enum + eval_gate constraint, SEO columns, public-read RLS (active + not-expired)
- [x] Migration 0003: generations — idempotency_key (user_id, key) unique, cost_usd, trend_version snapshot, purge_at (tier-aware trigger), is_public, share_count, quota consume + refund triggers, RLS own+public
- [x] Migration 0004: referrals + farming-guarded reward trigger (fires after referee's first completed gen, caps bonus at 50), trend_eval_inputs, trend_eval_runs, trend_suggestions, admin_audit_log, webhook_events (Stripe dedup), anonymous_attempts (fingerprint+IP unique, 24h TTL)
- [x] Migration 0005: pg_cron — weekly free reset (Sun 00:00 UTC), daily purges (generations, anonymous, soft-deleted profiles)
- [x] RLS policies — quota block via trigger raise_exception, public gallery gate, soft-delete cascade via deleted_at filter
- [x] DB trigger — credits_balance/free_used_this_week consume on insert, refund on failure, version bump on prompt change
- [x] DB constraint — `is_active=true` requires `eval_status='passed'`
- [ ] **Apply migrations** to local Supabase (`pnpm supabase start && pnpm supabase db reset`) — blocked on Docker Desktop running locally OR remote project linked
- [ ] Generated TS types committed (`pnpm supabase:types` after apply)
- [ ] Admin audit-log trigger (deferred — implement when admin CRUD lands in Phase 2)

### 1.3 Auth
- [ ] Google OAuth provider configured in Supabase dashboard — **BLOCKED on Supabase project**
- [x] Magic-link email via `signInWithOtp` wired (uses Supabase default SMTP until Resend domain verified; Resend SMTP override later)
- [x] `(auth)` route group + login UI — Google + magic-link forms with server actions, `?next=` redirect threading, banners
- [x] `app/auth/callback/route.ts` — OAuth code → session exchange + redirect
- [x] Proxy (Next 16 middleware rename) gates `/admin`, `/me`, `/result` with `auth.uid()` + admin_users lookup
- [x] Profile auto-create trigger (`auth.users` insert → `profiles` insert with email + name + avatar_url + auto-gen referral_code) — in migration 0001
- [x] `referral_code` auto-generated on profile create — `encode(gen_random_bytes(6), 'hex')` default

### 1.4 Admin Gating
- [ ] `admin_users` table seeded with own user_id — **BLOCKED on Supabase project + first sign-in to know own auth.uid**
- [x] `/admin` proxy checks admin_users with redirect to `/` when missing
- [ ] Audit-log trigger writes to `admin_audit_log` on admin actions — deferred to Phase 2 when admin CRUD lands

### 1.5 Stripe Test Mode
- [x] Stripe SDK installed (`stripe@^22`)
- [ ] Test products created (credit packs) — **BLOCKED on Stripe account**
- [x] Webhook endpoint `/api/stripe/webhook` stub — runtime=nodejs, raw-body signature verify, idempotent insert into webhook_events, 503 when secret absent
- [ ] `webhook_events` idempotency table tested with duplicate event — needs Stripe CLI + test mode; integration test in Phase 1.9 Verification

### 1.6 Observability
- [x] PostHog SDK installed (posthog-js + posthog-node)
- [x] Sentry SDK installed (@sentry/nextjs v10)
- [x] PostHog provider component wired in `app/layout.tsx`; pageview tracking via usePathname + useSearchParams; env-driven no-op when key absent
- [x] Sentry config files (sentry.client/server/edge.config.ts) + `instrumentation.ts` registering per-runtime + `next.config.ts` wrapped with `withSentryConfig` (gated on DSN + auth token + prod) — env-driven no-op when DSN absent
- [ ] PostHog `identify` calls on signup/login + custom events: `trend_view`, `upload_started`, `generate_clicked`, `generate_completed`, `share_clicked`, `referral_redeemed` — wired during Phase 2-4 as features land
- [ ] Sentry source-map upload tested in production deploy — needs SENTRY_AUTH_TOKEN

### 1.7 Test Stack
- [x] Vitest installed + config (jsdom, 80% coverage threshold) — first smoke `lib/utils/cn.test.ts` (3/3 pass)
- [x] @testing-library/react + jest-dom matchers wired in vitest.setup.ts
- [x] Playwright installed + config (chromium, webkit, mobile-chrome, mobile-safari projects; webServer = pnpm dev) — first smoke `e2e/home.spec.ts` (heading + tagline + title)
- [x] Browser binaries downloaded (chromium-1223, webkit) — local cache `%USERPROFILE%\AppData\Local\ms-playwright`
- [x] CI workflow (`.github/workflows/ci.yml`): static (lint+format+typecheck) → unit (vitest + coverage artifact) → e2e (playwright with chromium+webkit, report artifact on failure)
- [ ] agent-browser installed for nightly cron — deferred until MVP launch (Phase 4 polish)

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

**Phase 2 prep complete (no creds needed):**
- [x] `lib/trends/input-schema.ts` — Zod discriminated union (image|text|select), DEFAULT_TREND_INPUT matches migration 0002
- [x] `lib/trends/interpolate.ts` + tests — `{{field_name}}` substitution (12 cases, all pass)
- [x] `lib/trends/repository.ts` — `listActiveTrends`, `getActiveTrendBySlug` with safe schema coercion
- [x] `components/upload/SchemaForm.tsx` — client component rendering any TrendInput with per-field validation
- [x] `lib/seo/json-ld.ts` + tests — `buildHowToJsonLd`, `buildFAQJsonLd`
- [x] `app/(public)/trend/[slug]/page.tsx` — SSR + ISR(3600) + async generateMetadata (OG + Twitter) + JSON-LD scripts + notFound()
- [x] `app/(public)/trend/[slug]/opengraph-image.tsx` — Next 16 OG convention (1200x630 PNG)
- [x] `app/sitemap.ts` — dynamic, hourly revalidate
- [x] `app/robots.ts` — allow public, disallow `/admin/*` `/result/*` `/me/*` `/api/`

**Phase 2 implementation (blocked on Supabase running):**
- [ ] Admin trends CRUD route (`/admin/trends`) — list + create + edit + activate
- [ ] `SchemaBuilder` admin component — drag fields, set required, min/max counts (dnd-kit)
- [ ] Trend create form persists `input_schema jsonb` (write side; read side ready)
- [ ] `prompt_template_history` revert button in admin (DB trigger already appends on edit — see migration 0002)
- [ ] Eval workflow
  - [ ] Upload eval reference photos to `trend_eval_inputs` (admin-side)
  - [ ] "Test trend" button runs prompt × all eval inputs in parallel (8 concurrent)
  - [ ] Eval grid UI shows outputs
  - [ ] Admin marks pass/fail → `eval_status` updated
  - [ ] Re-run triggered on `prompt_template` or `model` change (DB trigger already forces `eval_status='untested'` + `is_active=false` on change)
- [ ] Public home grid lists `is_active=true` trends (replace placeholder `app/page.tsx`, move into `(public)`)
- [ ] Sample gallery placeholder under trend page (Phase 4 if public-gallery opt-in lands)
- [ ] Wire SchemaForm into `/trend/[slug]/page.tsx` (Phase 3 — needs `/api/generate` first)
- [ ] Verification: `curl /trend/<slug>` returns full HTML + meta + JSON-LD; eval gate blocks publish (DB constraint already in 0002)

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
