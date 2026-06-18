# MVP Ship Runbook

Step-by-step from "credentials arrived" to "MVP shipped". Pair with [`CREDENTIALS.md`](./CREDENTIALS.md) for env var reference.

Authority order on conflict: [amended plan](../../../.claude/plans/check-this-plan-c-users-balaj-projects-t-luminous-prism.md) → [`CLAUDE.md`](../CLAUDE.md) → this file.

Codebase state when this runbook starts: 30 routes across consumer (`/`, `/trend/[slug]`, `/result/[id]`, `/login`, `/me/{creations,settings}`), admin (`/admin/trends`, `/admin/trends/new`, `/admin/trends/[id]/{edit,eval}`, `/admin/suggestions`, `/admin/audit`), public legal (`/terms`, `/privacy`), and dev-only (`/styleguide` — `notFound()` + dynamic-import keep its body out of prod). Branch is `main`, remote is `origin/Balajip06/Trend-Image-Generator`.

---

## 1. Pre-flight (already done; re-verify)

Backend wiring is ~95% complete per `.claude/session-log.md`. Before bringing creds online, confirm:

```bash
# Repo clean + on main
git status
# Expected: "On branch main / nothing to commit, working tree clean"

# Supabase remote linked (commit 72a9dae)
pnpm supabase link --project-ref <your-ref>   # idempotent; reads supabase/.temp/project-ref

# All 7 migrations applied to the linked remote
pnpm supabase db push --linked
# Expected: "Remote database is up to date." (or list of applied migrations the first time)

pnpm supabase migration list --linked
# Expected: 7 rows, all with "applied at" timestamps for the migrations under supabase/migrations/

# Regenerate strict types
pnpm supabase:types
# Expected: lib/supabase/database.types.ts overwritten with concrete Database type

# 15 trends seeded (commits 2ef4af8 + 1803428 + v2 prompts in 0857b21)
pnpm dlx tsx scripts/seed-trends.ts
pnpm dlx tsx scripts/seed-trends-more.ts
# Expected: "upserted 15 / skipped 0" or similar idempotent output
```

Then confirm the static + test gates are green:

```bash
pnpm install            # exit 0
pnpm typecheck          # tsc --noEmit, exit 0
pnpm lint               # ESLint flat config, exit 0
pnpm test               # Vitest — 31 files / 283 tests. Current state: 278 passing.
                        # 5 reds in app/(app)/result/[id]/ShareBurst.test.tsx are
                        # a known post-redesign regression tracked under
                        # `.claude/todo.md` "Post-redesign hygiene". Fix before ship.
pnpm build              # Next build, exit 0 — emits the 30-route table
```

If `typecheck` / `lint` / `build` fail, stop and fix before adding credentials — failures multiply once external services are in the loop. The ShareBurst tests can be triaged separately; they don't block credential onboarding.

---

## 2. Per-credential onboarding

Each subsection: where to create the account, which env vars to fill, which files/features it unblocks, and the local verification command. Work top-to-bottom — later steps depend on earlier ones.

### 2.1 Google OAuth provider (Supabase Auth)

Already partly wired — `signInWithOAuth({ provider: 'google' })` action lives in `app/(auth)/login/actions.ts`. To make the button work end-to-end:

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth Client ID** (Web). Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
2. Supabase Dashboard → **Authentication → Providers → Google**. Paste Client ID + Client Secret. Save.
3. No env vars on the app side — Supabase brokers the flow.

Verify:

```bash
pnpm dev
# Open http://localhost:3008/login
# Click "Continue with Google" → should hit accounts.google.com consent, return to /auth/callback, land on /
```

Then seed yourself into `admin_users` so `/admin/*` routes load. Preferred — one-shot helper:

```bash
pnpm bootstrap:admin your@email.com YourStr0ngP4ssw0rd
# Then sign in at http://localhost:3000/admin/login with email + password.
# Forgot password? `pnpm recovery:admin your@email.com` prints a one-time URL.
```

Looks up the user by email via the service-role client, upserts `(user_id, role='admin')`. Fallback if you cannot run the script — `scripts/seed-admin.sql` does the same thing via the Supabase Dashboard → SQL Editor.

### 2.2 Configure Supabase Auth email templates

User-facing magic-link sign-in (`/login`) only works cross-device if the Supabase email template points at our `/auth/confirm` route (which uses `verifyOtp(token_hash)` — no `code_verifier` cookie needed). The default template embeds `{{ .ConfirmationURL }}` which routes through `/auth/v1/verify` → PKCE flow → fails when the user clicks the email on a different browser/device than where they submitted the form (`/login?error=exchange_failed`).

One-time setup in Supabase Dashboard → Authentication → Email Templates:

**Magic Link** template — replace the body with:

```html
<h2>Sign in to Trendly</h2>
<p>Tap the button below to sign in. The link is one-time and expires in 1 hour.</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/me/studio"
    >Sign in</a
  >
</p>
```

Optional: update **Confirm signup** template to the same URL shape for consistency.

`{{ .SiteURL }}` resolves to the value in Authentication → URL Configuration → Site URL (currently `http://localhost:3000` for dev; flip to production URL post-domain).

After saving, magic-link sign-in works cross-device. The dev script `pnpm dlx tsx scripts/generate-magic-link.ts <email>` already points at `/auth/confirm` and works without any template edit (uses the service-role admin API instead of email).

### 2.3 GEMINI_API_KEY

Unblocks: real image generation. Without it, `lib/gemini/client.ts:52` returns a deterministic 1px PNG stub.

1. https://aistudio.google.com/ → "Get API key" → create key.
2. Add to `.env.local`:
   ```
   GEMINI_API_KEY=AIza...
   ```
3. Also set as Supabase secret for the Edge Function:
   ```bash
   pnpm supabase secrets set GEMINI_API_KEY=AIza... --project-ref <ref>
   pnpm supabase secrets set SITE_URL=https://<your-domain> --project-ref <ref>
   ```
4. Deploy the Edge Function:
   ```bash
   pnpm supabase functions deploy generate-image --no-verify-jwt --project-ref <ref>
   ```
5. Configure the Database Webhook in Supabase Dashboard → Database → Webhooks → **Create a new hook** with the row from the README "Database Webhooks" table for `generate-on-insert`.

Verify:

```bash
# Tail Edge Function logs in one terminal
pnpm supabase functions logs generate-image --project-ref <ref>

# In another terminal, run an authed dev session:
pnpm dev
# Sign in, click any trend, upload a test photo, submit.
# Expected: result page shows "processing" → "completed" with output_image_url.
# Expected logs: 1 Edge Function invocation, status 200, cost_usd recorded.
```

### 2.3 Stripe (test mode)

Unblocks: credit pack checkout + the duplicate-event idempotency test.

1. Stripe Dashboard → toggle **Test mode** → Developers → API keys → copy "Secret key" + "Publishable key".
2. Create 3 products in test mode:
   - "Credit pack 50" → one-time price `$4.99` USD → copy `price_…` into `STRIPE_PRICE_ID_SMALL`.
   - "Credit pack 200" → one-time price `$14.99` → `STRIPE_PRICE_ID_MEDIUM`.
   - "Credit pack 600" → one-time price `$39.99` → `STRIPE_PRICE_ID_LARGE`.
3. Developers → Webhooks → Add endpoint → URL `https://<your-domain>/api/stripe/webhook`, event `checkout.session.completed`. Copy signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Fill `.env.local` with `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, all three `STRIPE_PRICE_ID_*`.

Verify:

```bash
# Local end-to-end via Stripe CLI
stripe listen --forward-to localhost:3008/api/stripe/webhook
# Note the temporary whsec_… and set it as STRIPE_WEBHOOK_SECRET for the dev session

# In another terminal:
pnpm dev
# Sign in → /me/settings → click "Buy 50 credits"
# Use card 4242 4242 4242 4242, any future expiry + CVC
# Expected: Stripe redirects to /me/creations?purchase=success&pack=small
# Expected (SQL): select credits_balance from profiles where id = '<your-uid>';
#   → 50 (or +50 from prior balance)
# Expected (SQL): select count(*) from webhook_events where event_id = '<stripe-event-id>';
#   → 1
```

### 2.4 Resend (email)

Unblocks: push-expired email fallback (`app/api/push/dispatch/route.ts`).

1. resend.com → API Keys → "Create API Key" (full access for dev).
2. Domains → add your domain → set SPF / DKIM / DMARC DNS records as instructed → wait for "Verified".
3. Fill `.env.local`:
   ```
   RESEND_API_KEY=re_...
   RESEND_FROM_EMAIL=Trendly <noreply@yourdomain.com>
   ```

Verify:

```bash
# Force the push-expired branch by clearing your profile.push_subscription, then complete a generation.
pnpm supabase db remote query "update profiles set push_subscription = null where id = '<your-uid>';"
# (Or just generate before you grant push permission.)
# After the generation completes, check inbox + Resend → Emails for the "Your image is ready" message.
```

### 2.5 VAPID (Web Push)

Unblocks: actual push delivery from the Edge Function.

1. Generate the pair once:
   ```bash
   pnpm dlx web-push generate-vapid-keys --json
   ```
2. Fill all three vars in `.env.local`:
   ```
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=<base64>
   VAPID_PRIVATE_KEY=<base64>
   VAPID_SUBJECT=mailto:you@yourdomain.com
   ```
3. Keep these keys forever — rotating breaks existing browser subscriptions.

Verify:

```bash
pnpm dev
# Sign in, generate one image, wait for "completed".
# Browser prompts for notifications — click "Allow" (see app/(app)/result/[id]/ResultView.tsx).
# Generate a second image. Within ~1s of "completed", the OS push notification fires.
```

### 2.6 Cloudflare Turnstile

Unblocks: bot defence on the login form and the anonymous-trial endpoint.

1. Cloudflare Dashboard → Turnstile → **Add site**.
2. Create one widget for `localhost` (mode: Managed, no domain check) and one for production.
3. Fill `.env.local`:
   ```
   NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAA...
   TURNSTILE_SECRET_KEY=0x4AAA...
   ```

Verify:

```bash
pnpm dev
# /login should render the Turnstile widget under both the Google + magic-link forms.
# Submit without solving → server action rejects ("turnstile failed").
# Solve → submit → success path.
```

### 2.7 Sentry

Unblocks: server + edge + browser error capture + source-map upload.

1. sentry.io → Create project (platform: Next.js).
2. Settings → Client Keys (DSN) → copy DSN → fill both `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (client).
3. User Settings → Auth Tokens → create token with `project:releases` + `project:write` → fill `SENTRY_AUTH_TOKEN`.
4. Fill `SENTRY_ORG` (URL slug) + `SENTRY_PROJECT` (project slug).

Verify:

```bash
NODE_ENV=production pnpm build
# Expected: "Source Maps uploaded successfully" message during build.

# Smoke test the runtime by inserting a throw at the top of any server action, redeploy or pnpm dev:
# Expected: error appears in Sentry → Issues within ~30s.
```

### 2.8 PostHog

Unblocks: 15-event funnel + the end-to-end Test 14 below.

1. posthog.com → Create project → Project Settings → Project API Key.
2. Fill `.env.local`:
   ```
   NEXT_PUBLIC_POSTHOG_KEY=phc_...
   NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com   # or eu.i.posthog.com
   ```

Verify:

```bash
pnpm dev
# Open PostHog → Live events.
# Visit /, navigate to /trend/<slug>, sign up, generate, share.
# Expected events in order: $pageview, TREND_VIEW, SIGNUP_COMPLETED,
#   UPLOAD_STARTED, GENERATE_CLICKED, GENERATE_COMPLETED, SHARE_CLICKED.
```

### 2.9 Upstash Redis

Unblocks: per-IP rate limiting (`lib/rate-limit.ts`) — both `/api/generate` (20/hr/IP) and the anonymous sliding window (5/day/fingerprint).

1. Upstash Console → Create database (region close to Vercel deploy region). Tier: Free is fine for MVP.
2. REST API tab → copy URL + token.
3. Fill `.env.local`:
   ```
   UPSTASH_REDIS_REST_URL=https://...upstash.io
   UPSTASH_REDIS_REST_TOKEN=...
   ```

Verify:

```bash
# Hit the generate endpoint > 20 times in an hour from one IP.
# Expected: 21st request returns HTTP 429 { "error": "Rate limit exceeded" }.
```

---

## 3. 14-test final verification matrix

Run sequentially after every credential in §2 is in place. **Every test must pass before MVP ship.** Sourced from amended plan §"Verification" plus the post-audit decision reversals.

Convention: `SQL` = run via Supabase Dashboard SQL Editor or `pnpm supabase db remote query`. `CURL` = run from any shell with the dev server up. `PLAY` = Playwright. `UI` = manual click-through. Substitute `<uid>` with your real `auth.uid()`.

### Test 1 — RLS quota block (free 5 + credits 0 → INSERT rejected)

Maps to `consume_quota_on_generation_insert` trigger at `supabase/migrations/20260527000003_generations.sql:60`.

```sql
-- Setup: zero out credits, fill weekly free
update public.profiles
   set credits_balance = 0, free_used_this_week = 5
 where id = '<uid>';

-- Act
insert into public.generations (user_id, trend_id, trend_version, idempotency_key, input_payload)
values ('<uid>', (select id from public.trends where slug = 'ghibli-portrait'), 1, 'test-quota-block', '{}'::jsonb);
```

**Expected:** `ERROR: quota exhausted`. No row in `generations`.

### Test 2 — RLS quota decrement (credits=1 → INSERT succeeds, credits=0)

```sql
update public.profiles set credits_balance = 1 where id = '<uid>';

insert into public.generations (user_id, trend_id, trend_version, idempotency_key, input_payload)
values ('<uid>', (select id from public.trends where slug = 'ghibli-portrait'), 1, 'test-quota-ok', '{}'::jsonb);

select credits_balance from public.profiles where id = '<uid>';
```

**Expected:** Insert succeeds. `credits_balance` returns `0`. Trigger consumed the credit at `supabase/migrations/20260527000003_generations.sql:70`.

### Test 3 — `/api/generate` idempotency replay

```bash
# Sign in via the dev server, then in DevTools copy your session cookies into this curl,
# or use the Playwright fixture. Pseudocode shown.

KEY=$(uuidgen | tr -d -)
curl -X POST http://localhost:3008/api/generate \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -H "Cookie: sb-...=..." \
  -d '{"trend_slug":"ghibli-portrait","values":{"user_photo":"https://example.com/test.jpg"}}'

# Replay
curl -X POST http://localhost:3008/api/generate \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -H "Cookie: sb-...=..." \
  -d '{"trend_slug":"ghibli-portrait","values":{"user_photo":"https://example.com/test.jpg"}}'
```

**Expected:** First call returns `{ "generation_id": "<uuid>" }`. Second returns `{ "generation_id": "<same uuid>", "replayed": true }`. Logic at `app/api/generate/route.ts:94-104`.

```sql
select count(*) from public.generations
 where user_id = '<uid>' and idempotency_key = '$KEY';
```

**Expected:** `1`. (Gemini was called exactly once; check Edge Function logs to confirm `1` invocation.)

### Test 4 — Edge Function retry path (transient fail → retryable → completed)

Simulate a transient Gemini fault by temporarily rejecting the first attempt. Easiest path: invoke the Edge Function manually against a generations row, with the Gemini key briefly unset; restore the key and let the Database Webhook re-fire (or click the retry button on `/result/[id]`).

**Expected behaviour:**

- First Edge Function run sets status `failed_retryable`, `attempts = 1`, `error_message` populated. Source: `supabase/functions/generate-image/index.ts`.
- Retry (manual or webhook-driven) succeeds, sets status `completed`, no quota refund. RetryUI at `app/(app)/result/[id]/ResultView.tsx`.

```sql
select status, attempts from public.generations where id = '<gen_id>';
```

**Expected:** `('completed', 2)` after the successful retry.

### Test 5 — Refund path (Gemini safety reject → failed terminal → credit refunded)

Trigger a Gemini moderation block by submitting a known-bad image (e.g., a Gemini "REASON_SAFETY" test image — keep one in `e2e/fixtures/` for this).

```sql
-- Before
select credits_balance from public.profiles where id = '<uid>';

-- Run a generation that hits safety filter (UI: upload the bad image)

-- After
select status, error_message from public.generations where id = '<gen_id>';
select credits_balance from public.profiles where id = '<uid>';
```

**Expected:** generation `status = 'failed'`, `error_message` mentions safety. `credits_balance` is unchanged from before (refund trigger at `supabase/migrations/20260527000003_generations.sql:88` restored it). Result page shows the "quota refunded" panel.

### Test 6 — Schema-driven form renders per trend

```bash
# Look at three trends with different input_schema shapes.
SELECT slug, input_schema from public.trends where is_active = true limit 3;
```

For each: visit `/trend/<slug>` and confirm the form matches the schema:

- `type: 'image'` → file input with min/max count enforced client-side.
- `type: 'text'` → text input.
- `type: 'select'` → dropdown populated from `options`.

**Expected:** No hardcoded "1 photo" anywhere. Schema parsed at `app/(public)/trend/[slug]/page.tsx` and rendered by `components/upload/SchemaForm.tsx`. Required fields block submit with an inline error.

### Test 7 — Eval gate constraint (`is_active=true` requires `eval_status='passed'`)

```sql
-- Pick a trend currently passed + active. Force eval_status back to untested.
update public.trends set eval_status = 'untested' where slug = 'ghibli-portrait';
-- Trigger at migration 0002 should have already set is_active = false. Force the conflict:
update public.trends set is_active = true where slug = 'ghibli-portrait';
```

**Expected:** `ERROR: ... check constraint "eval_gate" violated`. Source: `supabase/migrations/20260527000002_trends.sql` eval_gate check + version-bump trigger. UI mirror: activate button disabled at `app/admin/trends/[id]/edit/page.tsx`.

### Test 8 — Push + email fallback

Sub-case A (push works):

```
- Sign in on Chrome → generate → "completed" → grant push permission.
- Generate again.
- Expected: OS notification fires within 1s of completed_at timestamp.
```

Sub-case B (push expired → email):

```sql
-- Force an expired subscription:
update public.profiles set push_subscription = null where id = '<uid>';
```

- Generate again.
- Expected: no push, **but** within 30s an email arrives from `RESEND_FROM_EMAIL`. Email built at `lib/email/send.ts` `buildResultReadyEmail`. Dispatch path: `app/api/push/dispatch/route.ts` returns `{ delivered: 'email' }` in Edge Function logs.

### Test 9 — SSR trend page HTML completeness

```bash
curl -sS https://<your-domain>/trend/ghibli-portrait | tee /tmp/trend.html

# Spot checks:
grep -c "<title>" /tmp/trend.html        # expect 1
grep -c 'property="og:image"' /tmp/trend.html  # expect 1
grep -c 'application/ld+json' /tmp/trend.html  # expect 2 (HowTo + FAQ)
grep -c '"@type":"HowTo"' /tmp/trend.html      # expect 1
grep -c '"@type":"FAQPage"' /tmp/trend.html    # expect 1
```

**Expected:** All counts match. Page renders fully server-side, not as a skeleton. Source: `app/(public)/trend/[slug]/page.tsx` + `lib/seo/json-ld.ts`.

Also confirm sitemap:

```bash
curl -sS https://<your-domain>/sitemap.xml | grep -c '<loc>'
# Expected: at least 1 + number-of-active-trends entries.
```

### Test 10 — pg_cron purges actually run

Confirm the 4 scheduled jobs exist:

```sql
select jobname, schedule from cron.job order by jobname;
```

**Expected:** Four rows — `purge_expired_anonymous`, `purge_expired_generations`, `purge_soft_deleted_profiles`, `reset_free_weekly`. Source: `supabase/migrations/20260527000005_pg_cron.sql`.

Force-run the generations purge to prove it works:

```sql
-- Setup: a free-tier row with purge_at in the past
insert into public.generations (user_id, trend_id, trend_version, idempotency_key, input_payload, purge_at)
values ('<uid>', '<trend_id>', 1, 'purge-test', '{}'::jsonb, now() - interval '1 day');

-- Manually run the purge job
delete from public.generations where purge_at is not null and purge_at < now();

select count(*) from public.generations where idempotency_key = 'purge-test';
```

**Expected:** `0`.

For the anonymous purge: insert an `anonymous_attempts` row with `expires_at = now() - interval '1 day'`, run the equivalent delete, confirm gone.

### Test 11 — Referral farming guard

```sql
-- Setup: referrer A, referee B, referrals row pending
insert into public.referrals (referrer_id, referred_id, status)
values ('<uid-A>', '<uid-B>', 'pending');

-- Before: A has 0 bonus credits
select credits_balance, bonus_credits_earned from public.profiles where id = '<uid-A>';
```

Sub-case: self-referral (should be rejected by the auth-callback application code at `app/auth/callback/route.ts`):

```sql
insert into public.referrals (referrer_id, referred_id, status)
values ('<uid-A>', '<uid-A>', 'pending');
-- Expected: insert succeeds at the DB layer, but proxy.ts + auth/callback never allow the cookie + signup combination to reach this state in practice.
```

Sub-case: legitimate redemption:

- B completes their first generation (status → `completed`).
- Reward trigger at `supabase/migrations/20260527000004_ancillary.sql:39` fires.

```sql
select status, rewarded_at from public.referrals where referred_id = '<uid-B>';
select credits_balance, bonus_credits_earned from public.profiles where id = '<uid-A>';
```

**Expected:** referral now `rewarded`. A has `+10` credits, `bonus_credits_earned = 10`. Cap at 50 enforced by `least(bonus_credits_earned + 10, 50)` in the trigger.

### Test 12 — Stripe webhook idempotency

```bash
# Send the same event twice via Stripe CLI replay
stripe events resend <event_id>
stripe events resend <event_id>
```

**Expected:**

```sql
select count(*) from public.webhook_events where event_id = '<event_id>';
-- → 1 (UNIQUE (source, event_id) blocks the second insert)

select credits_balance from public.profiles where id = '<uid>';
-- → +<pack credits> exactly once, not twice
```

Logic at `app/api/stripe/webhook/route.ts:49-57`.

### Test 13 — GDPR delete cascade

```sql
-- Pick a test user with at least 1 generation
update public.profiles set deleted_at = now() where id = '<test-uid>';

-- All reads now filtered by RLS deleted_at policy
select * from public.profiles where id = '<test-uid>';
-- → 0 rows (own RLS filter excludes soft-deleted)

select count(*) from public.generations where user_id = '<test-uid>';
-- → still N rows (cascading purge happens in 30d via pg_cron job purge_soft_deleted_profiles)

-- Force the 30-day job for verification:
delete from public.profiles where deleted_at is not null and deleted_at < now() - interval '0 days';
-- After: generations cascade-deleted via on delete cascade FK.

select count(*) from public.generations where user_id = '<test-uid>';
-- → 0
```

**Expected:** soft-delete first (immediate UI block), hard-delete cascades within 30 days. Audit trail in `admin_audit_log` (writes via `grant_credits` SECURITY DEFINER, and admin actions in Phase 2 admin CRUD).

### Test 14 — PostHog funnel

In PostHog → Insights → Funnels, create:

```
SIGNUP_COMPLETED → UPLOAD_STARTED → GENERATE_CLICKED → GENERATE_COMPLETED → SHARE_CLICKED
```

Walk through the funnel manually as a brand-new user:

- Sign up via Google OAuth (fires `SIGNUP_COMPLETED` server-side at `app/auth/callback/route.ts`).
- Open any trend, upload a photo (`UPLOAD_STARTED`).
- Submit (`GENERATE_CLICKED`).
- Wait for completion (`GENERATE_COMPLETED`, fired client-side from `ResultView.tsx`).
- Click any share button (`SHARE_CLICKED`).

**Expected:** All 5 events visible in PostHog Live tab within a minute. Funnel shows 100% conversion for your test user. Event catalog: `lib/analytics/events.ts`.

---

## 4. Ship

Only after all 14 tests pass:

```bash
# Final gates
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e --project=chromium

# Deploy
vercel --prod    # or: gh workflow run deploy.yml
```

Post-deploy smoke:

- Visit `/`, `/trend/<slug>`, `/login`.
- Tail Sentry → Issues for 24h. Zero new critical issues = green.
- Watch PostHog → Live events for the first 10 real signups.
- Monitor `sum(generations.cost_usd) / interval` to confirm unit economics match assumption.

If anything regresses, the kill-switch is one row update:

```sql
update public.trends set is_active = false where is_active = true;
```

All `/api/generate` calls then fail at the trend-fetch step. Home grid empties. Safe rollback.

## M7 — manual storage policy fix (restrict outputs/eval/\* to service-role)

Migration `20260530000008_storage_outputs_eval_private.sql` is a no-op
because the migration runner role cannot drop policies on
`storage.objects` (only `supabase_storage_admin` can). The corrective
SQL must be applied via the **Supabase Dashboard SQL editor** on each
environment by hand.

Open SQL editor for the target project and run:

```sql
drop policy if exists "outputs_public_read" on storage.objects;

create policy "outputs_public_read" on storage.objects
  for select using (
    bucket_id = 'outputs'
    and (
      auth.role() = 'service_role'
      or (storage.foldername(name))[1] <> 'eval'
    )
  );

comment on policy "outputs_public_read" on storage.objects is
  'Public read on outputs/* EXCEPT outputs/eval/* (admin QA outputs, service-role only).';
```

Verify with:

```sql
select polname, polqual::text
  from pg_policy
  join pg_class on pg_class.oid = pg_policy.polrelid
 where polname = 'outputs_public_read';
```

The `polqual` should contain `<> 'eval'`. If it doesn't, the policy is
the old wide-open version and eval outputs are still publicly readable.

---

## 3. Phase 5+ credentials (added post-launch)

### New env vars from Phases 1–4

Add these to Vercel and locally to `.env.local`:

**Phase 1 — Dual provider:**
- `OPENAI_API_KEY` — OpenAI platform key for gpt-image generation
- `OPENAI_IMAGE_MODEL` — Model ID (default: `gpt-image-1`); override if using a newer model
- `IMAGE_PROVIDER` — Optional env override (`gemini` or `openai`); defaults to per-trend setting

**Phase 2 — KIMP360:**
- `KIMP360_OIDC_ISSUER` — KIMP360 IdP issuer URL (e.g. `https://auth.kimp360.com`)
- `KIMP360_OIDC_CLIENT_ID` — OAuth client ID
- `KIMP360_OIDC_CLIENT_SECRET` — OAuth client secret (server-side only)
- `KIMP360_STATUS_API_URL` — Server-to-server status endpoint (e.g. `https://api.kimp360.com`)
- `KIMP360_STATUS_API_KEY` — HMAC signing key for status API
- `CRON_SECRET` — Shared secret for Vercel Cron → `kimp-reverify` endpoint (generate with `openssl rand -hex 32`)
- `NEXT_PUBLIC_KIMP_SSO_ENABLED` — Set to any truthy value to show the KIMP360 login button

**Phase 3 — Stripe subscriptions:**
- `STRIPE_PRICE_ID_SUB_STARTER` — Stripe price ID for the 50 credits/mo plan
- `STRIPE_PRICE_ID_SUB_PRO` — Stripe price ID for the 200 credits/mo plan
- `STRIPE_PRICE_ID_SUB_STUDIO` — Stripe price ID for the 600 credits/mo plan
- (Existing pack price IDs and webhook secret unchanged)

**Phase 5 — Edge Function Sentry:**
- `SENTRY_DSN` — Already in Next.js env; must ALSO be added as a Supabase Edge Function secret:
  ```bash
  supabase secrets set SENTRY_DSN=https://...@sentry.io/...
  ```

### Stripe subscription setup

1. Create 3 recurring products in Stripe Dashboard (or test mode):
   - Starter: $4.99/mo, metadata: `plan_id=starter50`
   - Pro: $14.99/mo, metadata: `plan_id=pro200`
   - Studio: $39.99/mo, metadata: `plan_id=studio600`
2. Add the price IDs to env vars above
3. Enable these additional webhook events in Stripe Dashboard:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `charge.refunded`
   - `charge.dispute.created`

### Verifying KIMP360 churn cron

```bash
# Manual trigger (as admin):
curl -X POST https://<your-domain>/api/admin/kimp-reverify \
  -H "Authorization: Bearer <CRON_SECRET>"
# Expected: {"checked":N,"active":N,"revoked":0,"errors":0}

# Check audit log for the run:
# Admin panel → Audit → filter action = kimp_reverify_complete
```

### Verification matrix additions (T15–T23)

Run these after all credentials are wired:

| Test | Expected |
|------|----------|
| T15 | Unlimited user hits 500/day cap → 429 on next generate |
| T16 | POST `/api/auth/kimp/callback` with forged id_token → `kimp_claims_invalid` |
| T17 | KIMP cron with inactive status + stale verified_at → `kimp_unlimited=false` |
| T18 | Flip global model in settings → non-pinned trends go `is_active=false` |
| T19 | OpenAI safety refusal → quota refunded, `tier_at_generation` correct |
| T20 | `invoice.paid` replay (same subscription_id + period_start) → no double-grant |
| T21 | Cancel subscription → `monthly_credits=0`, `purchased_credits` unchanged |
| T22 | Non-admin browser subscribes to `admin_generations_feed` → empty result |
| T23 | Credit-bucket migration: existing `credits_balance` → `purchased_credits` preserved |
