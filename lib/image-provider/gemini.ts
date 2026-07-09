/**
 * Gemini image-generation client.
 *
 * Was `lib/gemini/client.ts` until the W0 provider-abstraction pass; this
 * file is now one of several implementations behind
 * `lib/image-provider/index.ts`. Logic unchanged from the original — just
 * moved + types externalized to `./types.ts`.
 *
 * Single entry point: `generateImage(args)` returns a single output image
 * (PNG bytes) plus cost + model-used metadata. Caller is responsible for
 * Storage upload + DB update.
 *
 * In test / unbootstrapped environments (no GEMINI_API_KEY), the client
 * runs in mock mode and returns a deterministic stub buffer — lets
 * Phase 3 wire the call path before the key is in hand.
 */

import { costForOutput } from '@/lib/gemini/cost'
import type { GeminiModel } from '@/lib/gemini/cost'
import type { GenerateImageArgs, GenerateImageResult } from './types'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const MODEL_ID: Record<GeminiModel, string> = {
  'nano-banana': 'gemini-2.5-flash-image',
  'nano-banana-pro': 'gemini-3.0-pro-image',
}

const MOCK_PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export async function generateImage(args: GenerateImageArgs): Promise<GenerateImageResult> {
  // Only called for Gemini models (routed by index.ts). Cast is safe.
  const geminiModel = args.model as GeminiModel
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    // Mock-mode — return deterministic stub so the rest of the pipeline can be exercised.
    return {
      ok: true,
      outputPng: MOCK_PNG_HEADER,
      costUsd: costForOutput(args.model),
      modelUsed: `mock:${MODEL_ID[geminiModel]}`,
    }
  }

  const url = `${GEMINI_BASE_URL}/${MODEL_ID[geminiModel]}:generateContent?key=${apiKey}`

  const controller = new AbortController()
  // Matches openai.ts's default — raised alongside it for consistency across
  // providers (see also: supabase/functions/generate-image/index.ts GEMINI_TIMEOUT_MS).
  // Created before the image fetches below so they share the same timeout —
  // without this, a hung/stalled image fetch blocks forever with no timeout
  // at all (previously the controller was created after this step, covering
  // only the Gemini API call and not the upstream image fetch).
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 130_000)

  try {
    const imageParts = await Promise.all(
      args.imageUrls.map((u) => fetchAsInlineData(u, controller.signal))
    )

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: args.prompt }, ...imageParts],
        },
      ],
      safetySettings: [
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      ],
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text()
      const transient = res.status === 429 || res.status >= 500
      return {
        ok: false,
        costUsd: 0,
        reason: transient ? 'transient' : 'invalid',
        message: `Gemini ${res.status}: ${text.slice(0, 200)}`,
      }
    }

    const json = (await res.json()) as GeminiResponse

    const blocked = json.promptFeedback?.blockReason ?? json.candidates?.[0]?.finishReason
    if (blocked && blocked !== 'STOP') {
      return {
        ok: false,
        costUsd: 0,
        reason: 'safety',
        message: `Blocked: ${blocked}`,
      }
    }

    const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData
    if (!inline?.data) {
      return {
        ok: false,
        costUsd: 0,
        reason: 'invalid',
        message: 'No inlineData in response',
      }
    }

    const outputPng = decodeBase64(inline.data)
    return {
      ok: true,
      outputPng,
      costUsd: costForOutput(args.model),
      modelUsed: MODEL_ID[geminiModel],
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, costUsd: 0, reason: 'timeout', message: 'Gemini call timed out' }
    }
    const message = err instanceof Error ? err.message : 'unknown'
    return { ok: false, costUsd: 0, reason: 'transient', message }
  } finally {
    clearTimeout(timeout)
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>
    }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
}

async function fetchAsInlineData(
  url: string,
  signal: AbortSignal
): Promise<{ inlineData: { mimeType: string; data: string } }> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status} ${url}`)
  const mimeType = res.headers.get('content-type') ?? 'image/jpeg'
  const buf = new Uint8Array(await res.arrayBuffer())
  return { inlineData: { mimeType, data: encodeBase64(buf) } }
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function decodeBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'))
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
