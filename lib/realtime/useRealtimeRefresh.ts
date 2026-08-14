'use client'

/**
 * Refresh an RSC page when watched tables change.
 *
 * For pages whose content is an AGGREGATE over many tables (dashboard, margin,
 * users, engagement), row-level patching is meaningless — a single new
 * generation changes cohort retention, CAC, and margin in ways only a refetch
 * can express. This hook subscribes to the tables that feed the page and
 * schedules a debounced `router.refresh()`.
 *
 * Debouncing is load-bearing, not polish. `/admin/margin` fans out to more than
 * a dozen unbounded queries per render, and `generations` is the highest-volume
 * table in the system. Refreshing per row-change would hammer the DB and
 * re-trigger the count-up animation on every KPI tile.
 *
 * Uses the same authenticated-channel helper as `useRealtimeTable`, so it
 * cannot regress into the silent `anon` failure described in authedChannel.ts.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { openAuthedChannel, type RealtimeStatus } from './authedChannel'

interface UseRealtimeRefreshOptions {
  /** Tables whose changes should refresh this page. */
  tables: readonly string[]
  /**
   * Trailing-edge debounce. A burst of row changes causes ONE refetch.
   * Raise it for expensive pages.
   */
  debounceMs?: number
  schema?: string
}

export function useRealtimeRefresh({
  tables,
  debounceMs = 2000,
  schema = 'public',
}: UseRealtimeRefreshOptions): RealtimeStatus {
  const router = useRouter()
  const [status, setStatus] = useState<RealtimeStatus>('connecting')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // Key the effect on the table list's identity, not the array reference —
  // callers pass an inline literal, which would otherwise resubscribe on every
  // render and tear the socket down in a loop.
  const tableKey = tables.join(',')

  useEffect(() => {
    mountedRef.current = true
    const watched = tableKey.split(',').filter(Boolean)

    const close = openAuthedChannel({
      channelName: `rt-refresh-${tableKey}`,
      configure: (channel) => {
        for (const table of watched) {
          channel.on('postgres_changes', { event: '*', schema, table }, () => {
            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => {
              if (mountedRef.current) router.refresh()
            }, debounceMs)
          })
        }
        return channel
      },
      onStatus: (next) => {
        if (mountedRef.current) setStatus(next)
      },
    })

    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      close()
    }
  }, [tableKey, schema, debounceMs, router])

  return status
}
