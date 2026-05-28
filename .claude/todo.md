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
- [x] Public home grid lists `is_active=true` trends — `app/(public)/page.tsx` shipped (RSC + ISR 600s + responsive 2/3/4-col)
- [ ] Sample gallery placeholder under trend page (Phase 4 if public-gallery opt-in lands)
- [ ] Wire SchemaForm into `/trend/[slug]/page.tsx` (Phase 3 — needs `/api/generate` first)
- [ ] Verification: `curl /trend/<slug>` returns full HTML + meta + JSON-LD; eval gate blocks publish (DB constraint already in 0002)

---

## Phase 3 — Core Generation (4–5 days)

**Phase 3 prep complete (no creds needed):**
- [x] `SchemaForm` renders any TrendInput (shipped Phase 2 prep)
- [x] `lib/utils/image.ts` — HEIC/HEIF detect → heic2any dynamic-import → JPEG; createImageBitmap + OffscreenCanvas resize to longest-side ≤ 2048; quality 0.9
- [x] `lib/idempotency.ts` — `generateIdempotencyKey` + `parseIdempotencyKey` w/ 16-128 char [A-Za-z0-9_-] grammar (9 test cases)
- [x] `lib/gemini/cost.ts` — per-output USD map (nano-banana 0.0039, nano-banana-pro 0.024) + anonymous budget guard
- [x] `lib/gemini/client.ts` — `generateImage` with mock-mode fallback (no key), 90s AbortController timeout, all 4 safetySettings at MEDIUM, taxonomy: safety / timeout / transient / invalid; base64 codec works in Node + Edge runtimes
- [x] `lib/push/send.ts` — `sendPush` with lazy VAPID configure, classifies 404/410 as expired
- [x] `lib/email/send.ts` — Resend wrapper + `buildResultReadyEmail` template (html-escapes user content)
- [x] `app/api/generate/route.ts` — Node runtime: idempotency parse → rate-limit per IP → auth gate → Zod body → trend lookup → input_schema re-validate → `interpolatePrompt` + `collectImageInputs` → insert generations row (quota trigger) → duplicate-key replay returns `{ generation_id, replayed: true }` → quota-exhausted maps HTTP 402
- [x] `public/sw.js` — push event → showNotification; notificationclick → focus existing client or open window

**Phase 3 implementation (mostly landed; rest blocked on creds):**
- [x] Wire `SchemaForm` into `app/(public)/trend/[slug]/page.tsx` — `TrendUpload` client component handles HEIC→JPEG, resize, Storage upload, signed-URL, POST `/api/generate`, router push to `/result/[id]`
- [x] Multi-image upload to Supabase Storage with signed URLs (1h TTL via `createSignedUrl`)
- [x] Public home grid `app/(public)/page.tsx` replacing placeholder `app/page.tsx` (RSC + ISR 600s + responsive 2/3/4-col)
- [x] **Edge Function `supabase/functions/generate-image/index.ts`** — Deno handler shipped:
  - [x] Service-role bearer auth, parses webhook payload, conditional UPDATE pending→processing (claim row + dedup retries)
  - [x] 90s Gemini timeout via AbortController; outer wall-time guard 110s
  - [x] Records `cost_usd` from in-file COST_USD map (mirror of lib/gemini/cost.ts)
  - [x] Uploads PNG → `outputs/{user_id}/{gen_id}.png`, marks `completed` with `output_image_url + cost_usd + model_used + completed_at`
  - [x] On Gemini moderation → terminal `failed` (refund trigger fires)
  - [x] On timeout / transient / upload err → `failed_retryable` + `attempts++`
  - [x] After 3 attempts → terminal `failed` (refund)
- [x] **Storage buckets + RLS** — migration `20260528000002_storage_buckets.sql` (uploads private self-folder, outputs public-read + service-role write)
- [x] **Result page `/result/[id]`**:
  - [x] Server shell auth-gates + initial row fetch + 404 on not-own
  - [x] ResultView client component: Realtime postgres_changes subscribe filtered `id=eq.<id>`, exits subscription when terminal
  - [x] Retry button reuses original Idempotency-Key (duplicate-key replay path, no quota rededuct)
  - [x] Pills for pending / processing / completed / failed_retryable (shows attempts) / failed; download button on completed
- [x] Web Push wiring:
  - [x] VAPID env template in `.env.local.example`
  - [x] Service worker file `/sw.js` exists
  - [x] `PushBootstrapper` registers SW in `app/(app)/layout.tsx` (silent, no prompt)
  - [x] Permission asked AFTER first successful generation completes — `ResultView` useEffect with `useRef` guard
  - [x] iOS Safari detect → "Add to Home Screen" hint surfaced under result
  - [x] Push send from Edge Function on completion → `dispatchNotification` → `/api/push/dispatch` → `lib/push/send.ts`
  - [x] `/api/push/subscribe` persists subscription in `profiles.push_subscription`; auto-clears on 404/410
- [x] Email fallback via `buildResultReadyEmail` when push subscription null OR push send 404/410-expired (in `/api/push/dispatch`)
- [ ] User-side: deploy Edge Function (`pnpm supabase functions deploy generate-image --no-verify-jwt`) + set `GEMINI_API_KEY` secret + configure Database Webhook
- [ ] Verification: idempotency replay (1 row, 1 call), retry path, refund on fail, push fires <1s, email fallback <30s

---

## Phase 4 — Virality + Polish (3 days)

**Phase 4 prep complete (no creds needed):**
- [x] `lib/watermark/compose.ts` + test — sharp-based corner-tag overlay, font size scales with longest side, opacity 0.85, XML-escaped wordmark, output dimensions preserved
- [x] `lib/share/web-share.ts` + test — `shareNative` (web-share-files preferred, url-only fallback, AbortError-as-cancelled), Twitter + WhatsApp URL builders, IG + TikTok deep-link constants, `copyToClipboard` fallback
- [x] `lib/referrals/links.ts` + test — `buildReferralUrl` (12-hex code validation), `parseReferralFromUrl`, `parseReferralFromCookie`, `REFERRAL_COOKIE_NAME='tig_ref'` + `REFERRAL_COOKIE_MAX_AGE_SECONDS=30d`
- [x] `lib/analytics/events.ts` — typed PostHog event catalog (15 events) + payload interfaces + generic `track<E>()` helper
- [x] `app/(app)/layout.tsx` — authed-area shell with header nav (creations + settings)
- [x] `app/(app)/me/creations/page.tsx` — RSC, force-dynamic, queries 60 most-recent generations, grid layout
- [x] `app/(app)/me/settings/page.tsx` — RSC, quota panel, referral link via `buildReferralUrl`, soft-delete server action (`profiles.deleted_at = now()` + `signOut` + redirect home)
- [x] `app/api/download/[id]/route.ts` — Node runtime authed download: ownership check, status gate, Pro vs Free determines watermark via `applyWatermark`, content-disposition attachment streaming

**Phase 4 implementation (blocked on Supabase running + PostHog key + Turnstile key):**
- [ ] Referral signup wiring:
  - [ ] Landing page sets `tig_ref` cookie when `?ref=<code>` present
  - [ ] Signup server action reads cookie, populates `profiles.referred_by`, creates `referrals` row
  - [x] Reward credited via trigger after referee's first completed gen (migration 0004)
  - [x] Max bonus cap per referrer = 50 (DB constraint + trigger)
  - [ ] Turnstile on signup — needs `TURNSTILE_SITE_KEY`
- [x] PostHog provider component + bind to `lib/analytics/client.ts` singleton on mount
- [x] Client `track()` call sites: UPLOAD_STARTED, GENERATE_CLICKED, GENERATE_COMPLETED, GENERATE_FAILED, PUSH_PERMISSION_REQUESTED/GRANTED/DENIED, DOWNLOAD_CLICKED (9 of 15 events)
- [ ] Server-side `track()` for SIGNUP_COMPLETED, ACCOUNT_DELETED, REFERRAL_REDEEMED, CHECKOUT_STARTED/COMPLETED — needs posthog-node identify-and-capture wrapper
- [x] SHARE_CLICKED — `ShareButtons` on `ResultView`: native Web Share with image-Blob attachment, X/Twitter intent, WhatsApp wa.me, Copy link; fires per-channel
- [x] TREND_VIEW — posthog-js `$pageview` auto-capture in `posthog-provider.tsx`
- [ ] Data export server action on settings — JSON zip of (profile + generations rows + presigned URLs)
- [x] pg_cron daily/weekly jobs — already in migration 0005
- [ ] Anomaly alert: PostHog funnel if user spikes >5 gens/hr (post-launch)
- [ ] Verification: referral farming guard, GDPR delete cascades, pg_cron purge runs

---

## Phase 5 — Payments (when traction visible)

**Phase 5 prep complete (no creds needed):**
- [x] `lib/payments/packs.ts` + test — `CREDIT_PACKS` catalog ($4.99=50 small, $14.99=200 medium, $39.99=600 large), `findPack`, `isPackId`, `requirePackPriceId` (throws on missing env)
- [x] `lib/payments/credits.ts` — `grantCredits(supabase, {userId, amount, source, sourceRef})` wrapping the SQL function via `supabase.rpc`
- [x] `supabase/migrations/20260528000001_grant_credits.sql` — `SECURITY DEFINER grant_credits(uuid, int, text, text)`: validates amount>0, skips soft-deleted profiles, writes `admin_audit_log` row; execute granted only to `service_role`
- [x] `app/api/stripe/checkout/route.ts` — authed Node route; `Stripe.checkout.sessions.create` with `client_reference_id` + metadata `{user_id, pack_id, credits}` (portable across test/prod price ids)
- [x] `app/api/stripe/webhook/route.ts` — full dispatcher: idempotency gate via `webhook_events` insert (duplicate-key short-circuit), `handleEvent` switch, `handleCheckoutCompleted` extracts metadata + calls `grantCredits`, `processed_at` stamped on success, throw→500→Stripe retry
- [x] `.env.local.example` + `lib/env.ts` — `STRIPE_PRICE_ID_SMALL/MEDIUM/LARGE` slots

**Phase 5 implementation (blocked on Stripe account):**
- [ ] Create 3 Stripe products + recurring=false prices in test mode, paste IDs into `.env.local`
- [ ] Configure Stripe webhook → `/api/stripe/webhook` w/ signing secret in `STRIPE_WEBHOOK_SECRET`
- [ ] Settings/checkout UI surface (button on `/me/settings` → POST `/api/stripe/checkout` → window.location = checkout_url)
- [ ] Support refund flow — manual credit grant admin route (depends on Phase 2 admin CRUD)
- [ ] Daily margin dashboard — query `SUM(generations.cost_usd)` vs `SUM(payments)` (post-launch)
- [ ] Gemini billing alerts (2 tiers — set in Google Cloud Console)
- [ ] Verification: duplicate webhook → 1 grant only; refund flow works

---

## Phase 6 — Auto Trend Detector (post-MVP)

**Phase 6 prep complete (no creds needed):**
- [x] `lib/trends/sources/types.ts` — common `TrendCandidate` + `SourceFetcher` interfaces
- [x] `lib/trends/sources/tiktok.ts` — stub returning `[]` until `TIKTOK_CREATIVE_CENTER_KEY` set
- [x] `lib/trends/sources/instagram.ts` — stub returning `[]` until `INSTAGRAM_SESSION_COOKIE` set
- [x] `lib/trends/sources/reddit.ts` — working fetcher (public JSON, no auth) polling 5 subs, momentum = upvotes/hour
- [x] `lib/trends/suggestions/payload.ts` + test — Zod discriminated union (`auto` vs `user`) for `trend_suggestions.payload` JSONB; AutoSuggestionPayload reuses `TrendInputSchema` for proposed input_schema
- [x] `lib/trends/proposer.ts` + test — `Proposer` interface + `mockProposer` (deterministic stub); `getProposer()` returns mock when `GEMINI_API_KEY` absent; `slugify` helper exported
- [x] `lib/trends/orchestrator.ts` — `runTrendDetector(supabase, options)`: parallel source fetch, dedup vs pending rows by `source:external_id`, proposer call per fresh candidate, insert with `source='auto'`, returns `{fetched, deduped, proposed, inserted, errors}` for cron observability
- [x] `app/admin/suggestions/page.tsx` — RSC inbox skeleton, parses payload via `safeParse` (red warning on parse-fail rows), shows momentum + confidence + source link for auto entries

**Phase 6 implementation (blocked on Supabase + Gemini + admin CRUD + creds):**
- [ ] Real TikTok fetcher (TikTok Creative Center API + business account)
- [ ] Real Instagram fetcher (Playwright + rotating proxies — grey area)
- [ ] Real Gemini-Flash proposer (structured JSON output mirroring `TrendInputSchema`)
- [ ] Approve / Reject server actions in `app/admin/suggestions/page.tsx`
  - [ ] Approve → drafts a `trends` row from the proposal, marks suggestion `approved`, links by id, redirects to `/admin/trends/<new_id>/edit`
  - [ ] Reject → marks `rejected` + archives
- [ ] Supabase pg_cron daily job calling `runTrendDetector` via a Postgres function or webhook
- [ ] Manual "Scan for trends" admin button → POST endpoint → orchestrator

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
