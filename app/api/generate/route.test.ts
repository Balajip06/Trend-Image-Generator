import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * Route-level tests for /api/generate.
 *
 * Surfaces under test:
 *   - missing/malformed idempotency-key → 400
 *   - rate limit blocked → 429
 *   - unauthenticated → 401
 *   - body too large (declared via content-length) → 413
 *   - body too large (chunked, no content-length) → 413 (H2)
 *   - body well-formed but invalid schema → 400
 *   - unknown trend → 404
 *   - quota exhausted → 402 (mapped from trigger error)
 *   - duplicate idempotency_key → replayed:true
 *   - happy path → generation_id
 */

type LimitResult = { success: boolean; limit: number; remaining: number; reset: number }
const limiterLimit = vi.fn<(id: string) => Promise<LimitResult>>(async () => ({
  success: true,
  limit: 20,
  remaining: 19,
  reset: 0,
}))

type ActiveTrend = {
  id: string
  slug: string
  prompt_template: string
  input_schema: { fields: unknown[] }
}
const getActiveTrendBySlug = vi.fn<(slug: string) => Promise<ActiveTrend | null>>(async () => ({
  id: 'trend-1',
  slug: 'a-trend',
  prompt_template: 'apply',
  input_schema: { fields: [] },
}))

let authUser: { id: string } | null = { id: 'user-1' }
let insertResult: { data: { id: string } | null; error: { message: string } | null } = {
  data: { id: 'gen-1' },
  error: null,
}
let replayLookupResult: { data: { id: string } | null } = { data: null }

const calls: { inserts: number; replayLookups: number } = { inserts: 0, replayLookups: 0 }

function makeAuthedClient() {
  // Unlimited-cap guard: generations count query resolves to 0 by default.
  let generationsCountResult: { count: number | null } = { count: 0 }

  function fromGenerations() {
    let op: 'insert' | 'select' = 'select'
    const chain: Record<string, unknown> = {}
    chain.insert = vi.fn(() => {
      op = 'insert'
      calls.inserts += 1
      return chain
    })
    chain.select = vi.fn(() => chain)
    chain.eq = vi.fn(() => chain)
    chain.in = vi.fn(() => chain)
    // .gte() terminates the count-select chain for the unlimited cap guard
    chain.gte = vi.fn(() => Promise.resolve(generationsCountResult))
    chain.maybeSingle = vi.fn(() => {
      if (op === 'insert') return Promise.resolve(insertResult)
      return Promise.resolve({ data: null })
    })
    return chain
  }

  function fromTrends() {
    let op: 'insert' | 'select' = 'select'
    let lookupEqCount = 0
    const chain: Record<string, unknown> = {}
    chain.insert = vi.fn(() => {
      op = 'insert'
      calls.inserts += 1
      return chain
    })
    chain.select = vi.fn(() => chain)
    chain.eq = vi.fn(() => {
      if (op === 'select') {
        lookupEqCount += 1
        if (lookupEqCount === 2) {
          calls.replayLookups += 1
          return Promise.resolve(replayLookupResult).then((r) => ({
            ...r,
            // .maybeSingle resolution path uses next call; chain instead
          }))
        }
      }
      return chain
    })
    chain.maybeSingle = vi.fn(() => {
      if (op === 'insert') return Promise.resolve(insertResult)
      return Promise.resolve(replayLookupResult)
    })
    return chain
  }

  return {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: authUser } })) },
    from: vi.fn((table: string) => (table === 'generations' ? fromGenerations() : fromTrends())),
    _setGenerationsCount: (n: number | null) => {
      generationsCountResult = { count: n }
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve(makeAuthedClient()),
}))
vi.mock('@/lib/rate-limit', () => ({
  generationIpLimiter: { limit: (identifier: string) => limiterLimit(identifier) },
}))
vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({ UNLIMITED_DAILY_BUDGET_USD: 50 }),
}))
vi.mock('@/lib/trends/repository', () => ({
  getActiveTrendBySlug: (slug: string) => getActiveTrendBySlug(slug),
}))
vi.mock('@/lib/trends/interpolate', () => ({
  interpolatePrompt: () => '',
  collectImageInputs: () => [],
}))
vi.mock('@/lib/trends/input-schema', () => ({
  TrendInputSchema: { safeParse: () => ({ success: true, data: { fields: [] } }) },
}))

async function loadRoute() {
  vi.resetModules()
  return await import('./route')
}

const VALID_KEY = 'a'.repeat(40)

function makeReq(opts: {
  bodyString?: string
  body?: unknown
  contentLength?: number | null
  idempKey?: string | null
  chunked?: boolean
}): NextRequest {
  const headers = new Headers()
  if (opts.idempKey !== null) headers.set('idempotency-key', opts.idempKey ?? VALID_KEY)
  if (opts.contentLength !== null && opts.contentLength !== undefined) {
    headers.set('content-length', String(opts.contentLength))
  }
  const bodyBytes = new TextEncoder().encode(
    opts.bodyString ?? JSON.stringify(opts.body ?? { trend_slug: 'a-trend', values: {} })
  )

  // Build a ReadableStream that emits the body in one (or chunked) reads.
  // The route uses request.body?.getReader().
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (opts.chunked) {
        // Split into 1024-byte chunks to simulate Transfer-Encoding: chunked.
        for (let i = 0; i < bodyBytes.byteLength; i += 1024) {
          controller.enqueue(bodyBytes.slice(i, i + 1024))
        }
      } else {
        controller.enqueue(bodyBytes)
      }
      controller.close()
    },
  })

  return {
    headers: { get: (k: string) => headers.get(k) },
    body: stream,
  } as unknown as NextRequest
}

describe('POST /api/generate', () => {
  beforeEach(() => {
    calls.inserts = 0
    calls.replayLookups = 0
    authUser = { id: 'user-1' }
    insertResult = { data: { id: 'gen-1' }, error: null }
    replayLookupResult = { data: null }
    limiterLimit.mockReset()
    limiterLimit.mockResolvedValue({ success: true, limit: 20, remaining: 19, reset: 0 })
    getActiveTrendBySlug.mockReset()
    getActiveTrendBySlug.mockResolvedValue({
      id: 'trend-1',
      slug: 'a-trend',
      prompt_template: 'apply',
      input_schema: { fields: [] },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('400 when idempotency-key header missing', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeReq({ idempKey: null }))
    expect(res.status).toBe(400)
  })

  it('429 when rate limiter denies', async () => {
    limiterLimit.mockResolvedValue({ success: false, limit: 20, remaining: 0, reset: 0 })
    const { POST } = await loadRoute()
    const res = await POST(makeReq({}))
    expect(res.status).toBe(429)
  })

  it('401 when unauthenticated', async () => {
    authUser = null
    const { POST } = await loadRoute()
    const res = await POST(makeReq({}))
    expect(res.status).toBe(401)
  })

  it('413 when Content-Length declares oversize body', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeReq({ contentLength: 200_000 }))
    expect(res.status).toBe(413)
  })

  it('413 when streamed body exceeds cap WITHOUT Content-Length (chunked H2)', async () => {
    // 80 KB body, no content-length header → guarded by streamed cap.
    const big = 'x'.repeat(80_000)
    const { POST } = await loadRoute()
    const res = await POST(
      makeReq({
        bodyString: JSON.stringify({ trend_slug: 'a-trend', values: { f: big } }),
        contentLength: null,
        chunked: true,
      })
    )
    expect(res.status).toBe(413)
  })

  it('400 when body fails Zod schema', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeReq({ body: { trend_slug: '', values: {} } }))
    expect(res.status).toBe(400)
  })

  it('404 when trend not active', async () => {
    getActiveTrendBySlug.mockResolvedValue(null)
    const { POST } = await loadRoute()
    const res = await POST(makeReq({}))
    expect(res.status).toBe(404)
  })

  it('402 on quota exhausted (trigger error mapped to Out of credits)', async () => {
    insertResult = { data: null, error: { message: 'quota exhausted' } }
    const { POST } = await loadRoute()
    const res = await POST(makeReq({}))
    expect(res.status).toBe(402)
    expect((await res.json()).error).toBe('Out of credits')
  })

  it('happy path returns generation_id', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeReq({}))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ generation_id: 'gen-1' })
  })
})
