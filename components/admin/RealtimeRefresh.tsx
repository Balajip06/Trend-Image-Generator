'use client'

import { useRealtimeRefresh } from '@/lib/realtime/useRealtimeRefresh'
import { cn } from '@/lib/utils/cn'

interface RealtimeRefreshProps {
  /** Tables whose changes refresh this page. */
  tables: readonly string[]
  /** Trailing-edge debounce; raise for query-heavy pages. */
  debounceMs?: number
  /** Render a live/connecting chip. Off for pages with their own indicator. */
  showStatus?: boolean
  className?: string
}

const STATUS_META = {
  live: { label: 'Live', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  connecting: { label: 'Connecting', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' },
} as const

/**
 * Drop-in realtime refresh for RSC admin pages.
 *
 * Server components cannot hold a subscription, so this mounts the client hook
 * and (optionally) renders the connection chip. Prefer `useRealtimeTable` when
 * a page renders rows of ONE table and patching is cheap; use this when the
 * page is an aggregate and only a refetch is meaningful.
 */
export function RealtimeRefresh({
  tables,
  debounceMs,
  showStatus = false,
  className,
}: RealtimeRefreshProps) {
  const status = useRealtimeRefresh({ tables, debounceMs })
  if (!showStatus) return null

  const meta = STATUS_META[status]
  return (
    <span className={cn('inline-flex items-center gap-2 text-xs font-semibold', meta.text, className)}>
      <span className="relative grid size-2.5 place-items-center">
        <span className={cn('absolute size-2.5 rounded-full', meta.dot)} />
        {status === 'live' && (
          <span className={cn('live-ping absolute size-2.5 rounded-full', meta.dot)} />
        )}
      </span>
      {meta.label}
    </span>
  )
}
