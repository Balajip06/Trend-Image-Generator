// Supabase Edge Function — generate-image
// Triggered by Database Webhook on `generations` INSERT.
// Deno runtime; uses Web Fetch + AbortController for portability.
//
// Configure in Supabase Dashboard:
//   1. Storage buckets `uploads` + `outputs` exist (see migration 0007)
//   2. Database Webhook: table=generations, event=INSERT,
//      URL=<edge-fn-url>, HTTP method=POST,
//      header `Authorization: Bearer <service_role>`
//   3. Function secrets: GEMINI_API_KEY, OPENAI_API_KEY, OPENAI_IMAGE_MODEL,
//      SENTRY_DSN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase)
//
// Failure model per amended plan §"Phase 3":
//   - safety   → status='failed' (DB trigger refunds quota)
//   - timeout  → status='failed_retryable', attempts++
//   - transient→ status='failed_retryable', attempts++
//   - after 3 attempts → status='failed' (terminal, refund)

// @ts-expect-error Deno-only import; not resolved by Node typecheck.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Lightweight Sentry error reporter for Deno runtime (cannot use @sentry/nextjs)
// See H-M3: sentry.edge.config.ts uses Node SDK, incompatible with Deno.
async function reportToSentry(error: unknown, context?: Record<string, unknown>): Promise<void> {
  const dsn = Deno.env.get('SENTRY_DSN')
  if (!dsn) return
  try {
    const url = new URL(dsn)
    const projectId = url.pathname.replace('/', '')
    const sentryKey = url.username
    const sentryEndpoint = `https://${url.hostname}/api/${projectId}/envelope/`
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    const envelope = [
      JSON.stringify({ event_id: crypto.randomUUID().replace(/-/g, ''), dsn }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify({
        level: 'error',
        platform: 'javascript',
        timestamp: Date.now() / 1000,
        exception: {
          values: [
            {
              type: 'Error',
              value: message,
              stacktrace: stack
                ? { frames: [{ filename: 'generate-image/index.ts', function: 'Edge Function' }] }
                : undefined,
            },
          ],
        },
        extra: context,
        environment: Deno.env.get('NODE_ENV') ?? 'production',
      }),
    ].join('\n')
    await fetch(sentryEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7,sentry_key=${sentryKey}`,
      },
      body: envelope,
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // best-effort — never block generation
  }
}

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'failed_retryable'

interface GenerationRow {
  id: string
  user_id: string
  trend_id: string
  trend_version: number
  idempotency_key: string
  input_payload: {
    values: Record<string, string | string[]>
    image_urls?: string[]
  }
  status: GenerationStatus
  attempts: number
  error_message: string | null
  model_used: string | null
  cost_usd: number
  output_image_url: string | null
}

type EdgeImageModel = 'nano-banana' | 'nano-banana-pro' | 'gpt-image'
type EdgeProvider = 'gemini' | 'openai'

interface TrendRow {
  id: string
  prompt_template: string
  model: EdgeImageModel
  aspect_ratio: string
  version: number
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: GenerationRow
  schema: string
  old_record?: GenerationRow
}

const MAX_ATTEMPTS = 3
// Shared by both providers (misleading name, kept for git-blame continuity —
// used at both callGemini and callOpenAI call sites below). gpt-image-2 has
// been observed taking 90s+ for a single call; Supabase Edge Functions have
// a hard 150s wall-clock ceiling, so 130s here + 140s wall leaves 10s margin.
const GEMINI_TIMEOUT_MS = 130_000
const WALL_TIMEOUT_MS = 140_000

// See also: lib/gemini/cost.ts COST_USD_PER_IMAGE (Node copy — keep in sync)
// gpt-image rate is a PLACEHOLDER carried over from gpt-image-1 pricing, not
// confirmed for gpt-image-2 (now the default) — likely an underestimate.
const COST_USD: Record<EdgeImageModel, number> = {
  'nano-banana': 0.0039,
  'nano-banana-pro': 0.024,
  'gpt-image': 0.04,
}

// Gemini model IDs — not used for OpenAI
const GEMINI_MODEL_ID: Record<'nano-banana' | 'nano-banana-pro', string> = {
  'nano-banana': 'gemini-2.5-flash-image',
  'nano-banana-pro': 'gemini-3.0-pro-image',
}

const MODEL_PROVIDER: Record<EdgeImageModel, EdgeProvider> = {
  'nano-banana': 'gemini',
  'nano-banana-pro': 'gemini',
  'gpt-image': 'openai',
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Shared secret check — decoupled from SUPABASE_SERVICE_ROLE_KEY rotation.
  // Set on platform via `supabase secrets set WEBHOOK_SECRET=...`; same value
  // lives in .env.local + DB webhook header.
  const webhookSecret = Deno.env.get('WEBHOOK_SECRET')
  const expectedAuth = `Bearer ${webhookSecret}`
  if (!webhookSecret || req.headers.get('authorization') !== expectedAuth) {
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: WebhookPayload
  try {
    payload = (await req.json()) as WebhookPayload
  } catch {
    return jsonResponse({ error: 'invalid json' }, 400)
  }

  if (payload.type !== 'INSERT' || payload.table !== 'generations') {
    return jsonResponse({ ignored: true })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } }
  )

  const wallTimer = setTimeout(() => {
    // No-op; consumed by individual fetch AbortControllers.
  }, WALL_TIMEOUT_MS)

  try {
    await process(supabase, payload.record)
    return jsonResponse({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown'
    await reportToSentry(err, { generation_id: payload.record?.id })
    return jsonResponse({ error: message }, 500)
  } finally {
    clearTimeout(wallTimer)
  }
})

async function process(supabase: ReturnType<typeof createClient>, gen: GenerationRow) {
  // 1. Claim the row by transitioning pending -> processing.
  //    Conditional update prevents double-processing if Supabase retries the webhook.
  const { data: claimed, error: claimError } = await supabase
    .from('generations')
    .update({ status: 'processing', attempts: gen.attempts + 1 })
    .eq('id', gen.id)
    .eq('status', 'pending')
    .select()
    .maybeSingle()

  if (claimError) throw new Error(`claim failed: ${claimError.message}`)
  if (!claimed) return // Already claimed by an earlier delivery; skip silently.

  // 2. Load trend (prompt + model + version).
  const { data: trendData, error: trendError } = await supabase
    .from('trends')
    .select('id, prompt_template, model, aspect_ratio, version')
    .eq('id', gen.trend_id)
    .maybeSingle<TrendRow>()

  if (trendError || !trendData) {
    await terminalFail(supabase, gen, 'trend not found')
    return
  }

  // 3. Build prompt + collect image URLs.
  const prompt = interpolate(trendData.prompt_template, gen.input_payload.values) + REALISM_SUFFIX
  const imageUrls =
    gen.input_payload.image_urls ?? collectImagesFromValues(gen.input_payload.values)

  // 4. Call provider (Gemini or OpenAI depending on model).
  const result = await callProvider(trendData.model, prompt, imageUrls)

  if (!result.ok) {
    if (result.reason === 'safety') {
      await terminalFail(supabase, gen, `safety: ${result.message}`)
      return
    }
    // transient / timeout / invalid
    if (gen.attempts + 1 >= MAX_ATTEMPTS) {
      const terminalMsg = `terminal after ${MAX_ATTEMPTS} attempts: ${result.message}`
      await terminalFail(supabase, gen, terminalMsg)
      await reportToSentry(new Error(`generation terminal failure: ${result.message}`), {
        generation_id: gen.id,
        attempts: gen.attempts,
        reason: result.reason,
      })
    } else {
      await markRetryable(supabase, gen, result.message)
    }
    return
  }

  // 5. Upload output PNG to storage.
  const outputPath = `${gen.user_id}/${gen.id}.png`
  const { error: uploadError } = await supabase.storage
    .from('outputs')
    .upload(outputPath, result.outputPng, {
      contentType: 'image/png',
      upsert: true,
    })

  if (uploadError) {
    if (gen.attempts + 1 >= MAX_ATTEMPTS) {
      await terminalFail(supabase, gen, `upload terminal: ${uploadError.message}`)
      await reportToSentry(new Error(`generation terminal failure: upload failed`), {
        generation_id: gen.id,
        attempts: gen.attempts,
        reason: 'upload_terminal',
      })
    } else {
      await markRetryable(supabase, gen, `upload failed: ${uploadError.message}`)
    }
    return
  }

  const { data: publicUrl } = supabase.storage.from('outputs').getPublicUrl(outputPath)

  // 6. Mark completed with cost + URL.
  await supabase
    .from('generations')
    .update({
      status: 'completed',
      output_image_url: publicUrl.publicUrl,
      cost_usd: COST_USD[trendData.model],
      model_used:
        trendData.model === 'gpt-image'
          ? (Deno.env.get('OPENAI_IMAGE_MODEL') ?? 'gpt-image-2')
          : GEMINI_MODEL_ID[trendData.model as 'nano-banana' | 'nano-banana-pro'],
      completed_at: new Date().toISOString(),
    })
    .eq('id', gen.id)

  // 7. Fire-and-forget push + email dispatch via Next.js API. Best-effort —
  //    failure here does not roll back the completed generation; user can
  //    still poll via Realtime or open /me/creations.
  await dispatchNotification(gen.id)
}

async function dispatchNotification(generationId: string): Promise<void> {
  const siteUrl = Deno.env.get('SITE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!siteUrl || !serviceKey) return

  try {
    await fetch(`${siteUrl.replace(/\/$/, '')}/api/push/dispatch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ generation_id: generationId }),
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    // Swallow — push delivery is best-effort.
  }
}

async function terminalFail(
  supabase: ReturnType<typeof createClient>,
  gen: GenerationRow,
  message: string
) {
  // Setting status='failed' fires the refund-quota trigger (migration 0003).
  await supabase
    .from('generations')
    .update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
    .eq('id', gen.id)
}

async function markRetryable(
  supabase: ReturnType<typeof createClient>,
  gen: GenerationRow,
  message: string
) {
  await supabase
    .from('generations')
    .update({ status: 'failed_retryable', error_message: message })
    .eq('id', gen.id)
}

// ---- Helpers (inlined for Deno standalone) ----

// Appended to every interpolated prompt, both providers. Trend-authored
// prompt_template text stays focused on scene/style; this keeps every trend
// from independently having to spell out texture realism.
// See also: lib/trends/interpolate.ts REALISM_SUFFIX (Node copy — keep in sync)
const REALISM_SUFFIX =
  ' Photorealistic skin with visible pores and natural texture, individual ' +
  'hair strands and eyebrow hairs, natural asymmetric eyelashes, realistic ' +
  'teeth with natural color and alignment. Avoid airbrushed, plastic, or ' +
  'over-smoothed CGI skin — this is a real photograph, not a digital painting.'

function interpolate(template: string, values: Record<string, string | string[]>): string {
  return template.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_, name: string) => {
    const v = values[name]
    if (v === undefined) return ''
    return Array.isArray(v) ? v.join(', ') : v
  })
}

function collectImagesFromValues(values: Record<string, string | string[]>): string[] {
  const urls: string[] = []
  for (const v of Object.values(values)) {
    if (typeof v === 'string' && v.startsWith('http')) urls.push(v)
    else if (Array.isArray(v)) for (const u of v) if (u.startsWith('http')) urls.push(u)
  }
  return urls
}

interface GeminiOk {
  ok: true
  outputPng: Uint8Array
}
interface GeminiFail {
  ok: false
  reason: 'safety' | 'timeout' | 'transient' | 'invalid'
  message: string
}

async function callGemini(
  model: 'nano-banana' | 'nano-banana-pro',
  prompt: string,
  imageUrls: string[]
): Promise<GeminiOk | GeminiFail> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return { ok: false, reason: 'invalid', message: 'GEMINI_API_KEY missing' }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID[model]}:generateContent?key=${apiKey}`

  // Controller created before the image fetches below so they share the
  // same timeout — without this, a hung/stalled image fetch blocks forever
  // with no timeout at all.
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)

  try {
    const imageParts = await Promise.all(
      imageUrls.map((u) => fetchAsInlineData(u, controller.signal))
    )

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }, ...imageParts] }],
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
        reason: transient ? 'transient' : 'invalid',
        message: `Gemini ${res.status}: ${text.slice(0, 200)}`,
      }
    }

    interface GeminiResponse {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { mimeType: string; data: string } }> }
        finishReason?: string
      }>
      promptFeedback?: { blockReason?: string }
    }
    const json = (await res.json()) as GeminiResponse
    const blocked = json.promptFeedback?.blockReason ?? json.candidates?.[0]?.finishReason
    if (blocked && blocked !== 'STOP') {
      return { ok: false, reason: 'safety', message: `Blocked: ${blocked}` }
    }

    const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData
    if (!inline?.data) return { ok: false, reason: 'invalid', message: 'no inlineData in response' }

    return { ok: true, outputPng: decodeBase64(inline.data) }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: 'Gemini call timed out' }
    }
    return {
      ok: false,
      reason: 'transient',
      message: err instanceof Error ? err.message : 'unknown',
    }
  } finally {
    clearTimeout(t)
  }
}

/**
 * OpenAI image generation (Deno).
 * See also: lib/image-provider/openai.ts (Node copy — keep failure taxonomy in sync)
 */
async function callOpenAI(prompt: string, imageUrls: string[]): Promise<GeminiOk | GeminiFail> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  const modelId = Deno.env.get('OPENAI_IMAGE_MODEL') ?? 'gpt-image-2'

  if (!apiKey) return { ok: false, reason: 'invalid', message: 'OPENAI_API_KEY missing' }

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)

  try {
    let res: Response

    if (imageUrls.length > 0) {
      // Identity-preserving: use /v1/images/edits (multipart form).
      // Fetch raw bytes directly — fetchAsInlineData returns Gemini's base64 format,
      // not suitable for OpenAI multipart.
      const form = new FormData()
      form.append('model', modelId)
      form.append('prompt', prompt)
      form.append('n', '1')

      // Wired to the same abort signal as the OpenAI call below — without
      // this, a hung/stalled fetch here blocks forever with no timeout.
      for (let i = 0; i < imageUrls.length; i++) {
        const rawRes = await fetch(imageUrls[i], { signal: controller.signal })
        if (!rawRes.ok) throw new Error(`image fetch ${rawRes.status}: ${imageUrls[i]}`)
        const blob = await rawRes.blob()
        form.append(i === 0 ? 'image' : `image[${i}]`, blob, `image${i}.png`)
      }

      res = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      })
    } else {
      // Text-to-image: use /v1/images/generations
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelId, prompt, n: 1 }),
        signal: controller.signal,
      })
    }

    if (!res.ok) {
      const text = await res.text()
      if (res.status === 400 && text.includes('moderation_blocked')) {
        return { ok: false, reason: 'safety', message: `OpenAI policy: ${text.slice(0, 200)}` }
      }
      const transient = res.status === 429 || res.status >= 500
      return {
        ok: false,
        reason: transient ? 'transient' : 'invalid',
        message: `OpenAI ${res.status}: ${text.slice(0, 200)}`,
      }
    }

    interface OpenAIResponse {
      data?: Array<{ b64_json?: string }>
    }
    const json = (await res.json()) as OpenAIResponse
    const b64 = json.data?.[0]?.b64_json
    if (!b64) return { ok: false, reason: 'invalid', message: 'no b64_json in OpenAI response' }
    return { ok: true, outputPng: decodeBase64(b64) }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: 'OpenAI call timed out' }
    }
    return {
      ok: false,
      reason: 'transient',
      message: err instanceof Error ? err.message : 'unknown',
    }
  } finally {
    clearTimeout(t)
  }
}

async function callProvider(
  model: EdgeImageModel,
  prompt: string,
  imageUrls: string[]
): Promise<GeminiOk | GeminiFail> {
  const provider = MODEL_PROVIDER[model]
  if (provider === 'openai') return callOpenAI(prompt, imageUrls)
  return callGemini(model as 'nano-banana' | 'nano-banana-pro', prompt, imageUrls)
}

async function fetchAsInlineData(
  url: string,
  signal: AbortSignal
): Promise<{ inlineData: { mimeType: string; data: string } }> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`image fetch ${res.status}: ${url}`)
  const mimeType = res.headers.get('content-type') ?? 'image/jpeg'
  const bytes = new Uint8Array(await res.arrayBuffer())
  return { inlineData: { mimeType, data: encodeBase64(bytes) } }
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
