/**
 * Per-model cost ceilings (Node side).
 *
 * Mirrors the gate inlined in the generate-image Edge Function. Two copies
 * exist because Deno cannot import from `lib/` — the Edge one is authoritative
 * for customer generations (it is the last step before the provider call);
 * this one covers the Node spend paths: admin eval, and the pre-flight check in
 * `/api/generate` that turns a silent two-minute wait into an immediate error.
 *
 * Both read the same `app_settings.model_cost_limits` row and the same
 * `model_spend_usd` RPC, so they cannot disagree about the numbers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImageModel } from '@/lib/image-provider/types'

export interface ModelCostLimit {
  /** null/absent means "no daily limit". */
  daily_usd?: number | null
  monthly_usd?: number | null
  /** false hard-disables the model regardless of spend. */
  enabled?: boolean
}

export type ModelCostLimits = Partial<Record<ImageModel, ModelCostLimit>>

export type CostLimitVerdict = { allowed: true } | { allowed: false; reason: string }

export const MODEL_COST_LIMITS_KEY = 'model_cost_limits'

/** Read the configured ceilings. Returns {} when unset or unreadable. */
export async function readModelCostLimits(supabase: SupabaseClient): Promise<ModelCostLimits> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', MODEL_COST_LIMITS_KEY)
    .maybeSingle()
  if (error || !data?.value) return {}
  return data.value as ModelCostLimits
}

/** Daily + month-to-date spend for one model, via the single authoritative RPC. */
export async function readModelSpend(
  supabase: SupabaseClient,
  model: ImageModel
): Promise<{ daily: number; monthly: number }> {
  const { data, error } = await supabase.rpc('model_spend_usd', { p_model: model })
  if (error) return { daily: 0, monthly: 0 }
  const row = Array.isArray(data) ? data[0] : data
  return {
    daily: Number((row as { daily_usd?: number })?.daily_usd ?? 0),
    monthly: Number((row as { monthly_usd?: number })?.monthly_usd ?? 0),
  }
}

/**
 * Is this model within budget?
 *
 * FAILS OPEN when limits are missing or unreadable — a config outage must not
 * halt generation for every customer. Fails CLOSED only on an explicit
 * `enabled: false` or a breached numeric cap.
 */
export async function checkModelCostLimit(
  supabase: SupabaseClient,
  model: ImageModel
): Promise<CostLimitVerdict> {
  try {
    const limits = await readModelCostLimits(supabase)
    const limit = limits[model]
    if (!limit) return { allowed: true }

    if (limit.enabled === false) {
      return { allowed: false, reason: `${model} is disabled` }
    }

    const { daily, monthly } = await readModelSpend(supabase, model)

    if (limit.daily_usd != null && daily >= limit.daily_usd) {
      return {
        allowed: false,
        reason: `${model} daily cap reached ($${daily.toFixed(4)} of $${limit.daily_usd})`,
      }
    }
    if (limit.monthly_usd != null && monthly >= limit.monthly_usd) {
      return {
        allowed: false,
        reason: `${model} monthly cap reached ($${monthly.toFixed(2)} of $${limit.monthly_usd})`,
      }
    }
    return { allowed: true }
  } catch {
    return { allowed: true }
  }
}
