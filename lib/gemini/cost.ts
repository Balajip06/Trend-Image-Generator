/**
 * Per-output USD cost for each image model.
 * Numbers anchor to public 2026-01 pricing; revisit on price change.
 * Source: cost_usd column on `generations` for margin tracking.
 *
 * See also: supabase/functions/generate-image/index.ts COST_USD (Deno copy)
 */

import type { ImageModel } from '@/lib/image-provider/types'

// Keep GeminiModel export for backward compat (Edge Function imports it)
// nano-banana-2      → Gemini 3.1 Flash Image (Nano Banana 2)
// nano-banana-2-lite → Gemini 3.1 Flash-Lite Image (Nano Banana 2 Lite)
export type GeminiModel = 'nano-banana-2' | 'nano-banana-2-lite'

const COST_USD_PER_IMAGE: Record<ImageModel, number> = {
  'nano-banana-2': 0.0039, // Gemini 3.1 Flash Image — workhorse
  'nano-banana-2-lite': 0.002, // Gemini 3.1 Flash-Lite Image — cheapest/fastest
  // PLACEHOLDER — not confirmed for gpt-image-2 (the default model in
  // openai.ts / generate-image Edge Function). A single 1024x1536 test call
  // used 8146 output image tokens, roughly 2x a typical gpt-image-1 call at
  // similar resolution — this rate is likely an underestimate. Replace with
  // the real per-image cost from OpenAI billing before trusting margins.
  // See also: supabase/functions/generate-image/index.ts COST_USD (Deno copy)
  'gpt-image-2': 0.04,
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
