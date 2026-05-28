import { describe, expect, it } from 'vitest'
import {
  buildExportFilename,
  buildExportPayload,
  EXPORT_SIGNED_URL_TTL_SECONDS,
  type ExportGenerationInput,
  type ExportProfile,
} from './export'

const FIXED_DATE = new Date('2026-05-28T12:00:00.000Z')

const baseProfile: ExportProfile = {
  email: 'user@example.com',
  credits_balance: 42,
  free_used_this_week: 2,
  bonus_credits_earned: 10,
  referral_code: 'a1b2c3d4',
  created_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
  name: null,
  avatar_url: null,
}

const completedGen: ExportGenerationInput = {
  id: 'gen-1',
  trend_id: 'trend-1',
  status: 'completed',
  output_image_url: 'https://example.com/out.png',
  error_message: null,
  attempts: 1,
  idempotency_key: 'idem-1',
  created_at: '2026-05-01T00:00:00.000Z',
  completed_at: '2026-05-01T00:00:30.000Z',
  cost_usd: 0.024,
  purge_at: null,
  model_used: 'gemini-2.5-flash-image',
  signed_download_url: 'https://example.com/signed?token=abc',
}

const pendingGen: ExportGenerationInput = {
  id: 'gen-2',
  trend_id: 'trend-2',
  status: 'processing',
  output_image_url: null,
  error_message: null,
  attempts: 0,
  idempotency_key: 'idem-2',
  created_at: '2026-05-02T00:00:00.000Z',
  completed_at: null,
  cost_usd: 0,
  purge_at: null,
  model_used: null,
  signed_download_url: null,
}

describe('buildExportPayload', () => {
  it('includes all expected top-level keys for GDPR Article 15', () => {
    const payload = buildExportPayload('user-uuid-1234', baseProfile, [completedGen], FIXED_DATE)
    expect(Object.keys(payload).sort()).toEqual(
      [
        'generated_at',
        'generations',
        'notes',
        'profile',
        'schema_version',
        'signed_url_ttl_seconds',
        'totals',
        'user_id',
      ].sort()
    )
    expect(payload.schema_version).toBe(1)
    expect(payload.generated_at).toBe('2026-05-28T12:00:00.000Z')
    expect(payload.user_id).toBe('user-uuid-1234')
    expect(payload.signed_url_ttl_seconds).toBe(EXPORT_SIGNED_URL_TTL_SECONDS)
    expect(payload.notes.article).toBe('GDPR Article 15')
  })

  it('computes totals correctly across mixed statuses', () => {
    const payload = buildExportPayload(
      'user-uuid-1234',
      baseProfile,
      [completedGen, pendingGen],
      FIXED_DATE
    )
    expect(payload.totals).toEqual({
      generations_total: 2,
      generations_completed: 1,
      total_cost_usd: 0.024,
    })
  })

  it('handles empty generations list', () => {
    const payload = buildExportPayload('user-uuid-1234', baseProfile, [], FIXED_DATE)
    expect(payload.generations).toEqual([])
    expect(payload.totals).toEqual({
      generations_total: 0,
      generations_completed: 0,
      total_cost_usd: 0,
    })
  })

  it('handles null fields gracefully (deleted_at, name, avatar_url, output_image_url, completed_at)', () => {
    const sparseProfile: ExportProfile = {
      ...baseProfile,
      name: null,
      avatar_url: null,
      deleted_at: null,
    }
    const payload = buildExportPayload(
      'user-uuid-1234',
      sparseProfile,
      [pendingGen],
      FIXED_DATE
    )
    expect(payload.profile.name).toBeNull()
    expect(payload.profile.avatar_url).toBeNull()
    expect(payload.profile.deleted_at).toBeNull()
    expect(payload.generations[0].output_image_url).toBeNull()
    expect(payload.generations[0].completed_at).toBeNull()
    expect(payload.generations[0].signed_download_url).toBeNull()
  })

  it('rounds total_cost_usd to 6 decimals for float-safety', () => {
    const a = { ...completedGen, id: 'a', cost_usd: 0.0123456789 }
    const b = { ...completedGen, id: 'b', cost_usd: 0.0123456789 }
    const payload = buildExportPayload('u', baseProfile, [a, b], FIXED_DATE)
    expect(payload.totals.total_cost_usd).toBe(0.024691)
  })
})

describe('buildExportFilename', () => {
  it('formats as trend-image-export-<prefix>-<YYYY-MM-DD>.json', () => {
    expect(
      buildExportFilename('abcdef12-3456-7890-abcd-ef1234567890', '2026-05-28T12:00:00.000Z')
    ).toBe('trend-image-export-abcdef12-2026-05-28.json')
  })

  it('uses short user ids verbatim when shorter than 8 chars', () => {
    expect(buildExportFilename('demo', '2026-01-15T00:00:00.000Z')).toBe(
      'trend-image-export-demo-2026-01-15.json'
    )
  })

  it('falls back to "anon" when user id is empty', () => {
    expect(buildExportFilename('', '2026-01-15T00:00:00.000Z')).toBe(
      'trend-image-export-anon-2026-01-15.json'
    )
  })
})
