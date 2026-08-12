'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

const POLL_INTERVAL_MS = 3000

interface AnonymousStatusPollerProps {
  id: string
}

/**
 * Anon result rows are service-role-only (no RLS-scoped session to open a
 * Realtime channel with, unlike the authed ResultView), so this polls a
 * lightweight status endpoint instead and refreshes the RSC page once the
 * generation leaves 'pending'.
 */
export function AnonymousStatusPoller({ id }: AnonymousStatusPollerProps) {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false

    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/anonymous/${id}/status`)
        if (!res.ok) return
        const body = (await res.json()) as { status?: string }
        if (!cancelled && body.status && body.status !== 'pending') {
          router.refresh()
        }
      } catch {
        // transient network error — next tick retries
      }
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [id, router])

  return null
}
