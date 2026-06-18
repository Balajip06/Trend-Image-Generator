/**
 * Account tier helper for UI gating.
 * KIMP clients see no paid UI (plans/packs/credit counters).
 */

import { createClient } from '@/lib/supabase/server'

export type AccountTier = 'kimp' | 'standard' | 'free'

// Columns added by migration 20260603000001_profiles_kimp_columns.sql.
// Types will reflect them after pnpm supabase:types runs against the live DB.
interface ProfileTierRow {
  kimp_unlimited: boolean
  purchased_credits: number
  monthly_credits: number
}

export async function getAccountTier(userId: string): Promise<AccountTier> {
  const supabase = await createClient()
  // Cast required until generated types are regenerated post-migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('profiles')
    .select('kimp_unlimited, purchased_credits, monthly_credits')
    .eq('id', userId)
    .maybeSingle() as { data: ProfileTierRow | null; error: unknown }

  if (!data) return 'free'
  if (data.kimp_unlimited) return 'kimp'
  if ((data.purchased_credits ?? 0) > 0 || (data.monthly_credits ?? 0) > 0) return 'standard'
  return 'free'
}
