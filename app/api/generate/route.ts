import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { parseIdempotencyKey } from '@/lib/idempotency'
import { generationIpLimiter } from '@/lib/rate-limit'
import {
  interpolatePrompt,
  collectImageInputs,
  type TrendInputValues,
} from '@/lib/trends/interpolate'
import { TrendInputSchema } from '@/lib/trends/input-schema'
import { getActiveTrendBySlug } from '@/lib/trends/repository'
import { assertStorageUrl } from '@/lib/storage/validate-image-url'
import { getServerEnv } from '@/lib/env'

export const runtime = 'nodejs'

// Per-value caps are tight on purpose. Signed Supabase URLs run ~500 chars
// today; 5000 leaves headroom for query params and future signature schemes.
// max(8) on arrays mirrors the image-field cap in TrendInputSchema.
const ValueSchema = z.union([z.string().max(5000), z.array(z.string().max(5000)).max(8)])

const MAX_FIELDS = 20
const BodySchema = z.object({
  trend_slug: z.string().min(1).max(120),
  values: z
    .record(z.string().max(50), ValueSchema)
    .refine((v) => Object.keys(v).length <= MAX_FIELDS, {
      message: `too many fields (max ${MAX_FIELDS})`,
    }),
})

// Reject obviously oversize bodies before parsing. 64 KB easily fits 20 fields
// × 8 signed URLs × ~500 chars; anything larger is malformed or hostile.
const MAX_BODY_BYTES = 64 * 1024

export async function POST(request: NextRequest) {
  // 1. Idempotency
  const idem = parseIdempotencyKey(request.headers)
  if (!idem.ok || !idem.key) {
    return NextResponse.json({ error: idem.error ?? 'bad idempotency key' }, { status: 400 })
  }

  // 2. Per-IP rate limit (no-op when Upstash creds missing)
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const limited = await generationIpLimiter.limit(`ip:${ip}`)
  if (!limited.success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // 3. Auth
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // 4. Global unlimited-tier daily cap (H-C7 / Risk #1)
  // kimp/vip tiers have no per-week free quota, so the primary backstop is the
  // per-IP rate limiter (20/hr). This secondary count-based guard protects
  // against a single compromised unlimited account burning budget unbounded.
  // Threshold: UNLIMITED_DAILY_BUDGET_USD (env, default 500 gens/day).
  // cost_usd is written post-completion by the Edge Function, so we count rows
  // rather than sum costs.
  {
    const env = getServerEnv()
    const UNLIMITED_GEN_CAP = Math.round(env.UNLIMITED_DAILY_BUDGET_USD * 10) // $50 default → 500
    const dayStart = new Date()
    dayStart.setUTCHours(0, 0, 0, 0)
    const { count } = await supabase
      .from('generations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('tier_at_generation', ['kimp', 'vip'])
      .gte('created_at', dayStart.toISOString())
    if ((count ?? 0) >= UNLIMITED_GEN_CAP) {
      return NextResponse.json({ error: 'Daily generation limit reached' }, { status: 429 })
    }
  }

  // 5. Body validation
  // Red-team H2: prior code trusted `content-length`. Chunked transfer
  // omits that header, `Number(null) === 0` passed the guard, and
  // `request.json()` then buffered without bound. Fix: stream the body
  // and abort as soon as we cross MAX_BODY_BYTES, regardless of whether
  // a `Content-Length` was advertised. The Content-Length pre-check is
  // kept as a cheap reject-early for clients that advertised honestly.
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Body too large' }, { status: 413 })
  }
  let rawBody: string
  try {
    const reader = request.body?.getReader()
    if (!reader) {
      return NextResponse.json({ error: 'Body required' }, { status: 400 })
    }
    const chunks: Uint8Array[] = []
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        received += value.byteLength
        if (received > MAX_BODY_BYTES) {
          await reader.cancel()
          return NextResponse.json({ error: 'Body too large' }, { status: 413 })
        }
        chunks.push(value)
      }
    }
    const total = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      total.set(chunk, offset)
      offset += chunk.byteLength
    }
    rawBody = new TextDecoder('utf-8', { fatal: false }).decode(total)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'body read failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
  let parsedBody: z.infer<typeof BodySchema>
  try {
    parsedBody = BodySchema.parse(JSON.parse(rawBody))
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'invalid body'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // 6. Trend fetch (RLS-filtered: only active + not expired)
  const trend = await getActiveTrendBySlug(parsedBody.trend_slug)
  if (!trend) {
    return NextResponse.json({ error: 'Trend not found or inactive' }, { status: 404 })
  }

  // 7. Validate values against the trend's input_schema (defence in depth — DB also checks).
  const schemaCheck = TrendInputSchema.safeParse(trend.input_schema)
  if (!schemaCheck.success) {
    return NextResponse.json({ error: 'Trend input_schema corrupt' }, { status: 500 })
  }

  // 8. Build prompt + image URL list. Validation throws on missing required.
  const values = parsedBody.values as TrendInputValues
  let _imageUrls: string[]
  try {
    _imageUrls = collectImageInputs(schemaCheck.data, values)
    interpolatePrompt(/* prompt template lives on full trend row */ '', schemaCheck.data, values)
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'invalid input' },
      { status: 400 }
    )
  }

  // 9. SSRF guard: assertStorageUrl is also called inside collectImageInputs, but
  //    we re-check here so raw API calls that bypass collectImageInputs can't reach
  //    the DB with arbitrary URLs.
  for (const [key, val] of Object.entries(values)) {
    const field = trend.input_schema?.fields?.find((f: { name: string }) => f.name === key)
    if (field?.type === 'image') {
      try {
        const urls = Array.isArray(val) ? val : [val]
        urls.forEach(assertStorageUrl)
      } catch {
        return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 })
      }
    }
  }

  // 10. Insert generation row. UNIQUE (user_id, idempotency_key) makes replay safe;
  //    BEFORE-INSERT trigger consumes quota and raises on exhaustion.
  //    tier_at_generation is required by the type but the BEFORE INSERT trigger
  //    overwrites this value with the correct bucket — 'free' is a placeholder.
  const insertRow = {
    user_id: user.id,
    trend_id: trend.id,
    trend_version: 1, // TODO Phase 3 impl: read from full trend row
    idempotency_key: idem.key,
    input_payload: { values, image_urls: _imageUrls },
    status: 'pending' as const,
    tier_at_generation: 'free' as const,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('generations')
    .insert(insertRow)
    .select('id')
    .maybeSingle()

  if (insertError) {
    if (insertError.message.includes('duplicate key')) {
      // Idempotency replay — fetch the existing row by (user_id, idempotency_key)
      const { data: existing } = await supabase
        .from('generations')
        .select('id')
        .eq('user_id', user.id)
        .eq('idempotency_key', idem.key)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ generation_id: (existing as { id: string }).id, replayed: true })
      }
    }
    if (insertError.message.includes('quota exhausted')) {
      return NextResponse.json({ error: 'Out of credits' }, { status: 402 })
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  if (!inserted) {
    return NextResponse.json({ error: 'Insert returned no row' }, { status: 500 })
  }

  // Supabase DB webhook → Edge Function picks up the new row and calls Gemini.
  return NextResponse.json({ generation_id: (inserted as { id: string }).id })
}
