/**
 * LLM proposer — turns a TrendCandidate into a draft proposal
 * (slug + title + description + prompt_template + input_schema).
 *
 * Production wiring uses Gemini Flash (cheap) via `lib/gemini/client.ts`;
 * for Phase 6 prep we expose the interface + a deterministic mock that
 * lets the orchestrator + admin inbox be exercised without API calls.
 */

import { DEFAULT_TREND_INPUT, type TrendInput } from './input-schema'
import type { TrendCandidate } from './sources/types'

export interface Proposal {
  suggested_slug: string
  suggested_title: string
  suggested_description: string
  prompt_template: string
  model: 'nano-banana' | 'nano-banana-pro'
  input_schema: TrendInput
  proposer_model: string
  confidence: number
}

export interface Proposer {
  propose(candidate: TrendCandidate): Promise<Proposal>
}

/**
 * Deterministic mock — used when `GEMINI_API_KEY` missing OR in unit tests.
 * Produces a plausible-looking proposal so the admin-inbox + approval
 * flow can be tested end-to-end before the real proposer is wired.
 */
export const mockProposer: Proposer = {
  async propose(candidate: TrendCandidate): Promise<Proposal> {
    const slug = slugify(candidate.title)
    return {
      suggested_slug: slug,
      suggested_title: candidate.title.slice(0, 200),
      suggested_description: candidate.description.slice(0, 500) || candidate.title.slice(0, 500),
      prompt_template: `Apply the "${candidate.title}" trend visual style to the subject in the photo, preserving facial features`,
      model: 'nano-banana-pro',
      input_schema: DEFAULT_TREND_INPUT,
      proposer_model: 'mock',
      confidence: 0.5,
    }
  },
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || `trend-${Date.now()}`
  )
}

/**
 * Selects the live proposer. Wraps the Gemini-backed implementation when
 * the API key is present, otherwise falls back to the mock so the rest
 * of the pipeline can run.
 */
export function getProposer(): Proposer {
  if (!process.env.GEMINI_API_KEY) return mockProposer
  // TODO Phase 6 impl: call gemini-2.5-flash with a structured JSON
  // schema mirroring TrendInputSchema and parse the response. For now
  // keep behaviour identical to mock so the call path stays exercised.
  return mockProposer
}
