/**
 * GDPR Article 15 right-of-access: stream the signed-in user's generation
 * history (every row + short-TTL signed download URLs) as a single CSV.
 * PII — never cached, never logged.
 *
 * Scope note: profile fields (email, credits, referral code) are
 * intentionally NOT included in this download per explicit user request —
 * they're already visible on the settings page UI. This narrows Article 15
 * coverage; revisit before any formal GDPR compliance review.
 */

import { NextResponse } from 'next/server'
import { EVENTS, flushServer, trackServer } from '@/lib/analytics/server'
import { MOCK_GENERATIONS, MOCK_TRENDS_ENABLED, MOCK_USER } from '@/lib/dev/mock-data'
import { exportUserLimiter } from '@/lib/rate-limit'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  buildExportFilename,
  buildGenerationsCsv,
  EXPORT_SIGNED_URL_TTL_SECONDS,
  type ExportGenerationInput,
} from '@/lib/utils/export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface GenerationRow {
  id: string
  user_id: string
  trend_id: string
  status: string
  output_image_url: string | null
  error_message: string | null
  attempts: number
  idempotency_key: string
  created_at: string
  completed_at: string | null
  cost_usd: number
  purge_at: string | null
  model_used: string | null
}

const GENERATION_COLUMNS =
  'id, user_id, trend_id, status, output_image_url, error_message, attempts, idempotency_key, created_at, completed_at, cost_usd, purge_at, model_used'

const PAGE_SIZE = 1000

export async function GET() {
  const now = new Date()

  // Mock-mode short-circuit so dev can hit the endpoint without real auth.
  if (MOCK_TRENDS_ENABLED) {
    const generations: ExportGenerationInput[] = MOCK_GENERATIONS.map((g) => ({
      id: g.id,
      trend_id: g.trend_id,
      status: g.status,
      output_image_url: g.output_image_url,
      error_message: g.error_message,
      attempts: g.attempts,
      idempotency_key: g.idempotency_key,
      created_at: g.created_at,
      completed_at: g.completed_at,
      cost_usd: g.cost_usd,
      purge_at: g.purge_at,
      model_used: null,
      signed_download_url: g.output_image_url, // No signing in mock mode.
    }))
    return respondWithExport(MOCK_USER.id, generations, now)
  }

  // Real flow.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Rate-limit per user: GDPR Article 15 is a real right but a single user
  // hammering this endpoint would burst Supabase Storage signed-URL creation +
  // PostHog event flushes. 5/hr/user is generous for legitimate use.
  const rl = await exportUserLimiter.limit(user.id)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again in an hour.' },
      {
        status: 429,
        headers: { 'retry-after': String(Math.max(1, rl.reset - Math.floor(Date.now() / 1000))) },
      }
    )
  }

  // Paginate generations — full history, no cap. 1000-row pages keep memory
  // bounded if a power user has thousands of rows.
  const allGenerations: GenerationRow[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('generations')
      .select(GENERATION_COLUMNS)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      return NextResponse.json({ error: 'Failed to load generations' }, { status: 500 })
    }
    const page = data ?? []
    allGenerations.push(...page)
    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  // Sign download URLs for completed generations via service-role client.
  // The path convention matches the Edge Function: `${user_id}/${gen_id}.png`.
  const service = createServiceClient()
  const signed = await Promise.all(
    allGenerations.map(async (g) => {
      let signedUrl: string | null = null
      if (g.status === 'completed' && g.output_image_url) {
        const path = `${g.user_id}/${g.id}.png`
        const { data, error } = await service.storage
          .from('outputs')
          .createSignedUrl(path, EXPORT_SIGNED_URL_TTL_SECONDS)
        signedUrl = error ? null : (data?.signedUrl ?? null)
      }
      const exportRow: ExportGenerationInput = {
        id: g.id,
        trend_id: g.trend_id,
        status: g.status,
        output_image_url: g.output_image_url,
        error_message: g.error_message,
        attempts: g.attempts,
        idempotency_key: g.idempotency_key,
        created_at: g.created_at,
        completed_at: g.completed_at,
        cost_usd: g.cost_usd,
        purge_at: g.purge_at,
        model_used: g.model_used,
        signed_download_url: signedUrl,
      }
      return exportRow
    })
  )

  trackServer(user.id, EVENTS.DATA_EXPORTED, {
    generation_count: signed.length,
  })
  await flushServer()

  return respondWithExport(user.id, signed, now)
}

function respondWithExport(
  userId: string,
  generations: ExportGenerationInput[],
  now: Date
): NextResponse {
  const filename = buildExportFilename(userId, now.toISOString())
  const csv = buildGenerationsCsv(generations)

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  })
}
