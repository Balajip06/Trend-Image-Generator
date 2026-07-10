'use client'

import { TrendRunner } from '@/components/trends/TrendRunner'
import type { TrendInput } from '@/lib/trends/input-schema'

interface TrendUploadProps {
  trendSlug: string
  schema: TrendInput
  model: 'nano-banana-2' | 'nano-banana-2-lite'
  freeUsedThisWeek?: number
}

/**
 * Thin shim — preserves the original prop shape for /trend/[slug]/page.tsx
 * while delegating all upload + generate logic to the shared TrendRunner.
 */
export function TrendUpload({ trendSlug, schema, model, freeUsedThisWeek = 5 }: TrendUploadProps) {
  return (
    <TrendRunner
      trend={{ slug: trendSlug, input_schema: schema, model }}
      freeUsedThisWeek={freeUsedThisWeek}
    />
  )
}
