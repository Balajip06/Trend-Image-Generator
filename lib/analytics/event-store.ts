/**
 * Dev/mock event store for trend impressions + clicks.
 *
 * In-memory Map keyed on trend slug (stable across mock + real Supabase rows
 * since the same slug points at the same trend in either environment).
 * Seeded with a deterministic per-slug baseline so the admin panel never
 * displays empty stats. Real user interactions during a session add on top of
 * the baseline. State resets when the dev server restarts.
 *
 * Swap the internals for a Supabase query when a `trend_events` table is
 * provisioned — `getCounts` + `recordEvent` are the only call sites, so the
 * external contract stays stable.
 */

export type TrendEventType = 'impression' | 'click_generate'

interface Counts {
  impressions: number
  clicks: number
}

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

function read(slug: string): Counts {
  const existing = store.get(slug)
  if (existing) return existing
  const seeded = baselineFor(slug)
  store.set(slug, seeded)
  return seeded
}

export function recordEvent(slug: string, type: TrendEventType): void {
  const cur = read(slug)
  if (type === 'impression') {
    store.set(slug, { ...cur, impressions: cur.impressions + 1 })
  } else {
    store.set(slug, { ...cur, clicks: cur.clicks + 1 })
  }
}

export function getCounts(slug: string): Counts {
  return read(slug)
}

export function getCountsBatch(slugs: readonly string[]): Map<string, Counts> {
  const out = new Map<string, Counts>()
  for (const s of slugs) {
    out.set(s, read(s))
  }
  return out
}

export function getOverall(slugs: readonly string[]): Counts {
  let impressions = 0
  let clicks = 0
  for (const s of slugs) {
    const c = read(s)
    impressions += c.impressions
    clicks += c.clicks
  }
  return { impressions, clicks }
}
