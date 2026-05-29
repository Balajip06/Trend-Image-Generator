'use client'

import { useEffect } from 'react'
import { analytics, EVENTS } from '@/lib/analytics/client'

interface TrendImpressionBeaconProps {
  trendSlug: string
}

/**
 * Fires a single impression event when the trend page mounts. Posts to the
 * server-side event store for admin metrics and also captures via PostHog
 * (no-op when the key is unset).
 */
export function TrendImpressionBeacon({ trendSlug }: TrendImpressionBeaconProps) {
  useEffect(() => {
    analytics.track(EVENTS.TREND_VIEW, { trend_slug: trendSlug })
    void fetch('/api/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trend_slug: trendSlug, type: 'impression' }),
      keepalive: true,
    }).catch(() => {
      // Swallow network errors — analytics is best-effort.
    })
  }, [trendSlug])

  return null
}
