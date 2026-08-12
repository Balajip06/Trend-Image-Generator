import { describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

let row: { status: string } | null = { status: 'pending' }

function makeServiceClient() {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: row }))
  return { from: vi.fn(() => chain) }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => makeServiceClient(),
}))

async function loadRoute() {
  vi.resetModules()
  return await import('./route')
}

const VALID_ID = '11111111-1111-4111-8111-111111111111'

function makeReq(): NextRequest {
  return {} as unknown as NextRequest
}

describe('GET /api/anonymous/[id]/status', () => {
  it('returns 400 for a non-UUID id', async () => {
    const { GET } = await loadRoute()
    const res = await GET(makeReq(), { params: Promise.resolve({ id: 'not-a-uuid' }) })
    expect(res.status).toBe(400)
  })

  it('returns 404 when the row does not exist', async () => {
    row = null
    const { GET } = await loadRoute()
    const res = await GET(makeReq(), { params: Promise.resolve({ id: VALID_ID }) })
    expect(res.status).toBe(404)
    row = { status: 'pending' }
  })

  it('returns the status for an existing row', async () => {
    row = { status: 'completed' }
    const { GET } = await loadRoute()
    const res = await GET(makeReq(), { params: Promise.resolve({ id: VALID_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'completed' })
    row = { status: 'pending' }
  })
})
