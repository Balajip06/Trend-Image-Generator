import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { generationUserLimiter } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const MAX_ATTEMPTS = 3

const BodySchema = z.object({
  generation_id: z.string().uuid(),
})

/**
 * Re-fires a failed_retryable generation using the row's stored
 * idempotency_key. Replaces the prior client-side retry which echoed
 * the key into hydration JSON (red-team L4) — the client never sees
 * the key, the server reads it from the row and re-enqueues.
 *
 * Auth: standard cookie session. The caller must own the row.
 *
 * Guards (H-C1 / Risk #12):
 *   - Only `failed_retryable` rows are re-queueable. `failed` rows were
 *     already refunded by refund_quota_on_failure; retrying them would
 *     be a free paid generation.
 *   - Attempts capped at MAX_ATTEMPTS to prevent unbounded paid loops.
 *   - Per-user rate limit applied on top of the existing IP limiter.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // Per-user rate limit — same ceiling as /api/generate (H-C1)
  const limitResult = await generationUserLimiter.limit(user.id)
  if (!limitResult.success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let parsed: z.infer<typeof BodySchema>
  try {
    parsed = BodySchema.parse(await request.json())
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'invalid body' },
      { status: 400 }
    )
  }

  // RLS-filtered SELECT: anon-key client only returns rows where
  // auth.uid() = user_id. Ownership check is implicit.
  const { data: gen } = await supabase
    .from('generations')
    .select('id, user_id, status, trend_id, attempts')
    .eq('id', parsed.generation_id)
    .maybeSingle()
  if (!gen) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only failed_retryable is re-queueable.
  // 'failed' rows were already refunded by refund_quota_on_failure — retrying
  // them would be a free paid generation (H-C1 / Risk #12).
  if (gen.status !== 'failed_retryable') {
    return NextResponse.json(
      { error: 'Not retryable — only failed_retryable rows can be retried' },
      { status: 409 }
    )
  }

  if (gen.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: `Max attempts (${MAX_ATTEMPTS}) reached` },
      { status: 409 }
    )
  }

  // Flip the row back to pending so the Edge Function picks it up
  // again. Service-role bypasses RLS so the status transition succeeds
  // even when the user-update policy doesn't permit arbitrary status
  // writes.
  const service = createServiceClient()
  const { error: updateError } = await service
    .from('generations')
    .update({ status: 'pending', error_message: null, attempts: gen.attempts + 1 })
    .eq('id', gen.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
