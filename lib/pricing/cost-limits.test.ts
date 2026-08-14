/**
 * Tests for the per-model cost gate.
 *
 * Two properties matter most:
 *   - It FAILS OPEN on a config/RPC outage. A limits-lookup failure must not
 *     halt generation for every customer.
 *   - It FAILS CLOSED on an explicit disable or a breached cap — including the
 *     boundary, where spend exactly equals the limit.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkModelCostLimit } from './cost-limits'

interface StubOptions {
  limits?: unknown
  limitsError?: boolean
  daily?: number
  monthly?: number
  rpcError?: boolean
  rpcThrows?: boolean
}

function makeClient({
  limits,
  limitsError = false,
  daily = 0,
  monthly = 0,
  rpcError = false,
  rpcThrows = false,
}: StubOptions): SupabaseClient {
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  chain.from = vi.fn(passthrough)
  chain.select = vi.fn(passthrough)
  chain.eq = vi.fn(passthrough)
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve(
      limitsError
        ? { data: null, error: { message: 'boom' } }
        : { data: limits === undefined ? null : { value: limits }, error: null }
    )
  )
  chain.rpc = vi.fn(() => {
    if (rpcThrows) throw new Error('network down')
    return Promise.resolve(
      rpcError
        ? { data: null, error: { message: 'rpc failed' } }
        : { data: [{ daily_usd: daily, monthly_usd: monthly }], error: null }
    )
  })
  return chain as unknown as SupabaseClient
}

describe('checkModelCostLimit', () => {
  it('allows when the model is under both caps', async () => {
    const client = makeClient({
      limits: { 'gpt-image-2': { daily_usd: 50, monthly_usd: 900, enabled: true } },
      daily: 10,
      monthly: 100,
    })
    await expect(checkModelCostLimit(client, 'gpt-image-2')).resolves.toEqual({ allowed: true })
  })

  it('blocks when the daily cap is reached', async () => {
    const client = makeClient({
      limits: { 'gpt-image-2': { daily_usd: 50, monthly_usd: 900 } },
      daily: 50,
      monthly: 100,
    })
    const verdict = await checkModelCostLimit(client, 'gpt-image-2')
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toContain('daily cap')
  })

  it('blocks when the monthly cap is reached even if today is quiet', async () => {
    const client = makeClient({
      limits: { 'gpt-image-2': { daily_usd: 50, monthly_usd: 900 } },
      daily: 1,
      monthly: 900,
    })
    const verdict = await checkModelCostLimit(client, 'gpt-image-2')
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toContain('monthly cap')
  })

  it('blocks a model explicitly disabled regardless of spend', async () => {
    const client = makeClient({
      limits: { 'gpt-image-2': { daily_usd: 50, enabled: false } },
      daily: 0,
    })
    const verdict = await checkModelCostLimit(client, 'gpt-image-2')
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toContain('disabled')
  })

  it('treats a null bound as "no limit"', async () => {
    const client = makeClient({
      limits: { 'gpt-image-2': { daily_usd: null, monthly_usd: null } },
      daily: 9999,
      monthly: 9999,
    })
    await expect(checkModelCostLimit(client, 'gpt-image-2')).resolves.toEqual({ allowed: true })
  })

  it('allows a model with no configured limit', async () => {
    const client = makeClient({ limits: { 'nano-banana-2': { daily_usd: 1 } }, daily: 500 })
    await expect(checkModelCostLimit(client, 'gpt-image-2')).resolves.toEqual({ allowed: true })
  })

  // --- fail-open paths -----------------------------------------------------

  it('fails OPEN when the limits row is unreadable', async () => {
    const client = makeClient({ limitsError: true, daily: 9999 })
    await expect(checkModelCostLimit(client, 'gpt-image-2')).resolves.toEqual({ allowed: true })
  })

  it('fails OPEN when no limits are configured at all', async () => {
    const client = makeClient({ limits: undefined })
    await expect(checkModelCostLimit(client, 'gpt-image-2')).resolves.toEqual({ allowed: true })
  })

  it('fails OPEN when the spend RPC errors', async () => {
    const client = makeClient({
      limits: { 'gpt-image-2': { daily_usd: 1 } },
      rpcError: true,
    })
    await expect(checkModelCostLimit(client, 'gpt-image-2')).resolves.toEqual({ allowed: true })
  })

  it('fails OPEN when the spend RPC throws', async () => {
    const client = makeClient({
      limits: { 'gpt-image-2': { daily_usd: 1 } },
      rpcThrows: true,
    })
    await expect(checkModelCostLimit(client, 'gpt-image-2')).resolves.toEqual({ allowed: true })
  })
})
