/**
 * Zod schema for the `trend_suggestions.payload` JSONB column.
 *
 * Two source flavours share the column:
 *   - source='auto'  → AutoSuggestionPayload (filled by orchestrator + LLM proposer)
 *   - source='user'  → UserSuggestionPayload (filled by community submission form)
 *
 * Admin inbox UI reads `payload.type` to render the right detail view.
 */

import { z } from 'zod'
import { TrendInputSchema } from '../input-schema'

const SourceIdSchema = z.enum(['tiktok', 'instagram', 'reddit'])

const TrendCandidateSchema = z.object({
  source: SourceIdSchema,
  external_id: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  exemplar_urls: z.array(z.string().url()).max(8).default([]),
  momentum_score: z.number(),
  source_url: z.string().url(),
  observed_at: z.string().datetime(),
})

const AutoSuggestionPayloadSchema = z.object({
  type: z.literal('auto'),
  candidate: TrendCandidateSchema,
  proposal: z.object({
    suggested_slug: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z][a-z0-9-]*$/, 'lowercase kebab-case starting with a letter'),
    suggested_title: z.string().min(1).max(200),
    suggested_description: z.string().min(1).max(1000),
    prompt_template: z.string().min(10).max(2000),
    model: z.enum(['nano-banana', 'nano-banana-pro']),
    input_schema: TrendInputSchema,
    proposer_model: z.string().min(1), // e.g. 'gemini-2.5-flash'
    confidence: z.number().min(0).max(1),
  }),
})

const UserSuggestionPayloadSchema = z.object({
  type: z.literal('user'),
  submitted_by: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  example_urls: z.array(z.string().url()).min(1).max(5),
})

export const TrendSuggestionPayloadSchema = z.discriminatedUnion('type', [
  AutoSuggestionPayloadSchema,
  UserSuggestionPayloadSchema,
])

export type TrendCandidatePayload = z.infer<typeof TrendCandidateSchema>
export type AutoSuggestionPayload = z.infer<typeof AutoSuggestionPayloadSchema>
export type UserSuggestionPayload = z.infer<typeof UserSuggestionPayloadSchema>
export type TrendSuggestionPayload = z.infer<typeof TrendSuggestionPayloadSchema>
