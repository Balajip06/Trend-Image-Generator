# Deployment Checklist — Going Live with Gemini + Supabase Prod

Companion to [RUNBOOK.md](RUNBOOK.md). Covers exactly what to wire now that a **Gemini API key**
and a **Supabase production project** are available. Stripe and the rest stay deferred (the app
degrades gracefully without them).

> The generation pipeline is async: `/api/generate` inserts a `generations` row → Supabase DB
> webhook → Edge Function `generate-image` → Gemini → uploads PNG → marks complete. The Node path
> mock-falls-back without a key, but the **Edge Function errors if `GEMINI_API_KEY` is unset** — so
> the key must be set in **both** Vercel and Supabase.

## 1. Vercel environment variables (Production)

- [ ] `GEMINI_API_KEY` — real image generation + trend testing
- [ ] `NEXT_PUBLIC_SITE_URL` — canonical prod URL (OG, sitemap, push, Stripe redirects)
- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- [ ] **`TREND_EVENTS_BACKEND=supabase`** — without it, engagement/CTR uses an in-memory store and
      resets on every deploy
- [ ] `ADMIN_EMAILS`, `PREMIUM_EMAILS` — auto-grant admin / KIMP-unlimited on Google login
- [ ] Confirm `MOCK_TRENDS` is **unset** (mock mode must never run in prod)

## 2. Supabase Edge Function secrets + webhook

- [ ] `supabase secrets set GEMINI_API_KEY=…` (Edge Function reads its own copy)
- [ ] `supabase secrets set WEBHOOK_SECRET=…`
- [ ] Database webhook on `public.generations` **INSERT** → deployed `generate-image` function,
      sending `Authorization: Bearer <WEBHOOK_SECRET>` (must match the secret above)
- [ ] Deploy the function: `supabase functions deploy generate-image`

## 3. Database

- [ ] `supabase db push` (apply all migrations to prod)
- [ ] Seed launch trends: `scripts/seed-trends.ts` + `scripts/seed-trends-more.ts`
- [ ] `pnpm supabase:types` against live schema (drops the `as never` stub casts)
- [ ] Confirm storage buckets exist: `uploads` (private), `outputs` (public)

## 4. Auth

- [ ] Supabase Auth → URL config: add the prod `NEXT_PUBLIC_SITE_URL` to redirect allowlist
- [ ] Google OAuth provider enabled; `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` set as intended

## 5. Smoke test (post-deploy)

1. **Generation** — generate as a normal user → real (non-stub) PNG in `outputs`,
   `generations.status='completed'`, `cost_usd` recorded.
2. **Trend test → live** — `/admin/trends/new` → upload a test photo on the eval page → **Run Test**
   (real image) → **Approve & Go Live** → trend shows `passed` + active and appears on `/`.
   Deactivate → disappears for customers.
3. **Eval gate** — try activating an untested trend (DB blocks it); edit a live trend's prompt →
   it auto-deactivates (version bump).
4. **Admin data** — each admin page shows its own real/empty data (no identical demo numbers);
   no Suggestions entry; redesigned menu works on desktop + mobile.
5. **Engagement persists** — view a trend; confirm `trend_events` rows land and survive a redeploy.
6. **KIMP free access** — a `kimp_unlimited` user generates without consuming credits (tier `kimp`).
7. **Pricing** — `/me/settings` shows "Credits & plans — coming soon" (no dead buttons) until Stripe.

## Deferred (wire when creds arrive)

- **Stripe** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_PRICE_ID_SMALL/_MEDIUM/_LARGE`. Setting the secret flips billing on (checkout + the
  settings UI). See [CREDENTIALS.md](CREDENTIALS.md).
- **Resend / VAPID / Turnstile / PostHog / Sentry / Upstash** — each degrades gracefully when absent.
- **KIMP programmatic API** — deferred; will follow the AI-Tool-Suite `x-auth`/`xp-id` pattern.
