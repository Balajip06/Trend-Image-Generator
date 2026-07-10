/**
 * OpenAI image-generation client.
 *
 * Uses /v1/images/edits when imageUrls.length > 0 (identity-preserving,
 * multimodal), otherwise /v1/images/generations (text-only).
 * gpt-image-1 always returns b64_json — no `response_format` param (removed;
 * OpenAI rejects it with 400 unknown_parameter for this model).
 *
 * Failure taxonomy mirrors gemini.ts exactly:
 *   safety   → HTTP 400 with code "moderation_blocked"
 *   transient → HTTP 429 or 5xx
 *   timeout  → AbortError
 *   invalid  → other 4xx or malformed response
 *
 * Mock mode: returns MOCK_PNG_HEADER when OPENAI_API_KEY is unset (NOT 'not-configured').
 *
 * See also: supabase/functions/generate-image/index.ts callOpenAI (Deno copy)
 * — keep MODEL_ID, COST_USD, and failure taxonomy in sync.
 */

import { costForOutput } from '@/lib/gemini/cost'
import type { GenerateImageArgs, GenerateImageResult } from './types'

const OPENAI_BASE_URL = 'https://api.openai.com/v1'
const MOCK_PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// Explicit size + quality — without these gpt-image-2 falls back to its
// slowest defaults (high quality, large/auto size). Keep in sync with the
// Deno copy in supabase/functions/generate-image/index.ts.
const OPENAI_IMAGE_SIZE = '1024x1024'
const OPENAI_IMAGE_QUALITY = 'medium'

export async function generateImage(args: GenerateImageArgs): Promise<GenerateImageResult> {
  const apiKey = process.env.OPENAI_API_KEY
  const modelId = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2'

  if (!apiKey) {
    return {
      ok: true,
      outputPng: MOCK_PNG_HEADER,
      costUsd: costForOutput(args.model),
      modelUsed: `mock:${modelId}`,
    }
  }

  const controller = new AbortController()
  // gpt-image-2 has been observed taking 90s+ for a single call — see also
  // supabase/functions/generate-image/index.ts GEMINI_TIMEOUT_MS (Deno copy,
  // shared timeout for both providers, kept in sync).
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 130_000)

  try {
    let res: Response

    if (args.imageUrls.length > 0) {
      // Identity-preserving: use /v1/images/edits (multipart form)
      const form = new FormData()
      form.append('model', modelId)
      form.append('prompt', args.prompt)
      form.append('n', '1')
      // Without size/quality, gpt-image-2 defaults to quality=high + large
      // size — its slowest config (90-140s observed). medium + a fixed 1024²
      // cuts render time substantially at negligible quality loss for these
      // avatar-style outputs. Keep in sync with the Deno copy.
      form.append('size', OPENAI_IMAGE_SIZE)
      form.append('quality', OPENAI_IMAGE_QUALITY)

      // Fetch each image URL and append as form parts. Wired to the same
      // abort signal as the OpenAI call — without this, a hung/stalled fetch
      // here blocks forever with no timeout at all (the AbortController
      // below only ever covered the OpenAI POST, not this upstream fetch).
      for (let i = 0; i < args.imageUrls.length; i++) {
        const imgRes = await fetch(args.imageUrls[i], {
          redirect: 'error',
          signal: controller.signal,
        })
        if (!imgRes.ok) throw new Error(`Image fetch failed: ${imgRes.status} ${args.imageUrls[i]}`)
        const blob = await imgRes.blob()
        form.append(`image${i === 0 ? '' : `[${i}]`}`, blob, `image${i}.png`)
      }

      res = await fetch(`${OPENAI_BASE_URL}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      })
    } else {
      // Text-to-image: use /v1/images/generations
      res = await fetch(`${OPENAI_BASE_URL}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          prompt: args.prompt,
          n: 1,
          size: OPENAI_IMAGE_SIZE,
          quality: OPENAI_IMAGE_QUALITY,
        }),
        signal: controller.signal,
      })
    }

    if (!res.ok) {
      const text = await res.text()
      // Safety / moderation rejection — gpt-image-1 uses code "moderation_blocked",
      // not the older "content_policy_violation" used by DALL·E.
      if (res.status === 400 && text.includes('moderation_blocked')) {
        return {
          ok: false,
          costUsd: 0,
          reason: 'safety',
          message: `OpenAI policy: ${text.slice(0, 200)}`,
        }
      }
      const transient = res.status === 429 || res.status >= 500
      return {
        ok: false,
        costUsd: 0,
        reason: transient ? 'transient' : 'invalid',
        message: `OpenAI ${res.status}: ${text.slice(0, 200)}`,
      }
    }

    interface OpenAIResponse {
      data?: Array<{ b64_json?: string }>
    }
    const json = (await res.json()) as OpenAIResponse
    const b64 = json.data?.[0]?.b64_json
    if (!b64) {
      return { ok: false, costUsd: 0, reason: 'invalid', message: 'No b64_json in OpenAI response' }
    }

    const outputPng = decodeBase64(b64)
    return {
      ok: true,
      outputPng,
      costUsd: costForOutput(args.model),
      modelUsed: modelId,
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, costUsd: 0, reason: 'timeout', message: 'OpenAI call timed out' }
    }
    const message = err instanceof Error ? err.message : 'unknown'
    return { ok: false, costUsd: 0, reason: 'transient', message }
  } finally {
    clearTimeout(timeout)
  }
}

function decodeBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'))
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
