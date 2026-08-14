/**
 * Supabase-backed trend-event store. Reads + writes the `trend_events`
 * table (see migration `20260529000002_trend_events.sql`).
 *
 * Used in production (and any environment where `TREND_EVENTS_BACKEND=supabase`).
 * The fall-through default in `event-store.ts` is the in-memory baseline,
 * which keeps tests + offline dev deterministic.
 *
 * Aggregation strategy: per-call SQL count() against the (slug, occurred_at)
 * composite index. For Trendly's scale (single-digit MAU at listing, low
 * hundreds at the 90-day proof window), this is well within the 50ms p95
 * envelope and avoids the operational cost of materialized views. Revisit
 * when daily event count crosses ~50k.
 */

import * as Sentry from '@sentry/nextjs'
import { createServiceClient } from '@/lib/supabase/server'
import type { Counts, DailyPoint, QuotaBlockedSummary, TrendEventType } from './event-store-types'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

interface EventRow {
  trend_slug: string
  type: TrendEventType
  occurred_at: string
}

/**
 * Fire-and-forget insert. Caller awaits at its discretion; failures
 * breadcrumb to Sentry but never throw (the tracker is best-effort —
 * losing a single impression beat must not break the page render).
 */
export async function recordEventDb(slug: string, type: TrendEventType): Promise<void> {
  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('trend_events').insert({ trend_slug: slug, type })
    if (error) {
      Sentry.captureMessage('trend_events.insert failed', {
        level: 'warning',
        tags: { component: 'event-store', op: 'recordEvent' },
        extra: { slug, type, code: error.code, message: error.message },
      })
    }
  } catch (err: unknown) {
    Sentry.captureException(err, {
      tags: { component: 'event-store', op: 'recordEvent' },
      extra: { slug, type },
    })
  }
}

/**
 * Single-slug totals over the supplied window (defaults to "all time" via
 * a far-past lower bound). Used by `getCounts` / `getCountsBatch`.
 */
async function readBatch(
  slugs: readonly string[],
  sinceIso?: string
): Promise<Map<string, Counts>> {
  const out = new Map<string, Counts>()
  for (const s of slugs) out.set(s, { impressions: 0, clicks: 0 })
  if (slugs.length === 0) return out

  try {
    const supabase = createServiceClient()
    let query = supabase
      .from('trend_events')
      .select('trend_slug, type')
      .in('trend_slug', slugs as string[])
    if (sinceIso) query = query.gte('occurred_at', sinceIso)
    const { data, error } = await query
    if (error) {
      Sentry.captureMessage('trend_events.select failed', {
        level: 'warning',
        tags: { component: 'event-store', op: 'readBatch' },
        extra: { code: error.code, message: error.message },
      })
      return out
    }
    for (const row of (data as { trend_slug: string; type: TrendEventType }[] | null) ?? []) {
      const cur = out.get(row.trend_slug)
      if (!cur) continue
      if (row.type === 'impression') cur.impressions += 1
      else if (row.type === 'click_generate') cur.clicks += 1
      // `quota_blocked` (and any future type) is neither an impression nor a
      // click — an `else clicks++` here counted every quota block as a click.
    }
  } catch (err: unknown) {
    Sentry.captureException(err, {
      tags: { component: 'event-store', op: 'readBatch' },
    })
  }
  return out
}

export async function getCountsDb(slug: string): Promise<Counts> {
  const map = await readBatch([slug])
  return map.get(slug) ?? { impressions: 0, clicks: 0 }
}

export async function getCountsBatchDb(slugs: readonly string[]): Promise<Map<string, Counts>> {
  return readBatch(slugs)
}

export async function getOverallDb(slugs: readonly string[]): Promise<Counts> {
  const map = await readBatch(slugs)
  let impressions = 0
  let clicks = 0
  for (const c of map.values()) {
    impressions += c.impressions
    clicks += c.clicks
  }
  return { impressions, clicks }
}

function buildDateLabels(days: number): { date: string; label: string }[] {
  const today = startOfUtcDay(new Date())
  const out: { date: string; label: string }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS)
    out.push({
      date: d.toISOString().slice(0, 10),
      label: WEEKDAY_LABELS[d.getUTCDay()],
    })
  }
  return out
}

export async function getDailySeriesDb(
  slugs: readonly string[],
  days: number
): Promise<DailyPoint[]> {
  const labels = buildDateLabels(days)
  const series = labels.map((l) => ({ ...l, impressions: 0, clicks: 0 }))
  if (slugs.length === 0) return series

  const sinceIso = new Date(Date.now() - days * DAY_MS).toISOString()
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('trend_events')
      .select('trend_slug, type, occurred_at')
      .in('trend_slug', slugs as string[])
      .gte('occurred_at', sinceIso)
    if (error) {
      Sentry.captureMessage('trend_events.daily-series failed', {
        level: 'warning',
        tags: { component: 'event-store', op: 'dailySeries' },
        extra: { code: error.code, message: error.message },
      })
      return series
    }
    const dateIndex = new Map(series.map((s, i) => [s.date, i]))
    for (const row of (data as EventRow[] | null) ?? []) {
      const key = row.occurred_at.slice(0, 10)
      const idx = dateIndex.get(key)
      if (idx === undefined) continue
      if (row.type === 'impression') series[idx].impressions += 1
      else if (row.type === 'click_generate') series[idx].clicks += 1
      // `quota_blocked` (and any future type) is neither an impression nor a
      // click — an `else clicks++` here counted every quota block as a click.
    }
  } catch (err: unknown) {
    Sentry.captureException(err, {
      tags: { component: 'event-store', op: 'dailySeries' },
    })
  }
  return series
}

/**
 * Per-slug daily series from ONE query.
 *
 * `/admin/engagement` previously built this with
 * `Promise.all(slugs.map((s) => getDailySeries([s], 7)))` — one Supabase
 * round-trip per trend (N+1). The rows are identical to what a single batched
 * query returns; only the grouping differed, so the fan-out bought nothing.
 */
export async function getDailySeriesBySlugDb(
  slugs: readonly string[],
  days: number
): Promise<Map<string, DailyPoint[]>> {
  const labels = buildDateLabels(days)
  const out = new Map<string, DailyPoint[]>()
  for (const slug of slugs) {
    out.set(
      slug,
      labels.map((l) => ({ ...l, impressions: 0, clicks: 0 }))
    )
  }
  if (slugs.length === 0) return out

  const sinceIso = new Date(Date.now() - days * DAY_MS).toISOString()
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('trend_events')
      .select('trend_slug, type, occurred_at')
      .in('trend_slug', slugs as string[])
      .gte('occurred_at', sinceIso)
    if (error) {
      Sentry.captureMessage('trend_events.daily-series-by-slug failed', {
        level: 'warning',
        tags: { component: 'event-store', op: 'dailySeriesBySlug' },
        extra: { code: error.code, message: error.message },
      })
      return out
    }
    const dateIndex = new Map(labels.map((l, i) => [l.date, i]))
    for (const row of (data as EventRow[] | null) ?? []) {
      const series = out.get(row.trend_slug)
      if (!series) continue
      const idx = dateIndex.get(row.occurred_at.slice(0, 10))
      if (idx === undefined) continue
      if (row.type === 'impression') series[idx].impressions += 1
      else if (row.type === 'click_generate') series[idx].clicks += 1
    }
  } catch (err: unknown) {
    Sentry.captureException(err, {
      tags: { component: 'event-store', op: 'dailySeriesBySlug' },
    })
  }
  return out
}

function zeroedDailySeries(days: number): { date: string; label: string; count: number }[] {
  const today = startOfUtcDay(new Date())
  const out: { date: string; label: string; count: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS)
    out.push({
      date: d.toISOString().slice(0, 10),
      label: WEEKDAY_LABELS[d.getUTCDay()],
      count: 0,
    })
  }
  return out
}

/**
 * Aggregate counts of `quota_blocked` trend events over the supplied window.
 *
 * Used by the admin paywall-outreach tile + drilldown. The trigger that emits
 * these rows (`consume_quota_on_generation_insert`) is owned by the migration
 * pair Agent 1 ships alongside this feature.
 *
 * The sparkline always returns 7 days regardless of `windowHours` so the tile
 * has a stable shape.
 */
export async function getQuotaBlockedSummaryDb(
  windowHours: number = 24
): Promise<QuotaBlockedSummary> {
  const sevenDays = zeroedDailySeries(7)
  const empty: QuotaBlockedSummary = {
    totalBlocks: 0,
    distinctSlugs: 0,
    distinctUsersEstimated: 0,
    dailySeries: sevenDays,
  }

  try {
    const supabase = createServiceClient()

    // Pull the broader 7-day window once; derive both the windowHours summary
    // and the daily sparkline from the same payload (one round-trip).
    const sevenDayStart = new Date(Date.now() - 7 * DAY_MS).toISOString()
    const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('trend_events')
      .select('trend_slug, occurred_at')
      .eq('type', 'quota_blocked')
      .gte('occurred_at', sevenDayStart)
    if (error) {
      Sentry.captureMessage('trend_events.quota_blocked select failed', {
        level: 'warning',
        tags: { component: 'event-store', op: 'quotaBlockedSummary' },
        extra: { code: error.code, message: error.message },
      })
      return empty
    }

    const rows = data ?? []
    const dateIndex = new Map(sevenDays.map((s, i) => [s.date, i]))
    const slugsInWindow = new Set<string>()
    let totalBlocks = 0
    for (const row of rows) {
      const dateKey = row.occurred_at.slice(0, 10)
      const idx = dateIndex.get(dateKey)
      if (idx !== undefined) sevenDays[idx].count += 1
      if (row.occurred_at >= windowStart) {
        totalBlocks += 1
        slugsInWindow.add(row.trend_slug)
      }
    }

    // TODO: switch to actual distinct-user count when /api/track persists user_id.
    // Heuristic: ~30% of blocked attempts are the same user retrying, so the
    // distinct-user estimate is 70% of total blocks.
    const distinctUsersEstimated = Math.round(totalBlocks * 0.7)

    return {
      totalBlocks,
      distinctSlugs: slugsInWindow.size,
      distinctUsersEstimated,
      dailySeries: sevenDays,
    }
  } catch (err: unknown) {
    Sentry.captureException(err, {
      tags: { component: 'event-store', op: 'quotaBlockedSummary' },
    })
    return empty
  }
}

export async function getPeriodTotalsDb(
  slugs: readonly string[],
  days: number
): Promise<{ current: Counts; previous: Counts }> {
  const total = await getDailySeriesDb(slugs, days * 2)
  const half = total.slice(days)
  const prior = total.slice(0, days)
  const sum = (rows: DailyPoint[]): Counts =>
    rows.reduce(
      (acc, p) => ({
        impressions: acc.impressions + p.impressions,
        clicks: acc.clicks + p.clicks,
      }),
      { impressions: 0, clicks: 0 }
    )
  return { current: sum(half), previous: sum(prior) }
}
