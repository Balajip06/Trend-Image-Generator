/**
 * Back-compat surface for image-model costs.
 *
 * The pricing table itself moved to `lib/pricing/models.ts` (single source of
 * truth, with the Edge Function's Deno copy generated from it). This module
 * stays so existing importers keep working.
 */

// Keep GeminiModel export for backward compat (Edge Function imports it)
// nano-banana-2      → Gemini 3.1 Flash Image (Nano Banana 2)
// nano-banana-2-lite → Gemini 3.1 Flash-Lite Image (Nano Banana 2 Lite)
export type GeminiModel = 'nano-banana-2' | 'nano-banana-2-lite'

// Pricing now lives in ONE place: lib/pricing/models.ts. This module re-exports
// it so existing importers keep working. The Edge Function's Deno copy is
// generated from that same file (`pnpm sync:pricing`), with a test asserting
// the two match — previously both tables were hand-synced and could drift
// apart silently, which meant margins disagreed with what was actually charged.
export { COST_USD_PER_IMAGE, costForOutput } from '@/lib/pricing/models'

/**
 * Daily anonymous budget breach check.
 * Sum cost_usd of today's anonymous_attempts rows; compare to env-set ceiling.
 */
export function isAnonymousBudgetExceeded(spentTodayUsd: number, dailyCapUsd: number): boolean {
  return spentTodayUsd >= dailyCapUsd
}
