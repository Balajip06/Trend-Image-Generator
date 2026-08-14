// Supabase Edge Function — generate-image
// Triggered by a DB trigger (generations_invoke_edge, migration
// 20260713000001) on `generations` INSERT via pg_net.
// Deno runtime; uses Web Fetch + AbortController for portability.
//
// Configure in Supabase Dashboard:
//   1. Storage buckets `uploads` + `outputs` exist (see migration 0007)
//   2. Function secrets: GEMINI_API_KEY, OPENAI_API_KEY, OPENAI_IMAGE_MODEL,
//      SENTRY_DSN, SUPABASE_URL, SUPABASE_SECRET_KEYS (auto-injected by
//      Supabase; legacy JWT keys are disabled on this project)
//
// Failure model per amended plan §"Phase 3":
//   - safety   → status='failed' (DB trigger refunds quota)
//   - timeout  → status='failed_retryable', attempts++
//   - transient→ status='failed_retryable', attempts++
//   - after 3 attempts → status='failed' (terminal, refund)

// @ts-expect-error Deno-only import; not resolved by Node typecheck.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Pricing comes from the GENERATED copy of lib/pricing/models.ts. Both tables
// used to be maintained by hand behind "keep in sync" comments, and only this
// one is on the customer path — so drift silently made margins and cost limits
// disagree with what was actually charged. Regenerate with `pnpm sync:pricing`;
// lib/pricing/pricing-sync.test.ts fails CI on drift.
import { COST_USD } from './pricing.generated.ts'

// Supabase auto-injects the platform secret key as SUPABASE_SECRET_KEYS, a
// JSON object ({"default": "sb_secret_..."}), replacing the legacy
// SUPABASE_SERVICE_ROLE_KEY JWT var now that legacy keys are disabled on this
// project. Falls back to the legacy var so this keeps working if legacy keys
// are ever re-enabled.
function getSupabaseSecretKey(): string {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, string>
      if (parsed.default) return parsed.default
    } catch {
      // fall through to legacy var
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
}

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

type EdgeImageModel = 'nano-banana-2' | 'nano-banana-2-lite' | 'gpt-image-2'
type EdgeProvider = 'gemini' | 'openai'

interface TrendRow {
  id: string
  prompt_template: string
  model: EdgeImageModel
  aspect_ratio: string
  version: number
}

/**
 * Anonymous trial row. Narrower than GenerationRow: no user, no quota, no
 * retries — one shot per fingerprint+IP, lifetime.
 */
interface AnonymousAttemptRow {
  id: string
  trend_id: string
  input_payload: {
    values: Record<string, string | string[]>
    image_urls?: string[]
  } | null
  status: GenerationStatus
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
/**
 * Don't start a fallback attempt with less than this much wall clock left —
 * it cannot finish, and being killed mid-call strands the row in `processing`
 * with no terminal write and no quota refund. Returning the primary failure
 * instead lets the normal retry/refund path run.
 */
const MIN_FALLBACK_BUDGET_MS = 20_000


// Gemini model IDs — not used for OpenAI
const GEMINI_MODEL_ID: Record<'nano-banana-2' | 'nano-banana-2-lite', string> = {
  'nano-banana-2': 'gemini-3.1-flash-image',
  'nano-banana-2-lite': 'gemini-3.1-flash-lite-image',
}

const MODEL_PROVIDER: Record<EdgeImageModel, EdgeProvider> = {
  'nano-banana-2': 'gemini',
  'nano-banana-2-lite': 'gemini',
  'gpt-image-2': 'openai',
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

  // Two row shapes reach this function: authenticated `generations` and
  // anonymous `anonymous_attempts` (dispatched by the trigger added in
  // migration 20260814000004). They share the provider call and the cost gate
  // but differ in columns and completion handling, so they are processed by
  // separate functions rather than one branching path.
  const isAnonymous = payload.table === 'anonymous_attempts'
  if (payload.type !== 'INSERT' || (payload.table !== 'generations' && !isAnonymous)) {
    return jsonResponse({ ignored: true })
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', getSupabaseSecretKey(), {
    auth: { persistSession: false },
  })

  // Absolute deadline for this invocation, threaded down to every provider
  // call. The previous implementation set a timer whose callback was a no-op
  // and which nothing read — so the "wall clock" it claimed to enforce did not
  // exist. With a per-call budget of GEMINI_TIMEOUT_MS (130s), a primary
  // timeout followed by a fallback attempt totalled 260s against Supabase's
  // hard 150s ceiling: the invocation was killed mid-call, leaving the row
  // stuck in `processing` with no terminal write and no quota refund.
  const deadlineMs = Date.now() + WALL_TIMEOUT_MS

  try {
    if (isAnonymous) {
      await processAnonymous(
        supabase,
        payload.record as unknown as AnonymousAttemptRow,
        deadlineMs
      )
    } else {
      await process(supabase, payload.record, deadlineMs)
    }
    return jsonResponse({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown'
    await reportToSentry(err, { generation_id: payload.record?.id })
    return jsonResponse({ error: message }, 500)
  }
})

/**
 * Milliseconds left before the invocation must return, floored at 0.
 * Providers use this so a retry can never outlive the platform wall clock.
 */
function remainingMs(deadlineMs: number): number {
  return Math.max(0, deadlineMs - Date.now())
}

async function process(
  supabase: ReturnType<typeof createClient>,
  gen: GenerationRow,
  deadlineMs: number
) {
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

  // 3. Cost gate — the authoritative one.
  //
  // This is the only place that knows the model AND sits before the spend.
  // /api/generate never calls a provider (a DB trigger dispatches here), so a
  // check there is advisory only; anything that reaches this function must be
  // gated here or it is not gated at all.
  //
  // Failing terminally routes through refund_quota_on_failure, so the user's
  // quota is returned rather than being consumed by a call we refused to make.
  const gate = await checkCostLimit(supabase, trendData.model)
  if (!gate.allowed) {
    await terminalFail(supabase, gen, `cost_limit: ${gate.reason}`)
    return
  }

  // 4. Build prompt + collect image URLs.
  const prompt = interpolate(trendData.prompt_template, gen.input_payload.values) + REALISM_SUFFIX
  const imageUrls =
    gen.input_payload.image_urls ?? collectImagesFromValues(gen.input_payload.values)

  // 5. Call provider (Gemini or OpenAI depending on model).
  const result = await callProvider(trendData.model, prompt, imageUrls, deadlineMs, supabase)

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
      cost_usd: COST_USD[result.modelUsed],
      // `model_used` is the provider WIRE id; `model_key` is the logical model
      // the cost limits are keyed on. Storing both means spend attribution
      // never depends on reverse-mapping a wire id that can change.
      model_key: result.modelUsed,
      model_used:
        result.modelUsed === 'gpt-image-2'
          ? (Deno.env.get('OPENAI_IMAGE_MODEL') ?? 'gpt-image-2')
          : GEMINI_MODEL_ID[result.modelUsed as 'nano-banana-2' | 'nano-banana-2-lite'],
      completed_at: new Date().toISOString(),
    })
    .eq('id', gen.id)

  // 7. Fire-and-forget push + email dispatch via Next.js API. Best-effort —
  //    failure here does not roll back the completed generation; user can
  //    still poll via Realtime or open /me/creations.
  await dispatchNotification(gen.id)
}

/**
 * Anonymous trial generation.
 *
 * Separate from `process()` because the shapes genuinely differ: there is no
 * user, no quota to consume or refund, and no retry budget — an anonymous
 * attempt is one shot per fingerprint+IP for life, so a failure is terminal.
 *
 * Before this existed, anonymous rows were never dispatched at all and sat at
 * `pending` forever while /api/anonymous/[id]/status polled a status that
 * could never change.
 */
async function processAnonymous(
  supabase: ReturnType<typeof createClient>,
  attempt: AnonymousAttemptRow,
  deadlineMs: number
) {
  // Claim the row. Conditional on `pending` so a duplicate webhook delivery is
  // a no-op rather than a second paid generation.
  const { data: claimed } = await supabase
    .from('anonymous_attempts')
    .update({ status: 'processing' })
    .eq('id', attempt.id)
    .eq('status', 'pending')
    .select()
    .maybeSingle()
  if (!claimed) return

  if (!attempt.input_payload) {
    await failAnonymous(supabase, attempt.id, 'missing input payload')
    return
  }

  const { data: trendData } = await supabase
    .from('trends')
    .select('id, prompt_template, model, aspect_ratio, version')
    .eq('id', attempt.trend_id)
    .maybeSingle<TrendRow>()
  if (!trendData) {
    await failAnonymous(supabase, attempt.id, 'trend not found')
    return
  }

  // Same per-model ceiling as customer traffic — anonymous spend is real spend.
  // The route's separate $20/day anonymous budget is an independent second bound.
  const gate = await checkCostLimit(supabase, trendData.model)
  if (!gate.allowed) {
    await failAnonymous(supabase, attempt.id, `cost_limit: ${gate.reason}`)
    return
  }

  const prompt = interpolate(trendData.prompt_template, attempt.input_payload.values) + REALISM_SUFFIX
  const imageUrls =
    attempt.input_payload.image_urls ?? collectImagesFromValues(attempt.input_payload.values)

  const result = await callProvider(trendData.model, prompt, imageUrls, deadlineMs, supabase)

  if (!result.ok) {
    // No retries on this path: the unique (fingerprint_hash, ip_hash)
    // constraint means the visitor cannot try again anyway.
    await failAnonymous(
      supabase,
      attempt.id,
      result.reason === 'safety' ? `safety: ${result.message}` : result.message
    )
    return
  }

  const outputPath = `anonymous/${attempt.id}.png`
  const { error: uploadError } = await supabase.storage
    .from('outputs')
    .upload(outputPath, result.outputPng, { contentType: 'image/png', upsert: true })
  if (uploadError) {
    await failAnonymous(supabase, attempt.id, `upload failed: ${uploadError.message}`)
    return
  }

  const { data: publicUrl } = supabase.storage.from('outputs').getPublicUrl(outputPath)

  // `cost_usd` + `model_key` are what make anonymous spend visible to BOTH the
  // $20/day anonymous budget and the per-model ceiling. Neither was ever
  // written before, so both bounds were summing zeros.
  await supabase
    .from('anonymous_attempts')
    .update({
      status: 'completed',
      output_image_url: publicUrl.publicUrl,
      cost_usd: COST_USD[result.modelUsed],
      model_key: result.modelUsed,
      completed_at: new Date().toISOString(),
    })
    .eq('id', attempt.id)
}

async function failAnonymous(
  supabase: ReturnType<typeof createClient>,
  id: string,
  message: string
) {
  await supabase
    .from('anonymous_attempts')
    .update({
      status: 'failed',
      error_message: message,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
}

async function dispatchNotification(generationId: string): Promise<void> {
  const siteUrl = Deno.env.get('SITE_URL')
  const serviceKey = getSupabaseSecretKey()
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
  model: 'nano-banana-2' | 'nano-banana-2-lite',
  prompt: string,
  imageUrls: string[],
  budgetMs: number = GEMINI_TIMEOUT_MS
): Promise<GeminiOk | GeminiFail> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return { ok: false, reason: 'invalid', message: 'GEMINI_API_KEY missing' }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID[model]}:generateContent?key=${apiKey}`

  // Controller created before the image fetches below so they share the
  // same timeout — without this, a hung/stalled image fetch blocks forever
  // with no timeout at all. `budgetMs` is the caller's remaining wall clock.
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), budgetMs)

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
async function callOpenAI(
  prompt: string,
  imageUrls: string[],
  budgetMs: number = GEMINI_TIMEOUT_MS
): Promise<GeminiOk | GeminiFail> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  const modelId = Deno.env.get('OPENAI_IMAGE_MODEL') ?? 'gpt-image-2'

  if (!apiKey) return { ok: false, reason: 'invalid', message: 'OPENAI_API_KEY missing' }

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), budgetMs)

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
      // Explicit size + quality: without these gpt-image-2 defaults to its
      // slowest config (high quality, large size). Keep in sync with the Node
      // copy in lib/image-provider/openai.ts.
      form.append('size', '1024x1024')
      form.append('quality', 'medium')

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
        body: JSON.stringify({
          model: modelId,
          prompt,
          n: 1,
          size: '1024x1024',
          quality: 'medium',
        }),
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

async function callOneProvider(
  model: EdgeImageModel,
  prompt: string,
  imageUrls: string[],
  budgetMs: number
): Promise<GeminiOk | GeminiFail> {
  const provider = MODEL_PROVIDER[model]
  if (provider === 'openai') return callOpenAI(prompt, imageUrls, budgetMs)
  return callGemini(model as 'nano-banana-2' | 'nano-banana-2-lite', prompt, imageUrls, budgetMs)
}

// Reasons worth retrying on a DIFFERENT model. Mirrors lib/image-provider
// FALLBACK_REASONS (Node copy — keep in sync). 'safety' re-blocks on any
// model; the Edge GeminiFail union has no 'not-configured'.
const EDGE_FALLBACK_REASONS = new Set(['timeout', 'transient', 'invalid'])

function edgeFallbackModelFor(model: EdgeImageModel): EdgeImageModel {
  return model === 'nano-banana-2-lite' ? 'nano-banana-2' : 'nano-banana-2-lite'
}

/**
 * Auto-fallback: if the chosen model fails with a retryable reason, retry once
 * on the fallback model. Returns the winning result plus the model that
 * produced it (so cost + model_used reflect reality). Keep the reason set +
 * fallback choice in sync with lib/image-provider/index.ts.
 */
interface CostLimitEntry {
  daily_usd?: number | null
  monthly_usd?: number | null
  enabled?: boolean
}

/**
 * Is this model still within its admin-configured budget?
 *
 * Limits live in `app_settings.model_cost_limits`; spend comes from the
 * `model_spend_usd` RPC, which counts customer generations AND admin eval runs
 * so both paths share one ceiling.
 *
 * FAILS OPEN on a missing/unreadable config: a limits-lookup outage must not
 * take down generation for every customer. It fails CLOSED only on an explicit
 * `enabled: false` or a breached numeric cap. A null bound means "no limit",
 * matching the established app_settings convention.
 */
async function checkCostLimit(
  supabase: ReturnType<typeof createClient>,
  model: EdgeImageModel
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  try {
    const { data: setting, error: settingError } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'model_cost_limits')
      .maybeSingle()
    if (settingError || !setting?.value) return { allowed: true }

    const limits = (setting.value as Record<string, CostLimitEntry>)[model]
    if (!limits) return { allowed: true }

    if (limits.enabled === false) {
      return { allowed: false, reason: `${model} is disabled` }
    }

    const { data: spendRows, error: spendError } = await supabase.rpc('model_spend_usd', {
      p_model: model,
    })
    if (spendError) return { allowed: true }

    const spend = Array.isArray(spendRows) ? spendRows[0] : spendRows
    const daily = Number(spend?.daily_usd ?? 0)
    const monthly = Number(spend?.monthly_usd ?? 0)

    if (limits.daily_usd != null && daily >= limits.daily_usd) {
      return {
        allowed: false,
        reason: `${model} daily cap reached ($${daily.toFixed(4)} of $${limits.daily_usd})`,
      }
    }
    if (limits.monthly_usd != null && monthly >= limits.monthly_usd) {
      return {
        allowed: false,
        reason: `${model} monthly cap reached ($${monthly.toFixed(2)} of $${limits.monthly_usd})`,
      }
    }
    return { allowed: true }
  } catch {
    // Fail open — see the note above.
    return { allowed: true }
  }
}

async function callProvider(
  model: EdgeImageModel,
  prompt: string,
  imageUrls: string[],
  deadlineMs: number,
  supabase: ReturnType<typeof createClient>
): Promise<(GeminiOk & { modelUsed: EdgeImageModel }) | GeminiFail> {
  // Primary gets the smaller of its own budget and whatever is left of the
  // invocation's wall clock.
  const primary = await callOneProvider(
    model,
    prompt,
    imageUrls,
    Math.min(GEMINI_TIMEOUT_MS, remainingMs(deadlineMs))
  )
  if (primary.ok) return { ...primary, modelUsed: model }
  if (!EDGE_FALLBACK_REASONS.has(primary.reason)) return primary

  const fallback = edgeFallbackModelFor(model)
  if (fallback === model) return primary

  // Only attempt the fallback if enough wall clock remains for it to plausibly
  // finish. Starting a second 130s call after a 130s timeout guaranteed the
  // platform killed us mid-flight, stranding the row in `processing` with no
  // refund — strictly worse than returning the primary's failure, which at
  // least reaches terminalFail/markRetryable and refunds quota.
  const budget = remainingMs(deadlineMs)
  if (budget < MIN_FALLBACK_BUDGET_MS) return primary

  // Re-gate on the FALLBACK model. Without this, a capped or disabled model is
  // still reachable indirectly whenever the primary fails — and the fallback
  // can be the more expensive of the pair, so the escalation is exactly the
  // case a budget is meant to stop.
  const fallbackGate = await checkCostLimit(supabase, fallback)
  if (!fallbackGate.allowed) return primary

  const fb = await callOneProvider(fallback, prompt, imageUrls, budget)
  if (fb.ok) return { ...fb, modelUsed: fallback }
  return fb
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
