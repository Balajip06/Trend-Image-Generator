/**
 * Ordered entitlement resolver for KIMP360 unlimited tier.
 * H-S7 / H-S4: unlimited is set server-side only via grant_kimp_unlimited() RPC.
 * Fail-closed: any error path returns 'unverified'.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { checkKimpStatus } from './status-client'

export type KimpEntitlement = 'active' | 'inactive' | 'unverified'

interface ResolveArgs {
  userId: string
  email: string
  oidcSub?: string
  oidcStatus?: 'active' | 'inactive'
}

/**
 * Resolve whether a user is an active KIMP360 client.
 * Order: OIDC claim → status API → allowlist → unverified.
 * Never throws — returns 'unverified' on any error (fail-closed).
 */
export async function resolveKimpEntitlement({
  userId: _userId,
  email,
  oidcSub,
  oidcStatus,
}: ResolveArgs): Promise<KimpEntitlement> {
  try {
    // 1. OIDC claim present (from id_token)
    if (oidcSub && oidcStatus) {
      return oidcStatus
    }

    // 2. Status API (server-to-server, HMAC-signed)
    if (oidcSub && process.env.KIMP360_STATUS_API_URL) {
      const results = await checkKimpStatus([oidcSub])
      const match = results.find(r => r.sub === oidcSub)
      if (match) return match.status
    }

    // 3. Allowlist fallback (admin-managed, email-based).
    const service = createServiceClient()
    const { data } = await service
      .from('kimp_client_allowlist')
      .select('is_active')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .maybeSingle()

    if (data?.is_active) return 'active'

    return 'unverified'
  } catch {
    return 'unverified'
  }
}
