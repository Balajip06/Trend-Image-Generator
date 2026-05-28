/**
 * Trend-detector orchestrator.
 *
 * Runs all configured sources in parallel, dedupes against existing
 * `trend_suggestions.payload.candidate.external_id`, calls the LLM
 * proposer for each new candidate, and inserts an admin-pending row.
 *
 * Invoked by:
 *   - Supabase pg_cron daily job (post-MVP, when Phase 6 lights up)
 *   - Manual admin "Scan for trends" button
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { instagramSource } from './sources/instagram'
import { redditSource } from './sources/reddit'
import { tiktokSource } from './sources/tiktok'
import type { SourceFetcher, TrendCandidate } from './sources/types'
import { getProposer, type Proposer } from './proposer'
import type { AutoSuggestionPayload } from './suggestions/payload'

const DEFAULT_SOURCES: ReadonlyArray<SourceFetcher> = [redditSource, tiktokSource, instagramSource]

export interface OrchestratorOptions {
  /** Override the default source list — used by tests. */
  sources?: ReadonlyArray<SourceFetcher>
  /** Override the default proposer — used by tests. */
  proposer?: Proposer
  /** Per-source momentum cutoff. */
  minMomentum?: number
  /** Per-source max candidates. */
  limitPerSource?: number
}

export interface OrchestratorResult {
  fetched: number
  deduped: number
  proposed: number
  inserted: number
  errors: string[]
}

export async function runTrendDetector(
  supabase: SupabaseClient,
  options: OrchestratorOptions = {}
): Promise<OrchestratorResult> {
  const sources = options.sources ?? DEFAULT_SOURCES
  const proposer = options.proposer ?? getProposer()
  const minMomentum = options.minMomentum ?? 0
  const limitPerSource = options.limitPerSource ?? 25

  const errors: string[] = []

  const fetchOutcomes = await Promise.all(
    sources.map(async (s) => {
      try {
        return await s.fetchTrending({ limit: limitPerSource, minMomentum })
      } catch (err: unknown) {
        errors.push(`${s.id}: ${err instanceof Error ? err.message : 'unknown'}`)
        return []
      }
    })
  )

  const candidates: TrendCandidate[] = fetchOutcomes.flat()
  const fetched = candidates.length

  // Dedupe vs existing trend_suggestions rows. Service-role client required.
  const externalIds = candidates.map((c) => `${c.source}:${c.external_id}`)
  const existingIds = new Set<string>()
  if (externalIds.length > 0) {
    const { data } = await supabase
      .from('trend_suggestions')
      .select('payload')
      .eq('status', 'pending')
    if (Array.isArray(data)) {
      for (const row of data as { payload: unknown }[]) {
        const payload = row.payload as { candidate?: { source?: string; external_id?: string } } | null
        if (payload?.candidate?.source && payload.candidate.external_id) {
          existingIds.add(`${payload.candidate.source}:${payload.candidate.external_id}`)
        }
      }
    }
  }

  const fresh = candidates.filter((c) => !existingIds.has(`${c.source}:${c.external_id}`))
  const deduped = candidates.length - fresh.length

  let proposed = 0
  let inserted = 0

  for (const candidate of fresh) {
    try {
      const proposal = await proposer.propose(candidate)
      proposed += 1
      const payload: AutoSuggestionPayload = {
        type: 'auto',
        candidate,
        proposal,
      }
      const row = {
        source: 'auto',
        payload: payload as unknown as Record<string, unknown>,
        status: 'pending',
      } as never
      const { error } = await supabase.from('trend_suggestions').insert(row)
      if (error) {
        errors.push(`insert ${candidate.source}:${candidate.external_id}: ${error.message}`)
        continue
      }
      inserted += 1
    } catch (err: unknown) {
      errors.push(
        `propose ${candidate.source}:${candidate.external_id}: ${err instanceof Error ? err.message : 'unknown'}`
      )
    }
  }

  return { fetched, deduped, proposed, inserted, errors }
}
