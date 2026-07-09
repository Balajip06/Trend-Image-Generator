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
  // PLACEHOLDER — carried over from gpt-image-1 pricing, not confirmed for
  // gpt-image-2 (now the default model in openai.ts / generate-image Edge
  // Function). A single 1024x1536 test call used 8146 output image tokens,
  // roughly 2x a typical gpt-image-1 call at similar resolution — this rate
  // is likely an underestimate. Replace with the real per-image cost from
  // OpenAI billing before trusting margin dashboards.
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
