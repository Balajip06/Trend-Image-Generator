import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let authUser: { id: string } | null = null
let adminRow: { user_id: string; role: string } | null = null

// Per-table data the service client returns for `from(table).select(...)`.
const serviceData: {
  profiles: unknown[] | null
  generations: unknown[] | null
  trends: unknown[] | null
  webhook_events: unknown[] | null
} = {
  profiles: [],
  generations: [],
  trends: [],
  webhook_events: [],
}

const logAdminAction = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined)
vi.mock('@/lib/admin/audit', () => ({
  logAdminAction: (arg: unknown) => logAdminAction(arg),
}))

function makeAuthedClient() {
  const chain = {
    select: vi.fn(function (this: unknown) {
      return chain
    }),
    eq: vi.fn(function (this: unknown) {
      return chain
    }),
    maybeSingle: vi.fn(() => Promise.resolve({ data: adminRow, error: null })),
  }
  return {
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: authUser } })),
    },
    from: vi.fn(() => chain),
  }
}

function makeServiceClient() {
  // Service client returns `Promise.resolve({ data })` after select; some calls
  // chain `.in(...)`, which also needs to resolve.
  function rowsFor(table: string): unknown[] | null {
    if (table === 'profiles') return serviceData.profiles
    if (table === 'generations') return serviceData.generations
    if (table === 'trends') return serviceData.trends
    if (table === 'webhook_events') return serviceData.webhook_events
    return []
  }
  return {
    from: vi.fn((table: string) => {
      const rows = rowsFor(table)
      // The select() in this route is awaited directly (not chained through eq).
      // For generations the route then chains .in(...) on a separate `trends` from-call.
      const chain: Record<string, unknown> = {
        select: vi.fn(function (this: unknown) {
          return chain
        }),
        in: vi.fn(() => Promise.resolve({ data: rows, error: null })),
        // Make the chain awaitable: select() returns chain, and chain has a then.
        then: (resolve: (v: { data: unknown[] | null; error: null }) => unknown) =>
          resolve({ data: rows, error: null }),
      }
      return chain
    }),
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(makeAuthedClient())),
  createServiceClient: vi.fn(() => makeServiceClient()),
}))

import { GET } from './route'

function makeReq(qs: string): Request & { nextUrl: URL } {
  const url = new URL(`http://localhost/admin/export/download?${qs}`)
  const r = new Request(url.toString()) as Request & { nextUrl: URL }
  // The route reads request.nextUrl.searchParams — emulate that.
  r.nextUrl = url
  return r
}

beforeEach(() => {
  vi.clearAllMocks()
  authUser = null
  adminRow = null
  serviceData.profiles = []
  serviceData.generations = []
  serviceData.trends = []
  serviceData.webhook_events = []
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /admin/export/download — auth', () => {
  it('unauthenticated → 401 unauthorized', async () => {
    authUser = null
    const res = await GET(makeReq('dataset=customers') as never)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'unauthorized' })
  })

  it('authenticated but not admin → 403 forbidden', async () => {
    authUser = { id: 'user-1' }
    adminRow = null
    const res = await GET(makeReq('dataset=customers') as never)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
  })
})

describe('GET /admin/export/download — dataset validation', () => {
  beforeEach(() => {
    authUser = { id: 'admin-1' }
    adminRow = { user_id: 'admin-1', role: 'admin' }
  })

  it('missing dataset → 400 invalid_dataset', async () => {
    const res = await GET(makeReq('') as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_dataset')
    expect(body.allowed).toEqual(['customers', 'generations', 'revenue'])
  })

  it('unknown dataset value → 400 invalid_dataset', async () => {
    const res = await GET(makeReq('dataset=secrets') as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_dataset')
  })
})

describe('GET /admin/export/download — customers dataset', () => {
  beforeEach(() => {
    authUser = { id: 'admin-1' }
    adminRow = { user_id: 'admin-1', role: 'admin' }
    serviceData.profiles = [
      {
        id: 'user-1',
        email: 'alice@example.com',
        created_at: '2026-05-01T00:00:00Z',
        credits_balance: 10,
        bonus_credits_earned: 5,
        referred_by: null,
        is_vip: false,
        deleted_at: null,
        acquisition_source: { utm_source: 'twitter' },
      },
    ]
  })

  it('returns 200 with text/csv + attachment header + audit log + hashed email', async () => {
    const res = await GET(makeReq('dataset=customers') as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/)
    const disposition = res.headers.get('content-disposition') ?? ''
    expect(disposition).toMatch(/attachment; filename="trendly-customers-\d{4}-\d{2}-\d{2}\.csv"/)

    const text = await res.text()
    const lines = text.split('\n')
    expect(lines[0]).toContain('user_id')
    expect(lines[0]).toContain('email_hash')
    expect(lines.length).toBeGreaterThanOrEqual(2)

    // Email column must be hashed — no '@' or original email value present.
    expect(text).not.toContain('alice@example.com')
    expect(text).not.toContain('@')

    // Verify hash is the expected 8-char SHA-256 prefix.
    const expectedHash = createHash('sha256').update('alice@example.com').digest('hex').slice(0, 8)
    expect(text).toContain(expectedHash)

    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'customer_export',
        targetTable: 'customers',
        adminId: 'admin-1',
        after: expect.objectContaining({ dataset: 'customers', row_count: 1 }),
      })
    )
  })
})

describe('GET /admin/export/download — generations dataset', () => {
  beforeEach(() => {
    authUser = { id: 'admin-1' }
    adminRow = { user_id: 'admin-1', role: 'admin' }
    serviceData.generations = [
      {
        id: 'gen-1',
        user_id: 'user-1',
        trend_id: 'trend-1',
        status: 'succeeded',
        cost_usd: 0.05,
        created_at: '2026-05-01T00:00:00Z',
        completed_at: '2026-05-01T00:01:00Z',
        model_used: 'nano-banana-2',
      },
    ]
    serviceData.trends = [{ id: 'trend-1', slug: 'ghibli-portrait' }]
  })

  it('returns 200 csv with trend slug resolved + hashed user_id', async () => {
    const res = await GET(makeReq('dataset=generations') as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/)
    const text = await res.text()
    const lines = text.split('\n')
    expect(lines[0]).toContain('user_id_hash')
    expect(lines[0]).toContain('trend_slug')
    expect(text).toContain('ghibli-portrait')
    expect(text).not.toContain('user-1') // hashed, not raw
    const expectedHash = createHash('sha256').update('user-1').digest('hex').slice(0, 8)
    expect(text).toContain(expectedHash)
  })
})

describe('GET /admin/export/download — revenue dataset', () => {
  beforeEach(() => {
    authUser = { id: 'admin-1' }
    adminRow = { user_id: 'admin-1', role: 'admin' }
    serviceData.webhook_events = [
      {
        event_id: 'evt_1',
        source: 'stripe',
        payload: {
          amount_total: 1499,
          currency: 'usd',
          customer_email: 'buyer@example.com',
        },
        created_at: '2026-05-01T00:00:00Z',
      },
    ]
  })

  it('returns 200 csv with amount in dollars + hashed customer_email', async () => {
    const res = await GET(makeReq('dataset=revenue') as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/)
    const text = await res.text()
    expect(text).toContain('webhook_event_id')
    expect(text).toContain('customer_email_hash')
    expect(text).toContain('14.99')
    expect(text).not.toContain('buyer@example.com')
    const expectedHash = createHash('sha256').update('buyer@example.com').digest('hex').slice(0, 8)
    expect(text).toContain(expectedHash)
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'customer_export', targetTable: 'revenue' })
    )
  })
})
