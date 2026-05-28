import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { parseIdempotencyKey } from '@/lib/idempotency'
import { anonymousFingerprintLimiter } from '@/lib/rate-limit'
import { isAnonymousBudgetExceeded } from '@/lib/gemini/cost'
import { collectImageInputs, interpolatePrompt, type TrendInputValues } from '@/lib/trends/interpolate'
import { TrendInputSchema } from '@/lib/trends/input-schema'
import { getActiveTrendBySlug } from '@/lib/trends/repository'

export const runtime = 'nodejs'

const BodySchema = z.object({
  trend_slug: z.string().min(1).max(120),
  values: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  /** Cloudflare Turnstile token from the client widget. */
  turnstile_token: z.string().min(10),
  /** SHA-256-hashed FingerprintJS visitor id; client computes hash to avoid raw fingerprint reaching server. */
  fingerprint_hash: z.string().regex(/^[0-9a-f]{64}$/),
})

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true // dev/test: no-op
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
  })
  if (!res.ok) return false
  const json = (await res.json()) as { success?: boolean }
  return json.success === true
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function POST(request: NextRequest) {
  // 1. Idempotency
  const idem = parseIdempotencyKey(request.headers)
  if (!idem.ok || !idem.key) {
    return NextResponse.json({ error: idem.error ?? 'bad idempotency key' }, { status: 400 })
  }

  // 2. Body
  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await request.json())
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'invalid body' },
      { status: 400 }
    )
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

  // 3. Turnstile gate
  const turnstileOk = await verifyTurnstile(body.turnstile_token, ip)
  if (!turnstileOk) {
    return NextResponse.json({ error: 'Bot check failed' }, { status: 403 })
  }

  // 4. Per-fingerprint sliding-window limit (extra guard beyond the DB unique constraint)
  const limited = await anonymousFingerprintLimiter.limit(`fp:${body.fingerprint_hash}`)
  if (!limited.success) {
    return NextResponse.json({ error: 'Too many attempts from this device' }, { status: 429 })
  }

  // 5. Daily abuse budget guard
  const supabase = createServiceClient()
  const dailyCap = Number(process.env.ANONYMOUS_DAILY_BUDGET_USD ?? '20')
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: todays } = await supabase
    .from('anonymous_attempts')
    .select('cost_usd')
    .gte('created_at', since)
  const spent = ((todays as { cost_usd: number }[] | null) ?? []).reduce(
    (acc, r) => acc + Number(r.cost_usd ?? 0),
    0
  )
  if (isAnonymousBudgetExceeded(spent, dailyCap)) {
    return NextResponse.json(
      { error: 'Anonymous trial paused for today — sign up to continue' },
      { status: 503 }
    )
  }

  // 6. Trend lookup
  const trend = await getActiveTrendBySlug(body.trend_slug)
  if (!trend) {
    return NextResponse.json({ error: 'Trend not found or inactive' }, { status: 404 })
  }

  // 7. Validate values against the trend schema
  const schemaCheck = TrendInputSchema.safeParse(trend.input_schema)
  if (!schemaCheck.success) {
    return NextResponse.json({ error: 'Trend input_schema corrupt' }, { status: 500 })
  }
  const values = body.values as TrendInputValues
  try {
    collectImageInputs(schemaCheck.data, values)
    interpolatePrompt('', schemaCheck.data, values)
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'invalid input' },
      { status: 400 }
    )
  }

  // 8. Insert anonymous_attempts row. UNIQUE (fingerprint_hash, ip_hash) blocks 2nd attempt lifetime.
  const ipHash = await sha256Hex(ip)
  const insertRow = {
    fingerprint_hash: body.fingerprint_hash,
    ip_hash: ipHash,
    trend_id: trend.id,
    status: 'pending',
  } as never

  const { data: inserted, error: insertError } = await supabase
    .from('anonymous_attempts')
    .insert(insertRow)
    .select('id')
    .maybeSingle()

  if (insertError) {
    if (insertError.message.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'You already used your free anonymous trial — sign up to continue' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  if (!inserted) {
    return NextResponse.json({ error: 'Insert returned no row' }, { status: 500 })
  }

  // Supabase DB webhook → Edge Function picks up + calls Gemini.
  return NextResponse.json({ anonymous_attempt_id: (inserted as { id: string }).id })
}
