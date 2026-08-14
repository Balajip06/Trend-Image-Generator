/**
 * REAL-DATA-PATH tests for revenue + refund accounting in `margin.ts`.
 *
 * The sibling `margin.test.ts` is explicitly a "mock-path" suite: its
 * `makeEmptyClient()` returns `data: []` for every query, which forces every
 * function into its `MOCKS_ALLOWED` branch. That is why revenue could be
 * structurally $0 in production while 629 tests stayed green — the branch
 * where the bug lives was never executed.
 *
 * This file drives the opposite path: a client that returns real rows, shaped
 * exactly as Supabase stores them.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMarginSummary, getRevenueCohorts } from './margin'
import {
  AUDIT_CREDIT_CLAWBACK,
  AUDIT_CREDIT_GRANT_STRIPE,
  CHARGE_DISPUTE_CREATED,
  CHARGE_REFUNDED,
  CHECKOUT_SESSION_COMPLETED,
  CHECKOUT_SESSION_VIA_CLIENT_REF,
  INVOICE_PAID,
  SUBSCRIPTION_UPDATED,
} from './__fixtures__/stripe-events'

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}))

type TableRows = Record<string, unknown[]>

/**
 * Builds a Supabase client stub that returns per-table rows, so the real
 * (non-mock) code path executes.
 *
 * Each `.from(table)` returns a FRESH chain bound to that table's rows. A
 * single shared chain does not work here: these functions issue several
 * queries inside one `Promise.all`, so a shared cursor would be overwritten
 * by the last `.from()` before any of them resolved, and every query would
 * see the same rows.
 */
function makeClientReturning(rows: TableRows): SupabaseClient {
  function chainFor(table: string): Record<string, unknown> {
    // `.eq()` is applied for real. Without it the stub would return every row
    // regardless of filter, so a query narrowing on `action` (grant vs
    // clawback) would appear broken even when correct.
    let data = [...(rows[table] ?? [])]
    const chain: Record<string, unknown> = {}
    const passthrough = () => chain

    // Filter only on columns the fixture rows actually carry. Fixtures omit
    // scoping columns like `status`/`source` that the production queries also
    // filter on; treating those as non-matches would empty every result set
    // and silently push the code into its mock branch — the very branch these
    // tests exist to bypass.
    chain.eq = vi.fn((column: string, value: unknown) => {
      data = data.filter((row) => {
        const record = row as Record<string, unknown>
        return !(column in record) || record[column] === value
      })
      return chain
    })
    for (const method of ['select', 'gte', 'lt', 'in', 'order', 'limit']) {
      chain[method] = vi.fn(passthrough)
    }
    chain.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: data[0] ?? null, error: null, count: data.length })
    )
    // fetchAllPaged reads via .range(from, to): whole set on page 0, then empty
    // so paging terminates.
    chain.range = vi.fn((from: number) =>
      Promise.resolve(
        from === 0
          ? { data, error: null, count: data.length }
          : { data: [], error: null, count: 0 }
      )
    )
    chain.then = (resolve: (v: { data: unknown[]; error: null; count: number }) => unknown) =>
      Promise.resolve({ data, error: null, count: data.length }).then(resolve)
    return chain
  }

  return { from: vi.fn((table: string) => chainFor(table)) } as unknown as SupabaseClient
}

/** `webhook_events` row shape: the whole Stripe event lives in `payload`. */
function webhookRow(event: unknown, createdAt = new Date().toISOString()) {
  return { payload: event, created_at: createdAt }
}

function auditRow(entry: unknown, createdAt = new Date().toISOString()) {
  return { ...(entry as Record<string, unknown>), created_at: createdAt }
}

describe('getMarginSummary — revenue extraction', () => {
  it('counts a completed checkout session as revenue', async () => {
    const supabase = makeClientReturning({
      generations: [{ cost_usd: 0.0239, trend_id: 'trend-1' }],
      webhook_events: [webhookRow(CHECKOUT_SESSION_COMPLETED)],
      anonymous_attempts: [],
    })

    const result = await getMarginSummary(supabase)

    // amount_total is 1499 cents === $14.99. Reading `payload.amount_total`
    // (rather than `payload.data.object.amount_total`) yields 0.
    expect(result.weekRevenueUsd).toBeCloseTo(14.99, 2)
    expect(result.isMock).toBeFalsy()
  })

  it('counts subscription revenue from invoice.paid (amount_paid, not amount_total)', async () => {
    const supabase = makeClientReturning({
      generations: [],
      webhook_events: [webhookRow(INVOICE_PAID)],
      anonymous_attempts: [],
    })

    const result = await getMarginSummary(supabase)

    expect(result.weekRevenueUsd).toBeCloseTo(9.99, 2)
  })

  it('does NOT count refunds or disputes as positive revenue', async () => {
    const supabase = makeClientReturning({
      generations: [],
      webhook_events: [webhookRow(CHARGE_REFUNDED), webhookRow(CHARGE_DISPUTE_CREATED)],
      anonymous_attempts: [],
    })

    const result = await getMarginSummary(supabase)

    // A naive `amount` reader would score these as +$14.99 and +$4.99.
    expect(result.weekRevenueUsd).toBe(0)
  })

  it('ignores non-revenue event types', async () => {
    const supabase = makeClientReturning({
      generations: [],
      webhook_events: [webhookRow(SUBSCRIPTION_UPDATED)],
      anonymous_attempts: [],
    })

    const result = await getMarginSummary(supabase)

    expect(result.weekRevenueUsd).toBe(0)
  })

  it('sums a mixed batch to income net of refunds', async () => {
    const supabase = makeClientReturning({
      generations: [],
      webhook_events: [
        webhookRow(CHECKOUT_SESSION_COMPLETED), // +14.99
        webhookRow(CHECKOUT_SESSION_VIA_CLIENT_REF), // + 4.99
        webhookRow(INVOICE_PAID), // + 9.99
        webhookRow(CHARGE_REFUNDED), // -14.99 (refund of the first sale)
        webhookRow(SUBSCRIPTION_UPDATED), // +/- 0 (lifecycle only)
      ],
      anonymous_attempts: [],
    })

    const result = await getMarginSummary(supabase)

    // 29.97 gross − 14.99 refunded = 14.98 net.
    expect(result.weekRevenueUsd).toBeCloseTo(14.98, 2)
  })

  it('reports margin honestly when there is spend but no revenue', async () => {
    const supabase = makeClientReturning({
      generations: [{ cost_usd: 0.04, trend_id: 'trend-1' }],
      webhook_events: [webhookRow(SUBSCRIPTION_UPDATED)],
      anonymous_attempts: [],
    })

    const result = await getMarginSummary(supabase)

    expect(result.weekSpendUsd).toBeGreaterThan(0)
    expect(result.weekRevenueUsd).toBe(0)
    // Burning money with no income is not "0.0% margin" — it must not read
    // as break-even.
    expect(result.marginPct).not.toBe(0)
    expect(result.marginPct).toBeLessThan(0)
  })

  it('does not let a malformed cost_usd poison the spend sum', async () => {
    const supabase = makeClientReturning({
      generations: [
        { cost_usd: 0.02, trend_id: 'trend-1' },
        { cost_usd: 'not-a-number' as unknown as number, trend_id: 'trend-2' },
      ],
      webhook_events: [webhookRow(CHECKOUT_SESSION_COMPLETED)],
      anonymous_attempts: [],
    })

    const result = await getMarginSummary(supabase)

    expect(Number.isFinite(result.weekSpendUsd)).toBe(true)
    expect(result.weekSpendUsd).toBeCloseTo(0.02, 5)
  })
})

describe('getRevenueCohorts — refund accounting', () => {
  it('counts credit_clawback rows as refunds', async () => {
    const supabase = makeClientReturning({
      webhook_events: [webhookRow(CHECKOUT_SESSION_COMPLETED)],
      admin_audit_log: [auditRow(AUDIT_CREDIT_CLAWBACK)],
    })

    const rows = await getRevenueCohorts(supabase, 12)
    const totalRefunds = rows.reduce((sum, r) => sum + r.refundsUsd, 0)

    // `credit_clawback` is what claw_back_credits() writes. Reading
    // `credit_grant` + a non-existent `credits` key yields 0.
    expect(totalRefunds).toBeGreaterThan(0)
  })

  it('does NOT count a Stripe purchase grant as a refund', async () => {
    const supabase = makeClientReturning({
      webhook_events: [webhookRow(CHECKOUT_SESSION_COMPLETED)],
      admin_audit_log: [auditRow(AUDIT_CREDIT_GRANT_STRIPE)],
    })

    const rows = await getRevenueCohorts(supabase, 12)
    const totalRefunds = rows.reduce((sum, r) => sum + r.refundsUsd, 0)

    // Counting grants as refunds would make net revenue negative on every
    // successful sale.
    expect(totalRefunds).toBe(0)
  })

  it('returns honest zeros (never mock data) when the query throws', async () => {
    const exploding = {
      from: vi.fn(() => {
        throw new Error('connection reset')
      }),
    } as unknown as SupabaseClient

    const rows = await getRevenueCohorts(exploding, 12)
    const totalRevenue = rows.reduce((sum, r) => sum + r.revenueUsd, 0)

    // Previously this returned `mockRevenueCohorts()`, so a DB outage rendered
    // fabricated revenue that looked exactly like real figures.
    expect(rows).toHaveLength(12)
    expect(totalRevenue).toBe(0)
    expect(rows.every((r) => !r.isMock)).toBe(true)
  })

  it('flags mock cohort rows so the UI can badge them', async () => {
    const supabase = makeClientReturning({ webhook_events: [], admin_audit_log: [] })

    const rows = await getRevenueCohorts(supabase, 12)

    // MOCKS_ALLOWED is true under vitest, so the empty-data path returns demo
    // rows — which must be identifiable as demo data.
    expect(rows.every((r) => r.isMock)).toBe(true)
  })

  it('records revenue for the cohort week', async () => {
    const supabase = makeClientReturning({
      webhook_events: [webhookRow(CHECKOUT_SESSION_COMPLETED)],
      admin_audit_log: [],
    })

    const rows = await getRevenueCohorts(supabase, 12)
    const totalRevenue = rows.reduce((sum, r) => sum + r.revenueUsd, 0)

    expect(totalRevenue).toBeCloseTo(14.99, 2)
  })
})
