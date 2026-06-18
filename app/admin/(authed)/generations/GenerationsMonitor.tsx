'use client'

import { useRealtimeTable } from '@/lib/realtime/useRealtimeTable'
import { Badge } from '@/components/ui/badge'
import type { Database } from '@/lib/supabase/database.types'
import type { FeedRow } from './page'

// AnonRow is the minimal select we asked for in the RSC
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
}

function toMonitorRow(r: FeedRow | AnonRow, source: 'authed' | 'anon'): MonitorRow {
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
  }
}

// useRealtimeTable requires an index signature — add it via intersection
type RealtimeFeedRow = FeedRow & { [key: string]: unknown }
type RealtimeAnonRow = AnonRow & { [key: string]: unknown }

const IN_FLIGHT_STATUSES = ['pending', 'processing', 'failed_retryable']

export function GenerationsMonitor({
  initialFeed,
  initialAnon,
}: {
  initialFeed: FeedRow[]
  initialAnon: AnonRow[]
}) {
  // Subscribe to admin_generations_feed (authed gens).
  // event:'*' + no filter — subscribe broad, window client-side (H-RT2 / H-R6).
  const feedRows = useRealtimeTable<RealtimeFeedRow>({
    table: 'admin_generations_feed',
    initial: initialFeed as RealtimeFeedRow[],
    syncUrl: '/api/admin/generations-sync',
    inFlightValues: IN_FLIGHT_STATUSES,
  })

  // Subscribe to anonymous_attempts (no syncUrl — RLS-scoped browser client is enough).
  const anonRows = useRealtimeTable<RealtimeAnonRow>({
    table: 'anonymous_attempts',
    initial: initialAnon as RealtimeAnonRow[],
    inFlightValues: ['pending', 'processing'],
  })

  // Merge by {source}-{id} — different UUID namespaces, prevents H-RT2 collision.
  const all: MonitorRow[] = [
    ...feedRows.map((r) => toMonitorRow(r as unknown as FeedRow, 'authed')),
    ...anonRows.map((r) => toMonitorRow(r as unknown as AnonRow, 'anon')),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const inFlight = all.filter((r) => IN_FLIGHT_STATUSES.includes(r.status))
  const completedCount = all.filter((r) => r.status === 'completed').length
  const failedCount = all.filter((r) => r.status === 'failed').length
  const totalSpend = all.reduce((s, r) => s + r.cost_usd, 0)

  return (
    <div className="flex flex-col gap-4">
      {/* Aggregate strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="In-flight" value={inFlight.length} />
        <StatCard label="Completed" value={completedCount} valueClass="text-emerald-500" />
        <StatCard label="Failed" value={failedCount} valueClass="text-destructive" />
        <StatCard label="Spend" value={`$${totalSpend.toFixed(3)}`} />
      </div>

      {/* Live table */}
      <div className="border-border/60 overflow-x-auto rounded-2xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border/60 border-b text-left">
              <th className="text-muted-foreground px-4 py-2 font-medium">Source</th>
              <th className="text-muted-foreground px-4 py-2 font-medium">Status</th>
              <th className="text-muted-foreground px-4 py-2 font-medium">Trend</th>
              <th className="text-muted-foreground px-4 py-2 font-medium">Model</th>
              <th className="text-muted-foreground px-4 py-2 font-medium">Latency</th>
              <th className="text-muted-foreground px-4 py-2 font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {all.slice(0, 100).map((r) => (
              <tr
                key={`${r.source}-${r.id}`}
                className="border-border/30 hover:bg-muted/30 border-b"
              >
                <td className="px-4 py-2">
                  <Badge variant="outline" className="text-[10px]">
                    {r.source}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  <StatusLabel status={r.status} />
                </td>
                <td className="text-muted-foreground px-4 py-2">{r.trend_slug ?? '—'}</td>
                <td className="text-muted-foreground px-4 py-2">{r.model_used ?? '—'}</td>
                <td className="text-muted-foreground px-4 py-2">
                  {r.latencyMs !== null ? `${(r.latencyMs / 1000).toFixed(1)}s` : '—'}
                </td>
                <td className="text-muted-foreground px-4 py-2">${r.cost_usd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {all.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">No generations yet.</p>
        )}
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string | number
  valueClass?: string
}) {
  return (
    <div className="bg-card border-border/60 rounded-2xl border p-4">
      <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${valueClass ?? ''}`}>{value}</p>
    </div>
  )
}

function StatusLabel({ status }: { status: string }) {
  let colorClass = 'text-muted-foreground'
  if (status === 'completed') colorClass = 'text-emerald-500'
  else if (status === 'failed') colorClass = 'text-destructive'
  else if (status === 'processing') colorClass = 'text-blue-400'
  return <span className={`text-xs font-medium ${colorClass}`}>{status}</span>
}
