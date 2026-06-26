/**
 * Provider-neutral types for image generation. Implementations live in
 * sibling files (`gemini.ts`, `openai.ts`); the entry point at
 * `index.ts` picks one at runtime based on MODEL_PROVIDER[model].
 *
 * The shape was carved out of `lib/gemini/client.ts` without semantic change
 * so existing call sites in `app/admin/trends/[id]/eval/actions.ts` and the
 * generate-image Edge Function can swap with one import edit.
 *
 * See also: supabase/functions/generate-image/index.ts (Deno copy must stay in sync)
 */

import type { GeminiModel } from '@/lib/gemini/cost'

/**
 * Widen: add 'gpt-image' as a third model. Provider is derived from the model,
 * not from a separate env var — one source of truth.
 * See also: supabase/functions/generate-image/index.ts (Deno copy must stay in sync)
 */
export type ImageModel = GeminiModel | 'gpt-image'

/**
 * Maps each model to its provider. Use this as the primary router;
 * IMAGE_PROVIDER env var is a fallback override for backward compatibility.
 */
export const MODEL_PROVIDER: Record<ImageModel, ImageProvider> = {
  'nano-banana': 'gemini',
  'nano-banana-pro': 'gemini',
  'gpt-image': 'openai',
}

export interface GenerateImageArgs {
  model: ImageModel
  prompt: string
  /** Image URLs (Supabase Storage public/signed) passed as multimodal context. */
  imageUrls: string[]
  /** Hard wall-clock budget; default 90s (Supabase Edge wall is 150s). */
  timeoutMs?: number
}

export interface GenerateImageOk {
  ok: true
  outputPng: Uint8Array
  costUsd: number
  modelUsed: string
}

export interface GenerateImageFailReason {
  reason: 'safety' | 'timeout' | 'transient' | 'invalid' | 'not-configured'
  message: string
}

export interface GenerateImageFail extends GenerateImageFailReason {
  ok: false
  costUsd: 0
}

export type GenerateImageResult = GenerateImageOk | GenerateImageFail

/**
 * Supported provider keys. Add a new key + sibling file when wiring a real
 * second provider. Default is `'gemini'` (set by `index.ts` when the env
 * var is unset).
 */
export type ImageProvider = 'gemini' | 'openai'
