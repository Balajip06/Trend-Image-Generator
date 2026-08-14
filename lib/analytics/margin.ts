/**
 * Daily-margin summary for the admin dashboard.
 *
 * Reads from `generations.cost_usd` (real Gemini calls after creds land) and
 * `webhook_events` (Stripe revenue) where available. Falls back to a
 * deterministic mock so the admin tile renders meaningfully during dev /
 * pre-launch when both data sources are empty.
 *
 * Swap the mock branch for real per-day SQL aggregates when Stripe revenue
 * has flow — the external contract (getMarginSummary) stays stable.
 */

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MOCKS_ALLOWED } from '@/lib/dev/mock-data'
import { fetchAllPaged } from './paged-fetch'
import { CREDIT_PACKS } from '@/lib/payments/packs'
import {
  customerEmailFromEvent,
  refundUsdFromEvent,
  revenueUsdFromEvent,
  userIdFromEvent,
} from './stripe-payload'

/**
 * `cost_usd` is `numeric(10,5)`, which PostgREST may deliver as a string. A
 * malformed or non-numeric value would become NaN and poison an entire running
 * sum, turning every downstream figure into `$NaN`. Coerce defensively.
 */
function safeUsd(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * USD value of one credit, for pricing clawed-back credits.
 *
 * Derived from the real pack table rather than the previous hardcoded $0.10,
 * which matched no pack (actual rates run 6.665¢–9.98¢/credit). Blended across
 * packs because the audit row records a credit count, not which pack it came
 * from.
 */
const CREDIT_USD_RATE =
  CREDIT_PACKS.reduce((sum, p) => sum + p.priceCents, 0) /
  CREDIT_PACKS.reduce((sum, p) => sum + p.credits, 0) /
  100

export interface MarginSummary {
  weekSpendUsd: number
  weekRevenueUsd: number
  weekGenerations: number
  avgCostUsd: number
  marginPct: number
  topTrendTitle: string | null
  topTrendSpendUsd: number
  isMock: boolean
}

export interface MarginDailyPoint {
  /** ISO date (YYYY-MM-DD) for the UTC day. */
  date: string
  /** Short axis label, e.g. "Mon". */
  label: string
  revenueUsd: number
  spendUsd: number
  generations: number
}

export interface MarginDetail extends MarginSummary {
  daily: MarginDailyPoint[]
  priorWeek: { revenueUsd: number; spendUsd: number; generations: number }
  trendBreakdown: {
    trendId: string
    title: string
    spendUsd: number
    generations: number
  }[]
}

const MOCK_SUMMARY: Omit<MarginSummary, 'isMock'> = {
  // Deterministic week-1 numbers. Designed to read like a slow-but-healthy
  // launch so the dashboard feels alive before real traffic.
  weekSpendUsd: 14.62,
  weekRevenueUsd: 89.95,
  weekGenerations: 612,
  avgCostUsd: 0.0239,
  marginPct: 83.7,
  topTrendTitle: 'Action figure in box',
  topTrendSpendUsd: 4.18,
}

interface GenerationRow {
  cost_usd: number | null
  trend_id: string
  created_at?: string
}

interface TrendBriefRow {
  id: string
  title: string
}

interface WebhookEventRow {
  /**
   * The whole `Stripe.Event`. Money lives at `payload.data.object.*` — read it
   * via the helpers in `./stripe-payload`, never off the top level.
   */
  payload: unknown
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Lookback for the "has this user ever paid" heuristic on the leaderboard.
 * Was literally "ever" (no date filter), which meant a full-table scan of
 * `webhook_events` on every render, growing without bound. A year is well past
 * any credit pack's useful life for this signal.
 */
const PAID_USER_LOOKBACK_DAYS = 365
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function djb2(input: string): number {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i)
  }
  return Math.abs(hash)
}

function emptyDays(days: number): MarginDailyPoint[] {
  const today = startOfUtcDay(new Date())
  return Array.from({ length: days }, (_, idx) => {
    const d = new Date(today.getTime() - (days - 1 - idx) * DAY_MS)
    return {
      date: d.toISOString().slice(0, 10),
      label: WEEKDAY_LABELS[d.getUTCDay()],
      revenueUsd: 0,
      spendUsd: 0,
      generations: 0,
    }
  })
}

function mockDailySeries(days: number): MarginDailyPoint[] {
  const series = emptyDays(days)
  const totalRev = MOCK_SUMMARY.weekRevenueUsd
  const totalSpend = MOCK_SUMMARY.weekSpendUsd
  const totalGens = MOCK_SUMMARY.weekGenerations

  // Weight curve mirrors the engagement series: gentle uptick + jitter so the
  // chart reads as "slow but healthy" instead of flat-line demo data.
  const weights: number[] = []
  let weightTotal = 0
  for (let i = 0; i < days; i++) {
    const trend = 0.6 + (i / Math.max(1, days - 1)) * 0.8
    const jitter = ((djb2(`margin:${i}`) % 100) / 100) * 0.5 + 0.75
    const w = trend * jitter
    weights.push(w)
    weightTotal += w
  }

  for (let i = 0; i < days; i++) {
    const share = weights[i] / weightTotal
    series[i].revenueUsd = Number((totalRev * share).toFixed(2))
    series[i].spendUsd = Number((totalSpend * share).toFixed(2))
    series[i].generations = Math.round(totalGens * share)
  }
  return series
}

export async function getMarginSummary(supabase: SupabaseClient): Promise<MarginSummary> {
  const weekStart = new Date(Date.now() - ONE_WEEK_MS).toISOString()

  const [genPage, webhookPage, anonPage] = await Promise.all([
    fetchAllPaged<GenerationRow>('margin.summary.generations', () =>
      supabase
        .from('generations')
        .select('cost_usd, trend_id')
        .eq('status', 'completed')
        .gte('created_at', weekStart)
    ),
    fetchAllPaged<WebhookEventRow>('margin.summary.webhooks', () =>
      supabase
        .from('webhook_events')
        .select('payload')
        .eq('source', 'stripe')
        .gte('created_at', weekStart)
    ),
    fetchAllPaged<{ cost_usd: number | null }>('margin.summary.anonymous', () =>
      supabase
        .from('anonymous_attempts')
        .select('cost_usd')
        .eq('status', 'completed')
        .gte('created_at', weekStart)
    ),
  ])

  const generations = genPage.rows
  const webhooks = webhookPage.rows
  const anonAttempts = anonPage.rows

  if (
    MOCKS_ALLOWED &&
    generations.length === 0 &&
    webhooks.length === 0 &&
    anonAttempts.length === 0
  ) {
    return { ...MOCK_SUMMARY, isMock: true }
  }

  const genSpendUsd = generations.reduce((sum, g) => sum + safeUsd(g.cost_usd), 0)
  const anonSpendUsd = anonAttempts.reduce((sum, a) => sum + safeUsd(a.cost_usd), 0)
  const weekSpendUsd = genSpendUsd + anonSpendUsd
  const weekGenerations = generations.length
  // avgCostUsd is a per-authenticated-generation metric. Use genSpendUsd only
  // (not the combined total) so anonymous spend does not inflate the average.
  const avgCostUsd = weekGenerations > 0 ? genSpendUsd / weekGenerations : 0

  // Refunds/disputes land in the same table. Net them off, but never let the
  // headline go negative: a refund is not "negative income", and a clamp keeps
  // the margin formula below meaningful.
  const grossRevenueUsd = webhooks.reduce((sum, e) => sum + revenueUsdFromEvent(e.payload), 0)
  const refundedUsd = webhooks.reduce((sum, e) => sum + refundUsdFromEvent(e.payload), 0)
  const weekRevenueUsd = Math.max(0, grossRevenueUsd - refundedUsd)

  // With no revenue, margin is not 0% (break-even) — it is undefined if there
  // was also no spend, and deeply negative if we spent anything. Reporting 0
  // made a money-losing week look neutral on the dashboard.
  const marginPct =
    weekRevenueUsd > 0
      ? ((weekRevenueUsd - weekSpendUsd) / weekRevenueUsd) * 100
      : weekSpendUsd > 0
        ? Number.NEGATIVE_INFINITY
        : 0

  // Spend per trend → top spender
  const spendByTrend = new Map<string, number>()
  for (const g of generations) {
    spendByTrend.set(g.trend_id, (spendByTrend.get(g.trend_id) ?? 0) + safeUsd(g.cost_usd))
  }

  let topTrendId: string | null = null
  let topTrendSpendUsd = 0
  for (const [id, spend] of spendByTrend) {
    if (spend > topTrendSpendUsd) {
      topTrendId = id
      topTrendSpendUsd = spend
    }
  }

  let topTrendTitle: string | null = null
  if (topTrendId) {
    const { data: trendRow } = await supabase
      .from('trends')
      .select('id, title')
      .eq('id', topTrendId)
      .maybeSingle()
    topTrendTitle = (trendRow as unknown as TrendBriefRow | null)?.title ?? null
  }

  return {
    weekSpendUsd,
    weekRevenueUsd,
    weekGenerations,
    avgCostUsd,
    marginPct,
    topTrendTitle,
    topTrendSpendUsd,
    isMock: false,
  }
}

interface WebhookEventRowWithDate extends WebhookEventRow {
  created_at?: string
}

interface TrendBreakdownRow {
  trendId: string
  title: string
  spendUsd: number
  generations: number
}

function mockTrendBreakdown(): TrendBreakdownRow[] {
  const seeded = [
    ['Action figure in box', 4.18, 168],
    ['Pet to anime portrait', 3.21, 132],
    ['Cyberpunk passport', 2.55, 96],
    ['Vintage Polaroid', 2.04, 84],
    ['Watercolor sketch', 1.34, 64],
    ['Saturday morning cartoon', 1.3, 68],
  ] as const
  return seeded.map(([title, spendUsd, generations], idx) => ({
    trendId: `mock-${idx}`,
    title,
    spendUsd,
    generations,
  }))
}

/**
 * Extended margin payload powering /admin/margin — daily revenue/spend/gen
 * series, prior-week totals for delta, and per-trend spend breakdown.
 *
 * Returns mock-shaped data when no `generations` rows + no `webhook_events`
 * exist this week (matches the fallback used in {@link getMarginSummary}).
 */
export interface TrendLeaderboardRow {
  trendId: string
  slug: string
  title: string
  genCount: number
  shareTotal: number
  paidUsersCount: number
  revenueUsd: number
  /**
   * True when this row is demo data, not a real measurement. Without this the
   * leaderboard rendered fabricated trends with no on-screen indication —
   * unlike the summary tiles, which have always carried a "demo data" badge.
   */
  isMock?: boolean
}

interface GenerationLeaderboardRow {
  trend_id: string
  user_id: string | null
  share_count: number | null
}

interface TrendLeaderboardJoinRow {
  id: string
  slug: string
  title: string
}

interface WebhookEventMetadataRow {
  /** Whole Stripe event — read via `./stripe-payload` helpers. */
  payload: unknown
}

const MOCK_LEADERBOARD: TrendLeaderboardRow[] = [
  {
    trendId: 'mock-1',
    slug: 'action-figure-in-box',
    title: 'Action figure in box',
    genCount: 312,
    shareTotal: 184,
    paidUsersCount: 42,
    revenueUsd: 0,
  },
  {
    trendId: 'mock-2',
    slug: 'pet-to-anime-portrait',
    title: 'Pet to anime portrait',
    genCount: 254,
    shareTotal: 167,
    paidUsersCount: 38,
    revenueUsd: 0,
  },
  {
    trendId: 'mock-3',
    slug: 'cyberpunk-passport',
    title: 'Cyberpunk passport',
    genCount: 198,
    shareTotal: 121,
    paidUsersCount: 27,
    revenueUsd: 0,
  },
  {
    trendId: 'mock-4',
    slug: 'vintage-polaroid',
    title: 'Vintage Polaroid',
    genCount: 152,
    shareTotal: 88,
    paidUsersCount: 19,
    revenueUsd: 0,
  },
  {
    trendId: 'mock-5',
    slug: 'watercolor-sketch',
    title: 'Watercolor sketch',
    genCount: 121,
    shareTotal: 64,
    paidUsersCount: 14,
    revenueUsd: 0,
  },
  {
    trendId: 'mock-6',
    slug: 'saturday-morning-cartoon',
    title: 'Saturday morning cartoon',
    genCount: 104,
    shareTotal: 57,
    paidUsersCount: 11,
    revenueUsd: 0,
  },
]

/**
 * Trend leaderboard ordered by completed-generation volume in the supplied
 * window (default 30 days, limit 20).
 *
 * Per-trend revenue attribution is intentionally deferred — credit packs are
 * not tied to specific trends. TODO: attribute revenue per trend in W14+ once
 * we know whether the user's most-used trend at purchase time is a useful
 * approximation, or whether we need to track first-paid-after-trend explicitly.
 *
 * `paidUsersCount` uses a heuristic: COUNT DISTINCT user_ids who have any
 * Stripe `checkout.session.completed` webhook in `webhook_events` AND have a
 * generation against this trend in the window.
 */
export async function getTrendLeaderboard(
  supabase: SupabaseClient,
  options: { days?: number; limit?: number } = {}
): Promise<TrendLeaderboardRow[]> {
  const days = options.days ?? 30
  const limit = options.limit ?? 20
  const since = new Date(Date.now() - days * DAY_MS).toISOString()

  const { rows: generations } = await fetchAllPaged<GenerationLeaderboardRow>(
    'margin.leaderboard.generations',
    () =>
      supabase
        .from('generations')
        .select('trend_id, user_id, share_count')
        .eq('status', 'completed')
        .gte('created_at', since)
  )

  if (MOCKS_ALLOWED && generations.length === 0) {
    return MOCK_LEADERBOARD.slice(0, limit).map((row) => ({ ...row, isMock: true }))
  }

  // Paid users. This previously had NO date filter — it scanned every Stripe
  // webhook ever received, on every page load, growing forever. Bounded to the
  // paid-user lookback and paged so it neither truncates silently nor pulls an
  // unbounded set into memory.
  const paidSince = new Date(Date.now() - PAID_USER_LOOKBACK_DAYS * DAY_MS).toISOString()
  const { rows: webhookRows } = await fetchAllPaged<WebhookEventMetadataRow>(
    'margin.leaderboard.webhooks',
    () =>
      supabase
        .from('webhook_events')
        .select('payload')
        .eq('source', 'stripe')
        .gte('created_at', paidSince)
  )
  const paidUserIds = new Set<string>()
  for (const w of webhookRows) {
    // Only actual payments count, and attribution honours the webhook's own
    // `metadata.user_id ?? client_reference_id` order (route.ts:156).
    if (revenueUsdFromEvent(w.payload) <= 0) continue
    const uid = userIdFromEvent(w.payload)
    if (uid) paidUserIds.add(uid)
  }

  // Aggregate per trend_id.
  const agg = new Map<string, { genCount: number; shareTotal: number; userIds: Set<string> }>()
  for (const g of generations) {
    const bucket = agg.get(g.trend_id) ?? {
      genCount: 0,
      shareTotal: 0,
      userIds: new Set<string>(),
    }
    bucket.genCount += 1
    bucket.shareTotal += Number(g.share_count ?? 0)
    if (g.user_id) bucket.userIds.add(g.user_id)
    agg.set(g.trend_id, bucket)
  }

  const trendIds = Array.from(agg.keys())
  const { data: trendRows } = await supabase
    .from('trends')
    .select('id, slug, title')
    .in('id', trendIds)
  const trendIndex = new Map<string, TrendLeaderboardJoinRow>()
  for (const t of (trendRows as unknown as TrendLeaderboardJoinRow[] | null) ?? []) {
    trendIndex.set(t.id, t)
  }

  const out: TrendLeaderboardRow[] = []
  for (const [trendId, bucket] of agg.entries()) {
    const trend = trendIndex.get(trendId)
    let paidUsersCount = 0
    for (const uid of bucket.userIds) {
      if (paidUserIds.has(uid)) paidUsersCount += 1
    }
    out.push({
      trendId,
      slug: trend?.slug ?? '',
      title: trend?.title ?? 'Unnamed trend',
      genCount: bucket.genCount,
      shareTotal: bucket.shareTotal,
      paidUsersCount,
      // TODO: attribute revenue per trend in W14+
      revenueUsd: 0,
    })
  }

  return out.sort((a, b) => b.genCount - a.genCount).slice(0, limit)
}

export async function getMarginDetail(
  supabase: SupabaseClient,
  days = 7,
  options?: { forceMock?: boolean }
): Promise<MarginDetail> {
  // Force-mock path used by the /admin/margin "Demo data" toggle during the
  // W2 parallel-run validation period. Returns the mock-shaped result without
  // touching the database — including the same prior-week multiplier we use
  // when real data is empty so the layout stays meaningful.
  if (MOCKS_ALLOWED && options?.forceMock) {
    const priorMultiplier = 0.78
    return {
      ...MOCK_SUMMARY,
      isMock: true,
      daily: mockDailySeries(days),
      priorWeek: {
        revenueUsd: Number((MOCK_SUMMARY.weekRevenueUsd * priorMultiplier).toFixed(2)),
        spendUsd: Number((MOCK_SUMMARY.weekSpendUsd * priorMultiplier).toFixed(2)),
        generations: Math.round(MOCK_SUMMARY.weekGenerations * priorMultiplier),
      },
      trendBreakdown: mockTrendBreakdown(),
    }
  }

  const summary = await getMarginSummary(supabase)
  const now = Date.now()
  const today = startOfUtcDay(new Date(now))
  const windowStart = new Date(today.getTime() - (days - 1) * DAY_MS)
  const priorStart = new Date(windowStart.getTime() - days * DAY_MS)

  if (summary.isMock) {
    const daily = mockDailySeries(days)
    const priorMultiplier = 0.78
    return {
      ...summary,
      daily,
      priorWeek: {
        revenueUsd: Number((summary.weekRevenueUsd * priorMultiplier).toFixed(2)),
        spendUsd: Number((summary.weekSpendUsd * priorMultiplier).toFixed(2)),
        generations: Math.round(summary.weekGenerations * priorMultiplier),
      },
      trendBreakdown: mockTrendBreakdown(),
    }
  }

  const [genPage, webhookPage, anonPage] = await Promise.all([
    fetchAllPaged<GenerationRow>('margin.detail.generations', () =>
      supabase
        .from('generations')
        .select('cost_usd, trend_id, created_at')
        .eq('status', 'completed')
        .gte('created_at', priorStart.toISOString())
    ),
    fetchAllPaged<WebhookEventRowWithDate>('margin.detail.webhooks', () =>
      supabase
        .from('webhook_events')
        .select('payload, created_at')
        .eq('source', 'stripe')
        .gte('created_at', priorStart.toISOString())
    ),
    fetchAllPaged<{ cost_usd: number | null; created_at?: string }>(
      'margin.detail.anonymous',
      () =>
        supabase
          .from('anonymous_attempts')
          .select('cost_usd, created_at')
          .eq('status', 'completed')
          .gte('created_at', priorStart.toISOString())
    ),
  ])

  const generations = genPage.rows
  const webhooks = webhookPage.rows
  const anonAttempts = anonPage.rows

  const daily = emptyDays(days)
  const byDate = new Map(daily.map((d) => [d.date, d]))
  const priorWeek = { revenueUsd: 0, spendUsd: 0, generations: 0 }

  for (const g of generations) {
    if (!g.created_at) continue
    const day = new Date(g.created_at)
    const key = startOfUtcDay(day).toISOString().slice(0, 10)
    const bucket = byDate.get(key)
    const cost = safeUsd(g.cost_usd)
    if (bucket) {
      bucket.spendUsd += cost
      bucket.generations += 1
    } else if (day.getTime() >= priorStart.getTime()) {
      priorWeek.spendUsd += cost
      priorWeek.generations += 1
    }
  }

  for (const a of anonAttempts) {
    if (!a.created_at) continue
    const day = new Date(a.created_at)
    const key = startOfUtcDay(day).toISOString().slice(0, 10)
    const bucket = byDate.get(key)
    const cost = safeUsd(a.cost_usd)
    if (bucket) {
      bucket.spendUsd += cost
    } else if (day.getTime() >= priorStart.getTime()) {
      priorWeek.spendUsd += cost
    }
  }

  for (const w of webhooks) {
    if (!w.created_at) continue
    const day = new Date(w.created_at)
    const key = startOfUtcDay(day).toISOString().slice(0, 10)
    const bucket = byDate.get(key)
    // Net of refunds/disputes, which arrive as their own rows in this table.
    const rev = revenueUsdFromEvent(w.payload) - refundUsdFromEvent(w.payload)
    if (bucket) {
      bucket.revenueUsd += rev
    } else if (day.getTime() >= priorStart.getTime()) {
      priorWeek.revenueUsd += rev
    }
  }

  // Trend breakdown from current-window generations only.
  const spendByTrend = new Map<string, { spendUsd: number; generations: number }>()
  for (const g of generations) {
    if (!g.created_at) continue
    if (new Date(g.created_at).getTime() < windowStart.getTime()) continue
    const cur = spendByTrend.get(g.trend_id) ?? { spendUsd: 0, generations: 0 }
    cur.spendUsd += safeUsd(g.cost_usd)
    cur.generations += 1
    spendByTrend.set(g.trend_id, cur)
  }

  let trendBreakdown: TrendBreakdownRow[] = []
  if (spendByTrend.size > 0) {
    const ids = Array.from(spendByTrend.keys())
    const { data: trendRows } = await supabase.from('trends').select('id, title').in('id', ids)
    const titleMap = new Map<string, string>()
    for (const row of (trendRows as unknown as TrendBriefRow[] | null) ?? []) {
      titleMap.set(row.id, row.title)
    }
    trendBreakdown = Array.from(spendByTrend.entries())
      .map(([id, agg]) => ({
        trendId: id,
        title: titleMap.get(id) ?? 'Unnamed trend',
        spendUsd: Number(agg.spendUsd.toFixed(4)),
        generations: agg.generations,
      }))
      .sort((a, b) => b.spendUsd - a.spendUsd)
      .slice(0, 8)
  }

  return {
    ...summary,
    daily,
    priorWeek,
    trendBreakdown,
  }
}

/* ------------------------------------------------------------------ *
 * Dashboard A — Revenue cohorts (weekly)
 * ------------------------------------------------------------------ */

export interface RevenueCohortRow {
  /** ISO date for the Monday that starts the cohort week (YYYY-MM-DD, UTC). */
  weekStart: string
  revenueUsd: number
  refundsUsd: number
  netUsd: number
  txCount: number
  uniqueCustomers: number
  /** refundsUsd / revenueUsd. 0 when revenue is 0. */
  refundRate: number
  /**
   * True when this row is demo data, not a real measurement. The cohorts tab
   * previously rendered fabricated weekly revenue with no on-screen badge.
   */
  isMock?: boolean
}

interface WebhookRevenueRow {
  /** Whole Stripe event — read via `./stripe-payload` helpers. */
  payload: unknown
  created_at: string | null
}

interface AuditClawbackRow {
  action: string
  /**
   * `claw_back_credits()` writes `{ amount, bucket, reason }`
   * (migration 20260604000003:42-46). The key is `amount`, never `credits`.
   */
  after: { amount?: number } | null
  created_at: string | null
}

/** Return the UTC Monday for the week containing `d` (00:00:00 UTC). */
function startOfUtcWeek(d: Date): Date {
  const day = startOfUtcDay(d)
  // getUTCDay: 0=Sun..6=Sat. Map so Monday → 0 step, Sunday → 6 steps back.
  const dayOfWeek = day.getUTCDay()
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  return new Date(day.getTime() - offset * DAY_MS)
}

function emptyWeeks(weeks: number): RevenueCohortRow[] {
  const thisWeek = startOfUtcWeek(new Date())
  return Array.from({ length: weeks }, (_, idx) => {
    const start = new Date(thisWeek.getTime() - (weeks - 1 - idx) * 7 * DAY_MS)
    return {
      weekStart: start.toISOString().slice(0, 10),
      revenueUsd: 0,
      refundsUsd: 0,
      netUsd: 0,
      txCount: 0,
      uniqueCustomers: 0,
      refundRate: 0,
    }
  })
}

function mockRevenueCohorts(weeks: number): RevenueCohortRow[] {
  const series = emptyWeeks(weeks)
  // Deterministic curve: gentle uptrend + jitter so the chart reads alive.
  for (let i = 0; i < series.length; i++) {
    const trend = 40 + (i / Math.max(1, series.length - 1)) * 220
    const jitter = ((djb2(`cohort:${i}`) % 100) / 100) * 0.5 + 0.75
    const revenue = Number((trend * jitter).toFixed(2))
    const txCount = Math.max(3, Math.round(revenue / 12))
    const uniqueCustomers = Math.max(2, Math.round(txCount * 0.88))
    const refundsUsd = Number((revenue * 0.03 * jitter).toFixed(2))
    const netUsd = Number((revenue - refundsUsd).toFixed(2))
    const refundRate = revenue > 0 ? refundsUsd / revenue : 0
    series[i] = {
      ...series[i],
      revenueUsd: revenue,
      refundsUsd,
      netUsd,
      txCount,
      uniqueCustomers,
      refundRate,
    }
  }
  return series
}

/**
 * Weekly revenue + refund cohorts for the last `weeks` UTC-Mondays.
 *
 * Reads:
 *   - `webhook_events.source='stripe'` for revenue + txCount + uniqueCustomers
 *     (sums payload.amount_total / 100; counts distinct payload.customer_email)
 *   - `admin_audit_log.action='credit_grant'` whose payload looks like a refund
 *     (after.credits > 0 + action label) as a placeholder for refund volume,
 *     priced at $0.10 / credit until real Stripe refund events flow.
 *
 * Falls back to a deterministic 12-week mock when no webhook rows exist —
 * keeps the dashboard meaningful pre-launch.
 *
 * TODO: when Stripe refund webhooks land (`charge.refunded`), switch the
 * refund branch to those events and drop the credit-grant proxy.
 */
export async function getRevenueCohorts(
  supabase: SupabaseClient,
  weeks: number = 12
): Promise<RevenueCohortRow[]> {
  const since = new Date(
    startOfUtcWeek(new Date()).getTime() - (weeks - 1) * 7 * DAY_MS
  ).toISOString()

  try {
    const [webhookPage, auditPage] = await Promise.all([
      fetchAllPaged<WebhookRevenueRow>('margin.cohorts.webhooks', () =>
        supabase
          .from('webhook_events')
          .select('payload, created_at')
          .eq('source', 'stripe')
          .gte('created_at', since)
      ),
      fetchAllPaged<AuditClawbackRow>('margin.cohorts.clawbacks', () =>
        supabase
          .from('admin_audit_log')
          .select('action, after, created_at')
          .eq('action', 'credit_clawback')
          .gte('created_at', since)
      ),
    ])

    // A failed read must NOT fall through to the mock branch below — that would
    // render fabricated revenue behind no badge at all. `fetchAllPaged` reports
    // failures instead of throwing, so re-raise into this function's catch.
    if (webhookPage.error) throw new Error(webhookPage.error)
    if (auditPage.error) throw new Error(auditPage.error)

    const webhooks = webhookPage.rows
    const audits = auditPage.rows

    if (MOCKS_ALLOWED && webhooks.length === 0) {
      return mockRevenueCohorts(weeks).map((row) => ({ ...row, isMock: true }))
    }

    const buckets = new Map<string, RevenueCohortRow>()
    for (const row of emptyWeeks(weeks)) {
      buckets.set(row.weekStart, { ...row })
    }
    const customersByWeek = new Map<string, Set<string>>()

    for (const w of webhooks) {
      if (!w.created_at) continue
      const key = startOfUtcWeek(new Date(w.created_at)).toISOString().slice(0, 10)
      const bucket = buckets.get(key)
      if (!bucket) continue
      const revenue = revenueUsdFromEvent(w.payload)
      // Stripe refunds/disputes are stored in this same table; count them on
      // the refund side rather than as income.
      bucket.refundsUsd += refundUsdFromEvent(w.payload)
      if (revenue <= 0) continue
      bucket.revenueUsd += revenue
      bucket.txCount += 1
      const email = customerEmailFromEvent(w.payload)
      if (email) {
        const set = customersByWeek.get(key) ?? new Set<string>()
        set.add(email)
        customersByWeek.set(key, set)
      }
    }

    // Credit clawbacks (`claw_back_credits()`, migration 20260604000003) are
    // the credit-side refund signal — distinct from the Stripe-side amounts
    // above. NOTE: `credit_grant` rows are GRANTS (purchases, comps, referral
    // bonuses); counting those here would book every sale as a refund.
    for (const a of audits) {
      if (!a.created_at) continue
      const key = startOfUtcWeek(new Date(a.created_at)).toISOString().slice(0, 10)
      const bucket = buckets.get(key)
      if (!bucket) continue
      const credits = safeUsd(a.after?.amount)
      if (credits <= 0) continue
      bucket.refundsUsd += credits * CREDIT_USD_RATE
    }

    const out: RevenueCohortRow[] = []
    for (const bucket of buckets.values()) {
      const uniqueCustomers = customersByWeek.get(bucket.weekStart)?.size ?? 0
      const revenueUsd = Number(bucket.revenueUsd.toFixed(2))
      const refundsUsd = Number(bucket.refundsUsd.toFixed(2))
      const netUsd = Number((revenueUsd - refundsUsd).toFixed(2))
      const refundRate = revenueUsd > 0 ? refundsUsd / revenueUsd : 0
      out.push({
        weekStart: bucket.weekStart,
        revenueUsd,
        refundsUsd,
        netUsd,
        txCount: bucket.txCount,
        uniqueCustomers,
        refundRate,
      })
    }
    out.sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
    return out
  } catch (err: unknown) {
    Sentry.captureException(err, {
      tags: { component: 'margin', op: 'getRevenueCohorts' },
    })
    // Return honest zeros, NOT mock data. Returning `mockRevenueCohorts()` here
    // meant a DB outage rendered fabricated revenue that was visually identical
    // to real figures — an error must never be indistinguishable from a
    // healthy read.
    return emptyWeeks(weeks)
  }
}

/* ------------------------------------------------------------------ *
 * Dashboard D — Unit economics (CAC + LTV + payback)
 * ------------------------------------------------------------------ */

export interface CacByChannelRow {
  channel: string
  signupsAttributed: number
  spendUsd: number
  /** spend / signups; +Infinity when signups === 0. UI renders Infinity as "—". */
  cac: number
}

export interface LtvByCohortRow {
  /** Monday of the signup cohort week (YYYY-MM-DD, UTC). */
  cohortWeek: string
  cohortSize: number
  ltvDay7: number
  ltvDay30: number
  ltvDay60: number
  /** (cohort revenue − cohort Gemini cost) / cohort revenue × 100. 0 when no revenue. */
  grossMarginPct: number
}

export interface UnitEconomicsResult {
  cacByChannel: CacByChannelRow[]
  ltvByCohort: LtvByCohortRow[]
  blendedCac: number
  blendedLtv30: number
  /** Simplistic payback = blendedCac / (blendedLtv30 / 30). Infinity when LTV is 0. */
  paybackDays: number
  isMock: boolean
}

interface MarketingSpendRow {
  channel: string
  usd_spent: number | string
  week_start: string
}

interface AcquisitionProfileRow {
  id: string
  created_at: string | null
  acquisition_source: { utm_source?: string } | null
}

interface CohortRevenueRow {
  /** Whole Stripe event — read via `./stripe-payload` helpers. */
  payload: unknown
  created_at: string | null
}

interface CohortGenerationRow {
  user_id: string | null
  cost_usd: number | null
  created_at: string | null
}

const MOCK_CAC_BY_CHANNEL: CacByChannelRow[] = [
  { channel: 'tiktok', signupsAttributed: 92, spendUsd: 240.0, cac: 240.0 / 92 },
  { channel: 'instagram', signupsAttributed: 64, spendUsd: 180.0, cac: 180.0 / 64 },
  { channel: 'reddit', signupsAttributed: 38, spendUsd: 60.0, cac: 60.0 / 38 },
  { channel: 'google', signupsAttributed: 21, spendUsd: 95.0, cac: 95.0 / 21 },
  { channel: 'direct', signupsAttributed: 47, spendUsd: 0.0, cac: 0.0 },
]

function mockLtvCohorts(weeks: number): LtvByCohortRow[] {
  const thisWeek = startOfUtcWeek(new Date())
  return Array.from({ length: weeks }, (_, idx) => {
    const start = new Date(thisWeek.getTime() - (weeks - 1 - idx) * 7 * DAY_MS)
    const jitter = ((djb2(`ltv:${idx}`) % 100) / 100) * 0.6 + 0.7
    const size = Math.max(8, Math.round((24 + idx * 4) * jitter))
    const d7 = Number((1.8 * jitter).toFixed(2))
    const d30 = Number((d7 * 2.4).toFixed(2))
    const d60 = Number((d30 * 1.3).toFixed(2))
    const grossMarginPct = 78 + ((djb2(`gm:${idx}`) % 100) / 100) * 8
    return {
      cohortWeek: start.toISOString().slice(0, 10),
      cohortSize: size,
      ltvDay7: d7,
      ltvDay30: d30,
      ltvDay60: d60,
      grossMarginPct: Number(grossMarginPct.toFixed(1)),
    }
  })
}

function mockUnitEconomics(weeks: number): UnitEconomicsResult {
  const cac = MOCK_CAC_BY_CHANNEL.map((r) => ({ ...r }))
  const totalSpend = cac.reduce((s, r) => s + r.spendUsd, 0)
  const totalSignups = cac.reduce((s, r) => s + r.signupsAttributed, 0)
  const blendedCac = totalSignups > 0 ? totalSpend / totalSignups : 0
  const ltv = mockLtvCohorts(weeks)
  const recent = ltv.slice(-4)
  const blendedLtv30 =
    recent.length > 0 ? recent.reduce((s, r) => s + r.ltvDay30, 0) / recent.length : 0
  const paybackDays = blendedLtv30 > 0 ? blendedCac / (blendedLtv30 / 30) : Number.POSITIVE_INFINITY
  return {
    cacByChannel: cac.sort((a, b) => b.spendUsd - a.spendUsd),
    ltvByCohort: ltv,
    blendedCac: Number(blendedCac.toFixed(2)),
    blendedLtv30: Number(blendedLtv30.toFixed(2)),
    paybackDays: Number.isFinite(paybackDays) ? Number(paybackDays.toFixed(1)) : paybackDays,
    isMock: true,
  }
}

/**
 * Unit-economics roll-up for the admin /margin dashboard.
 *
 * CAC: `admin_marketing_spend` (last 30d) ÷ `profiles.acquisition_source.utm_source`
 *      (last 30d signups). Channels in either side surface; empty join → Infinity.
 * LTV: per signup-cohort-week (last `cohortWeeks`), cumulative `webhook_events`
 *      revenue at days 7/30/60 post-cohort-start. Gross margin nets out
 *      `generations.cost_usd` for users in the cohort.
 *
 * Mock fallback when no marketing-spend rows AND no recent profile rows are
 * available — keeps the dashboard meaningful pre-launch.
 */
export async function getUnitEconomics(
  supabase: SupabaseClient,
  cohortWeeks: number = 8
): Promise<UnitEconomicsResult> {
  const now = Date.now()
  const cacWindowMs = 30 * DAY_MS
  const cacSince = new Date(now - cacWindowMs).toISOString()
  const cohortSince = new Date(
    startOfUtcWeek(new Date(now)).getTime() - (cohortWeeks - 1) * 7 * DAY_MS
  ).toISOString()
  // LTV needs +60 days post the oldest cohort week to evaluate day-60 buckets.
  const ltvRevenueSince = cohortSince

  try {
    const [spendPage, profilePage, revenuePage, generationPage] = await Promise.all([
      fetchAllPaged<MarketingSpendRow>('margin.unit.spend', () =>
        supabase
          .from('admin_marketing_spend')
          .select('channel, usd_spent, week_start')
          .gte('week_start', cacSince.slice(0, 10))
      ),
      fetchAllPaged<AcquisitionProfileRow>('margin.unit.profiles', () =>
        supabase
          .from('profiles')
          .select('id, created_at, acquisition_source')
          .gte('created_at', cohortSince)
      ),
      fetchAllPaged<CohortRevenueRow>('margin.unit.revenue', () =>
        supabase
          .from('webhook_events')
          .select('payload, created_at')
          .eq('source', 'stripe')
          .gte('created_at', ltvRevenueSince)
      ),
      fetchAllPaged<CohortGenerationRow>('margin.unit.generations', () =>
        supabase
          .from('generations')
          .select('user_id, cost_usd, created_at')
          .eq('status', 'completed')
          .gte('created_at', ltvRevenueSince)
      ),
    ])

    // Same reasoning as getRevenueCohorts: a failed read must reach the catch
    // below rather than looking like an empty table and rendering mock data.
    if (spendPage.error) throw new Error(spendPage.error)
    if (profilePage.error) throw new Error(profilePage.error)
    if (revenuePage.error) throw new Error(revenuePage.error)
    if (generationPage.error) throw new Error(generationPage.error)

    const spends = spendPage.rows
    const profiles = profilePage.rows
    const revenue = revenuePage.rows
    const generations = generationPage.rows

    if (MOCKS_ALLOWED && spends.length === 0 && profiles.length === 0) {
      return mockUnitEconomics(cohortWeeks)
    }

    // CAC by channel (last 30d) ----------------------------------------
    const spendByChannel = new Map<string, number>()
    for (const s of spends) {
      const usd = safeUsd(s.usd_spent)
      spendByChannel.set(s.channel, (spendByChannel.get(s.channel) ?? 0) + usd)
    }
    const signupsByChannel = new Map<string, number>()
    const last30dCutoff = now - cacWindowMs
    for (const p of profiles) {
      if (!p.created_at) continue
      if (new Date(p.created_at).getTime() < last30dCutoff) continue
      const channel = p.acquisition_source?.utm_source?.toLowerCase() ?? 'direct'
      signupsByChannel.set(channel, (signupsByChannel.get(channel) ?? 0) + 1)
    }
    const channels = new Set<string>([...spendByChannel.keys(), ...signupsByChannel.keys()])
    const cacByChannel: CacByChannelRow[] = []
    for (const channel of channels) {
      const spendUsd = Number((spendByChannel.get(channel) ?? 0).toFixed(2))
      const signupsAttributed = signupsByChannel.get(channel) ?? 0
      const cac = signupsAttributed > 0 ? spendUsd / signupsAttributed : Number.POSITIVE_INFINITY
      cacByChannel.push({ channel, signupsAttributed, spendUsd, cac })
    }
    cacByChannel.sort((a, b) => b.spendUsd - a.spendUsd)

    // LTV by signup-cohort-week ----------------------------------------
    interface CohortAgg {
      cohortStartMs: number
      userIds: Set<string>
      revenueByDayBucket: { d7: number; d30: number; d60: number }
      costUsd: number
    }
    const cohorts = new Map<string, CohortAgg>()
    const cohortStartMs = new Date(cohortSince).getTime()
    for (const p of profiles) {
      if (!p.created_at) continue
      const created = new Date(p.created_at).getTime()
      if (created < cohortStartMs) continue
      const weekStart = startOfUtcWeek(new Date(created))
      const key = weekStart.toISOString().slice(0, 10)
      const bucket = cohorts.get(key) ?? {
        cohortStartMs: weekStart.getTime(),
        userIds: new Set<string>(),
        revenueByDayBucket: { d7: 0, d30: 0, d60: 0 },
        costUsd: 0,
      }
      bucket.userIds.add(p.id)
      cohorts.set(key, bucket)
    }

    // Map user → cohort key for revenue + cost attribution.
    const userToCohort = new Map<string, string>()
    for (const [key, bucket] of cohorts) {
      for (const uid of bucket.userIds) userToCohort.set(uid, key)
    }

    for (const r of revenue) {
      if (!r.created_at) continue
      const uid = userIdFromEvent(r.payload)
      if (!uid) continue
      const cohortKey = userToCohort.get(uid)
      if (!cohortKey) continue
      const bucket = cohorts.get(cohortKey)
      if (!bucket) continue
      const eventMs = new Date(r.created_at).getTime()
      const daysSince = (eventMs - bucket.cohortStartMs) / DAY_MS
      const usd = revenueUsdFromEvent(r.payload) - refundUsdFromEvent(r.payload)
      if (daysSince <= 7) bucket.revenueByDayBucket.d7 += usd
      if (daysSince <= 30) bucket.revenueByDayBucket.d30 += usd
      if (daysSince <= 60) bucket.revenueByDayBucket.d60 += usd
    }

    for (const g of generations) {
      if (!g.user_id) continue
      const cohortKey = userToCohort.get(g.user_id)
      if (!cohortKey) continue
      const bucket = cohorts.get(cohortKey)
      if (!bucket) continue
      bucket.costUsd += safeUsd(g.cost_usd)
    }

    const ltvByCohort: LtvByCohortRow[] = []
    for (const [key, bucket] of cohorts) {
      const cohortSize = bucket.userIds.size
      const ltvDay7 =
        cohortSize > 0 ? Number((bucket.revenueByDayBucket.d7 / cohortSize).toFixed(2)) : 0
      const ltvDay30 =
        cohortSize > 0 ? Number((bucket.revenueByDayBucket.d30 / cohortSize).toFixed(2)) : 0
      const ltvDay60 =
        cohortSize > 0 ? Number((bucket.revenueByDayBucket.d60 / cohortSize).toFixed(2)) : 0
      const revenueAll = bucket.revenueByDayBucket.d60
      const grossMarginPct =
        revenueAll > 0 ? Number((((revenueAll - bucket.costUsd) / revenueAll) * 100).toFixed(1)) : 0
      ltvByCohort.push({
        cohortWeek: key,
        cohortSize,
        ltvDay7,
        ltvDay30,
        ltvDay60,
        grossMarginPct,
      })
    }
    ltvByCohort.sort((a, b) => (a.cohortWeek < b.cohortWeek ? -1 : 1))

    // Blended figures --------------------------------------------------
    const totalSpend = cacByChannel.reduce((s, r) => s + r.spendUsd, 0)
    const totalSignups = cacByChannel.reduce((s, r) => s + r.signupsAttributed, 0)
    const blendedCac = totalSignups > 0 ? totalSpend / totalSignups : 0

    const recent = ltvByCohort.slice(-4)
    const blendedLtv30 =
      recent.length > 0 ? recent.reduce((s, r) => s + r.ltvDay30, 0) / recent.length : 0
    const paybackDays =
      blendedLtv30 > 0 ? blendedCac / (blendedLtv30 / 30) : Number.POSITIVE_INFINITY

    return {
      cacByChannel,
      ltvByCohort,
      blendedCac: Number(blendedCac.toFixed(2)),
      blendedLtv30: Number(blendedLtv30.toFixed(2)),
      paybackDays: Number.isFinite(paybackDays) ? Number(paybackDays.toFixed(1)) : paybackDays,
      isMock: false,
    }
  } catch (err: unknown) {
    Sentry.captureException(err, {
      tags: { component: 'margin', op: 'getUnitEconomics' },
    })
    // Honest empty, NOT mock data — see the note in getRevenueCohorts. A failed
    // read must not render as plausible-looking unit economics.
    return {
      cacByChannel: [],
      ltvByCohort: [],
      blendedCac: 0,
      blendedLtv30: 0,
      // Infinity renders as "—" via formatPayback, which is the honest display
      // for "no data" — 0 would read as "instant payback".
      paybackDays: Number.POSITIVE_INFINITY,
      isMock: false,
    }
  }
}
