// GENERATED FILE — DO NOT EDIT.
// Source: lib/pricing/models.ts
// Regenerate: pnpm sync:pricing
//
// The Deno runtime cannot import from lib/, so the Edge Function carries its
// own copy of the pricing table. lib/pricing/pricing-sync.test.ts fails CI if
// this file drifts from the source.

export type EdgePricedModel = 'nano-banana-2' | 'nano-banana-2-lite' | 'gpt-image-2'

export const COST_USD: Record<EdgePricedModel, number> = {
  'nano-banana-2': 0.0039,
  'nano-banana-2-lite': 0.002,
  'gpt-image-2': 0.04,
}
