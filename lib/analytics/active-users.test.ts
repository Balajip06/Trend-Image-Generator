/**
 * Mock-path tests for `active-users.ts`. Every function falls back to a
 * deterministic mock payload when the underlying Supabase tables return no
 * rows. We exercise that path by stubbing the client with an empty-result
 * chain.
 *
 * No Sentry / no env vars are needed; the source guards every query with
 * try/catch + Sentry.captureMessage on errors.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getActiveUserCounts,
  getCacByChannel,
  getDailyActiveSeries,
  getSignupSources,
  getFunnel,
  getCohortRetention,
} from './active-users'

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}))

/**
 * Build a Supabase-shaped chain that always resolves to `{ data: [], error: null }`
 * regardless of the builder method chain (`.from().select().eq().gte()` etc.).
 *
 * The chain itself is the awaited PromiseLike: the source code awaits the
 * builder directly, e.g. `const { data, error } = await supabase.from(...)...gte(...)`.
 */
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

describe('getActiveUserCounts', () => {
  it('returns deterministic mock counts when generations table is empty', async () => {
    const supabase = makeEmptyClient()
    const result = await getActiveUserCounts(supabase)
    expect(result.isMock).toBe(true)
    expect(result.dau).toBeGreaterThan(0)
    expect(result.wau).toBeGreaterThanOrEqual(result.dau)
    expect(result.mau).toBeGreaterThanOrEqual(result.wau)
  })

  it('prior counts are non-negative and the shape includes all six counts', async () => {
    const supabase = makeEmptyClient()
    const result = await getActiveUserCounts(supabase)
    expect(result.priorDau).toBeGreaterThanOrEqual(0)
    expect(result.priorWau).toBeGreaterThanOrEqual(0)
    expect(result.priorMau).toBeGreaterThanOrEqual(0)
    // Per-window prior should not exceed current-window for healthy launch mock.
    expect(result.priorDau).toBeLessThanOrEqual(result.dau)
    expect(result.priorWau).toBeLessThanOrEqual(result.wau)
    expect(result.priorMau).toBeLessThanOrEqual(result.mau)
  })
})

describe('getDailyActiveSeries', () => {
  it('returns exactly 7 entries when asked for 7 days', async () => {
    const supabase = makeEmptyClient()
    const series = await getDailyActiveSeries(supabase, 7)
    expect(series).toHaveLength(7)
    for (const point of series) {
      expect(point.dau).toBeGreaterThanOrEqual(0)
      expect(point.label).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/)
      expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('returns 30 entries when asked for 30 days', async () => {
    const supabase = makeEmptyClient()
    const series = await getDailyActiveSeries(supabase, 30)
    expect(series).toHaveLength(30)
  })
})

describe('getSignupSources', () => {
  it('returns at least one source row with count > 0 from the mock', async () => {
    const supabase = makeEmptyClient()
    const sources = await getSignupSources(supabase, 30)
    expect(sources.length).toBeGreaterThan(0)
    for (const row of sources) {
      expect(typeof row.source).toBe('string')
      expect(row.count).toBeGreaterThan(0)
    }
  })

  it('is sorted by count descending (mock is pre-sorted)', async () => {
    const supabase = makeEmptyClient()
    const sources = await getSignupSources(supabase, 30)
    for (let i = 1; i < sources.length; i++) {
      expect(sources[i - 1].count).toBeGreaterThanOrEqual(sources[i].count)
    }
  })
})

describe('getFunnel', () => {
  it('returns four steps in mock mode', async () => {
    const supabase = makeEmptyClient()
    const steps = await getFunnel(supabase, 30)
    expect(steps).toHaveLength(4)
    expect(steps.map((s) => s.label)).toEqual([
      'Signup',
      'First gen',
      'First purchase',
      'Repeat purchase',
    ])
  })

  it('each step count is <= the previous step (funnel monotonic)', async () => {
    const supabase = makeEmptyClient()
    const steps = await getFunnel(supabase, 30)
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].count).toBeLessThanOrEqual(steps[i - 1].count)
    }
  })

  it('signup step conversion is 100 by convention', async () => {
    const supabase = makeEmptyClient()
    const steps = await getFunnel(supabase, 30)
    expect(steps[0].conversion).toBe(100)
  })

  it('non-signup steps have conversion between 0 and 100', async () => {
    const supabase = makeEmptyClient()
    const steps = await getFunnel(supabase, 30)
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].conversion).toBeGreaterThanOrEqual(0)
      expect(steps[i].conversion).toBeLessThanOrEqual(100)
    }
  })
})

describe('getCohortRetention', () => {
  it('returns up to 8 cohort rows when asked for 8 weeks', async () => {
    const supabase = makeEmptyClient()
    const rows = await getCohortRetention(supabase, 8)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(8)
  })

  it('each cohort row has cohortSize >= 5 (small denominators are filtered)', async () => {
    const supabase = makeEmptyClient()
    const rows = await getCohortRetention(supabase, 8)
    for (const row of rows) {
      expect(row.cohortSize).toBeGreaterThanOrEqual(5)
    }
  })

  it('retention shape: cohortWeek matches YYYY-MM-DD and w1/w2/w4/w8 are >= 0', async () => {
    const supabase = makeEmptyClient()
    const rows = await getCohortRetention(supabase, 8)
    for (const row of rows) {
      expect(row.cohortWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(row.w1).toBeGreaterThanOrEqual(0)
      expect(row.w2).toBeGreaterThanOrEqual(0)
      expect(row.w4).toBeGreaterThanOrEqual(0)
      expect(row.w8).toBeGreaterThanOrEqual(0)
    }
  })
})

// -----------------------------------------------------------------------------
// getCacByChannel
//
// Needs a slightly richer mock than `makeEmptyClient`: it queries two tables
// (`admin_marketing_spend` and `profiles`) and must return different rows per
// table. The factory below builds a client where `.from(table)` returns a
// thenable resolving to the per-table fixture.
// -----------------------------------------------------------------------------

interface CacFixtures {
  spend: Array<{ week_start: string; channel: string; usd_spent: number | string }>
  profiles: Array<{
    id: string
    created_at: string
    acquisition_source: Record<string, unknown> | null
  }>
}

function makeCacClient(fixtures: CacFixtures): SupabaseClient {
  function buildChain(rows: unknown[]): Record<string, unknown> {
    const result = { data: rows, error: null, count: rows.length }
    const chain: Record<string, unknown> = {}
    const passthrough = () => chain
    chain.select = vi.fn(passthrough)
    chain.gte = vi.fn(passthrough)
    chain.lt = vi.fn(passthrough)
    chain.eq = vi.fn(passthrough)
    chain.in = vi.fn(passthrough)
    chain.order = vi.fn(passthrough)
    chain.limit = vi.fn(passthrough)
    chain.maybeSingle = vi.fn(() => Promise.resolve(result))
    // fetchAllPaged reads via .range(from, to). Serve the whole fixture on the
    // first page and an empty slice afterwards, so paging terminates.
    chain.range = vi.fn((from: number) =>
      Promise.resolve(from === 0 ? result : { data: [], error: null, count: 0 })
    )
    chain.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve)
    return chain
  }
  const client: Record<string, unknown> = {
    from: vi.fn((table: string) => {
      if (table === 'admin_marketing_spend') return buildChain(fixtures.spend)
      if (table === 'profiles') return buildChain(fixtures.profiles)
      // Fallback for any other table getCacByChannel might transitively touch
      // (e.g. generations via cohort code — though it doesn't, this guards
      // against test brittleness if the implementation evolves).
      return buildChain([])
    }),
  }
  return client as unknown as SupabaseClient
}

describe('getCacByChannel', () => {
  it('returns an EMPTY map when admin_marketing_spend has no rows', async () => {
    // Empty-spend table is a distinct state from mock-mode — buyers see `—`
    // placeholders, not synthetic CAC numbers.
    const supabase = makeCacClient({
      spend: [],
      profiles: [
        {
          id: 'u1',
          created_at: new Date().toISOString(),
          acquisition_source: { utm_source: 'tiktok' },
        },
      ],
    })
    const result = await getCacByChannel(supabase, 30)
    expect(result.size).toBe(0)
  })

  it('computes CAC for a normal channel with both spend and signups', async () => {
    // tiktok: $300 / 6 signups = $50 CAC.
    const today = new Date()
    const weekStart = today.toISOString().slice(0, 10)
    const supabase = makeCacClient({
      spend: [{ week_start: weekStart, channel: 'tiktok', usd_spent: 300 }],
      profiles: Array.from({ length: 6 }, (_, i) => ({
        id: `u${i}`,
        created_at: today.toISOString(),
        acquisition_source: { utm_source: 'tiktok' },
      })),
    })
    const result = await getCacByChannel(supabase, 30)
    const tiktok = result.get('tiktok')
    expect(tiktok).toBeDefined()
    expect(tiktok?.spendUsd).toBe(300)
    expect(tiktok?.signupCount).toBe(6)
    expect(tiktok?.cacUsd).toBe(50)
  })

  it('returns cacUsd=null (infinite) when spend exists but no signups for channel', async () => {
    // reddit: $200 spent, 0 signups attributed → null sentinel.
    const today = new Date()
    const supabase = makeCacClient({
      spend: [{ week_start: today.toISOString().slice(0, 10), channel: 'reddit', usd_spent: 200 }],
      profiles: [], // no signups at all
    })
    const result = await getCacByChannel(supabase, 30)
    const reddit = result.get('reddit')
    expect(reddit).toBeDefined()
    expect(reddit?.spendUsd).toBe(200)
    expect(reddit?.signupCount).toBe(0)
    expect(reddit?.cacUsd).toBeNull()
  })

  it('returns cacUsd=0 (organic) for a channel with signups but no spend', async () => {
    // Twitter: 4 signups, $0 spend (because spend table has rows for tiktok
    // only — the spend table is non-empty so we enter the CAC-render path).
    const today = new Date()
    const weekStart = today.toISOString().slice(0, 10)
    const supabase = makeCacClient({
      spend: [{ week_start: weekStart, channel: 'tiktok', usd_spent: 100 }],
      profiles: [
        ...Array.from({ length: 4 }, (_, i) => ({
          id: `t${i}`,
          created_at: today.toISOString(),
          acquisition_source: { utm_source: 'twitter' },
        })),
        // one tiktok signup so the tiktok row has a finite CAC
        {
          id: 'tk1',
          created_at: today.toISOString(),
          acquisition_source: { utm_source: 'tiktok' },
        },
      ],
    })
    const result = await getCacByChannel(supabase, 30)
    const twitter = result.get('twitter')
    expect(twitter).toBeDefined()
    expect(twitter?.spendUsd).toBe(0)
    expect(twitter?.signupCount).toBe(4)
    expect(twitter?.cacUsd).toBe(0)
  })

  it('combines all four cases in a single window', async () => {
    // tiktok: $300, 6 signups → $50 CAC (normal)
    // reddit: $200, 0 signups → null (infinite)
    // twitter: $0, 4 signups → 0 (organic, present because spend table is non-empty)
    // instagram: $80, 2 signups → $40 CAC (normal, second channel)
    const today = new Date()
    const weekStart = today.toISOString().slice(0, 10)
    const supabase = makeCacClient({
      spend: [
        { week_start: weekStart, channel: 'tiktok', usd_spent: 300 },
        { week_start: weekStart, channel: 'reddit', usd_spent: 200 },
        { week_start: weekStart, channel: 'instagram', usd_spent: 80 },
      ],
      profiles: [
        ...Array.from({ length: 6 }, (_, i) => ({
          id: `tk${i}`,
          created_at: today.toISOString(),
          acquisition_source: { utm_source: 'tiktok' },
        })),
        ...Array.from({ length: 4 }, (_, i) => ({
          id: `t${i}`,
          created_at: today.toISOString(),
          acquisition_source: { utm_source: 'twitter' },
        })),
        ...Array.from({ length: 2 }, (_, i) => ({
          id: `ig${i}`,
          created_at: today.toISOString(),
          acquisition_source: { utm_source: 'instagram' },
        })),
      ],
    })
    const result = await getCacByChannel(supabase, 30)
    expect(result.get('tiktok')?.cacUsd).toBe(50)
    expect(result.get('reddit')?.cacUsd).toBeNull()
    expect(result.get('twitter')?.cacUsd).toBe(0)
    expect(result.get('instagram')?.cacUsd).toBe(40)
  })

  it('sums spend across multiple weeks for the same channel', async () => {
    // Two weeks of $100 each = $200 total; 4 signups → $50 CAC.
    const today = new Date()
    const thisWeek = today.toISOString().slice(0, 10)
    const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const supabase = makeCacClient({
      spend: [
        { week_start: thisWeek, channel: 'tiktok', usd_spent: 100 },
        { week_start: lastWeek, channel: 'tiktok', usd_spent: 100 },
      ],
      profiles: Array.from({ length: 4 }, (_, i) => ({
        id: `u${i}`,
        created_at: today.toISOString(),
        acquisition_source: { utm_source: 'tiktok' },
      })),
    })
    const result = await getCacByChannel(supabase, 30)
    const tiktok = result.get('tiktok')
    expect(tiktok?.spendUsd).toBe(200)
    expect(tiktok?.signupCount).toBe(4)
    expect(tiktok?.cacUsd).toBe(50)
  })

  it('normalises channel keys with trim + lowercase on both sides', async () => {
    // Spend channel "TikTok" should match utm_source "  tiktok  ".
    const today = new Date()
    const supabase = makeCacClient({
      spend: [
        {
          week_start: today.toISOString().slice(0, 10),
          channel: 'TikTok', // unusual capitalisation
          usd_spent: 100,
        },
      ],
      profiles: [
        {
          id: 'u1',
          created_at: today.toISOString(),
          acquisition_source: { utm_source: '  tiktok  ' },
        },
      ],
    })
    const result = await getCacByChannel(supabase, 30)
    expect(result.get('tiktok')?.cacUsd).toBe(100)
  })
})
