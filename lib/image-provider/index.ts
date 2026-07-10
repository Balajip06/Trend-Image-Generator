/**
 * Provider-agnostic image-generation entry point.
 *
 * Replaces the direct `lib/gemini/client.ts` import path. Picks an
 * implementation at runtime based on the `IMAGE_PROVIDER` env var
 * (default `gemini`). Call sites import only from this file:
 *
 * ```ts
 * import { generateImage } from '@/lib/image-provider'
 * ```
 *
 * Adding a new provider:
 *   1. Create `lib/image-provider/<name>.ts` exporting `generateImage`
 *      with the same signature as `./gemini.ts`.
 *   2. Add `<name>` to the `ImageProvider` union in `./types.ts`.
 *   3. Add a case to the switch below.
 */

import { generateImage as geminiGenerate } from './gemini'
import { generateImage as openaiGenerate } from './openai'
import type { GenerateImageArgs, GenerateImageResult, ImageModel, ImageProvider } from './types'
import { MODEL_PROVIDER } from './types'

export type {
  GenerateImageArgs,
  GenerateImageOk,
  GenerateImageFail,
  GenerateImageFailReason,
  GenerateImageResult,
  ImageModel,
  ImageProvider,
} from './types'

export { MODEL_PROVIDER } from './types'

/**
 * Resolves provider for a model. MODEL_PROVIDER is the primary source of
 * truth; IMAGE_PROVIDER env var acts as a backward-compat override for
 * the default model in non-trend contexts.
 */
function resolveProvider(model: import('./types').ImageModel): ImageProvider {
  const envOverride = process.env.IMAGE_PROVIDER?.toLowerCase()
  if (envOverride === 'openai') return 'openai'
  if (envOverride === 'gemini') return 'gemini'
  return MODEL_PROVIDER[model] ?? 'gemini'
}

export async function generateImage(args: GenerateImageArgs): Promise<GenerateImageResult> {
  const provider = resolveProvider(args.model)
  switch (provider) {
    case 'openai':
      return openaiGenerate(args)
    case 'gemini':
    default:
      return geminiGenerate(args)
  }
}

/**
 * The model to fall back to when the primary fails. nano-banana-2-lite is the
 * fastest/most-reliable model, so it's the default backstop; if the primary
 * already IS lite, fall back to the standard nano-banana-2 instead.
 */
export function fallbackModelFor(model: ImageModel): ImageModel {
  return model === 'nano-banana-2-lite' ? 'nano-banana-2' : 'nano-banana-2-lite'
}

/**
 * Reasons worth retrying on a DIFFERENT model. 'safety' is excluded — a
 * moderation block will re-block on any model, and retrying wastes budget /
 * risks policy. 'not-configured' is excluded — a missing key won't be fixed by
 * switching model within the same deploy.
 */
const FALLBACK_REASONS = new Set(['timeout', 'transient', 'invalid'])

/**
 * Generate with automatic single fallback: if the chosen model fails with a
 * retryable reason, try once more with fallbackModelFor(model). Returns the
 * first success, or the fallback's result if it also fails. The winning
 * model is always readable via result.modelUsed on success.
 *
 * NOTE: the customer path (Supabase Edge Function) has its own inlined copy of
 * this logic — keep the reason set + fallback choice in sync.
 */
export async function generateImageWithFallback(
  args: GenerateImageArgs
): Promise<GenerateImageResult> {
  const primary = await generateImage(args)
  if (primary.ok) return primary
  if (!FALLBACK_REASONS.has(primary.reason)) return primary

  const fallback = fallbackModelFor(args.model)
  if (fallback === args.model) return primary
  return generateImage({ ...args, model: fallback })
}
