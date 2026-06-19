'use client'

/**
 * AutoRefresh: calls router.refresh() on a timer and on tab visibility restore.
 * Only for PURE RSC pages (no realtime hook). Do NOT put in AdminShell (H-RT3).
 *
 * Usage: <AutoRefresh intervalMs={30_000} />
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface AutoRefreshProps {
  intervalMs?: number
}

export function AutoRefresh({ intervalMs = 30_000 }: AutoRefreshProps) {
  const router = useRouter()

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null

    const start = () => {
      id = setInterval(() => router.refresh(), intervalMs)
    }
    const stop = () => {
      if (id) {
        clearInterval(id)
        id = null
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        router.refresh() // immediate refresh on tab focus
        start()
      } else {
        stop()
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [router, intervalMs])

  return null
}
