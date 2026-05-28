/**
 * MOCK_TRENDS dev-mode fixtures.
 *
 * Gated on `process.env.MOCK_TRENDS === 'true'`. When enabled, repository
 * + auth-gated RSC pages short-circuit to in-memory fixtures so the consumer
 * flow can be screenshot-tested without Supabase Docker, Gemini, or any other
 * external dependency.
 *
 * Production behavior unchanged when flag absent.
 */
import type { PublicTrend } from '@/lib/trends/repository'

export const MOCK_TRENDS_ENABLED = process.env.MOCK_TRENDS === 'true'

const ISO_NOW = '2026-05-28T12:00:00.000Z'

export const MOCK_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'demo@trendimg.dev',
}

export const MOCK_PROFILE = {
  email: MOCK_USER.email,
  credits_balance: 42,
  free_used_this_week: 2,
  referral_code: 'a1b2c3d4e5f6',
  bonus_credits_earned: 10,
}

export const MOCK_TRENDS: PublicTrend[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'ghibli-portrait',
    title: 'Ghibli Portrait',
    description: 'Studio-Ghibli-style hand-painted portrait from your selfie.',
    thumbnail_url: '/mock/sample-1.svg',
    sample_before_url: null,
    sample_after_url: '/mock/sample-1.svg',
    aspect_ratio: '1:1',
    model: 'nano-banana-pro',
    input_schema: {
      fields: [
        {
          type: 'image',
          name: 'user_photo',
          label: 'Your photo',
          required: true,
          min_count: 1,
          max_count: 1,
          hint: 'Face clearly visible, good lighting.',
        },
      ],
    },
    seo_title: 'Ghibli Portrait — Trend Image Generator',
    seo_description: 'Turn your selfie into a Studio-Ghibli-style portrait.',
    faq: [
      { question: 'How long does it take?', answer: 'About 8 seconds on average.' },
      { question: 'Is my photo stored?', answer: 'Originals delete after 24 hours. Outputs follow your tier policy.' },
      { question: 'Can I share the result?', answer: 'Yes — built-in Instagram + TikTok share.' },
    ],
    display_order: 0,
    updated_at: ISO_NOW,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'pixar-couple',
    title: 'Pixar Couple',
    description: 'You + your partner reimagined as a Pixar movie still.',
    thumbnail_url: '/mock/sample-2.svg',
    sample_before_url: null,
    sample_after_url: '/mock/sample-2.svg',
    aspect_ratio: '16:9',
    model: 'nano-banana-pro',
    input_schema: {
      fields: [
        {
          type: 'image',
          name: 'photo_a',
          label: 'Photo A',
          required: true,
          min_count: 1,
          max_count: 1,
        },
        {
          type: 'image',
          name: 'photo_b',
          label: 'Photo B',
          required: true,
          min_count: 1,
          max_count: 1,
        },
        {
          type: 'select',
          name: 'mood',
          label: 'Mood',
          required: false,
          options: [
            { value: 'cozy', label: 'Cozy fireside' },
            { value: 'adventure', label: 'Mountain adventure' },
            { value: 'cafe', label: 'Paris cafe' },
          ],
          default: 'cozy',
        },
      ],
    },
    seo_title: 'Pixar Couple — Trend Image Generator',
    seo_description: 'Turn your couple photo into a Pixar movie still.',
    faq: [
      { question: 'Do both faces need to be visible?', answer: 'Yes, clear faces work best.' },
    ],
    display_order: 1,
    updated_at: ISO_NOW,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'anime-fighter',
    title: 'Anime Fighter',
    description: 'Shōnen anime hero glow-up — flames, dynamic pose, motion lines.',
    thumbnail_url: '/mock/sample-3.svg',
    sample_before_url: null,
    sample_after_url: '/mock/sample-3.svg',
    aspect_ratio: '9:16',
    model: 'nano-banana',
    input_schema: {
      fields: [
        {
          type: 'image',
          name: 'user_photo',
          label: 'Your photo',
          required: true,
          min_count: 1,
          max_count: 1,
        },
        {
          type: 'text',
          name: 'power_name',
          label: 'Power name',
          required: false,
          max_length: 30,
          hint: 'e.g. "Solar Flare"',
        },
      ],
    },
    seo_title: 'Anime Fighter — Trend Image Generator',
    seo_description: 'Become a shōnen anime hero.',
    faq: [],
    display_order: 2,
    updated_at: ISO_NOW,
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    slug: 'vintage-yearbook',
    title: 'Vintage Yearbook',
    description: '90s high-school yearbook portrait grid — six styles, one photo.',
    thumbnail_url: '/mock/sample-4.svg',
    sample_before_url: null,
    sample_after_url: '/mock/sample-4.svg',
    aspect_ratio: '3:4',
    model: 'nano-banana-pro',
    input_schema: {
      fields: [
        {
          type: 'image',
          name: 'user_photo',
          label: 'Your photo',
          required: true,
          min_count: 1,
          max_count: 1,
        },
      ],
    },
    seo_title: 'Vintage Yearbook — Trend Image Generator',
    seo_description: 'Six 90s yearbook looks from one photo.',
    faq: [],
    display_order: 3,
    updated_at: ISO_NOW,
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    slug: 'cyberpunk-neon',
    title: 'Cyberpunk Neon',
    description: 'Neon-drenched cyberpunk character portrait.',
    thumbnail_url: '/mock/sample-5.svg',
    sample_before_url: null,
    sample_after_url: '/mock/sample-5.svg',
    aspect_ratio: '1:1',
    model: 'nano-banana-pro',
    input_schema: {
      fields: [
        {
          type: 'image',
          name: 'user_photo',
          label: 'Your photo',
          required: true,
          min_count: 1,
          max_count: 1,
        },
        {
          type: 'select',
          name: 'palette',
          label: 'Palette',
          required: false,
          options: [
            { value: 'magenta', label: 'Magenta + cyan' },
            { value: 'lime', label: 'Lime + violet' },
            { value: 'gold', label: 'Gold + indigo' },
          ],
          default: 'magenta',
        },
      ],
    },
    seo_title: 'Cyberpunk Neon — Trend Image Generator',
    seo_description: 'Cyberpunk neon character art from your photo.',
    faq: [],
    display_order: 4,
    updated_at: ISO_NOW,
  },
]

export type MockGenerationStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'failed_retryable'

export interface MockGeneration {
  id: string
  user_id: string
  trend_id: string
  status: MockGenerationStatus
  output_image_url: string | null
  error_message: string | null
  attempts: number
  idempotency_key: string
  created_at: string
  cost_usd: number
  completed_at: string | null
  purge_at: string | null
}

const TREND_ID = MOCK_TRENDS[0].id

export const MOCK_GENERATIONS: MockGeneration[] = [
  {
    id: 'mock-completed',
    user_id: MOCK_USER.id,
    trend_id: TREND_ID,
    status: 'completed',
    output_image_url: '/mock/sample-1.svg',
    error_message: null,
    attempts: 1,
    idempotency_key: 'mock-key-completed',
    created_at: ISO_NOW,
    cost_usd: 0.024,
    completed_at: ISO_NOW,
    purge_at: null,
  },
  {
    id: 'mock-processing',
    user_id: MOCK_USER.id,
    trend_id: TREND_ID,
    status: 'processing',
    output_image_url: null,
    error_message: null,
    attempts: 1,
    idempotency_key: 'mock-key-processing',
    created_at: ISO_NOW,
    cost_usd: 0,
    completed_at: null,
    purge_at: null,
  },
  {
    id: 'mock-retryable',
    user_id: MOCK_USER.id,
    trend_id: MOCK_TRENDS[1].id,
    status: 'failed_retryable',
    output_image_url: null,
    error_message: 'Transient upstream timeout. Retry available.',
    attempts: 2,
    idempotency_key: 'mock-key-retryable',
    created_at: ISO_NOW,
    cost_usd: 0,
    completed_at: null,
    purge_at: null,
  },
  {
    id: 'mock-failed',
    user_id: MOCK_USER.id,
    trend_id: MOCK_TRENDS[2].id,
    status: 'failed',
    output_image_url: null,
    error_message: 'Output rejected by safety filter. No credit charged.',
    attempts: 3,
    idempotency_key: 'mock-key-failed',
    created_at: ISO_NOW,
    cost_usd: 0,
    completed_at: null,
    purge_at: null,
  },
]

export function findMockGeneration(id: string): MockGeneration | null {
  return MOCK_GENERATIONS.find((g) => g.id === id) ?? null
}

export function findMockTrendById(id: string): PublicTrend | null {
  return MOCK_TRENDS.find((t) => t.id === id) ?? null
}
