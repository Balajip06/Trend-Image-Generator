'use client'

import { Activity, CheckCircle2, DollarSign, Radio, XCircle } from 'lucide-react'
import { GenerationStatusBadge } from '@/components/admin/StatusBadges'
import { StatCard } from '@/components/admin/StatCard'
import { Badge } from '@/components/ui/badge'
import { useRealtimeTable, type RealtimeStatus } from '@/lib/realtime/useRealtimeTable'
import { cn } from '@/lib/utils/cn'
import type { Database } from '@/lib/supabase/database.types'
import type { FeedRow } from './page'

type AnonRow = Pick<
  Database['public']['Tables']['anonymous_attempts']['Row'],
  'id' | 'status' | 'cost_usd' | 'created_at' | 'completed_at' | 'trend_id'
>

interface MonitorRow {
  id: string
  source: 'authed' | 'anon'
  status: string
  model_used: string | null
  cost_usd: number
  created_at: string
  completed_at: string | null
  trend_slug: string | null
  latencyMs: number | null
  flash: boolean
}

function toMonitorRow(r: FeedRow | AnonRow, source: 'authed' | 'anon', flash: boolean): MonitorRow {
  const latencyMs =
    r.completed_at && r.created_at
      ? new Date(r.completed_at).getTime() - new Date(r.created_at).getTime()
      : null
  if (source === 'authed') {
    const f = r as FeedRow
    return {
      id: f.id,
      source,
      status: f.status,
      model_used: f.model_used,
      cost_usd: Number(f.cost_usd),
      created_at: f.created_at,
      completed_at: f.completed_at,
      trend_slug: f.trend_slug,
      latencyMs,
      flash,
    }
  }
  return {
    id: r.id,
    source,
    status: r.status,
    model_used: null,
    cost_usd: Number(r.cost_usd),
    created_at: r.created_at!,
    completed_at: r.completed_at,
    trend_slug: null,
    latencyMs,
    flash,
  }
}

type RealtimeFeedRow = FeedRow & { [key: string]: unknown }
type RealtimeAnonRow = AnonRow & { [key: string]: unknown }

const IN_FLIGHT_STATUSES = ['pending', 'processing', 'failed_retryable']

/** Worst-of the two channel states so the chip is honest about reconnection. */
function mergeStatus(a: RealtimeStatus, b: RealtimeStatus): RealtimeStatus {
  if (a === 'reconnecting' || b === 'reconnecting') return 'reconnecting'
  if (a === 'live' && b === 'live') return 'live'
  return 'connecting'
}

const STATUS_META: Record<RealtimeStatus, { label: string; dot: string; text: string }> = {
  live: { label: 'Live', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  connecting: {
    label: 'Connecting',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
  },
  reconnecting: {
    label: 'Reconnecting',
    dot: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
  },
}

function LiveChip({ status }: { status: RealtimeStatus }) {
  const m = STATUS_META[status]
  return (
    <span className={cn('inline-flex items-center gap-2 text-xs font-semibold', m.text)}>
      <span className="relative grid size-2.5 place-items-center">
        <span className={cn('absolute size-2.5 rounded-full', m.dot)} />
        {status === 'live' && (
          <span className={cn('live-ping absolute size-2.5 rounded-full', m.dot)} />
        )}
      </span>
      {m.label}
    </span>
  )
}

export function GenerationsMonitor({
  initialFeed,
  initialAnon,
}: {
  initialFeed: FeedRow[]
  initialAnon: AnonRow[]
}) {
  const feed = useRealtimeTable<RealtimeFeedRow>({
    table: 'admin_generations_feed',
    initial: initialFeed as RealtimeFeedRow[],
    syncUrl: '/api/admin/generations-sync',
    inFlightValues: IN_FLIGHT_STATUSES,
  })
  const anon = useRealtimeTable<RealtimeAnonRow>({
    table: 'anonymous_attempts',
    initial: initialAnon as RealtimeAnonRow[],
    inFlightValues: ['pending', 'processing'],
  })

  const status = mergeStatus(feed.status, anon.status)

  const all: MonitorRow[] = [
    ...feed.rows.map((r) =>
      toMonitorRow(r as unknown as FeedRow, 'authed', feed.flashIds.has(r.id))
    ),
    ...anon.rows.map((r) => toMonitorRow(r as unknown as AnonRow, 'anon', anon.flashIds.has(r.id))),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const inFlight = all.filter((r) => IN_FLIGHT_STATUSES.includes(r.status))
  const completedCount = all.filter((r) => r.status === 'completed').length
  const failedCount = all.filter((r) => r.status === 'failed').length
  const totalSpend = all.reduce((s, r) => s + r.cost_usd, 0)

  return (
    <div className="flex flex-col gap-5">
      {/* Stat strip — shared StatCards with animated counts + tones */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Activity className="size-4" />}
          label="In-flight"
          value={inFlight.length}
          tone={inFlight.length > 0 ? 'text-[var(--brand-cyan)]' : undefined}
        />
        <StatCard
          icon={<CheckCircle2 className="size-4" />}
          label="Completed"
          value={completedCount}
          tone="text-emerald-500"
        />
        <StatCard
          icon={<XCircle className="size-4" />}
          label="Failed"
          value={failedCount}
          tone={failedCount > 0 ? 'text-destructive' : undefined}
        />
        <StatCard
          icon={<DollarSign className="size-4" />}
          label="Spend"
          value={totalSpend}
          valueFormat="usd"
        />
      </div>

      {/* Live feed */}
      <div className="border-border/60 bg-card overflow-hidden rounded-2xl border shadow-sm">
        <div className="border-border/60 flex items-center justify-between gap-3 border-b px-5 py-3">
          <h2 className="text-sm font-bold tracking-tight">Activity feed</h2>
          <LiveChip status={status} />
        </div>
        {all.length === 0 ? (
          <EmptyState status={status} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border/60 text-muted-foreground border-b text-left text-[11px] tracking-wide uppercase">
                  <th className="px-5 py-2.5 font-medium">Source</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Trend</th>
                  <th className="px-3 py-2.5 font-medium">Model</th>
                  <th className="px-3 py-2.5 text-right font-medium">Latency</th>
                  <th className="px-5 py-2.5 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {all.slice(0, 100).map((r) => (
                  <tr
                    key={`${r.source}-${r.id}`}
                    className={cn(
                      'border-border/30 hover:bg-muted/30 border-b transition-colors',
                      r.flash && 'animate-row-flash-bg'
                    )}
                  >
                    <td className="px-5 py-2.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          'rounded-full px-2 py-0 text-[10px] font-semibold tracking-wide uppercase',
                          r.source === 'authed'
                            ? 'border-[var(--brand-grad-1)]/30 text-[var(--brand-grad-1)]'
                            : 'border-[var(--brand-cyan)]/30 text-[var(--brand-cyan)]'
                        )}
                      >
                        {r.source}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <GenerationStatusBadge status={r.status} />
                    </td>
                    <td className="text-muted-foreground px-3 py-2.5 font-mono text-xs">
                      {r.trend_slug ?? '—'}
                    </td>
                    <td className="text-muted-foreground px-3 py-2.5 font-mono text-xs">
                      {r.model_used ?? '—'}
                    </td>
                    <td className="text-muted-foreground px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                      {r.latencyMs !== null ? `${(r.latencyMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="text-foreground px-5 py-2.5 text-right font-mono text-xs tabular-nums">
                      ${r.cost_usd.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ status }: { status: RealtimeStatus }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
      <span className="bg-muted text-muted-foreground grid size-12 place-items-center rounded-full">
        <Radio className="size-5" />
      </span>
      <div className="flex flex-col items-center gap-1">
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm font-semibold">
          <LiveChip status={status} />
          <span className="text-muted-foreground">·</span>
          <span>
            {status === 'live' ? 'connected — waiting for the first generation' : 'connecting…'}
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          New generations appear here in real time as customers create.
        </p>
      </div>
    </div>
  )
}
