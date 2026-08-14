/**
 * Trend impression + click event store — router.
 *
 * Two backends:
 *   - **memory** (default, used in tests + offline dev): deterministic
 *     per-slug baseline so the admin dashboards render meaningful shapes
 *     even with no real traffic. State resets when the dev server restarts.
 *   - **supabase**: persistent `trend_events` table. Selected when
 *     `TREND_EVENTS_BACKEND=supabase`. Used in production once the live DB
 *     is wired.
 *
 * All read functions are async — callers must `await`. This is the
 * one-time migration cost: previously the memory backend was sync; the
 * Supabase path can't be. Tests + RSC server components handle this
 * transparently.
 */

import {
  getCountsBatchDb,
  getCountsDb,
  getDailySeriesBySlugDb,
  getDailySeriesDb,
  getOverallDb,
  getPeriodTotalsDb,
  getQuotaBlockedSummaryDb,
  recordEventDb,
} from './event-store-db'
import type { Counts, DailyPoint, QuotaBlockedSummary, TrendEventType } from './event-store-types'

export type { Counts, DailyPoint, QuotaBlockedSummary, TrendEventType } from './event-store-types'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function supabaseBackendActive(): boolean {
  return process.env.TREND_EVENTS_BACKEND === 'supabase'
}

// ---------- in-memory baseline ----------

// Next.js dev runs route handlers and RSC pages in separate module contexts,
// so a plain module-level Map gets re-instantiated per worker. Stash the
// store on globalThis so increments from /api/track are visible to RSC reads
// in /admin/* within the same Node process.
declare global {
  var __trendEventStore: Map<string, Counts> | undefined
}
const store: Map<string, Counts> = globalThis.__trendEventStore ?? new Map()
if (!globalThis.__trendEventStore) globalThis.__trendEventStore = store

function djb2(input: string): number {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i)
  }
  return Math.abs(hash)
}

function baselineFor(slug: string): Counts {
  const seed = djb2(slug)
  const impressions = 380 + (seed % 1620)
  const clickFloor = Math.floor(impressions * 0.06)
  const clickRange = Math.floor(impressions * 0.18)
  const clicks = clickFloor + (seed % (clickRange + 1))
  return { impressions, clicks }
}

function readMemory(slug: string): Counts {
  const existing = store.get(slug)
  if (existing) return existing
  const seeded = baselineFor(slug)
  store.set(slug, seeded)
  return seeded
}

function recordEventMemory(slug: string, type: TrendEventType): void {
  const cur = readMemory(slug)
  if (type === 'impression') {
    store.set(slug, { ...cur, impressions: cur.impressions + 1 })
  } else if (type === 'click_generate') {
    store.set(slug, { ...cur, clicks: cur.clicks + 1 })
  }
  // `quota_blocked` is neither — it must not inflate the click count. Keeps
  // this backend consistent with the Supabase one in event-store-db.ts.
}

function getCountsMemory(slug: string): Counts {
  return readMemory(slug)
}

function getCountsBatchMemory(slugs: readonly string[]): Map<string, Counts> {
  const out = new Map<string, Counts>()
  for (const s of slugs) out.set(s, readMemory(s))
  return out
}

function getOverallMemory(slugs: readonly string[]): Counts {
  let impressions = 0
  let clicks = 0
  for (const s of slugs) {
    const c = readMemory(s)
    impressions += c.impressions
    clicks += c.clicks
  }
  return { impressions, clicks }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * Deterministic per-day split of cumulative slug totals across the window.
 * Used only by the memory backend — the Supabase backend aggregates by
 * `occurred_at` for real numbers.
 */
function splitDailyForSlug(
  slug: string,
  days: number
): { impressions: number[]; clicks: number[] } {
  const counts = readMemory(slug)
  const baseSeed = djb2(slug)
  const impressionsOut = new Array<number>(days).fill(0)
  const clicksOut = new Array<number>(days).fill(0)

  const weights = new Array<number>(days)
  let weightTotal = 0
  for (let i = 0; i < days; i++) {
    const trend = 0.7 + (i / Math.max(1, days - 1)) * 0.6
    const jitter = ((djb2(`${slug}:${i}`) % 100) / 100) * 0.5 + 0.75
    const w = trend * jitter
    weights[i] = w
    weightTotal += w
  }

  for (let i = 0; i < days; i++) {
    const share = weights[i] / weightTotal
    impressionsOut[i] = Math.max(0, Math.round(counts.impressions * share))
    clicksOut[i] = Math.max(0, Math.round(counts.clicks * share))
  }

  const balance = (target: number, arr: number[]) => {
    const sum = arr.reduce((a, b) => a + b, 0)
    let drift = target - sum
    if (drift === 0) return
    const step = drift > 0 ? 1 : -1
    let idx = baseSeed % arr.length
    while (drift !== 0) {
      arr[idx] = Math.max(0, arr[idx] + step)
      drift -= step
      idx = (idx + 1) % arr.length
    }
  }
  balance(counts.impressions, impressionsOut)
  balance(counts.clicks, clicksOut)

  return { impressions: impressionsOut, clicks: clicksOut }
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

function getDailySeriesMemory(slugs: readonly string[], days: number): DailyPoint[] {
  const labels = buildDateLabels(days)
  const series = labels.map((l) => ({ ...l, impressions: 0, clicks: 0 }))
  for (const slug of slugs) {
    const split = splitDailyForSlug(slug, days)
    for (let i = 0; i < days; i++) {
      series[i].impressions += split.impressions[i]
      series[i].clicks += split.clicks[i]
    }
  }
  return series
}

function getPeriodTotalsMemory(
  slugs: readonly string[],
  days: number
): { current: Counts; previous: Counts } {
  const total = getDailySeriesMemory(slugs, days * 2)
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

// ---------- exported router ----------

export async function recordEvent(slug: string, type: TrendEventType): Promise<void> {
  if (supabaseBackendActive()) {
    await recordEventDb(slug, type)
    return
  }
  recordEventMemory(slug, type)
}

export async function getCounts(slug: string): Promise<Counts> {
  if (supabaseBackendActive()) return getCountsDb(slug)
  return getCountsMemory(slug)
}

export async function getCountsBatch(slugs: readonly string[]): Promise<Map<string, Counts>> {
  if (supabaseBackendActive()) return getCountsBatchDb(slugs)
  return getCountsBatchMemory(slugs)
}

export async function getOverall(slugs: readonly string[]): Promise<Counts> {
  if (supabaseBackendActive()) return getOverallDb(slugs)
  return getOverallMemory(slugs)
}

export async function getDailySeries(slugs: readonly string[], days = 7): Promise<DailyPoint[]> {
  if (supabaseBackendActive()) return getDailySeriesDb(slugs, days)
  return getDailySeriesMemory(slugs, days)
}

/**
 * Per-slug daily series. Prefer this over calling `getDailySeries([slug])` in a
 * loop — on the Supabase backend that is one round-trip per slug (N+1).
 */
export async function getDailySeriesBySlug(
  slugs: readonly string[],
  days = 7
): Promise<Map<string, DailyPoint[]>> {
  if (supabaseBackendActive()) return getDailySeriesBySlugDb(slugs, days)
  return new Map(slugs.map((slug) => [slug, getDailySeriesMemory([slug], days)]))
}

export async function getPeriodTotals(
  slugs: readonly string[],
  days: number
): Promise<{ current: Counts; previous: Counts }> {
  if (supabaseBackendActive()) return getPeriodTotalsDb(slugs, days)
  return getPeriodTotalsMemory(slugs, days)
}

function zeroedQuotaSeries(): { date: string; label: string; count: number }[] {
  const today = startOfUtcDay(new Date())
  const out: { date: string; label: string; count: number }[] = []
  for (let i = 6; i >= 0; i--) {
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
 * Quota-block summary. Persistent backend only — the in-memory store
 * doesn't track `quota_blocked` events (they originate from a DB trigger,
 * not the /api/track route), so the memory branch returns a zeroed shape.
 */
export async function getQuotaBlockedSummary(
  windowHours: number = 24
): Promise<QuotaBlockedSummary> {
  if (supabaseBackendActive()) return getQuotaBlockedSummaryDb(windowHours)
  return {
    totalBlocks: 0,
    distinctSlugs: 0,
    distinctUsersEstimated: 0,
    dailySeries: zeroedQuotaSeries(),
  }
}
