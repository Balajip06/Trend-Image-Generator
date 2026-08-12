/**
 * GDPR Article 15 right-of-access export helpers.
 *
 * Pure, side-effect-free builders so the API route stays thin and the shape
 * stays unit-testable. The route fetches rows + signs URLs, then hands them
 * here to assemble a single generations.csv.
 *
 * Scope note: profile fields (email, credits, referral code) are
 * intentionally NOT part of this export per explicit user request. See the
 * route's header comment for the compliance caveat.
 */

import { unparse } from 'papaparse'

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

const SIGNED_URL_TTL_SECONDS = 3600

export function buildExportFilename(userId: string, isoDate: string): string {
  const datePart = isoDate.slice(0, 10) // YYYY-MM-DD
  const prefix = userId.slice(0, 8) || 'anon'
  return `trend-image-export-${prefix}-${datePart}.csv`
}

const GENERATION_CSV_COLUMNS = [
  'id',
  'trend_id',
  'status',
  'created_at',
  'completed_at',
  'attempts',
  'cost_usd',
  'error_message',
  'purge_at',
  'model_used',
  'download_url',
] as const

/** Excel/Sheets treat a blank cell and the literal string differently than `null` — normalize. */
function csvCell(value: unknown): string | number {
  if (value === null || value === undefined) return ''
  return value as string | number
}

export function buildGenerationsCsv(generations: ExportGenerationInput[]): string {
  const rows = generations.map((g) => ({
    id: g.id,
    trend_id: g.trend_id,
    status: g.status,
    created_at: g.created_at,
    completed_at: csvCell(g.completed_at),
    attempts: g.attempts,
    cost_usd: g.cost_usd,
    error_message: csvCell(g.error_message),
    purge_at: csvCell(g.purge_at),
    model_used: csvCell(g.model_used),
    download_url: csvCell(g.signed_download_url),
  }))
  return unparse({ fields: GENERATION_CSV_COLUMNS as unknown as string[], data: rows })
}

export const EXPORT_SIGNED_URL_TTL_SECONDS = SIGNED_URL_TTL_SECONDS
