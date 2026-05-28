# Security Review — 2026-05-28

Pre-launch audit of the 46-commit branch covering auth, payments, RLS,
uploads, admin tooling, and notifications. Two CRITICAL issues fixed
inline this turn; the rest are tracked below by severity.

## Scope

- 24 routes (8 API, 5 admin pages, 6 user pages, 5 public)
- 4 server-action modules (admin/trends + admin/trends/[id]/eval +
  admin/suggestions + (auth)/login)
- 7 Supabase migrations (RLS + triggers + storage buckets)
- 1 Deno Edge Function
- 15-event PostHog catalog + 5 server-side track sites
- Stripe Checkout + webhook + grant SQL function
- Web Push (VAPID) + Resend email fallback
- Cloudflare Turnstile on signup + anonymous trial
- Referral cookie + signup attribution

## Findings

### CRITICAL — fixed this turn

#### C1. JSON-LD XSS via `</script>` injection in trend page

**Where:** `app/(public)/trend/[slug]/page.tsx`

`dangerouslySetInnerHTML={{ __html: JSON.stringify(howTo) }}` is a known
XSS vector — `JSON.stringify` does not escape `<`, so any string that
contains `</script>` (e.g. `trend.faq[].answer` pasted by an admin, or
`trend.title` lifted from an auto-suggester source) closes the
JSON-LD script tag and executes attacker JavaScript on every visitor.

**Risk:** stored XSS on a public, SEO-indexed page. Impact = account
takeover (steal Supabase auth cookie via `document.cookie` or
fetch-with-credentials), credential phishing redirect, malicious
content insertion on a high-traffic page.

**Fix:** added `safeJsonLd()` helper that Unicode-escapes `<`, `>`, `&`
before injection. Browsers still parse the JSON; the closing-tag byte
sequence never appears in the rendered HTML.

```ts
function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}
```

#### C2. Open redirect via `?next=` in auth callback

**Where:** `app/auth/callback/route.ts`

`new URL(next, request.url)` where `next` came directly from the
query string. Values like `next=//evil.com/path` resolve to
`http://evil.com/path` because `URL` treats `//` as a
protocol-relative absolute. An attacker can craft a phishing email
linking to `https://app.com/login?next=//evil.com/spoof`; after
signin, Supabase issues a session cookie + the callback bounces the
already-authenticated user to the attacker's domain, which then
exfiltrates by tricking them into re-entering credentials on a
look-alike page.

**Fix:** added `safeNextPath()` that requires the path to start with
exactly one `/` and rejects backslash + `@` escape tricks. Anything
else falls back to `/`.

OAuth + magic-link redirect targets are still server-controlled
(`${siteUrl}/auth/callback?next=…`), so the only exposure was the
post-callback hop. Closed.

### HIGH — recommended, not fixed

#### H1. Defense-in-depth admin check missing inside server actions

**Where:** `app/admin/trends/actions.ts`, `app/admin/trends/[id]/eval/actions.ts`, `app/admin/suggestions/actions.ts`

Server Actions are invoked via POST to the page URL that imports
them; middleware's `admin_users` check fires on every `/admin/*`
request, so the actions are gated TODAY. However:

- One config slip in `proxy.ts` (e.g. excluding `/admin` from the
  matcher) would silently expose every admin action.
- Action references can be invoked from a different page via Next's
  encrypted action ID — middleware still fires, but the dependency is
  invisible from the action's own source.

**Recommendation:** add a 2-line check inside each admin action:

```ts
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
const { data: adminRow } = await supabase
  .from('admin_users').select('user_id').eq('user_id', user?.id).maybeSingle()
if (!adminRow) redirect('/')
```

Or extract to a `requireAdmin()` helper called at the top of every
admin action.

#### H2. No CSP / security headers configured

**Where:** `next.config.ts`

Adding a strict Content-Security-Policy (script-src self + nonce,
img-src self + supabase.co, connect-src self + posthog + sentry, etc.)
would mitigate the impact of any future XSS that slips past the
escape (e.g. a `dangerouslySetInnerHTML` added without using
`safeJsonLd`). Same file is also missing `Strict-Transport-Security`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Permissions-Policy` (deny camera/microphone/geolocation by default).

**Recommendation:** add a `headers()` function to `next.config.ts`
returning a list of security headers for `/(.*)`. Use a nonce-based
CSP if you eventually inline scripts; otherwise hash-based CSP works
for the static analytics SDK loaders.

#### H3. Rate limit absent on `/api/push/subscribe`

**Where:** `app/api/push/subscribe/route.ts`

Authed-only, but a script with a stolen session can hammer the
endpoint with garbage subscriptions, bloating `profiles.push_subscription`
and slowing the dispatch route. RLS limits writes to own row, but a
single attacker can still write+overwrite endlessly.

**Recommendation:** wrap the route with a per-user limiter from
`lib/rate-limit.ts` (add `pushSubscribeLimiter` with e.g. 5/min/user).

#### H4. `npm audit` not in CI

**Where:** `.github/workflows/ci.yml`

A vulnerable transitive dep (e.g. CVE in a Sentry / Supabase / web-push
upstream) wouldn't surface until the user manually checks. Branch
ships in 46 commits across ~40 deps; CVE arrival rate is non-zero.

**Recommendation:** add an `audit` job to CI:

```yaml
audit:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
      with: { version: 10 }
    - run: pnpm audit --prod --audit-level=high
```

Or use Dependabot for nightly PR sweeps.

### MEDIUM — accepted risks

#### M1. Anonymous endpoint exposes server-side IP via headers

`app/api/generate-anonymous/route.ts` reads
`x-forwarded-for` for the `ip_hash`. On Vercel this is real; behind a
custom proxy it may be spoofable. Mitigated by also requiring a
fingerprint hash + Turnstile + per-fingerprint Upstash limiter, so
the IP is only one of several gates. Acceptable.

#### M2. Stripe webhook does not de-dupe at the SQL level

`webhook_events.event_id` has a unique constraint, but the duplicate
check is a JS string `includes('duplicate key')` — a Postgres error
message rewording in a future driver bump would silently flip the
short-circuit. Stable, but worth replacing with `error.code === '23505'`
once strict Supabase types land (the error object will surface code).

#### M3. Trend page renders admin-controlled image URLs in raw `<img>`

`app/(public)/trend/[slug]/page.tsx` uses raw `<img src={trend.sample_after_url}>`
because `next/image` requires the remote host to be in `next.config.ts`
`remotePatterns`. Currently only `*.supabase.co` is whitelisted, which
catches Supabase Storage but not the auto-suggester's reddit
thumbnails. Risk: an attacker who steals an admin account can paste
a `javascript:` URL — but React strips `javascript:` from `src`
attributes by default. Bigger risk is malicious image content
(image-format CVEs) which a CSP `img-src` directive would mitigate
(see H2).

### LOW — note

- `.env.local.example` correctly has only placeholders. No secrets
  in any tracked file (full-tree grep clean).
- All Supabase queries use the client builder — no raw SQL string
  concatenation, no SQL-injection surface.
- `console.log` is absent from `app/`, `lib/`, `components/`,
  `supabase/functions/` (per the project's no-debug-log rule).
- All API routes use `getUser()` + ownership check (download,
  generate, push/subscribe) OR Stripe-signature / service-role
  bearer (webhook, push/dispatch, analytics/referral).
- Idempotency-Key enforced via DB UNIQUE constraint on
  `(user_id, idempotency_key)` — no race condition.
- Rate limits in place on `/api/generate` (IP, 20/hr) and
  `/api/generate-anonymous` (fingerprint, 5/day).
- Anonymous budget guard at $20/day cap.
- Service-role key never leaves the server — `createServiceClient`
  reads `SUPABASE_SERVICE_ROLE_KEY` (non-public env).
- VAPID private key + Stripe secret + Resend key all gated to
  non-public env names.
- HTML-escape applied in `lib/email/send.ts` for user-controlled
  email body content.
- Token cookie attributes: Supabase auth cookies are HttpOnly +
  SameSite=Lax by default; `tig_ref` referral cookie also set
  HttpOnly + SameSite=Lax + Secure when `https:`.
- Self-referral guard in `/auth/callback` (`referrer.id !== user.id`).

## Pre-Deployment Checklist

Mapped against the security-review skill's standard list.

| Item | Status |
|---|---|
| No hardcoded secrets | ✅ verified by grep |
| All user inputs validated | ✅ Zod on every server-action + API body |
| SQL parameterized | ✅ Supabase JS client only |
| XSS sanitization | ✅ after C1 fix |
| CSRF protection | ✅ Next.js Server Actions enforce origin + encrypted action IDs |
| Auth check before sensitive op | ✅ all 8 API routes + 4 action modules |
| RLS enabled | ✅ all 11 public tables |
| Role-based access | ✅ middleware admin gate + (H1 recommends defense-in-depth) |
| Rate limiting | ✅ generate + anonymous; ⚠️ push/subscribe (H3) |
| HTTPS enforced | ⚠️ Vercel/edge-config concern — verify after deploy |
| Security headers | ❌ no CSP/HSTS yet (H2) |
| Error messages generic | ✅ |
| No secrets in logs | ✅ |
| Deps up to date | ⚠️ no CI audit (H4) |
| RLS in Supabase | ✅ |
| CORS | ✅ (Next default — same-origin only) |
| File uploads validated | ✅ HEIC→JPEG conversion + 2048px resize + per-field Zod schemas |
| Wallet signatures | n/a (no blockchain) |
| Open redirects | ✅ after C2 fix |

## Action plan

**Before pushing to production:**

1. Fix C1 + C2 (this commit)
2. Add `requireAdmin()` helper + call from all 4 admin action files (H1)
3. Add CSP + HSTS + X-Frame-Options + Permissions-Policy in `next.config.ts` (H2)
4. Add `pushSubscribeLimiter` (H3)
5. Add `pnpm audit --prod --audit-level=high` to CI (H4)

**Post-launch monitoring:**

- Sentry should catch any XSS attempts that slip the escape (server-side
  HTML render errors).
- PostHog `GENERATE_FAILED` reason='safety' rate is the main abuse signal.
- Daily anomaly query: users >5 generations/hr → flag for review.
- Stripe webhook retry counter (Sentry tag) should stay near zero;
  spikes mean handler exceptions, not signature failures.
