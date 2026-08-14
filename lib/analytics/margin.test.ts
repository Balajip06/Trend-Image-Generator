/**
 * Mock-path tests for `margin.ts`. Each public function falls back to a
 * deterministic mock when Supabase reads return no rows (or returns mock
 * directly via the `forceMock` option for `getMarginDetail`).
 */

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getRevenueCohorts, getUnitEconomics, getMarginDetail, getTrendLeaderboard } from './margin'

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}))

function makeEmptyClient(): SupabaseClient {
  const emptyResult = { data: [], error: null, count: 0 }
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  chain.select = vi.fn(passthrough)
  chain.from = vi.fn(passthrough)
  chain.gte = vi.fn(passthrough)
  chain.lt = vi.fn(passthrough)
  chain.eq = vi.fn(passthrough)
  chain.in = vi.fn(passthrough)
  chain.order = vi.fn(passthrough)
  chain.limit = vi.fn(passthrough)
  chain.maybeSingle = vi.fn(() => Promise.resolve(emptyResult))
  // fetchAllPaged drives reads through .range(); it must RESOLVE, not chain.
  chain.range = vi.fn(() => Promise.resolve(emptyResult))
  chain.then = (resolve: (v: typeof emptyResult) => unknown) =>
    Promise.resolve(emptyResult).then(resolve)
  return chain as unknown as SupabaseClient
}

describe('getRevenueCohorts', () => {
  it('returns 12 cohort rows in mock mode', async () => {
    const supabase = makeEmptyClient()
    const rows = await getRevenueCohorts(supabase, 12)
    expect(rows).toHaveLength(12)
  })

  it('each row has the expected numeric shape with netUsd === revenue - refunds', async () => {
    const supabase = makeEmptyClient()
    const rows = await getRevenueCohorts(supabase, 12)
    for (const row of rows) {
      expect(row.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(row.revenueUsd).toBeGreaterThanOrEqual(0)
      expect(row.refundsUsd).toBeGreaterThanOrEqual(0)
      expect(row.txCount).toBeGreaterThanOrEqual(0)
      expect(row.uniqueCustomers).toBeGreaterThanOrEqual(0)
      // netUsd == revenueUsd - refundsUsd, allowing for rounding to 2dp.
      expect(row.netUsd).toBeCloseTo(row.revenueUsd - row.refundsUsd, 2)
    }
  })

  it('refundRate is between 0 and 1', async () => {
    const supabase = makeEmptyClient()
    const rows = await getRevenueCohorts(supabase, 12)
    for (const row of rows) {
      expect(row.refundRate).toBeGreaterThanOrEqual(0)
      expect(row.refundRate).toBeLessThanOrEqual(1)
    }
  })
})

describe('getUnitEconomics', () => {
  it('returns mock shape when no marketing-spend + no profiles exist', async () => {
    const supabase = makeEmptyClient()
    const result = await getUnitEconomics(supabase)
    expect(result.isMock).toBe(true)
    expect(Array.isArray(result.cacByChannel)).toBe(true)
    expect(Array.isArray(result.ltvByCohort)).toBe(true)
    expect(typeof result.blendedCac).toBe('number')
    expect(typeof result.blendedLtv30).toBe('number')
    expect(typeof result.paybackDays).toBe('number')
  })

  it('paybackDays > 0 when blendedCac > 0 and blendedLtv30 > 0', async () => {
    const supabase = makeEmptyClient()
    const result = await getUnitEconomics(supabase)
    if (result.blendedCac > 0 && result.blendedLtv30 > 0) {
      expect(result.paybackDays).toBeGreaterThan(0)
    }
  })

  it('cacByChannel entries have non-negative spend + signups', async () => {
    const supabase = makeEmptyClient()
    const result = await getUnitEconomics(supabase)
    for (const row of result.cacByChannel) {
      expect(typeof row.channel).toBe('string')
      expect(row.spendUsd).toBeGreaterThanOrEqual(0)
      expect(row.signupsAttributed).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('getMarginDetail', () => {
  it('returns isMock=true when forceMock option set, even with otherwise-real client', async () => {
    const supabase = makeEmptyClient()
    const result = await getMarginDetail(supabase, 7, { forceMock: true })
    expect(result.isMock).toBe(true)
    expect(result.daily).toHaveLength(7)
    expect(result.trendBreakdown.length).toBeGreaterThan(0)
    expect(result.priorWeek.revenueUsd).toBeGreaterThanOrEqual(0)
  })

  it('respects custom day count under forceMock', async () => {
    const supabase = makeEmptyClient()
    const result = await getMarginDetail(supabase, 14, { forceMock: true })
    expect(result.daily).toHaveLength(14)
  })
})

describe('getTrendLeaderboard', () => {
  it('returns at most the requested limit', async () => {
    const supabase = makeEmptyClient()
    const rows = await getTrendLeaderboard(supabase, { days: 30, limit: 20 })
    expect(rows.length).toBeLessThanOrEqual(20)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('respects a smaller limit', async () => {
    const supabase = makeEmptyClient()
    const rows = await getTrendLeaderboard(supabase, { days: 30, limit: 3 })
    expect(rows.length).toBeLessThanOrEqual(3)
  })

  it('each row has the expected shape', async () => {
    const supabase = makeEmptyClient()
    const rows = await getTrendLeaderboard(supabase, { days: 30, limit: 20 })
    for (const row of rows) {
      expect(typeof row.trendId).toBe('string')
      expect(typeof row.slug).toBe('string')
      expect(typeof row.title).toBe('string')
      expect(row.genCount).toBeGreaterThanOrEqual(0)
      expect(row.shareTotal).toBeGreaterThanOrEqual(0)
      expect(row.paidUsersCount).toBeGreaterThanOrEqual(0)
      expect(typeof row.revenueUsd).toBe('number')
    }
  })
})
