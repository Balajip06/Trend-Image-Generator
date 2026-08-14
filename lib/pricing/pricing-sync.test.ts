/**
 * Fails CI when the Edge Function's pricing table drifts from the source.
 *
 * The per-image cost table has to exist in two runtimes: `lib/pricing/models.ts`
 * (Node — margins, admin UI, pre-flight checks) and a Deno copy inside the Edge
 * Function, which cannot import from `lib/`. Those two were previously
 * hand-synced behind "keep in sync" comments, and only the Deno copy is on the
 * customer path — so drift silently meant reported margins and any cost ceiling
 * disagreed with what was actually charged.
 *
 * The Deno copy is generated (`pnpm sync:pricing`). This test is what makes
 * that generation mandatory rather than optional.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COST_USD_PER_IMAGE } from './models'

const GENERATED = join(
  process.cwd(),
  'supabase/functions/generate-image/pricing.generated.ts'
)

/** Parse the generated Deno table without importing it (it targets Deno). */
function parseGenerated(): Record<string, number> {
  const src = readFileSync(GENERATED, 'utf8')
  const block = src.match(/COST_USD: Record<EdgePricedModel, number> = \{([\s\S]*?)\n\}/)
  if (!block) throw new Error('COST_USD table not found — run `pnpm sync:pricing`')

  const out: Record<string, number> = {}
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*'([^']+)':\s*([0-9.]+)\s*,/)
    if (m) out[m[1]] = Number(m[2])
  }
  return out
}

describe('pricing table sync', () => {
  it('the Edge copy matches lib/pricing/models.ts exactly', () => {
    // If this fails, run `pnpm sync:pricing` and commit the generated file.
    expect(parseGenerated()).toEqual(COST_USD_PER_IMAGE)
  })

  it('covers every model the app can dispatch', async () => {
    const { IMAGE_MODELS } = await import('@/lib/image-provider/types')
    for (const model of IMAGE_MODELS) {
      expect(COST_USD_PER_IMAGE[model]).toBeGreaterThan(0)
    }
  })

  it('the generated file is marked do-not-edit', () => {
    expect(readFileSync(GENERATED, 'utf8')).toContain('DO NOT EDIT')
  })
})
