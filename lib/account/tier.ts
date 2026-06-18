/**
 * Account tier helper for UI gating.
 * KIMP clients see no paid UI (plans/packs/credit counters).
 */

import { createClient } from '@/lib/supabase/server'

export type AccountTier = 'kimp' | 'standard' | 'free'

export async function getAccountTier(userId: string): Promise<AccountTier> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('kimp_unlimited, purchased_credits, monthly_credits')
    .eq('id', userId)
    .maybeSingle()

  if (!data) return 'free'
  if (data.kimp_unlimited) return 'kimp'
  if ((data.purchased_credits ?? 0) > 0 || (data.monthly_credits ?? 0) > 0) return 'standard'
  return 'free'
}
