import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `getServerEnv` memoises on first call (module-level `cached`). To exercise
 * different env shapes per test we reset modules and re-import. Each test
 * gets a fresh `cached = null`.
 */
async function loadEnv() {
  vi.resetModules()
  return await import('./env')
}

const REQUIRED_MIN = {
  NEXT_PUBLIC_SITE_URL: 'http://localhost:3008',
  NEXT_PUBLIC_SUPABASE_URL: 'https://stub.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk_test_stub',
  SUPABASE_SERVICE_ROLE_KEY: 'sk_test_stub',
} as const

const REQUIRED_KEYS = Object.keys(REQUIRED_MIN) as Array<keyof typeof REQUIRED_MIN>

const TRANSIENT_KEYS = [
  ...REQUIRED_KEYS,
  'ANONYMOUS_DAILY_BUDGET_USD',
  'GEMINI_API_KEY',
  'RESEND_FROM_EMAIL',
  'VAPID_SUBJECT',
  'MOCK_TRENDS',
  'SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'TIKTOK_CREATIVE_CENTER_KEY',
  'INSTAGRAM_SESSION_COOKIE',
  'REDDIT_USER_AGENT',
] as const

const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of TRANSIENT_KEYS) {
    originalEnv[k] = process.env[k]
    delete process.env[k]
  }
  // Seed required vars; individual tests can override.
  for (const [k, v] of Object.entries(REQUIRED_MIN)) {
    process.env[k] = v
  }
})

afterEach(() => {
  for (const k of TRANSIENT_KEYS) {
    if (originalEnv[k] === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = originalEnv[k]
    }
  }
  // Vitest manages stubbed envs (NODE_ENV, CI) separately from process.env
  // mutations; unstub here so the next test starts on clean ground.
  vi.unstubAllEnvs()
})

describe('getServerEnv', () => {
  it('parses successfully with only the required vars set', async () => {
    const { getServerEnv } = await loadEnv()
    const env = getServerEnv()
    expect(env.NEXT_PUBLIC_SITE_URL).toBe(REQUIRED_MIN.NEXT_PUBLIC_SITE_URL)
    expect(env.GEMINI_API_KEY).toBeUndefined()
    expect(env.SENTRY_AUTH_TOKEN).toBeUndefined()
  })

  it('throws with the specific path when a required var is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    const { getServerEnv } = await loadEnv()
    expect(() => getServerEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('throws when NEXT_PUBLIC_SITE_URL is not a valid URL', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'not-a-url'
    const { getServerEnv } = await loadEnv()
    expect(() => getServerEnv()).toThrow(/NEXT_PUBLIC_SITE_URL/)
  })

  it('throws when RESEND_FROM_EMAIL is not a valid email', async () => {
    process.env.RESEND_FROM_EMAIL = 'not-an-email'
    const { getServerEnv } = await loadEnv()
    expect(() => getServerEnv()).toThrow(/RESEND_FROM_EMAIL/)
  })

  it('throws when VAPID_SUBJECT does not start with mailto:', async () => {
    process.env.VAPID_SUBJECT = 'https://example.com/owner'
    const { getServerEnv } = await loadEnv()
    expect(() => getServerEnv()).toThrow(/VAPID_SUBJECT/)
  })

  it('accepts a valid mailto: VAPID_SUBJECT', async () => {
    process.env.VAPID_SUBJECT = 'mailto:owner@example.com'
    const { getServerEnv } = await loadEnv()
    expect(getServerEnv().VAPID_SUBJECT).toBe('mailto:owner@example.com')
  })

  it('parses MOCK_TRENDS=true and MOCK_TRENDS=false; rejects other values', async () => {
    process.env.MOCK_TRENDS = 'true'
    let mod = await loadEnv()
    expect(mod.getServerEnv().MOCK_TRENDS).toBe('true')

    process.env.MOCK_TRENDS = 'false'
    mod = await loadEnv()
    expect(mod.getServerEnv().MOCK_TRENDS).toBe('false')

    process.env.MOCK_TRENDS = 'yes'
    mod = await loadEnv()
    expect(() => mod.getServerEnv()).toThrow(/MOCK_TRENDS/)
  })

  // process.env.NODE_ENV is typed as a read-only literal in @types/node;
  // vi.stubEnv is the vitest-supported escape hatch. Tests are isolated via
  // vi.unstubAllEnvs in afterEach so each case starts clean.
  it('throws when MOCK_TRENDS=true in production outside CI (security guard)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('MOCK_TRENDS', 'true')
    vi.stubEnv('CI', '')
    const { getServerEnv } = await loadEnv()
    expect(() => getServerEnv()).toThrow(/MOCK_TRENDS=true is set in a production build/)
  })

  it('allows MOCK_TRENDS=true in production when CI=true (e.g. GitHub Actions)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('MOCK_TRENDS', 'true')
    vi.stubEnv('CI', 'true')
    const { getServerEnv } = await loadEnv()
    expect(getServerEnv().MOCK_TRENDS).toBe('true')
  })

  it('allows MOCK_TRENDS=true in non-production environments', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('MOCK_TRENDS', 'true')
    const { getServerEnv } = await loadEnv()
    expect(getServerEnv().MOCK_TRENDS).toBe('true')
  })

  it('allows MOCK_TRENDS=false in production (the safe combination)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('MOCK_TRENDS', 'false')
    const { getServerEnv } = await loadEnv()
    expect(getServerEnv().MOCK_TRENDS).toBe('false')
  })

  it('defaults ANONYMOUS_DAILY_BUDGET_USD to 20 when unset', async () => {
    const { getServerEnv } = await loadEnv()
    expect(getServerEnv().ANONYMOUS_DAILY_BUDGET_USD).toBe(20)
  })

  it('coerces ANONYMOUS_DAILY_BUDGET_USD from string and rejects non-positive', async () => {
    process.env.ANONYMOUS_DAILY_BUDGET_USD = '50'
    let mod = await loadEnv()
    expect(mod.getServerEnv().ANONYMOUS_DAILY_BUDGET_USD).toBe(50)

    process.env.ANONYMOUS_DAILY_BUDGET_USD = '0'
    mod = await loadEnv()
    expect(() => mod.getServerEnv()).toThrow(/ANONYMOUS_DAILY_BUDGET_USD/)
  })

  it('Sentry policy: optional trio — all absent OK, partial (DSN only) OK', async () => {
    // Locked policy: each Sentry var is independently optional. next.config.ts
    // gates source-map upload on the AND of (SENTRY_DSN, SENTRY_AUTH_TOKEN),
    // so the schema does NOT enforce co-presence — partial config must parse.
    process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1'
    const { getServerEnv } = await loadEnv()
    const env = getServerEnv()
    expect(env.SENTRY_DSN).toContain('sentry.io')
    expect(env.SENTRY_AUTH_TOKEN).toBeUndefined()
    expect(env.SENTRY_ORG).toBeUndefined()
    expect(env.SENTRY_PROJECT).toBeUndefined()
  })

  it('memoises: calling getServerEnv twice returns the same object reference', async () => {
    const { getServerEnv } = await loadEnv()
    const a = getServerEnv()
    const b = getServerEnv()
    expect(a).toBe(b)
  })
})

describe('requireEnv', () => {
  it('throws when the requested var is absent', async () => {
    const { requireEnv } = await loadEnv()
    expect(() => requireEnv('GEMINI_API_KEY')).toThrow(/GEMINI_API_KEY/)
  })

  it('returns the value when present', async () => {
    process.env.GEMINI_API_KEY = 'AIza-test'
    const { requireEnv } = await loadEnv()
    expect(requireEnv('GEMINI_API_KEY')).toBe('AIza-test')
  })
})
