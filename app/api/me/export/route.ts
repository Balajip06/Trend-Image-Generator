/**
 * GDPR Article 15 right-of-access: stream the signed-in user's full export
 * (profile + every generation row + short-TTL signed download URLs) as a
 * single JSON file. PII — never cached, never logged.
 */

import { NextResponse } from 'next/server'
import { EVENTS, flushServer, trackServer } from '@/lib/analytics/server'
import { MOCK_GENERATIONS, MOCK_PROFILE, MOCK_TRENDS_ENABLED, MOCK_USER } from '@/lib/dev/mock-data'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  buildExportFilename,
  buildExportPayload,
  EXPORT_SIGNED_URL_TTL_SECONDS,
  type ExportGenerationInput,
  type ExportProfile,
} from '@/lib/utils/export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProfileRow {
  email: string
  credits_balance: number
  free_used_this_week: number
  bonus_credits_earned: number
  referral_code: string
  created_at: string
  deleted_at: string | null
  name: string | null
  avatar_url: string | null
}

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

const PROFILE_COLUMNS =
  'email, credits_balance, free_used_this_week, bonus_credits_earned, referral_code, created_at, deleted_at, name, avatar_url'

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
    const profile: ExportProfile = {
      ...MOCK_PROFILE,
      created_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
      name: null,
      avatar_url: null,
    }
    return respondWithExport(MOCK_USER.id, profile, generations, now)
  }

  // Real flow.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: profileRow, error: profileError } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profileRow) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }
  const profile = profileRow as unknown as ProfileRow

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
    const page = (data ?? []) as unknown as GenerationRow[]
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
        signedUrl = error ? null : data?.signedUrl ?? null
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

  const exportProfile: ExportProfile = {
    email: profile.email,
    credits_balance: profile.credits_balance,
    free_used_this_week: profile.free_used_this_week,
    bonus_credits_earned: profile.bonus_credits_earned,
    referral_code: profile.referral_code,
    created_at: profile.created_at,
    deleted_at: profile.deleted_at,
    name: profile.name,
    avatar_url: profile.avatar_url,
  }

  trackServer(user.id, EVENTS.DATA_EXPORTED, {
    generation_count: signed.length,
  })
  await flushServer()

  return respondWithExport(user.id, exportProfile, signed, now)
}

function respondWithExport(
  userId: string,
  profile: ExportProfile,
  generations: ExportGenerationInput[],
  now: Date
): NextResponse {
  const payload = buildExportPayload(userId, profile, generations, now)
  const filename = buildExportFilename(userId, now.toISOString())
  const body = JSON.stringify(payload, null, 2)

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  })
}
