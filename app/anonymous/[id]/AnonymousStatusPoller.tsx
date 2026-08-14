'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

const POLL_INTERVAL_MS = 3000
/** Above the Edge Function's 140s wall clock, so a live generation is never cut off. */
const POLL_TIMEOUT_MS = 180_000

/**
 * Statuses the result page can actually render an outcome for.
 * `processing` is deliberately absent — see the note in the poll handler.
 */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'failed_retryable'])

interface AnonymousStatusPollerProps {
  id: string
}

/**
 * Anon result rows are service-role-only (no RLS-scoped session to open a
 * Realtime channel with, unlike the authed ResultView), so this polls a
 * lightweight status endpoint and refreshes the RSC page once the generation
 * reaches a TERMINAL status. The page re-reads the row server-side on refresh,
 * which is how `output_image_url` reaches the browser.
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
        if (cancelled || !body.status) return

        // Refresh only on a TERMINAL status. `processing` is not terminal: the
        // Edge Function sets it the moment it claims the row, and the page
        // renders neither the "ready" nor the "failed" branch for it. Treating
        // any non-pending status as done refreshed into the same spinner and
        // then stopped polling, stranding the visitor there permanently.
        if (TERMINAL_STATUSES.has(body.status)) {
          window.clearInterval(interval)
          router.refresh()
        }
      } catch {
        // transient network error — next tick retries
      }
    }, POLL_INTERVAL_MS)

    // Hard stop so a row that never reaches a terminal state (worker died) does
    // not poll forever in a background tab.
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval)
      if (!cancelled) router.refresh()
    }, POLL_TIMEOUT_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [id, router])

  return null
}
