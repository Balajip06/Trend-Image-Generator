import { describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

let insertResult: {
  data: { id: string } | null
  error: { message: string } | null
} = { data: { id: 'attempt-1' }, error: null }
const budgetRows: { cost_usd: number }[] = []
let turnstileOk = true
let rateLimitOk = true
const VALID_INPUT_SCHEMA = {
  fields: [
    {
      type: 'image',
      name: 'photo',
      label: 'Your photo',
      required: true,
      min_count: 1,
      max_count: 1,
    },
  ],
}

let trend: { id: string; input_schema: unknown } | null = {
  id: 'trend-1',
  input_schema: VALID_INPUT_SCHEMA,
}

function makeServiceClient() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'anonymous_attempts') {
        const chain: Record<string, unknown> = {}
        chain.select = vi.fn(() => chain)
        chain.gte = vi.fn(() => Promise.resolve({ data: budgetRows }))
        chain.insert = vi.fn(() => chain)
        chain.maybeSingle = vi.fn(() => Promise.resolve(insertResult))
        return chain
      }
      throw new Error(`unexpected table ${table}`)
    }),
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => makeServiceClient(),
}))

vi.mock('@/lib/turnstile/verify', () => ({
  verifyTurnstile: vi.fn(() => Promise.resolve(turnstileOk)),
}))

vi.mock('@/lib/rate-limit', () => ({
  anonymousFingerprintLimiter: {
    limit: vi.fn(() => Promise.resolve({ success: rateLimitOk })),
  },
}))

vi.mock('@/lib/trends/repository', () => ({
  getActiveTrendBySlug: vi.fn(() => Promise.resolve(trend)),
}))

async function loadRoute() {
  vi.resetModules()
  return await import('./route')
}

function makeReq(body: unknown, idemKey = 'idem-key-0123456789'): NextRequest {
  return {
    json: async () => body,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'idempotency-key' ? idemKey : null),
    },
  } as unknown as NextRequest
}

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test-project.supabase.co'
const SUPABASE_HOST = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host

const VALID_BODY = {
  trend_slug: 'ai-passport-photo',
  values: {
    photo: `https://${SUPABASE_HOST}/storage/v1/object/sign/uploads/anon/a/b.jpg`,
  },
  turnstile_token: '',
  fingerprint_hash: 'f'.repeat(64),
}

describe('POST /api/generate-anonymous', () => {
  it('accepts an empty turnstile_token (dev/unconfigured secret path)', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeReq(VALID_BODY))
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body.anonymous_attempt_id).toBe('attempt-1')
  })

  it('returns 403 when Turnstile verification fails', async () => {
    turnstileOk = false
    const { POST } = await loadRoute()
    const res = await POST(makeReq(VALID_BODY))
    expect(res.status).toBe(403)
    turnstileOk = true
  })

  it('returns 429 when the per-fingerprint rate limit is exceeded', async () => {
    rateLimitOk = false
    const { POST } = await loadRoute()
    const res = await POST(makeReq(VALID_BODY))
    expect(res.status).toBe(429)
    rateLimitOk = true
  })

  it('returns 404 when the trend is missing or inactive', async () => {
    trend = null
    const { POST } = await loadRoute()
    const res = await POST(makeReq(VALID_BODY))
    expect(res.status).toBe(404)
    trend = { id: 'trend-1', input_schema: VALID_INPUT_SCHEMA }
  })

  it('returns 409 when the fingerprint/IP has already used its trial', async () => {
    insertResult = { data: null, error: { message: 'duplicate key value violates unique' } }
    const { POST } = await loadRoute()
    const res = await POST(makeReq(VALID_BODY))
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(409)
    expect(body.error).toMatch(/already used/i)
    insertResult = { data: { id: 'attempt-1' }, error: null }
  })

  it('returns 400 when idempotency key is missing', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeReq(VALID_BODY, ''))
    expect(res.status).toBe(400)
  })
})
