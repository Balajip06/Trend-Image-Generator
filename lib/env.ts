import { z } from 'zod'

const ServerEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(1).optional(),
  KIMP360_OIDC_ISSUER: z.string().url().optional(),
  KIMP360_OIDC_CLIENT_ID: z.string().min(1).optional(),
  KIMP360_OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  KIMP360_STATUS_API_URL: z.string().url().optional(),
  KIMP360_STATUS_API_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_KIMP_SSO_ENABLED: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_IMAGE_MODEL: z.string().min(1).optional(),
  IMAGE_PROVIDER: z.enum(['gemini', 'openai']).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  STRIPE_PRICE_ID_SMALL: z.string().min(1).optional(),
  STRIPE_PRICE_ID_MEDIUM: z.string().min(1).optional(),
  STRIPE_PRICE_ID_LARGE: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z
    .string()
    .regex(/^mailto:.+@.+/i, { message: 'must be a mailto: URL (e.g. mailto:owner@example.com)' })
    .optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
  SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
  SENTRY_ORG: z.string().min(1).optional(),
  SENTRY_PROJECT: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  ANONYMOUS_DAILY_BUDGET_USD: z.coerce.number().positive().default(20),
  UNLIMITED_DAILY_BUDGET_USD: z.coerce.number().positive().default(50),
  // Phase 6 (auto trend detector, post-MVP) — optional sources
  TIKTOK_CREATIVE_CENTER_KEY: z.string().min(1).optional(),
  INSTAGRAM_SESSION_COOKIE: z.string().min(1).optional(),
  REDDIT_USER_AGENT: z.string().min(1).optional(),
  // Optional /about page personalization — inlined at build time. Set in
  // Vercel before deploying for the founder photo / bio / social links to
  // render. Without these, the page falls back to a generic indie-maker
  // blurb and hides the socials block.
  NEXT_PUBLIC_FOUNDER_PHOTO_URL: z.string().url().optional(),
  NEXT_PUBLIC_FOUNDER_BIO: z.string().min(1).optional(),
  NEXT_PUBLIC_FOUNDER_TWITTER_URL: z.string().url().optional(),
  NEXT_PUBLIC_FOUNDER_LINKEDIN_URL: z.string().url().optional(),
  NEXT_PUBLIC_FOUNDER_THREADS_URL: z.string().url().optional(),
  // Dev-only: enable in-memory fixtures (string enum, not boolean — call sites do `=== 'true'`)
  MOCK_TRENDS: z.enum(['true', 'false']).optional(),
})

export type ServerEnv = z.infer<typeof ServerEnvSchema>

let cached: ServerEnv | null = null

export function getServerEnv(): ServerEnv {
  if (cached) return cached
  const parsed = ServerEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid server env:\n${issues}`)
  }
  // Fail-loud production guard: MOCK_TRENDS short-circuits auth (proxy.ts),
  // RLS (repository.ts mock branch), and authed-area gates in /me + /admin +
  // /result pages. Leaving it on in production would expose private user data
  // + admin surfaces to unauthenticated visitors. Boot must crash if this
  // combination is ever attempted. See docs/LAUNCH_CHECKLIST.md "Dev-mode flags".
  //
  // Exempt CI runners (GitHub Actions auto-sets CI=true). Playwright e2e
  // tests need MOCK_TRENDS=true to render authed routes against an empty
  // CI Supabase; the CI environment is ephemeral and not user-facing.
  if (
    parsed.data.MOCK_TRENDS === 'true' &&
    process.env.NODE_ENV === 'production' &&
    process.env.CI !== 'true'
  ) {
    throw new Error(
      'MOCK_TRENDS=true is set in a production build outside CI. This flag bypasses auth + RLS and must never run in real production. Unset it before deploy.'
    )
  }
  // Fail-loud production guard: rate-limit + bot-check creds (red-team H4).
  // `lib/rate-limit.ts` falls back to `passThroughLimiter` and
  // `lib/turnstile/verify.ts` falls back to no-op when these env vars are
  // unset. That fallback is intentional for local dev / CI, but in real
  // production it silently disables non-negotiable #10 (20/hr/IP) and the
  // signup bot wall, leaving /api/generate-anonymous + /api/generate wide
  // open to unbounded abuse. Boot must crash before serving requests if
  // these are missing in a production deploy.
  if (process.env.NODE_ENV === 'production' && process.env.CI !== 'true') {
    const required: Array<keyof ServerEnv> = [
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'TURNSTILE_SECRET_KEY',
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
    ]
    const missing = required.filter((k) => !parsed.data[k])
    if (missing.length > 0) {
      throw new Error(
        `Production deploy missing required abuse-defense env vars: ${missing.join(', ')}. ` +
          'Rate limiting and bot-check fall back to no-op when these are unset, which bypasses non-negotiable #10. ' +
          'Set them in Vercel before deploy.'
      )
    }
  }
  cached = parsed.data
  return cached
}

export function requireEnv<K extends keyof ServerEnv>(key: K): NonNullable<ServerEnv[K]> {
  const value = getServerEnv()[key]
  if (value === undefined || value === null || value === '') {
    throw new Error(`Required env var missing: ${String(key)}`)
  }
  return value as NonNullable<ServerEnv[K]>
}
