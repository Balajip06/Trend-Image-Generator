'use client'

/**
 * Generic Supabase Realtime hook for table-level postgres_changes subscriptions.
 * Handles:
 * - SUBSCRIBED gap: refetches rows newer than the initial snapshot's high-water mark (H-R2)
 * - Reconnect backfill: same refetch on re-SUBSCRIBED after a network drop (H-R3)
 * - Two-tier eviction: never evicts in-flight rows; caps terminal history by time (H-R7)
 * - No status filter on subscription: subscribe broad, window client-side (H-R6)
 *
 * The refetch goes through an admin Route Handler (service-role) for admin tables,
 * or directly via the RLS-scoped browser client for consumer tables.
 */

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

interface UseRealtimeTableOptions<Row extends { id: string; created_at?: string }> {
  table: string
  schema?: string
  event?: RealtimeEvent
  filter?: string
  initial: Row[]
  /** Route Handler URL for post-SUBSCRIBED cursor refetch. Must return { rows: Row[] }. */
  syncUrl?: string
  /** Column to key eviction tiers on (defaults to 'status') */
  statusKey?: keyof Row
  /** Values of statusKey considered "in-flight" — never evicted */
  inFlightValues?: string[]
  /** Max age (ms) for terminal rows in history tier (default: 5 minutes) */
  terminalMaxAgeMs?: number
}

export function useRealtimeTable<Row extends { id: string; created_at?: string; [key: string]: unknown }>({
  table,
  schema = 'public',
  event = '*',
  filter,
  initial,
  syncUrl,
  statusKey = 'status' as keyof Row,
  inFlightValues = ['pending', 'processing', 'failed_retryable'],
  terminalMaxAgeMs = 5 * 60 * 1000,
}: UseRealtimeTableOptions<Row>): Row[] {
  const [rows, setRows] = useState<Map<string, Row>>(
    () => new Map(initial.map((r) => [r.id, r]))
  )
  const wasSubscribedRef = useRef(false)
  const highWaterRef = useRef<string | null>(
    initial.length > 0
      ? initial.reduce((max, r) => (r.created_at && r.created_at > max ? r.created_at : max), '')
      : null
  )

  const upsert = (newRow: Row) =>
    setRows((prev) => {
      const next = new Map(prev)
      next.set(newRow.id, { ...(prev.get(newRow.id) ?? {}), ...newRow })
      return evict(next, statusKey, inFlightValues, terminalMaxAgeMs)
    })

  const remove = (id: string) =>
    setRows((prev) => { const next = new Map(prev); next.delete(id); return next })

  const reconcile = async () => {
    if (!syncUrl) return
    try {
      const cursor = highWaterRef.current
      const url = cursor ? `${syncUrl}?since=${encodeURIComponent(cursor)}` : syncUrl
      const res = await fetch(url)
      if (!res.ok) return
      const { rows: fresh } = await res.json() as { rows: Row[] }
      setRows((prev) => {
        const next = new Map(prev)
        for (const r of fresh) {
          next.set(r.id, { ...(prev.get(r.id) ?? {}), ...r })
          if (r.created_at && (!highWaterRef.current || r.created_at > highWaterRef.current)) {
            highWaterRef.current = r.created_at
          }
        }
        return evict(next, statusKey, inFlightValues, terminalMaxAgeMs)
      })
    } catch { /* silent — best-effort reconcile */ }
  }

  useEffect(() => {
    const supabase = createClient()
    const channelName = filter ? `rt-${table}-${filter}` : `rt-${table}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event, schema, table, ...(filter ? { filter } : {}) },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const r = payload.new as Row
            upsert(r)
            if (r.created_at && (!highWaterRef.current || r.created_at > highWaterRef.current)) {
              highWaterRef.current = r.created_at
            }
          } else if (payload.eventType === 'DELETE') {
            remove((payload.old as { id: string }).id)
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (wasSubscribedRef.current) {
            // Reconnect — backfill missed events (H-R3)
            void reconcile()
          } else {
            // First subscribe — cover the RSC→SUBSCRIBED gap (H-R2)
            wasSubscribedRef.current = true
            void reconcile()
          }
        }
      })

    return () => { void supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, schema, event, filter, syncUrl])

  return Array.from(rows.values())
}

function evict<Row extends { id: string; created_at?: string; [key: string]: unknown }>(
  rows: Map<string, Row>,
  statusKey: keyof Row,
  inFlightValues: string[],
  terminalMaxAgeMs: number
): Map<string, Row> {
  const next = new Map<string, Row>()
  for (const [id, row] of rows) {
    const status = row[statusKey] as string | undefined
    const isInFlight = !status || inFlightValues.includes(status)
    if (isInFlight) {
      next.set(id, row)  // never evict in-flight
    } else {
      const age = row.created_at ? Date.now() - new Date(row.created_at).getTime() : 0
      if (age <= terminalMaxAgeMs + 60_000) {  // 1-min buffer over the cutoff
        next.set(id, row)
      }
    }
  }
  return next
}
