/**
 * Nightly KIMP360 churn re-verify cron.
 *
 * Two callers:
 *   1. Vercel Cron — 03:30 UTC daily, sends `Authorization: Bearer ${CRON_SECRET}`
 *   2. Admin manual trigger — authenticated admin session (no header needed)
 *
 * Fail-safe: if the KIMP360 status API is unavailable the run aborts and
 * writes a `kimp_reverify_failed` audit row. It NEVER mass-revokes on API error.
 *
 * Idempotency: cron runs insert a `webhook_events` row
 * `source='kimp360', event_id='reverify:<date>'` before processing.
 * A 409 unique-conflict means the cron already ran today — return early.
 *
 * 14-day grace: a user is only revoked if their `kimp_verified_at` is
 * older than 14 days AND their current status came back inactive.
 * This prevents revocation on transient API downtime.
 */

import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { logAdminAction } from '@/lib/admin/audit'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkKimpStatus } from '@/lib/auth/kimp/status-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000

function verifyCronBearer(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !authHeader) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const provided = Buffer.from(authHeader)
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get('authorization')
  const isCron = verifyCronBearer(auth)
  let adminId: string | null = null

  if (!isCron) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

    const svc = createServiceClient()
    const { data: adminRow } = await svc
      .from('admin_users')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!adminRow || adminRow.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    adminId = user.id
  }

  const service = createServiceClient()

  // Cron-only idempotency: only run once per calendar day (UTC).
  if (isCron) {
    const eventId = `reverify:${new Date().toISOString().slice(0, 10)}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dupError } = await (service as any)
      .from('webhook_events')
      .insert({ source: 'kimp360', event_id: eventId, payload: {} })
    if (dupError?.code === '23505') {
      return NextResponse.json({ skipped: true, reason: 'already_run_today' })
    }
  }

  // ── Phase A: re-verify linked profiles (have kimp_subject_id) ────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: linkedRows } = await (service as any)
    .from('profiles')
    .select('id, email, kimp_subject_id, kimp_verified_at, kimp_unlimited, kimp_client_id')
    .not('kimp_subject_id', 'is', null)
    .is('deleted_at', null)

  const linkedProfiles = (linkedRows ?? []) as Array<{
    id: string
    email: string
    kimp_subject_id: string
    kimp_verified_at: string | null
    kimp_unlimited: boolean
    kimp_client_id: string | null
  }>

  let checked = 0
  let active = 0
  let revoked = 0
  const errors = 0

  const CHUNK_SIZE = 200
  for (let i = 0; i < linkedProfiles.length; i += CHUNK_SIZE) {
    const chunk = linkedProfiles.slice(i, i + CHUNK_SIZE)
    const subjects = chunk.map((p) => p.kimp_subject_id).filter(Boolean)

    let results
    try {
      results = await checkKimpStatus(subjects)
    } catch (err) {
      // Fail-safe: API down → abort, never mass-revoke (H-S7)
      await logAdminAction({
        adminId,
        action: 'kimp_reverify_failed',
        targetTable: 'profiles',
        targetId: null,
        after: {
          error: err instanceof Error ? err.message : 'unknown',
          checked_so_far: checked,
        },
      })
      return NextResponse.json({ error: 'status_api_unavailable' }, { status: 503 })
    }

    const resultMap = new Map(results.map((r) => [r.sub, r.status]))
    checked += chunk.length

    for (const profile of chunk) {
      const status = resultMap.get(profile.kimp_subject_id)
      if (!status) continue // not returned by API this cycle — let staleness grace handle it

      if (status === 'active') {
        active++
        if (!profile.kimp_unlimited) {
          // Restore grant via RPC (proof row will be upserted inside the function)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (service as any).rpc('grant_kimp_unlimited', {
            p_user_id: profile.id,
            p_subject: profile.kimp_subject_id,
            p_client_id: profile.kimp_client_id ?? null,
            p_verified_at: new Date().toISOString(),
          })
        } else {
          // Already granted — just bump the verification timestamp
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (service as any)
            .from('profiles')
            .update({ kimp_verified_at: new Date().toISOString() })
            .eq('id', profile.id)
        }
      } else if (status === 'inactive') {
        // 14-day grace: only revoke if kimp_verified_at is stale (or never set)
        const verifiedAt = profile.kimp_verified_at ? new Date(profile.kimp_verified_at).getTime() : 0
        const stale = Date.now() - verifiedAt > GRACE_PERIOD_MS

        if (stale && profile.kimp_unlimited) {
          revoked++
          // Direct update — enforce_kimp_unlimited_proof only fires on false→true,
          // so this revocation bypasses it correctly (intended).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (service as any)
            .from('profiles')
            .update({
              kimp_unlimited: false,
              kimp_client_status: 'inactive',
              kimp_verified_at: new Date().toISOString(),
            })
            .eq('id', profile.id)

          await logAdminAction({
            adminId,
            action: 'kimp_revoke_churn',
            targetTable: 'profiles',
            targetId: profile.id,
            after: {
              sub_prefix: profile.kimp_subject_id.slice(0, 8) + '…',
              reason: 'churn_inactive_stale',
            },
          })
        }
      }
    }
  }

  // ── Phase B: allowlist-only users (no kimp_subject_id) ───────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: allowlistRows } = await (service as any)
    .from('kimp_client_allowlist')
    .select('email, is_active')

  const allowlistEntries = (allowlistRows ?? []) as Array<{ email: string; is_active: boolean }>

  for (const entry of allowlistEntries) {
    if (entry.is_active) continue

    // Allowlist entry deactivated — revoke any profile that matched on email
    // and has no kimp_subject_id (pure allowlist grant)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: matchedRows } = await (service as any)
      .from('profiles')
      .select('id, kimp_unlimited')
      .eq('email', entry.email)
      .is('kimp_subject_id', null)
      .is('deleted_at', null)
      .limit(1)

    const matched = (matchedRows ?? []) as Array<{ id: string; kimp_unlimited: boolean }>
    for (const profile of matched) {
      if (!profile.kimp_unlimited) continue

      revoked++
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any)
        .from('profiles')
        .update({
          kimp_unlimited: false,
          kimp_client_status: 'inactive',
          kimp_verified_at: new Date().toISOString(),
        })
        .eq('id', profile.id)

      await logAdminAction({
        adminId,
        action: 'kimp_revoke_churn',
        targetTable: 'profiles',
        targetId: profile.id,
        after: {
          email_prefix: entry.email.split('@')[0] + '@…',
          reason: 'allowlist_deactivated',
        },
      })
    }
  }

  // Summary audit row
  await logAdminAction({
    adminId,
    action: 'kimp_reverify_complete',
    targetTable: 'profiles',
    targetId: null,
    after: {
      checked,
      active,
      revoked,
      errors,
      triggered_by: isCron ? 'cron' : 'admin',
    },
  })

  return NextResponse.json({ checked, active, revoked, errors })
}

// Vercel cron hits GET for some configurations — keep parity to avoid 405.
export async function GET(request: NextRequest): Promise<NextResponse> {
  return POST(request)
}
