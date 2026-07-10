import { describe, expect, it } from 'vitest'
import { mockProposer, slugify } from './proposer'

describe('slugify', () => {
  it('lowercases + replaces spaces with hyphens', () => {
    expect(slugify('Ghibli Style Portrait')).toBe('ghibli-style-portrait')
  })

  it('drops non-alphanumerics', () => {
    expect(slugify('Studio Ghibli! (2026)')).toBe('studio-ghibli-2026')
  })

  it('collapses repeated hyphens', () => {
    expect(slugify('a    b    c')).toBe('a-b-c')
  })

  it('trims leading/trailing hyphens', () => {
    expect(slugify('  Ghibli  ')).toBe('ghibli')
  })

  it('falls back to trend-<ts> when input has no usable chars', () => {
    expect(slugify('!!!')).toMatch(/^trend-\d+$/)
  })

  it('caps slug length at 80', () => {
    const long = 'a'.repeat(150)
    expect(slugify(long).length).toBeLessThanOrEqual(80)
  })
})

describe('mockProposer', () => {
  it('produces a valid Proposal shape', async () => {
    const p = await mockProposer.propose({
      source: 'reddit',
      external_id: 'r:1',
      title: 'Pixar-style toy',
      description: 'A trend of turning selfies into toy box shots',
      exemplar_urls: [],
      momentum_score: 1,
      source_url: 'https://example.com',
      observed_at: '2026-05-28T00:00:00.000Z',
    })
    expect(p.suggested_slug).toBe('pixar-style-toy')
    expect(p.suggested_title).toBe('Pixar-style toy')
    expect(p.prompt_template.length).toBeGreaterThan(10)
    expect(p.model).toBe('nano-banana-2-lite')
    expect(p.input_schema.fields).toHaveLength(1)
    expect(p.input_schema.fields[0].name).toBe('user_photo')
    expect(p.confidence).toBeGreaterThanOrEqual(0)
    expect(p.confidence).toBeLessThanOrEqual(1)
  })
})
