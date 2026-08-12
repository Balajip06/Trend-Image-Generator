import { describe, expect, it } from 'vitest'
import { buildExportFilename, buildGenerationsCsv, type ExportGenerationInput } from './export'

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

describe('buildExportFilename', () => {
  it('formats as trend-image-export-<prefix>-<YYYY-MM-DD>.csv', () => {
    expect(
      buildExportFilename('abcdef12-3456-7890-abcd-ef1234567890', '2026-05-28T12:00:00.000Z')
    ).toBe('trend-image-export-abcdef12-2026-05-28.csv')
  })

  it('uses short user ids verbatim when shorter than 8 chars', () => {
    expect(buildExportFilename('demo', '2026-01-15T00:00:00.000Z')).toBe(
      'trend-image-export-demo-2026-01-15.csv'
    )
  })

  it('falls back to "anon" when user id is empty', () => {
    expect(buildExportFilename('', '2026-01-15T00:00:00.000Z')).toBe(
      'trend-image-export-anon-2026-01-15.csv'
    )
  })
})

describe('buildGenerationsCsv', () => {
  it('produces a header row + one row per generation', () => {
    const csv = buildGenerationsCsv([completedGen, pendingGen])
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(
      'id,trend_id,status,created_at,completed_at,attempts,cost_usd,error_message,purge_at,model_used,download_url'
    )
  })

  it('handles an empty generations list (header only)', () => {
    const csv = buildGenerationsCsv([])
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(1)
  })

  it('renders null fields as empty cells, not the string "null"', () => {
    const csv = buildGenerationsCsv([pendingGen])
    expect(csv).not.toContain('null')
  })

  it('escapes commas and quotes in error_message so columns never shift', () => {
    const withComma: ExportGenerationInput = {
      ...completedGen,
      id: 'gen-comma',
      status: 'failed',
      error_message: 'Model timed out, retrying "safely"',
    }
    const csv = buildGenerationsCsv([withComma])
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(2)
    // papaparse quotes the field and doubles internal quotes — the raw text
    // must not appear unescaped (which would break column alignment).
    expect(lines[1]).toContain('"Model timed out, retrying ""safely"""')
  })

  it('renders the signed download URL under download_url', () => {
    const csv = buildGenerationsCsv([completedGen])
    expect(csv).toContain('https://example.com/signed?token=abc')
  })
})
