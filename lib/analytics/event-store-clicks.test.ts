/**
 * Regression tests for click counting in `event-store-db`.
 *
 * `trend_events.type` is a 3-value enum: 'impression' | 'click_generate' |
 * 'quota_blocked' (see event-store-types.ts, and the CHECK constraint in
 * migration 20260529000009). Both aggregators classified rows as
 * `if (type === 'impression') impressions++ else clicks++`, so every
 * `quota_blocked` row — written by the quota trigger, not by /api/track —
 * was counted as a CLICK.
 *
 * Effect: inflated clicks and CTR on /admin/engagement, getting worse exactly
 * as more users hit the free-tier cap. Neither aggregator filtered on `type`,
 * and no existing test fed a `quota_blocked` row through them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}))

type Row = { trend_slug: string; type: string; occurred_at: string }

let mockRows: Row[] = []

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => {
    const chain: Record<string, unknown> = {}
    const passthrough = () => chain
    for (const method of ['from', 'select', 'eq', 'gte', 'in']) {
      chain[method] = vi.fn(passthrough)
    }
    chain.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
      Promise.resolve({ data: mockRows, error: null }).then(resolve)
    return chain
  }),
}))

import { getCountsBatchDb, getDailySeriesDb } from './event-store-db'

const SLUG = 'action-figure'

function row(type: string, occurredAt = new Date().toISOString()): Row {
  return { trend_slug: SLUG, type, occurred_at: occurredAt }
}

beforeEach(() => {
  mockRows = []
})

describe('getCountsBatchDb — event type classification', () => {
  it('counts impressions and clicks separately', async () => {
    mockRows = [row('impression'), row('impression'), row('click_generate')]

    const counts = await getCountsBatchDb([SLUG])

    expect(counts.get(SLUG)).toEqual({ impressions: 2, clicks: 1 })
  })

  it('does NOT count quota_blocked rows as clicks', async () => {
    mockRows = [row('impression'), row('quota_blocked'), row('quota_blocked')]

    const counts = await getCountsBatchDb([SLUG])

    // The `else clicks++` branch scored both quota blocks as clicks, which
    // reported a 200% CTR for this slug.
    expect(counts.get(SLUG)).toEqual({ impressions: 1, clicks: 0 })
  })

  it('ignores unrecognized event types rather than defaulting them to clicks', async () => {
    mockRows = [row('impression'), row('some_future_event_type')]

    const counts = await getCountsBatchDb([SLUG])

    expect(counts.get(SLUG)).toEqual({ impressions: 1, clicks: 0 })
  })
})

describe('getDailySeriesDb — event type classification', () => {
  it('does NOT count quota_blocked rows as clicks', async () => {
    const today = new Date().toISOString()
    mockRows = [row('impression', today), row('click_generate', today), row('quota_blocked', today)]

    const series = await getDailySeriesDb([SLUG], 7)
    const totals = series.reduce(
      (acc, point) => ({
        impressions: acc.impressions + point.impressions,
        clicks: acc.clicks + point.clicks,
      }),
      { impressions: 0, clicks: 0 }
    )

    expect(totals).toEqual({ impressions: 1, clicks: 1 })
  })
})
