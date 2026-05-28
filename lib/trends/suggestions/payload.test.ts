import { describe, expect, it } from 'vitest'
import { TrendSuggestionPayloadSchema } from './payload'

const validCandidate = {
  source: 'reddit' as const,
  external_id: 'midjourney:abc123',
  title: 'Ghibli-portrait trend on Reddit',
  description: 'A wave of users posting Ghibli-style portraits.',
  exemplar_urls: ['https://example.com/img.jpg'],
  momentum_score: 124.7,
  source_url: 'https://www.reddit.com/r/midjourney/comments/abc123/foo/',
  observed_at: '2026-05-28T10:00:00.000Z',
}

const validAutoProposal = {
  suggested_slug: 'ghibli-portrait',
  suggested_title: 'Ghibli-style portrait',
  suggested_description: 'Turn your selfie into a Ghibli still.',
  prompt_template: 'A Ghibli-style portrait of the subject in the photo',
  model: 'nano-banana-pro' as const,
  input_schema: {
    fields: [
      {
        type: 'image' as const,
        name: 'user_photo',
        label: 'Your photo',
        required: true,
        min_count: 1,
        max_count: 1,
      },
    ],
  },
  proposer_model: 'gemini-2.5-flash',
  confidence: 0.82,
}

describe('TrendSuggestionPayloadSchema — auto', () => {
  it('parses a well-formed auto suggestion', () => {
    const parsed = TrendSuggestionPayloadSchema.parse({
      type: 'auto',
      candidate: validCandidate,
      proposal: validAutoProposal,
    })
    expect(parsed.type).toBe('auto')
  })

  it('rejects slug not in kebab-case', () => {
    expect(() =>
      TrendSuggestionPayloadSchema.parse({
        type: 'auto',
        candidate: validCandidate,
        proposal: { ...validAutoProposal, suggested_slug: 'Bad_Slug' },
      })
    ).toThrow()
  })

  it('rejects confidence outside [0,1]', () => {
    expect(() =>
      TrendSuggestionPayloadSchema.parse({
        type: 'auto',
        candidate: validCandidate,
        proposal: { ...validAutoProposal, confidence: 1.5 },
      })
    ).toThrow()
  })

  it('rejects prompt_template shorter than 10 chars', () => {
    expect(() =>
      TrendSuggestionPayloadSchema.parse({
        type: 'auto',
        candidate: validCandidate,
        proposal: { ...validAutoProposal, prompt_template: 'short' },
      })
    ).toThrow()
  })

  it('rejects unknown model id', () => {
    expect(() =>
      TrendSuggestionPayloadSchema.parse({
        type: 'auto',
        candidate: validCandidate,
        proposal: { ...validAutoProposal, model: 'gpt-4' },
      })
    ).toThrow()
  })
})

describe('TrendSuggestionPayloadSchema — user', () => {
  it('parses a well-formed user submission', () => {
    const parsed = TrendSuggestionPayloadSchema.parse({
      type: 'user',
      submitted_by: '00000000-0000-4000-8000-000000000001',
      title: 'Stranger Things poster',
      description: 'Turn your photo into a Stranger Things style poster',
      example_urls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    })
    expect(parsed.type).toBe('user')
  })

  it('rejects user submission without example URLs', () => {
    expect(() =>
      TrendSuggestionPayloadSchema.parse({
        type: 'user',
        submitted_by: '00000000-0000-4000-8000-000000000001',
        title: 'x',
        description: 'y',
        example_urls: [],
      })
    ).toThrow()
  })

  it('rejects unknown discriminator value', () => {
    expect(() =>
      TrendSuggestionPayloadSchema.parse({
        type: 'wat',
        candidate: validCandidate,
        proposal: validAutoProposal,
      })
    ).toThrow()
  })
})
