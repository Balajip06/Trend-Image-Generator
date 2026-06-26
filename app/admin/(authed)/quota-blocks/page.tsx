import { ShieldX } from 'lucide-react'
import Link from 'next/link'
import { AutoRefresh } from '@/lib/realtime/AutoRefresh'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface QuotaBlockRow {
  trend_slug: string
  block_count: number
  last_block: string
}

interface TrendBriefRow {
  id: string
  slug: string
  title: string
}

interface EnrichedRow extends QuotaBlockRow {
  trendId: string | null
  title: string
}

const ROW_LIMIT = 20

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

async function loadQuotaBlocks(): Promise<EnrichedRow[]> {
  const supabase = createServiceClient()
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Group-by isn't expressible in the supabase-js builder; pull recent rows
  // and aggregate in memory. Volume is bounded by the per-IP rate limit
  // (20/hr) × small MAU, so this stays well under a few thousand rows even
  // at peak — well within the per-call latency envelope.
  const { data, error } = await supabase
    .from('trend_events')
    .select('trend_slug, occurred_at')
    .eq('type', 'quota_blocked')
    .gte('occurred_at', sinceIso)
  if (error) return []
  const rows = data ?? []

  const bySlug = new Map<string, { block_count: number; last_block: string }>()
  for (const r of rows) {
    const cur = bySlug.get(r.trend_slug)
    if (!cur) {
      bySlug.set(r.trend_slug, { block_count: 1, last_block: r.occurred_at })
    } else {
      cur.block_count += 1
      if (r.occurred_at > cur.last_block) cur.last_block = r.occurred_at
    }
  }

  const aggregated: QuotaBlockRow[] = Array.from(bySlug.entries())
    .map(([slug, agg]) => ({
      trend_slug: slug,
      block_count: agg.block_count,
      last_block: agg.last_block,
    }))
    .sort((a, b) => b.block_count - a.block_count)
    .slice(0, ROW_LIMIT)

  if (aggregated.length === 0) return []

  const { data: trendRows } = await supabase
    .from('trends')
    .select('id, slug, title')
    .in(
      'slug',
      aggregated.map((r) => r.trend_slug)
    )
  const trendIndex = new Map<string, TrendBriefRow>()
  for (const t of trendRows ?? []) {
    trendIndex.set(t.slug, t)
  }

  return aggregated.map((r) => {
    const trend = trendIndex.get(r.trend_slug)
    return {
      ...r,
      trendId: trend?.id ?? null,
      title: trend?.title ?? r.trend_slug,
    }
  })
}

export default async function QuotaBlocksPage() {
  const rows = await loadQuotaBlocks()

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
          Paywall outreach
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Quota blocks <span className="text-gradient-hero">(paywall outreach)</span>
        </h1>
        <p className="text-muted-foreground text-sm">
          Users who hit the free-tier weekly cap. Use this list to manually nudge high-intent users
          toward a credit pack.
        </p>
        <p className="text-muted-foreground text-xs">
          Rolling 24-hour window · UTC · refreshed on load
        </p>
      </header>

      <SchemaGapNote />

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="px-5 py-4">
            <CardTitle className="text-lg font-bold">Top blocked trends · 24h</CardTitle>
            <CardDescription className="text-xs">
              Sorted by block count · top {ROW_LIMIT}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-border/60 divide-y">
              {rows.map((row, idx) => {
                const inner = (
                  <div className="flex items-center justify-between gap-3 px-5 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-lg font-mono text-xs">
                        {idx + 1}
                      </span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="text-foreground truncate font-semibold">{row.title}</p>
                        <p className="text-muted-foreground truncate font-mono text-[11px]">
                          {row.trend_slug}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-baseline gap-3 font-mono text-xs tabular-nums">
                      <span className="text-muted-foreground">
                        last {formatRelative(row.last_block)}
                      </span>
                      <span className="font-semibold text-amber-600 dark:text-amber-400">
                        {row.block_count}
                      </span>
                    </div>
                  </div>
                )
                return (
                  <li key={row.trend_slug}>
                    {row.trendId ? (
                      <Link
                        href={`/admin/trends/${row.trendId}/edit`}
                        className="hover:bg-muted/30 block transition-colors"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div>{inner}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-xs">
        Quota-block events are appended by the{' '}
        <code className="font-mono">consume_quota_on_generation_insert</code> trigger when a
        free-tier user with 5/week used + 0 credits attempts a generation.
      </p>
      <AutoRefresh intervalMs={15_000} />
    </section>
  )
}

function SchemaGapNote() {
  // The `trend_events` table currently stores (trend_slug, type, occurred_at)
  // only — see migrations 20260529000002 + 20260529000009. The
  // `consume_quota_on_generation_insert` trigger has the user_id in scope
  // (NEW.user_id) but does not persist it. Surfacing a distinct-user
  // outreach list requires a new column.
  return (
    <aside className="flex flex-col gap-2 rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 p-4 text-sm">
      <p className="font-semibold text-amber-700 dark:text-amber-300">
        Schema gap: distinct-user drilldown not available
      </p>
      <p className="text-muted-foreground">
        The <code className="font-mono text-xs">trend_events</code> table does not store{' '}
        <code className="font-mono text-xs">user_id</code> on{' '}
        <code className="font-mono text-xs">quota_blocked</code> rows. Adding a per-user outreach
        list requires a follow-up migration that (a) adds a nullable{' '}
        <code className="font-mono text-xs">user_id uuid</code> column to{' '}
        <code className="font-mono text-xs">trend_events</code>, and (b) updates the{' '}
        <code className="font-mono text-xs">consume_quota_on_generation_insert</code> trigger to
        include <code className="font-mono text-xs">new.user_id</code> in the INSERT.
      </p>
      <p className="text-muted-foreground text-xs">
        Until then, the per-trend aggregation below is the best signal we have for paywall outreach.
      </p>
    </aside>
  )
}

function EmptyState() {
  return (
    <div className="border-border/60 bg-card/40 flex flex-col items-center gap-4 rounded-3xl border border-dashed p-16 text-center">
      <div className="bg-muted text-foreground grid size-14 place-items-center rounded-full">
        <ShieldX className="size-6" />
      </div>
      <div>
        <p className="text-lg font-bold">No quota blocks in the last 24h</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Either nobody is hitting the cap yet — or you don&apos;t have enough free-tier traffic.
        </p>
      </div>
    </div>
  )
}
