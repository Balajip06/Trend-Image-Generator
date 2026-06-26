/**
 * Trigger.dev scheduled task — KIMP360 nightly churn re-verify.
 * Runs daily at 03:30 UTC. Replaces the Vercel Cron entry.
 *
 * The core logic is identical to app/api/admin/kimp-reverify/route.ts
 * (which is kept for manual admin-triggered runs via the admin panel).
 *
 * Trigger.dev handles: scheduling, retries, observability, run history.
 * No CRON_SECRET needed — authentication is handled by Trigger.dev internally.
 */

import { schedules } from '@trigger.dev/sdk/v3'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

const GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000
const CHUNK_SIZE = 200

// Create a service-role Supabase client (no Next.js request context in Trigger.dev)
function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars missing')
  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false },
  })
}

type KimpStatusResult = { sub: string; status: 'active' | 'inactive'; checked_at: string }

async function checkKimpStatus(subjects: string[]): Promise<KimpStatusResult[]> {
  const apiUrl = process.env.KIMP360_STATUS_API_URL
  const apiKey = process.env.KIMP360_STATUS_API_KEY
  if (!apiUrl || !apiKey) throw new Error('KIMP360_STATUS_API_URL / KEY not configured')
  if (subjects.length === 0) return []

  const { createHmac } = await import('node:crypto')
  const timestamp = Date.now().toString()
  const body = JSON.stringify({ subjects })
  const signature = createHmac('sha256', apiKey)
    .update(timestamp + body)
    .digest('hex')

  const res = await fetch(`${apiUrl}/clients/status`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-timestamp': timestamp,
      'x-signature': signature,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`KIMP360 status API ${res.status}`)

  const json = (await res.json()) as { results: KimpStatusResult[] }
  const requestedSet = new Set(subjects)
  return (json.results ?? []).filter((r) => requestedSet.has(r.sub))
}

async function writeAuditLog(
  service: ReturnType<typeof createServiceClient>,
  action: string,
  targetId: string | null,
  after: Record<string, unknown>
) {
  await service.from('admin_audit_log').insert({
    admin_id: null,
    action,
    target_table: 'profiles',
    target_id: targetId,
    after: after as import('@/lib/supabase/database.types').Json,
  })
}

export const kimpReverifyTask = schedules.task({
  id: 'kimp-reverify',
  // Runs at 03:30 UTC daily
  cron: '30 3 * * *',
  maxDuration: 3600,
  run: async () => {
    const service = createServiceClient()

    // Idempotency: one run per calendar day
    const eventId = `reverify:${new Date().toISOString().slice(0, 10)}`
    const { error: dupError } = await service
      .from('webhook_events')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({ source: 'kimp360', event_id: eventId, payload: {} as any })

    if (dupError?.code === '23505') {
      console.log('Already ran today — skipping')
      return { skipped: true, reason: 'already_run_today' }
    }

    // ── Phase A: re-verify profiles with a linked kimp_subject_id ─────────
    const { data: linkedRows } = await service
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

    let checked = 0,
      active = 0,
      revoked = 0

    for (let i = 0; i < linkedProfiles.length; i += CHUNK_SIZE) {
      const chunk = linkedProfiles.slice(i, i + CHUNK_SIZE)
      const subjects = chunk.map((p) => p.kimp_subject_id).filter(Boolean)

      let results: KimpStatusResult[]
      try {
        results = await checkKimpStatus(subjects)
      } catch (err) {
        // Fail-safe: API down → abort, NEVER mass-revoke
        const errorMsg = err instanceof Error ? err.message : 'unknown'
        console.error('KIMP360 status API unavailable:', errorMsg)
        await writeAuditLog(service, 'kimp_reverify_failed', null, {
          error: errorMsg,
          checked_so_far: checked,
        })
        throw new Error(`KIMP360 status API unavailable: ${errorMsg}`)
      }

      const resultMap = new Map(results.map((r) => [r.sub, r.status]))
      checked += chunk.length

      for (const profile of chunk) {
        const status = resultMap.get(profile.kimp_subject_id)
        if (!status) continue

        if (status === 'active') {
          active++
          if (!profile.kimp_unlimited) {
            await service.rpc('grant_kimp_unlimited', {
              p_user_id: profile.id,
              p_subject: profile.kimp_subject_id,
              p_client_id: (profile.kimp_client_id ?? null) as string,
              p_verified_at: new Date().toISOString(),
            })
          } else {
            await service
              .from('profiles')
              .update({ kimp_verified_at: new Date().toISOString() })
              .eq('id', profile.id)
          }
        } else if (status === 'inactive') {
          const verifiedAt = profile.kimp_verified_at
            ? new Date(profile.kimp_verified_at).getTime()
            : 0
          const stale = Date.now() - verifiedAt > GRACE_PERIOD_MS

          if (stale && profile.kimp_unlimited) {
            revoked++
            await service
              .from('profiles')
              .update({
                kimp_unlimited: false,
                kimp_client_status: 'inactive',
                kimp_verified_at: new Date().toISOString(),
              })
              .eq('id', profile.id)

            await writeAuditLog(service, 'kimp_revoke_churn', profile.id, {
              sub_prefix: profile.kimp_subject_id.slice(0, 8) + '…',
              reason: 'churn_inactive_stale',
            })
            console.log(`Revoked unlimited for profile ${profile.id} (churn)`)
          }
        }
      }
    }

    // ── Phase B: allowlist-only users ─────────────────────────────────────
    const { data: allowlistRows } = await service
      .from('kimp_client_allowlist')
      .select('email, is_active')

    for (const entry of (allowlistRows ?? []) as Array<{ email: string; is_active: boolean }>) {
      if (entry.is_active) continue

      const { data: matchedRows } = await service
        .from('profiles')
        .select('id, kimp_unlimited')
        .eq('email', entry.email)
        .is('kimp_subject_id', null)
        .is('deleted_at', null)
        .limit(1)

      for (const profile of (matchedRows ?? []) as Array<{ id: string; kimp_unlimited: boolean }>) {
        if (!profile.kimp_unlimited) continue
        revoked++
        await service
          .from('profiles')
          .update({
            kimp_unlimited: false,
            kimp_client_status: 'inactive',
            kimp_verified_at: new Date().toISOString(),
          })
          .eq('id', profile.id)

        await writeAuditLog(service, 'kimp_revoke_churn', profile.id, {
          email_prefix: entry.email.split('@')[0] + '@…',
          reason: 'allowlist_deactivated',
        })
      }
    }

    // Summary
    await writeAuditLog(service, 'kimp_reverify_complete', null, {
      checked,
      active,
      revoked,
      triggered_by: 'trigger.dev',
    })

    console.log(`Done: checked=${checked} active=${active} revoked=${revoked}`)
    return { checked, active, revoked }
  },
})
