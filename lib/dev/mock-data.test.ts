import { describe, expect, it } from 'vitest'
import {
  MOCK_GENERATIONS,
  MOCK_TRENDS,
  findMockGeneration,
  findMockTrendById,
  type MockGenerationStatus,
} from './mock-data'
import { TrendInputSchema } from '@/lib/trends/input-schema'

const EXPECTED_SLUGS = [
  'ghibli-portrait',
  'pixar-3d-character',
  'anime-portrait',
  'vintage-polaroid',
  'marble-statue',
  'stranger-things-poster',
  'action-figure-box',
  'funko-pop-figure',
  'lego-minifigure',
  'wes-anderson-pastel',
  'renaissance-oil-painting',
  'south-park-cartoon',
  'cyberpunk-neon',
  'y2k-digicam-flash',
  'linkedin-headshot',
  'claymation-selfie',
  'barbie-box',
  'vintage-magazine-cover',
  'manga-panel',
  'ai-passport-photo',
] as const

const VALID_MODELS = new Set(['nano-banana-2', 'nano-banana-2-lite'])
const VALID_ASPECTS = new Set(['1:1', '3:4', '16:9', '9:16'])

// v4-shape: 8-4-4-4-12 hex chars, version=4 in 3rd group, variant 8/9/a/b in 4th group.
const UUID_V4_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('MOCK_TRENDS', () => {
  it('contains exactly 20 entries', () => {
    expect(MOCK_TRENDS).toHaveLength(20)
  })

  it('matches the canonical seed slug set in order', () => {
    expect(MOCK_TRENDS.map((t) => t.slug)).toEqual(EXPECTED_SLUGS)
  })

  it('gives every trend a non-empty title', () => {
    for (const t of MOCK_TRENDS) {
      expect(t.title.length).toBeGreaterThan(0)
    }
  })

  it('gives every trend a non-empty description', () => {
    for (const t of MOCK_TRENDS) {
      expect(t.description?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('only uses models from the valid enum', () => {
    for (const t of MOCK_TRENDS) {
      expect(VALID_MODELS.has(t.model)).toBe(true)
    }
  })

  it('only uses aspect ratios from the valid enum', () => {
    for (const t of MOCK_TRENDS) {
      expect(VALID_ASPECTS.has(t.aspect_ratio)).toBe(true)
    }
  })

  it('has every input_schema validate against TrendInputSchema', () => {
    for (const t of MOCK_TRENDS) {
      const result = TrendInputSchema.safeParse(t.input_schema)
      expect(result.success, `schema invalid for ${t.slug}`).toBe(true)
    }
  })

  it('assigns unique trend IDs', () => {
    const ids = MOCK_TRENDS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('formats every trend ID as a v4-shape UUID', () => {
    for (const t of MOCK_TRENDS) {
      expect(t.id, `bad uuid for ${t.slug}`).toMatch(UUID_V4_SHAPE)
    }
  })

  it('assigns display_order matching array index', () => {
    MOCK_TRENDS.forEach((t, i) => {
      expect(t.display_order).toBe(i)
    })
  })
})

describe('MOCK_GENERATIONS', () => {
  it('contains exactly 4 entries', () => {
    expect(MOCK_GENERATIONS).toHaveLength(4)
  })

  it('covers completed, processing, failed_retryable, and failed statuses', () => {
    const expected = new Set<MockGenerationStatus>([
      'completed',
      'processing',
      'failed_retryable',
      'failed',
    ])
    const got = new Set(MOCK_GENERATIONS.map((g) => g.status))
    expect(got).toEqual(expected)
  })

  it('references only real MOCK_TRENDS ids in every trend_id', () => {
    const trendIds = new Set(MOCK_TRENDS.map((t) => t.id))
    for (const g of MOCK_GENERATIONS) {
      expect(trendIds.has(g.trend_id), `bad trend_id for ${g.id}`).toBe(true)
    }
  })

  it('sets output_image_url only on completed generations', () => {
    for (const g of MOCK_GENERATIONS) {
      if (g.status === 'completed') {
        expect(g.output_image_url).not.toBeNull()
      } else {
        expect(g.output_image_url).toBeNull()
      }
    }
  })

  it('sets error_message only on failed and failed_retryable generations', () => {
    for (const g of MOCK_GENERATIONS) {
      if (g.status === 'failed' || g.status === 'failed_retryable') {
        expect(g.error_message).not.toBeNull()
      } else {
        expect(g.error_message).toBeNull()
      }
    }
  })
})

describe('findMockGeneration', () => {
  it('returns the row for a known id', () => {
    const found = findMockGeneration('mock-completed')
    expect(found?.status).toBe('completed')
  })

  it('returns null for an unknown id', () => {
    expect(findMockGeneration('does-not-exist')).toBeNull()
  })
})

describe('findMockTrendById', () => {
  it('returns the trend row for a known id', () => {
    const id = MOCK_TRENDS[0].id
    expect(findMockTrendById(id)?.slug).toBe('ghibli-portrait')
  })

  it('returns null for an unknown id', () => {
    expect(findMockTrendById('00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})
