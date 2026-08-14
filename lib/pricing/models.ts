/**
 * Single source of truth for image-model pricing.
 *
 * This table previously existed TWICE — `lib/gemini/cost.ts` (Node) and
 * `supabase/functions/generate-image/index.ts` (Deno) — kept in sync by hand
 * via "keep in sync" comments. Only the Deno copy is on the customer path, so
 * drift meant margins and any cost ceiling silently disagreed with what was
 * actually charged.
 *
 * Deno cannot import across the runtime boundary, so the Edge copy is
 * GENERATED from this file (`pnpm sync:pricing`) and a test asserts the two
 * match. Drift now fails CI instead of corrupting money numbers.
 */

import type { ImageModel } from '@/lib/image-provider/types'

/**
 * USD per generated image.
 *
 * `gpt-image-2` is the number to watch: it was carried over from gpt-image-1
 * and flagged in both old copies as unconfirmed. A single 1024x1536 test call
 * consumed 8146 output image tokens — roughly 2x a comparable gpt-image-1 call
 * — so the real rate is likely HIGHER than this. Replace it with the observed
 * per-image cost from OpenAI billing once real traffic exists; until then the
 * cost gate errs toward under-counting spend on that model.
 */
export const COST_USD_PER_IMAGE: Record<ImageModel, number> = {
  'nano-banana-2': 0.0039, // Gemini 3.1 Flash Image — workhorse
  'nano-banana-2-lite': 0.002, // Gemini 3.1 Flash-Lite Image — cheapest/fastest
  'gpt-image-2': 0.04, // UNCONFIRMED — see note above
}

/** Per-output cost, 0 for an unknown model rather than NaN. */
export function costForOutput(model: ImageModel): number {
  return COST_USD_PER_IMAGE[model] ?? 0
}
