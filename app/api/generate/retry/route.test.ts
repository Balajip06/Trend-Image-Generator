import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * Route-level tests for /api/generate/retry.
 *
 * Surfaces under test (red-team L4 — server resolves idempotency_key
 * from the row; client never sees it):
 *   - 401 when unauthenticated
 *   - 400 when body fails Zod
 *   - 404 when row not visible to user (RLS-filtered SELECT)
 *   - 409 when row is terminal-failed (not retryable) — H-C1 / Risk #12
 *   - 409 when attempts >= MAX_ATTEMPTS — unbounded paid generation loop
 *   - 429 when per-user rate limit exceeded
 *   - 200 + service-role update to status='pending' + attempts++
 */

let authUser: { id: string } | null = { id: 'user-1' }
let genRow: {
  id: string
  user_id: string
  status: string
  trend_id: string
  attempts: number
} | null = null
let updateResult: { error: { message: string } | null } = { error: null }
let rateLimitSuccess = true

const calls: {
  serviceUpdates: Array<{ table: string; payload: Record<string, unknown>; idEq: string }>
} = { serviceUpdates: [] }

function makeAuthedClient() {
  function chainFor() {
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn(() => chain)
    chain.eq = vi.fn(() => chain)
    chain.maybeSingle = vi.fn(() => Promise.resolve({ data: genRow }))
    return chain
  }
  return {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: authUser } })) },
    from: vi.fn(() => chainFor()),
  }
}

function makeServiceClient() {
  function chainFor(table: string) {
    let payload: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    chain.update = vi.fn((p: Record<string, unknown>) => {
      payload = p
      return chain
    })
    chain.eq = vi.fn((_col: string, val: unknown) => {
      calls.serviceUpdates.push({ table, payload, idEq: String(val) })
      return Promise.resolve(updateResult)
    })
    return chain
  }
  return { from: vi.fn((table: string) => chainFor(table)) }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve(makeAuthedClient()),
  createServiceClient: () => makeServiceClient(),
}))

vi.mock('@/lib/rate-limit', () => ({
  generationUserLimiter: {
    limit: vi.fn(async () => ({ success: rateLimitSuccess })),
  },
}))

async function loadRoute() {
  vi.resetModules()
  return await import('./route')
}

function makeReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as unknown as NextRequest
}

const VALID_GEN = '11111111-1111-4111-8111-111111111111'

describe('POST /api/generate/retry', () => {
  beforeEach(() => {
    calls.serviceUpdates = []
    authUser = { id: 'user-1' }
    genRow = null
    updateResult = { error: null }
    rateLimitSuccess = true
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('401 when unauthenticated', async () => {
    authUser = null
    const { POST } = await loadRoute()
    const res = await POST(makeReq({ generation_id: VALID_GEN }))
    expect(res.status).toBe(401)
  })

  it('400 when generation_id missing / not uuid', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeReq({ generation_id: 'nope' }))
    expect(res.status).toBe(400)
  })

  it('404 when RLS-filtered SELECT returns no row (not owned)', async () => {
    genRow = null
    const { POST } = await loadRoute()
    const res = await POST(makeReq({ generation_id: VALID_GEN }))
    expect(res.status).toBe(404)
  })

  it('409 when row is in pending state (not retryable)', async () => {
    genRow = { id: VALID_GEN, user_id: 'user-1', status: 'pending', trend_id: 't', attempts: 0 }
    const { POST } = await loadRoute()
    const res = await POST(makeReq({ generation_id: VALID_GEN }))
    expect(res.status).toBe(409)
  })

  it('409 when row is completed', async () => {
    genRow = { id: VALID_GEN, user_id: 'user-1', status: 'completed', trend_id: 't', attempts: 1 }
    const { POST } = await loadRoute()
    const res = await POST(makeReq({ generation_id: VALID_GEN }))
    expect(res.status).toBe(409)
  })

  // H-C1 / Risk #12: terminal-failed rows were already refunded; retrying
  // them would be a free paid generation.
  it('409 when generation is terminal failed (not retryable)', async () => {
    genRow = { id: VALID_GEN, user_id: 'user-1', status: 'failed', trend_id: 't', attempts: 3 }
    const { POST } = await loadRoute()
    const res = await POST(makeReq({ generation_id: VALID_GEN }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/retryable/i)
  })

  // H-C1 / Risk #12: cap attempts to prevent unbounded paid generation loop.
  it('409 when attempts >= MAX_ATTEMPTS', async () => {
    genRow = {
      id: VALID_GEN,
      user_id: 'user-1',
      status: 'failed_retryable',
      trend_id: 't',
      attempts: 3,
    }
    const { POST } = await loadRoute()
    const res = await POST(makeReq({ generation_id: VALID_GEN }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/max attempts/i)
  })

  it('429 when user rate limit exceeded', async () => {
    rateLimitSuccess = false
    genRow = {
      id: VALID_GEN,
      user_id: 'user-1',
      status: 'failed_retryable',
      trend_id: 't',
      attempts: 1,
    }
    const { POST } = await loadRoute()
    const res = await POST(makeReq({ generation_id: VALID_GEN }))
    expect(res.status).toBe(429)
  })

  it('200 + service-role flips to pending and increments attempts', async () => {
    genRow = {
      id: VALID_GEN,
      user_id: 'user-1',
      status: 'failed_retryable',
      trend_id: 't',
      attempts: 2,
    }
    const { POST } = await loadRoute()
    const res = await POST(makeReq({ generation_id: VALID_GEN }))
    expect(res.status).toBe(200)
    expect(calls.serviceUpdates).toHaveLength(1)
    expect(calls.serviceUpdates[0]).toEqual({
      table: 'generations',
      payload: { status: 'pending', error_message: null, attempts: 3 },
      idEq: VALID_GEN,
    })
  })

  it('500 when service-role update fails', async () => {
    genRow = {
      id: VALID_GEN,
      user_id: 'user-1',
      status: 'failed_retryable',
      trend_id: 't',
      attempts: 1,
    }
    updateResult = { error: { message: 'db down' } }
    const { POST } = await loadRoute()
    const res = await POST(makeReq({ generation_id: VALID_GEN }))
    expect(res.status).toBe(500)
  })
})
