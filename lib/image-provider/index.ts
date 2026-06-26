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
import type { GenerateImageArgs, GenerateImageResult, ImageProvider } from './types'
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
