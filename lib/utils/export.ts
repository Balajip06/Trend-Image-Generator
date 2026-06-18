/**
 * GDPR Article 15 right-of-access export helpers.
 *
 * Pure, side-effect-free builders so the API route stays thin and the shape
 * stays unit-testable. The route fetches rows + signs URLs, then hands them
 * here to assemble the user-facing JSON payload.
 */

export interface ExportProfile {
  email: string
  credits_balance: number | null
  free_used_this_week: number
  bonus_credits_earned: number
  referral_code: string
  created_at?: string
  deleted_at?: string | null
  name?: string | null
  avatar_url?: string | null
}

export interface ExportGenerationInput {
  id: string
  trend_id: string
  status: string
  output_image_url: string | null
  error_message: string | null
  attempts: number
  idempotency_key: string
  created_at: string
  completed_at: string | null
  cost_usd: number
  purge_at?: string | null
  model_used?: string | null
  /**
   * Short-TTL signed download URL produced by the route. Null if the
   * generation isn't completed or signing failed (route still records the row).
   */
  signed_download_url: string | null
}

export interface ExportPayload {
  schema_version: 1
  generated_at: string
  user_id: string
  signed_url_ttl_seconds: number
  profile: ExportProfile
  generations: ExportGenerationInput[]
  totals: {
    generations_total: number
    generations_completed: number
    total_cost_usd: number
  }
  notes: {
    article: 'GDPR Article 15'
    contact: string
    signed_url_expiry: string
  }
}

const SIGNED_URL_TTL_SECONDS = 3600

export function buildExportPayload(
  userId: string,
  profile: ExportProfile,
  generations: ExportGenerationInput[],
  generatedAt: Date = new Date()
): ExportPayload {
  const completed = generations.filter((g) => g.status === 'completed').length
  const totalCost = generations.reduce((sum, g) => sum + (g.cost_usd ?? 0), 0)

  return {
    schema_version: 1,
    generated_at: generatedAt.toISOString(),
    user_id: userId,
    signed_url_ttl_seconds: SIGNED_URL_TTL_SECONDS,
    profile,
    generations,
    totals: {
      generations_total: generations.length,
      generations_completed: completed,
      total_cost_usd: Number(totalCost.toFixed(6)),
    },
    notes: {
      article: 'GDPR Article 15',
      contact: 'privacy@trendly.app',
      signed_url_expiry: 'Download URLs expire 1 hour after this export was generated.',
    },
  }
}

export function buildExportFilename(userId: string, isoDate: string): string {
  const datePart = isoDate.slice(0, 10) // YYYY-MM-DD
  const prefix = userId.slice(0, 8) || 'anon'
  return `trend-image-export-${prefix}-${datePart}.json`
}

export const EXPORT_SIGNED_URL_TTL_SECONDS = SIGNED_URL_TTL_SECONDS
