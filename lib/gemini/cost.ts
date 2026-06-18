/**
 * Per-output USD cost for each image model.
 * Numbers anchor to public 2026-01 pricing; revisit on price change.
 * Source: cost_usd column on `generations` for margin tracking.
 *
 * See also: supabase/functions/generate-image/index.ts COST_USD (Deno copy)
 */

import type { ImageModel } from '@/lib/image-provider/types'

// Keep GeminiModel export for backward compat (Edge Function imports it)
export type GeminiModel = 'nano-banana' | 'nano-banana-pro'

const COST_USD_PER_IMAGE: Record<ImageModel, number> = {
  'nano-banana': 0.0039, // v1 — fast/cheap
  'nano-banana-pro': 0.024, // Pro — quality default
  // OpenAI gpt-image medium-quality; update when pricing changes
  // See also: supabase/functions/generate-image/index.ts COST_USD (Deno copy)
  'gpt-image': 0.04,
}

export function costForOutput(model: ImageModel): number {
  return COST_USD_PER_IMAGE[model] ?? 0
}

/**
 * Daily anonymous budget breach check.
 * Sum cost_usd of today's anonymous_attempts rows; compare to env-set ceiling.
 */
export function isAnonymousBudgetExceeded(spentTodayUsd: number, dailyCapUsd: number): boolean {
  return spentTodayUsd >= dailyCapUsd
}
