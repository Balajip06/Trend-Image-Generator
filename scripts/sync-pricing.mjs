#!/usr/bin/env node
/**
 * Generate the Edge Function's pricing table from `lib/pricing/models.ts`.
 *
 * The Deno runtime cannot import from `lib/`, so the Edge Function needs its
 * own copy of the per-image costs. That copy used to be maintained by hand
 * behind "keep in sync" comments in both files — and only the Deno one is on
 * the customer path, so any drift silently made margins and cost limits
 * disagree with what was actually charged.
 *
 * Run: `pnpm sync:pricing`
 * Verified by: `lib/pricing/pricing-sync.test.ts` (fails CI on drift).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(root, 'lib/pricing/models.ts')
const TARGET = join(root, 'supabase/functions/generate-image/pricing.generated.ts')

/** Pull the COST_USD_PER_IMAGE literal out of the source module. */
export function parseCostTable(source) {
  const block = source.match(/COST_USD_PER_IMAGE:\s*Record<ImageModel,\s*number>\s*=\s*\{([\s\S]*?)\n\}/)
  if (!block) throw new Error('COST_USD_PER_IMAGE literal not found in lib/pricing/models.ts')

  const entries = {}
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*'([^']+)':\s*([0-9.]+)\s*,/)
    if (m) entries[m[1]] = Number(m[2])
  }
  if (Object.keys(entries).length === 0) throw new Error('no cost entries parsed')
  return entries
}

function render(entries) {
  const rows = Object.entries(entries)
    .map(([model, cost]) => `  '${model}': ${cost},`)
    .join('\n')

  return `// GENERATED FILE — DO NOT EDIT.
// Source: lib/pricing/models.ts
// Regenerate: pnpm sync:pricing
//
// The Deno runtime cannot import from lib/, so the Edge Function carries its
// own copy of the pricing table. lib/pricing/pricing-sync.test.ts fails CI if
// this file drifts from the source.

export type EdgePricedModel = ${Object.keys(entries)
    .map((m) => `'${m}'`)
    .join(' | ')}

export const COST_USD: Record<EdgePricedModel, number> = {
${rows}
}
`
}

const entries = parseCostTable(readFileSync(SOURCE, 'utf8'))
writeFileSync(TARGET, render(entries))
console.log(`sync:pricing → wrote ${Object.keys(entries).length} models to ${TARGET}`)
