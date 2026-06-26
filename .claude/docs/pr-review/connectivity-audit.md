# Admin Connectivity + Deployment-Readiness Audit

**Date:** 2026-06-26 · **Branch:** `feat/admin-connectivity-deploy-ready`
**Creds available:** Gemini API key + Supabase production. Stripe + the rest: deferred.

This documents the line-by-line review of the admin surface + supporting routes, the
defects found, and what was fixed. Gate after changes: `tsc` clean, ESLint clean,
**562/562 Vitest**, `next build` clean.

---

## Critical defects found + fixed

### 1. Admin reads returned wrong/empty data on a real (RLS-enforced) DB
Five admin pages read RLS-restricted tables with the **authed** client, which has no
admin-read policy on them — so they returned only the admin's own / active-only rows and
the mock fallback masked it (the "same data on every page" symptom).

| Page | Table | Old (authed) result | Fix |
| --- | --- | --- | --- |
| `trends/page.tsx` | `trends` | active-only (drafts hidden) | → service client |
| `engagement/page.tsx` | `trends` | active-only slugs | → service client |
| `margin/page.tsx` | `generations` | admin's own only | → service client |
| `users/page.tsx` | `profiles` | admin only (DAU≈1) | → service client |
| `referrals/page.tsx` | `referrals` | admin's own only | → service client |
| `page.tsx` (dashboard) | margin | inherited above | → service client |

The other 10 admin pages already used `createServiceClient()` and were correct. All admin
reads run behind the `proxy.ts` admin gate.

### 2. Admin trend WRITES were RLS-denied (couldn't create/edit/activate a trend at all)
`trends` has RLS enabled with only a read-only public policy and **no write policy**, yet
all six write-actions used the authed client → every INSERT/UPDATE denied. This blocked the
core "create a trend then activate" flow on any real DB (only worked in mock mode).
**Fix:** `createTrend`, `updateTrend`, `cloneTrend`, `toggleActive`, `toggleFeatured`,
`bumpOrder` now use the service client for DB ops; an authed lookup (`adminActorId()`)
supplies the audit actor id. Files: `app/admin/(authed)/trends/actions.ts`.

### 3. Mock data shown in production
`lib/analytics/margin.ts` + `lib/analytics/active-users.ts` + the referrals page returned
seed/demo data whenever tables were empty, regardless of environment. **Fix:** gated every
empty→mock branch behind `MOCKS_ALLOWED` (`NODE_ENV !== 'production'`, in `lib/dev/mock-data.ts`).
Production now renders real values / honest empty states; the margin "Demo data" toggle is
dev-only. Stale "runs on demo data" copy on margin + users pages corrected.

---

## Feature changes

- **Suggestions removed** (admin section + dashboard KPI/tile + nav). Discovery cron route
  returns 410 and its Vercel cron entry was deleted. The `trend_suggestions` table, the
  public `/submit-trend` page, and the orchestrator/proposer libs are left **dormant**
  (per owner: "admin section only"). NOTE: `/submit-trend` submissions now accumulate with
  no review UI — revisit if user submissions are wanted.
- **Admin menu redesign** (`AdminShell.tsx`): 6 reorganized collapsible groups
  (Overview / Catalogue / Growth / Revenue / Access / System), collapse state persisted to
  `localStorage`, live count badges (untested trends, in-flight generations) fed from the
  layout via service client, refined active/hover/focus states.
- **Streamlined trend test → go live** (`/admin/trends/[id]/eval`): upload a test photo
  (`EvalUploadForm` → `uploads` bucket, signed URL) → Run Test (real Gemini) → review →
  one-click **Approve & Go Live** (`approveAndGoLive` marks the run pass + sets
  `eval_status='passed'` + `is_active=true`; DB proof trigger + eval-gate constraint both
  satisfied) + Deactivate. Per-row rating retained as optional.
- **Pricing Stripe-graceful**: `/api/stripe/checkout` returns a clean 503 "billing not
  available" when `STRIPE_SECRET_KEY` is absent (no leaky 500); `/me/settings` renders a
  "Credits & plans — coming soon" card instead of dead buy buttons.

## Test fixes
- `eval/actions.test.ts`: the 2 pre-existing `runEval` failures were stale fixtures using a
  non-`uploads` URL (the SSRF guard `assertStorageUrl` was added after the test). Updated to
  a valid uploads URL + set `NEXT_PUBLIC_SUPABASE_URL`. Now 15/15.
- `AdminShell.test.tsx`: updated for the redesign (collapse + badges); `localStorage.clear()`
  between tests.

---

## Route status (✅ verified wired · ⚠️ dependency-gated · ➖ dormant)

**Consumer:** `/`, `/trend/[slug]`, `/result/[id]`, `/me/{studio,creations,settings}`, `/login`,
`/terms`, `/privacy`, sitemap/robots/manifest — ✅ (repository reads via `trends_public_read`
RLS; correct). `/me/settings` billing ⚠️ Stripe-gated (clean coming-soon).

**Generate pipeline:** `/api/generate` → DB webhook → Edge Function `generate-image` → Gemini —
✅ code-wired + idempotent + RLS quota. Requires `GEMINI_API_KEY` set in **both** Vercel and
Supabase Edge secrets + the DB webhook configured (see deployment checklist).

**Admin (13, Suggestions removed):** all ✅ after fixes 1–3.

**API:** `download/[id]`, `me/export`, `push/{subscribe,dispatch}`, `track`, `health`,
`analytics/referral`, `auth/kimp/*`, `generate-anonymous` — ✅. `stripe/*` — ⚠️ Stripe-gated.
`admin/run-trend-discovery` — ➖ disabled (410).

**KIMP free access:** OIDC login + `kimp_unlimited` + quota bypass — ✅ unchanged. Net-new
programmatic API: deferred (owner to spec; will follow the AI-Tool-Suite `x-auth` pattern).

## Known follow-ups (not blocking)
- Local-file upload exists for eval; consider the same for customer trends if pasted URLs surface.
- `/submit-trend` orphaned (no review UI) — decide keep vs remove.
- Engagement home-grid impressions: only `/trend/[slug]` emits today (documented in deploy checklist).
