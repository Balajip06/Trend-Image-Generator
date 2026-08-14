/**
 * Tests for the realtime cursor-refetch route.
 *
 * Two things matter here:
 *   1. `/api/admin/*` is NOT covered by the proxy's admin gate (that matcher
 *      only fires on paths starting with `/admin`), so the in-handler check is
 *      the ONLY authorization.
 *   2. `table` comes from the client. It must be validated against a strict
 *      allowlist — interpolating it into `.from()` would let any admin session
 *      read any table the service role can reach.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

let authedUser: { id: string } | null = { id: 'user-1' }
let adminRow: { user_id: string } | null = { user_id: 'user-1' }
let lastFrom: string | null = null
let lastColumns: string | null = null

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authedUser } }) },
  }),
  createServiceClient: () => {
    const chain: Record<string, unknown> = {}
    const passthrough = () => chain
    chain.from = vi.fn((table: string) => {
      lastFrom = table
      return chain
    })
    chain.select = vi.fn((cols: string) => {
      lastColumns = cols
      return chain
    })
    chain.eq = vi.fn(passthrough)
    chain.gt = vi.fn(passthrough)
    chain.order = vi.fn(passthrough)
    chain.limit = vi.fn(passthrough)
    chain.maybeSingle = vi.fn(() => Promise.resolve({ data: adminRow, error: null }))
    chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve)
    return chain
  },
}))

import { GET } from './route'

function req(query: string): NextRequest {
  return new Request(`http://localhost/api/admin/realtime-sync${query}`) as unknown as NextRequest
}

beforeEach(() => {
  authedUser = { id: 'user-1' }
  adminRow = { user_id: 'user-1' }
  lastFrom = null
  lastColumns = null
})

describe('GET /api/admin/realtime-sync', () => {
  it('rejects an unauthenticated caller', async () => {
    authedUser = null
    const res = await GET(req('?table=admin_audit_log'))
    expect(res.status).toBe(401)
  })

  it('rejects an authenticated NON-admin', async () => {
    adminRow = null
    const res = await GET(req('?table=admin_audit_log'))
    expect(res.status).toBe(403)
  })

  it('rejects a table that is not on the allowlist', async () => {
    const res = await GET(req('?table=profiles'))
    expect(res.status).toBe(400)
    // The rejection must happen BEFORE any read is attempted.
    expect(lastFrom).toBe('admin_users')
  })

  it('rejects an injection-shaped table value', async () => {
    const res = await GET(req('?table=generations%3Bdrop'))
    expect(res.status).toBe(400)
  })

  it('reads an allowlisted table with its pinned column set', async () => {
    const res = await GET(req('?table=admin_audit_log'))
    expect(res.status).toBe(200)
    expect(lastFrom).toBe('admin_audit_log')
    // Columns come from the allowlist, never from the request.
    expect(lastColumns).toContain('action')
  })

  it('defaults to the generations feed when no table is given', async () => {
    const res = await GET(req(''))
    expect(res.status).toBe(200)
    expect(lastFrom).toBe('admin_generations_feed')
  })
})
