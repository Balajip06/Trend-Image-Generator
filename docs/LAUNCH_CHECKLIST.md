# Trendly — Launch Checklist (Pre-Production)

Single-pass swap list of every placeholder string, hardcoded mock, empty
env var, and dev-only flag that needs to be set before the site goes
live. Each item lists: where it lives, what to change it to, and what
breaks if missed.

Cross-references:
- [docs/RUNBOOK.md](./RUNBOOK.md) — env-var origin + 14-test verification matrix
- [docs/CREDENTIALS.md](./CREDENTIALS.md) — per-var origin + degradation behavior

This doc is a list, not a patch. Code changes happen in a separate pass.

---

## Brand identity

### Wordmark "Trendly" + gradient ^ glyph

**Currently:** "Trendly" + pink→orange→gold gradient `^` glyph
(`components/brand/Logo.tsx:51`). The name + glyph predate any
brand-naming decision and were chosen as a working title in early
sessions.

**Decision needed:** confirm "Trendly" is the launch name. If not,
swap every touch point below in one pass. If yes, the only blocker
becomes domain registration (see "Domain + URLs" below) — `trendly.app`
referenced in `lib/utils/export.ts:85` + `docs/CREDENTIALS.md:17`
implies that's the intended TLD but it's not registered yet.

**Touch points** (every spot that hardcodes the wordmark):
- `components/brand/Logo.tsx:51` — single source for header/footer glyph
- `app/layout.tsx:19` — root `<title>` metadata
- `app/(public)/layout.tsx:12,37` — public header `aria-label` + footer copyright
- `app/(app)/layout.tsx:15` — authed header `aria-label`
- `app/(public)/trend/[slug]/page.tsx:45` — SEO `<title>` fallback `"${title} — Trendly"`
- `app/(public)/trend/[slug]/opengraph-image.tsx:7,21,115` — OG card alt + wordmark literal
- `app/(public)/terms/page.tsx:5,6` — ToS metadata + description
- `app/(public)/privacy/page.tsx:5` — Privacy metadata
- `lib/dev/mock-data.ts:249` — `seo_title` template (dev-only, still leaks if MOCK_TRENDS ever flipped on in prod)
- `docs/TERMS_OF_SERVICE.md:1,11,15,29,35,43,51,63` (8 hits)
- `docs/PRIVACY_POLICY.md:1,11,98` (3 hits)
- `docs/RUNBOOK.md:152` — example `RESEND_FROM_EMAIL=Trendly <…>`
- `e2e/home.spec.ts:12` — `toHaveTitle(/Trendly/)` assertion (update or rebrand-proof)
- `components/brand/Logo.test.tsx:19,24,50,55,73,78` (6 hits) — test snapshots

**Breaks if missed:** brand consistency across header, footer, OG cards, page titles, legal documents, and email. If the launch name is not "Trendly", every social card and trend page will ship with the wrong wordmark.

---

## Contact emails

### Support email
**Currently:** `support@trendly.example` (explicit placeholder).
**Where:**
- `docs/TERMS_OF_SERVICE.md:98`
- `docs/PRIVACY_POLICY.md:11,120`

**Change to:** real `support@<real-domain>` once a real inbox exists.
**Breaks if missed:** user takedown requests, billing disputes, and privacy emails bounce. Legal contact unreachable — GDPR Article 12 violation risk.

### GDPR privacy contact (data export)
**Currently:** `privacy@trendly.app` is hardcoded in the GDPR Article 15 export payload.
**Where:** `lib/utils/export.ts:85`
**Change to:** real `privacy@<real-domain>` mailbox (or reuse support@).
**Breaks if missed:** users who download their data and email the listed address get bounces. Article 15 disclosure technically becomes invalid.

### Resend FROM email
**Currently:** `RESEND_FROM_EMAIL=` empty in `.env.local.example:29`.
**Where:** `lib/email/send.ts:32-33` (early-returns `{ ok: false }` when missing).
**Change to:** `Trendly <noreply@<real-domain>>` after Resend domain DNS records (SPF + DKIM + DMARC) verify.
**Breaks if missed:** every result-ready email fallback short-circuits silently. Users with disabled / expired push subscriptions get no notification at all when their image finishes.

### VAPID subject
**Currently:** `VAPID_SUBJECT=mailto:you@example.com` template
default (`.env.local.example:35`). Falls back to
`mailto:noreply@example.com` at `lib/push/send.ts:15` if unset.
**Change to:** `mailto:owner@<real-domain>` — a real monitored inbox.
**Breaks if missed:** Web Push providers (FCM, Mozilla) de-prioritize or block pushes from senders with bogus contact addresses. Push deliverability silently drops.

### Login form email placeholder
**Currently:** `placeholder="you@example.com"` on the magic-link signup input.
**Where:** `app/(auth)/login/LoginForms.tsx:53`
**Change to:** keep as-is (UX placeholder, not a real address) — but
worth swapping to `you@<real-domain>` once `<real-domain>` is decided
for brand consistency.
**Risk:** LOW (cosmetic).

### Styleguide email placeholder
**Currently:** `placeholder="you@trendly.app"` in the internal /styleguide.
**Where:** `app/(dev)/styleguide/Sections.tsx:350`
**Note:** `/styleguide` body is excluded from prod bundle (commit `2f59467`). Cosmetic, dev-only.
**Risk:** LOW (never ships).

---

## Domain + URLs

### NEXT_PUBLIC_SITE_URL fallback
**Currently:** falls back to `http://localhost:3000` in 9 source files when env unset:
- `app/sitemap.ts:7`
- `app/robots.ts:4`
- `app/layout.tsx:21` (`metadataBase`)
- `app/api/stripe/checkout/route.ts:40` (Stripe success/cancel URLs)
- `app/api/push/dispatch/route.ts:78`
- `app/(auth)/login/actions.ts:32,50` (magic-link callback)
- `app/(app)/result/[id]/ShareBurst.tsx:28`
- `app/(public)/trend/[slug]/page.tsx:71` (canonical URL + JSON-LD)
- `app/(app)/me/settings/page.tsx:71`

**Change to:** set `NEXT_PUBLIC_SITE_URL=https://<real-domain>` in the production deploy env (Vercel project settings).
**Breaks if missed:** silently — every URL gets emitted as `http://localhost:3000/...`. Stripe magic-link callbacks redirect to localhost. Sitemap emits localhost URLs to Google. Open Graph cards link back to localhost. OG `metadataBase` is broken so social embeds 404.

### CI workflow env
**Currently:** `NEXT_PUBLIC_SITE_URL: http://localhost:3000` (`.github/workflows/ci.yml:14`).
**Note:** This is intentional — CI builds run in isolation. Don't change.

### Supabase URLs
**Currently:**
- `.env.local.example:11-13` — empty placeholders (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
- `.github/workflows/ci.yml:15-17` — uses `http://localhost:54321` + the strings `ci-anon-key-placeholder` and `ci-service-role-placeholder` so the build is hermetic. Intentional.
- `supabase/functions/generate-image/README.md:51` — `http://localhost:54321` in a curl example. Documentation, intentional.

**Change to:** set the three vars to the live Supabase project values in Vercel production env. Same vars exist locally in `.env.local` (real).
**Breaks if missed:** every Supabase client throws on init at startup — the entire app is dead on first request. Fail-loud, but only after deploy.

### example.com / yourdomain.com inside docs
**Currently:** `docs/RUNBOOK.md` references `https://<your-domain>` at L92, L122, L413, L428 — and `mailto:you@yourdomain.com` at L176. Template strings, not config.
**Change to:** once a real domain is registered, update the runbook in one pass so the verification scripts copy/paste-and-run.
**Risk:** LOW (docs only).

---

## Stripe

### Price IDs (one per credit pack)
**Currently:** `STRIPE_PRICE_ID_SMALL`, `STRIPE_PRICE_ID_MEDIUM`, `STRIPE_PRICE_ID_LARGE` all empty in `.env.local.example:23-25`.
**Change to:** live-mode `price_…` ids created via the Stripe Dashboard
flow (see `docs/CREDENTIALS.md:53-55` for the three product/price
recipes — $4.99/50, $14.99/200, $39.99/600).
**Validation:** `lib/payments/packs.ts:69-77` `requirePackPriceId()` throws on first checkout when missing. Fail-loud, OK.
**Breaks if missed:** every checkout fails with "STRIPE_PRICE_ID_X is not set — create the Stripe product + price for …".

### Webhook secret
**Currently:** `STRIPE_WEBHOOK_SECRET=` empty (`.env.local.example:20`).
**Change to:** live-mode webhook signing secret (`whsec_…`) from
Stripe Dashboard → Developers → Webhooks → endpoint
`https://<real-domain>/api/stripe/webhook` for event
`checkout.session.completed`.
**Breaks if missed:** `app/api/stripe/webhook/route.ts:18` returns 503; paid users never get credits — open ticket queue + chargebacks.

### Secret + publishable keys
**Currently:** `STRIPE_SECRET_KEY=` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=` empty.
**Change to:** live-mode keys.
**Breaks if missed:** checkout endpoint throws "STRIPE_SECRET_KEY missing"; no checkout sessions can be created.

---

## Sentry

### DSN + auth token + org + project
**Currently:** all five vars empty (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) in `.env.local.example:46-50`.
**Source-map upload guard:** `next.config.ts:33-46` runs `withSentryConfig` only when **all** of (`SENTRY_DSN` AND `SENTRY_AUTH_TOKEN` AND `NODE_ENV === 'production'`) are truthy. Empty `SENTRY_ORG`/`SENTRY_PROJECT` are tolerated by the guard (passed as `undefined` to the wrapper) — but the upload will silently fail to associate releases with the project.
**Change to:** fill all five vars in Vercel production env.
**Risk:** MEDIUM. Sentry will still capture errors with just `SENTRY_DSN` set, but source maps require all four upload vars. Without them, every stack trace shows minified frames.

---

## Push (VAPID)

### Key pair
**Currently:** `NEXT_PUBLIC_VAPID_PUBLIC_KEY=` + `VAPID_PRIVATE_KEY=` empty (`.env.local.example:33-34`).
**Change to:** generate once with `pnpm dlx web-push generate-vapid-keys --json`. Set both in Vercel prod env. **Never rotate** — every existing browser subscription would break.
**Breaks if missed:** `lib/push/client.ts` falls into `no_vapid_key` state; service worker registers but never subscribes; users get email fallback only (and email fallback is also broken without `RESEND_FROM_EMAIL`).

---

## Anti-bot (Cloudflare Turnstile)

### Site + secret keys
**Currently:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY=` + `TURNSTILE_SECRET_KEY=` empty (`.env.local.example:38-39`).
**Change to:** real Cloudflare widget keys.
**Breaks if missed:** `lib/turnstile/verify.ts` is a no-op pass-through; signup + anonymous-trial endpoints accept any submission — abuse vector wide open. `MEDIUM-HIGH` risk for prod launch.

---

## Rate limiting + abuse budget (Upstash)

### REST URL + token
**Currently:** `UPSTASH_REDIS_REST_URL=` + `UPSTASH_REDIS_REST_TOKEN=` empty (`.env.local.example:53-54`).
**Change to:** Upstash console REST URL + token.
**Breaks if missed:** `lib/rate-limit.ts:17` returns a no-op limiter. Per-IP rate limit + anonymous daily abuse budget both off. Anonymous trial costs uncapped.

---

## Seed data integrity

### Trend thumbnails (15 real DB trends)
**Currently:** `scripts/seed-trends.ts` + `scripts/seed-trends-more.ts` do **not** set `thumbnail_url` / `sample_after_url` / `sample_before_url` — those columns are `null` for every real trend in Supabase. Only the dev fixtures in `lib/dev/mock-data.ts:51-57` use the gradient placeholder SVGs at `public/mock/sample-{1..5}.svg`.

The trend page (`app/(public)/trend/[slug]/page.tsx:154-167`) falls
back to `bg-gradient-hero` when `sample_after_url` is null — so right
now every trend renders an abstract gradient instead of a real eval
output. Same fallback for the OG image at
`app/(public)/trend/[slug]/opengraph-image.tsx:36-37`.

**Change to:** generate one passing eval output per trend (use the admin /eval grid), upload to Supabase Storage `outputs` bucket public path, then update each row via the admin /edit page or one-off SQL `UPDATE`.
**Breaks if missed:** home grid + every `/trend/[slug]` page + every OG card ship with gradient placeholders. Conversion will tank — users can't tell what they're going to get.

### Trend prompts referencing named franchises
**Currently:** v2 prompts reference Stranger Things, Pixar, Studio Ghibli, MAPPA, LEGO, Funko, Wes Anderson productions etc. (15 trends, `scripts/seed-trends.ts` + `scripts/seed-trends-more.ts`).
**Status:** INTENTIONAL. `docs/TERMS_OF_SERVICE.md:43-47` declares the takedown protocol for franchise-IP holders. Personal-use clause at §3 caps liability. See `.claude/lessons.md` 2026-05-29 entry.
**Do not change** without legal review — these are launch-strategic, not placeholder.

### supabase/seed.sql
**Currently:** seeds one Ghibli trend + promotes `admin@example.com` to admin_users if present (`supabase/seed.sql:16`).
**Status:** local-dev only, runs on `supabase db reset`. Never executes against prod. Leave alone.

---

## Dev-mode flags (must be unset OR false in prod)

### MOCK_TRENDS
**Currently:** `MOCK_TRENDS=` empty in `.env.local.example:65`, but `MOCK_TRENDS=true` is documented in `.claude/session-log.md:42` as still set in the user's `.env.local`. Local `.env.local` is gitignored, but the value is what every `pnpm dev` actually reads.
**Bypass paths when true:**
- `lib/supabase/middleware.ts:9` — returns `NextResponse.next()` immediately, **skipping the entire auth + admin gate**. Anyone can reach `/admin/*`, `/me/*`, `/result/*`.
- `lib/trends/repository.ts:63,76` — returns hardcoded fixtures instead of querying Supabase.
- `app/(app)/me/settings/page.tsx:53`, `app/(app)/me/creations/page.tsx:32`, `app/(app)/result/[id]/page.tsx:39`, `app/api/me/export/route.ts:63` — branch into mock-fixture render paths.

**Change to:** unset (or `MOCK_TRENDS=false`) in production env. Verify by deploying to prod and confirming `/admin` redirects to `/login`.
**Breaks if missed:** **CRITICAL SECURITY HOLE**. Every authed and admin page is open without login. `proxy.ts` itself does not gate this — the gate lives in `lib/supabase/middleware.ts:9`, which `proxy.ts` invokes via `updateSession()`.

**Recommendation:** add an explicit `if (process.env.NODE_ENV === 'production' && process.env.MOCK_TRENDS === 'true')` startup check in `lib/env.ts` that **throws** at boot. Fail-loud is cheap insurance. (Not done in this audit — code-change-free per scope. Just flagged.)

### Mock fixtures (lib/dev/mock-data.ts)
**Currently:** `demo@trendly.dev` (line 24) + 15 trend fixtures + 4 generation fixtures. Only loaded when `MOCK_TRENDS=true`.
**Status:** dev-only, no leakage path **as long as MOCK_TRENDS is unset in prod**. Pair this audit with the MOCK_TRENDS gate above.

---

## Misc placeholders

### `next.config.ts` image remotePatterns
**Currently:** allows `*.supabase.co` + `images.unsplash.com` + `cdn.imgix.net`.
**Status:** intentional — narrowly scoped allowlist to prevent next/image from becoming an open proxy.
**Do not change** unless adding a new CDN host (re-deploy required).

### Reddit user agent (Phase 6, post-MVP)
**Currently:** default `TrendImageGenerator/0.1` at `lib/trends/sources/reddit.ts:41`.
**Status:** post-MVP, not on launch critical path.

---

## Final verification

Before DNS goes live, run the 14-test matrix in
[docs/RUNBOOK.md](./RUNBOOK.md) section "Verification". All 14 tests
must pass against the production deploy:
1. RLS quota block
2. Idempotency replay
3. Retry + refund
4. Schema-driven form
5. Eval gate
6. Push delivery
7. Email fallback (depends on RESEND_FROM_EMAIL fix)
8. SEO HTML
9. pg_cron purge
10. Referral farming guard
11. Stripe webhook dedup (depends on STRIPE_WEBHOOK_SECRET fix)
12. GDPR delete
13. PostHog funnel
14. Sitemap + robots

Do not promote DNS until all 14 tests pass on the prod deploy.

---

## Grep summary

Search commands run by this audit. Re-run after every change to spot regressions:

| Search | Files matched | Notes |
|---|---|---|
| `trendly\.example` | 3 (TERMS, PRIVACY x2) | All in docs; 0 in source. |
| `you@example\.com` | 3 (.env template, LoginForms placeholder, CREDENTIALS doc) | LoginForms is a UX placeholder — fine. |
| `Trendly` (across `.ts`/`.tsx`) | 14 source files | Wordmark is the centerpiece — see Brand identity above. |
| `localhost:3000` | 9 source fallbacks + CI workflow + README + 1 doc | All 9 source hits are env-fallback strings. |
| `localhost:54321` | CI workflow + 1 README example | Both intentional. |
| `example\.com` (broad) | 1 source (`lib/push/send.ts:15` fallback subject), 1 env template, plus many test fixtures | Test fixtures intentional; src fallback is a placeholder that should be a real `mailto:`. |
| `MOCK_TRENDS` | 26 hits across 17 files | Every read path traced — gated correctly **when flag is false**. Prod must unset. |
| `support@` | 3 (all in docs) | All explicit placeholders. |
| `trendly\.app` / `trendly\.com` / `trendly\.io` | 4 (one source: `lib/utils/export.ts:85`; one styleguide; one doc; one test) | Implies `trendly.app` is the intended TLD — not registered yet. |
| `yourdomain\.com` / `your-domain` | 5 doc placeholders | RUNBOOK template strings. |
| `sample-\d` | 1 source (`lib/dev/mock-data.ts`) | Mock-only. |
| `/mock/sample` | 1 file | Same. |
